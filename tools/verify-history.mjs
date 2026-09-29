/*
 * verify-history.mjs - prove the history tab renders what D1 reports.
 *
 *   node tools/verify-history.mjs
 *
 * Two fixtures (ABR 473 labels, HM 63 labels) share no labels, so two uploads of
 * them are the maximal-change case: every earlier label must be reported inspected
 * and every later label newly seen.
 *
 * The data comes from a CANNED API (tools/fake-d1.mjs) rather than from the Worker,
 * because this suite's job is the page: does it render D1's answers, and does it
 * send its own upload back? The API and SQL are proved against real SQLite by
 * cloudflare/verify-worker.mjs. The expected numbers below are computed here from
 * the real fixtures, so the tool cannot silently agree with a broken page.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseFile } from '../src/parser.mjs';
import { APP_FILENAME, readBuiltCode } from './artifacts.mjs';
import { buildPage } from './fake-d1.mjs';

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
const FILE_B = 'Senarai_Aset_Belum_Periksa_HM_JKM.xls';
for (const f of [FILE_A, FILE_B]) {
  if (!existsSync(join(root, 'fixture', f))) {
    console.error(`fail ujian tidak dijumpai: fixture/${f}`);
    process.exit(2);
  }
}

const appHtml = readFileSync(join(dist, APP_FILENAME), 'utf8');
/* The application is a separate asset now, so the guard reads the built code. The tab is
   checked in the browser below. */
const appCode = readBuiltCode(root);
if (!appCode.includes('__uiHarness__') || !appCode.includes('historyWrap')) {
  console.error('Aplikasi ini tiada tab Sejarah - jalankan "npm run build".');
  process.exit(2);
}

/* ---------------- the expected D1 contents ---------------- */

const NO_DEPT = '(TIADA BAHAGIAN)';
const strip = (recs) => recs.map((r) => ({
  Label: r.Label,
  'Jenis Aset': r['Jenis Aset'],
  'Pegawai Penempatan': r['Pegawai Penempatan'],
  Bahagian: r.Bahagian,
  'Lokasi Terkini': r['Lokasi Terkini'],
}));

const recsA = strip(parseFile(readFileSync(join(root, 'fixture', FILE_A), 'utf8'), 'A').records);
const recsB = strip(parseFile(readFileSync(join(root, 'fixture', FILE_B), 'utf8'), 'B').records);

const RUN1_AT = '2026-01-15T08:00:00Z';
const RUN2_AT = '2026-02-15T08:00:00Z';
const deptOf = (r) => (r.Bahagian || '').trim() || NO_DEPT;

/** Per-department movement from one list to the next, as the Worker computes it. */
function deptProgress(prev, cur) {
  const names = new Set([...prev.map(deptOf), ...cur.map(deptOf)]);
  const curLabels = new Set(cur.map((r) => r.Label));
  const prevLabels = new Set(prev.map((r) => r.Label));
  return [...names].map((bahagian) => {
    const awal = prev.filter((r) => deptOf(r) === bahagian).length;
    const akhir = cur.filter((r) => deptOf(r) === bahagian).length;
    const inspected = prev.filter((r) => deptOf(r) === bahagian && !curLabels.has(r.Label)).length;
    const added = cur.filter((r) => deptOf(r) === bahagian && !prevLabels.has(r.Label)).length;
    return {
      bahagian, awal, inspected, added, akhir,
      percent: awal ? Math.round((inspected * 100 / awal) * 10) / 10 : 0,
    };
  }).sort((x, y) => y.akhir - x.akhir || x.bahagian.localeCompare(y.bahagian));
}

const deptCounts = (list) => {
  const m = new Map();
  list.forEach((r) => m.set(deptOf(r), (m.get(deptOf(r)) || 0) + 1));
  return [...m.entries()].map(([bahagian, bilangan]) => ({ bahagian, bilangan }))
    .sort((a, b) => b.bilangan - a.bilangan);
};

const historyRows = [
  ...recsA.map((r) => ({
    Label: r.Label, 'Jenis Aset': r['Jenis Aset'], Bahagian: r.Bahagian,
    'Lokasi Terkini': r['Lokasi Terkini'],
    'Pertama Dilihat': RUN1_AT.slice(0, 10), 'Terakhir Dilihat': RUN1_AT.slice(0, 10),
    'Kali Dilihat': 1, 'Kali Hilang': 1, 'Muncul Semula': 0, Status: 'Sudah diperiksa',
  })),
  ...recsB.map((r) => ({
    Label: r.Label, 'Jenis Aset': r['Jenis Aset'], Bahagian: r.Bahagian,
    'Lokasi Terkini': r['Lokasi Terkini'],
    'Pertama Dilihat': RUN2_AT.slice(0, 10), 'Terakhir Dilihat': RUN2_AT.slice(0, 10),
    'Kali Dilihat': 1, 'Kali Hilang': 0, 'Muncul Semula': 0, Status: 'Belum diperiksa',
  })),
];

