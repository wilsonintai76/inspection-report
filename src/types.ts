/*
 * types.ts - the shapes this application works with.
 *
 * These existed only in prose and in the heads of whoever wrote the code. They are declared
 * here because they are the two contracts that actually cost something when they drift:
 *
 *   1. The API between the page and the Worker (including the compact `{ fields, rows }`
 *      wire format, which is easy to break because it is not what the code manipulates).
 *   2. window.__uiHarness__, which five browser suites and one screenshot tool drive. A
 *      renamed field there is a silently skipped assertion.
 *
 * The asset record is deliberately a plain string-keyed record rather than a strict
 * interface: the fields come from an uploaded spreadsheet and are looked up by name in
 * filters, exports and the override logic. `LABEL_FIELDS` holds the five that matter.
 */

/** One asset, as it comes out of a source file. Extra keys are tolerated. */
export type AssetRecord = Record<string, string | number | boolean | undefined> & {
  Label: string;
  'Jenis Aset'?: string;
  'Pegawai Penempatan'?: string;
  Bahagian?: string;
  'Lokasi Terkini'?: string;
  /** Copies found while merging. Present on merged records only. */
  '_Bilangan Salinan'?: number;
  /** Set by the manual-assignment step: the value the source file had. */
  '_Bahagian Asal'?: string;
  '_Bahagian Diteta'?: boolean;
};

export type FieldName =
  | 'Label'
  | 'Jenis Aset'
  | 'Pegawai Penempatan'
  | 'Bahagian'
  | 'Lokasi Terkini';

/** A file the user loaded, with whatever the parser made of it. */
export interface SourceEntry {
  name: string;
  size: number;
  text: string;
  sha?: string;
  /** Set when the file could not even be read. */
  error?: string;
  /** Set by the merge step. */
  ok?: boolean;
  records?: AssetRecord[];
  warnings?: string[];
  meta?: { format?: string; [key: string]: unknown };
  parseError?: string | null;
}

/** What a caller hands the reducer when files are picked or restored. */
export interface SourceEntryInput {
  name: string;
  size?: number;
  text: string;
  sha?: string;
  error?: string;
}

/** One overlapping label. */
export interface DuplicateGroup {
  label: string;
  jenisAset?: string;
  count: number;
  sources: string[];
}

/** One label whose details disagree between files. */
export interface ConflictGroup {
  label: string;
  fileName: string;
  differing: string[];
  existing: Record<string, string>;
  incoming: Record<string, string>;
}

/** Per-file numbers shown in the "Butiran Fail" tab. */
export interface SourceStat {
  fileName: string;
  label: string;
  format?: string;
  rows: number;
  unique: number;
  added: number;
  duplicate: number;
  internalDuplicates: number;
}

export interface MergeResult {
  merged: AssetRecord[];
  duplicates: DuplicateGroup[];
  conflicts: ConflictGroup[];
  sourceStats: SourceStat[];
}

/** A department, counted. */
export interface DepartmentCount {
  bahagian: string;
  bilangan: number;
}

/** One point in D1's timeline, as /api/progress reports it. */
export interface ProgressPoint {
  id: number;
  observedAt: string;
  assets: number;
  previous: number | null;
  inspected: number;
  added: number;
  percent: number | null;
  departments: DepartmentCount[];
  deptProgress: DeptProgress[];
}

export interface DeptProgress {
  bahagian: string;
  awal: number;
  inspected: number;
  added: number;
  akhir: number;
}

export interface StatusSummary {
  observations: number;
  assets: number;
  outstanding: number;
  inspected: number;
  first: string | null;
  last: string | null;
  progressPercent?: number;
  reappeared?: number;
  departments: DepartmentCount[];
}

/** A manual Bahagian assignment, as stored in D1 against the asset label. */
export interface OverrideEntry {
  bahagian: string;
  at: string;
}

export type OverrideMap = Record<string, OverrideEntry>;

/** The result of applying the stored assignments to the merge. */
export interface OverrideReport {
  total: number;
  applied: number;
  stale: { label: string; bahagian: string }[];
  superseded: { label: string; ditetapkan: string; sumber: string }[];
}

