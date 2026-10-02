/*
 * tests/run-tests.mjs - regression suite for parser.mjs.
 *
 *   node tests/run-tests.mjs [fixture.xls]
 *
 * Every case in here corresponds to a real bug found while building this app.
 * Exit code is non-zero when anything fails.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseFile, parseHtmlTable, parseCsv, parseJson, parseCsv as _parseCsv,
  mergeSources, toCsv, toHtmlWorkbook, toJson, detectFormat,
  cleanText, normaliseLabel, FIELDS,
  buildHistory, diffLabels, departmentProgress, historyRows, historyRunRows,
  HISTORY_COLUMNS, HISTORY_RUN_COLUMNS, LABEL_STATUS,
} from '../src/parser.mjs';
import {
  LIMITS, SUPPORTED_EXT, classifyFile, collectDrop, extOf, isSupportedName,
  pickFromFolderInput, walkEntries,
} from '../src/intake.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    failures.push(name + (detail ? ` -> ${detail}` : ''));
    console.log(`  FAIL ${name}${detail ? `  -> ${detail}` : ''}`);
  }
}

function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `expected ${e}, got ${a}`);
}

function section(title) {
  console.log(`\n== ${title} ==`);
}

const fixtureCandidates = [
  process.argv[2],
  process.env.JKM_FIXTURE,
  join(root, 'fixture', 'Senarai_Aset_Belum_Periksa_ABR_JKM.xls'),
  join(root, 'fixture', 'Senarai_Aset_Belum_Periksa_JKM.xls'),
].filter(Boolean);
const fixturePath = fixtureCandidates.find((p) => p && existsSync(p));

// A second real file, when present, lets the suite test a genuine merge of two
// DIFFERENT reports rather than one file against itself.
const secondCandidates = [
  process.env.JKM_FIXTURE_B,
  join(root, 'fixture', 'Senarai_Aset_Belum_Periksa_HM_JKM.xls'),
].filter(Boolean);
const secondPath = secondCandidates.find((p) => p && existsSync(p));

/* ================================================================== *
 * 1. cleanText must not destroy angle brackets in real data
 * ================================================================== */
section('cleanText');
eq('plain text unchanged', cleanText('AIR COMPRESSOR'), 'AIR COMPRESSOR');
eq('angle brackets in data survive', cleanText('A & B <X>'), 'A & B <X>');
eq('real markup is stripped', cleanText('<b>Label</b>'), 'Label');
eq('nested markup is stripped', cleanText('GERGAJI <font size="2">&amp;</font> MESIN'), 'GERGAJI & MESIN');
eq('prose with comparison operators survives', cleanText('a < b and c > d'), 'a < b and c > d');
eq('entities decoded', cleanText('MESIN &amp; ALAT&nbsp;KECIL'), 'MESIN & ALAT KECIL');
eq('whitespace collapsed', cleanText('  A \t\n B  '), 'A B');
eq('repeated calls are stable', cleanText(cleanText('<b>X</b>')), 'X');

section('normaliseLabel');
eq('separators collapsed', normaliseLabel('kpt/pks/h/89/91'), 'KPT/PKS/H/89/91');
eq('internal spaces removed', normaliseLabel('KPT / PKS / H / 1 / 2'), 'KPT/PKS/H/1/2');

/* ================================================================== *
 * 2. HTML parsing - the malformed-JKM-export case
 * ================================================================== */
section('HTML: malformed export with merged header/first-data row');
const jkmHtml = '<table>'
  + '<tr>'
  + '<td><b>Label</b></td><td><b>Jenis Aset</b></td><td><b>Pegawai Penempatan</b></td>'
  + '<td><b>Bahagian</b></td><td><b>Lokasi Terkini</b></td><td><b>Status Aset</b></td>'
  + '<td>KPT/PKS/H/89/91</td><td>AIR COMPRESSOR MACHINE</td>'
  + '<td>THANDAYUTHAPANI A/L SEPERAMANIAM</td><td>JABATAN KEJURUUTERAAN MEKANIKAL</td>'
  + '<td>BENGKEL LOJI</td><td>Sedang Digunakan</td>'
  + '</tr>'
  + '<tr><td>KPT/PKS/H/10/115</td><td>ALAT HAWA DINGIN</td><td>NORPARINA BINTI SULIMAN</td>'
  + '<td>UNIT LATIHAN</td><td>STOR 1</td><td>Sedang Digunakan</td></tr>'
  + '</table>';

const merged = parseHtmlTable(jkmHtml, { engine: 'scan' });
eq('merged header/data row yields 2 records', merged.records.length, 2);
eq('header reported as 6 columns', merged.meta.width, 6);
eq('first record is the merged data row', merged.records[0].Label, 'KPT/PKS/H/89/91');
eq('first record fields are aligned', merged.records[0]['Jenis Aset'], 'AIR COMPRESSOR MACHINE');
eq('no header text leaked into data',
  merged.records.some((r) => r.Label === 'LABEL'), false);
eq('second record parsed', merged.records[1].Label, 'KPT/PKS/H/10/115');
check('no "header ignored" warning',
  merged.warnings.every((w) => w.indexOf('Baris tajuk diabaikan') < 0), merged.warnings.join(' | '));

/* ================================================================== *
 * 3. HTML parsing - table selection and narrow headers
 * ================================================================== */
section('HTML: multi-table page');
const multiTable = '<html><body>'
  + '<table><tr><td>JABATAN KEJURUTERAAN MEKANIKAL</td></tr></table>'
  + '<table><tr><td>Jumlah</td><td>2</td></tr></table>'
  + '<table><tr><td><b>Label</b></td><td><b>Jenis Aset</b></td><td><b>Pegawai Penempatan</b></td>'
  + '<td><b>Bahagian</b></td><td><b>Lokasi Terkini</b></td><td><b>Status Aset</b></td></tr>'
  + '<tr><td>KPT/PKS/H/7/1</td><td>MESIN A</td><td>ALI</td><td>JAB A</td><td>STOR 1</td><td>Sedang Digunakan</td></tr>'
  + '<tr><td>KPT/PKS/H/7/2</td><td>MESIN B</td><td>ABU</td><td>JAB B</td><td>STOR 2</td><td>Sedang Digunakan</td></tr>'
  + '</table></body></html>';
const mt = parseHtmlTable(multiTable, { engine: 'scan' });
eq('data table chosen over wrapper tables', mt.records.length, 2);
eq('labels correct', mt.records.map((r) => r.Label), ['KPT/PKS/H/7/1', 'KPT/PKS/H/7/2']);
check('wrapper text not emitted',
  mt.records.every((r) => r.Label.indexOf('JABATAN') < 0 && r.Label.indexOf('Jumlah') < 0));

