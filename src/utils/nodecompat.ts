// Creates a require() function for loading Node builtins (fs, path, etc.) at runtime.
// Needed because these files are bundled as ESM by Vite, where require doesn't exist.
// Only initialized when called (simulation time), not on import (safe in browser).
let _require: ((id: string) => any) | null = null;
export async function getNodeRequire(): Promise<(id: string) => any> {
  if (!_require) {
    const mod = await import(/* @vite-ignore */ 'module') as any;
    _require = mod.createRequire(import.meta.url);
  }
  return _require!;
}
