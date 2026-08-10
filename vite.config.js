import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

// package.json has "type": "module", so this file is ESM — no __dirname
// global, has to be derived from import.meta.url instead.
const __dirname = dirname(fileURLToPath(import.meta.url));

// Multi-page build: index.html (the main app) + live-catalog.html (the
// live-selling quick-add tool, added 2026-08-10) — Vite only bundles
// index.html by default, this makes `vite build` emit both.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        liveCatalog: resolve(__dirname, 'live-catalog.html'),
      },
    },
  },
});
