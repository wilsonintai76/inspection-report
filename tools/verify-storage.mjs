/*
 * verify-storage.mjs - prove the page keeps NOTHING in the browser.
 *
 *   node tools/verify-storage.mjs
 *
 * Records live in D1, so browser storage was removed. Removal is the kind of change
 * that silently comes back - one convenience call to localStorage and the app is
 * storing a second, invisible copy of the data again, disagreeing with D1.
 *
 * Three independent checks:
 *   1. The built page contains no localStorage access at all.
 *   2. Loading and merging files writes no key into browser storage.
 *   3. Opening the page AGAIN with the same browser profile restores nothing, which
 *      is what the old autosave used to do.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { APP_FILENAME, readBuiltCode } from './artifacts.mjs';
import { buildOfflinePage } from './fake-d1.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const dist = join(root, 'dist');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
].filter(Boolean);
const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chrome) {
  console.error('Chrome/Edge tidak dijumpai. Tetapkan CHROME_PATH.');
  process.exit(2);
}

const FILE_A = 'Senarai_Aset_Belum_Periksa_ABR_JKM.xls';
if (!existsSync(join(root, 'fixture', FILE_A))) {
  console.error(`fail ujian tidak dijumpai: fixture/${FILE_A}`);
  process.exit(2);
}

const appHtml = readFileSync(join(dist, APP_FILENAME), 'utf8');
// The application is a separate asset now, so the static checks read the whole built
// artefact - the page AND its code. Reading only the shell would make them pass by finding
// nothing at all.
const appCode = readBuiltCode(root);

/* ---------------- 1. source-level check ---------------- */

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail += 1; console.log(`  FAIL ${name}${detail ? '  -> ' + detail : ''}`); }
}

console.log('== Simpanan pelayar telah dibuang ==');

// Comments explain the removal, so only executable uses count.
const code = appCode.replace(/\/\*[\s\S]*?\*\//g, '');
const storageHits = code.match(/localStorage|sessionStorage|indexedDB|openDatabase/g) || [];
check('tiada akses storan pelayar dalam halaman yang dibina',
  storageHits.length === 0, storageHits.join(', '));
check('tiada panel "Data tersimpan" yang menipu',
  !/id="panelSaved"/.test(appCode) && !/btnSnapshot/.test(appCode));
check('D1 diterangkan kepada pengguna sebagai tempat simpanan',
  /dalam pangkalan data D1/.test(appCode));

/* ---------------- 2 & 3. real browser, same profile twice ---------------- */

const b64 = Buffer.from(readFileSync(join(root, 'fixture', FILE_A), 'utf8'), 'utf8').toString('base64');

const writeScript = `
<pre id="storage-snapshot">pending</pre>
<script>
(function () {
  function decode(b) {
    return new TextDecoder().decode(Uint8Array.from(atob(b), function (c) { return c.charCodeAt(0); }));
  }
  var H = window.__uiHarness__;
  H.loadFilesQuiet([{ name: ${JSON.stringify(FILE_A)}, text: decode("${b64}") }]);
  var snap = H.snapshot();
  var keys = [];
  try {
    for (var i = 0; i < window.localStorage.length; i += 1) keys.push(window.localStorage.key(i));
  } catch (e) { keys.push('(localStorage tidak tersedia)'); }
  document.getElementById('storage-snapshot').textContent = JSON.stringify({
    merged: snap.merged,
    keys: keys,
    exportLength: H.exportCsvText().length
  });
})();
</script>
`;

const reopenScript = `
<pre id="storage-snapshot">pending</pre>
<script>
(function () {
  var H = window.__uiHarness__;
  var snap = H.snapshot();
  var keys = [];
  try {
    for (var i = 0; i < window.localStorage.length; i += 1) keys.push(window.localStorage.key(i));
  } catch (e) { keys.push('(localStorage tidak tersedia)'); }
  document.getElementById('storage-snapshot').textContent = JSON.stringify({
    merged: snap.merged,
    files: snap.perFile.length,
    keys: keys
  });
})();
</script>
`;

const profile = join(process.env.TEMP || '/tmp', 'dsh-storage-profile');
rmSync(profile, { recursive: true, force: true });
mkdirSync(profile, { recursive: true });

function runPage(name, harness) {
  const pagePath = join(dist, name);
  writeFileSync(pagePath, buildOfflinePage(appHtml, harness), 'utf8');
  const uri = 'file:///' + pagePath.replace(/\\/g, '/');
  const run = spawnSync(chrome, [
    '--headless', '--disable-gpu', '--no-sandbox',
    '--user-data-dir=' + profile,
    '--allow-file-access-from-files',
    '--virtual-time-budget=15000',
    '--dump-dom', uri,
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error || !run.stdout) {
    console.error('Chrome gagal dijalankan.');
    process.exit(2);
  }
  const m = run.stdout.match(/<pre id="storage-snapshot">([\s\S]*?)<\/pre>/);
  if (!m) {
    console.error(`Snapshot storan tidak dijumpai (${name}).`);
    process.exit(1);
  }
  const text = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  if (text === 'pending' || text.indexOf('HARNESS ERROR') === 0) {
    console.error(`Harness gagal (${name}): ` + text.slice(0, 300));
    process.exit(1);
  }
  return JSON.parse(text);
}

const first = runPage('storage-verify.html', writeScript);
const second = runPage('storage-reopen.html', reopenScript);

check(`menggabung masih berfungsi (${first.merged} rekod)`, first.merged === 473, String(first.merged));
check('eksport CSV masih berfungsi tanpa D1', first.exportLength > 1000, String(first.exportLength));
check('tiada kunci ditulis ke storan pelayar selepas muat naik',
  first.keys.filter((k) => k.indexOf('jkm_aset_') === 0).length === 0,
  JSON.stringify(first.keys));
check('membuka semula halaman tidak memulihkan apa-apa',
  second.merged === 0 && second.files === 0, JSON.stringify(second));
check('tiada kunci daripada sesi sebelumnya ditinggalkan',
  second.keys.filter((k) => k.indexOf('jkm_aset_') === 0).length === 0,
  JSON.stringify(second.keys));

console.log('\n' + '='.repeat(60));
console.log(fail === 0
  ? 'LULUS - halaman tidak menyimpan apa-apa dalam pelayar; D1 sahaja.'
  : `GAGAL - ${fail} pemeriksaan gagal.`);
console.log('='.repeat(60));
process.exit(fail ? 1 : 0);