const payload = {
  status: {
    observations: 2,
    assets: recsA.length + recsB.length,
    outstanding: recsB.length,
    inspected: recsA.length,
    first: RUN1_AT,
    last: RUN2_AT,
    progressPercent: 88.2,
    reappeared: 0,
    departments: deptCounts(recsB),
  },
  progress: [
    {
      id: 1, observedAt: RUN1_AT, assets: recsA.length, previous: null,
      inspected: 0, added: recsA.length, percent: null,
      departments: deptCounts(recsA), deptProgress: [],
    },
    {
      id: 2, observedAt: RUN2_AT, assets: recsB.length, previous: recsA.length,
      inspected: recsA.length, added: recsB.length, percent: 100,
      departments: deptCounts(recsB), deptProgress: deptProgress(recsA, recsB),
    },
  ],
  history: historyRows,
  overrides: [],
  knownDepartments: [...new Set([...recsA, ...recsB].map(deptOf))],
};

/* ---------------- the harness ---------------- */

const b64 = (p) => Buffer.from(readFileSync(join(root, 'fixture', p), 'utf8'), 'utf8').toString('base64');

const script = `
<pre id="hist-snapshot">pending</pre>
<script>
(function () {
  function decode(b) {
    return new TextDecoder().decode(Uint8Array.from(atob(b), function (c) { return c.charCodeAt(0); }));
  }
  function report(o) {
    document.getElementById('hist-snapshot').textContent = JSON.stringify(o, null, 1);
    document.documentElement.setAttribute('data-hist', 'done');
  }
  function texts(sel) {
    return Array.prototype.map.call(document.querySelectorAll(sel), function (el) {
      return el.textContent.trim();
    });
  }
  function tableRows(i) {
    var t = document.querySelectorAll('#historyWrap table.grid')[i];
    if (!t) return null;
    return Array.prototype.map.call(t.querySelectorAll('tbody tr'), function (tr) {
      return Array.prototype.map.call(tr.querySelectorAll('td'), function (td) {
        return td.textContent.trim();
      });
    });
  }

  (async function () {
    try {
      var H = window.__uiHarness__;
      // Load a file WITHOUT sending it, so what is on screen comes only from the
      // canned D1 data - then re-read D1 and look at what the page rendered.
      var B = decode("${b64(FILE_B)}");
      await H.refresh();
      H.loadFilesQuiet([{ name: ${JSON.stringify(FILE_B)}, text: B }]);
      await H.refresh();

      var merged = H.snapshot().merged;
      var cards = texts('#historyWrap .cards .card');
      var after = H.snapshot();

      // Now send the loaded list to D1 and capture what the page sent.
      var sent = await H.recordRun('ujian');

      report({
        connected: after.history.connected,
        history: after.history,
        cards: cards,
        tabCounter: after.history.tabCounter,
        deptTable: tableRows(0),
        runsTable: tableRows(1),
        outstandingRows: tableRows(2),
        progressHeader: (function () {
          var h = document.querySelectorAll('#historyWrap h3')[0];
          return h ? h.textContent : '';
        })(),
        tables: after.history.renderedTables,
        sent: sent,
        posts: window.__apiStore.posts.length,
        postedRecords: window.__apiStore.posts.length
          ? window.__apiStore.posts[0].records.length : 0,
        postedFields: window.__apiStore.posts.length
          ? Object.keys(window.__apiStore.posts[0].records[0]).sort() : [],
        merged: merged
      });
    } catch (e) {
      var el = document.getElementById('hist-snapshot');
      // The stack, not just the message: a harness failure is almost always a mismatch
      // between what the page renders and what the harness expected, and the line number is
      // what says which of the two is wrong.
      el.textContent = 'HARNESS ERROR: ' + (e && e.message) + '\\n' + (e && e.stack ? String(e.stack).split('\\n').slice(0, 4).join(' | ') : '');
      document.documentElement.setAttribute('data-hist', 'error');
    }
  })();
})();
</script>
`;

const pagePath = join(dist, 'history-verify.html');
writeFileSync(pagePath, buildPage(appHtml, payload, script), 'utf8');

const profile = join(process.env.TEMP || '/tmp', 'dsh-history-profile');
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

const dom = run.stdout;
writeFileSync(join(dist, 'history-verify-dump.html'), dom, 'utf8');

const m = dom.match(/<pre id="hist-snapshot">([\s\S]*?)<\/pre>/);
if (!m) {
  console.error('Snapshot sejarah tidak dijumpai dalam DOM.');
  process.exit(1);
}
const text = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
if (text === 'pending' || text.indexOf('HARNESS ERROR') === 0) {
  console.error('Harness gagal: ' + text.slice(0, 600));
  process.exit(1);
}
const snap = JSON.parse(text);

/* ---------------- assertions ---------------- */

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail += 1; console.log(`  FAIL ${name}${detail ? '  -> ' + detail : ''}`); }
}

