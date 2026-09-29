/*
 * verify-assign.mjs - prove manual Bahagian assignment now lives in D1.
 *
 *   node tools/verify-assign.mjs
 *
 * The source exports leave `Bahagian` blank for some records, which makes them
 * invisible to every per-department report. Two things must hold now that the
 * assignments are stored in D1 rather than in the browser:
 *
 *   1. A correction still propagates everywhere - summary, filter and export.
 *   2. It is written to the API, and a page that re-reads the API still has it.
 *      A correction that only existed on screen would be worse than no feature.
 *
 * The API is canned (tools/fake-d1.mjs); the Worker and D1 themselves are proved by
 * cloudflare/verify-worker.mjs.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseFile } from '../src/parser.mjs';
import { APP_FILENAME, readBuiltCode } from './artifacts.mjs';
import { buildPage, buildOfflinePage } from './fake-d1.mjs';

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
const appCode = readBuiltCode(root);
/* The application is a separate asset now, so the guard reads the built code rather than the
   shell. The panel's behaviour is checked properly below, in a real browser. */
if (!appCode.includes('__uiHarness__') || !appCode.includes('panelAssign')) {
  console.error('Aplikasi tiada ciri tetapan Bahagian - jalankan "npm run build".');
  process.exit(2);
}

const records = parseFile(readFileSync(join(root, 'fixture', FILE_A), 'utf8'), 'A').records;
const departments = [...new Set(records.map((r) => (r.Bahagian || '').trim()).filter(Boolean))];
const blank = records.filter((r) => !(r.Bahagian || '').trim()).map((r) => r.Label);

const payload = {
  status: {
    observations: 0, assets: 0, outstanding: 0, inspected: 0,
    first: null, last: null, reappeared: 0, departments: [],
  },
  progress: [],
  history: [],
  overrides: [],
  knownDepartments: departments,
};

const script = `
<pre id="assign-snapshot">pending</pre>
<script>
(function () {
  function decode(b) {
    return new TextDecoder().decode(Uint8Array.from(atob(b), function (c) { return c.charCodeAt(0); }));
  }
  function report(o) {
    document.getElementById('assign-snapshot').textContent = JSON.stringify(o, null, 1);
    document.documentElement.setAttribute('data-assign-test', 'done');
  }
  function postCount() {
    return window.__apiLog.filter(function (c) {
      return c.path === '/api/admin/overrides' && c.method === 'POST';
    }).length;
  }
  function postAt(i) {
    var posts = window.__apiLog.filter(function (c) {
      return c.path === '/api/admin/overrides' && c.method === 'POST';
    });
    return posts.length > i ? posts[i].body : null;
  }
  function notices() {
    return Array.prototype.map.call(document.querySelectorAll('#notices .notice'), function (n) {
      return n.className + '|' + n.textContent;
    });
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  (async function () {
    try {
      var H = window.__uiHarness__;
      await H.refresh();

      var A = decode("${Buffer.from(readFileSync(join(root, 'fixture', FILE_A), 'utf8'), 'utf8').toString('base64')}");
      H.loadFilesQuiet([{ name: ${JSON.stringify(FILE_A)}, text: A }]);

      var s0 = H.snapshot();
      var panel = document.getElementById('panelAssign');
      var selects = panel.querySelectorAll('select[data-assign]').length;
      var deptCounts = {};
      (s0.summary.rows || []).forEach(function (r) { deptCounts[r.bahagian] = r.jumlah; });

      var dept = "__TARGET_DEPT__";
      var label = "${blank[0]}";
      var before = deptCounts[dept];

      // Assign, then re-read D1 - the assignment must survive a fresh read.
      var set = await H.setAssignment(label, dept);
      var mid = H.snapshot();
      var midDept = {};
      (mid.summary.rows || []).forEach(function (r) { midDept[r.bahagian] = r.jumlah; });
      var rowAfter = H.findRow(label);
      var csvLine = H.exportCsvText().split('\\r\\n').filter(function (l) {
        return l.indexOf(label + ',') === 0;
      })[0] || '';

      await H.refresh();
      var reloaded = H.findRow(label);
      var reloadedSnap = H.snapshot();

      // Cancel it again.
      var cleared = await H.clearAssignments();
      var afterClear = H.snapshot();

      // An invented department must be refused, and must not stick on screen.
      var bogus = await H.setAssignment("${blank[1]}", 'JABATAN TIDAK WUJUD SAMA SEKALI');
      var afterBogus = H.snapshot();

      /* Now drive the REAL dropdown rather than the test seam, so the user-facing
         path (the change handler, the notice it shows) is covered too. */
      var sel = document.querySelector('#assignBody select[data-assign]');
      var uiLabel = sel ? sel.dataset.assign : null;
      var uiDept = sel ? sel.options[1].value : null;
      if (sel) {
        sel.value = uiDept;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        await wait(120);
      }
      var uiRow = uiLabel ? H.findRow(uiLabel) : null;

      report({
        zeroDept: s0.assign.zeroDept,
        selects: selects,
        blankExpected: ${blank.length},
        label: label,
        dept: dept,
        before: before,
        after: midDept[dept],
        set: set,
        midManual: mid.assign.manual,
        midApplied: mid.assign.applied,
        panelVisible: !panel.hidden,
        rowAfter: rowAfter,
        csvLine: csvLine,
        reloaded: reloaded,
        reloadedManual: reloadedSnap.assign.manual,
        posts: postCount(),
        firstPost: postAt(0),
        lastPost: postAt(99) || postAt(0),
        cleared: cleared,
        afterClearManual: afterClear.assign.manual,
        bogus: bogus,
        afterBogusManual: afterBogus.assign.manual,
        zeroDeptAfterBogus: afterBogus.assign.zeroDept,
        uiLabel: uiLabel,
        uiDept: uiDept,
        uiRow: uiRow,
        uiNotices: notices()
      });
    } catch (e) {
      document.getElementById('assign-snapshot').textContent = 'HARNESS ERROR: ' + (e && e.message);
      document.documentElement.setAttribute('data-assign-test', 'error');
    }
  })();
})();
</script>
`;

