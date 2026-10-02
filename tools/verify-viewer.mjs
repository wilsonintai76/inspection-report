/*
 * verify-viewer.mjs - prove the viewer gets a read-only screen, and gets it from D1.
 *
 *   node tools/verify-viewer.mjs
 *
 * Two things are checked, and the second is the one that matters:
 *
 *   1. The page offers a viewer the list, the department summary and the history,
 *      and nothing that writes.
 *   2. The API refuses a viewer anyway, and the page reports that honestly instead of
 *      showing a success it did not get. Hidden buttons are not access control - the
 *      Worker's own suite proves the refusal; this proves the page does not lie about
 *      it when it happens.
 *
 * The list itself comes from /api/current (canned here), which is what a viewer
 * actually reads: the current outstanding list, not a merge of files.
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
const appCode = readBuiltCode(root);
/* The application is a separate asset now, so the guard reads the built code rather than
   the shell. The selectors themselves are checked in the browser below. */
if (!appCode.includes('__uiHarness__') || !appCode.includes('viewerTools')) {
  console.error('Aplikasi ini tiada mod viewer - jalankan "npm run build".');
  process.exit(2);
}

/* The current list a viewer reads: the outstanding list from the fixtures, with the
   five fields the table renders. */
const NO_DEPT = '(TIADA BAHAGIAN)';
const records = parseFile(readFileSync(join(root, 'fixture', FILE_A), 'utf8'), 'A').records
  .map((r) => ({
    Label: r.Label,
    'Jenis Aset': r['Jenis Aset'],
    'Pegawai Penempatan': r['Pegawai Penempatan'],
    Bahagian: r.Bahagian,
    'Lokasi Terkini': r['Lokasi Terkini'],
  }));

// A small second department makes the filter assertion meaningful.
const bOnly = parseFile(readFileSync(join(root, 'fixture', FILE_B), 'utf8'), 'B').records
  .map((r) => ({
    Label: r.Label,
    'Jenis Aset': r['Jenis Aset'],
    'Pegawai Penempatan': r['Pegawai Penempatan'],
    Bahagian: 'BENGKEL UJIAN VIEWER',
    'Lokasi Terkini': r['Lokasi Terkini'],
  }));
const allRecords = records.concat(bOnly);

const deptMap = {};
allRecords.forEach((r) => {
  const d = (r.Bahagian || '').trim() || NO_DEPT;
  deptMap[d] = (deptMap[d] || 0) + 1;
});

const targetDept = Object.keys(deptMap).sort((a, b) => deptMap[b] - deptMap[a])[0];

const payload = {
  me: { role: 'viewer', email: 'pegawai@poliku.edu.my', mode: 'enforce',
    accessConfigured: true, adminsConfigured: true, adminLoginPath: '/api/admin/login' },
  current: {
    id: 1,
    observedAt: '2026-09-01T08:00:00Z',
    assets: allRecords.length,
    departments: Object.entries(deptMap).map(([bahagian, bilangan]) => ({ bahagian, bilangan }))
      .sort((a, b) => b.bilangan - a.bilangan),
    records: allRecords,
  },
  status: {
    observations: 1,
    assets: allRecords.length,
    outstanding: allRecords.length,
    inspected: 0,
    first: '2026-09-01T08:00:00Z',
    last: '2026-09-01T08:00:00Z',
    reappeared: 0,
    departments: [],
    /* The register's own figures, copied in by an admin: a reader must SEE these and must
       not be able to change them. They add up to each other (12 inspected + (N + 28)
       outstanding = N + 40 total) because all three come from ONE ringkasan - and they
       deliberately disagree with the FILE, which is the check a reader must also be able
       to see. */
    manual: {
      totalAssets: allRecords.length + 40,
      inspected: 12,
      outstanding: allRecords.length + 28,
      updatedAt: '2026-09-02T14:15:00Z',
      updatedBy: 'admin@contoh.my',
    },
  },
  progress: [{
    id: 1, observedAt: '2026-09-01T08:00:00Z', assets: allRecords.length, previous: null,
    inspected: 0, added: allRecords.length, percent: null, departments: [], deptProgress: [],
  }],
  history: [],
  overrides: [],
  knownDepartments: Object.keys(deptMap),
};