/** One row of /api/history: a label's whole life across the timeline. */
export interface HistoryRow {
  Label: string;
  'Jenis Aset'?: string;
  Bahagian?: string;
  'Lokasi Terkini'?: string;
  'Pertama Dilihat'?: string;
  'Terakhir Dilihat'?: string;
  'Kali Dilihat'?: number;
  'Kali Hilang'?: number;
  'Muncul Semula'?: number;
  Status?: string;
}

/* --------------------------------------------------------------- the wire ---- */

/**
 * Lists travel as a field list plus value arrays, so the five long field names are stated
 * once instead of repeated in every record (measured: 36% smaller for the list, 49% for the
 * history). `records` is still accepted, so the page keeps working against an older Worker.
 */
export interface CompactList<T> {
  fields: (keyof T & string)[];
  rows: (string | number)[][];
}

export interface CompactOrRecords<T> extends Partial<CompactList<T>> {
  records?: T[];
}

export interface ApiHealth {
  observations: number;
  assets: number;
  db: string;
}

export interface ApiMe {
  ok: true;
  role: 'admin' | 'viewer';
  email: string;
  mode: AccessMode;
  accessConfigured: boolean;
  adminsConfigured: boolean;
  /** True when ADMIN_PASSWORD is set, i.e. the dialog can actually log someone in. */
  passwordConfigured: boolean;
  /** What the page should offer, decided by the Worker so the page never guesses. */
  loginMethod: LoginMethod;
  writeAllowed: boolean;
  adminLoginPath: string;
}

export interface ApiCurrent extends CompactOrRecords<AssetRecord> {
  ok: true;
  id: number | null;
  observedAt: string | null;
  assets: number;
  departments: DepartmentCount[];
}

export interface ApiHistory extends CompactOrRecords<HistoryRow> {
  ok: true;
  count: number;
}

export interface ApiOverrides {
  ok?: true;
  count: number;
  overrides: { label: string; bahagian: string; ditetapkan: string; oleh: string }[];
}

export interface BootstrapBody {
  ok: true;
  me: Omit<ApiMe, 'ok'>;
  health: ApiHealth;
  status: StatusSummary;
  current: ApiCurrent;
  progress: { progress: ProgressPoint[] };
  history: ApiHistory;
  overrides: ApiOverrides;
}

export interface ApiResult<T> {
  status: number;
  body: T | null;
  offline?: boolean;
  error?: string;
}

export type AccessMode = 'enforce' | 'password' | 'open' | 'trusted' | 'offline';

/**
 * How an admin signs in: Cloudflare Access ("enforce"), the password dialog
 * ("password"), or nothing at all - in which case writes are refused.
 */
export type LoginMethod = 'access' | 'password' | 'none';

/* ---------------------------------------------------------------- notices ---- */

/**
 * A message on screen, as data.
 *
 * The old page built these as HTML strings; here every value is a fragment that React
 * escapes on the way out, so a file name containing markup cannot become markup.
 */
export type NoticePart =
  | string
  | number
  | { t: 'text'; v: string }
  | { t: 'b'; v: string }
  | { t: 'mono'; v: string }
  | { t: 'ul'; items: NoticePart[][] }
  | NoticePart[]
  | null
  | undefined;

export type NoticeKind = 'info' | 'ok' | 'warn' | 'bad';

export interface Notice {
  kind: NoticeKind;
  title: string;
  parts: NoticePart[];
}

/* ------------------------------------------------------------------ state ---- */

export interface D1State {
  up: boolean;
  checked: boolean;
  info: { observations: number; assets: number } | null;
  overrides: OverrideMap;
  status: StatusSummary | null;
  progress: ProgressPoint[];
  history: HistoryRow[];
  current: ApiCurrent | null;
  lastError: string;
  pushed: number;
}

export interface MeState {
  checked: boolean;
  role: 'admin' | 'viewer';
  email: string;
  mode: AccessMode;
  accessConfigured: boolean;
  adminsConfigured: boolean;
  passwordConfigured: boolean;
  loginMethod: LoginMethod;
  loginPath: string;
  offline: boolean;
}

