import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

// package.json has "type": "module", so this file is ESM — no __dirname
// global, has to be derived from import.meta.url instead.
const __dirname = dirname(fileURLToPath(import.meta.url));

// Multi-page build: index.html (the main app) + admin.html (the Developer
// Panel). Vite only bundles index.html by default; this makes `vite build`
// emit both. (live-catalog.html was removed in v3.19.0.)
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html'),
      },
    },
  },
});
