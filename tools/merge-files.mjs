/*
 * merge-files.mjs - merge asset list files on the command line.
 *
 *   node tools/merge-files.mjs -o hasil fail1.xls fail2.xls [fail3.xls ...]
 *   node tools/merge-files.mjs --key labelAndType -o hasil a.xls b.xls
 *   node tools/merge-files.mjs --formats xls,csv -o hasil a.xls b.xls
 *
 * This is the same engine the browser app uses (src/parser.mjs), so it is handy
 * for batch runs and for producing an output file without opening a browser.
 * It also writes a short report to stdout.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import {
  parseFile, mergeSources, toCsv, toHtmlWorkbook, toJson, FIELDS,
} from '../src/parser.mjs';

/* ---------- arguments ---------- */

const argv = process.argv.slice(2);
const inputs = [];
let outBase = null;
let keyStrategy = 'label';
let formats = ['xls', 'csv'];
let quiet = false;

for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === '-o' || a === '--out') { outBase = argv[++i]; continue; }
  if (a === '--key') { keyStrategy = argv[++i]; continue; }
  if (a === '--formats') { formats = argv[++i].split(',').map((s) => s.trim()).filter(Boolean); continue; }
  if (a === '-q' || a === '--quiet') { quiet = true; continue; }
  if (a === '-h' || a === '--help') {
    console.log('Guna: node tools/merge-files.mjs -o <nama-output> <fail1.xls> <fail2.xls> [...]');
    console.log('  --key label|labelAndType|full   kunci padanan pertindihan (lalai: label)');
    console.log('  --formats xls,csv,json          format output (lalai: xls,csv)');
    process.exit(0);
  }
  if (a.startsWith('-')) { console.error('Pilihan tidak dikenali: ' + a); process.exit(2); }
  inputs.push(a);
}

if (inputs.length === 0) {
  console.error('Tiada fail input. Guna: node tools/merge-files.mjs -o <nama-output> <fail...>');
  process.exit(2);
}
if (['label', 'labelAndType', 'full'].indexOf(keyStrategy) < 0) {
  console.error('--key mesti salah satu daripada: label, labelAndType, full');
  process.exit(2);
}
if (!outBase) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  outBase = join('contoh-output', `Gabungan_Aset_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`);
}

/* ---------- parse ---------- */

const sources = [];
const failures = [];

for (const path of inputs) {
  if (!existsSync(path)) {
    failures.push({ path, message: 'fail tidak dijumpai' });
    continue;
  }
  const text = readFileSync(path, 'utf8');
  const name = basename(path);
  try {
    const parsed = parseFile(text, name, { name });
    sources.push({
      fileName: name,
      label: name,
      records: parsed.records,
      warnings: parsed.warnings || [],
      meta: parsed.meta || {},
    });
    if (!quiet) {
      console.log(`Baca  ${name}: ${parsed.records.length} rekod [${parsed.meta.format}]`);
      (parsed.warnings || []).forEach((w) => console.log(`      nota: ${w}`));
    }
  } catch (err) {
    failures.push({ path, message: err.message });
    console.error(`RALAT ${name}: ${err.message}`);
  }
}

if (sources.length === 0) {
  console.error('Tiada fail berjaya dibaca. Berhenti.');
  process.exit(1);
}

/* ---------- merge ---------- */

const result = mergeSources(sources, { keyStrategy });
const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 16);

const summary = {
  fail: result.sourceStats.map((s) => ({
    nama: s.fileName, format: s.format, baris: s.rows, ditambah: s.added, bertindih: s.duplicate,
  })),
  jumlahRekodUnik: result.merged.length,
  labelKonflik: result.conflicts.length,
};

/* ---------- write outputs ---------- */

const outDir = dirname(outBase);
if (outDir && outDir !== '.') mkdirSync(outDir, { recursive: true });

const written = [];
if (formats.indexOf('xls') >= 0) {
  const p = outBase + '.xls';
  writeFileSync(p, toHtmlWorkbook(result.merged, { generatedAt }), 'utf8');
  written.push(p);
}
if (formats.indexOf('csv') >= 0) {
  const p = outBase + '.csv';
  writeFileSync(p, toCsv(result.merged), 'utf8');
  written.push(p);
}
if (formats.indexOf('json') >= 0) {
  const p = outBase + '.json';
  writeFileSync(p, toJson(result.merged, { generatedAt, summary }), 'utf8');
  written.push(p);
}

// A report is worth keeping next to the data when conflicts need review.
if (result.conflicts.length > 0 || result.duplicates.length > 0) {
  const lines = [];
  lines.push('LAPORAN GABUNGAN ASET');
  lines.push('Dijana: ' + generatedAt);
  lines.push('Kunci padanan: ' + keyStrategy);
  lines.push('');
  lines.push('Fail dibaca:');
  result.sourceStats.forEach((s) => {
    lines.push(`  ${s.fileName}  [${s.format}]  baris=${s.rows} unik=${s.unique} ditambah=${s.added} bertindih=${s.duplicate}`);
  });
  lines.push('');
  lines.push(`Rekod unik gabungan: ${result.merged.length}`);
  lines.push(`Baris bertindih dibuang: ${result.sourceStats.reduce((a, s) => a + s.duplicate, 0)}`);
  lines.push(`Label dengan konflik: ${result.conflicts.length}`);
  lines.push('');
  if (result.conflicts.length) {
    lines.push('KONFLIK DATA (sila semak):');
    result.conflicts.forEach((c) => {
      lines.push(`  ${c.label}  (fail: ${c.fileName})`);
      c.differing.forEach((f) => {
        lines.push(`      ${f}: disimpan="${c.existing[f]}"  bercanggah="${c.incoming[f]}"`);
      });
    });
    lines.push('');
  }
  if (result.duplicates.length) {
    lines.push('PERTINDIHAN (label muncul lebih daripada sekali):');
    result.duplicates.forEach((d) => {
      lines.push(`  ${d.label} x${d.count}  <- ${d.sources.join(', ')}`);
    });
    lines.push('');
  }
  const p = outBase + '_laporan.txt';
  writeFileSync(p, lines.join('\r\n'), 'utf8');
  written.push(p);
}

/* ---------- report ---------- */

if (!quiet) {
  console.log('');
  console.log('=== RINGKASAN ===');
  result.sourceStats.forEach((s) => {
    console.log(`  ${s.fileName}: baris=${s.rows} unik=${s.unique} ditambah=${s.added} bertindih=${s.duplicate}`);
  });
  console.log(`  Rekod unik gabungan : ${result.merged.length}`);
  console.log(`  Pertindihan         : ${result.duplicates.length}`);
  console.log(`  Konflik data        : ${result.conflicts.length}`);
  console.log('');
  console.log('Fail ditulis:');
  written.forEach((p) => console.log('  ' + resolve(p)));
}

if (failures.length) {
  console.log('');
  console.log('Fail yang gagal dibaca:');
  failures.forEach((f) => console.log(`  ${f.path}: ${f.message}`));
}

process.exit(result.conflicts.length > 0 ? 3 : 0);
