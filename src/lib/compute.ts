/*
 * compute.ts - the pure part of the application.
 *
 * Everything here answers a question about data and returns a value. Nothing reads the
 * DOM, nothing fetches, nothing mutates its arguments. That is what makes it testable by
 * tests/run-tests.mjs and by the browser suites through window.__uiHarness__, and it is
 * the reason the port to components changed no numbers: these functions were already
 * independent of how the page was drawn.
 *
 * Every function here states what it takes and what it gives back, because this is the file
 * the rest of the application trusts: a wrong column name or a missing field used to surface
 * as a blank cell on screen rather than as an error.
 */
import { parseFile, mergeSources } from '../parser';
import type {
  AppState, AssetRecord, CardSpec, ConflictGroup, DeptGroup, DuplicateGroup, HistoryView,
  OverrideMap, OverrideReport, PrintHeader, ProgressPoint, SourceEntry, SourceStat, StatusSummary,
  TabName,
} from '../types';

/** One asset = one label. Status Aset is deliberately not tracked. */
export const LABEL_FIELDS = ['Label', 'Jenis Aset', 'Pegawai Penempatan', 'Bahagian', 'Lokasi Terkini'];

export const PAGE_SIZE = 250;

/*
 * Sentinel for records whose Bahagian is blank. The summary table, the department
 * filter and the export all use this same key, so a count shown in the summary always
 * equals the number of rows the filter selects.
 */
export const NO_DEPT = '(TIADA BAHAGIAN)';

export const TABS: TabName[] = ['summary', 'history', 'merged', 'dupes', 'conflicts', 'sources'];

