import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { v4 as uuidv4 } from 'uuid';
import { post } from '../utils/request';
import {
  BaseComponentProps,
  FileUpload,
  getParam,
  getPlatform,
  Platform,
  registerComponentParams,
  Store,
  TrialData,
} from '../utils/common';
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';

import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';

interface UploadPayload {
  sessionId: string;
  files: FileUpload[];
}

interface UploadResponse {
  status: number;
  message?: string;
}

// TODO: deduplicate values with upload function below
registerComponentParams('Upload', [
  {
    name: 'upload',
    defaultValue: true,
    type: 'boolean',
    description: 'Upload the data at the end of the experiment?',
  },
  {
    name: 'download',
    defaultValue: false,
    type: 'boolean',
    description: 'Locally download the data at the end of the experiment?',
  },
]);

type DataObject = {
  [key: string]: string | number | boolean | null | undefined;
};

function escapeCsvValue(value: any): string {
  if (value === null || value === undefined) {
    return '';
  }

  const stringValue = String(value);

  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    const escapedValue = stringValue.replace(/"/g, '""');
    return `"${escapedValue}"`;
  }

  return stringValue;
}

function convertArrayOfObjectsToCSV(data: DataObject[]): string {
  if (!data || data.length === 0) {
    return '';
  }

  const headerSet = new Set<string>();
  data.forEach((obj) => {
    Object.keys(obj).forEach((key) => {
      headerSet.add(key);
    });
  });
  const headers = Array.from(headerSet);

  const headerRow = headers.map((header) => escapeCsvValue(header)).join(',');

  const dataRows = data.map((obj) => {
    return headers
      .map((header) => {
        const value = obj[header];
        return escapeCsvValue(value);
      })
      .join(',');
  });

  return [headerRow, ...dataRows].join('\n');
}

// TODO: for better cohesion move this into the components on registration
const defaultFlatteningFunctions = {
  'CanvasBlock': (item: TrialData) => {
    const responseData = item.responseData;
    if (Array.isArray(responseData)) {
      return responseData.map((i) => ({
        block: item.name,
        ...i,
      }));
    }
    return [];
  }
}

const transform = ({responseData, ...obj}: any) => ({ ...obj, ...Object.entries(responseData || {}).reduce((acc, [k, v]) => ({...acc, [`data_${k}`]: v}), {}) });

function combineTrialsToCsv(
  data: any[],
  filename: string,
  names: string[],
  flatteningFunctions: Record<string, (item: any) => any[] | Record<string, any[]>>,
  fun?: (obj: any) => any,
): FileUpload | FileUpload[] {

  // Collect all flattener results first, filtering out completely empty results
  const allResults: (any[] | Record<string, any[]>)[] = names.flatMap((name) => {
    const matchingItems = data.filter((d) => d.name === name);

    return matchingItems.map((item) => {
      const flattener = item.type && flatteningFunctions[item.type];
      const result = flattener ? flattener(item) : [transform(item)];

      // Filter out completely empty results
      if (Array.isArray(result) && result.length === 0) {
        return null; // Signal this trial should be completely skipped
      }

      if (result && typeof result === 'object' && !Array.isArray(result)) {
        // Check if all arrays in the object are empty
        const hasAnyData = Object.values(result).some(val =>
          Array.isArray(val) && val.length > 0
        );
        if (!hasAnyData) {
          return null; // Signal this trial should be completely skipped
        }
      }

      return result;
    });
  }).filter(result => result !== null);

  // Check if any result is a multi-table object (has string keys with array values)
  const hasMultiTable = allResults.some((result) =>
    result &&
    typeof result === 'object' &&
    !Array.isArray(result) &&
    Object.keys(result).some(key => Array.isArray(result[key]))
  );

  if (!hasMultiTable) {
    // all results are arrays, combine them into one CSV
    const processedData = allResults
      .flatMap((result) => Array.isArray(result) ? result : [])
      .map((x) => (fun ? fun(x) : x));

    // Skip creating CSV if all flatteners returned empty arrays
    if (processedData.length === 0) {
      return [];
    }

    return {
      filename,
      encoding: 'utf8' as const,
      content: convertArrayOfObjectsToCSV(processedData),
    };
  }

  // handle multi-table results
  // Collect all table keys from all results
  const allTableKeys = new Set<string>();
  allResults.forEach((result) => {
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      Object.keys(result).forEach(key => {
        if (Array.isArray(result[key])) {
          allTableKeys.add(key);
        }
      });
    }
  });

  // Create separate CSV files for each table key
  const files: FileUpload[] = [];

  for (const tableKey of allTableKeys) {
    const tableData = allResults.flatMap((result) => {
      if (Array.isArray(result)) {
        // If this result is a simple array, include it in all tables for backward compatibility
        return result;
      } else if (result && typeof result === 'object' && result[tableKey]) {
        // If this result has data for this table key, include it
        return result[tableKey];
      }
      return [];
    }).map((x) => (fun ? fun(x) : x));

    // Skip creating CSV if all flatteners returned empty arrays for this table
    if (tableData.length === 0) {
      continue;
    }

    // Remove file extension from filename and add table key
    const baseFilename = filename.replace(/\.csv$/, '');

    files.push({
      filename: `${baseFilename}_${tableKey}.csv`,
      encoding: 'utf8' as const,
      content: convertArrayOfObjectsToCSV(tableData),
    });
  }

  // Return empty array if no files were created
  if (files.length === 0) {
    return [];
  }

  return files.length === 1 ? files[0] : files;
}

