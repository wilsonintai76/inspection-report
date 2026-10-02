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

const A = recsA.length;   // 473
const B = recsB.length;   // 63
const TOTAL = A + B;
/*
 * The register's three figures, as an admin would copy them in from the ringkasan.
 *
 * They are internally consistent (inspected + outstanding = total), because all three come
 * from ONE ringkasan - that is what makes the OTHER comparison the interesting one: the
 * register's "belum diperiksa" is deliberately LARGER than what the file listed, so the
 * suite can prove the report says so instead of quietly publishing the file's number.
 */
const TYPED_INSPECTED = A;
const TYPED_OUTSTANDING = B + 20;
const TYPED_TOTAL = TYPED_INSPECTED + TYPED_OUTSTANDING;
const FILE_GAP = TYPED_OUTSTANDING - B;

/*
 * The snapshot rule, mirrored in Node.
 *
 * An upload IS the whole outstanding list, so run 2 REPLACES run 1: a label run 1 had and
 * run 2 does not has been inspected, and a label only run 2 has is new. The fixture below is
 * built from that rule rather than from hand-written numbers, so the page is asserted against
 * a world that obeys the same rule the Worker does - and a change to the rule shows up here
 * as a disagreement.
 */
const groupBy = (rows) => {
  const m = new Map();
  rows.forEach((r) => {
    const d = deptOf(r);
    if (!m.has(d)) m.set(d, new Set());
    m.get(d).add(r.Label);
  });
  return m;
};
const labelsOf = (rows) => new Set(rows.map((r) => r.Label));

/** The state after run 2: its own labels, and everything ever seen. */
const MODEL = {
  outstanding: labelsOf(recsB),
  seen: new Set([...labelsOf(recsA), ...labelsOf(recsB)]),
};
/** Labels run 1 had that are gone from run 2 - 473 when the two fixtures are disjoint. */
const A_SUPERSEDED = [...labelsOf(recsA)].filter((l) => !MODEL.outstanding.has(l)).length;
const OUTSTANDING = MODEL.outstanding.size;

/** Per-department movement between the two runs, each department against the OLD list. */
function deptProgress(run1, run2) {
  const before = groupBy(run1 || []);
  const after = groupBy(run2 || []);
  return [...new Set([...before.keys(), ...after.keys()])].map((bahagian) => {
    const prev = before.get(bahagian) || new Set();
    const now = after.get(bahagian) || new Set();
    const inspected = [...prev].filter((l) => !now.has(l)).length;
    const added = [...now].filter((l) => !prev.has(l)).length;
    return {
      bahagian, awal: prev.size, inspected, added, akhir: now.size,
      percent: prev.size ? Math.round((inspected * 100 / prev.size) * 10) / 10 : 0,
    };
  }).sort((x, y) => y.akhir - x.akhir || x.bahagian.localeCompare(y.bahagian));
}

const deptCounts = (list) => {
  const m = new Map();
  list.forEach((r) => m.set(deptOf(r), (m.get(deptOf(r)) || 0) + 1));
  return [...m.entries()].map(([bahagian, bilangan]) => ({ bahagian, bilangan }))
    .sort((a, b) => b.bilangan - a.bilangan);
};

/** One row per label, with the status the snapshot rule gives it. */
const historyRows = [
  ...recsA.map((r) => ({
    Label: r.Label, 'Jenis Aset': r['Jenis Aset'], Bahagian: r.Bahagian,
    'Lokasi Terkini': r['Lokasi Terkini'],
    'Pertama Dilihat': RUN1_AT.slice(0, 10), 'Terakhir Dilihat': RUN1_AT.slice(0, 10),
    'Kali Dilihat': 1, 'Kali Hilang': 1, 'Muncul Semula': 0,
    Status: MODEL.outstanding.has(r.Label) ? 'Belum diperiksa' : 'Sudah diperiksa',
  })),
  ...recsB.map((r) => ({
    Label: r.Label, 'Jenis Aset': r['Jenis Aset'], Bahagian: r.Bahagian,
    'Lokasi Terkini': r['Lokasi Terkini'],
    'Pertama Dilihat': RUN2_AT.slice(0, 10), 'Terakhir Dilihat': RUN2_AT.slice(0, 10),
    'Kali Dilihat': 1, 'Kali Hilang': 0, 'Muncul Semula': 0,
    Status: MODEL.outstanding.has(r.Label) ? 'Belum diperiksa' : 'Sudah diperiksa',
  })),
];