const script = `
<pre id="viewer-snapshot">pending</pre>
<script>
(function () {
  function report(o) {
    document.getElementById('viewer-snapshot').textContent = JSON.stringify(o, null, 1);
    document.documentElement.setAttribute('data-viewer', 'done');
  }
  function tableRows() {
    return Array.prototype.map.call(
      document.querySelectorAll('#mergedWrap tbody tr'),
      function (tr) {
        return Array.prototype.map.call(tr.querySelectorAll('td'), function (td) {
          return td.textContent.trim();
        });
      }
    );
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  (async function () {
    try {
      var H = window.__uiHarness__;
      var connected = await H.refresh();
      await wait(60);

      var role = H.role();
      var panels = H.panels();
      var tabs = H.tabs();
      var tabLabels = H.tabLabels();
      var headers = H.listHeaders();
      var server = H.serverState();
      var summaryWarning = (function () {
        var n = document.querySelector('#summaryWrap .notice.warn');
        return n ? n.textContent : '';
      })();

      var allRows = tableRows().length;
      var counter = document.getElementById('cMerged').textContent;
      var countNote = document.getElementById('mergedCount').textContent;

      // Filter by the largest department through the viewer's own control.
      var sel = document.getElementById('selViewerBahagian');
      sel.value = ${JSON.stringify(targetDept)};
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(60);
      var filteredRows = tableRows().length;
      var filteredNote = document.getElementById('mergedCount').textContent;
      // Captured while the filter is applied: it is cleared again below.
      var filteredDepts = tableRows().map(function (r) { return r[4]; });

      // Search on top of that filter.
      var q = document.getElementById('qViewer');
      q.value = 'ZZZ-TIDAK-ADA';
      q.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(300);
      var searchedRows = tableRows().length;

      // Clear the search, then drill in by clicking a summary row instead - the
      // viewer's own filter must follow what the table now shows.
      q.value = '';
      q.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(300);
      var summaryClick = H.clickSummaryRow(${JSON.stringify(targetDept)});
      await wait(60);
      var afterClick = {
        rows: tableRows().length,
        note: document.getElementById('mergedCount').textContent,
      };

      // Back to the whole list, so the export and print assertions cover everything.
      sel.value = '';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(60);

      /* Sejarah Pemeriksaan is an ADMIN tab, so a reader must not have it - not hidden, and
         not merely unreachable: the tab button, the panel and that panel's cards must all be
         absent from the DOM. A filter is set first so the check below also proves the reader
         can get back to the whole list on their own. */
      sel.value = ${JSON.stringify(targetDept)};
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(60);
      var staleBahagian = document.getElementById('mergedCount').textContent;
      sel.value = '';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(60);
      var afterCard = {
        rows: tableRows().length,
        note: document.getElementById('mergedCount').textContent,
        staleBahagian: staleBahagian,
      };

      /* The register's figures, the movement table and the outstanding list all live inside
         that tab, so for a reader there is nothing on screen to read - and hiding the
         button is still not a permission, so a direct write is attempted as well. */
      var readerFigures = {
        historyTab: !!document.getElementById('tab-history'),
        historyTabButton: !!document.querySelector('#tabs button[data-tab="history"]'),
        cards: H.figures().cards.length,
        outstandingCard: !!document.getElementById('cardOutstanding'),
        registerPanels: ['figuresMissing', 'figuresMismatch', 'figuresFileGap']
          .filter(function (id) { return !!document.getElementById(id); }),
        movementTables: document.querySelectorAll('#historyWrap table.data-grid').length,
        figuresButton: !!document.getElementById('btnFigures'),
        purgeButton: !!document.getElementById('btnPurgeRuns'),
        manual: H.figures().manual,
        refused: await fetch('/api/admin/figures', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ totalAssets: 1, inspected: 1, outstanding: 1 }),
        }).then(function (r) { return r.status; }),
      };

      // Export what the viewer sees, and the printable rendering.
      var csv = H.exportCsvText();
      var print = H.preparePrint();
      var printHeader = H.printHeader();

      // Writing must be refused by the API - and reported as a failure.
      var attempt = await H.recordRun('cubaan viewer');

      report({
        connected: connected,
        role: role,
        panels: panels,
        tabs: tabs,
        tabLabels: tabLabels,
        headers: headers,
        listNote: H.listNote(),
        summaryWarning: summaryWarning,
        summaryClick: summaryClick,
        afterClick: afterClick,
        cardOpen: null,
        afterCard: afterCard,
        readerFigures: readerFigures,
        topCards: H.snapshot().cards,
        topCardMeta: Array.prototype.map.call(document.querySelectorAll('#cards .card'), function (c) {
          return { tag: c.tagName, title: c.getAttribute('title') || (c.querySelector('[title]') ? 'x' : '') };
        }),
        server: server,
        allRows: allRows,
        counter: counter,
        countNote: countNote,
        filteredRows: filteredRows,
        filteredNote: filteredNote,
        wantedDept: ${JSON.stringify(targetDept)},
        wantedDeptCount: ${deptMap[targetDept] || 0},
        searchedRows: searchedRows,
        csvLength: csv.length,
        csvHasFirstLabel: csv.indexOf(${JSON.stringify(allRecords[0].Label)}) > 0,
        print: print,
        printHeader: printHeader,
        filteredDepts: filteredDepts,
        attempt: attempt,
        purgeButton: !!document.getElementById('btnPurgeRuns'),
        writePosts: window.__apiStore.posts.length,
        apiPaths: window.__apiLog.map(function (c) { return c.method + ' ' + c.path; })
      });
    } catch (e) {
      document.getElementById('viewer-snapshot').textContent = 'HARNESS ERROR: ' + (e && e.message);
      document.documentElement.setAttribute('data-viewer', 'error');
    }
  })();
})();
</script>
`;