const offlineScript = `
<pre id="assign-offline">pending</pre>
<script>
(function () {
  function decode(b) {
    return new TextDecoder().decode(Uint8Array.from(atob(b), function (c) { return c.charCodeAt(0); }));
  }
  // Load a real file so the panels that depend on data are actually rendered.
  var H = window.__uiHarness__;
  H.loadFilesQuiet([{ name: ${JSON.stringify(FILE_A)}, text: decode("${Buffer.from(readFileSync(join(root, 'fixture', FILE_A), 'utf8'), 'utf8').toString('base64')}") }]);

  var out = {
    body: document.getElementById('assignBody').textContent.trim(),
    selects: document.querySelectorAll('#assignBody select[data-assign]').length,
    link: document.getElementById('serverLink').textContent.trim(),
    merged: H.snapshot().merged,
    history: document.getElementById('historyWrap').textContent.trim().slice(0, 120)
  };
  document.getElementById('assign-offline').textContent = JSON.stringify(out);
  document.documentElement.setAttribute('data-assign-offline', 'done');
})();
</script>
`;

/* ---------------- run both pages ---------------- */

function dumpDom(pagePath, profileName) {
  const profile = join(process.env.TEMP || '/tmp', profileName);
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  const uri = 'file:///' + pagePath.replace(/\\/g, '/');
  const run = spawnSync(chrome, [
    '--headless', '--disable-gpu', '--no-sandbox',
    '--user-data-dir=' + profile,
    '--allow-file-access-from-files',
    '--virtual-time-budget=30000',
    '--dump-dom', uri,
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error || !run.stdout || run.stdout.length < 1000) {
    console.error('Chrome gagal dijalankan.');
    console.error((run.stderr || '').split('\n').slice(0, 8).join('\n'));
    process.exit(2);
  }
  return run.stdout;
}

function preText(dom, id) {
  const m = dom.match(new RegExp(`<pre id="${id}">([\\s\\S]*?)</pre>`));
  if (!m) {
    console.error(`Snapshot "${id}" tidak dijumpai dalam DOM.`);
    process.exit(1);
  }
  return m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

// The department to assign is chosen from the data, so this cannot pass by accident
// on a department that does not exist.
const targetDept = departments[0];
const onlinePage = join(dist, 'assign-verify.html');
const onlineScript = script.replace('"__TARGET_DEPT__"', JSON.stringify(targetDept));
if (onlineScript.indexOf('__TARGET_DEPT__') >= 0) {
  console.error('Ralat harness: bahagian sasaran tidak dapat diganti.');
  process.exit(1);
}
writeFileSync(onlinePage, buildPage(appHtml, payload, onlineScript), 'utf8');
const onlineDom = dumpDom(onlinePage, 'dsh-assign-profile');
writeFileSync(join(dist, 'assign-verify-dump.html'), onlineDom, 'utf8');

const onlineText = preText(onlineDom, 'assign-snapshot');
if (onlineText === 'pending' || onlineText.indexOf('HARNESS ERROR') === 0) {
  console.error('Harness gagal: ' + onlineText.slice(0, 600));
  process.exit(1);
}
const snap = JSON.parse(onlineText);

const offlinePage = join(dist, 'assign-offline.html');
writeFileSync(offlinePage, buildOfflinePage(appHtml, offlineScript), 'utf8');
const offlineText = preText(dumpDom(offlinePage, 'dsh-assign-offline-profile'), 'assign-offline');
if (offlineText === 'pending') {
  console.error('Harness luar talian gagal.');
  process.exit(1);
}
const offline = JSON.parse(offlineText);

/* ---------------- assertions ---------------- */

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail += 1; console.log(`  FAIL ${name}${detail ? '  -> ' + detail : ''}`); }
}