const A = recsA.length;   // 473
const B = recsB.length;   // 63
const TOTAL = A + B;

console.log('== Sejarah dari D1 (pelayar sebenar) ==');

check('sambungan D1 dikesan', snap.connected === true, String(snap.connected));
check('tab menunjukkan 2 titik masa', snap.tabCounter === '2', snap.tabCounter);
check('bilangan titik masa daripada D1', snap.history.runs === 2, String(snap.history.runs));
check(`aset belum diperiksa = kandungan titik masa terakhir (${B})`,
  snap.history.outstanding === B, `${snap.history.outstanding} vs ${B}`);
check(`sudah diperiksa = ${A} label titik masa pertama`,
  snap.history.resolved === A, `${snap.history.resolved} vs ${A}`);
check(`pemeriksaan terakhir melaporkan ${A} aset hilang`,
  snap.history.lastInspected === A, `${snap.history.lastInspected} vs ${A}`);

const cardValue = (label) => {
  const hit = snap.cards.find((c) => c.indexOf(label) === 0);
  return hit ? hit.slice(label.length) : null;
};
check('kad ringkasan menunjukkan 2 titik masa',
  cardValue('Titik masa direkod') === '2', JSON.stringify(snap.cards));
check('kad menunjukkan baki belum diperiksa',
  cardValue('Aset belum diperiksa') === String(B), JSON.stringify(snap.cards));
check(`kad menunjukkan ${A} sudah diperiksa`,
  cardValue('Sudah diperiksa') === String(A), JSON.stringify(snap.cards));

check('tiga jadual dirender (kemajuan, titik masa, baki)',
  snap.tables === 3, String(snap.tables));
check('jadual titik masa menunjukkan 2 pemerhatian',
  Array.isArray(snap.runsTable) && snap.runsTable.length === 2, JSON.stringify(snap.runsTable));
check('jadual titik masa menunjukkan bilangan aset setiap pemerhatian',
  snap.runsTable[0][1] === String(B) && snap.runsTable[1][1] === String(A),
  JSON.stringify(snap.runsTable));

/* The per-department table is D1's set difference, not count arithmetic: a
   department that lost 5 and gained 5 is not the same as one that lost 10 and
   gained 10. */
const ju = snap.deptTable[snap.deptTable.length - 1];
check('baris JUMLAH hadir dalam jadual kemajuan', ju && ju[0] === 'JUMLAH', JSON.stringify(ju));
check(`JUMLAH awal = ${A}`, ju[1] === String(A), ju[1]);
check(`JUMLAH diperiksa = ${A}`, ju[2] === String(A), ju[2]);
check(`JUMLAH baharu = ${B}`, ju[3] === String(B), ju[3]);
check('setiap bahagian: awal - diperiksa + baharu = akhir',
  snap.deptTable.slice(0, -1).every((r) => Number(r[1]) - Number(r[2]) + Number(r[3]) === Number(r[4])),
  JSON.stringify(snap.deptTable.slice(0, -1)));
check('setiap bahagian melaporkan 100% kemajuan (tiada label dikongsi)',
  snap.deptTable.slice(0, -1).every((r) => r[5] === '100%'),
  JSON.stringify(snap.deptTable.slice(0, -1).map((r) => r[5])));
check('tajuk kemajuan menyebut kedua-dua tarikh',
  snap.progressHeader.indexOf(RUN1_AT.slice(0, 10)) > 0
  && snap.progressHeader.indexOf(RUN2_AT.slice(0, 10)) > 0,
  snap.progressHeader);

check(`senarai baki menunjukkan ${B} aset belum diperiksa`,
  snap.outstandingRows.length === B, String(snap.outstandingRows.length));
check('senarai baki menyenaraikan label daripada titik masa terakhir',
  snap.outstandingRows.every((r) => recsB.some((x) => x.Label === r[0])),
  JSON.stringify(snap.outstandingRows.slice(0, 3)));

/* ---- the page sends its own upload ---- */

check('muat naik dihantar ke D1 (satu POST)', snap.posts === 1, String(snap.posts));
check(`POST membawa kesemua ${snap.merged} rekod yang digabung`,
  snap.postedRecords === snap.merged, `${snap.postedRecords} vs ${snap.merged}`);
check('rekod dihantar dengan lima medan aset',
  JSON.stringify(snap.postedFields)
  === JSON.stringify(['Bahagian', 'Jenis Aset', 'Label', 'Lokasi Terkini', 'Pegawai Penempatan']),
  JSON.stringify(snap.postedFields));
check('hantar berjaya dilaporkan kepada pengguna', snap.sent.ok === true, JSON.stringify(snap.sent));

console.log('\n' + '='.repeat(60));
console.log(fail === 0
  ? `LULUS - sejarah ${TOTAL} label dirender daripada data D1.`
  : `GAGAL - ${fail} pemeriksaan gagal.`);
console.log('='.repeat(60));
process.exit(fail ? 1 : 0);
