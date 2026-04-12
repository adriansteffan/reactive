// Loader hooks for handling Vite's ?raw import suffix in Node.
// Strips ?raw from specifiers and returns file contents as string exports.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const RAW_PATTERN = /\?raw$/;
const RAW_EXTENSIONS = ['.csv', '.txt', '.svg', '.glsl', '.md'];

export function resolve(specifier, context, nextResolve) {
  if (RAW_PATTERN.test(specifier)) {
    return nextResolve(specifier.replace(RAW_PATTERN, ''), context);
  }
  return nextResolve(specifier, context);
}

export function load(url, context, nextLoad) {
  try {
    const path = fileURLToPath(url);
    if (RAW_EXTENSIONS.some(ext => path.endsWith(ext))) {
      const content = readFileSync(path, 'utf8');
      return { format: 'module', source: `export default ${JSON.stringify(content)};`, shortCircuit: true };
    }
  } catch { /* not a file URL, pass through */ }
  return nextLoad(url, context);
}
