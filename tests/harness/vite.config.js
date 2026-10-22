// Dev server for the screenshot harness: the app as usual, except that
// src/config/firebase.js is swapped for tests/harness/firebase-stub.js.
// Run with `npm run harness`. Production builds never read this file.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const stub = readFileSync(resolve(here, 'firebase-stub.js'), 'utf8');

export default defineConfig({
  root,
  plugins: [{
    name: 'harness-firebase',
    enforce: 'pre',
    load(id){
      if (id.replace(/\\/g, '/').endsWith('/src/config/firebase.js')) return stub;
      return null;
    },
  }],
  define: { __BUILD_ID__: JSON.stringify('harness') },
  server: { port: 5180, strictPort: true, fs: { allow: [root] } },
});