/* ================================================================== *
 * 3b. Several sheets in ONE file
 *
 * An HTML export of a workbook writes each sheet as its own <table>. An upload
 * IS the whole outstanding list, so reading only the biggest sheet would make
 * the other sheets look as if their assets had been inspected. Every table whose
 * header matches the chosen one is therefore read as the same list - and a title
 * wrapper or summary (different head) is still left out.
 * ================================================================== */
section('HTML: one file, several sheets');
const HEAD_HTML = '<tr><td><b>Label</b></td><td><b>Jenis Aset</b></td><td><b>Pegawai Penempatan</b></td>'
  + '<td><b>Bahagian</b></td><td><b>Lokasi Terkini</b></td><td><b>Status Aset</b></td></tr>';
const sheetRow = (n, dept) => `<tr><td>KPT/PKS/H/${n}</td><td>MESIN ${n}</td><td>ALI</td>`
  + `<td>${dept}</td><td>STOR ${n}</td><td>Sedang Digunakan</td></tr>`;
const manySheets = '<html><body>'
  + '<table><tr><td><b>LAPORAN ASET</b></td></tr></table>'
  + `<table>${HEAD_HTML}${sheetRow('1/1', 'JAB A')}${sheetRow('1/2', 'JAB A')}${sheetRow('1/3', 'JAB A')}</table>`
  + `<table>${HEAD_HTML}${sheetRow('2/1', 'JAB B')}</table>`
  + '<table><tr><td>Jumlah</td><td>4</td></tr></table>'
  + '</body></html>';
const sheets = parseHtmlTable(manySheets, { engine: 'scan' });
eq('every sheet is read, not only the biggest', sheets.records.length, 4);
eq('labels come from both sheets',
  sheets.records.map((r) => r.Label).sort(), ['KPT/PKS/H/1/1', 'KPT/PKS/H/1/2', 'KPT/PKS/H/1/3', 'KPT/PKS/H/2/1']);
eq('the second sheet keeps its own Bahagian',
  sheets.records.filter((r) => r.Bahagian === 'JAB B').length, 1);
check('the header row of the second sheet is not emitted as an asset',
  sheets.records.every((r) => r.Label !== 'Label' && r.Label.indexOf('Status') < 0));
check('no title or summary text leaks in',
  sheets.records.every((r) => r.Label.indexOf('LAPORAN') < 0 && r.Label.indexOf('Jumlah') < 0));

/* A table with the same first column name but a different shape must NOT be
   merged: only a header that matches column for column is another sheet. */
const lookalike = '<html><body>'
  + `<table>${HEAD_HTML}${sheetRow('3/1', 'JAB C')}</table>`
  + '<table><tr><td>Label</td><td>Bilangan</td></tr><tr><td>Jumlah</td><td>9</td></tr></table>'
  + '</body></html>';
const look = parseHtmlTable(lookalike, { engine: 'scan' });
eq('a lookalike summary table is not merged', look.records.length, 1);
eq('its rows stay out', look.records[0].Label, 'KPT/PKS/H/3/1');

section('HTML: comment mentioning a table');
const withComment = '<!-- Exactly ONE <table> so re-importing is unambiguous. -->'
  + '<table><tr><td>Label</td><td>Jenis Aset</td><td>Pegawai Penempatan</td>'
  + '<td>Bahagian</td><td>Lokasi Terkini</td><td>Status Aset</td></tr>'
  + '<tr><td>KPT/PKS/H/9/1</td><td>MESIN C</td><td>ALI</td><td>JAB</td><td>STOR</td><td>Sedang Digunakan</td></tr>'
  + '</table>';
const wc = parseHtmlTable(withComment, { engine: 'scan' });
eq('comment text ignored', wc.records.length, 1);
eq('comment text not in header', wc.meta.width, 6);

section('HTML: header narrower than the data');
const narrow = '<table><tr><th>Label</th><th>Jenis Aset</th></tr>'
  + '<tr><td>KPT/PKS/H/3/3</td><td>GERGAJI &amp; MESIN &nbsp;KECIL</td></tr></table>';
const nar = parseHtmlTable(narrow, { engine: 'scan' });
eq('one record', nar.records.length, 1);
eq('label mapped to column 0', nar.records[0].Label, 'KPT/PKS/H/3/3');
eq('asset type mapped to column 1', nar.records[0]['Jenis Aset'], 'GERGAJI & MESIN KECIL');
eq('absent fields are empty strings',
  [nar.records[0].Bahagian, nar.records[0]['Lokasi Terkini']], ['', '']);

/* ================================================================== *
 * The retired "Status Aset" column: the source exports still carry it, so the
 * parser must read past it. This is the case that, when handled naively, shifts
 * every field by one and emits the header as a phantom first record.
 * ================================================================== */
section('HTML: source is 6 columns wide but only 5 fields are tracked');
const sixCol = '<table><tr>'
  + '<td><b>Label</b></td><td><b>Jenis Aset</b></td><td><b>Pegawai Penempatan</b></td>'
  + '<td><b>Bahagian</b></td><td><b>Lokasi Terkini</b></td><td><b>Status Aset</b></td>'
  + '<td>KPT/PKS/H/89/91</td><td>AIR COMPRESSOR MACHINE</td>'
  + '<td>THANDAYUTHAPANI A/L SEPERAMANIAM</td><td>JABATAN KEJURUTERAAN MEKANIKAL</td>'
  + '<td>BENGKEL LOJI</td><td>Sedang Digunakan</td>'
  + '</tr>'
  + '<tr><td>KPT/PKS/H/10/115</td><td>ALAT HAWA DINGIN</td><td>NORPARINA BINTI SULIMAN</td>'
  + '<td>UNIT LATIHAN</td><td>STOR 1</td><td>Sedang Digunakan</td></tr>'
  + '</table>';
const six = parseHtmlTable(sixCol, { engine: 'scan' });
eq('two records, no phantom header record', six.records.length, 2);
eq('source width detected as 6', six.meta.width, 6);
eq('header mapped for the 5 tracked fields', six.meta.columns.slice(0, FIELDS.length), FIELDS);
eq('the untracked 6th column is reported as such',
  six.meta.columns[FIELDS.length], '(tidak dijejaki)');
eq('first record is the data row, not the header', six.records[0].Label, 'KPT/PKS/H/89/91');
eq('fields are not shifted by the extra column',
  [six.records[0]['Jenis Aset'], six.records[0].Bahagian, six.records[0]['Lokasi Terkini']],
  ['AIR COMPRESSOR MACHINE', 'JABATAN KEJURUTERAAN MEKANIKAL', 'BENGKEL LOJI']);
eq('second record parsed', six.records[1].Label, 'KPT/PKS/H/10/115');
check('the status value never reaches a record',
  six.records.every((r) => FIELDS.every((f) => r[f] !== 'Sedang Digunakan' && r[f] !== 'STATUSASET')),
  JSON.stringify(six.records));
