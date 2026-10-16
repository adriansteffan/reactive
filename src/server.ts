// The server side of Upload: where a session's files and the recordings uploaded during it are saved
import fs from 'fs/promises';
import path from 'path';

interface ReceivedFile {
  filename: string;
  content: string;  // base64 or text content
  encoding: 'base64' | 'utf8';
}

interface UploadRequest {
  sessionId: string;
  uploadId?: string;
  parentFolder?: string;
  files: ReceivedFile[];
}

// Session ids, folder names and filenames become path segments, so they must not escape the data folder
function isPlainName(name: unknown): boolean {
  return typeof name === 'string' && name !== '' && name !== '.' && name !== '..' && path.basename(name) === name;
}

function isUploadRequest(data: Partial<UploadRequest> | null): data is UploadRequest {
  return (
    data !== null &&
    isPlainName(data.sessionId) &&
    (data.uploadId === undefined || isPlainName(data.uploadId)) &&
    (data.parentFolder === undefined || isPlainName(data.parentFolder)) &&
    Array.isArray(data.files) &&
    data.files.every(
      (file: Partial<ReceivedFile> | null) =>
        file !== null &&
        isPlainName(file.filename) &&
        typeof file.content === 'string' &&
        (file.encoding === 'base64' || file.encoding === 'utf8'),
    )
  );
}

const exists = (target: string) => fs.access(target).then(() => true, () => false);

async function getUniqueDir(parent: string, base: string): Promise<string> {
  let candidate = path.join(parent, base);
  for (let counter = 1; await exists(candidate); counter++) {
    candidate = path.join(parent, `${base}_${counter}`);
  }
  return candidate;
}

async function saveData(req: Request, dataFolder: string): Promise<Response> {
  const data = await req.json().catch(() => null);
  if (!isUploadRequest(data)) {
    return Response.json({ status: 400, message: 'Invalid upload request' }, { status: 400 });
  }

  try {
    // Recordings uploaded during the session wait in a folder named after its upload id. That folder is
    // the session's own, unless the session has another id or goes into a parent folder; then they move.
    const eagerDir = path.join(dataFolder, data.uploadId ?? data.sessionId);
    let dataDir = eagerDir;
    if (data.uploadId || data.parentFolder) {
      const parentDir = path.join(dataFolder, data.parentFolder ?? '');
      await fs.mkdir(parentDir, { recursive: true });
      dataDir = await getUniqueDir(parentDir, data.sessionId);
      if (await exists(eagerDir)) await fs.rename(eagerDir, dataDir);
    }

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

/**
 * The route that saves uploaded data in `dataFolder`, one folder per session, inside the folder
 * Upload's `parentFolder` names if it sets one. Mount it in the project's server with
 * `...uploadRoutes(dataFolder)`.
 */
export function uploadRoutes(dataFolder: string) {
  return { '/backend/data': { POST: (req: Request) => saveData(req, dataFolder) } };
}