interface FileBackend {
  directoryExists(path: string): Promise<boolean>;
  createDirectory(path: string): Promise<void>;
  saveFile(filename: string, content: string, directory: string): Promise<void>;
}

const createElectronFileBackend = (): FileBackend => {
  const electronAPI = (window as any).electronAPI;

  return {
    directoryExists: async (path: string): Promise<boolean> => {
      const result = await electronAPI.directoryExists(path);
      return result.success && result.exists;
    },
    createDirectory: async (path: string): Promise<void> => {
      await electronAPI.createDirectory(path);
    },
    saveFile: async (filename: string, content: string, directory: string): Promise<void> => {
      await electronAPI.saveFile(filename, content, directory);
    },
  };
};

const createCapacitorFileBackend = (parentFolder?: string): FileBackend => {
  const getPath = (path: string): string => {
    if (!parentFolder) {
      return path;
    }
    return path ? `${parentFolder}/${path}` : parentFolder;
  };

  return {
    directoryExists: async (path: string): Promise<boolean> => {
      try {
        if (parentFolder) {
          try {
            await Filesystem.readdir({
              path: parentFolder,
              directory: Directory.Documents,
            });
          } catch {
            // Parent folder doesn't exist, so subpath doesn't exist either
            return false;
          }
        }

        const fullPath = getPath(path);
        const result = await Filesystem.readdir({
          path: fullPath,
          directory: Directory.Documents,
        });
        return result.files.length >= 0;
      } catch {
        return false;
      }
    },

    createDirectory: async (path: string): Promise<void> => {
      try {
        if (parentFolder) {
          try {
            await Filesystem.mkdir({
              path: parentFolder,
              directory: Directory.Documents,
              recursive: false,
            });
          } catch (e) {
            // Parent directory might already exist, that's fine
          }
        }

        const fullPath = getPath(path);
        await Filesystem.mkdir({
          path: fullPath,
          directory: Directory.Documents,
          recursive: true,
        });
      } catch (e) {
        console.error('Error creating directory:', e);
        throw e;
      }
    },

    saveFile: async (filename: string, content: string, directory: string): Promise<void> => {
      const fullDirectory = getPath(directory);

      await Filesystem.writeFile({
        path: `${fullDirectory}/${filename}`,
        data: content,
        directory: Directory.Documents,
        encoding: 'utf8' as Encoding,
      });
    },
  };
};

const getFileBackend = (parentDir?: string): { backend: FileBackend | null; type: Platform } => {
  const platform = getPlatform();

  switch (platform) {
    case 'desktop':
      return { backend: createElectronFileBackend(), type: platform };
    case 'mobile':
      return { backend: createCapacitorFileBackend(parentDir), type: platform };
    case 'web':
      return { backend: null, type: platform };
  }
};