check('no header text leaked into the data',
  six.records.every((r) => r.Label !== 'LABEL' && r.Label !== 'STATUSASET'));
check('no warning about the header',
  six.warnings.length === 0, six.warnings.join(' | '));

// The same file WITHOUT the extra column must also parse identically.
const fiveCol = sixCol
  .replace('<td><b>Status Aset</b></td>', '')
  .replace(/<td>Sedang Digunakan<\/td>/g, '');
const five = parseHtmlTable(fiveCol, { engine: 'scan' });
eq('5-column source: same records', five.records.map((r) => FIELDS.map((f) => r[f])),
  six.records.map((r) => FIELDS.map((f) => r[f])));
eq('5-column source: width 5', five.meta.width, 5);

section('HTML: <th> header with entities and nested markup');
const thHtml = '<table><tr><th>Label</th><th>Jenis Aset</th></tr>'
  + '<tr><td><b>KPT/PKS/H/5/5</b></td><td>MESIN <i>KHAS</i></td></tr></table>';
const th = parseHtmlTable(thHtml, { engine: 'scan' });
eq('one record', th.records.length, 1);
eq('markup stripped from label', th.records[0].Label, 'KPT/PKS/H/5/5');
eq('markup stripped from asset type', th.records[0]['Jenis Aset'], 'MESIN KHAS');

/* ================================================================== *
 * 4. Format detection
 * ================================================================== */
section('detectFormat');
eq('leading script then table => html', detectFormat('\r\n\r\n<script>x</script><table><tr><td>a</td></tr></table>', 'x.xls'), 'html');
eq('json extension => json', detectFormat('{"rekod":[]}', 'x.json'), 'json');
eq('bare array => json', detectFormat('[{"Label":"a"}]', 'x.txt'), 'json');
eq('markup wins over json-ish name', detectFormat('<table><tr><td>{</td></tr></table>', 'a.json'), 'html');
eq('csv extension => csv', detectFormat('Label,Jenis Aset\nA,B', 'x.csv'), 'csv');
eq('binary xls sniffed', detectFormat('\u00d0\u00cf\u0011\u00e0zzz', 'real.xls'), 'binary-excel');
eq('xlsx zip sniffed', detectFormat('PK\u0003\u0004zzz', 'real.xlsx'), 'binary-excel');

section('binary Excel is rejected with guidance');
let binaryMsg = '';
try { parseFile('\u00d0\u00cf\u0011\u00e0\u00a1\u00b1\u001a\u00e1', 'real.xls'); } catch (e) { binaryMsg = e.message; }
check('error mentions HTML or CSV', /HTML|CSV/.test(binaryMsg), binaryMsg);

/* ================================================================== *
 * 5. CSV
 * ================================================================== */
section('CSV');
const csv1 = 'Label,Jenis Aset,Pegawai Penempatan,Bahagian,Lokasi Terkini,Status Aset\r\n'
  + 'KPT/PKS/H/1/1,"MESIN, KECIL",ALI BIN ABU,JABATAN A,STOR 1,Sedang Digunakan\r\n';
const c1 = parseFile(csv1, 'x.csv');
eq('one record', c1.records.length, 1);
eq('quoted comma preserved', c1.records[0]['Jenis Aset'], 'MESIN, KECIL');

const csv2 = 'Label;Jenis Aset;Pegawai Penempatan;Bahagian;Lokasi Terkini;Status Aset\n'
  + 'KPT/PKS/H/2/2;MESIN B;ABU BIN ALI;JABATAN B;STOR 2;Sedang Digunakan\n';
eq('semicolon delimiter detected', parseFile(csv2, 'y.csv').records.length, 1);

const csv3 = '\uFEFFLabel\tJenis Aset\nKPT/PKS/H/3/3\tMESIN C\n';
const c3 = parseFile(csv3, 'z.tsv');
eq('tab delimiter + BOM', c3.records.length, 1);
eq('tab-parsed value', c3.records[0]['Jenis Aset'], 'MESIN C');

const csv4 = 'Label,Jenis Aset,Pegawai Penempatan,Bahagian,Lokasi Terkini,Status Aset\n'
  + 'KPT/PKS/H/4/4,"MESIN ""PETIK"" KHAS",ALI,JAB,STOR,Sedang Digunakan\n';
eq('escaped double quotes', parseFile(csv4, 'q.csv').records[0]['Jenis Aset'], 'MESIN "PETIK" KHAS');

eq('CSV with no header uses default order',
  parseFile('KPT/PKS/H/6/6,MESIN D,ALI,JAB,STOR,Sedang Digunakan\n', 'n.csv').records[0].Label,
  'KPT/PKS/H/6/6');

/* ================================================================== *
 * 6. JSON
 * ================================================================== */
section('JSON');
eq('bare array', parseJson('[{"Label":"a","Jenis Aset":"b"}]').records.length, 1);
eq('rekod wrapper', parseJson('{"rekod":[{"Label":"a","Jenis Aset":"b"}]}').records.length, 1);
eq('records wrapper', parseJson('{"records":[{"Label":"a","Jenis Aset":"b"}]}').records.length, 1);
eq('data wrapper', parseJson('{"data":[{"Label":"a","Jenis Aset":"b"}]}').records.length, 1);
eq('unknown wrapper found by scan', parseJson('{"senarai":{"x":1},"keputusan":[{"Label":"a","Jenis Aset":"b"}]}').records.length, 1);
let jsonErr = '';
try { parseJson('{"nope":1}'); } catch (e) { jsonErr = e.message; }
check('no array gives a clear error', /tatasusunan/.test(jsonErr), jsonErr);
let jsonParseErr = '';
try { parseJson('{not json'); } catch (e) { jsonParseErr = e.message; }
check('invalid JSON gives a clear error', /tidak sah/.test(jsonParseErr), jsonParseErr);

/* ================================================================== *
 * 7. Export round-trips (including extension columns)
 * ================================================================== */
section('Export round-trips');
const exportRows = [{
  Label: 'KPT/PKS/H/4/4',
  'Jenis Aset': 'A & B <X>',
  'Pegawai Penempatan': 'P',
  Bahagian: 'B',
  'Lokasi Terkini': 'L',
  '_Bilangan Salinan': 1,
}];

const htmlOut = toHtmlWorkbook(exportRows, { generatedAt: 'x' });
const htmlBack = parseHtmlTable(htmlOut, { engine: 'scan' });
eq('HTML export round-trips to 1 record', htmlBack.records.length, 1);
eq('HTML export keeps special characters', htmlBack.records[0]['Jenis Aset'], 'A & B <X>');
eq('HTML export keeps the label', htmlBack.records[0].Label, 'KPT/PKS/H/4/4');
eq('exactly one table in the export', (htmlOut.match(/<table\b/g) ?? []).length, 1);

