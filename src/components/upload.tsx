import React, { useCallback, useEffect, useRef, useState } from 'react';
import { uuidv4 } from '../utils/ids';
import { post } from '../core/backend';
import { BaseComponentProps } from '../core/component';
import { FileUpload } from '../core/files';
import { Platform } from '../core/platform';
import { TrialData } from '../core/rows';
import { useParams } from '../runner/contexts';
import { strToU8, zipSync, type Zippable } from 'fflate';
import { FileBackend, getNative } from '../core/platform';
import { buildUploadFiles, convertArrayOfObjectsToCSV } from '../core/files';
import { type Store } from '../core/store';
import { defineComponent } from '../core/component';
import { uniform } from '../utils/distributions';
import { useTheme, t } from '../runner/theme';

interface UploadPayload {
  sessionId: string;
  uploadId?: string;
  parentFolder?: string;
  files: FileUpload[];
}



const params = {
  upload: { default: true, description: 'Upload the data at the end of the experiment?' },
  download: { default: false, description: 'Locally download the data at the end of the experiment?' },
};

const getFileBackend = (parentFolder?: string): { backend: FileBackend | null; type: Platform } => {
  const native = getNative();
  return native
    ? { backend: native.createFileBackend(parentFolder), type: 'native' }
    : { backend: null, type: 'web' };
};

// Function to generate a unique directory name
const getUniqueDirectoryName = async (
  backend: FileBackend,
  baseSessionId: string,
): Promise<string> => {
  let uniqueSessionId = baseSessionId;

  if (await backend.directoryExists(uniqueSessionId)) {
    let counter = 1;
    uniqueSessionId = `${baseSessionId}_${counter}`;

    while (await backend.directoryExists(uniqueSessionId)) {
      counter++;
      uniqueSessionId = `${baseSessionId}_${counter}`;
    }
  }

  return uniqueSessionId;
};

function Upload({
  data,
  next,
  store,
  sessionId,
  generateFiles,
  sessionData,
  uploadRaw = true,
  autoUpload = true,
  parentFolder,
  className,
  containerClass,
  centered,
  content,
  uploadingContent,
  errorContent,
  buttonText = 'Submit Data',
  retryButtonText = 'Try Again',
}: BaseComponentProps & {
  sessionId?: string | null;
  generateFiles?: (input: { sessionId: string; data: TrialData[]; store: Store }) => FileUpload[];
  sessionData?: Record<string, any>;
  uploadRaw?: boolean;
  /** Uploads as soon as the screen appears. With `false`, participants submit with a button first. */
  autoUpload?: boolean;
  /** The folder the session's folder goes into, on the server and on the device. */
  parentFolder?: string;
  className?: string;
  containerClass?: string;
  centered?: boolean;
  content?: React.ReactNode;
  uploadingContent?: React.ReactNode;
  errorContent?: React.ReactNode;
  buttonText?: string;
  retryButtonText?: string;
}) {
  const [uploadState, setUploadState] = useState<'initial' | 'uploading' | 'success' | 'error'>(
    'initial',
  );
  const uploadInitiatedRef = useRef(false);

  const { upload: shouldUpload, download: shouldDownload } = useParams(params);

  const downloadFiles = useCallback(async (files: FileUpload[]) => {
    const entries: Zippable = {};
    for (const file of files) {
      if (file.encoding === 'base64') {
        // Recordings are already compressed, so they are stored as they are
        const binary = Uint8Array.from(atob(file.content), (c) => c.charCodeAt(0));
        entries[file.filename] = [binary, { level: 0 }];
      } else {
        entries[file.filename] = strToU8(file.content);
      }
    }

    const blob = new Blob([zipSync(entries)], { type: 'application/zip' });
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

    const sessionIdUpload = sessionId ?? store.__uploadId ?? uuidv4();

    const files = buildUploadFiles({
      sessionId: sessionIdUpload,
      data,
      store,
      generateFiles,
      sessionData,
      uploadRaw,
    });

    try {
      if (shouldDownload) {
        await downloadFiles(files);
      }

      // Filter out eagerly uploaded files for the server upload (they're already there)
      const filesToUpload = files.filter((f) => !f._alreadyUploaded);
      const payload: UploadPayload = {
        sessionId: sessionIdUpload,
        ...(store.__uploadId && store.__uploadId !== sessionIdUpload ? { uploadId: store.__uploadId } : {}),
        ...(parentFolder ? { parentFolder } : {}),
        files: filesToUpload.map((file) => ({ ...file, encoding: file.encoding ?? 'utf8' })),
      };

      if (!shouldUpload) {
        next({});
        return;
      }

      // Get the current platform and appropriate file backend
      const { backend, type } = getFileBackend(parentFolder);

      if (type === 'web') {
        const response = await post('/data', payload);
        if (response.ok) {
          setUploadState('success');
          next({});
        } else {
          setUploadState('error');
        }
      } else if (backend) {
        try {
          const uniqueSessionId = await getUniqueDirectoryName(backend, sessionIdUpload);

          await backend.createDirectory(uniqueSessionId);

          for (const file of files) {
            await backend.saveFile(file.filename, file.content, uniqueSessionId);
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
    sessionId,
    generateFiles,
    data,
    uploadRaw,
    shouldDownload,
    shouldUpload,
    downloadFiles,
    next,
    store,
    sessionData,
    parentFolder,
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
      {uploadState === 'initial' && !autoUpload && (
        <>
          {content ?? <p>Thank you for participating! Please click the button below to submit your data.</p>}
          <button onClick={handleUpload} className={`mt-8 ${btnClass}`}>
            {buttonText}
          </button>
        </>
      )}
      {uploadState === 'uploading' && (
        <>
          {uploadingContent ?? <>
            <div className='w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin'></div>
            <p>Uploading your data...</p>
          </>}
        </>
      )}
      {uploadState === 'success' && <></>}

      {uploadState === 'error' && (
        <>
          {errorContent ?? <div className={`${th.error} mb-4`}>
            <p>Sorry, there was an error uploading your data.</p>
            <p>Please try again or contact the researcher.</p>
          </div>}
          <button onClick={handleUpload} className={btnClass}>
            {retryButtonText}
          </button>
        </>
      )}
    </div>
    </div>
  );
}

export default defineComponent({
  name: 'Upload',
  component: Upload,
  csv: null,
  params,
  simulate: async ({ props, data, store, participant, initialParticipant }) => {
    const sessionId = props.sessionId || `sim_${Date.now()}_${Math.floor(uniform(0, 36 ** 6)).toString(36)}`;
    const files = buildUploadFiles({
      sessionId,
      data,
      store,
      generateFiles: props.generateFiles,
      sessionData: props.sessionData,
      uploadRaw: props.uploadRaw ?? true,
    });

    files.push({
      filename: `${sessionId}_participant_initial.csv`,
      content: convertArrayOfObjectsToCSV([initialParticipant]),
      encoding: 'utf8',
    });
    files.push({
      filename: `${sessionId}_participant_final.csv`,
      content: convertArrayOfObjectsToCSV([participant]),
      encoding: 'utf8',
    });

    const res = await post('/data', {
      sessionId,
      ...(props.parentFolder ? { parentFolder: props.parentFolder } : {}),
      files: files.map((f) => ({ ...f, encoding: f.encoding ?? 'utf8' })),
    });
    if (!res.ok) {
      console.error(`Simulation upload failed: ${res.status} ${res.statusText}`);
    }

    return { responseData: { files } };
  },
});
