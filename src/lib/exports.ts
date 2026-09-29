/*
 * exports.js - turning what is on screen into a file.
 *
 * The CSV/JSON/Excel writers themselves live in src/parser.mjs, because the Node-side
 * tools (tools/merge-files.mjs, the scenario tests) must produce byte-identical output.
 * This module only decides WHICH rows and which file name, and hands the bytes to the
 * browser.
 */
import { toCsv, toHtmlWorkbook, toJson, EXPORT_COLUMNS, EXPORT_HEADERS } from '../parser';
import { conflictRows, duplicateRows, summaryForExport, stamp, fmtDateTime } from './compute';
import type { AppState, ConflictGroup, DuplicateGroup } from '../types';

export function download(filename: string, content: string, mime?: string): void {
  const blob = new Blob([content], { type: `${mime || 'text/plain'};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export const baseName = (d: Date = new Date()): string => `Laporan_Aset_Belum_Diperiksa_PKS_${stamp(d)}`;

/** The format the caller asked for. */
export type ExportKind = 'csv' | 'json' | 'xls';

/** The main list, in whichever format was asked for. */
export function exportRows(
  state: AppState,
  kind: ExportKind,
  rows: Record<string, unknown>[],
  name: string = baseName(),
): void {
  const now = fmtDateTime(new Date());
  if (kind === 'csv') {
    download(`${name}.csv`, toCsv(rows, EXPORT_COLUMNS, EXPORT_HEADERS), 'text/csv');
  } else if (kind === 'json') {
    download(`${name}.json`, toJson(rows, { generatedAt: now, summary: summaryForExport(state) }), 'application/json');
  } else {
    download(`${name}.xls`, toHtmlWorkbook(rows, { generatedAt: now }), 'application/vnd.ms-excel');
  }
}

/** The overlap report is about labels, not provenance, so it names no files. */
export function exportDuplicates(duplicates: DuplicateGroup[]): void {
  download(
    `Pertindihan_Aset_PKS_${stamp()}.csv`,
    toCsv(duplicateRows(duplicates), ['label', 'jenisAset', 'count'], ['Label', 'Jenis Aset', 'Bilangan Salinan']),
    'text/csv',
  );
}

export function exportConflicts(conflicts: ConflictGroup[]): void {
  const cols = ['Label', 'Medan', 'Nilai Disimpan', 'Nilai Bercanggah', 'Fail Bercanggah'];
  download(`Konflik_Aset_PKS_${stamp()}.csv`, toCsv(conflictRows(conflicts), cols, cols), 'text/csv');
}