const csvOut = toCsv(exportRows);
check('CSV starts with a UTF-8 BOM', csvOut.charCodeAt(0) === 0xFEFF);
const csvBack = parseFile(csvOut, 'b.csv');
eq('CSV export round-trips to 1 record', csvBack.records.length, 1);
eq('CSV export keeps special characters', csvBack.records[0]['Jenis Aset'], 'A & B <X>');
eq('CSV export keeps the label', csvBack.records[0].Label, 'KPT/PKS/H/4/4');

const jsonOut = toJson(exportRows, { generatedAt: 'now' });
const jsonBack = parseFile(jsonOut, 'r.json');
eq('JSON export round-trips to 1 record', jsonBack.records.length, 1);
eq('JSON export keeps the label', jsonBack.records[0].Label, 'KPT/PKS/H/4/4');

section('Extension columns do not pollute asset fields');
// 5 tracked asset fields + 1 extension column (Bilangan Salinan).
// "Sumber Fail" is deliberately NOT exported: provenance is not asset data.
eq('export header count', (toCsv(exportRows).split('\r\n')[0].split(',').length), 6);
check('export does not contain a source column',
  toCsv(exportRows).split('\r\n')[0].indexOf('Sumber') < 0,
  toCsv(exportRows).split('\r\n')[0]);
check('no extension marker leaks into a record',
  FIELDS.every((f) => String(csvBack.records[0][f]).indexOf('\u200B') < 0),
  JSON.stringify(csvBack.records[0]));

/* ================================================================== *
 * 8. Merge engine
 * ================================================================== */
section('mergeSources');
const mk = (label, jenis, lokasi) => ({
  Label: label, 'Jenis Aset': jenis, 'Pegawai Penempatan': 'P',
  Bahagian: 'B', 'Lokasi Terkini': lokasi,
});
const srcA = [mk('KPT/PKS/H/1/1', 'MESIN A', 'STOR 1'), mk('KPT/PKS/H/1/2', 'MESIN B', 'STOR 2')];
const srcB = [mk('KPT/PKS/H/1/1', 'MESIN A', 'STOR 1'), mk('KPT/PKS/H/1/2', 'MESIN B', 'STOR 9')];

const m1 = mergeSources([
  { fileName: 'a.xls', label: 'a.xls', records: srcA, warnings: [] },
  { fileName: 'b.xls', label: 'b.xls', records: srcB, warnings: [] },
]);
eq('two unique records', m1.merged.length, 2);
eq('two duplicates', m1.duplicates.length, 2);
// Only 1/2 genuinely differs; 1/1 is repeated with identical values and must not
// be reported as a conflict.
eq('one conflict, for the differing label only', m1.conflicts.length, 1);
eq('conflict is on the expected label', m1.conflicts[0].label, 'KPT/PKS/H/1/2');
eq('conflict field identified', m1.conflicts[0].differing, ['Lokasi Terkini']);
eq('value from the FIRST source is retained', m1.conflicts[0].existing['Lokasi Terkini'], 'STOR 2');
eq('conflicting value recorded', m1.conflicts[0].incoming['Lokasi Terkini'], 'STOR 9');
eq('conflicts are sorted by label',
  m1.conflicts.map((c) => c.label), [...m1.conflicts.map((c) => c.label)].sort());
eq('copy count', m1.merged[0]['_Bilangan Salinan'], 2);
// Provenance is tracked internally for the conflict report, but must NOT be
// attached to the merged records that get exported.
check('merged records carry no source column',
  m1.merged.every((r) => !('_Sumber' in r)), JSON.stringify(Object.keys(m1.merged[0])));
check('merged records contain only asset fields plus the copy count',
  m1.merged.every((r) => Object.keys(r).every((k) => FIELDS.indexOf(k) >= 0 || k === '_Bilangan Salinan')),
  JSON.stringify(Object.keys(m1.merged[0])));
// The conflict report still names the file, which is where it belongs.
eq('conflict report still names the file', m1.conflicts[0].fileName, 'b.xls');

// An identical repeat must produce no conflict at all.
const mSame = mergeSources([
  { fileName: 'a.xls', label: 'a.xls', records: [mk('KPT/PKS/H/1/1', 'MESIN A', 'STOR 1')], warnings: [] },
  { fileName: 'b.xls', label: 'b.xls', records: [mk('KPT/PKS/H/1/1', 'MESIN A', 'STOR 1')], warnings: [] },
]);
eq('identical duplicate is not a conflict', mSame.conflicts.length, 0);
eq('identical duplicate still counted', mSame.duplicates.length, 1);

const m2 = mergeSources([{ fileName: 'a.xls', label: 'a.xls', records: srcA, warnings: [] }]);
eq('single source: no duplicates', m2.duplicates.length, 0);
eq('single source: no conflicts', m2.conflicts.length, 0);
eq('single source: all added', m2.sourceStats[0].added, 2);

const mFull = mergeSources([
  { fileName: 'a.xls', label: 'a.xls', records: srcA, warnings: [] },
  { fileName: 'b.xls', label: 'b.xls', records: srcB, warnings: [] },
], { keyStrategy: 'full' });
eq('full-row key: differing rows not merged', mFull.merged.length, 3);

const mType = mergeSources([
  { fileName: 'a.xls', label: 'a.xls', records: srcA, warnings: [] },
  { fileName: 'b.xls', label: 'b.xls', records: srcB, warnings: [] },
], { keyStrategy: 'labelAndType' });
eq('label+type key: same result here', mType.merged.length, 2);

const emptyLabel = mergeSources([{
  fileName: 'a.xls', label: 'a.xls', warnings: [],
  records: [{ ...mk('', 'MESIN X', 'S') }, { ...mk('', 'MESIN X', 'S') }],
}]);
eq('blank labels still merge by full row', emptyLabel.merged.length, 1);
/* ================================================================== *
 * 9. Real files, when available
 *
 * The real ABR report holds ~473 labels and HM ~63, with no overlap between
 * them, so the union is the sum. Nothing here is hard-coded to a particular
 * count: the file itself tells us how many records it holds.
 * ================================================================== */
