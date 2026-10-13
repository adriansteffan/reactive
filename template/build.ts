// Bundles the experiment for production: dist/ for Capacitor, dist-server/ for the Docker image
import fs from 'fs';
import tailwind from 'bun-plugin-tailwind';
import publicDir from '@adriansteffan/reactive/bun-plugin';

const options = {
  minify: true,
  env: 'PUBLIC_*' as const,
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [tailwind, publicDir],
};

fs.rmSync('dist', { recursive: true, force: true });
fs.rmSync('dist-server', { recursive: true, force: true });

await Bun.build({ ...options, entrypoints: ['./index.html'], outdir: 'dist' });
fs.cpSync('public', 'dist', { recursive: true });

// The server bundle includes the frontend, so the image needs no node_modules
await Bun.build({ ...options, entrypoints: ['./server.ts'], target: 'bun', outdir: 'dist-server' });
