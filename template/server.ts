import fs from 'fs/promises';
import path from 'path';
import index from './index.html';

const dataFolder = path.join(import.meta.dir, 'data');
const publicFolder = path.join(import.meta.dir, 'public');

const PORT = Number(process.env.PORT ?? 8001);

interface FileUpload {
  filename: string;
  content: string;  // base64 or text content
  encoding: 'base64' | 'utf8';
}

interface UploadRequest {
  sessionId: string;
  _uploadId?: string;
  files: FileUpload[];
}

// Session ids and filenames become path segments under data/, so they must not escape it
function isPlainName(name: unknown): boolean {
  return typeof name === 'string' && name !== '' && name !== '.' && name !== '..' && path.basename(name) === name;
}

function isUploadRequest(data: Partial<UploadRequest> | null): data is UploadRequest {
  return (
    data !== null &&
    isPlainName(data.sessionId) &&
    (data._uploadId === undefined || isPlainName(data._uploadId)) &&
    Array.isArray(data.files) &&
    data.files.every(
      (file: Partial<FileUpload> | null) =>
        file !== null &&
        isPlainName(file.filename) &&
        typeof file.content === 'string' &&
        (file.encoding === 'base64' || file.encoding === 'utf8'),
    )
  );
}

async function getUniqueDirName(base: string): Promise<string> {
  let candidate = base;
  let counter = 0;
  while (true) {
    try {
      await fs.access(path.join(dataFolder, candidate));
      counter++;
      candidate = `${base}_${counter}`;
    } catch {
      return candidate;
    }
  }
}

async function saveData(req: Request): Promise<Response> {
  const data = await req.json().catch(() => null);
  if (!isUploadRequest(data)) {
    return Response.json({ status: 400, message: 'Invalid upload request' }, { status: 400 });
  }

  try {
    let targetDir = data.sessionId;

    // If _uploadId differs from sessionId and its folder exists, rename it
    if (data._uploadId && data._uploadId !== data.sessionId) {
      const uploadIdDir = path.join(dataFolder, data._uploadId);
      try {
        await fs.access(uploadIdDir);
        // Folder from eager uploads exists; rename to final sessionId with collision avoidance
        const uniqueName = await getUniqueDirName(data.sessionId);
        await fs.rename(uploadIdDir, path.join(dataFolder, uniqueName));
        targetDir = uniqueName;
      } catch {
        // No eager upload folder — use sessionId directly with collision avoidance
        targetDir = await getUniqueDirName(data.sessionId);
      }
    }

    const dataDir = path.join(dataFolder, targetDir);
    await fs.mkdir(dataDir, { recursive: true });

    await Promise.all(
      data.files.map((file) =>
        Bun.write(
          path.join(dataDir, file.filename),
          file.encoding === 'base64' ? Buffer.from(file.content, 'base64') : file.content,
        ),
      ),
    );

    return Response.json({ status: 200, message: 'Files saved successfully' });
  } catch (error) {
    console.error('Error saving files:', error);
    return Response.json({ status: 500, message: 'Error saving files' }, { status: 500 });
  }
}

export const api = {
  // your routes below this line ------------

  '/backend/data': { POST: saveData },

  // ---------
};

if (import.meta.main) {
  const server = Bun.serve({
    port: PORT,
    routes: { ...api, '/': index, '/settings': index },
    // Anything else is served from public/
    async fetch(req) {
      const file = Bun.file(path.join(publicFolder, new URL(req.url).pathname));
      return (await file.exists()) ? new Response(file) : new Response('Not Found', { status: 404 });
    },
    development: process.env.NODE_ENV !== 'production',
  });

  console.log(`Server running at ${server.url}`);
}
