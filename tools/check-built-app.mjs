/*
 * check-built-app.mjs - the fast check that runs before the slower suites.
 *
 *   npm run check
 *
 * WHAT IT PROVES
 * --------------
 *  1. The SOURCES are still safe to build: src/ stays ASCII-only. These files are rewritten
 *     by PowerShell during development and non-ASCII characters do not survive that round
 *     trip; the symptom used to be mojibake in a delivered report.
 *  2. The BUILT artefact is the shape the deployment depends on: a small shell that names
 *     content-hashed assets, both assets present, `_headers` granting them immutable caching,
 *     and no application code inline in the HTML.
 *
 * (2) is the guard that keeps the measured win from quietly regressing. The whole point of
 * the split is that a repeat visit re-downloads only the shell; if code ever ends up inline
 * again, the page is back to 188 KB of re-downloaded bytes and nothing else would notice.
 *
 * Syntax checking itself is now Vite's job - `npm run build` fails on a bad JSX file, which
 * is earlier and stricter than parsing an inline script ever was.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

let problems = 0;
const fail = (message) => {
  problems += 1;
  console.error('  RALAT: ' + message);
};

/* ---------- 1. sources stay ASCII-only ---------- */

console.log('== Sumber ==');

const srcDir = join(root, 'src');
const walk = (dir) => readdirSync(dir, { recursive: true })
  .map((p) => String(p).replace(/\\/g, '/'))
  .filter((p) => statSync(join(dir, p)).isFile());

const sources = ['src/parser.mjs', ...walk(srcDir).map((p) => `src/${p}`)]
  .filter((p, i, all) => all.indexOf(p) === i)
  .filter((p) => existsSync(join(root, p)));

let asciiChecked = 0;
for (const rel of sources) {
  const text = readFileSync(join(root, rel), 'utf8');
  const bad = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) > 127) bad.push(i);
  }
  if (bad.length) {
    const where = bad.slice(0, 3).map((i) => `offset ${i} (${JSON.stringify(text.slice(i, i + 10))})`);
    fail(`${rel} mengandungi ${bad.length} aksara bukan ASCII: ${where.join(', ')}. `
      + 'Gunakan "-" dan \\uXXXX, bukan aksara terus.');
  }
  asciiChecked += 1;
}
if (!problems) console.log(`  OK: ${asciiChecked} fail sumber adalah ASCII.`);

/* ---------- 2. the built artefact is split, and cacheable ---------- */

console.log('== Binaan yang di-deploy ==');

const publicDir = join(root, 'public');
const shellPath = join(publicDir, 'index.html');
if (!existsSync(shellPath)) {
  fail('public/index.html tiada. Jalankan "npm run build" dahulu.');
} else {
  const shell = readFileSync(shellPath, 'utf8');
  const shellBytes = readFileSync(shellPath).length;
  const markup = shell.replace(/<!--[\s\S]*?-->/g, '');

  const js = (markup.match(/assets\/(app\.[A-Za-z0-9_-]{6,}\.js)/) || [])[1];
  const css = (markup.match(/assets\/(app\.[A-Za-z0-9_-]{6,}\.css)/) || [])[1];

  if (!js) fail('cangkerang tidak merujuk fail JS berhash.');
  if (!css) fail('cangkerang tidak merujuk fail CSS berhash.');
  for (const name of [js, css]) {
    if (name && !existsSync(join(publicDir, 'assets', name))) fail(`aset hilang: assets/${name}`);
  }
  if (/<style>|<script>/.test(markup)) {
    fail('kod masih sebaris dalam public/index.html - muatan tidak dipecahkan.');
  }
  if (shellBytes > 8000) {
    fail(`cangkerang ${shellBytes} bait - terlalu besar untuk cangkerang kosong.`);
  }
  if (!markup.includes('id="root"')) fail('cangkerang kehilangan <div id="root">.');

  const headersPath = join(publicDir, '_headers');
  if (!existsSync(headersPath)) {
    fail('public/_headers tiada - aset berhash tidak akan dicache selama-lamanya.');
  } else if (!/immutable/.test(readFileSync(headersPath, 'utf8'))) {
    fail('_headers tiada arahan "immutable" untuk /assets/*.');
  }

  const published = readdirSync(publicDir, { recursive: true })
    .map((p) => String(p).replace(/\\/g, '/'))
    .filter((p) => statSync(join(publicDir, p)).isFile())
    .sort();
  const unexpected = published.filter((p) => p !== 'index.html' && p !== '_headers'
    && !/^assets\/app\.[A-Za-z0-9_-]{6,}\.(js|css)$/.test(p));
  if (unexpected.length) fail(`fail tidak dijangka dalam public/: ${unexpected.join(', ')}`);

  if (!problems) {
    console.log(`  OK: cangkerang ${shellBytes} bait + ${js} + ${css}, dicache immutable.`);
  }
}

/* ---------- verdict ---------- */

if (problems) {
  console.error(`\nGAGAL - ${problems} masalah.`);
  process.exit(1);
}
console.log('\nLULUS - sumber dan binaan berada dalam keadaan yang dijangka.');
