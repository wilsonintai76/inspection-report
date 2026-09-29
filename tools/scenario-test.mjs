/*
 * scenario-test.mjs - verify the engine at the size of the REAL reports.
 *
 *   node tools/scenario-test.mjs [abrCount] [hmCount] [overlap]
 *
 * The real ABR report holds about 473 asset labels and the HM report about 63.
 * The two files originally supplied were byte-identical 66-record exports, so
 * they never exercised the real size or the overlap shape. This script builds
 * synthetic exports at full size and asserts every possible overlap case.
 */
import { performance } from 'node:perf_hooks';
import { parseFile, mergeSources, toCsv, toHtmlWorkbook, FIELDS } from '../src/parser.mjs';
import { buildReports } from './synthetic-data.mjs';

const ABR = Number(process.argv[2] || 473);
const HM = Number(process.argv[3] || 63);
const OVERLAP = Number(process.argv[4] || process.env.JKM_OVERLAP || 40);

const built = buildReports({ abr: ABR, hm: HM, overlap: OVERLAP });
const abrText = built.abrText;
const hmText = built.hmText;

console.log(`Sintetik: ABR = ${ABR} label, HM = ${HM} label `
  + `(${built.sharedCount} label muncul dalam kedua-dua fail)`);
console.log('');

/* ---------- parse ---------------------------------------------------------- */

let t0 = performance.now();
const abrParsed = parseFile(abrText, 'Senarai_Aset_Belum_Periksa_ABR_JKM.xls');
const hmParsed = parseFile(hmText, 'Senarai_Aset_Belum_Periksa_HM_JKM.xls');
let t1 = performance.now();

const failures = [];
if (abrParsed.records.length !== ABR) {
  failures.push(`ABR: dijangka ${ABR} rekod, dapat ${abrParsed.records.length}`);
}
if (hmParsed.records.length !== HM) {
  failures.push(`HM: dijangka ${HM} rekod, dapat ${hmParsed.records.length}`);
}
for (const [name, parsed] of [['ABR', abrParsed], ['HM', hmParsed]]) {
  parsed.records.forEach((r, i) => {
    FIELDS.forEach((f) => {
      if (i < 3 && !r[f]) failures.push(`${name} rekod ${i}: medan ${f} kosong`);
    });
  });
  if (parsed.warnings.length) failures.push(`${name} amaran: ${parsed.warnings.join(' | ')}`);
}

console.log('== Penghuraian ==');
console.log(`  ABR: ${abrParsed.records.length} rekod [${abrParsed.meta.format}]`);
console.log(`  HM : ${hmParsed.records.length} rekod [${hmParsed.meta.format}]`);
console.log(`  masa hurai: ${(t1 - t0).toFixed(1)} ms`);
console.log(`  masalah: ${failures.length === 0 ? 'tiada' : failures.slice(0, 5).join('; ')}`);

/* ---------- merge ---------------------------------------------------------- */

const sources = (aRecs, hRecs) => [
  {
    fileName: 'Senarai_Aset_Belum_Periksa_ABR_JKM.xls', label: 'ABR',
    records: aRecs, warnings: [], meta: abrParsed.meta,
  },
  {
    fileName: 'Senarai_Aset_Belum_Periksa_HM_JKM.xls', label: 'HM',
    records: hRecs, warnings: [], meta: hmParsed.meta,
  },
];

t0 = performance.now();
const result = mergeSources(sources(abrParsed.records, hmParsed.records));
t1 = performance.now();

// The union of labels across both reports is the ground truth for unique count.
const unionLabels = new Set([...abrParsed.records, ...hmParsed.records].map((r) => r.Label));

console.log('\n== Gabungan ==');
console.log(`  rekod unik    : ${result.merged.length} (kesatuan label: ${unionLabels.size})`);
console.log(`  pertindihan   : ${result.duplicates.length} (dijangka ${built.sharedCount})`);
console.log(`  konflik data  : ${result.conflicts.length} (dijangka 0 - label kongsi adalah sama)`);
console.log(`  masa gabung   : ${(t1 - t0).toFixed(1)} ms`);

