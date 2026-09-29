/*
 * harness.js - window.__uiHarness__, the seam the browser suites drive.
 *
 * This is not test scaffolding bolted on: it is the published interface between this
 * application and the five verification suites (tools/verify-ui.mjs, verify-storage,
 * verify-history, verify-assign, verify-viewer) and tools/shot-assign.mjs. It existed
 * before the port and every method below is one of them; the port had to keep the shape
 * exactly, because those suites are what proves the page still behaves.
 *
 * Two properties are load-bearing:
 *
 *  1. Mutations are SYNCHRONOUS. The suites do `loadFilesQuiet(...)` and then read the
 *     DOM in the very next statement, so every state change is flushed before returning.
 *  2. `snapshot()` reads the REAL DOM (rendered rows, column headers, tab counters,
 *     notices). Asserting on state alone would pass even if nothing were drawn.
 *
 * Everything the suites assert about the DOM - #mergedWrap tbody tr, #summaryWrap
 * tbody tr[data-dept], .notice.warn, #cards .card .k/.v, table.grid, .tabLabel - is part
 * of this contract, which is why those class names survived the move to Tailwind.
 */
import { toCsv, toHtmlWorkbook } from './parser';
import {
  buildBreakdown, buildSummary, currentRows, historyView, LABEL_FIELDS, NO_DEPT, printHeaderParts,
} from './lib/compute';
import type { AppApi } from './state/AppProvider';
import type { ActionResult, AppState, AssetRecord } from './types';

/** A file handed to the harness by a suite: a name, its text, and an optional hash. */
export interface HarnessFile {
  name: string;
  text: string;
  sha?: string;
}

export interface HarnessDeps {
  api: AppApi;
  getState: () => AppState;
}

const q = <T extends HTMLElement = HTMLElement>(sel: string): T | null =>
  document.querySelector(sel) as T | null;
const qa = (sel: string): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>(sel));
const byId = (id: string): HTMLElement | null => document.getElementById(id);
const txt = (id: string): string => {
  const el = byId(id);
  return el ? el.textContent || '' : '';
};

/** True when an element exists and is not hidden - the question every panel check asks. */
const shown = (id: string): boolean => {
  const el = byId(id);
  return el ? !el.hidden : false;
};