const deptProgress2 = deptProgress(recsA, recsB);
const payload = {
  status: {
    observations: 2,
    assets: MODEL.seen.size,
    /* The newest observation IS the current list. */
    outstanding: OUTSTANDING,
    inspected: MODEL.seen.size - OUTSTANDING,
    first: RUN1_AT,
    last: RUN2_AT,
    progressPercent: Math.round(((MODEL.seen.size - OUTSTANDING) * 100 / MODEL.seen.size) * 10) / 10,
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
      id: 2, observedAt: RUN2_AT, assets: recsB.length,
      previous: recsA.length,
      inspected: A_SUPERSEDED,
      added: deptProgress2.reduce((n, d) => n + d.added, 0),
      percent: Math.round((A_SUPERSEDED * 100 / recsA.length) * 10) / 10,
      departments: deptCounts(recsB), deptProgress: deptProgress2,
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
    var t = document.querySelectorAll('#historyWrap table.data-grid')[i];
    if (!t) return null;
    return Array.prototype.map.call(t.querySelectorAll('tbody tr'), function (tr) {
      return Array.prototype.map.call(tr.querySelectorAll('td'), function (td) {
        return td.textContent.trim();
      });
    });
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  /* Poll until the page settles, so a slow re-read cannot become a flaky failure. */
  async function until(fn, ms) {
    var end = Date.now() + (ms || 4000);
    while (Date.now() < end) {
      if (fn()) return true;
      await wait(50);
    }
    return false;
  }
  function typeInto(el, value) {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function cardList() {
    return window.__uiHarness__.figures().cards.map(function (c) {
      return c.k + '=' + c.v + (c.sub ? ' ' + c.sub : '');
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

      /* The "Aset belum diperiksa" card is the question "what is still outstanding?" -
         pressing it must open the list it counted. This page is an ADMIN's, and an admin's
         merged tab is their own upload, not D1, so the card must move them to the list on
         THIS tab rather than switch tabs and show the wrong rows. */
      var histTab = document.querySelector('#tabs button[data-tab="history"]');
      if (histTab) histTab.click();
      var cardOpen = H.clickCard('cardOutstanding');
      var list = document.getElementById('outstandingWrap');
      cardOpen.listRows = list ? list.querySelectorAll('tbody tr').length : -1;

      var cards = texts('#historyWrap .cards .card');
      var after = H.snapshot();

      /* ---- the report's own figures ------------------------------------------------
       * The export decides what is OUTSTANDING; "total aset" and "sudah diperiksa" are
       * claims about the register, so an admin may correct them - and what he types must
       * survive a reload, because the page re-reads D1 instead of believing its own text.
       * The arithmetic is deliberately NOT forced to agree: an export may legitimately
       * not match the register, and the report says so rather than hiding it. */
      var figuresFlow = {
        buttonShown: !!document.getElementById('btnFigures'),
        posted: [],
        missingNotice: (function () {
          var n = document.getElementById('figuresMissing');
          return n ? n.textContent : '';
        })(),
      };
      figuresFlow.cardBefore = cardList();
      document.getElementById('btnFigures').click();
      await wait(80);
      figuresFlow.dialog = !!document.getElementById('figuresDialog');
      /* Opening on the CURRENT answer, with the system's own counts as placeholders. */
      figuresFlow.placeholderTotal = document.getElementById('figTotal').placeholder;
      figuresFlow.placeholderInspected = document.getElementById('figInspected').placeholder;
      figuresFlow.placeholderOutstanding = document.getElementById('figOutstanding').placeholder;
      figuresFlow.checkEmpty = document.getElementById('figCheck').textContent;
      figuresFlow.fileCheckEmpty = document.getElementById('figFileCheck').textContent;

      /* All three register figures, and the SPAA "belum diperiksa" is deliberately NOT the
         file's count: that difference is what the panel has to say out loud. */
      typeInto(document.getElementById('figTotal'), String(${TYPED_TOTAL}));
      typeInto(document.getElementById('figInspected'), String(${TYPED_INSPECTED}));
      typeInto(document.getElementById('figOutstanding'), String(${TYPED_OUTSTANDING}));
      await wait(60);
      /* The live arithmetic and the live comparison, before anything is saved. */
      figuresFlow.checkTyped = document.getElementById('figCheck').textContent;
      figuresFlow.fileCheckTyped = document.getElementById('figFileCheck').textContent;
      document.getElementById('figSave').click();
      figuresFlow.saved = await until(function () {
        var f = H.figures();
        return !!f.manual && f.manual.totalAssets === ${TYPED_TOTAL};
      });
      await wait(80);
      figuresFlow.closedAfterSave = !document.getElementById('figuresDialog');
      figuresFlow.cardSaved = cardList();
      figuresFlow.missingAfterSave = !!document.getElementById('figuresMissing');
      figuresFlow.fileGapShown = !!document.getElementById('figuresFileGap');
      figuresFlow.fileGapText = (function () {
        var n = document.getElementById('figuresFileGap');
        return n ? n.textContent : '';
      })();
      figuresFlow.afterSave = H.figures();

      /* Clearing all three is a real action: "trust the data again". */
      document.getElementById('btnFigures').click();
      await wait(80);
      figuresFlow.reopenedOnSaved = {
        total: document.getElementById('figTotal').value,
        inspected: document.getElementById('figInspected').value,
        outstanding: document.getElementById('figOutstanding').value,
      };
      document.getElementById('figClear').click();
      figuresFlow.cleared = await until(function () {
        var f = H.figures();
        return !!f.manual && f.manual.totalAssets === null;
      });
      await wait(80);
      figuresFlow.cardCleared = cardList();
      figuresFlow.afterClear = H.figures();
      figuresFlow.missingAfterClear = !!document.getElementById('figuresMissing');
      figuresFlow.gapAfterClear = !!document.getElementById('figuresFileGap');
      figuresFlow.posted = window.__apiLog
        .filter(function (c) { return c.route.indexOf('/figures') >= 0; })
        .map(function (c) { return c.method + ' ' + c.path + ' ' + JSON.stringify(c.body); });

      // Now send the loaded list to D1 and capture what the page sent.
      var sent = await H.recordRun('ujian');

      report({
        connected: after.history.connected,
        history: after.history,
        cards: cards,
        cardOpen: cardOpen,
        figuresFlow: figuresFlow,
        tabCounter: after.history.tabCounter,
        /* Table order in the tab: 0 the change since the last upload, 1 the points in time,
           2 the assets still outstanding. */
        deptTable: tableRows(0),
        runsTable: tableRows(1),
        outstandingRows: tableRows(2),
        progressHeading: (function () {
          var h = document.querySelectorAll('#historyWrap h3')[0];
          return h ? h.textContent : '';
        })(),
        tables: after.history.renderedTables,
        historyText: document.getElementById('tab-history').textContent,
        /* Geometry: the tab is open, so these measure for real. A heading that sits over the
           wrong column is invisible to every text assertion in this file. */
        layout: [0, 1, 2].map(function (i) {
          return H.tableLayout('#historyWrap table.data-grid', i);
        }),
        progressColumns: Array.prototype.map.call(
          document.querySelectorAll('#historyWrap table.data-grid')[0].querySelectorAll('thead th'),
          function (th) { return th.textContent.trim(); },
        ),
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

console.log('== Sejarah dari D1 (pelayar sebenar) ==');

check('sambungan D1 dikesan', snap.connected === true, String(snap.connected));
check('tab menunjukkan 2 titik masa', snap.tabCounter === '2', snap.tabCounter);
check('bilangan titik masa daripada D1', snap.history.runs === 2, String(snap.history.runs));
check(`aset belum diperiksa daripada fail = senarai terbaharu (${OUTSTANDING})`,
  snap.history.outstandingFile === OUTSTANDING,
  `${snap.history.outstandingFile} vs ${OUTSTANDING}`);
check(`muat naik kedua menggantikan KESELURUHAN senarai lama (${A_SUPERSEDED} aset hilang)`,
  A_SUPERSEDED === A, `digantikan ${A_SUPERSEDED} daripada ${A}`);
/* The register's own figures come from Sistem Pengurusan Aset Alih, never from the
   uploads - so with nothing keyed in they are NOT there, and that must be visible. */
check('tanpa angka daftar, "sudah diperiksa" dan "total aset" dilaporkan belum ditetapkan',
  snap.history.resolved === null && snap.history.registerTotal === null,
  JSON.stringify({ resolved: snap.history.resolved, total: snap.history.registerTotal }));
check(`kiraan sistem masih dilaporkan, tetapi berasingan (${MODEL.seen.size - OUTSTANDING} label hilang, ${MODEL.seen.size} label dilihat)`,
  snap.history.derived.inspected === MODEL.seen.size - OUTSTANDING
  && snap.history.derived.total === MODEL.seen.size,
  JSON.stringify(snap.history.derived));
check(`pemeriksaan terakhir melaporkan ${A_SUPERSEDED} aset hilang`,
  snap.history.lastInspected === A_SUPERSEDED,
  `${snap.history.lastInspected} vs ${A_SUPERSEDED}`);

const cardValue = (label) => {
  const hit = snap.cards.find((c) => c.indexOf(label) === 0);
  return hit ? hit.slice(label.length) : null;
};
check('kad ringkasan menunjukkan 2 titik masa',
  cardValue('Titik masa direkod') === '2', JSON.stringify(snap.cards));
check('kad menunjukkan baki belum diperiksa, dengan sumbernya (fail)',
  cardValue('Aset belum diperiksa') === `${OUTSTANDING}dari fail`, JSON.stringify(snap.cards));
check('kad "Sudah diperiksa" KOSONG, bukan kiraan sistem',
  cardValue('Sudah diperiksa') === '\u2013belum ditetapkan', JSON.stringify(snap.cards));
check('kad "Total aset" juga kosong',
  cardValue('Total aset') === '\u2013belum ditetapkan', JSON.stringify(snap.cards));

check('tiga jadual dirender (perubahan, titik masa, baki)',
  snap.tables === 3, String(snap.tables));

/* Headings must sit over their own columns in all three tables - see the harness's
   `tableLayout` for why this is checked in pixels rather than by reading text. */
snap.layout.forEach((lay, i) => {
  check(`kepala jadual ${i + 1} sejajar dengan lajur data`,
    !!lay && lay.display === 'table' && lay.width > 0 && lay.columns > 1 && lay.drift === 0,
    JSON.stringify(lay));
});

/* ---- the one claim the page must NOT make ----
 *
 * "sudah diperiksa" is the REGISTER's figure, keyed in by an admin. The page observes
 * something else - labels that are gone from the newest list - so it must never say that an
 * asset "is therefore inspected": that inference is exactly what this report refuses to
 * make on the register's behalf. */
check('halaman tidak mendakwa aset yang hilang "dianggap sudah diperiksa"',
  snap.historyText.indexOf('dianggap') < 0, snap.historyText.match(/.{0,60}dianggap.{0,80}/));
check('lajur jadual menamakan apa yang diukur (Hilang), bukan status daftar',
  snap.progressColumns.indexOf('Hilang') > 0 && snap.progressColumns.indexOf('Diperiksa') < 0,
  JSON.stringify(snap.progressColumns));
/* The after-upload notices say the same thing in words, and they are not in the DOM here -
   so the source is read directly rather than left unguarded. */
check('mesej selepas muat naik juga tidak mendakwa sedemikian',
  !readFileSync(join(root, 'src/state/notices.ts'), 'utf8').includes('dianggap'),
  'src/state/notices.ts mengandungi "dianggap"');
check('jadual titik masa menunjukkan 2 pemerhatian',
  Array.isArray(snap.runsTable) && snap.runsTable.length === 2, JSON.stringify(snap.runsTable));
check('jadual titik masa menunjukkan bilangan aset setiap pemerhatian',
  snap.runsTable[0][1] === String(B) && snap.runsTable[1][1] === String(A),
  JSON.stringify(snap.runsTable));

/* The per-department table is D1's set difference, not count arithmetic: a
   department that lost 5 and gained 5 is not the same as one that lost 10 and
   gained 10. */
const ju = snap.deptTable[snap.deptTable.length - 1];
const dpAdded = deptProgress2.reduce((n, d) => n + d.added, 0);
check('baris JUMLAH hadir dalam jadual kemajuan', ju && ju[0] === 'JUMLAH', JSON.stringify(ju));
check(`JUMLAH awal = ${A} (senarai sebelumnya)`, ju[1] === String(A), `${ju[1]} vs ${A}`);
check(`JUMLAH diperiksa = ${A_SUPERSEDED}`, ju[2] === String(A_SUPERSEDED),
  `${ju[2]} vs ${A_SUPERSEDED}`);
check(`JUMLAH baharu = ${dpAdded}`, ju[3] === String(dpAdded), `${ju[3]} vs ${dpAdded}`);
check('setiap bahagian: awal - diperiksa + baharu = akhir',
  snap.deptTable.slice(0, -1).every((r) => Number(r[1]) - Number(r[2]) + Number(r[3]) === Number(r[4])),
  JSON.stringify(snap.deptTable.slice(0, -1)));
check('setiap bahagian dalam kedua-dua senarai muncul sekali',
  snap.deptTable.slice(0, -1).length === deptProgress2.length
  && snap.deptTable.slice(0, -1).every((r) => deptProgress2.some((d) => d.bahagian === r[0])),
  JSON.stringify(snap.deptTable.slice(0, -1).map((r) => r[0])));
check('setiap baris sepadan dengan model berikut:',
  snap.deptTable.slice(0, -1).every((r) => {
    const want = deptProgress2.find((d) => d.bahagian === r[0]);
    return want && Number(r[1]) === want.awal && Number(r[2]) === want.inspected
      && Number(r[3]) === want.added && r[5] === `${want.percent}%`;
  }),
  JSON.stringify(snap.deptTable.slice(0, -1)));
check('tajuk jadual perubahan menyebut kedua-dua tarikh',
  snap.progressHeading.indexOf(RUN1_AT.slice(0, 10)) > 0
  && snap.progressHeading.indexOf(RUN2_AT.slice(0, 10)) > 0,
  snap.progressHeading);

check(`senarai baki menunjukkan ${OUTSTANDING} aset belum diperiksa`,
  snap.outstandingRows.length === OUTSTANDING, String(snap.outstandingRows.length));

/* The card and the list it opens must agree: a number you can press that leads to a
   different list is worse than a number you cannot press. */
check('kad "Aset belum diperiksa" ialah butang sebenar, bukan teks mati',
  snap.cardOpen && snap.cardOpen.tag === 'BUTTON', JSON.stringify(snap.cardOpen));
check('menekan kad itu tidak membawa admin ke tab lain',
  snap.cardOpen && snap.cardOpen.tab === 'history', JSON.stringify(snap.cardOpen));
check('menekan kad itu meletakkan fokus pada senarai baki',
  snap.cardOpen && snap.cardOpen.focused === 'outstandingWrap', JSON.stringify(snap.cardOpen));
check(`senarai yang dibuka kad itu juga ${OUTSTANDING} baris`,
  snap.cardOpen && snap.cardOpen.listRows === OUTSTANDING,
  `${snap.cardOpen && snap.cardOpen.listRows} vs ${OUTSTANDING}`);

/* ---------------- the report's own figures ---------------- *
 *
 * Two of the four cards are claims about the REGISTER, so an admin may correct them; the
 * outstanding count is a fact about the last upload, so he may not. The flow below is
 * driven through the real dialog and read back out of the DOM. */
const fig = snap.figuresFlow;
const has = (list, prefix) => list.some((c) => c.indexOf(prefix) === 0);

check('sebelum disalin, kad "Total aset" kosong - kiraan sistem tidak dipinjam',
  has(fig.cardBefore, 'Total aset=\u2013 belum ditetapkan'), JSON.stringify(fig.cardBefore));
check(`kad terakhir ialah TARIKH kemas kini, bukan ulangan bilangan (${RUN2_AT.slice(0, 10)})`,
  has(fig.cardBefore, `Kemas kini terakhir=${RUN2_AT.slice(0, 10)} jam ${RUN2_AT.slice(11, 16)}`),
  JSON.stringify(fig.cardBefore));
check('kad "Sudah diperiksa" tiada lagi nombor pemeriksaan terakhir di sebelahnya',
  fig.cardBefore.filter((c) => c.indexOf('Pemeriksaan kali terakhir') === 0).length === 0
  && fig.cardBefore.filter((c) => c.indexOf('Kemas kini terakhir') === 0).length === 1,
  JSON.stringify(fig.cardBefore));

check('butang kemas kini angka disediakan untuk admin',
  fig.buttonShown === true, String(fig.buttonShown));
const DERIVED_INSPECTED = MODEL.seen.size - OUTSTANDING;
check('dialog menawarkan kiraan sistem sebagai nilai lalai',
  fig.placeholderTotal === `Kiraan sistem: ${TOTAL}`
  && fig.placeholderInspected === `Kiraan sistem: ${DERIVED_INSPECTED}`
  && fig.placeholderOutstanding === `Kiraan fail: ${B}`,
  `${fig.placeholderTotal} / ${fig.placeholderInspected} / ${fig.placeholderOutstanding}`);
check('medan kosong TIDAK mengira apa-apa - ia memberitahu kad akan kosong',
  fig.checkEmpty.indexOf('belum ditetapkan') > 0 && fig.checkEmpty.indexOf('Kiraan sistem') < 0,
  fig.checkEmpty);
check('medan SPAA kosong memberitahu apa yang perlu diisi untuk perbandingan',
  fig.fileCheckEmpty.indexOf('belum diperiksa') > 0
  && fig.fileCheckEmpty.indexOf(String(B)) > 0,
  fig.fileCheckEmpty);
/* The register's three figures come from ONE ringkasan, so they are typed in to add up -
   which is what makes the next check (register vs FILE) the interesting one. */
check('aritmetik daftar ditunjukkan SEBELUM disimpan',
  fig.checkTyped.indexOf(String(TYPED_TOTAL)) > 0
  && fig.checkTyped.indexOf(String(TYPED_OUTSTANDING)) > 0
  && fig.checkTyped.indexOf('sepadan') > 0,
  fig.checkTyped);
check('perbandingan SPAA dengan FAIL ditunjukkan SEBELUM disimpan',
  fig.fileCheckTyped.indexOf(String(TYPED_OUTSTANDING)) > 0
  && fig.fileCheckTyped.indexOf(String(B)) > 0
  && fig.fileCheckTyped.indexOf(`beza ${FILE_GAP}`) > 0
  && fig.fileCheckTyped.indexOf('bukan senarai penuh') > 0,
  fig.fileCheckTyped);
check('simpan menghantar permintaan ke laluan admin yang dilindungi',
  fig.posted.length >= 1 && fig.posted[0].indexOf('POST /api/admin/figures') === 0,
  JSON.stringify(fig.posted));
check('angka yang disimpan datang daripada D1, bukan daripada kotak teks halaman',
  fig.saved === true && fig.afterSave.manual.totalAssets === TYPED_TOTAL
  && fig.afterSave.manual.inspected === TYPED_INSPECTED
  && fig.afterSave.manual.outstanding === TYPED_OUTSTANDING,
  JSON.stringify(fig.afterSave.manual));
check('kad memakai angka daftar selepas disimpan',
  has(fig.cardSaved, `Total aset=${TYPED_TOTAL}`)
  && has(fig.cardSaved, `Sudah diperiksa=${TYPED_INSPECTED}`)
  && has(fig.cardSaved, `Aset belum diperiksa=${TYPED_OUTSTANDING}`),
  JSON.stringify(fig.cardSaved));
/* The double check itself: SPAA says more assets are still waiting than the file listed,
   and the card says both numbers so the difference cannot pass unnoticed. */
check('kad "belum diperiksa" menunjukkan angka SPAA DAN kiraan fail',
  has(fig.cardSaved, `Aset belum diperiksa=${TYPED_OUTSTANDING} SPAA \u00b7 fail: ${B}`),
  JSON.stringify(fig.cardSaved));
check('peratus pemeriksaan selesai = sudah diperiksa / total aset x 100',
  has(fig.cardSaved, `Peratus pemeriksaan selesai=${((TYPED_INSPECTED * 100) / TYPED_TOTAL).toFixed(1)}%`),
  JSON.stringify(fig.cardSaved));
check('peratus kosong sebelum angka daftar disalin dan selepas dibuang - tiada kiraan sistem dipinjam',
  has(fig.cardBefore, 'Peratus pemeriksaan selesai=\u2013 belum ditetapkan')
  && has(fig.cardCleared, 'Peratus pemeriksaan selesai=\u2013 belum ditetapkan'),
  JSON.stringify({ before: fig.cardBefore, cleared: fig.cardCleared }));
check('panel beza SPAA-dengan-fail muncul, dengan kedua-dua angka',
  fig.fileGapShown === true && fig.fileGapText.indexOf(`beza ${FILE_GAP}`) > 0
  && fig.fileGapText.indexOf(String(TYPED_OUTSTANDING)) > 0
  && fig.fileGapText.indexOf(String(B)) > 0,
  fig.fileGapText);
check('kad terakhir kini menunjukkan tarikh pindaan manual itu',
  has(fig.cardSaved, 'Kemas kini terakhir=2026-03-01 jam 09:30'), JSON.stringify(fig.cardSaved));
check('dialog ditutup selepas berjaya disimpan', fig.closedAfterSave === true);
check('angka daftar yang sepadan TIDAK memunculkan amaran dalaman daftar',
  fig.afterSave.mismatch === '', JSON.stringify(fig.afterSave.mismatch));
check('dialog dibuka semula dengan angka tersimpan, bukan kosong',
  fig.reopenedOnSaved.total === String(TYPED_TOTAL)
  && fig.reopenedOnSaved.inspected === String(TYPED_INSPECTED)
  && fig.reopenedOnSaved.outstanding === String(TYPED_OUTSTANDING),
  JSON.stringify(fig.reopenedOnSaved));
check('"Kosongkan angka daftar" membuang angka manual',
  fig.cleared === true && fig.afterClear.manual && fig.afterClear.manual.totalAssets === null
  && fig.afterClear.manualOutstanding === false,
  JSON.stringify(fig.afterClear.manual));
check('kad kembali KOSONG, bukan kepada kiraan sistem',
  has(fig.cardCleared, `Total aset=\u2013 belum ditetapkan`)
  && has(fig.cardCleared, `Sudah diperiksa=\u2013 belum ditetapkan`),
  JSON.stringify(fig.cardCleared));
check('kad "belum diperiksa" kembali kepada kiraan FAIL, dengan label sumbernya',
  has(fig.cardCleared, `Aset belum diperiksa=${B} dari fail`), JSON.stringify(fig.cardCleared));
check('panel beza SPAA-dengan-fail hilang apabila angka SPAA dibuang',
  fig.gapAfterClear === false, String(fig.gapAfterClear));
check('gesaan angka daftar kembali apabila ia dibuang',
  fig.missingAfterClear === true && fig.missingAfterSave === false && fig.missingNotice.length > 0,
  JSON.stringify({ before: fig.missingNotice.length, afterSave: fig.missingAfterSave, afterClear: fig.missingAfterClear }));
check('tarikh kemas kini jatuh kembali kepada muat naik terakhir',
  has(fig.cardCleared, `Kemas kini terakhir=${RUN2_AT.slice(0, 10)} jam ${RUN2_AT.slice(11, 16)}`),
  JSON.stringify(fig.cardCleared));
check('senarai baki menyenaraikan label daripada senarai terbaharu',
  snap.outstandingRows.every((r) => MODEL.outstanding.has(r[0])),
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
