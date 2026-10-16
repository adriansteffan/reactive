import path from 'path';
import { uploadRoutes } from '@adriansteffan/reactive/server';
import index from './index.html';

const dataFolder = path.join(import.meta.dir, 'data');
const publicFolder = path.join(import.meta.dir, 'public');

const PORT = Number(process.env.PORT ?? 8001);

export const api = {
  ...uploadRoutes(dataFolder),

  // your routes below this line ------------

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