/** Whitespace-tolerant read of one label field. */
export const field = (row: AssetRecord | null | undefined, name: string): string =>
  String((row && row[name]) || '');

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(2)} MB`;
}

export function fmtDateTime(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function stamp(d: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

export const sha256Hex = async (text: string): Promise<string> => {
  if (!(window.crypto && window.crypto.subtle)) return '(tidak tersedia)';
  const bytes = new TextEncoder().encode(text);
  const buf = await window.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
};

export const readAsText = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(String(fr.result));
  fr.onerror = () => reject(fr.error || new Error('Gagal membaca fail.'));
  fr.readAsText(file, 'UTF-8');
});

/** Everything parsing and merging produced, plus the two things worth reporting. */
export interface ParseAndMergeResult {
  files: SourceEntry[];
  merged: AssetRecord[];
  duplicates: DuplicateGroup[];
  conflicts: ConflictGroup[];
  sourceStats: SourceStat[];
  failures: SourceEntry[];
  identicalGroups: string[][];
}

/**
 * Parse every loaded file and merge them.
 *
 * Returns the enriched file entries (with their records and any parse error), the merged
 * result, and the two things the notices panel reports: files that could not be read,
 * and uploads whose contents are byte-identical.
 */
export function parseAndMerge(files: SourceEntry[], keyStrategy: string): ParseAndMergeResult {
  const enriched: SourceEntry[] = [];
  const sources: Parameters<typeof mergeSources>[0] = [];
  const failures: SourceEntry[] = [];

  files.forEach((entry) => {
    const next: SourceEntry = { ...entry, ok: false, records: [], warnings: [], meta: {}, parseError: null };
    if (next.error) {
      next.parseError = next.error;
      failures.push(next);
      enriched.push(next);
      return;
    }
    try {
      const parsed = parseFile(next.text, next.name, { name: next.name });
      next.records = parsed.records;
      next.warnings = parsed.warnings || [];
      next.meta = parsed.meta || {};
      next.ok = true;
      sources.push({
        fileName: next.name,
        label: next.name,
        records: next.records,
        warnings: next.warnings,
        meta: next.meta,
      });
    } catch (err) {
      next.parseError = (err as Error)?.message || String(err);
      failures.push(next);
    }
    enriched.push(next);
  });

  // Flag byte-identical uploads so the user is never misled by duplicates.
  const byHash: Record<string, string[]> = {};
  enriched.forEach((f) => {
    if (!f.sha) return;
    byHash[f.sha] = byHash[f.sha] || [];
    byHash[f.sha].push(f.name);
  });
  const identicalGroups = Object.keys(byHash)
    .filter((h) => byHash[h].length > 1)
    .map((h) => byHash[h]);

  const result = mergeSources(sources, { keyStrategy });

  return {
    files: enriched,
    merged: result.merged,
    duplicates: result.duplicates,
    conflicts: result.conflicts,
    sourceStats: result.sourceStats,
    failures,
    identicalGroups,
  };
}

/** What applying the stored assignments did, or refused to do. */
export interface ApplyOverridesResult {
  rows: AssetRecord[];
  overrides: OverrideReport;
}

/**
 * Apply stored assignments to the merged records, returning a NEW list.
 *
 * Two guards, both learned from real failures:
 *
 *  1. An assignment whose department no longer exists is REPORTED, not applied, so a
 *     stale assignment cannot invent a department out of nothing.
 *
 *  2. An assignment SHADOWS the source only while the source has no value of its own.
 *     If someone later sets `Bahagian` for that record in the source file, the source
 *     now holds a deliberate human decision and it WINS - the stored assignment is
 *     dropped and reported. Without this, fixing the export after using the panel
 *     appeared to do nothing at all, with no warning.
 */
export function applyOverrides(merged: AssetRecord[], map: OverrideMap): ApplyOverridesResult {
  const valid: Record<string, true> = {};
  merged.forEach((r) => {
    const d = field(r, 'Bahagian').trim();
    if (d && d !== NO_DEPT) valid[d] = true;
  });

  const stale: OverrideReport['stale'] = [];
  const superseded: OverrideReport['superseded'] = [];
  let applied = 0;

  const rows = merged.map((r) => {
    const entry = map[r.Label];
    if (!entry) return r;
    const want = typeof entry === 'string' ? entry : entry.bahagian;
    const wasAt = typeof entry === 'string' ? '' : (entry.at || '');
    const source = field(r, 'Bahagian').trim();
    if (!want) return r;

    // The source has acquired its own value since this assignment was recorded: treat
    // that as the authoritative correction and stop overriding it.
    if (source && source !== wasAt.trim()) {
      superseded.push({ label: r.Label, ditetapkan: want, sumber: source });
      return r;
    }

    const next: AssetRecord = { ...r, '_Bahagian Asal': field(r, 'Bahagian'), '_Bahagian Diteta': true };
    if (!valid[want]) {
      stale.push({ label: r.Label, bahagian: want });
      return next;
    }
    next.Bahagian = want;
    applied += 1;
    return next;
  });

  return {
    rows,
    overrides: {
      total: Object.keys(map).length,
      applied,
      stale,
      superseded,
    },
  };
}

/** What the table is currently showing: the merged list, filtered and sorted. */
export interface CurrentRowsQuery {
  merged: AssetRecord[];
  query: string;
  bahagian: string;
  sortKey: string;
  sortDir: 'asc' | 'desc';
}

/** Filter and sort the merged list - what the table shows, and what the exports contain. */
export function currentRows({ merged, query, bahagian, sortKey, sortDir }: CurrentRowsQuery): AssetRecord[] {
  const q = query.trim().toLowerCase();
  const rows = merged.filter((r) => {
    // NO_DEPT selects the records whose Bahagian is blank, matching the row the summary
    // table reports for them.
    if (bahagian) {
      const dept = r.Bahagian || NO_DEPT;
      if (dept !== bahagian) return false;
    }
    if (!q) return true;
    return LABEL_FIELDS.some((f) => field(r, f).toLowerCase().includes(q));
  });

  const dir = sortDir === 'asc' ? 1 : -1;
  const norm = (v: unknown): string => String(v || '').toUpperCase();
  const copies = (r: AssetRecord): number => Number(r['_Bilangan Salinan'] || 0);
  rows.sort((a, b) => {
    switch (sortKey) {
      case 'label':
        return dir * a.Label.localeCompare(b.Label, 'ms', { numeric: true });
      case 'pegawai':
        return dir * norm(a['Pegawai Penempatan']).localeCompare(norm(b['Pegawai Penempatan']), 'ms');
      case 'bahagian':
        return dir * norm(a.Bahagian).localeCompare(norm(b.Bahagian), 'ms');
      case 'lokasi':
        return dir * norm(a['Lokasi Terkini']).localeCompare(norm(b['Lokasi Terkini']), 'ms');
      case 'salinan':
        return dir * (copies(b) - copies(a))
          || a.Label.localeCompare(b.Label, 'ms', { numeric: true });
      default: {
        const t = norm(a['Jenis Aset']).localeCompare(norm(b['Jenis Aset']), 'ms');
        return t !== 0 ? dir * t : a.Label.localeCompare(b.Label, 'ms', { numeric: true });
      }
    }
  });
  return rows;
}

/**
 * Group the merged records by Bahagian, tallying which locations contributed. The key
 * used here is the SAME sentinel the filter uses for blank departments, so clicking a
 * row always selects exactly the rows that were counted.
 */
export function buildSummary(merged: AssetRecord[]): DeptGroup[] {
  const groups: Record<string, DeptGroup> = {};
  merged.forEach((r) => {
    const key = r.Bahagian || NO_DEPT;
    if (!groups[key]) groups[key] = { key, label: key, total: 0, lokasi: {} };
    const g = groups[key];
    g.total += 1;
    const loc = r['Lokasi Terkini'] || '(kosong)';
    g.lokasi[loc] = (g.lokasi[loc] || 0) + 1;
  });

  return Object.values(groups).sort((a, b) => {
    // "No department" always sorts last so it cannot hide among the units.
    const aNone = a.key === NO_DEPT;
    const bNone = b.key === NO_DEPT;
    if (aNone !== bNone) return aNone ? 1 : -1;
    return b.total - a.total;
  });
}

/** One row of the breakdown table. */
export type BreakdownRow = {
  Bahagian: string;
  'Lokasi Terkini': string;
  Bilangan: number;
};

/** Rows of the full breakdown table (department, location, count). */
export function buildBreakdown(merged: AssetRecord[]): BreakdownRow[] {
  const map: Record<string, BreakdownRow> = {};
  merged.forEach((r) => {
    const dept = r.Bahagian || NO_DEPT;
    const loc = r['Lokasi Terkini'] || '(kosong)';
    const k = `${dept}\u0001${loc}`;
    if (!map[k]) map[k] = { Bahagian: dept, 'Lokasi Terkini': loc, Bilangan: 0 };
    map[k].Bilangan += 1;
  });
  return Object.values(map).sort((a, b) => {
    if (a.Bahagian !== b.Bahagian) {
      if (a.Bahagian === NO_DEPT) return 1;
      if (b.Bahagian === NO_DEPT) return -1;
      return a.Bahagian.localeCompare(b.Bahagian, 'ms');
    }
    if (a.Bilangan !== b.Bilangan) return b.Bilangan - a.Bilangan;
    return a['Lokasi Terkini'].localeCompare(b['Lokasi Terkini'], 'ms');
  });
}

/** Every non-blank Bahagian present in the loaded data, with counts. */
export function knownDepartments(merged: AssetRecord[]): { name: string; count: number }[] {
  const counts: Record<string, number> = {};
  merged.forEach((r) => {
    const d = field(r, 'Bahagian').trim();
    if (d && d !== NO_DEPT) counts[d] = (counts[d] || 0) + 1;
  });
  return Object.keys(counts).sort().map((d) => ({ name: d, count: counts[d] }));
}

/** Department -> number of records, using the same sentinel as the filter. */
export function departmentCounts(merged: AssetRecord[]): Record<string, number> {
  const counts: Record<string, number> = {};
  merged.forEach((r) => {
    const key = r.Bahagian || NO_DEPT;
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

export interface HistoryViewInput {
  status: StatusSummary | null;
  progress: ProgressPoint[];
}

/**
 * The history view model, built from what D1 reports.
 *
 * D1 already answers "what changed between these two observations" (the sets of labels
 * that disappeared and appeared, per department), so nothing is re-derived here - the
 * page only reshapes those answers for display. Building it twice, once per side, is how
 * the two would drift apart.
 */
export function historyView({ status, progress }: HistoryViewInput): HistoryView | null {
  if (!status || !progress.length) return null;
  const runs = progress.map((p, i) => {
    const prev = i > 0 ? progress[i - 1] : null;
    return {
      id: p.id,
      at: p.observedAt,
      note: '',
      total: p.assets,
      labels: [] as string[],
      inspected: p.inspected || 0,
      added: p.added || 0,
      reappeared: 0,
      firstRun: i === 0,
      deptProgress: p.deptProgress || [],
      prevAt: prev ? prev.observedAt : null,
    };
  });
  return {
    runs,
    summary: {
      runs: status.observations,
      outstanding: status.outstanding,
      resolved: status.inspected,
      reappeared: 0,
      first: status.first,
      last: status.last,
    },
  };
}

/**
 * The heading that appears on paper.
 *
 * Kept separate from the printing itself so it can be checked without opening a print
 * dialog: it is the part that makes a printed list readable after it leaves the screen,
 * and therefore the part a test cannot otherwise see.
 */
export function printHeaderParts(
  { bahagian, query }: { bahagian: string; query: string },
  rowCount: number,
  viewer: boolean,
): PrintHeader {
  const parts: string[] = [];
  if (bahagian) parts.push(`Bahagian: ${bahagian}`);
  if (query) parts.push(`Carian: "${query}"`);
  parts.push(`${rowCount} rekod`);
  parts.push(`dicetak ${fmtDateTime(new Date())}`);
  if (viewer) parts.push('sumber: pangkalan data D1');
  return {
    title: viewer ? 'Aset belum diperiksa - PKS' : 'Senarai gabungan aset - PKS',
    meta: parts.join('  \u00b7  '),
    rows: rowCount,
  };
}

/** Cards above the list: a viewer reads D1, an admin reads the merge. */
export function mergedCards(state: AppState, isViewer: boolean): CardSpec[] {
  if (isViewer) {
    const c = state.d1.current;
    const assets = (c && c.assets) || 0;
    return [
      { k: 'Aset belum diperiksa', v: assets, cls: assets ? 'warn' : 'good' },
      { k: 'Bahagian terlibat', v: ((c && c.departments) || []).length },
      { k: 'Kemas kini terakhir', v: c && c.observedAt ? String(c.observedAt).slice(0, 10) : '-' },
    ];
  }
  const totalRows = state.sourceStats.reduce((a, s) => a + s.rows, 0);
  const dupRows = state.sourceStats.reduce((a, s) => a + s.duplicate, 0);
  return [
    { k: 'Fail dibaca', v: state.sourceStats.length },
    { k: 'Baris mentah', v: totalRows },
    { k: 'Rekod unik (gabungan)', v: state.merged.length, cls: 'good' },
    { k: 'Baris bertindih dibuang', v: dupRows, cls: dupRows ? 'warn' : '' },
    { k: 'Label dengan konflik', v: state.conflicts.length, cls: state.conflicts.length ? 'bad' : '' },
  ];
}

/** Tab counters, kept in one place so they cannot disagree with the cards. */
export function tabCounts(
  state: AppState,
  isViewer: boolean,
): { merged: number; dupes: number; conf: number; src: number } {
  if (isViewer) {
    const c = state.d1.current;
    return { merged: (c && c.assets) || 0, dupes: 0, conf: 0, src: 0 };
  }
  return {
    merged: state.merged.length,
    dupes: state.duplicates.length,
    conf: state.conflicts.length,
    src: state.sourceStats.length,
  };
}

/** One row of the overlap report. */
export type DuplicateRow = {
  label: string;
  jenisAset: string;
  count: number;
  sources: string;
};

/** Export payloads: the overlap and conflict reports. */
export function duplicateRows(duplicates: DuplicateGroup[]): DuplicateRow[] {
  return duplicates.map((d) => ({
    label: d.label,
    jenisAset: d.jenisAset || '',
    count: d.count,
    sources: (d.sources || []).join(', '),
  }));
}

/** One row of the conflict report. */
export type ConflictRow = {
  Label: string;
  Medan: string;
  'Nilai Disimpan': string;
  'Nilai Bercanggah': string;
  'Fail Bercanggah': string;
};

export function conflictRows(conflicts: ConflictGroup[]): ConflictRow[] {
  const flat: ConflictRow[] = [];
  conflicts.forEach((c) => {
    c.differing.forEach((f) => {
      flat.push({
        Label: c.label,
        Medan: f,
        'Nilai Disimpan': c.existing[f],
        'Nilai Bercanggah': c.incoming[f],
        'Fail Bercanggah': c.fileName,
      });
    });
  });
  return flat;
}

/** The machine-readable summary that ships beside the exported rows. */
export interface ExportSummary {
  fail: { nama: string; format?: string; baris: number; ditambah: number; bertindih: number }[];
  jumlahRekodUnik: number;
  labelKonflik: number;
}

export function summaryForExport(state: AppState): ExportSummary {
  return {
    fail: state.sourceStats.map((s) => ({
      nama: s.fileName, format: s.format, baris: s.rows, ditambah: s.added, bertindih: s.duplicate,
    })),
    jumlahRekodUnik: state.merged.length,
    labelKonflik: state.conflicts.length,
  };
}
