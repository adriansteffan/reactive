// config shared between the electron and non electron part of vite
import react from '@vitejs/plugin-react'
import topLevelAwait from 'vite-plugin-top-level-await';


export const sharedConfig = {
    plugins: [react(),topLevelAwait({
      // The export name of top-level await promise for each chunk module
      promiseExportName: '__tla',
      // The function to generate import names of top-level await promise in each chunk module
      promiseImportName: (i) => `__tla_${i}`,
    }),],
    server: {
      proxy: {
        '/backend': {
          target: 'http://localhost:8001',
          changeOrigin: true,
        }
      }
    }
  };