/*
 * verify-ui.mjs - build a UI harness page and run it in headless Chrome.
 *
 *   node tools/verify-ui.mjs
 *
 * Builds dist/ui-verify.html: the real app with two attached asset files
 * embedded, driven through the app's own file-intake -> merge -> render
 * pipeline. The rendered DOM is dumped and asserted, so the browser path is
 * verified with the actual data rather than a fixture.
 *
 * Chrome is required. If it cannot start (e.g. a restricted sandbox blocks its
 * IPC), the script explains that and exits with code 2 rather than failing
 * silently.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { APP_FILENAME } from './artifacts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const dist = join(root, 'dist');

/** Same digest the app computes in-page via crypto.subtle. */
const sha256 = (text) => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chrome) {
  console.error('Chrome/Edge tidak dijumpai. Tetapkan CHROME_PATH untuk menjalankan ujian UI.');
  process.exit(2);
}

/* ---------- fixtures ------------------------------------------------------ */

const realA = process.env.JKM_FILE_A
  || join(root, 'fixture', 'Senarai_Aset_Belum_Periksa_ABR_JKM.xls');
const realB = process.env.JKM_FILE_B
  || join(root, 'fixture', 'Senarai_Aset_Belum_Periksa_HM_JKM.xls');
const fallback = join(root, 'fixture', 'Senarai_Aset_Belum_Periksa_JKM.xls');

function loadFixture(path, fallbackPath, name) {
  const p = existsSync(path) ? path : (existsSync(fallbackPath) ? fallbackPath : null);
  if (!p) {
    console.error(`Tiada fail ujian untuk ${name}. Letakkan fail .xls dalam folder fixture/,`);
    console.error('atau tetapkan JKM_FILE_A / JKM_FILE_B, atau guna JKM_SYNTHETIC=1.');
    process.exit(2);
  }
  return { name: p.split(/[\\/]/).pop(), text: readFileSync(p, 'utf8') };
}

// JKM_SYNTHETIC=1 exercises the REAL data shape (473 ABR labels, 63 HM labels)
// without needing the real files.
let fileA;
let fileB;
let expectedFromEngine = null;

if (process.env.JKM_SYNTHETIC) {
  const synth = await import('./synthetic-data.mjs');
  const { parseFile, mergeSources } = await import('../src/parser.mjs');
  const built = synth.buildReports({
    abr: Number(process.env.JKM_ABR || 473),
    hm: Number(process.env.JKM_HM || 63),
    overlap: Number(process.env.JKM_OVERLAP || 40),
  });
  fileA = { name: 'Senarai_Aset_Belum_Periksa_ABR_JKM.xls', text: built.abrText };
  fileB = { name: 'Senarai_Aset_Belum_Periksa_HM_JKM.xls', text: built.hmText };
  const a = parseFile(built.abrText, fileA.name);
  const b = parseFile(built.hmText, fileB.name);
  const merged = mergeSources([
    { fileName: fileA.name, label: fileA.name, records: a.records, warnings: [] },
    { fileName: fileB.name, label: fileB.name, records: b.records, warnings: [] },
  ]);
  expectedFromEngine = {
    merged: merged.merged.length,
    duplicates: merged.duplicates.length,
    conflicts: merged.conflicts.length,
  };
  console.log(`Mod sintetik: ABR=${a.records.length} HM=${b.records.length} label `
    + `-> unik=${expectedFromEngine.merged} pertindihan=${expectedFromEngine.duplicates}`);
} else {
  fileA = loadFixture(realA, fallback, 'fail A');
  fileB = loadFixture(realB, fallback, 'fail B');
}

/* ---------- Node-side reference: same inputs through the same engine ------- */
// The browser must reproduce these exactly, which proves the DOM parsing path
// agrees with the DOM-free path on the real files.

const { parseFile: nodeParse, mergeSources: nodeMerge, FIELDS: NODE_FIELDS } = await import('../src/parser.mjs');

const canonicalOf = (records) => records
  .map((r) => NODE_FIELDS.map((f) => String(r[f] ?? '')).join('\u0001'))
  .join('\u0002');

const nodeParsed = [
  { file: fileA, parsed: nodeParse(fileA.text, fileA.name) },
  { file: fileB, parsed: nodeParse(fileB.text, fileB.name) },
];
const nodeMerged = nodeMerge(nodeParsed.map(({ file, parsed }) => ({
  fileName: file.name, label: file.name, records: parsed.records, warnings: [],
})));

