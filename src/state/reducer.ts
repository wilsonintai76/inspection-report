/*
 * reducer.js - the application state, as one reducer.
 *
 * This is the same state the old page kept in a module-level object, spelled out as
 * transitions instead of assignments. The reason to bother: the old `state` was mutated
 * from twenty places, and every renderer had to remember to call the right `renderX()`
 * afterwards. Miss one and two parts of the screen disagreed - which had actually
 * happened, and is why the tab counters used to stay blank on first paint.
 *
 * Derived values (the filtered list, the department summary, the history view model) are
 * NOT stored here. They are computed from this state by src/lib/compute.js, so there is
 * exactly one way they can be produced.
 */
import { applyOverrides, parseAndMerge, TABS } from '../lib/compute';
import type { ApplyOverridesResult } from '../lib/compute';
import * as msg from './notices';
import type {
  Action, AppState, AssetRecord, ConflictGroup, Notice, OverrideMap, OverrideReport, SourceEntry,
  SourceStat, TabName,
} from '../types';

/**
 * The tabs a reader has no business seeing.
 *
 * Sejarah Pemeriksaan is the admin's tool: it carries the register's three figures, the
 * movement between uploads and - behind the same tab - the delete buttons. A reader's job is
 * to read the list.
 */
const ADMIN_ONLY_TABS: TabName[] = ['history'];

/**
 * Which tab the page may actually point at.
 *
 * A role can change while a tab is open (an admin logs out, or flips the preview toggle), and
 * a page left pointing at a tab that no longer exists shows an EMPTY panel - which reads as
 * "the page is broken" rather than "that is not your view". Falling back to the list is what
 * makes the tab genuinely absent for a reader.
 */
const readerTab = (tab: TabName, role: string, preview: boolean): TabName =>
  ((role === 'viewer' || preview) && ADMIN_ONLY_TABS.includes(tab) ? 'merged' : tab);

export const initialState: AppState = {
  /* ---- files and the merge of them (admin side) ---- */
  files: [],            // { name, size, text, sha, error }
  baseMerged: [],       // the merge, before stored assignments are applied
  merged: [],           // what every view reads: base merge + assignments
  duplicates: [],
  conflicts: [],
  sourceStats: [],
  parseErrors: [],
  identicalGroups: [],
  overrides: { total: 0, applied: 0, stale: [], superseded: [] },
  /** A new upload should become a point in D1's timeline; a restore should not. */
  pendingRun: false,

  /* ---- what the list shows ---- */
  tab: 'merged',
  page: 1,
  sortKey: 'jenis',
  sortDir: 'asc',
  query: '',
  bahagian: '',
  keyStrategy: 'label',
  /** Set while printing, so the table renders every filtered row instead of one page. */
  printAll: false,

  /* ---- D1, mirrored for rendering ---- */
  d1: {
    up: false,
    checked: false,
    info: null,
    overrides: {},
    status: null,
    progress: [],
    history: [],
    current: null,
    lastError: '',
    pushed: 0,
  },

  /* ---- who the Worker says we are ---- */
  me: {
    checked: false,
    role: 'admin',
    email: '',
    mode: 'offline',
    accessConfigured: false,
    adminsConfigured: true,
    passwordConfigured: false,
    loginMethod: 'none',
    loginPath: '/api/admin/login',
    offline: false,
  },

  /**
   * The preview switch: an admin looking at the viewer's screen without changing the
   * real role, which is the only way to check that a change did not break it.
   */
  preview: false,

  /** The admin login dialog: closed until somebody asks for it. */
  loginOpen: false,

  notices: [],
};

/* ------------------------------------------------------------------ helpers -- */

/** The pair the state stores after stored assignments are applied to a merge. */
export interface MergedWithOverrides {
  merged: AssetRecord[];
  overrides: OverrideReport;
}

/** Apply the stored assignments to a merge and return the pair the state stores. */
function withOverrides(baseMerged: AssetRecord[], map: OverrideMap): MergedWithOverrides {
  const applied: ApplyOverridesResult = applyOverrides(baseMerged, map);
  return { merged: applied.rows, overrides: applied.overrides };
}

/** Everything a merge produced that decides which messages it deserves. */
interface MergeNoticesInput {
  files: SourceEntry[];
  merged: AssetRecord[];
  conflicts: ConflictGroup[];
  failures: SourceEntry[];
  identicalGroups: string[][];
  /** Accepted so callers can pass the whole merge result; deliberately not read. */
  sourceStats?: SourceStat[];
}

/**
 * The messages produced by a merge. Kept next to the transition that creates them, so a
 * list of files and the warnings about it can never be rendered out of step with each
 * other.
 */
function mergeNotices(
  { files, merged, conflicts, failures, identicalGroups }: MergeNoticesInput,
): Notice[] {
  if (!files.length) return [];

  const out: Notice[] = [];
  if (failures.length) out.push(msg.parseFailureNotice(failures));
  if (identicalGroups.length) out.push(msg.identicalFilesNotice(identicalGroups));

  const parsedOk = files.filter((f) => f.ok);
  const withWarnings = parsedOk.filter((f) => (f.warnings || []).length);
  if (withWarnings.length) out.push(msg.parseNotesNotice(withWarnings));

  if (conflicts.length) out.push(msg.conflictsNotice(conflicts.length));
  if (parsedOk.length && !failures.length && !conflicts.length) {
    out.push(msg.doneNotice(parsedOk.length, merged.length));
  }
  return out;
}

