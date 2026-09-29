// Validate the shared parser + merge engine against the real JKM exports.
import { readFileSync } from 'node:fs';
import { parseFile, mergeSources, FIELDS } from '../src/parser.mjs';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Usage: node mine-expected.mjs <file.xls> [...]');
  process.exit(2);
}

const sources = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const name = file.split(/[\\/]/).pop();
  const parsed = parseFile(text, name, { name });
  console.log(`\n=== ${name} ===`);
  console.log(`format   : ${parsed.meta.format}`);
  console.log(`columns  : ${parsed.meta.columns?.join(' | ')}`);
  console.log(`rows     : ${parsed.records.length}`);
  if (parsed.warnings.length) console.log(`warnings : ${parsed.warnings.join(' ;; ')}`);
  sources.push({ fileName: name, label: name, records: parsed.records, warnings: parsed.warnings, meta: parsed.meta });
}

const result = mergeSources(sources, { keyStrategy: 'label' });

console.log('\n========== MERGE ==========');
for (const s of result.sourceStats) {
  console.log(`${s.fileName}: rows=${s.rows} unique=${s.unique} added=${s.added} dup=${s.duplicate} internalDupKeys=${s.internalDuplicates}`);
}
console.log(`\nmerged unique records : ${result.merged.length}`);
console.log(`duplicate keys        : ${result.duplicates.length}`);
console.log(`conflicting keys      : ${result.conflicts.length}`);

const labels = new Set();
let missingFieldCount = 0;
for (const r of result.merged) {
  if (labels.has(r.Label)) console.log(`!! DUPLICATE LABEL SURVIVED: ${r.Label}`);
  labels.add(r.Label);
  for (const f of FIELDS) if (r[f] === '') missingFieldCount += 1;
  if (!/^KPT\/PKS\//.test(r.Label)) console.log(`?? odd label: ${JSON.stringify(r.Label)}`);
}
console.log(`empty fields across all records: ${missingFieldCount}`);

/* Per-file statistics are where provenance now lives. */
console.log('\nper-file statistics:');
for (const s of result.sourceStats) {
  console.log(`  ${s.fileName}: rows=${s.rows} unique=${s.unique} added=${s.added} duplicate=${s.duplicate}`);
}

console.log('\nfirst 5 merged:');
for (const r of result.merged.slice(0, 5)) {
  console.log(' ', FIELDS.map((f) => r[f]).join(' | '), '| x' + r['_Bilangan Salinan']);
}

console.log('\nlast 5 merged:');
for (const r of result.merged.slice(-5)) {
  console.log(' ', FIELDS.map((f) => r[f]).join(' | '));
}