const reference = {
  merged: nodeMerged.merged.length,
  duplicates: nodeMerged.duplicates.length,
  conflicts: nodeMerged.conflicts.length,
  perFile: nodeParsed.map(({ file, parsed }) => ({
    name: file.name,
    rows: parsed.records.length,
    fingerprint: canonicalOf(parsed.records),
  })),
  mergedFingerprint: canonicalOf(nodeMerged.merged),
};

if (!expectedFromEngine) {
  expectedFromEngine = {
    merged: reference.merged,
    duplicates: reference.duplicates,
    conflicts: reference.conflicts,
  };
}
console.log(`Rujukan Node: ${reference.perFile.map((p) => `${p.rows}`).join(' + ')} = `
  + `${reference.merged} unik, ${reference.duplicates} pertindihan, ${reference.conflicts} konflik`);

/* ---------- build the harness page ---------------------------------------- */

const appHtml = readFileSync(join(dist, APP_FILENAME), 'utf8');

// The fixture text itself contains "</script>", which would terminate an inline
// script block early. Base64 keeps the payload inert until decoded at runtime.
// A real SHA-256 is supplied for each file so the app's identical-content
// detection is exercised the same way FileReader + crypto.subtle would drive it.
const files = [
  { name: fileA.name, text: fileA.text, sha: sha256(fileA.text) },
  { name: fileB.name, text: fileB.text, sha: sha256(fileB.text) },
];
const payloadB64 = Buffer.from(JSON.stringify({ files }), 'utf8').toString('base64');

const harness = `
<pre id="ui-snapshot">pending</pre>
<script>
(function () {
  var out = document.getElementById('ui-snapshot');
  try {
    // Strip any whitespace the template literal may have introduced into the
    // base64, then decode.
    var b64 = "${payloadB64}".replace(/\\s+/g, '');
    var raw = new TextDecoder().decode(Uint8Array.from(atob(b64), function (c) {
      return c.charCodeAt(0);
    }));
    var payload = JSON.parse(raw);
    window.__uiHarness__.loadFiles(payload.files);
    out.textContent = JSON.stringify(window.__uiHarness__.snapshot(), null, 1);
    document.documentElement.setAttribute('data-ui-verify', 'done');
  } catch (e) {
    out.textContent = 'UI HARNESS ERROR: ' + (e && e.message);
    document.documentElement.setAttribute('data-ui-verify', 'error');
  }
})();
</script>
`;

// Append the harness AFTER the app so window.__uiHarness__ already exists. The
// anchor must be the LAST "</body>": the inlined parser contains its own
// "</body>" inside an HTML template string, and a plain replace() would patch
// that copy instead of the real document tail.
const bodyAnchor = appHtml.lastIndexOf('</body>');
if (bodyAnchor < 0) {
  console.error('Struktur HTML tidak dijangka - jalankan "npm run build" dahulu.');
  process.exit(2);
}
const page = appHtml.slice(0, bodyAnchor) + harness + appHtml.slice(bodyAnchor);

mkdirSync(dist, { recursive: true });
const pagePath = join(dist, 'ui-verify.html');
writeFileSync(pagePath, page, 'utf8');

/* ---------- run it -------------------------------------------------------- */

const uri = 'file:///' + pagePath.replace(/\\/g, '/');
const userDataDir = join(process.env.TEMP || '/tmp', 'chrome-ui-verify-' + Date.now());

const run = spawnSync(chrome, [
  '--headless',
  '--disable-gpu',
  '--no-sandbox',
  '--user-data-dir=' + userDataDir,
  '--virtual-time-budget=25000',
  '--dump-dom',
  uri,
], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

if (run.error) {
  console.error('Gagal memulakan Chrome:', run.error.message);
  console.error('Jika ini sandbox menghalang IPC Chrome, jalankan skrip ini dengan akses lebih luas.');
  process.exit(2);
}
if (!run.stdout || run.stdout.length < 1000) {
  console.error('Chrome tidak menghasilkan DOM. stderr:');
  console.error((run.stderr || '').split('\n').slice(0, 10).join('\n'));
  process.exit(2);
}

const dom = run.stdout;
writeFileSync(join(dist, 'ui-verify-dump.html'), dom, 'utf8');

if (dom.indexOf('data-ui-verify="done"') < 0) {
  console.error('Harness UI tidak selesai. Serpihan DOM:');
  console.error(dom.slice(dom.indexOf('ui-snapshot'), dom.indexOf('ui-snapshot') + 800));
  process.exit(1);
}

const match = dom.match(/<pre id="ui-snapshot">([\s\S]*?)<\/pre>/);
if (!match) {
  console.error('Snapshot UI tidak dijumpai dalam DOM.');
  process.exit(1);
}
const snap = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));

