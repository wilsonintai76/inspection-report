/*
 * build-app.mjs - builds everything that gets used.
 *
 *   npm run build
 *
 * Produces:
 *   public/index.html                     the shell the Worker serves
 *   public/assets/app.<hash>.{js,css}     the application, cacheable forever
 *   public/_headers                       the rule that says so
 *   dist/Laporan_Aset_Belum_Diperiksa_PKS.html + dist/assets/*
 *                                         the same artefacts, for the browser suites and
 *                                         for opening straight from disk
 *
 * ONE SHAPE, TWO PLACES
 * ---------------------
 * The deployed page is split, because that is what makes a repeat visit cheap: measured on
 * the live deployment, the old single 188 KB file was served with no ETag and `max-age=0`,
 * so the browser re-downloaded all of it on every visit.
 *
 * `dist/` gets exactly the same shape rather than a bundled-up copy of it, so the suites
 * exercise what actually ships. `vite build` does the bundling; this file normalises the
 * script tag, checks what was published, and mirrors it.
 */
import { copyFileSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { APP_FILENAME } from './artifacts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const dist = join(root, 'dist');
const publicDir = join(root, 'public');

/* ---------- 1. bundle with Vite (root: src/, outDir: public/) ---------- */

console.log('Membina dengan Vite...');
execFileSync(process.execPath, [
  join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build',
  '--config', join(root, 'vite.config.mjs'),
], { cwd: root, stdio: 'inherit' });

/* ---------- 2. check what landed in public/ ---------- */

const shellPath = join(publicDir, 'index.html');
if (!statSync(shellPath).isFile()) {
  throw new Error('Ralat binaan: Vite tidak menghasilkan public/index.html.');
}

const publicFiles = readdirSync(publicDir, { recursive: true })
  .map((p) => String(p).replace(/\\/g, '/'))
  .filter((p) => statSync(join(publicDir, p)).isFile())
  .sort();

// Only the shell, the immutable assets and the header rules may be published. `dist/` holds
// temporary pages written by the verification tools - several embed the real source files -
// so anything unexpected here is a leak, not a feature.
const unexpected = publicFiles.filter((p) => p !== 'index.html' && p !== '_headers'
  && !/^assets\/app\.[A-Za-z0-9_-]{6,}\.(js|css)$/.test(p));
if (unexpected.length) {
  throw new Error(`Ralat binaan: fail tidak dijangka dalam public/: ${unexpected.join(', ')}`);
}

const shellRaw = readFileSync(shellPath, 'utf8');

/*
 * Comments come out FIRST, and before any tag surgery.
 *
 * The shell documents itself, and that documentation mentions the words "<script>" and
 * "<style>". String-searching for a tag without removing the prose first finds the PROSE -
 * which is how an earlier version of this file managed to delete <div id="root">, along with
 * everything else between a comment and the end of the body.
 */
const stripComments = (html) => html.replace(/<!--[\s\S]*?-->/g, '');
const shellBase = stripComments(shellRaw);

if (/<style>|<script>/.test(shellBase)) {
  throw new Error('Ralat binaan: kod masih sebaris dalam cangkerang.');
}

const jsMatch = shellBase.match(/assets\/(app\.[A-Za-z0-9_-]{6,}\.js)/);
const cssMatch = shellBase.match(/assets\/(app\.[A-Za-z0-9_-]{6,}\.css)/);
if (!jsMatch || !cssMatch) {
  throw new Error('Ralat binaan: cangkerang tidak merujuk aset JS dan CSS berhash.');
}
if (!readFileSync(join(publicDir, '_headers'), 'utf8').includes('immutable')) {
  throw new Error('Ralat binaan: public/_headers tiada arahan "immutable" untuk /assets/*.');
}

/* ---------- 3. mirror the same shape into dist/ ---------- */

/*
 * dist/ gets the SAME artefact as the deployment: the shell plus its hashed assets beside
 * it. It used to be one self-contained file with the bundle inlined, and that turned out to
 * be a trap - React's own source contains the strings "<!--" and "<script>", so an inlined
 * bundle puts the HTML parser into its escaped states and the closing tag stops closing.
 *
 * Keeping the shape identical is also more honest: the browser suites load what is
 * shipped, not a differently-assembled copy of it. The script tag is classic and sits at the
 * end of <body>, so a harness appended after it still runs last.
 */
function dropScriptTag(html) {
  const openAt = html.search(/<script[\s>]/);
  const closeAt = html.indexOf('</script>', openAt);
  if (openAt < 0 || closeAt < 0) {
    throw new Error('Ralat binaan: tag <script> tidak dijumpai dalam cangkerang.');
  }
  return html.slice(0, openAt) + html.slice(closeAt + '</script>'.length);
}

const shell = dropScriptTag(shellBase)
  .replace('</body>', `  <script src="assets/${jsMatch[1]}"></script>\n</body>`);
writeFileSync(shellPath, shell, 'utf8');

if (!shell.includes('id="root"') || !shell.includes(`assets/${jsMatch[1]}`)) {
  throw new Error('Ralat binaan: cangkerang tidak lengkap (root atau skrip hilang).');
}

// Wiped first: every build produces new hashes, and leaving the previous ones behind makes
// it impossible to tell which asset the shipped page actually names.
mkdirSync(dist, { recursive: true });
rmSync(join(dist, 'assets'), { recursive: true, force: true });
mkdirSync(join(dist, 'assets'), { recursive: true });
const appOut = join(dist, APP_FILENAME);
writeFileSync(appOut, shell, 'utf8');
copyFileSync(join(publicDir, 'assets', jsMatch[1]), join(dist, 'assets', jsMatch[1]));
copyFileSync(join(publicDir, 'assets', cssMatch[1]), join(dist, 'assets', cssMatch[1]));

// The standalone file used to carry an embedded-fixture self-test. It is gone: the browser
// suites drive far more of the application than it did, with controlled data, and `npm test`
// covers the parser against the real exports.
rmSync(join(dist, 'selftest.html'), { force: true });

/* ---------- report ---------- */

const kb = (p) => `${(readFileSync(p).length / 1024).toFixed(1)} KB`;
console.log('\nBinaan selesai:');
console.log(`  ${shellPath}  (${kb(shellPath)})  cangkerang yang di-deploy`);
console.log(`  ${join(publicDir, 'assets', jsMatch[1])}  (${kb(join(publicDir, 'assets', jsMatch[1]))})  immutable`);
console.log(`  ${join(publicDir, 'assets', cssMatch[1])}  (${kb(join(publicDir, 'assets', cssMatch[1]))})  immutable`);
console.log(`  ${appOut}  (${kb(appOut)})  bentuk yang sama, untuk suite dan untuk cakera`);
console.log('  Lawatan ulangan memuat turun cangkerang sahaja: aset berhash dicache selama-lamanya.');