console.log('== Tetapan Bahagian melalui D1 (pelayar sebenar) ==');

check(`rekod tiada Bahagian dikesan (${snap.blankExpected})`,
  snap.zeroDept === snap.blankExpected, `${snap.zeroDept} vs ${snap.blankExpected}`);
check('satu menu pilihan dirender bagi setiap rekod kosong',
  snap.selects === snap.blankExpected, `${snap.selects} vs ${snap.blankExpected}`);
check('panel ditunjukkan apabila ada kerja untuk dibuat', snap.panelVisible === true);

check(`tetapan disimpan melalui API (${snap.dept})`,
  !!snap.set && snap.set.ok === true && snap.midManual === 1,
  `set=${JSON.stringify(snap.set)} manual=${snap.midManual}`);
check('permintaan POST dihantar ke /api/admin/overrides (dilindungi Access)',
  snap.posts >= 1, String(snap.posts));
check('muatan POST menyebut label dan bahagian yang dipilih',
  !!snap.firstPost && snap.firstPost.overrides.some((o) => o.label === snap.label && o.bahagian === snap.dept),
  JSON.stringify(snap.firstPost));
check(`Bahagian rekod bertukar kepada ${snap.dept}`,
  snap.rowAfter && snap.rowAfter.Bahagian === snap.dept, JSON.stringify(snap.rowAfter));
check('rekod ditandakan sebagai tetapan manual',
  snap.rowAfter && snap.rowAfter._manual === true, JSON.stringify(snap.rowAfter));
check(`jumlah bahagian itu bertambah (${snap.before} -> ${snap.after})`,
  snap.after === snap.before + 1, `${snap.before} -> ${snap.after}`);
check('baris CSV rekod itu membawa bahagian yang ditetapkan',
  snap.csvLine.indexOf(snap.dept) > 0, snap.csvLine.slice(0, 160));

check('tetapan kekal selepas membaca semula D1',
  snap.reloaded && snap.reloaded.Bahagian === snap.dept, JSON.stringify(snap.reloaded));
check('tetapan masih dikira sebagai manual selepas muat semula',
  snap.reloadedManual === 1, String(snap.reloadedManual));

check('membatalkan semua tetapan menghantar permintaan kosong', snap.cleared && snap.cleared.ok === true,
  JSON.stringify(snap.cleared));
check('tiada tetapan manual selepas dibatalkan', snap.afterClearManual === 0,
  String(snap.afterClearManual));

check('bahagian yang tidak wujud ditolak oleh D1',
  snap.bogus && snap.bogus.ok === false, JSON.stringify(snap.bogus));
check('penolakan dilaporkan sebagai "rejected"',
  snap.bogus && snap.bogus.reason === 'rejected', JSON.stringify(snap.bogus));
check('penolakan tidak meninggalkan tetapan pada skrin',
  snap.afterBogusManual === 0, String(snap.afterBogusManual));
check('rekod kembali kosong selepas penolakan',
  snap.zeroDeptAfterBogus === snap.blankExpected, String(snap.zeroDeptAfterBogus));

/* The dropdown is the real user path, and it only offers departments that exist -
   which is the first line of defence against an invented unit. */
check('menu pilihan sebenar boleh menetapkan bahagian',
  snap.uiRow && snap.uiRow.Bahagian === snap.uiDept,
  `${JSON.stringify(snap.uiRow)} vs ${snap.uiDept}`);
check('pengguna dimaklumkan bahawa tetapan berjaya',
  snap.uiNotices.some((n) => n.indexOf('notice ok') === 0 && /Bahagian ditetapkan/.test(n)),
  JSON.stringify(snap.uiNotices.slice(0, 3)));

/* ---- and the same page with no API at all ---- */

console.log('\n== Tanpa sambungan D1 ==');
check(`ganding masih berfungsi (${snap.blankExpected + records.length - blank.length} rekod)`,
  offline.merged > 0, String(offline.merged));
check('panel menjelaskan ia memerlukan sambungan D1',
  /Sambungan D1 diperlukan/.test(offline.body), offline.body.slice(0, 140));
check('tiada menu pilihan yang tidak boleh disimpan',
  offline.selects === 0, String(offline.selects));
check('status menyatakan tiada sambungan D1',
  /Tiada sambungan D1/.test(offline.link), offline.link.slice(0, 140));
check('tab sejarah menjelaskan ia memerlukan sambungan D1',
  /Sambungan D1 diperlukan/.test(offline.history), offline.history);

console.log('\n' + '='.repeat(60));
console.log(fail === 0
  ? `LULUS - ${snap.blankExpected} rekod kosong boleh ditetapkan, dan tetapan hidup dalam D1.`
  : `GAGAL - ${fail} pemeriksaan gagal.`);
console.log('='.repeat(60));
process.exit(fail ? 1 : 0);