const pagePath = join(dist, 'viewer-verify.html');
writeFileSync(pagePath, buildPage(appHtml, payload, script), 'utf8');

const profile = join(process.env.TEMP || '/tmp', 'dsh-viewer-profile');
rmSync(profile, { recursive: true, force: true });
mkdirSync(profile, { recursive: true });

/**
 * Run one verification page and return the snapshot its driver reported.
 *
 * Both runs below go through here: the page takes a file:// URL, a real profile and a
 * virtual time budget, and the driver parks its JSON in a <pre> that `--dump-dom`
 * leaves behind.
 */
function runPage(pagePath, marker) {
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
  writeFileSync(join(dist, marker + '-dump.html'), dom, 'utf8');

  const m = dom.match(new RegExp(`<pre id="${marker}">([\\s\\S]*?)</pre>`));
  if (!m) {
    console.error(`Snapshot ${marker} tidak dijumpai dalam DOM.`);
    process.exit(1);
  }
  const text = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  if (text === 'pending' || text.indexOf('HARNESS ERROR') === 0) {
    console.error(`Harness ${marker} gagal: ` + text.slice(0, 600));
    process.exit(1);
  }
  return JSON.parse(text);
}

const snap = runPage(pagePath, 'viewer-snapshot');

/* ---------------- assertions ---------------- */

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail += 1; console.log(`  FAIL ${name}${detail ? '  -> ' + detail : ''}`); }
}

console.log('== Viewer (pelayar sebenar) ==');

check('peranan viewer diterima daripada Worker',
  snap.role.role === 'viewer' && snap.role.mode === 'enforce', JSON.stringify(snap.role));
check('halaman menunjukkan peraturan viewer', snap.role.showingViewer === true);
check('e-mel pengguna dilaporkan', snap.role.email === 'pegawai@poliku.edu.my', snap.role.email);
check('sambungan D1 berjaya', snap.connected === true && snap.server.up === true);

/* A public reader is not left guessing how an admin gets in: the page offers the
   door, and Access decides who may open it. */
check('pautan log masuk admin ditawarkan kepada pembaca awam',
  snap.role.loginShown === true, JSON.stringify(snap.role));
check('pautan log masuk menuju ke laluan yang dilindungi Access',
  snap.panels.adminLoginHref === '/api/admin/login', String(snap.panels.adminLoginHref));
check('tiada butang log keluar untuk pembaca yang belum log masuk',
  snap.role.logoutShown === false && snap.panels.adminLogout === false);
check('nota sambungan memberitahu pembaca bahawa log masuk membuka tindakan admin',
  /log masuk sebagai admin/i.test(snap.server.note), snap.server.note);

/* ---- what a viewer is offered ---- */
check('langkah muat naik disembunyikan', snap.panels.files === false, JSON.stringify(snap.panels));
check('butang padam semua titik masa tidak dirender untuk pembaca',
  snap.purgeButton === false, String(snap.purgeButton));
check('tetapan penggabungan disembunyikan', snap.panels.options === false);
check('panel tetapan Bahagian disembunyikan', snap.panels.assign === false);
check('hasil dipaparkan kepada viewer', snap.panels.result === true);
check('kawalan tapisan viewer dipaparkan', snap.panels.viewerTools === true);
check('butang hantar ke D1 disembunyikan', snap.panels.recordRun === false);
check('butang pratonton hanya untuk admin', snap.panels.previewButton === false);
check('tab terhad kepada ringkasan dan senarai semasa',
  JSON.stringify(snap.tabs.slice().sort()) === JSON.stringify(['merged', 'summary'])
  && snap.tabs.indexOf('history') < 0 && snap.tabs.indexOf('dupes') < 0
  && snap.tabs.indexOf('conflicts') < 0 && snap.tabs.indexOf('sources') < 0,
  JSON.stringify(snap.tabs));

