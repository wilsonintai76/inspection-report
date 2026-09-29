// Deep integrity check of the two real files.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseFile, mergeSources, FIELDS } from '../src/parser.mjs';

const ABR = 'fixture/Senarai_Aset_Belum_Periksa_ABR_JKM.xls';
const HM = 'fixture/Senarai_Aset_Belum_Periksa_HM_JKM.xls';
const NAME_A = 'Senarai_Aset_Belum_Periksa_ABR_JKM.xls';
const NAME_H = 'Senarai_Aset_Belum_Periksa_HM_JKM.xls';

const aText = readFileSync(ABR, 'utf8');
const hText = readFileSync(HM, 'utf8');

const a = parseFile(aText, NAME_A);
const h = parseFile(hText, NAME_H);

console.log('=== KIRAAN ===');
console.log(`ABR: ${a.records.length} rekod, amaran: ${JSON.stringify(a.warnings)}`);
console.log(`HM : ${h.records.length} rekod, amaran: ${JSON.stringify(h.warnings)}`);

/* ---- empty fields: are they real gaps or parser bugs? ---- */
console.log('\n=== MEDAN KOSONG ===');
for (const [name, parsed] of [[NAME_A, a], [NAME_H, h]]) {
  const gaps = [];
  parsed.records.forEach((r, i) => {
    FIELDS.forEach((f) => { if (r[f] === '') gaps.push({ i, label: r.Label, field: f }); });
  });
  console.log(`${name}: ${gaps.length} medan kosong`);
  gaps.forEach((g) => console.log(`   rekod ${g.i} (${g.label}): ${g.field}`));
}

/* ---- label uniqueness and format ---- */
console.log('\n=== LABEL ===');
for (const [name, parsed] of [[NAME_A, a], [NAME_H, h]]) {
  const labels = parsed.records.map((r) => r.Label);
  const dupes = labels.filter((l, i) => labels.indexOf(l) !== i);
  const prefixes = {};
  labels.forEach((l) => {
    const m = l.match(/^KPT\/PKS\/([A-Z]+)\//);
    prefixes[m ? m[1] : '(lain)'] = (prefixes[m ? m[1] : '(lain)'] || 0) + 1;
  });
  const weird = labels.filter((l) => !/^[A-Z0-9]+(\/[A-Z0-9.\-]+)+$/.test(l));
  console.log(`${name}: ${labels.length} label, ${new Set(labels).size} unik`);
  console.log(`   awalan: ${JSON.stringify(prefixes)}`);
  if (dupes.length) console.log(`   BERULANG: ${JSON.stringify(dupes.slice(0, 5))}`);
  if (weird.length) console.log(`   PELIK: ${JSON.stringify(weird.slice(0, 5))}`);
}

/* ---- overlap between the two reports ---- */
const aLabels = new Set(a.records.map((r) => r.Label));
const hLabels = new Set(h.records.map((r) => r.Label));
const shared = [...hLabels].filter((l) => aLabels.has(l));
console.log('\n=== PERTINDIHAN ABR vs HM ===');
console.log(`Label HM yang juga ada dalam ABR: ${shared.length} / ${hLabels.size}`);
if (shared.length) console.log('   contoh:', shared.slice(0, 5));

/* ---- parser engine agreement on the real files ---- */
console.log('\n=== PERSETUJUAN ENJIN ===');
// The DOM engine needs a real browser (DOMParser is not a Node global), so it is
// skipped here; tools/verify-ui.mjs and the in-app self-test cover that path.
if (typeof DOMParser !== 'function') {
  console.log('   DOMParser tiada di Node - dilangkau; disemak dalam pelayar oleh verify-ui.mjs');
}

/* ---- fingerprint of every parsed record, for cross-environment comparison ---- */
console.log('\n=== CAP JARI DATA (bandingkan Node vs pelayar) ===');
const canonical = (parsed) => parsed.records
  .map((r) => FIELDS.map((f) => r[f]).join('\u0001'))
  .join('\u0002');
for (const [name, parsed] of [[NAME_A, a], [NAME_H, h]]) {
  const digest = createHash('sha256').update(canonical(parsed), 'utf8').digest('hex');
  console.log(`${name}\n   rekod=${parsed.records.length} sha256=${digest}`);
}

/* ---- the merge outcome ---- */
const merged = mergeSources([
  { fileName: NAME_A, label: NAME_A, records: a.records, warnings: [], meta: a.meta },
  { fileName: NAME_H, label: NAME_H, records: h.records, warnings: [], meta: h.meta },
]);
console.log('\n=== GABUNGAN ===');
console.log(`rekod unik: ${merged.merged.length} (473 + 63 = 536)`);
console.log(`pertindihan: ${merged.duplicates.length}`);
console.log(`konflik: ${merged.conflicts.length}`);

/* ---- per-source integrity: nothing lost ----
 * Merged records no longer carry a source column, so presence is checked by
 * label against the union instead. */
console.log('\n=== KESETIAAN SUMBER ===');
const mergedLabels = new Set(merged.merged.map((r) => r.Label));
for (const [name, parsed] of [[NAME_A, a], [NAME_H, h]]) {
  const present = parsed.records.filter((r) => mergedLabels.has(r.Label));
  const missing = parsed.records.filter((r) => !mergedLabels.has(r.Label));
  console.log(`${name}: ${present.length}/${parsed.records.length} label hadir dalam gabungan, ${missing.length} hilang`);
  if (missing.length) console.log('   hilang:', JSON.stringify(missing.slice(0, 3).map((r) => r.Label)));
}

/* ---- sample rows for eyeballing ---- */
console.log('\n=== CONTOH 3 REKOD ===');
merged.merged.slice(0, 3).forEach((r) => {
  console.log('   ' + FIELDS.map((f) => r[f]).join(' | '));
});

/* ---- provenance lives in the per-file statistics, not the records ---- */
console.log('\n=== STATISTIK SETIAP FAIL ===');
merged.sourceStats.forEach((s) => {
  console.log(`   ${s.fileName}: baris=${s.rows} ditambah=${s.added} bertindih=${s.duplicate}`);
});
console.log('   lajur sumber pada rekod: '
  + (merged.merged.some((r) => '_Sumber' in r) ? 'ADA (sepatutnya tiada)' : 'tiada (seperti dijangka)'));
