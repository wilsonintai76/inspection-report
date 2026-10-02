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
  /**
   * Where the file sat inside the folder it came from, e.g. "2026-09/ABR.xls".
   *
   * Empty when the file was picked on its own. It is what tells two identically named
   * exports from different month-folders apart, which the name alone cannot do.
   */
  path?: string;
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
  /** Relative path inside the folder it came from; '' or absent when picked alone. */
  path?: string;
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

/**
 * The three numbers an admin copies from the register (ringkasan Sistem Pengurusan Aset
 * Alih), typed in by hand.
 *
 * The uploaded export decides what the FILE lists; these three are claims about the whole
 * register, and the register is the authority. `outstanding` is what makes an upload
 * checkable: the register's figure sits beside the file's own count, so a file that is not
 * the whole list shows up as a gap. `null` means "not set".
 */
export interface ManualFigures {
  totalAssets: number | null;
  inspected: number | null;
  /** The register's "belum diperiksa" - the reference the upload is checked against. */
  outstanding: number | null;
  /** When the figures were last stored, or null when nothing was ever typed in. */
  updatedAt: string | null;
  updatedBy: string;
}

export interface StatusSummary {
  observations: number;
  assets: number;
  outstanding: number;
  inspected: number;
  first: string | null;
  last: string | null;
  /** Present on a Worker that stores handwritten figures; absent on an older one. */
  manual?: ManualFigures;
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
  /** Admin only: the Worker leaves both out for a reader, who never sees the Sejarah tab. */
  progress?: { progress: ProgressPoint[] };
  history?: ApiHistory;
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
  /** Set by `setFigures`: the figures the Worker now holds. */
  figures?: ManualFigures;
  outstanding?: number;
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
  /** How many assets the NEWEST upload lists - the file's own count, not the register's. */
  outstandingFile: number;
  reappeared: number;
  first: string | null;
  last: string | null;
  /**
   * The register's own total, exactly as an admin keyed it in - `null` until he does.
   *
   * NOT derived from the uploads, deliberately: every uploaded file is the list of assets
   * still OUTSTANDING, so it says nothing about how many assets the institution actually
   * holds. That number comes from the ringkasan of Sistem Pengurusan Aset Alih.
   */
  total: number | null;
  /** The register's inspected count, keyed in from the same ringkasan. `null` until then. */
  resolved: number | null;
  /**
   * The register's "belum diperiksa", keyed in from the same ringkasan. `null` until then.
   *
   * This is the figure the report shows, and `outstandingFile` is the one it is checked
   * against: the register says how many assets should still be waiting, and the upload says
   * how many the file actually listed. A gap between them is a half-complete export or an
   * out-of-date register - either way the report says so rather than picking one silently.
   */
  outstanding: number | null;
  /**
   * What the UPLOADS say, which is a different question: how many distinct labels D1 has
   * seen, and how many of them are absent from the newest list. Shown as context in the
   * dialog and in tooltips, never as the register's figures.
   */
  derived: { total: number; inspected: number };
  /** When the numbers last changed: the newest upload, or a later handwritten one. */
  updatedAt: string | null;
  updatedBy: string;
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

/**
 * A card above a list.
 *
 * A card that carries an action is pressable, which is how a count becomes a door to the
 * list it counts instead of a dead end. Without `onClick` the card stays inert text, so a
 * suite can tell the two apart by the element itself (div vs button).
 */
export interface CardSpec {
  k: string;
  v: string | number;
  cls?: string;
  /** A second, smaller line under the value - a time under a date, for instance. */
  sub?: string;
  /** Present = the card can be pressed. */
  onClick?: () => void;
  /** Tooltip for a pressable card, so where it goes is not a surprise. */
  title?: string;
  /** Anchor id, so a suite can press a card by name rather than by position. */
  id?: string;
}