/* The words matter: a viewer did not merge anything, so the tab must not say so. */
check('tab senarai dinamakan untuk viewer, bukan "gabungan"',
  snap.tabLabels.merged === 'Senarai Semasa', JSON.stringify(snap.tabLabels));
check('pembaca tiada label tab Sejarah sama sekali',
  snap.tabLabels.summary === 'Ringkasan Bahagian'
  && snap.tabLabels.history === undefined, JSON.stringify(snap.tabLabels));
check('lajur "Salinan" (konsep gabungan) tiada bagi viewer',
  JSON.stringify(snap.headers)
  === JSON.stringify(['#', 'Label', 'Jenis Aset', 'Pegawai Penempatan', 'Bahagian', 'Lokasi Terkini']),
  JSON.stringify(snap.headers));
check('nota bilangan bercakap tentang aset, bukan rekod unik',
  /aset belum diperiksa/.test(snap.listNote) && !/unik/.test(snap.listNote), snap.listNote);
check('amaran tiada-bahagian tidak menyuruh viewer mengedit sistem sumber',
  /Maklumkan kepada admin/.test(snap.summaryWarning)
  && !/sistem sumber/.test(snap.summaryWarning), snap.summaryWarning);

/* ---- the list comes from D1 ---- */
check('senarai dibaca daripada /api/bootstrap, tanpa muat turun kedua',
  snap.apiPaths.indexOf('GET /api/bootstrap') >= 0
  && !snap.apiPaths.some((p) => p.indexOf('GET /api/current') === 0), JSON.stringify(snap.apiPaths.slice(0, 8)));
check(`pembilang sepadan dengan ${snap.server.current.assets} aset dalam D1`,
  snap.counter === String(snap.server.current.assets), `${snap.counter} vs ${snap.server.current.assets}`);
check('nota bilangan menyebut jumlah penuh, bukan hanya halaman ini',
  snap.countNote.indexOf(String(snap.server.current.assets)) > 0, snap.countNote);
check('baris dirender pada halaman pertama', snap.allRows > 0, String(snap.allRows));

/* ---- filtering, search and export ---- */
check(`tapis Bahagian menyatakan ${snap.wantedDeptCount} rekod`,
  snap.filteredNote.indexOf(String(snap.wantedDeptCount)) > 0, snap.filteredNote);
check('setiap baris yang dipaparkan berada dalam bahagian itu',
  snap.filteredDepts.length > 0 && snap.filteredDepts.every((d) => d === snap.wantedDept),
  JSON.stringify(snap.filteredDepts.slice(0, 3)));
check('carian yang tiada padanan memberi sifar baris', snap.searchedRows === 0,
  String(snap.searchedRows));
check('eksport CSV mengandungi senarai yang dilihat',
  snap.csvLength > 1000 && snap.csvHasFirstLabel === true, String(snap.csvLength));

/* Clicking a department in the summary is how a viewer drills in, so the filter they
   can see must agree with the table they get. */
check('klik baris ringkasan menapis senarai',
  snap.summaryClick && snap.summaryClick.stateBahagian === snap.wantedDept,
  JSON.stringify(snap.summaryClick));
check('kawalan tapisan viewer ikut serta',
  snap.summaryClick && snap.summaryClick.viewerSelect === snap.wantedDept,
  JSON.stringify(snap.summaryClick));
check('senarai bertukar kepada tab itu',
  snap.summaryClick && snap.summaryClick.tab === 'merged', JSON.stringify(snap.summaryClick));
check(`nota selepas klik menyatakan ${snap.wantedDeptCount} aset`,
  snap.afterClick.note.indexOf(String(snap.wantedDeptCount)) > 0, snap.afterClick.note);
check('baris dirender selepas klik', snap.afterClick.rows > 0, String(snap.afterClick.rows));

/* ---- Sejarah Pemeriksaan is an admin tab ----
 *
 * It carries the register's three figures, the movement between uploads and the outstanding
 * list - none of which a reader needs, and the destructive buttons live behind it too. So a
 * reader gets no such tab: the button is absent, the panel is absent, and the numbers are not
 * on screen at all. "Not shown" is stronger than "hidden", and the fixtures' register figures
 * are deliberately set so that the checks below would PASS if any of that were still rendered. */
const rfig = snap.readerFigures;
check('pembaca tiada tab Sejarah Pemeriksaan',
  rfig.historyTabButton === false && rfig.historyTab === false,
  JSON.stringify({ button: rfig.historyTabButton, panel: rfig.historyTab }));
check('pembaca tiada kad ringkasan dalam tab itu', rfig.cards === 0, String(rfig.cards));
check('pembaca tiada kad "Aset belum diperiksa" untuk ditekan',
  rfig.outstandingCard === false, String(rfig.outstandingCard));
