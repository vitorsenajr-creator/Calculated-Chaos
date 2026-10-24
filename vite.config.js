import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import { APP_VERSION, APP_VERSION_DATE } from './src/modules/version.js';

// package.json has "type": "module", so this file is ESM — no __dirname
// global, has to be derived from import.meta.url instead.
const __dirname = dirname(fileURLToPath(import.meta.url));

// Multi-page build: index.html (the welcome page, served at /), app.html (the
// app, served at /app) and admin.html (the Developer Panel). Vite only bundles index.html by default; this makes `vite build`
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

// Vercel serves /privacy and /terms through rewrites (vercel.json); this does
// the same for `vite dev` and `vite preview`, which would otherwise answer
// with index.html.
const LEGAL_PAGES = { '/privacy': '/privacy.html', '/terms': '/terms.html' };
function legalPages(){
  const rewrite = (req, res, next) => {
    const path = (req.url || '').split('?')[0].replace(/\/$/, '');
    if (LEGAL_PAGES[path]) req.url = LEGAL_PAGES[path];
    next();
  };
  return {
    name: 'legal-pages',
    configureServer(server){ server.middlewares.use(rewrite); },
    configurePreviewServer(server){ server.middlewares.use(rewrite); },
  };
}

export default defineConfig({
  plugins: [versionFile(), legalPages()],
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        app: resolve(__dirname, 'app.html'),
        admin: resolve(__dirname, 'admin.html'),
        privacy: resolve(__dirname, 'privacy.html'),
        terms: resolve(__dirname, 'terms.html'),
      },
    },
  },
});
