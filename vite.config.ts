import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import tailwindcssPostcss from '@tailwindcss/postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
//@ts-ignore
export default defineConfig(() => {
  return {
    plugins: [
      react(),
      dts({ include: ['src'] , rollupTypes: true}),
      viteStaticCopy({
        targets: [
          {
            src: 'src/index.css',
            dest: '.',
            rename: 'preset.css',
          },
        ],
      }),
    ],
    css: {
      postcss: {
        plugins: [tailwindcssPostcss, autoprefixer],
      },
    },
    build: {
      lib: {
        entry: resolve(__dirname, 'src/mod.tsx'),
        name: 'MyLibrary',
        formats: ['es', 'umd'],
        fileName: (format: string) => `reactive.${format}.js`,
      },
      rollupOptions: {
        external: ['react', 'react-dom'],
        output: {
          globals: {
            react: 'React',
            'react-dom': 'ReactDOM',
          },
        },
      },
    },
  };
});