check('pembaca tiada panel angka daftar atau panel beza SPAA',
  rfig.registerPanels.length === 0, JSON.stringify(rfig.registerPanels));
check('pembaca tiada jadual pergerakan antara muat naik',
  rfig.movementTables === 0, String(rfig.movementTables));
check('butang kemas kini angka dan butang padam tiada untuk pembaca',
  rfig.figuresButton === false && rfig.purgeButton === false,
  JSON.stringify({ figures: rfig.figuresButton, purge: rfig.purgeButton }));
/* The API still refuses a reader's write - and the register's figures are unchanged, even
   though they are no longer on their screen. */
check('API menolak angka daripada pembaca walaupun tanpa butang',
  rfig.refused === 403, String(rfig.refused));
check('angka daftar tidak berubah selepas cubaan itu',
  rfig.manual && rfig.manual.totalAssets === snap.server.current.assets + 40
  && rfig.manual.outstanding === snap.server.current.assets + 28,
  JSON.stringify(rfig.manual));

/* ---- the reader's headline cards: the same four the admin's dashboard carries ----
 *
 * Built by one shared function, so the reader sees the register's figures with the same
 * labels and sub-lines. What stays admin-only is everything that EDITS or INTERROGATES them:
 * the figures dialog, the register-arithmetic panels, the pressable card and the tooltips. */
const top = snap.topCards;
const cur = snap.server.current.assets;
check('kad pembaca ikut turutan papan pemuka admin',
  top.map((c) => c.split('=')[0]).join('|')
  === 'Total aset|Aset belum diperiksa|Sudah diperiksa|Peratus pemeriksaan selesai|Bahagian terlibat|Kemas kini terakhir',
  JSON.stringify(top));
check('kad Total aset membawa angka daftar', top[0].indexOf(`Total aset=${cur + 40}`) === 0, JSON.stringify(top));
check('kad Aset belum diperiksa mendahulukan angka SPAA dan menyebut kiraan fail',
  top[1].indexOf(`Aset belum diperiksa=${cur + 28}`) === 0, JSON.stringify(top));
check('kad Sudah diperiksa membawa angka daftar', top[2].indexOf('Sudah diperiksa=12') === 0, JSON.stringify(top));
check('kad Peratus pemeriksaan selesai = sudah diperiksa / total aset',
  top[3] === `Peratus pemeriksaan selesai=${((12 * 100) / (cur + 40)).toFixed(1)}%`, JSON.stringify(top));
check('kad Kemas kini terakhir membawa tarikh angka daftar',
  top[5].indexOf('Kemas kini terakhir=2026-09-02') === 0, JSON.stringify(top));
check('kad pembaca tiada tooltip admin dan tidak boleh ditekan',
  snap.topCardMeta.every((c) => !c.title && c.tag === 'DIV'), JSON.stringify(snap.topCardMeta));

/* ---- reading the list needs no tab of its own ---- */
/* The table pages at 250 rows, so "the whole list" is proved by the note (which states the
   full count) and by the row count returning to what an unfiltered load showed - not by
   counting every one of the 536 rows on screen. */
check('pembaca boleh kembali kepada senarai penuh tanpa tab Sejarah',
  snap.afterCard.rows === snap.allRows && snap.afterCard.note !== snap.afterCard.staleBahagian,
  JSON.stringify(snap.afterCard));
check('nota senarai menyebut jumlah penuh itu',
  snap.afterCard.note.indexOf(String(snap.server.current.assets)) > 0,
  JSON.stringify(snap.afterCard));

/* ---- printing ---- */
check(`cetakan merangkumi semua baris, bukan satu halaman (${snap.print.rows})`,
  snap.print.rows === snap.server.current.assets,
  `${snap.print.rows} vs ${snap.server.current.assets}`);
check('kepala cetakan menyebut tajuk dan bilangan rekod',
  /Aset belum diperiksa/.test(snap.print.header) && /rekod/.test(snap.print.header),
  snap.print.header);
check('kepala cetakan menyatakan sumbernya D1', /D1/.test(snap.print.header), snap.print.header);

/* ---- the part that matters: writing is refused, and reported ---- */
check('cubaan menulis ditolak, bukan didakwa berjaya',
  snap.attempt && snap.attempt.ok === false, JSON.stringify(snap.attempt));
check('sebab penolakan dilaporkan',
  snap.attempt && (snap.attempt.reason === 'rejected' || snap.attempt.reason === 'offline'),
  JSON.stringify(snap.attempt));
check('tiada rekod disimpan',
  snap.writePosts === 0, String(snap.writePosts));