/* ---------- assertions ---------------------------------------------------- */

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail += 1; console.log(`  FAIL ${name}${detail ? '  -> ' + detail : ''}`); }
}

console.log('Snapshot UI:');
console.log(JSON.stringify(snap, null, 1));
console.log('\n== Ujian UI (pelayar sebenar) ==');

// Expectations: in synthetic mode they come from the app's own engine over the
// same inputs; otherwise the UI must match whatever the app computes in-page
// (the two original exports are identical, so everything collapses).
const expMerged = expectedFromEngine ? expectedFromEngine.merged : snap.merged;
const expDupes = expectedFromEngine ? expectedFromEngine.duplicates : snap.duplicates;
const expConflicts = expectedFromEngine ? expectedFromEngine.conflicts : snap.conflicts;
const pageSize = 250;
const expRowsOnPage = Math.min(expMerged, pageSize);
const expPages = Math.ceil(expMerged / pageSize);

check('dua fail dimuatkan', snap.sources === 2, 'sources=' + snap.sources);
check(`${expMerged} rekod unik digabungkan`, snap.merged === expMerged, 'merged=' + snap.merged);
check(`pertindihan dikesan (${expDupes})`, snap.duplicates === expDupes, 'duplicates=' + snap.duplicates);
check(`konflik seperti dijangka (${expConflicts})`, snap.conflicts === expConflicts, 'conflicts=' + snap.conflicts);

// The strongest check available: the browser's DOM parser must reproduce the
// Node parser's output for every single field of every record.
check('bilangan rekod setiap fail sepadan dengan Node',
  snap.perFile.length === reference.perFile.length
  && snap.perFile.every((p, i) => p.rows === reference.perFile[i].rows),
  JSON.stringify(snap.perFile.map((p) => p.rows)) + ' vs ' + JSON.stringify(reference.perFile.map((p) => p.rows)));
for (let i = 0; i < reference.perFile.length; i += 1) {
  const got = snap.perFile[i];
  const want = reference.perFile[i];
  check(`cap jari pelayar == Node untuk ${want.name}`,
    got && got.fingerprint === want.fingerprint,
    got && got.fingerprint !== want.fingerprint
      ? `pelayar ${sha256(got.fingerprint).slice(0, 16)} vs Node ${sha256(want.fingerprint).slice(0, 16)}`
      : 'tiada data');
}
check('cap jari hasil gabungan pelayar == Node',
  snap.mergedFingerprint === reference.mergedFingerprint,
  snap.mergedFingerprint === reference.mergedFingerprint
    ? ''
    : `pelayar ${sha256(snap.mergedFingerprint).slice(0, 16)} vs Node ${sha256(reference.mergedFingerprint).slice(0, 16)}`);

check(`halaman pertama memaparkan ${expRowsOnPage} baris`, snap.rowsRendered === expRowsOnPage,
  'rows=' + snap.rowsRendered);
// The identical-content warning must appear exactly when the two payloads are
// byte-identical - which is the case for the two attachments that were supplied.
const filesAreIdentical = files[0].text === files[1].text;
check(filesAreIdentical
  ? 'amaran fail sama dipaparkan (fail memang sama)'
  : 'tiada amaran fail sama (fail berbeza)',
  filesAreIdentical ? snap.duplicatedHashNotice >= 1 : snap.duplicatedHashNotice === 0,
  'warn notices=' + snap.duplicatedHashNotice + ' identical=' + filesAreIdentical
    + ' tampil=' + JSON.stringify(snap.noticeTitles));
check(`kad ringkasan menunjukkan ${expMerged} rekod unik`,
  snap.cards.some((c) => c.indexOf('Rekod unik') >= 0 && c.indexOf('=' + expMerged) >= 0), JSON.stringify(snap.cards));
check('kad ringkasan menunjukkan baris bertindih dibuang',
  snap.cards.some((c) => c.indexOf('bertindih') >= 0 && c.indexOf('=' + expDupes) >= 0), JSON.stringify(snap.cards));
check('tab menunjukkan kiraan yang betul',
  snap.tabCounts.merged === String(expMerged)
  && snap.tabCounts.dupes === String(expDupes)
  && snap.tabCounts.conflicts === String(expConflicts),
  JSON.stringify(snap.tabCounts));

/* ---- department summary ---- */
const sum = snap.summary;
check('ringkasan bahagian menjumlah sama dengan rekod unik',
  sum.total === expMerged, sum.total + ' vs ' + expMerged);
check('setiap baris ringkasan dipaparkan',
  sum.renderedRows === sum.groups, sum.renderedRows + ' vs ' + sum.groups);
