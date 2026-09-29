/*
 * shot-assign.mjs - build a page that loads the real fixtures so the manual
 * Bahagian panel is populated, for documentation screenshots.
 *
 *   node tools/shot-assign.mjs
 *   (then screenshot dist/assign-shot.html)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { APP_FILENAME } from './artifacts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const dist = join(root, 'dist');

const app = readFileSync(join(dist, APP_FILENAME), 'utf8');
const b64 = (p) => Buffer.from(readFileSync(join(root, 'fixture', p), 'utf8'), 'utf8').toString('base64');

const A = 'Senarai_Aset_Belum_Periksa_ABR_JKM.xls';
const B = 'Senarai_Aset_Belum_Periksa_HM_JKM.xls';
for (const f of [A, B]) {
  if (!existsSync(join(root, 'fixture', f))) {
    console.error('fail ujian tidak dijumpai: fixture/' + f);
    process.exit(2);
  }
}

/* The closing script tag is split so this file's own text cannot terminate the
   injected block early - the same trap that silently broke an earlier harness. */
const openScript = '<' + 'script>';
const closeScript = '</' + 'scr' + 'ipt>';

const inject = `
${openScript}
(function () {
  var H = window.__uiHarness__;
  var decode = function (b) {
    return new TextDecoder().decode(Uint8Array.from(atob(b), function (c) { return c.charCodeAt(0); }));
  };
  H.clearAssignments();
  H.clearHistory();
  H.loadFiles([
    { name: ${JSON.stringify(A)}, text: decode("${b64(A)}") },
    { name: ${JSON.stringify(B)}, text: decode("${b64(B)}") }
  ]);
  // Wait for the async load, then open the assignment panel for the screenshot.
  var tries = 0;
  var timer = setInterval(function () {
    tries += 1;
    if (H.snapshot().merged > 0 || tries > 60) {
      clearInterval(timer);
      var p = document.getElementById('panelAssign');
      // Leave scrolling alone and let a tall capture window show the page from the
      // top; scrolling here historically produced an empty screenshot.
      if (p) p.hidden = false;
    }
  }, 150);
})();
${closeScript}
`;

const idx = app.lastIndexOf('</body>');
const out = join(dist, 'assign-shot.html');
writeFileSync(out, app.slice(0, idx) + inject + app.slice(idx), 'utf8');
console.log('halaman ditulis: ' + out);