// Function to generate a unique directory name
const getUniqueDirectoryName = async (
  backend: FileBackend,
  baseSessionId: string,
): Promise<string> => {
  let uniqueSessionID = baseSessionId;

  if (await backend.directoryExists(uniqueSessionID)) {
    let counter = 1;
    uniqueSessionID = `${baseSessionId}_${counter}`;

    while (await backend.directoryExists(uniqueSessionID)) {
      counter++;
      uniqueSessionID = `${baseSessionId}_${counter}`;
    }
  }

  return uniqueSessionID;
};

type CSVBuilder = {
  filename?: string;
  trials?: string[];
  fun?: (row: Record<string, any>) => Record<string, any>;
};

export default function Upload({
  data,
  next,
  store,
  sessionID,
  generateFiles,
  sessionCSVBuilder,
  trialCSVBuilder,
  uploadRaw = true,
  autoUpload = false,
  androidFolderName,
}: BaseComponentProps & {
  sessionID?: string | null;
  generateFiles: (sessionID: string, data: TrialData[], store?: Store) => FileUpload[];
  sessionCSVBuilder: CSVBuilder;
  trialCSVBuilder: {flatteners: Record<string, ((item: TrialData) => Record<string, any>[] | Record<string, Record<string, any>[]>)>, builders: CSVBuilder[]};
  uploadRaw: boolean;
  autoUpload: boolean;
  androidFolderName?: string;
}) {
  const [uploadState, setUploadState] = useState<'initial' | 'uploading' | 'success' | 'error'>(
    'initial',
  );
  const uploadInitiatedRef = useRef(false);

  const shouldUpload = getParam('upload', true, 'boolean');
  const shouldDownload = getParam('download', false, 'boolean');

  const uploadData = useMutation({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mutationFn: async (body: any) => {
      const response = await post('/data', body);
      return response as UploadResponse;
    },
    onSuccess: (res: UploadResponse) => {
      if (res.status === 200) {
        setUploadState('success');
        next({});
      } else {
        setUploadState('error');
      }
    },
    onError: () => {
      setUploadState('error');
    },
  });

  const downloadFiles = useCallback(async (files: FileUpload[]) => {
    const zipWriter = new ZipWriter(new BlobWriter());

    for (const file of files) {
      await zipWriter.add(file.filename, new TextReader(file.content));
    }

    const blob = await zipWriter.close();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'study-data.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  const handleUpload = useCallback(async () => {
    setUploadState('uploading');

    if (uploadInitiatedRef.current) {
      return;
    }

    uploadInitiatedRef.current = true;

    const sessionIDUpload = sessionID ?? uuidv4();

    const files: FileUpload[] = generateFiles ? generateFiles(sessionIDUpload, data, store) : [];
    if (uploadRaw) {
      files.push({
        filename: `${sessionIDUpload}.raw.json`,
        content: JSON.stringify(data),
        encoding: 'utf8',
      });
    }

    if (sessionCSVBuilder) {
      type ParamDetails = {
        value?: any;
        defaultValue: any;
      };
      let paramsDict: Record<string, any> = {};
      const paramsSource: Record<string, ParamDetails | any> | undefined =
        data?.[0]?.responseData?.params;
      if (paramsSource && typeof paramsSource === 'object' && paramsSource !== null) {
        paramsDict = Object.entries(paramsSource).reduce(
          (
            accumulator: Record<string, any>,
            [paramName, paramDetails]: [string, ParamDetails | any],
          ) => {
            if (
              paramDetails &&
              typeof paramDetails === 'object' &&
              'defaultValue' in paramDetails
            ) {
              const chosenValue = paramDetails.value ?? paramDetails.defaultValue;
              accumulator[paramName] = chosenValue;
            }
            return accumulator;
          },
          {} as Record<string, any>,
        );
      }

      let content = {
        sessionID: sessionIDUpload,
        userAgent: data[0].responseData.userAgent,
        ...paramsDict,
      };

      if (
        sessionCSVBuilder.trials &&
        Array.isArray(sessionCSVBuilder.trials) &&
        sessionCSVBuilder.trials.length > 0
      ) {
        for (const trialName of sessionCSVBuilder.trials) {
          const matchingDataElement = data.find((element) => element.name === trialName);

          if (matchingDataElement?.responseData) {
            if (
              typeof matchingDataElement.responseData === 'object' &&
              matchingDataElement.responseData !== null
            ) {
              content = { ...content, ...matchingDataElement.responseData };
            }
          }
        }
      }

      files.push({
        content: convertArrayOfObjectsToCSV([
          sessionCSVBuilder.fun ? sessionCSVBuilder.fun(content) : content,
        ]),
        filename: `${sessionIDUpload}${sessionCSVBuilder.filename}.csv`,
        encoding: 'utf8' as const,
      });
    }

    if (trialCSVBuilder) {
      for (const builder of trialCSVBuilder.builders) {
        const result = combineTrialsToCsv(
          data,
          `${sessionIDUpload}${builder.filename}.csv`,
          builder.trials ?? [],
          {...defaultFlatteningFunctions, ...trialCSVBuilder.flatteners},
          builder.fun,
        );

        if (Array.isArray(result)) {
          // Only push files if the array is not empty
          if (result.length > 0) {
            files.push(...result);
          }
        } else {
          files.push(result);
        }
      }
    }

    try {
      const payload: UploadPayload = {
        sessionId: sessionIDUpload,
        files: files.map((file) => ({ ...file, encoding: file.encoding ?? 'utf8' })),
      };

      if (shouldDownload) {
        await downloadFiles(files);
      }

      if (!shouldUpload) {
        next({});
        return;
      }

      // Get the current platform and appropriate file backend
      const { backend, type } = getFileBackend(androidFolderName);

      if (type === 'web') {
        uploadData.mutate(payload);
      } else if (backend) {
        try {
          const uniqueSessionID = await getUniqueDirectoryName(backend, sessionIDUpload);

          await backend.createDirectory(uniqueSessionID);

          for (const file of files) {
            await backend.saveFile(file.filename, file.content, uniqueSessionID);
          }

          setUploadState('success');
          next({});
        } catch (error) {
          console.error(`Error saving files with ${type}:`, error);
          setUploadState('error');
        }
      }
    } catch (error) {
      console.error('Error uploading:', error);
      setUploadState('error');
    }
  }, [
    sessionID,
    generateFiles,
    data,
    uploadRaw,
    shouldDownload,
    shouldUpload,
    downloadFiles,
    next,
    uploadData,
  ]);

  useEffect(() => {
    if (autoUpload && !uploadInitiatedRef.current && handleUpload) {
      handleUpload();
    }
  }, [autoUpload, handleUpload]);

  // reset the duplicate prevention if there was an error uploading
  useEffect(() => {
    if (uploadState === 'error') {
      uploadInitiatedRef.current = false;
    }
  }, [uploadState]);

  return (
    <div className='flex flex-col items-center justify-center gap-4 p-6 text-xl mt-16 px-10'>
      {uploadState == 'initial' && !autoUpload && (
        <>
          <p className=''>
            Thank you for participating! Please click the button below to submit your data.
          </p>
          <button
            onClick={handleUpload}
            className='mt-8 cursor-pointer bg-white px-8 py-3 border-2 border-black font-bold text-black text-lg rounded-xl shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none'
          >
            Submit Data
          </button>
        </>
      )}
      {uploadState == 'uploading' && (
        <>
          <div className='w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin'></div>
          <p className=''>Uploading your data...</p>
        </>
      )}
      {uploadState == 'success' && <></>}

      {uploadState == 'error' && (
        <>
          <div className='text-red-500 mb-4'>
            <p className=''>Sorry, there was an error uploading your data.</p>
            <p>Please try again or contact the researcher.</p>
          </div>
          <button
            onClick={handleUpload}
            className='px-4 py-2 cursor-pointer bg-blue-500 text-white rounded-sm hover:bg-blue-600 transition-colors'
          >
            Try Again
          </button>
        </>
      )}
    </div>
  );
}