if (!fixturePath) {
  section('Fail sebenar');
  console.log('  skipped (tiada fail dalam fixture/)');
} else {
  const nameA = fixturePath.split(/[\\/]/).pop();
  section(`Fail sebenar: ${nameA}`);
  const realText = readFileSync(fixturePath, 'utf8');
  const scan = parseHtmlTable(realText, { engine: 'scan' });
  const nA = scan.records.length;

  check(`sekurang-kurangnya satu rekod dibaca (${nA})`, nA > 0);
  // The source files are 6 columns wide; we track 5 and read past the 6th
  // (the retired "Status Aset" column) without shifting any field.
  eq('lebar lajur sumber 6', scan.meta.width, 6);
  eq('lima medan pertama dipetakan', scan.meta.columns.slice(0, FIELDS.length), FIELDS);
  eq('lajur keenam tidak dijejaki', scan.meta.columns[FIELDS.length], '(tidak dijejaki)');
  check('tiada amaran penghuraian', scan.warnings.length === 0, scan.warnings.join(' | '));
  check('setiap label kelihatan seperti id aset',
    scan.records.every((r) => /^[A-Z0-9]+(\/[A-Z0-9.\-]+)+$/.test(r.Label)),
    JSON.stringify(scan.records.map((r) => r.Label).filter((l) => !/^[A-Z0-9]+(\/[A-Z0-9.\-]+)+$/.test(l)).slice(0, 5)));
  check('setiap label unik - satu aset = satu label',
    new Set(scan.records.map((r) => r.Label)).size === nA);
  check('tiada teks tajuk masuk ke dalam data',
    scan.records.every((r) => r.Label !== 'LABEL' && r['Jenis Aset'] !== 'Jenis Aset'));
  check('setiap rekod mempunyai label dan jenis aset',
    scan.records.every((r) => r.Label !== '' && r['Jenis Aset'] !== ''));
  check('tiada medan Status Aset pada mana-mana rekod',
    scan.records.every((r) => !('Status Aset' in r)));
  const gaps = scan.records.filter((r) => FIELDS.some((f) => r[f] === ''));
  check('kekosongan medan hanya berlaku pada medan bukan-kunci',
    gaps.every((r) => r.Label && r['Jenis Aset']),
    JSON.stringify(gaps.slice(0, 3)));
  console.log(`      (${gaps.length} rekod mempunyai sekurang-kurangnya satu medan kosong, daripada ${nA})`);

  // A single file merged with itself must fully collapse - no double counting.
  const selfMerge = mergeSources([
    { fileName: nameA, label: nameA, records: scan.records, warnings: [] },
    { fileName: nameA, label: nameA, records: scan.records, warnings: [] },
  ]);
  eq(`fail sama digabung dengan dirinya kekal ${nA} unik`, selfMerge.merged.length, nA);
  eq('semua baris kedua dikira bertindih', selfMerge.duplicates.length, nA);
  eq('tiada konflik', selfMerge.conflicts.length, 0);

  // Re-exporting and re-importing the real data must be lossless. Rows are
  // compared by label because merged output is sorted while the input is not.
  const byLabel = (records) => {
    const m = new Map();
    records.forEach((r) => m.set(r.Label, FIELDS.map((f) => r[f])));
    return m;
  };
  const originalByLabel = byLabel(scan.records);

  function sameData(label, records) {
    if (records.length !== nA) return `${label}: count ${records.length} vs ${nA}`;
    const got = byLabel(records);
    for (const [key, expected] of originalByLabel) {
      if (!got.has(key)) return `${label}: missing ${key}`;
      if (JSON.stringify(got.get(key)) !== JSON.stringify(expected)) {
        return `${label}: ${key} differs (expected ${JSON.stringify(expected)}, got ${JSON.stringify(got.get(key))})`;
      }
    }
    return '';
  }

  const exported = toHtmlWorkbook(scan.records, { generatedAt: 'x' });
  const reimported = parseHtmlTable(exported, { engine: 'scan' });
  eq(`eksport XLS dibaca semula: ${nA} rekod`, reimported.records.length, nA);
  const htmlDiff = sameData('HTML', reimported.records);
  check('eksport XLS: setiap rekod identik', htmlDiff === '', htmlDiff);

  const exportedCsv = toCsv(scan.records);
  const reimportedCsv = parseFile(exportedCsv, 'x.csv');
  eq(`eksport CSV dibaca semula: ${nA} rekod`, reimportedCsv.records.length, nA);
  const csvDiff = sameData('CSV', reimportedCsv.records);
  check('eksport CSV: setiap rekod identik', csvDiff === '', csvDiff);

  /* ---- a genuine merge of two DIFFERENT real reports ---- */
  if (secondPath) {
    const nameB = secondPath.split(/[\\/]/).pop();
    section(`Gabungan sebenar: ${nameA} + ${nameB}`);
    const secondText = readFileSync(secondPath, 'utf8');
    const scanB = parseHtmlTable(secondText, { engine: 'scan' });
    const nB = scanB.records.length;
    check(`fail kedua dibaca (${nB} rekod)`, nB > 0);
    check('fail kedua tiada amaran', scanB.warnings.length === 0, scanB.warnings.join(' | '));

    const labelsA = new Set(scan.records.map((r) => r.Label));
    const labelsB = new Set(scanB.records.map((r) => r.Label));
    const shared = [...labelsB].filter((l) => labelsA.has(l));
    const union = new Set([...labelsA, ...labelsB]);
    console.log(`      ${nA} + ${nB} rekod, ${shared.length} label kongsi, kesatuan ${union.size}`);

    const realMerge = mergeSources([
      { fileName: nameA, label: nameA, records: scan.records, warnings: [] },
      { fileName: nameB, label: nameB, records: scanB.records, warnings: [] },
    ]);
    eq('rekod unik sama dengan kesatuan label', realMerge.merged.length, union.size);
    eq('pertindihan sama dengan label kongsi', realMerge.duplicates.length, shared.length);
    check('tiada label hilang dari fail pertama',
      scan.records.every((r) => realMerge.merged.some((m) => m.Label === r.Label)));
    check('tiada label hilang dari fail kedua',
      scanB.records.every((r) => realMerge.merged.some((m) => m.Label === r.Label)));
    check('setiap rekod hanya mengandungi medan aset',
      realMerge.merged.every((r) => Object.keys(r).every(
        (k) => FIELDS.indexOf(k) >= 0 || k === '_Bilangan Salinan')));
    check('tiada lajur sumber pada rekod gabungan',
      realMerge.merged.every((r) => !('_Sumber' in r)));
    check('statistik setiap fail masih direkod',
      realMerge.sourceStats.length === 2
      && realMerge.sourceStats[0].added + realMerge.sourceStats[1].added === union.size,
      JSON.stringify(realMerge.sourceStats.map((s) => s.fileName + ':' + s.added)));

    // The merge must also survive an export/re-import cycle at full size.
    const mergedHtml = toHtmlWorkbook(realMerge.merged, { generatedAt: 'x' });
    const mergedBack = parseHtmlTable(mergedHtml, { engine: 'scan' });
    eq('gabungan dieksport dan dibaca semula: bilangan rekod kekal',
      mergedBack.records.length, union.size);
    const mergedByLabel = byLabel(realMerge.merged);
    check('gabungan eksport: setiap rekod identik',
      mergedBack.records.every((r) => {
        const want = mergedByLabel.get(r.Label);
        return want && JSON.stringify(want) === JSON.stringify(FIELDS.map((f) => r[f]));
      }));
  }
}

