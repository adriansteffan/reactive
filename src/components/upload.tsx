import { useCallback, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { v4 as uuidv4 } from 'uuid';
import { post } from '../utils/request';
import { FileUpload, getParam, StudyEvent } from '../utils/common';
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';

interface UploadPayload {
  sessionId: string;
  files: FileUpload[];
}

interface UploadResponse {
  status: number;
  message?: string;
}

export default function Upload({
  data,
  next,
  sessionID,
  generateFiles,
  uploadRaw = true,
}: {
  data: StudyEvent[];
  next: () => void;
  sessionID?: string | null;
  generateFiles: (sessionID: string, data: StudyEvent[]) => FileUpload[];
  uploadRaw: boolean;
}) {
  const [uploadState, setUploadState] = useState<'initial' | 'uploading' | 'success' | 'error'>(
    'initial',
  );
  const shouldUpload = !getParam('upload', true, 'boolean');
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
        next();
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

  const handleUpload = async () => {
    setUploadState('uploading');

    const sessionIDUpload = sessionID ?? uuidv4();

    const files: FileUpload[] = generateFiles ? generateFiles(sessionIDUpload, data) : [];
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
        next();
        return;
      }

      uploadData.mutate(payload);
    } catch (error) {
      console.error('Error uploading:', error);
      setUploadState('error');
    }
  };

  return (
    <div className='flex flex-col items-center justify-center gap-4 p-6 text-xl mt-16'>
      {uploadState == 'initial' && (
        <>
          <p className=''>
            Thank you for participating! Please click the button below to submit your data.
          </p>
          <button
            onClick={handleUpload}
            className='mt-8 bg-white px-8 py-3 border-2 border-black font-bold text-black text-lg rounded-xl shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none'
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
            className='px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors'
          >
            Try Again
          </button>
        </>
      )}
    </div>
  );
}