export type TabName = 'summary' | 'history' | 'merged' | 'dupes' | 'conflicts' | 'sources';

export interface AppState {
  files: SourceEntry[];
  /** The merge before stored assignments are applied. */
  baseMerged: AssetRecord[];
  /** What every view reads: base merge + assignments. */
  merged: AssetRecord[];
  duplicates: DuplicateGroup[];
  conflicts: ConflictGroup[];
  sourceStats: SourceStat[];
  parseErrors: SourceEntry[];
  identicalGroups: string[][];
  overrides: OverrideReport;
  pendingRun: boolean;

  tab: TabName;
  page: number;
  sortKey: string;
  sortDir: 'asc' | 'desc';
  query: string;
  bahagian: string;
  keyStrategy: string;
  printAll: boolean;

  d1: D1State;
  me: MeState;
  preview: boolean;
  /** The admin login dialog. Public on purpose: a viewer is meant to find it. */
  loginOpen: boolean;

  notices: Notice[];
}

/* ----------------------------------------------------------------- actions ---- */

export type Action =
  | { type: 'LOAD_FILES'; entries: SourceEntryInput[]; append?: boolean; pendingRun?: boolean }
  | { type: 'REMOVE_FILE'; index: number }
  | { type: 'CLEAR_FILES' }
  | { type: 'CLEAR_PENDING_RUN' }
  | { type: 'SET_KEY_STRATEGY'; value: string }
  | { type: 'SET_TAB'; tab: TabName }
  | { type: 'SET_PAGE'; page: number }
  | { type: 'SET_QUERY'; value: string }
  | { type: 'SET_BAHAGIAN'; value: string }
  | { type: 'SET_SORT'; value: string }
  | { type: 'SORT_BY_COLUMN'; key: string }
  | { type: 'SET_PRINT_ALL'; value: boolean }
  | { type: 'RESET_FILTERS' }
  | { type: 'D1_PATCH'; patch: Partial<D1State> }
  | { type: 'ME_PATCH'; patch: Partial<MeState> }
  | { type: 'SET_OVERRIDE_MAP'; map: OverrideMap }
  | { type: 'SET_VIEWER_LIST'; records: AssetRecord[] }
  | { type: 'SET_NOTICES'; notices: Notice[] }
  | { type: 'PUSH_NOTICE'; notice: Notice }
  | { type: 'PUSH_NOTICES'; notices: Notice[] }
  | { type: 'SET_LOGIN_OPEN'; value: boolean }
  | { type: 'TOGGLE_PREVIEW'; value?: boolean };

/* ---------------------------------------------------------------- results ---- */

/** What every D1 action reports back, so callers can tell the user what happened. */
export interface ActionResult {
  ok: boolean;
  reason?: string;
  error?: string;
  runs?: number;
  cleared?: number;
  /** Set by the purge: how many assets went with the points in time. */
  assets?: number;
  at?: string;
  duplicate?: boolean;
  last?: HistoryRun | null;
  summary?: HistorySummary | null;
  /** Echoed back by `recordRun`: the note the caller supplied, for the message text. */
  note?: string;
  /** Present on `deleteRun`: the Worker's raw reply, for callers that need the detail. */
  body?: unknown;
}

export interface HistoryRun {
  id: number;
  at: string;
  note: string;
  total: number;
  labels: string[];
  inspected: number;
  added: number;
  reappeared: number;
  firstRun: boolean;
  deptProgress: DeptProgress[];
  prevAt: string | null;
}

export interface HistorySummary {
  runs: number;
  outstanding: number;
  resolved: number;
  reappeared: number;
  first: string | null;
  last: string | null;
}

export interface HistoryView {
  runs: HistoryRun[];
  summary: HistorySummary;
}

/** Summary rows for the department table. */
export interface DeptGroup {
  key: string;
  label: string;
  total: number;
  lokasi: Record<string, number>;
}

/** The heading that appears on paper. */
export interface PrintHeader {
  title: string;
  meta: string;
  rows: number;
}

/** A card above the list. */
export interface CardSpec {
  k: string;
  v: string | number;
  cls?: string;
}