/* ================================================================== *
 * 10. Change tracking across uploads
 *
 * The source report has no date and no inspection status, so "inspected" can
 * only be inferred from a label DISAPPEARING. These tests pin that inference,
 * including the awkward cases: reappearance and first-time appearance.
 * ================================================================== */
section('diffLabels');
{
  const d1 = diffLabels(['A', 'B', 'C'], ['A', 'B'], []);
  eq('disappeared label reported as inspected', d1.inspected, ['C']);
  eq('surviving labels reported as still outstanding', d1.still.sort(), ['A', 'B']);
  eq('nothing reported as new', d1.added, []);

  const d2 = diffLabels(['A'], ['A', 'B'], []);
  eq('first-time label reported as added', d2.added, ['B']);
  eq('nothing reported as inspected', d2.inspected, []);

  const d3 = diffLabels(['A'], ['A', 'C'], ['C']);
  eq('label previously inspected and now listed is "reappeared"', d3.reappeared, ['C']);
  eq('reappeared is not double-counted as added', d3.added, []);

  const d4 = diffLabels([], ['A', 'B'], []);
  eq('first run (no previous) treats everything as added', d4.added.sort(), ['A', 'B']);
  eq('first run reports nothing inspected', d4.inspected, []);

  const d5 = diffLabels(['A', 'B'], ['A', 'B'], []);
  eq('no change yields no deltas',
    [d5.inspected.length, d5.added.length, d5.reappeared.length], [0, 0, 0]);

  // Duplicated labels in the input must not corrupt the diff.
  const d6 = diffLabels(['A', 'A', 'B'], ['A', 'B', 'B'], []);
  eq('duplicate labels are collapsed', [d6.inspected.length, d6.added.length], [0, 0]);
}

section('buildHistory: the four lifecycle cases');
{
  const runs = [
    { at: '2026-01-31', labels: ['A', 'B', 'C', 'D'] },
    { at: '2026-02-28', labels: ['A', 'B', 'D'] },        // C inspected
    { at: '2026-03-31', labels: ['A', 'B', 'D', 'E'] },   // E is new
    { at: '2026-04-30', labels: ['A', 'B', 'E', 'C'] },   // D inspected, C reappears
  ];
  const h = buildHistory(runs);

  eq('four runs recorded', h.runs.length, 4);
  eq('run 1: all four are new', h.runs[0].added, 4);
  eq('run 2: one inspected', h.runs[1].inspected, 1);
  eq('run 3: one added', h.runs[2].added, 1);
  eq('run 4: one inspected and one reappeared',
    [h.runs[3].inspected, h.runs[3].reappeared], [1, 1]);

  eq('A was never absent, so it is still outstanding', h.labels.A.outstanding, true);
  eq('A was seen in all four runs', h.labels.A.timesSeen, 4);
  eq('C was absent once then returned', h.labels.C.timesAbsent, 1);
  eq('C is marked as reappeared', h.labels.C.reappearances, 1);
  eq('C is outstanding again', h.labels.C.outstanding, true);
  eq('D was absent and never returned', h.labels.D.outstanding, false);
  eq('D is marked inspected', h.labels.D.status, LABEL_STATUS.INSPECTED);
  eq('E first appears in run 3', h.labels.E.firstSeen, '2026-03-31');
  eq('E is outstanding', h.labels.E.outstanding, true);

  eq('summary counts ever-seen labels', h.summary.everSeen, 5);
  eq('summary counts still outstanding', h.summary.outstanding, 4);
  eq('summary counts resolved', h.summary.resolved, 1);
  eq('summary counts reappearances', h.summary.reappeared, 1);

  // Out-of-order input must be sorted, not trusted.
  const shuffled = buildHistory([runs[2], runs[0], runs[3], runs[1]]);
  eq('runs are sorted by date', shuffled.runs.map((r) => r.at), runs.map((r) => r.at));
  eq('sorted history gives the same outcome', shuffled.labels.D.outstanding, false);
}

section('buildHistory: balance invariant');
{
  // For every run: previous total - inspected + added + reappeared = current total
  const runs = [
    { at: '2026-01-31', labels: ['A', 'B', 'C', 'D', 'E'] },
    { at: '2026-02-28', labels: ['A', 'C', 'F'] },
    { at: '2026-03-31', labels: ['A', 'B', 'F'] },
    { at: '2026-04-30', labels: ['A', 'B', 'F', 'G'] },
  ];
  const h = buildHistory(runs);
  let balanced = true;
  const detail = [];
  for (let i = 1; i < h.runs.length; i += 1) {
    const prev = h.runs[i - 1].total;
    const cur = h.runs[i].total;
    const r = h.runs[i];
    const computed = prev - r.inspected + r.added + r.reappeared;
    if (computed !== cur) {
      balanced = false;
      detail.push(`run ${i + 1}: ${prev}-${r.inspected}+${r.added}+${r.reappeared}=${computed} != ${cur}`);
    }
  }
  check('every run balances (prev - inspected + added + reappeared = current)', balanced, detail.join('; '));
}

section('departmentProgress');
{
  const mk = (Label, Bahagian) => ({ Label, Bahagian, 'Jenis Aset': 'X', 'Lokasi Terkini': 'L' });
  const runs = [
    { at: '2026-01-31', labels: ['A1', 'A2', 'B1', 'B2'], records: [mk('A1', 'JAB A'), mk('A2', 'JAB A'), mk('B1', 'JAB B'), mk('B2', 'JAB B')] },
    { at: '2026-02-28', labels: ['A1', 'B2'], records: [mk('A1', 'JAB A'), mk('B2', 'JAB B')] },
  ];
  const h = buildHistory(runs);
  const prog = departmentProgress(h.runs, runs[1].records, h.labels);

  const a = prog.find((p) => p.bahagian === 'JAB A');
  const b = prog.find((p) => p.bahagian === 'JAB B');
  eq('JAB A: two at start', a.awal, 2);
  eq('JAB A: one inspected', a.inspected, 1);
  eq('JAB A: one remaining', a.akhir, 1);
  eq('JAB A: 50%', a.peratus, 50);
  eq('JAB B: same shape', [b.awal, b.inspected, b.akhir, b.peratus], [2, 1, 1, 50]);

  // A department present only in the older list must still be reported.
  const runs2 = [
    { at: '2026-01-31', labels: ['A1', 'C1'], records: [mk('A1', 'JAB A'), mk('C1', 'JAB C')] },
    { at: '2026-02-28', labels: ['A1'], records: [mk('A1', 'JAB A')] },
  ];
  const h2 = buildHistory(runs2);
  const prog2 = departmentProgress(h2.runs, runs2[1].records, h2.labels);
  const c = prog2.find((p) => p.bahagian === 'JAB C');
  check('a department that vanished entirely is still reported', !!c, JSON.stringify(prog2));
  eq('vanished department shows 100% inspected', c && c.peratus, 100);

  // Labels absent from the newest run keep their department from history.
  check('progress rows carry the department name', prog.every((p) => typeof p.bahagian === 'string'));
}

