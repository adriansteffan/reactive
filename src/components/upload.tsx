import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { uuidv4 } from '../utils/ids';
import { post } from '../core/backend';
import { BaseComponentProps } from '../core/component';
import type { FileUpload } from '../core/files';
import type { ExperimentData } from '../core/rows';
import { CompiledTimelineContext, useParams } from '../runner/contexts';
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

// The session's id, numbered if the app already has a folder of that name
async function uniqueDirectoryName(backend: FileBackend, sessionId: string): Promise<string> {
  let name = sessionId;
  for (let i = 1; await backend.directoryExists(name); i++) name = `${sessionId}_${i}`;
  return name;
}

// Saves the files on the participant's computer, as one zip
function downloadZip(files: FileUpload[]) {
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
}

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
  generateFiles?: (input: { sessionId: string; data: ExperimentData; store: Store }) => FileUpload[];
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
  const { components } = useContext(CompiledTimelineContext);

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
      components,
      generateFiles,
      sessionData,
      uploadRaw,
    });

    try {
      if (shouldDownload) downloadZip(files);

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

      // The apps save the files on the device, and the browser sends them to the server
      const native = getNative();
      if (native) {
        const backend = native.createFileBackend(parentFolder);
        const directory = await uniqueDirectoryName(backend, sessionIdUpload);
        await backend.createDirectory(directory);
        for (const file of files) await backend.saveFile(file.filename, file.content, directory);
      } else {
        const response = await post('/data', payload);
        if (!response.ok) throw new Error(`The server answered ${response.status} ${response.statusText}.`);
      }
      setUploadState('success');
      next({});
    } catch (error) {
      console.error('Error uploading:', error);
      // The participant can try again
      uploadInitiatedRef.current = false;
      setUploadState('error');
    }
  }, [
    sessionId,
    generateFiles,
    data,
    uploadRaw,
    shouldDownload,
    shouldUpload,
    next,
    store,
    components,
    sessionData,
    parentFolder,
  ]);

  useEffect(() => {
    if (autoUpload && !uploadInitiatedRef.current && handleUpload) {
      handleUpload();
    }
  }, [autoUpload, handleUpload]);

  const th = t(useTheme());

  return (
    <div className={`${centered ? 'flex items-center justify-center' : ''} ${containerClass ?? th.containerBg}`} style={{ position: 'fixed', inset: 0 }}>
    <div className={`flex flex-col items-center justify-center gap-4 p-6 text-xl mt-16 px-10 h-full ${th.text} ${className ?? ''}`}>
      {uploadState === 'initial' && !autoUpload && (
        <>
          {content ?? <p>Thank you for participating! Please click the button below to submit your data.</p>}
          <button onClick={handleUpload} className={`mt-8 ${th.button}`}>
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
      {uploadState === 'error' && (
        <>
          {errorContent ?? <div className={`${th.error} mb-4`}>
            <p>Sorry, there was an error uploading your data.</p>
            <p>Please try again or contact the researcher.</p>
          </div>}
          <button onClick={handleUpload} className={th.button}>
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
  simulate: async ({ props, data, store, components, participant, initialParticipant }) => {
    const sessionId = props.sessionId || `sim_${Date.now()}_${Math.floor(uniform(0, 36 ** 6)).toString(36)}`;
    const files = buildUploadFiles({
      sessionId,
      data,
      store,
      components,
      generateFiles: props.generateFiles,
      sessionData: props.sessionData,
      uploadRaw: props.uploadRaw,
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