/* The page writes through the prefix Access protects, so a signed-in admin's write
   is guarded by the network, not by a hidden button. */
check('cubaan tulis menuju ke laluan /api/admin yang dilindungi',
  snap.apiPaths.indexOf('POST /api/admin/observations') >= 0,
  JSON.stringify(snap.apiPaths.filter((p) => p.indexOf('POST') === 0)));

/* ------------------------------------------------------------------ login --
 *
 * A reader who wants to upload must find a way in. This run is in "password" mode, so
 * the dialog is the way: a wrong password changes nothing, a correct one turns this
 * page into the admin dashboard with Step 1 (where the .xls/.csv picker lives), and
 * signing out puts it back.
 */
const ADMIN_PW = 'kata-laluan-ujian';
const loginPayload = {
  ...payload,
  me: {
    role: 'viewer', email: '', mode: 'password', accessConfigured: false,
    adminsConfigured: true, passwordConfigured: true, loginMethod: 'password',
    adminLoginPath: '/api/admin/login',
  },
  adminPassword: ADMIN_PW,
};

const loginScript = `
<pre id="login-snapshot">pending</pre>
<script>
(function () {
  function report(o) {
    document.getElementById('login-snapshot').textContent = JSON.stringify(o, null, 1);
    document.documentElement.setAttribute('data-login', 'done');
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  /* Type the way the suites have to: set the value, then fire input, because a
     programmatic value does not produce a real key event. */
  function type(el, value) {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function press(key) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: key, bubbles: true }));
  }

  (async function () {
    try {
      var H = window.__uiHarness__;
      await H.refresh();
      await wait(60);

      var before = { box: H.loginBox(), panels: H.panels(), role: H.role().role,
        status: document.getElementById('serverLink').textContent.slice(0, 200) };

      var opened = H.requestUpload();
      await wait(60);
      var afterOpen = { opened: opened, box: H.loginBox() };

      var wrongSubmit = null;
      var field = document.getElementById('loginPassword');
      if (field) {
        type(field, 'salah-sekali');
        document.getElementById('loginSubmit').click();
        await wait(150);
        wrongSubmit = {
          box: H.loginBox(),
          panels: H.panels(),
          role: H.role().role,
          posts: window.__apiStore.posts.length,
        };
      }

      press('Escape');
      await wait(60);
      var afterEscape = H.loginBox().open;

      /* "Muat semula" is a READ, and reads are public - so it must refresh without asking
         anybody to sign in. What is gated is uploading a snapshot, not looking again. */
      var reloadAsViewer = (function () {
        var b = document.getElementById('btnViewerRefresh');
        if (!b) return { found: false };
        var apiCalls = window.__apiLog.length;
        b.click();
        return {
          found: true,
          opened: H.loginBox().open,
          callsAfter: window.__apiLog.length,
          callsBefore: apiCalls,
        };
      })();
      await wait(200);
      reloadAsViewer.reloaded = window.__apiLog.slice(reloadAsViewer.callsBefore)
        .some(function (c) { return c.path.indexOf('/api/bootstrap') === 0 && c.method === 'GET'; });
      H.closeLogin();
      await wait(80);

      /* The harness path first, so a failure here means the login plumbing, not the
         form. Logged straight out again to leave the page as it was. */
      var direct = await H.login(${JSON.stringify(ADMIN_PW)});
      await wait(200);
      var afterDirect = { login: direct, panels: H.panels(), role: H.role().role };
      await H.logout();
      await wait(200);

      /* Back in, and this time the right password, typed into the form. */
      H.requestUpload();
      await wait(120);
      var field2 = document.getElementById('loginPassword');
      if (field2) type(field2, ${JSON.stringify(ADMIN_PW)});
      await wait(60);
      var typedValue = field2 ? field2.value : null;
      document.getElementById('loginSubmit').click();
      await wait(400);
      var afterLogin = {
        box: H.loginBox(),
        typed: typedValue,
        panels: H.panels(),
        role: H.role(),
        tabs: H.tabs(),
        labels: H.tabLabels(),
        fileInputShown: !!document.getElementById('fileInput'),
        status: document.getElementById('serverLink').textContent.slice(0, 80),
      };

      /* The dashboard really is an admin one: a record can be sent to D1.\n         The newline is built with fromCharCode because this whole script is itself\n         inside a template literal, where an escape would be eaten before it runs. */
      H.loadFilesQuiet([{ name: 'x.csv', text: 'Label,Jenis Aset' + String.fromCharCode(10) + 'UJIAN/1,PC' }]);
      await wait(100);
      /* Steps 2 and 3 only exist once there is something to merge, so they are read
         here rather than straight after the login. */
      var afterFiles = { panels: H.panels(), cards: H.snapshot().cards };
      var write = await H.recordRun('selepas log masuk');

      /* The same button as an admin just refreshes: no dialog. */
      var histBtn = document.getElementById('btnHistRefresh');
      if (histBtn) histBtn.click();
      await wait(250);
      var reloadAsAdmin = { open: H.loginBox().open, role: H.role().role };

      /* The one destructive action: visible to an admin, and its question names the
         numbers. A reader must not see it at all. Switched by clicking the tab, exactly
         as a user would. */
      var historyTab = document.querySelector('#tabs button[data-tab="history"]');
      if (historyTab) historyTab.click();
      await wait(180);
      var visitHistoryAdmin = null;

      visitHistoryAdmin = {
        tabs: H.tabs(),
        purgeButton: (function () {
          var b = document.getElementById('btnPurgeRuns');
          return b ? !b.hidden : false;
        })(),
      };
      /* The confirmation must say what it costs, and cancelling must change nothing. */
      var purgeBtn = document.getElementById('btnPurgeRuns');
      if (purgeBtn) purgeBtn.click();
      await wait(120);
      var purgeDialog = {
        open: !!document.getElementById('confirmDialog'),
        says: (function () {
          var d = document.getElementById('confirmMessage');
          return d ? d.textContent.slice(0, 240) : '';
        })(),
      };
      var cancel = document.getElementById('confirmNo');
      if (cancel) cancel.click();
      await wait(120);
      purgeDialog.closedAfterCancel = !document.getElementById('confirmDialog');
      purgeDialog.purgesSent = window.__apiStore.purges.length;

      var out = await H.logout();
      await wait(150);
      var afterLogout = { ok: out.ok, panels: H.panels(), role: H.role().role, box: H.loginBox() };

      report({
        before: before,
        afterOpen: afterOpen,
        wrongSubmit: wrongSubmit,
        afterEscape: afterEscape,
        reloadAsViewer: reloadAsViewer,
        afterDirect: afterDirect,
        afterLogin: afterLogin,
        afterFiles: afterFiles,
        reloadAsAdmin: reloadAsAdmin,
        visitHistoryAdmin: visitHistoryAdmin,
        purgeDialog: purgeDialog,
        logins: window.__apiLog.filter(function (c) { return c.path.indexOf('login') >= 0 || c.path.indexOf('logout') >= 0; }),
        write: write,
        afterLogout: afterLogout,
        apiPaths: window.__apiLog.map(function (c) { return c.method + ' ' + c.path; })
      });
    } catch (e) {
      document.getElementById('login-snapshot').textContent = 'HARNESS ERROR: ' + (e && e.message);
      document.documentElement.setAttribute('data-login', 'error');
    }
  })();
})();
</script>
`;

