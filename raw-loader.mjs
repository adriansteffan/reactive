// Node loader that handles Vite's ?raw import suffix and raw file imports.
// Registers itself as a module loader hook via module.register().
import { register } from 'module';

register(new URL('./raw-loader-hooks.mjs', import.meta.url));
