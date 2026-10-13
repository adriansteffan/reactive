import fs from 'fs';
import path from 'path';
import type { BunPlugin } from 'bun';

const root = process.cwd();

// Leaves absolute URLs that point into public/ untouched, so they are served as-is instead of bundled
const publicDir: BunPlugin = {
  name: 'reactive-public-dir',
  setup(build) {
    // Source files are excluded because Bun's dev server fails to load an entry script that a plugin was asked to resolve
    build.onResolve({ filter: /^\/(?!.*\.(?:[cm]?[jt]sx?|css|html)$)/ }, (args) => {
      // References from HTML arrive already resolved against the project root, those from CSS as written
      const url = args.path.startsWith(root + '/') ? args.path.slice(root.length) : args.path;
      if (fs.existsSync(path.join(root, 'public', url))) {
        return { path: url, external: true };
      }
    });
  },
};

export default publicDir;