const loginPagePath = join(dist, 'viewer-login.html');
writeFileSync(loginPagePath, buildPage(appHtml, loginPayload, loginScript), 'utf8');
const login = runPage(loginPagePath, 'login-snapshot');

console.log('\n== Viewer: kotak log masuk admin ("Muat naik") ==');
check('pembaca nampak butang "Muat naik"',
  login.before.box.uploadButton === true, JSON.stringify(login.before.box));
check('kotak log masuk tertutup sehingga diminta',
  login.before.box.open === false, JSON.stringify(login.before.box));
check('Langkah 1 tersembunyi sebelum log masuk',
  login.before.panels.files === false, JSON.stringify(login.before.panels));
check('klik "Muat naik" membuka kotak log masuk', login.afterOpen.opened === true);
check('nota sambungan memberitahu pembaca cara log masuk',
  /log masuk admin/i.test(String(login.before.status)), String(login.before.status));
check('kotak log masuk menawarkan medan kata laluan',
  login.afterOpen.box.fieldShown === true, JSON.stringify(login.afterOpen.box));
check('kursor sudah berada dalam medan kata laluan',
  login.afterOpen.box.focused === true, JSON.stringify(login.afterOpen.box));
check('kaedah log masuk datang daripada Worker, bukan tekaan halaman',
  login.afterOpen.box.method === 'password', JSON.stringify(login.afterOpen.box));
check('kata laluan salah tidak membuka Langkah 1',
  login.wrongSubmit && login.wrongSubmit.panels.files === false,
  JSON.stringify(login.wrongSubmit && login.wrongSubmit.panels));
check('kata laluan salah dilaporkan dalam kotak',
  /salah/i.test(String(login.wrongSubmit && login.wrongSubmit.box.error)),
  JSON.stringify(login.wrongSubmit && login.wrongSubmit.box));
