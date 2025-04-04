import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { v4 as uuidv4 } from 'uuid';
import { post } from '../utils/request';
import { BaseComponentProps, FileUpload, getParam, getPlatform, Platform, Store, TrialData } from '../utils/common';
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
    }
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
              directory: Directory.Documents
            });
          } catch {
            // Parent folder doesn't exist, so subpath doesn't exist either
            return false;
          }
        }
        
        const fullPath = getPath(path);
        const result = await Filesystem.readdir({
          path: fullPath,
          directory: Directory.Documents
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
              recursive: false
            });
          } catch (e) {
            // Parent directory might already exist, that's fine
          }
        }
        
        const fullPath = getPath(path);
        await Filesystem.mkdir({
          path: fullPath,
          directory: Directory.Documents,
          recursive: true
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
    }
  };
};

const getFileBackend = (parentDir?: string): { backend: FileBackend | null, type: Platform } => {
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
  baseSessionId: string
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
  uploadRaw = true,
  autoUpload = false,
  androidFolderName,
}: BaseComponentProps & {
  sessionID?: string | null;
  generateFiles: (sessionID: string, data: TrialData[], store?: Store) => FileUpload[];
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
  
    try {
      const payload: UploadPayload = {
        sessionId: sessionIDUpload,
        files,
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
