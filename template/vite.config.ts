import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
//@ts-ignore
export default defineConfig(() => {
  return {
    plugins: [react()],
  };
});