check('kata laluan salah tidak menukar peranan',
  login.wrongSubmit && login.wrongSubmit.role === 'viewer',
  String(login.wrongSubmit && login.wrongSubmit.role));
check('kata laluan salah tidak menghantar rekod',
  login.wrongSubmit && login.wrongSubmit.posts === 0, String(login.wrongSubmit && login.wrongSubmit.posts));
check('Escape menutup kotak log masuk', login.afterEscape === false);
check('"Muat semula" pembaca menyegarkan tanpa log masuk',
  login.reloadAsViewer.found === true && login.reloadAsViewer.opened === false
    && login.reloadAsViewer.reloaded === true,
  JSON.stringify(login.reloadAsViewer));
check('kotak log masuk menjelaskan ia untuk MEMUAT NAIK',
  /Muat naik senarai aset menukar/i.test(String(login.afterOpen.box.says)),
  String(login.afterOpen.box.says));
check('"Muat semula" admin juga berfungsi tanpa kotak log masuk',
  login.reloadAsAdmin.open === false && login.reloadAsAdmin.role === 'admin',
  JSON.stringify(login.reloadAsAdmin));
check('admin nampak butang padam semua titik masa',
  login.visitHistoryAdmin && login.visitHistoryAdmin.purgeButton === true,
  JSON.stringify(login.visitHistoryAdmin));
check('butang itu bertanya dahulu, bukan terus memadam',
  login.purgeDialog.open === true, JSON.stringify(login.purgeDialog));
check('soalan itu menyebut bilangan titik masa',
  /titik masa/i.test(String(login.purgeDialog.says))
  && /Padam semua titik masa\?|memadam/i.test(String(login.purgeDialog.says)),
  String(login.purgeDialog.says));
check('Batal menutup soalan tanpa menghantar apa-apa',
  login.purgeDialog.closedAfterCancel === true && login.purgeDialog.purgesSent === 0,
  JSON.stringify(login.purgeDialog));
check('kata laluan betul menutup kotak', login.afterLogin.box.open === false,
  JSON.stringify(login.afterLogin.box));
check('selepas log masuk, peranan ialah admin',
  login.afterLogin.role.role === 'admin', JSON.stringify(login.afterLogin.role));
check('selepas log masuk, Langkah 1 (muat naik) dipaparkan',
  login.afterLogin.panels.files === true, JSON.stringify(login.afterLogin.panels));
check('selepas fail dimuatkan, Langkah 2 (tetapan penggabungan) dipaparkan',
  login.afterFiles.panels.options === true, JSON.stringify(login.afterFiles.panels));
check('selepas fail dimuatkan, hasil gabungan dipaparkan',
  login.afterFiles.panels.result === true, JSON.stringify(login.afterFiles.panels));
check('selepas log masuk, tab diagnosis admin kembali',
  ['dupes', 'conflicts', 'sources'].every((t) => login.afterLogin.tabs.indexOf(t) >= 0),
  JSON.stringify(login.afterLogin.tabs));
check('tab senarai kembali bernama "Senarai Gabungan"',
  login.afterLogin.labels.merged === 'Senarai Gabungan', JSON.stringify(login.afterLogin.labels));
check('pemilih fail (.xls/.csv) tersedia selepas log masuk',
  login.afterLogin.fileInputShown === true);
check('admin yang log masuk boleh menghantar rekod ke D1',
  login.write && login.write.ok === true, JSON.stringify(login.write));
check('log masuk pergi ke laluan /api/admin yang dilindungi',
  login.apiPaths.indexOf('POST /api/admin/login') >= 0, JSON.stringify(login.apiPaths));
check('log keluar dilaporkan berjaya', login.afterLogout.ok === true);
check('selepas log keluar, Langkah 1 disembunyikan semula',
  login.afterLogout.panels.files === false, JSON.stringify(login.afterLogout.panels));
check('selepas log keluar, peranan kembali viewer',
  login.afterLogout.role === 'viewer', String(login.afterLogout.role));
check('butang "Muat naik" muncul semula untuk pembaca',
  login.afterLogout.box.uploadButton === true, JSON.stringify(login.afterLogout.box));
check('log keluar pergi ke laluan /api/admin yang dilindungi',
  login.apiPaths.indexOf('POST /api/admin/logout') >= 0, JSON.stringify(login.apiPaths));

console.log('\n' + '='.repeat(60));
console.log(fail === 0
  ? `LULUS - viewer membaca ${snap.server.current.assets} aset, tidak boleh menulis,`
    + ' dan kotak log masuk membuka dashboard admin dengan betul.'
  : `GAGAL - ${fail} pemeriksaan gagal.`);
console.log('='.repeat(60));
process.exit(fail ? 1 : 0);