section('history serialisers');
{
  const runs = [
    { at: '2026-01-31T08:00:00.000Z', labels: ['A', 'B'] },
    { at: '2026-02-28T08:00:00.000Z', labels: ['A'] },
  ];
  const h = buildHistory(runs);

  const rows = historyRows(h);
  eq('one timeline row per label ever seen', rows.length, 2);
  eq('row columns match the declared header', Object.keys(rows[0]), HISTORY_COLUMNS);
  eq('resolved label is labelled in Malay', rows.find((r) => r.Label === 'B').Status, 'Sudah diperiksa');
  eq('outstanding label is labelled in Malay', rows.find((r) => r.Label === 'A').Status, 'Belum diperiksa');
  eq('outstanding rows sort first', rows[0].Status, 'Belum diperiksa');
  check('dates are day-precision', /^\d{4}-\d{2}-\d{2}$/.test(rows[0]['Pertama Dilihat']), rows[0]['Pertama Dilihat']);
  // The exported rows must be directly usable as a CSV table.
  const csv = toCsv(rows, HISTORY_COLUMNS, HISTORY_COLUMNS);
  check('history CSV starts with the declared header',
    csv.replace(/^\uFEFF/, '').startsWith(HISTORY_COLUMNS.join(',')), csv.split('\r\n')[0]);

  const runRows = historyRunRows(h);
  eq('one row per run', runRows.length, 2);
  eq('run row columns match the declared header', Object.keys(runRows[0]), HISTORY_RUN_COLUMNS);
  eq('run rows are numbered from 1', runRows.map((r) => r['Bilangan Titik Masa']), [1, 2]);
  eq('run 2 reports one inspected', runRows[1].Diperiksa, 1);
  eq('run 2 reports one still outstanding', runRows[1]['Masih Belum'], 1);
}

section('buildHistory edge cases');
{
  eq('no runs yields an empty history', buildHistory([]).runs.length, 0);
  eq('null input is tolerated', buildHistory(null).runs.length, 0);
  eq('runs without a labels array are skipped',
    buildHistory([{ at: 'x' }, { at: '2026-01-01', labels: ['A'] }]).runs.length, 1);

  // A single run must not claim any inspections.
  const one = buildHistory([{ at: '2026-01-01', labels: ['A', 'B'] }]);
  eq('single run reports no inspections', one.runs[0].inspected, 0);
  eq('single run reports both as new', one.runs[0].added, 2);
  eq('single run: nothing resolved', one.summary.resolved, 0);
  check('single run leaves neverInspectedSince undefined rather than wrong',
    one.summary.neverInspectedSince === null, String(one.summary.neverInspectedSince));

  // An empty run (everything inspected) must be handled.
  const emptied = buildHistory([
    { at: '2026-01-01', labels: ['A', 'B'] },
    { at: '2026-02-01', labels: [] },
  ]);
  eq('emptied list reports both inspected', emptied.runs[1].inspected, 2);
  eq('emptied list leaves nothing outstanding', emptied.summary.outstanding, 0);
  eq('emptied list resolves both', emptied.summary.resolved, 2);
}

/* ================================================================== *
 * File intake: picking and dropping FOLDERS
 *
 * The exports for one report live in a folder per month, so the interesting
 * question is not "can it read a file" but "which folder did it come from". The
 * walk is driven with fabricated FileSystemEntries: the browser API cannot be
 * constructed, and the parts that actually break (the 100-entry batch, the junk
 * that lives in every export folder) are decisions made in src/intake.mjs.
 * ================================================================== */

section('intake: what a file name is allowed to be');
{
  eq('extension comes from the last segment', extOf('2026-09/ABR.xls'), 'xls');
  eq('extension is case-insensitive', extOf('ABR.XLS'), 'xls');
  eq('a dotfile has no extension', extOf('.xls'), '');
  eq('the supported list is the accept-list on the input', SUPPORTED_EXT,
    ['xls', 'xlsx', 'html', 'htm', 'csv', 'tsv', 'txt', 'json']);
  check('xls is supported', isSupportedName('Senarai.xls'));
  check('png is not', !isSupportedName('gambar.png'));
  check('a name with no extension is not', !isSupportedName('senarai'));
  check('a path is judged by its base name', isSupportedName('2026-09/x.csv'));

  eq('office lock file', classifyFile('~$Senarai.xls'), 'junk');
  eq('macos metadata', classifyFile('2026-09/.DS_Store'), 'junk');
  eq('windows metadata', classifyFile('desktop.ini'), 'junk');
  eq('unsupported type', classifyFile('gambar.png'), 'unsupported');
  eq('a readable file is ok', classifyFile('Senarai.xls'), 'ok');
  eq('a file over the ceiling is refused', classifyFile('besar.csv', LIMITS.maxFileBytes + 1), 'big');
  eq('an unknown size is never a reason to skip', classifyFile('Senarai.xls', 0), 'ok');
}

/*
 * A directory that hands its children back in batches, the way the real API does: at
 * most 100 entries per readEntries() call, an empty call at the end, and every callback
 * asynchronous.
 */
const fakeDir = (name, children, batch = 100) => ({
  name,
  isDirectory: true,
  isFile: false,
  createReader: () => {
    let at = 0;
    return {
      readEntries: (ok) => {
        const slice = children.slice(at, at + batch);
        at += slice.length;
        setTimeout(() => ok(slice), 0);
      },
    };
  },
});

const fakeFile = (name, size = 100) => ({
  name,
  isDirectory: false,
  isFile: true,
  file: (ok) => setTimeout(() => ok({ name, size, text: 'x' }), 0),
});

const pathsOf = (result) => result.files.map((f) => f.path);
const reasonsOf = (result) => result.skipped.map((s) => `${s.path}:${s.reason}`);

