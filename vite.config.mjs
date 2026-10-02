/*
 * vite.config.mjs - builds the deployed page.
 *
 *   npm run build      (tools/build-app.mjs runs this, then the offline copy)
 *
 * WHY THIS SHAPE
 * --------------
 * The Worker serves whatever ends up in `public/`, and that output is a small shell
 * plus content-hashed assets. That is the whole point of the build: a repeat visit
 * downloads the shell and nothing else, because `_headers` can promise the browser
 * that `assets/app.<hash>.*` will never change.
 *
 *   root      src/          the React sources live together, away from dist/
 *   outDir    ../public     what the Worker publishes (wiped each build)
 *   publicDir src/static    copied verbatim - it holds `_headers`
 *   base      './'          relative URLs, so the built page also opens from disk
 *   format    iife          ONE classic script, no module semantics
 *
 * `iife` matters: the verification harnesses inject a fetch stub before the app and
 * their assertions after it, relying on document order. A `type="module"` script is
 * always deferred, which would run it after those assertions instead of between them.
 * A classic bundle has no such ambiguity, and there are no dynamic imports to split.
 */
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(here, 'src'),
  base: './',
  // The preset aliases react / react-dom to preact/compat, so the sources keep their imports.
  plugins: [preact(), tailwindcss()],
  publicDir: resolve(here, 'src', 'static'),
  build: {
    outDir: resolve(here, 'public'),
    emptyOutDir: true,
    target: 'es2020',
    cssCodeSplit: false,
    sourcemap: false,
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        format: 'iife',
        name: 'PKSApp',
        entryFileNames: 'assets/app.[hash].js',
        assetFileNames: 'assets/app.[hash][extname]',
        inlineDynamicImports: true,
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      // `npm run dev:app` talks to the real Worker API instead of a stub.
      '/api': 'https://aset-pks.wilsonintai76.workers.dev',
    },
  },
});
