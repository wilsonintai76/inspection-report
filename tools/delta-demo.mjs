/*
 * delta-demo.mjs - demonstrate what change-tracking would report.
 *
 *   node tools/delta-demo.mjs <before.csv|.xls> <after.csv|.xls>
 *
 * This is a DEMONSTRATION, not the feature. It treats two files as two points in
 * time and reports what changed, to show exactly what the app would tell you on
 * each upload.
 *
 * Your source data has no date field and no inspection status, so the only
 * evidence that an asset WAS inspected is its absence from a later export.
 */
import { readFileSync, existsSync } from 'node:fs';
import { parseFile, FIELDS } from '../src/parser.mjs';

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) {
  console.error('Guna: node tools/delta-demo.mjs <sebelum> <selepas>');
  process.exit(2);
}
for (const p of [beforePath, afterPath]) {
  if (!existsSync(p)) { console.error('Fail tidak dijumpai: ' + p); process.exit(2); }
}

const load = (p) => {
  const name = p.split(/[\\/]/).pop();
  return { name, records: parseFile(readFileSync(p, 'utf8'), name).records };
};

const before = load(beforePath);
const after = load(afterPath);

const mapOf = (records) => {
  const m = new Map();
  records.forEach((r) => {
    if (m.has(r.Label)) {
      console.warn(`AMARAN: label berulang dalam satu fail: ${r.Label}`);
    }
    m.set(r.Label, r);
  });
  return m;
};

const A = mapOf(before.records);
const B = mapOf(after.records);

const inspected = [];   // in before, gone from after  -> presumed inspected
const still = [];       // in both                      -> still outstanding
const appeared = [];    // only in after                -> newly listed
const changed = [];     // in both but details differ   -> worth a look

for (const [label, a] of A) {
  if (!B.has(label)) { inspected.push(a); continue; }
  const b = B.get(label);
  still.push(b);
  const diffs = FIELDS.filter((f) => String(a[f] ?? '') !== String(b[f] ?? ''));
  if (diffs.length) changed.push({ label, diffs, before: a, after: b });
}
for (const [label, b] of B) {
  if (!A.has(label)) appeared.push(b);
}

const pct = (n, total) => total ? ((n * 100) / total).toFixed(1) + '%' : '-';

console.log('SEBELUM : ' + before.name + '  (' + A.size + ' aset belum diperiksa)');
console.log('SELEPAS : ' + after.name + '  (' + B.size + ' aset belum diperiksa)');
console.log('');
console.log('=== PERUBAHAN ===');
console.log('  Baru diperiksa (hilang)     : ' + inspected.length + '  (' + pct(inspected.length, A.size) + ' daripada senarai lama)');
console.log('  Masih belum diperiksa       : ' + still.length);
console.log('  Muncul kali pertama         : ' + appeared.length);
console.log('  Butiran berubah             : ' + changed.length);
console.log('  Semakan imbangan            : ' + A.size + ' - ' + inspected.length + ' + ' + appeared.length + ' = ' + (A.size - inspected.length + appeared.length) + '  (selepas = ' + B.size + ')');

/* ---- per department progress: this is the report that matters ---- */
const byDept = (list) => {
  const t = {};
  list.forEach((r) => { const d = r.Bahagian || '(TIADA BAHAGIAN)'; t[d] = (t[d] || 0) + 1; });
  return t;
};
const beforeDept = byDept([...A.values()]);
const afterDept = byDept([...B.values()]);
const inspectedDept = byDept(inspected);

const depts = [...new Set([...Object.keys(beforeDept), ...Object.keys(afterDept)])]
  .sort((x, y) => (beforeDept[y] || 0) - (beforeDept[x] || 0));

console.log('');
console.log('=== KEMAJUAN MENGIKUT BAHAGIAN ===');
const pad = (s, n) => String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s).padEnd(n);
console.log('  ' + pad('Bahagian', 44) + 'Awal  Diperiksa  Akhir  Kemajuan');
console.log('  ' + '-'.repeat(44) + '----  ---------  -----  --------');
depts.forEach((d) => {
  const b = beforeDept[d] || 0;
  const done = inspectedDept[d] || 0;
  const a = afterDept[d] || 0;
  const p = b ? ((done * 100) / b).toFixed(0) + '%' : '-';
  console.log('  ' + pad(d, 44) + String(b).padStart(4) + String(done).padStart(11)
    + String(a).padStart(7) + p.padStart(10));
});

/* ---- detail lists ---- */
if (inspected.length) {
  console.log('');
  console.log('=== CONTOH: DIANGGAP SUDAH DIPERIKSA (10 pertama) ===');
  inspected.slice(0, 10).forEach((r) => {
    console.log('  ' + r.Label + '  |  ' + (r.Bahagian || '-') + '  |  ' + r['Lokasi Terkini']);
  });
}
if (appeared.length) {
  console.log('');
  console.log('=== ASET BARU (10 pertama) ===');
  appeared.slice(0, 10).forEach((r) => {
    console.log('  ' + r.Label + '  |  ' + (r.Bahagian || '-') + '  |  ' + r['Lokasi Terkini']);
  });
}
if (changed.length) {
  console.log('');
  console.log('=== BUTIRAN BERUBAH (5 pertama) ===');
  changed.slice(0, 5).forEach((c) => {
    console.log('  ' + c.label + '  medan: ' + c.diffs.join(', '));
    c.diffs.forEach((f) => {
      console.log('      ' + f + ': "' + c.before[f] + '" -> "' + c.after[f] + '"');
    });
  });
}

console.log('');
console.log('NOTA: ini demonstrasi menggunakan dua fail sedia ada sebagai dua titik masa.');
console.log('Dalam penggunaan sebenar, setiap muat naik baharu menjadi satu titik masa.');