if (result.merged.length !== unionLabels.size) {
  failures.push(`rekod unik ${result.merged.length} != kesatuan label ${unionLabels.size}`);
}
if (result.duplicates.length !== built.sharedCount) {
  failures.push(`pertindihan ${result.duplicates.length} != ${built.sharedCount}`);
}
if (result.conflicts.length !== 0) failures.push(`konflik ${result.conflicts.length} != 0`);
const outLabels = result.merged.map((r) => r.Label);
if (new Set(outLabels).size !== outLabels.length) failures.push('ada label berulang dalam hasil');

/* ---------- export and re-import ------------------------------------------ */

t0 = performance.now();
const csv = toCsv(result.merged);
const xls = toHtmlWorkbook(result.merged, { generatedAt: 'x' });
t1 = performance.now();
const exportMs = t1 - t0;

t0 = performance.now();
const csvBack = parseFile(csv, 'x.csv');
const xlsBack = parseFile(xls, 'x.xls');
t1 = performance.now();

console.log('\n== Eksport dan baca semula ==');
console.log(`  saiz CSV: ${(csv.length / 1024).toFixed(0)} KB | saiz XLS: ${(xls.length / 1024).toFixed(0)} KB`);
console.log(`  masa eksport: ${exportMs.toFixed(0)} ms | masa baca semula: ${(t1 - t0).toFixed(0)} ms`);
console.log(`  CSV dibaca semula: ${csvBack.records.length} rekod`);
console.log(`  XLS dibaca semula: ${xlsBack.records.length} rekod`);

const roundTripFailures = [];
for (const [name, back] of [['CSV', csvBack], ['XLS', xlsBack]]) {
  if (back.records.length !== result.merged.length) {
    roundTripFailures.push(`${name} baca semula: ${back.records.length} != ${result.merged.length}`);
    continue;
  }
  const expected = new Map(result.merged.map((r) => [r.Label, FIELDS.map((f) => r[f])]));
  for (const r of back.records) {
    const e = expected.get(r.Label);
    if (!e || JSON.stringify(e) !== JSON.stringify(FIELDS.map((f) => r[f]))) {
      roundTripFailures.push(`${name} baca semula: ${r.Label} berbeza`);
      break;
    }
  }
}
failures.push(...roundTripFailures);
console.log(`  masalah: ${roundTripFailures.length === 0 ? 'tiada' : roundTripFailures.join('; ')}`);

/* ---------- extreme overlap cases ----------------------------------------- */

console.log('\n== Kes melampau pertindihan ==');

// (a) No overlap: HM assets are entirely separate from ABR.
const disjoint = mergeSources(sources(abrParsed.records, built.hmOwnRecords));
const disjointExpected = ABR + built.hmOwnRecords.length;
console.log(`  tiada pertindihan : unik=${disjoint.merged.length} (dijangka ${disjointExpected}), `
  + `pertindihan=${disjoint.duplicates.length} (dijangka 0)`);
if (disjoint.merged.length !== disjointExpected) failures.push('kes tiada pertindihan: bilangan unik salah');
if (disjoint.duplicates.length !== 0) failures.push('kes tiada pertindihan: pertindihan sepatutnya 0');

// (b) HM entirely inside ABR: the union is just ABR.
const subsetSize = Math.min(HM, ABR);
const subset = mergeSources(sources(abrParsed.records, abrParsed.records.slice(0, subsetSize)));
console.log(`  HM subset ABR     : unik=${subset.merged.length} (dijangka ${ABR}), `
  + `pertindihan=${subset.duplicates.length} (dijangka ${subsetSize})`);
if (subset.merged.length !== ABR) failures.push('kes subset: bilangan unik salah');
if (subset.duplicates.length !== subsetSize) failures.push('kes subset: bilangan pertindihan salah');

/* ---------- verdict ------------------------------------------------------- */

console.log('\n' + '='.repeat(62));
if (failures.length === 0) {
  console.log(`LULUS - enjin mengendalikan ${ABR} + ${HM} label dengan betul.`);
} else {
  console.log(`GAGAL - ${failures.length} masalah:`);
  failures.slice(0, 20).forEach((f) => console.log('  - ' + f));
}
console.log('='.repeat(62));
process.exit(failures.length ? 1 : 0);
