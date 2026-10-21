import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import { APP_VERSION, APP_VERSION_DATE } from './src/modules/version.js';

// package.json has "type": "module", so this file is ESM — no __dirname
// global, has to be derived from import.meta.url instead.
const __dirname = dirname(fileURLToPath(import.meta.url));

// Multi-page build: index.html (the main app) + admin.html (the Developer
// Panel). Vite only bundles index.html by default; this makes `vite build`
// emit both. (live-catalog.html was removed in v3.19.0.)
// Every build gets its own BUILD_ID (the Vercel commit, else a timestamp),
// so a deploy is noticed even when APP_VERSION wasn't bumped. The bundle
// reads it as __BUILD_ID__ (define below).
const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || `local-${Date.now()}`;

// Writes dist/version.json from src/modules/version.js on every build, so
// a running copy of the app can tell when the server has a newer one
// (src/platform/app-update.js). Never edit it by hand.
function versionFile(){
  return {
    name: 'version-file',
    generateBundle(){
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ version: APP_VERSION, date: APP_VERSION_DATE, buildId: BUILD_ID }),
      });
    },
  };
}

export default defineConfig({
  plugins: [versionFile()],
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html'),
      },
    },
  },
});