section('intake: walking a dropped folder');
{
  const tree = fakeDir('2026-09', [
    fakeFile('ABR.xls'),
    fakeFile('HM.xls'),
    fakeFile('~$ABR.xls'), // the lock file Excel leaves behind
    fakeFile('.DS_Store'),
    fakeFile('nota.txt'),
    fakeFile('gambar.png'),
    fakeDir('arkib', [fakeFile('LAMA.xls')]),
  ]);
  const walked = await walkEntries([tree]);
  eq('readable files, in tree order, with their folder path', pathsOf(walked), [
    '2026-09/ABR.xls', '2026-09/HM.xls', '2026-09/nota.txt', '2026-09/arkib/LAMA.xls',
  ]);
  eq('every file left behind is accounted for', reasonsOf(walked), [
    '2026-09/~$ABR.xls:junk', '2026-09/.DS_Store:junk', '2026-09/gambar.png:unsupported',
  ]);
  check('a folder that fitted is not truncated', walked.truncated === false);

  /* Chrome returns entries in batches of 100. Stopping at the first batch is a silent
     data loss that no single-file test can see, so this folder is deliberately larger
     than one batch. */
  const many = fakeDir('banyak', Array.from({ length: 250 }, (_, i) => fakeFile(`f${i}.csv`)));
  const all = await walkEntries([many]);
  eq('a folder larger than one batch is read completely', all.files.length, 250);
  eq('and its last file is the last file', all.files[249].path, 'banyak/f249.csv');

  /* The file NAME is not unique. Three month-folders of the same export are all called
     Senarai.xls, which is the whole reason the path is carried. */
  const two = await walkEntries([
    fakeDir('2026-08', [fakeFile('Senarai.xls')]),
    fakeDir('2026-09', [fakeFile('Senarai.xls')]),
  ]);
  eq('the same name in two folders is two files', pathsOf(two),
    ['2026-08/Senarai.xls', '2026-09/Senarai.xls']);

  const twoMerged = mergeSources([
    { fileName: pathsOf(two)[0], label: pathsOf(two)[0], warnings: [], records: [{ Label: 'KPT/PKS/H/1/1', 'Jenis Aset': 'A' }] },
    { fileName: pathsOf(two)[1], label: pathsOf(two)[1], warnings: [], records: [{ Label: 'KPT/PKS/H/1/2', 'Jenis Aset': 'B' }] },
  ]);
  eq('and stays two rows in the per-file report', twoMerged.sourceStats.length, 2);
  check('with two different names to show',
    twoMerged.sourceStats[0].fileName !== twoMerged.sourceStats[1].fileName);

  const capped = await walkEntries(
    [fakeDir('besar', Array.from({ length: 30 }, (_, i) => fakeFile(`f${i}.csv`)))],
    { maxFiles: 5 },
  );
  eq('the file ceiling stops the walk', capped.files.length, 5);
  check('and reports that it did',
    capped.truncated === true && capped.skipped.some((s) => s.reason === 'limit'), reasonsOf(capped).join(' '));

  const shallow = await walkEntries(
    [fakeDir('a', [fakeDir('b', [fakeDir('c', [fakeFile('x.csv')])])])],
    { maxDepth: 2 },
  );
  eq('the depth ceiling stops recursion', shallow.files.length, 0);
  eq('and names the folder it refused', shallow.skipped.map((s) => s.reason), ['deep']);

  /* A tree of files nothing can read must not be crawled entry by entry: the visit
     ceiling bounds the work even when the file ceiling never triggers. */
  const wide = await walkEntries(
    [fakeDir('w', [fakeFile('a.csv'), fakeFile('b.csv'), fakeFile('c.csv')])],
    { maxVisited: 2 },
  );
  check('the visited ceiling stops a huge tree', wide.truncated === true && wide.files.length === 1,
    `files=${wide.files.length} truncated=${wide.truncated}`);
}

section('intake: a hand-picked file is judged by the parser, not by the folder rules');
{
  const one = await walkEntries([fakeFile('senarai.xls')]);
  eq('a loose .xls arrives', one.files.map((f) => f.file.name), ['senarai.xls']);
  eq('and has no folder, so no path', one.files[0].path, '');
  eq('and nothing is skipped', one.skipped.length, 0);

  /* A file whose extension the parser does not know may still BE a table (the real JKM
     exports are HTML with an .xls name, and someone will one day save one with no
     extension). A file the user chose by hand reaches the parser and gets the parser's
     own message; only a folder walk may filter by name. */
  const odd = await walkEntries([fakeFile('senarai')]);
  eq('a loose file with no extension still arrives', odd.files.map((f) => f.file.name), ['senarai']);
  eq('and is not silently skipped', odd.skipped.length, 0);

  const big = await walkEntries([fakeFile('besar.csv', LIMITS.maxFileBytes + 1)]);
  eq('but the size ceiling still refuses it', big.skipped.map((s) => s.reason), ['big']);
}

section('intake: the drop payload');
{
  /* Entries are the route that can see inside a folder; `dataTransfer.files` holds a
     0-byte placeholder for a directory, which is why the walk wins whenever it can. */
  const withEntries = {
    items: [{ kind: 'file', webkitGetAsEntry: () => fakeDir('2026-09', [fakeFile('ABR.xls')]) }],
    files: [{ name: '2026-09', size: 0 }],
  };
  const dropped = await collectDrop(withEntries);
  eq('a dropped folder is expanded', pathsOf(dropped), ['2026-09/ABR.xls']);
  check('and the entries route is reported', dropped.usedEntries === true);

  const flat = { items: [{ kind: 'file' }], files: [{ name: 'a.xls', size: 10 }] };
  const plain = await collectDrop(flat);
  eq('without entries the flat list is used', plain.files.map((f) => f.file.name), ['a.xls']);
  eq('and a loose file has no folder path', plain.files[0].path, '');
  check('the flat route is reported', plain.usedEntries === false);

  const none = await collectDrop(null);
  eq('an empty drop is not an error', none.files.length, 0);
  eq('and it produced no skips to report', none.skipped.length, 0);

  const link = { items: [{ kind: 'string' }, { kind: 'file', webkitGetAsEntry: () => null }], files: [] };
  const fromLink = await collectDrop(link);
  eq('a dragged link contributes nothing', fromLink.files.length, 0);
}

section('intake: the folder picker');
{
  const picked = pickFromFolderInput([
    { name: 'ABR.xls', size: 10, webkitRelativePath: '2026-09/ABR.xls' },
    { name: 'gambar.png', size: 10, webkitRelativePath: '2026-09/gambar.png' },
    { name: '~$ABR.xls', size: 10, webkitRelativePath: '2026-09/~$ABR.xls' },
  ]);
  eq('only readable files survive the pick', pathsOf(picked), ['2026-09/ABR.xls']);
  eq('the rest are reported, not dropped', picked.skipped.map((s) => s.reason), ['unsupported', 'junk']);
  eq('a file with no relative path falls back to its name',
    pickFromFolderInput([{ name: 'a.csv', size: 1 }]).files[0].path, 'a.csv');
  eq('an empty pick is not an error', pickFromFolderInput(null).files.length, 0);
  eq('the picker filters the same way the drop does',
    pickFromFolderInput([{ name: 'x.png', size: 1, webkitRelativePath: 'f/x.png' }]).skipped.length, 1);
}

/* ================================================================== *
 * Summary
 * ================================================================== */
console.log(`\n${'='.repeat(60)}`);
console.log(`KEPUTUSAN: ${pass} lulus, ${fail} gagal`);
if (fail) {
  console.log('\nKegagalan:');
  failures.forEach((f) => console.log('  - ' + f));
}
console.log('='.repeat(60));
process.exit(fail ? 1 : 0);