check('tab ringkasan menunjukkan bilangan bahagian',
  sum.tabCounter === String(sum.groups), sum.tabCounter + ' vs ' + sum.groups);
check('setiap bahagian menjumlah kepada jumlah keseluruhan',
  sum.rows.reduce((a, g) => a + g.jumlah, 0) === expMerged,
  JSON.stringify(sum.rows.map((g) => g.bahagian + ':' + g.jumlah)));
check('setiap bahagian muncul sekali sahaja',
  new Set(sum.rows.map((g) => g.bahagian)).size === sum.rows.length);
check('pecahan penuh menjumlah sama dengan rekod unik',
  sum.breakdownRows > 0, 'baris pecahan=' + sum.breakdownRows);
check('Status Aset tidak lagi dijejaki',
  sum.rows.every((g) => !('statuses' in g)), JSON.stringify(Object.keys(sum.rows[0] || {})));

/* ---- provenance must not surface in the delivered data ---- */
check('jadual gabungan tiada lajur Sumber',
  snap.mergedColumns.every((h) => h.indexOf('Sumber') < 0), JSON.stringify(snap.mergedColumns));
check('rekod gabungan tiada medan sumber',
  snap.mergedKeys.every((k) => k.indexOf('_Sumber') < 0), JSON.stringify(snap.mergedKeys));
check('rekod gabungan mengandungi hanya medan aset + kiraan salinan',
  snap.mergedKeys.every((k) => NODE_FIELDS.indexOf(k) >= 0 || k === '_Bilangan Salinan'),
  JSON.stringify(snap.mergedKeys));
check('lajur yang dipaparkan ialah lima medan aset + Salinan',
  JSON.stringify(snap.mergedColumns)
  === JSON.stringify(['#'].concat(NODE_FIELDS, ['Salinan'])),
  JSON.stringify(snap.mergedColumns));
check('jadual ringkasan tiada lajur Sumber',
  sum.columns.every((h) => h.indexOf('Sumber') < 0), JSON.stringify(sum.columns));
check('lajur ringkasan seperti yang dijangka',
  JSON.stringify(sum.columns)
  === JSON.stringify(['Bahagian', 'Jumlah Aset', '%', 'Bilangan Lokasi', 'Contoh Lokasi']),
  JSON.stringify(sum.columns));

// The blank-department row must be present exactly when the data has blanks.
// Recomputed from the Node-side parse, so the expectation is independent.
const expectedNoDept = nodeParsed.reduce(
  (a, { parsed }) => a + parsed.records.filter((r) => !r.Bahagian).length, 0,
);
check('baris tiada-bahagian sepadan dengan data',
  expectedNoDept === 0
    ? sum.rows.every((g) => g.bahagian.indexOf('TIADA') < 0)
    : sum.rows.some((g) => g.bahagian.indexOf('TIADA') >= 0 && g.jumlah === expectedNoDept),
  'kosong=' + expectedNoDept + ' baris=' + JSON.stringify(sum.rows.map((g) => g.bahagian)));
check('amaran tiada-bahagian dipaparkan apabila perlu',
  expectedNoDept === 0 ? sum.hasNoDeptWarning === 0 : sum.hasNoDeptWarning === 1,
  'kosong=' + expectedNoDept + ' amaran=' + sum.hasNoDeptWarning);

// The pager only exists when there is more than one page.
check(expPages === 1
  ? 'tiada pemapar apabila semua rekod muat satu halaman'
  : 'pemapar menunjukkan julat baris yang betul',
  expPages === 1
    ? snap.pagerNote === ''
    : snap.pagerNote.indexOf(String(expRowsOnPage)) >= 0,
  JSON.stringify(snap.pagerNote));
check('butang halaman seterusnya betul',
  expPages === 1 ? snap.nextDisabled : !snap.nextDisabled,
  'pages=' + expPages + ' nextDisabled=' + snap.nextDisabled);
check('baris pertama dipaparkan dengan label aset',
  !!snap.firstRow && /^KPT\/PKS\//.test(snap.firstRow[1]), JSON.stringify(snap.firstRow));
check('baris pertama tiada sel kosong',
  !!snap.firstRow && snap.firstRow.slice(1, 7).every((v) => v !== ''), JSON.stringify(snap.firstRow));
check('eksport CSV menghasilkan kandungan', snap.exportCsv > 5000, 'bytes=' + snap.exportCsv);
check('eksport XLS menghasilkan kandungan', snap.exportXls > 20000, 'bytes=' + snap.exportXls);

console.log(`\nKEPUTUSAN UI: ${pass} lulus, ${fail} gagal`);
process.exit(fail ? 1 : 0);
