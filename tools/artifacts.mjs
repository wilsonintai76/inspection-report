/*
 * artifacts.mjs - the generated filenames, in one place.
 *
 * Both the build script and every verification tool import these. Previously each
 * tool hard-coded the deliverable's name, which meant a rename could leave a tool
 * reading a stale file that still happened to exist on disk - passing while
 * checking the wrong artifact.
 *
 * This module must stay importable with NO side effects, so it cannot live in
 * build-app.mjs (which builds on import).
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** The page a user opens, deployed and on disk alike. */
export const APP_FILENAME = 'Laporan_Aset_Belum_Diperiksa_PKS.html';

/** Report label shown in build output and printed in the app's header. */
export const APP_TITLE = 'Laporan Aset Yang Belum Diperiksa - PKS';

/**
 * The shell plus every asset it loads, concatenated.
 *
 * The build no longer inlines the application into the HTML, so a check that greps the
 * built PAGE for a string would silently find nothing - and pass. Anything asserting about
 * the application's own code has to read the code, wherever it lives.
 */
export function readBuiltCode(root = resolve(here, '..')) {
  const page = join(root, 'dist', APP_FILENAME);
  if (!existsSync(page)) {
    throw new Error(`Artefak binaan tiada: ${page}. Jalankan "npm run build".`);
  }
  const shell = readFileSync(page, 'utf8');
  const assetsDir = join(root, 'dist', 'assets');
  const assets = existsSync(assetsDir)
    ? readdirSync(assetsDir)
      .filter((f) => f.endsWith('.js') || f.endsWith('.css'))
      .sort()
      .map((f) => readFileSync(join(assetsDir, f), 'utf8'))
    : [];
  return [shell, ...assets].join('\n');
}