function buildHarness({ api, getState }: HarnessDeps) {
  const state = () => getState();
  const isViewer = (): boolean => state().me.role === 'viewer' || state().preview;

  /** Deterministic fingerprint of records, so a browser parse can be compared to Node's. */
  const canonical = (records: AssetRecord[]): string => records
    .map((r) => LABEL_FIELDS.map((f) => String(r[f] || '')).join('\u0001'))
    .join('\u0002');

  return {
    /* ---------------------------------------------------------------- loading -- */

    /**
     * Load files as a page would, WITHOUT scheduling a point in D1.
     *
     * Recording a run belongs to the real intake path (a drop or a file picker) - see
     * `loadFiles` in src/state/AppProvider.jsx, which marks the upload pending. The seam
     * deliberately does not, so a suite that is checking a merge, an export or a warning
     * cannot be surprised by a write it never asked for.
     */
    loadFiles: (entries: HarnessFile[]) => {
      api.dispatchSync({
        type: 'LOAD_FILES',
        entries: entries.map((e) => ({ name: e.name, size: e.text.length, text: e.text, sha: e.sha || '' })),
        append: false,
        pendingRun: false,
      });
    },

    /** Load files without sending them to D1, so a suite controls exactly what D1 holds. */
    loadFilesQuiet: (entries: HarnessFile[]) => {
      api.loadFilesQuiet(entries);
    },

    /* ------------------------------------------------------------------ reads -- */

    snapshot: () => {
      const s = state();
      const groups = buildSummary(s.merged);
      const h = historyView({ status: s.d1.status, progress: s.d1.progress });

      return {
        sources: s.sourceStats.length,
        summary: {
          groups: groups.length,
          rows: groups.map((g) => ({
            bahagian: g.label, jumlah: g.total, lokasi: Object.keys(g.lokasi).length,
          })),
          total: groups.reduce((a, g) => a + g.total, 0),
          breakdownRows: buildBreakdown(s.merged).length,
          renderedRows: qa('#summaryWrap tbody tr[data-dept]').length,
          columns: qa('#summaryWrap thead th').map((th) => (th.textContent || '').trim()),
          hasNoDeptWarning: qa('#summaryWrap .notice.warn').length,
          tabCounter: txt('cSum'),
        },
        perFile: s.files.map((f) => ({
          name: f.name,
          rows: (f.records || []).length,
          warnings: (f.warnings || []).length,
          sha: f.sha,
          fingerprint: canonical(f.records || []),
        })),
        mergedFingerprint: canonical(s.merged),
        merged: s.merged.length,
        mergedColumns: qa('#mergedWrap thead th').map((th) => (th.textContent || '').trim()),
        mergedKeys: s.merged.length ? Object.keys(s.merged[0]) : [],
        duplicates: s.duplicates.length,
        conflicts: s.conflicts.length,
        rowsRendered: qa('#mergedWrap tbody tr').length,
        notices: qa('#notices .notice').length,
        duplicatedHashNotice: qa('#notices .notice.warn').length,
        /* Which messages are on screen, so a count mismatch says what it counted. */
        noticeTitles: qa('#notices .notice').map((n) => {
          const head = n.querySelector('strong');
          return `${n.className}:${head ? head.textContent : ''}`;
        }),
        tabCounts: {
          merged: txt('cMerged'), dupes: txt('cDupes'), conflicts: txt('cConf'), sources: txt('cSrc'),
        },
        firstRow: (() => {
          const tr = q('#mergedWrap tbody tr');
          if (!tr) return null;
          return Array.from(tr.querySelectorAll('td')).map((td) => td.textContent);
        })(),
        cards: qa('#cards .card').map((c) => {
          const k = c.querySelector('.k');
          const v = c.querySelector('.v');
          return `${k ? k.textContent : ''}=${v ? v.textContent : ''}`;
        }),
        pagerNote: (() => {
          const note = q('#mergedWrap .toolbar .note');
          return note ? note.textContent : '';
        })(),
        nextDisabled: (() => {
          const btn = q<HTMLButtonElement>('#mergedWrap button[data-page="2"]');
          return btn ? btn.disabled : true;
        })(),
        history: {
          connected: s.d1.up,
          runs: h ? h.runs.length : 0,
          outstanding: h ? h.summary.outstanding : 0,
          resolved: h ? h.summary.resolved : 0,
          reappeared: 0,
          lastInspected: h && h.runs.length ? h.runs[h.runs.length - 1].inspected : 0,
          tabCounter: txt('cHist'),
          renderedRuns: qa('#historyWrap table.grid tbody tr').length,
          renderedTables: qa('#historyWrap table.grid').length,
          progress: h && h.runs.length
            ? h.runs[h.runs.length - 1].deptProgress.map((p) => ({
              bahagian: p.bahagian, awal: p.awal, inspected: p.inspected, akhir: p.akhir,
            }))
            : [],
        },
        assign: {
          zeroDept: s.merged.filter((r) => !(r.Bahagian || '').trim()).length,
          manual: s.merged.filter((r) => r['_Bahagian Diteta']).length,
          total: s.overrides.total || 0,
          applied: s.overrides.applied || 0,
          stale: s.overrides.stale ? s.overrides.stale.length : 0,
          superseded: s.overrides.superseded ? s.overrides.superseded.length : 0,
          supersededLabels: s.overrides.superseded
            ? s.overrides.superseded.map((x) => x.label) : [],
          warningShown: qa('#assignBody .notice.warn').length,
          selects: qa('#assignBody select[data-assign]').length,
          panelVisible: shown('panelAssign'),
        },
        exportCsv: toCsv(s.merged).length,
        // Built here rather than measured from a download, so a suite can prove the Excel
        // export actually has content without driving a file dialog.
        exportXls: toHtmlWorkbook(s.merged, { generatedAt: 'x' }).length,
      };
    },

    /** The D1-backed state the UI renders, for assertions. */
    serverState: () => {
      const s = state();
      return {
        up: s.d1.up,
        checked: s.d1.checked,
        observations: s.d1.status ? s.d1.status.observations : 0,
        outstanding: s.d1.status ? s.d1.status.outstanding : 0,
        inspected: s.d1.status ? s.d1.status.inspected : 0,
        runs: s.d1.progress ? s.d1.progress.length : 0,
        rows: (s.d1.history || []).length,
        current: s.d1.current
          ? {
            assets: s.d1.current.assets,
            observedAt: s.d1.current.observedAt,
            departments: (s.d1.current.departments || []).length,
          }
          : null,
        overrides: Object.keys(s.d1.overrides || {}).length,
        lastError: s.d1.lastError,
        note: txt('serverLink'),
      };
    },

    /** Who the page thinks it is, and whether the screen is showing viewer rules. */
    role: () => {
      const s = state();
      const login = byId('adminLogin');
      const logout = byId('adminLogout');
      return {
        checked: s.me.checked,
        role: s.me.role,
        preview: s.preview,
        showingViewer: isViewer(),
        mode: s.me.mode,
        accessConfigured: s.me.accessConfigured,
        adminsConfigured: s.me.adminsConfigured,
        loginPath: s.me.loginPath || '/api/admin/login',
        loginShown: login ? !login.hidden : false,
        logoutShown: logout ? !logout.hidden : false,
        offline: s.me.offline,
        email: s.me.email,
      };
    },

    /** Which panels and tabs the current role is offering. */
    panels: () => {
      const login = byId('adminLogin');
      const logout = byId('adminLogout');
      return {
        files: shown('panelFiles'),
        options: shown('panelOptions'),
        assign: shown('panelAssign'),
        result: shown('panelResult'),
        viewerTools: shown('viewerTools'),
        previewButton: shown('btnPreview'),
        adminLogin: shown('adminLogin'),
        adminLoginHref: login ? login.getAttribute('href') : null,
        adminLogout: logout ? !logout.hidden : false,
        logoutHref: logout ? logout.getAttribute('href') : null,
        recordRun: shown('btnRecordRun'),
      };
    },

    /**
     * The admin login dialog, as a reader finds it behind "Muat naik".
     *
     * `method` is the Worker's answer, not a local guess, so a suite can prove that the
     * page offers a password field in password mode, an Access link in enforce mode, and
     * an explanation when neither is configured.
     */
    loginBox: () => {
      const s = state();
      const field = byId('loginPassword') as HTMLInputElement | null;
      const dialog = byId('loginDialog');
      return {
        open: !!dialog,
        /* The dialog's own words, so a suite can check it explains the right thing. */
        says: dialog ? (dialog.textContent || '').slice(0, 240) : '',
        method: s.me.loginMethod,
        mode: s.me.mode,
        passwordConfigured: s.me.passwordConfigured,
        uploadButton: shown('btnUpload'),
        fieldShown: !!field,
        focused: !!field && document.activeElement === field,
        error: txt('loginError'),
        unavailable: txt('loginUnavailable'),
        accessHref: (() => {
          const a = byId('loginAccess');
          return a ? a.getAttribute('href') : null;
        })(),
      };
    },

    /** Click "Muat naik senarai" the way a reader would, and report what it opened. */
    requestUpload: () => {
      const btn = byId('btnUpload');
      if (btn) btn.click();
      return !!byId('loginDialog');
    },

    closeLogin: () => { api.closeLogin(); },

    /** The API path, for suites that are not testing the form itself. */
    login: (password: string) => api.login(password),

    logout: () => api.logout(),

    tabs: () => qa('#tabs button').filter((b) => !b.hidden).map((b) => b.dataset.tab),

    /** What each tab is called right now - the label changes with the role. */
    tabLabels: () => {
      const out: Record<string, string> = {};
      qa('#tabs button').forEach((b) => {
        const el = b.querySelector('.tabLabel');
        out[String(b.dataset.tab)] = el ? (el.textContent || '').trim() : '';
      });
      return out;
    },

    /** Column headings of the list table, so a role-specific column can be proved absent. */
    listHeaders: () => qa('#mergedWrap thead th').map((th) => (th.textContent || '').trim()),

    listNote: () => txt('mergedCount'),

    /** Click a department row in the summary, as a user would, and report the filter. */
    clickSummaryRow: (dept: string) => {
      const row = q(`#summaryWrap tbody tr[data-dept="${dept}"]`);
      if (!row) return null;
      row.click();
      const s = state();
      return {
        stateBahagian: s.bahagian,
        viewerSelect: byId('selViewerBahagian') ? (byId('selViewerBahagian') as HTMLSelectElement).value : null,
        adminSelect: byId('selBahagian') ? (byId('selBahagian') as HTMLSelectElement).value : null,
        tab: s.tab,
      };
    },

    printHeader: () => txt('printHead'),

    /** Render as if the print button had been pressed, without opening a dialog. */
    preparePrint: () => {
      const total = api.preparePrint();
      return { rows: total, total, header: txt('printHead') };
    },

    /* ----------------------------------------------------------------- writes -- */

    recordRun: (note: string): Promise<ActionResult> => api.recordRun(note).then((res) => res),
    refresh: () => api.refresh(false),
    deleteRun: (id: number | string) => api.deleteRun(id),
    setAssignment: (label: string, bahagian: string) => api.setOverride(label, bahagian),
    clearAssignments: () => api.clearAllOverrides(),

    setPreview: (on: boolean) => {
      api.dispatchSync({ type: 'TOGGLE_PREVIEW', value: !!on });
      return state().preview;
    },

    /* ---------------------------------------------------------------- outputs -- */

    /** The exact CSV the export button would write, for verifying output. */
    exportCsvText: () => toCsv(currentRows(state())),

    /** One record as the user sees it, looked up by label. */
    findRow: (label: string) => {
      const r = state().merged.find((x) => x.Label === label);
      if (!r) return null;
      const out: Record<string, unknown> = {};
      LABEL_FIELDS.forEach((f) => { out[f] = r[f]; });
      out._manual = !!r['_Bahagian Diteta'];
      out._original = r['_Bahagian Asal'];
      return out;
    },

    /** Labels whose Bahagian is still blank, as the export would show them. */
    blankBahagian: (): string[] => state().merged
      .filter((r) => !(r.Bahagian || '').trim())
      .map((r) => r.Label),

    /** The heading that will appear on paper, without printing. */
    printHeading: () => {
      const s = state();
      const rows = currentRows(s);
      return printHeaderParts(s, rows.length, isViewer()).title;
    },

    /** Keys of the merge result, for asserting provenance is absent. */
    mergedKeys: () => (state().merged.length ? Object.keys(state().merged[0]) : []),

    NO_DEPT,
  };
}

/** The published interface, derived from the implementation so the two cannot disagree. */
export type UiHarness = ReturnType<typeof buildHarness>;

declare global {
  interface Window {
    __uiHarness__?: UiHarness;
  }
}

/**
 * Publish the seam. Kept as a named export because the suites, the app and the console all
 * reach the SAME object; building a second one would give them different state readers.
 */
export function mountHarness(deps: HarnessDeps): UiHarness {
  const harness = buildHarness(deps);
  window.__uiHarness__ = harness;
  return harness;
}
