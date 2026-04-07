import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { buildUploadFiles, convertArrayOfObjectsToCSV } from '../utils/upload';
import { registerSimulation, getBackendUrl, getInitialParticipant } from '../utils/simulation';
import { uniform } from '../utils/distributions';
import { useTheme, t } from '../utils/theme';

registerSimulation('Upload', async (trialProps, experimentState, _simulators, participant) => {
  const sessionID = trialProps.sessionID || `sim_${Date.now()}_${Math.floor(uniform(0, 36 ** 6)).toString(36)}`;
  const files = buildUploadFiles({
    sessionID,
    data: experimentState.data || [],
    store: experimentState.store,
    generateFiles: trialProps.generateFiles,
    sessionData: trialProps.sessionData,
    uploadRaw: trialProps.uploadRaw ?? true,
  });

  const initialParticipant = getInitialParticipant();
  if (initialParticipant) {
    files.push({
      filename: `${sessionID}_participant_initial.csv`,
      content: convertArrayOfObjectsToCSV([initialParticipant]),
      encoding: 'utf8',
    });
    files.push({
      filename: `${sessionID}_participant_final.csv`,
      content: convertArrayOfObjectsToCSV([participant]),
      encoding: 'utf8',
    });
  }

  const backendUrl = getBackendUrl();
  if (backendUrl) {
    const payload = {
      sessionId: sessionID,
      files: files.map((f) => ({ ...f, encoding: f.encoding ?? 'utf8' })),
    };
    const res = await fetch(`${backendUrl}/data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(`Simulation upload failed: ${res.status} ${res.statusText}`);
    }
  }

  return { responseData: { files }, participantState: participant };
}, {});

interface UploadPayload {
  sessionId: string;
  files: FileUpload[];
}

interface UploadResponse {
  status: number;
  message?: string;
}

const UPLOAD_PARAMS = [
  {
    name: 'upload',
    defaultValue: true,
    type: 'boolean' as const,
    description: 'Upload the data at the end of the experiment?',
  },
  {
    name: 'download',
    defaultValue: false,
    type: 'boolean' as const,
    description: 'Locally download the data at the end of the experiment?',
  },
];
registerComponentParams('Upload', UPLOAD_PARAMS);


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

export default function Upload({
  data,
  next,
  store,
  sessionID,
  generateFiles,
  sessionData,
  uploadRaw = true,
  autoUpload = false,
  androidFolderName,
  className,
  containerClass,
  centered,
  content,
  uploadingContent,
  errorContent,
}: BaseComponentProps & {
  sessionID?: string | null;
  generateFiles?: (sessionID: string, data: TrialData[], store?: Store) => FileUpload[];
  sessionData?: Record<string, any>;
  uploadRaw?: boolean;
  autoUpload?: boolean;
  androidFolderName?: string;
  className?: string;
  containerClass?: string;
  centered?: boolean;
  content?: React.ReactNode;
  uploadingContent?: React.ReactNode;
  errorContent?: React.ReactNode;
}) {
  const [uploadState, setUploadState] = useState<'initial' | 'uploading' | 'success' | 'error'>(
    'initial',
  );
  const uploadInitiatedRef = useRef(false);

  const uploadParam = UPLOAD_PARAMS.find(p => p.name === 'upload')!;
  const downloadParam = UPLOAD_PARAMS.find(p => p.name === 'download')!;
  const shouldUpload = getParam(uploadParam.name, uploadParam.defaultValue, uploadParam.type);
  const shouldDownload = getParam(downloadParam.name, downloadParam.defaultValue, downloadParam.type);

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

    const files = buildUploadFiles({
      sessionID: sessionIDUpload,
      data,
      store,
      generateFiles,
      sessionData,
      uploadRaw,
    });

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

  const th = t(useTheme());
  const btnClass = `cursor-pointer ${th.buttonBg} px-8 py-3 border-2 ${th.buttonBorder} font-bold ${th.buttonText} text-lg rounded-xl ${th.buttonShadow} hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none`;

  return (
    <div className={`${centered ? 'flex items-center justify-center' : ''} ${containerClass ?? th.containerBg}`} style={{ position: 'fixed', inset: 0 }}>
    <div className={`flex flex-col items-center justify-center gap-4 p-6 text-xl mt-16 px-10 h-full ${th.text} ${className ?? ''}`}>
      {uploadState == 'initial' && !autoUpload && (
        <>
          {content ?? <p>Thank you for participating! Please click the button below to submit your data.</p>}
          <button onClick={handleUpload} className={`mt-8 ${btnClass}`}>
            Submit Data
          </button>
        </>
      )}
      {uploadState == 'uploading' && (
        <>
          {uploadingContent ?? <>
            <div className='w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin'></div>
            <p>Uploading your data...</p>
          </>}
        </>
      )}
      {uploadState == 'success' && <></>}

      {uploadState == 'error' && (
        <>
          {errorContent ?? <div className={`${th.error} mb-4`}>
            <p>Sorry, there was an error uploading your data.</p>
            <p>Please try again or contact the researcher.</p>
          </div>}
          <button onClick={handleUpload} className={btnClass}>
            Try Again
          </button>
        </>
      )}
    </div>
    </div>
  );
}