/** Re-parse everything. Used by load, remove and key-strategy changes. */
function remerge(state: AppState, files: SourceEntry[], noticesFor = true): AppState {
  const result = parseAndMerge(files, state.keyStrategy);
  const applied = withOverrides(result.merged, state.d1.overrides);
  const next = {
    ...state,
    files: result.files,
    baseMerged: result.merged,
    merged: applied.merged,
    duplicates: result.duplicates,
    conflicts: result.conflicts,
    sourceStats: result.sourceStats,
    parseErrors: result.failures,
    identicalGroups: result.identicalGroups,
    overrides: applied.overrides,
  };
  if (noticesFor) next.notices = mergeNotices({ ...result, files: result.files, merged: applied.merged });
  return next;
}

/* ------------------------------------------------------------------ reducer -- */

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    /* ---- files ---- */

    case 'LOAD_FILES': {
      const entries: SourceEntry[] = action.entries.map((e) => ({
        name: e.name,
        path: e.path || '',
        size: e.size !== undefined ? e.size : String(e.text || '').length,
        text: e.text,
        sha: e.sha || '',
        error: e.error,
      }));
      const files = action.append ? state.files.concat(entries) : entries;
      return {
        ...remerge(state, files),
        // A genuine new upload is a new observation point; a restore of an existing
        // list is not, and the caller says which one this is.
        pendingRun: action.pendingRun !== false,
      };
    }

    case 'REMOVE_FILE': {
      const files = state.files.slice();
      files.splice(action.index, 1);
      return remerge(state, files);
    }

    /** The upload in hand has been sent (or refused); it is no longer pending. */
    case 'CLEAR_PENDING_RUN':
      return { ...state, pendingRun: false };

    case 'CLEAR_FILES': {
      return {
        ...state,
        files: [],
        baseMerged: [],
        merged: [],
        duplicates: [],
        conflicts: [],
        sourceStats: [],
        parseErrors: [],
        identicalGroups: [],
        overrides: { total: 0, applied: 0, stale: [], superseded: [] },
        bahagian: '',
        query: '',
        page: 1,
        pendingRun: false,
        notices: [],
      };
    }

    case 'SET_KEY_STRATEGY': {
      return remerge({ ...state, keyStrategy: action.value }, state.files);
    }

    /* ---- view controls ---- */

    case 'SET_TAB':
      return { ...state, tab: TABS.includes(action.tab) ? action.tab : 'merged' };

    case 'SET_PAGE':
      return { ...state, page: Math.max(1, action.page) };

    case 'SET_QUERY':
      return { ...state, query: action.value, page: 1 };

    case 'SET_BAHAGIAN':
      // Filtering is a change of view: the table has to start at the top.
      return { ...state, bahagian: action.value, page: 1 };

    case 'SET_SORT':
      return { ...state, sortKey: action.value, page: 1 };

    case 'SORT_BY_COLUMN': {
      const next = action.key;
      const same = state.sortKey === next;
      return {
        ...state,
        sortKey: next,
        sortDir: same ? (state.sortDir === 'asc' ? 'desc' : 'asc') : 'asc',
        page: 1,
      };
    }

    case 'SET_PRINT_ALL':
      return { ...state, printAll: action.value };

    case 'RESET_FILTERS':
      return { ...state, query: '', bahagian: '', page: 1 };

    /* ---- D1 ---- */

    case 'D1_PATCH':
      return { ...state, d1: { ...state.d1, ...action.patch } };

    case 'ME_PATCH': {
      const me = { ...state.me, ...action.patch };
      return { ...state, me, tab: readerTab(state.tab, me.role, state.preview) };
    }

    /** D1's assignment map changed: re-apply it to the merge already in memory. */
    case 'SET_OVERRIDE_MAP': {
      const applied = withOverrides(state.baseMerged, action.map);
      return { ...state, d1: { ...state.d1, overrides: action.map }, ...applied };
    }

    /**
     * A viewer's list IS D1's current list, not a merge of files they cannot upload.
     * Loading it into the same `merged` field means the table, the department summary,
     * the filters and the three exports all work unchanged - one dataset, one code path,
     * and the viewer sees exactly what everybody else sees.
     */
    case 'SET_VIEWER_LIST': {
      const merged: AssetRecord[] = (action.records || []).map((r) => {
        const copy: AssetRecord = { Label: '', '_Bilangan Salinan': 1 };
        ['Label', 'Jenis Aset', 'Pegawai Penempatan', 'Bahagian', 'Lokasi Terkini']
          .forEach((f) => { copy[f] = r[f] || ''; });
        return copy;
      });
      return {
        ...state,
        files: [],
        baseMerged: merged,
        merged,
        duplicates: [],
        conflicts: [],
        sourceStats: [],
        page: 1,
      };
    }

    /* ---- messages ---- */

    case 'SET_NOTICES':
      return { ...state, notices: action.notices || [] };

    case 'PUSH_NOTICE':
      return { ...state, notices: (state.notices || []).concat([action.notice]) };

    case 'PUSH_NOTICES':
      return { ...state, notices: (state.notices || []).concat(action.notices || []) };

    /* ---- admin login dialog ---- */

    case 'SET_LOGIN_OPEN':
      return { ...state, loginOpen: action.value };

    /* ---- role preview ---- */

    case 'TOGGLE_PREVIEW': {
      const preview = action.value === undefined ? !state.preview : !!action.value;
      return { ...state, preview, tab: readerTab(state.tab, state.me.role, preview) };
    }

    default:
      return state;
  }
}

/** Test seam: the pieces the browser suites read back. */
export const __internals = { withOverrides, mergeNotices, remerge };
