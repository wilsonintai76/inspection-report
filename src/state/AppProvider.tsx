/*
 * AppProvider.jsx - the application controller.
 *
 * It owns the reducer, and it owns every conversation with the Worker. Components read
 * `state` and call `api.*`; nothing else fetches.
 *
 * Two things here are not obvious and both matter:
 *
 *  - `stateRef` holds the newest state, because async callbacks (and the verification
 *    harness) need to read state that React has already committed, without waiting for
 *    another render.
 *  - `mountHarness` publishes window.__uiHarness__. That seam is how the browser suites
 *    drive this app, so it is real code with a real contract, not test scaffolding.
 *    Mutations from it use flushSync: a harness that calls loadFiles() and then reads the
 *    DOM must see the DOM, exactly as the old synchronous implementation behaved.
 */
import {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useReducer, useRef,
} from 'react';
import type { Dispatch, MutableRefObject, ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { reducer, initialState } from './reducer';
import * as msg from './notices';
import type {
  Action, ActionResult, ApiCurrent, AppState, AssetRecord, BootstrapBody, DeptGroup, HistoryRow,
  Notice, OverrideMap, ProgressPoint, StatusSummary, TabName,
} from '../types';
import {
  apiBase, expand, fetchBootstrap, fetchCurrent, fetchHistoryCsvUrl,
  postObservation, postOverrides, deleteObservation, purgeObservations, postLogin, postLogout,
} from '../lib/api';
import { historyView, readAsText, sha256Hex, currentRows, buildSummary } from '../lib/compute';
import { mountHarness } from '../harness';

const AppContext = createContext<AppContextValue | null>(null);

/*
 * The controller's public surface, spelled out.
 *
 * Typing this is most of the point of the migration: `useApp()` is how every component and
 * the whole verification harness reach the application, so a renamed or mis-called method is
 * now a compile error instead of a runtime `undefined is not a function` in one of the suites.
 */
export interface AppApi {
  dispatch: Dispatch<Action>;
  dispatchSync: (action: Action) => void;

  /* intake */
  loadFiles: (fileList: FileList | File[], opts?: { quiet?: boolean; append?: boolean }) => Promise<void>;
  loadFilesQuiet: (entries: { name: string; text: string; sha?: string }[]) => void;

  /* D1 */
  refresh: (fresh?: boolean) => Promise<boolean>;
  recordRun: (note: string) => Promise<ActionResult>;
  deleteRun: (id: number | string) => Promise<ActionResult>;
  /** Delete every point in time. The clean slate; the only destructive action here. */
  purgeRuns: () => Promise<ActionResult>;
  setOverride: (label: string, bahagian: string) => Promise<ActionResult>;
  clearAllOverrides: () => Promise<ActionResult>;
  dropSuperseded: () => Promise<void>;
  apiBase: typeof apiBase;
  fetchHistoryCsvUrl: () => string;

  /* derived data */
  rows: () => AssetRecord[];
  /**
   * The department summary, built once per state change.
   *
   * ResultPanel wants its size for the tab counter and SummaryTab wants the rows, and
   * both used to call buildSummary() inside their own render - two passes over 536
   * records for one answer. Sharing it here is the whole point of deriving it once.
   */
  summary: () => DeptGroup[];
  stateRef: MutableRefObject<AppState>;

  /* view controls */
  setTab: (tab: TabName) => void;
  setPage: (page: number) => void;
  setQuery: (value: string) => void;
  setBahagian: (value: string) => void;
  setSort: (value: string) => void;
  sortByColumn: (key: string) => void;
  resetFilters: () => void;
  setKeyStrategy: (value: string) => void;

  /* files */
  removeFile: (index: number) => void;
  clearFiles: () => void;

  /* messages and roles */
  pushNotice: (notice: Notice) => void;
  setNotices: (list: Notice[]) => void;
  togglePreview: () => void;

  /* admin login (the dialog a reader finds behind "Muat naik") */
  openLogin: () => void;
  closeLogin: () => void;
  login: (password: string) => Promise<ActionResult>;
  logout: () => Promise<ActionResult>;

  /* printing */
  print: () => void;
  preparePrint: () => number;
}

export interface AppContextValue {
  state: AppState;
  api: AppApi;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp() mesti digunakan dalam <AppProvider>.');
  return ctx;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  /* Expose the dispatch to the harness synchronously (it flushes). */
  const dispatchSync = useCallback((action: Action) => {
    flushSync(() => dispatch(action));
  }, []);

  /* ------------------------------------------------------------ D1 plumbing -- */

/**
 * What one read applied. A union rather than a bag of optional fields, so `applied.status` is
 * only reachable after checking `applied.ok` - which is exactly the mistake the old
 * JavaScript made: it read `refresh(...)` as if it returned the data instead of a boolean.
 */
type LoadedData =
  | { ok: false }
  | {
    ok: true;
    status: StatusSummary;
    progress: ProgressPoint[];
    history: HistoryRow[];
    current: ApiCurrent | null;
  };

  /**
   * Mirror one bootstrap answer into the local view of D1, and return the parts the
   * caller needs (so an async action does not have to wait for a render to read them).
   */
  const applyBootstrap = useCallback((body: BootstrapBody): Omit<LoadedData & { ok: true }, 'ok'> => {
    const who = body.me;
    dispatchSync({
      type: 'ME_PATCH',
      patch: {
        checked: true,
        role: who.role === 'viewer' ? 'viewer' : 'admin',
        email: who.email || '',
        mode: who.mode || 'open',
        accessConfigured: !!who.accessConfigured,
        adminsConfigured: !!who.adminsConfigured,
        passwordConfigured: !!who.passwordConfigured,
        loginMethod: who.loginMethod || 'none',
        loginPath: who.adminLoginPath || '/api/admin/login',
        offline: false,
      },
    });

    const map: OverrideMap = {};
    ((body.overrides && body.overrides.overrides) || []).forEach((o) => {
      map[o.label] = { bahagian: o.bahagian, at: '' };
    });

    const status = body.status || null;
    const progress = (body.progress && body.progress.progress) || [];
    const history = expand(body.history);

    dispatchSync({
      type: 'D1_PATCH',
      patch: {
        up: true,
        checked: true,
        lastError: '',
        info: {
          observations: (body.health && body.health.observations) || 0,
          assets: (body.health && body.health.assets) || 0,
        },
        status,
        progress,
        history,
        current: body.current || null,
      },
    });

    const viewer = who.role === 'viewer' || stateRef.current.preview;
    if (viewer) {
      dispatchSync({ type: 'SET_VIEWER_LIST', records: expand(body.current) });
      dispatchSync({ type: 'D1_PATCH', patch: { overrides: map } });
    } else {
      dispatchSync({ type: 'SET_OVERRIDE_MAP', map });
    }

    return { status, progress, history, current: body.current || null };
  }, [dispatchSync]);

  /**
   * Read everything the page shows. `fresh` steps around a shared cache after a write.
   *
   * Returns the data it applied, not a boolean: `recordRun` needs the new timeline to
   * report what changed, and re-reading it from state would race the render.
   */
  const loadAll = useCallback(async (fresh?: boolean): Promise<LoadedData> => {
    if (!stateRef.current.d1.up) return { ok: false };
    const res = await fetchBootstrap(fresh);
    if (!(res.body && res.body.ok)) {
      dispatchSync({ type: 'D1_PATCH', patch: { lastError: `HTTP ${res.status}` } });
      return { ok: false };
    }
    const applied = applyBootstrap(res.body);

    if (res.body.me.role === 'viewer') {
      // A viewer has no files: their working set comes from D1 instead.
      const cur = await fetchCurrent(fresh);
      if (cur.body && cur.body.ok) {
        dispatchSync({ type: 'SET_VIEWER_LIST', records: expand(cur.body) });
        dispatchSync({ type: 'D1_PATCH', patch: { current: cur.body } });
      }
    }
    return { ok: true, ...applied };
  }, [applyBootstrap, dispatchSync]);

  /** The boolean form the UI and the suites ask for. */
  const refresh = useCallback(async (fresh?: boolean): Promise<boolean> => (await loadAll(fresh)).ok, [loadAll]);

  /**
   * Send the merged list to D1 as one observation of the not-yet-inspected list.
   *
   * The duplicate check lives in the Worker, not here: it compares against the last
   * observation D1 actually has, which is the only comparison that means anything now
   * that the timeline is shared between machines.
   */
  const recordRun = useCallback(async (note: string): Promise<ActionResult> => {
    const s = stateRef.current;
    if (!s.merged.length) return { ok: false, reason: 'empty' };
    if (!s.d1.up) return { ok: false, reason: 'offline' };

    const at = new Date().toISOString();
    const res = await postObservation({
      observedAt: at,
      source: s.files.map((f) => f.name).join(', '),
      records: s.merged.map((r) => ({
        Label: r.Label,
        'Jenis Aset': r['Jenis Aset'],
        'Pegawai Penempatan': r['Pegawai Penempatan'],
        Bahagian: r.Bahagian,
        'Lokasi Terkini': r['Lokasi Terkini'],
      })),
    });

    const body = res.body;
    if (!(body && (body.ok || body.duplicate))) {
      return {
        ok: false,
        reason: res.offline ? 'network' : 'rejected',
        error: (body && body.error) || `HTTP ${res.status}`,
        at,
      };
    }

    const applied = await loadAll(true);
    const h = applied.ok
      ? historyView({ status: applied.status, progress: applied.progress })
      : null;
    if (body.duplicate) {
      return { ok: false, reason: 'duplicate', at, runs: applied.ok ? applied.progress.length : 0 };
    }
    dispatchSync({ type: 'D1_PATCH', patch: { pushed: stateRef.current.d1.pushed + 1 } });
    return {
      ok: true,
      at,
      note: note || '',
      runs: applied.ok ? applied.progress.length : 0,
      last: h && h.runs.length ? h.runs[h.runs.length - 1] : null,
      summary: h ? h.summary : null,
    };
  }, [loadAll, dispatchSync]);

  /** Delete one observation with everything derived from it. */
  const deleteRun = useCallback(async (id: number | string): Promise<ActionResult> => {
    if (!stateRef.current.d1.up) return { ok: false, reason: 'offline' };
    const res = await deleteObservation(id);
    const applied = await loadAll(true);
    return {
      ok: !!(res.body && res.body.ok),
      runs: applied.ok ? applied.progress.length : 0,
      body: res.body,
    };
  }, [loadAll]);

  /**
   * Delete every point in time.
   *
   * The Worker refuses this for anybody who is not an admin, so the confirmation drawn by
   * the page is a courtesy, not the protection. The page re-reads D1 afterwards instead of
   * guessing what the new state looks like.
   */
  const purgeRuns = useCallback(async (): Promise<ActionResult> => {
    if (!stateRef.current.d1.up) return { ok: false, reason: 'offline' };
    const res = await purgeObservations();
    const body = res.body;
    await loadAll(true);
    if (!(body && body.ok)) {
      return {
        ok: false,
        reason: res.offline ? 'network' : 'rejected',
        error: (body && body.error) || `HTTP ${res.status}`,
      };
    }
    return { ok: true, runs: body.runs, assets: body.assets };
  }, [loadAll]);

  /** Set or clear one manual department assignment. */
  const setOverride = useCallback(async (label: string, bahagian: string): Promise<ActionResult> => {
    const s = stateRef.current;
    if (!s.d1.up) return { ok: false, reason: 'offline' };

    const map = { ...s.d1.overrides };
    if (!bahagian) {
      delete map[label];
    } else {
      // Record what the SOURCE said at this moment, so a later source change can be
      // detected and allowed to win. `at: ''` means the source was blank.
      const row = s.merged.find((r) => r.Label === label);
      const source = row
        ? (row['_Bahagian Asal'] !== undefined ? row['_Bahagian Asal'] : (row.Bahagian || '')).trim()
        : '';
      map[label] = { bahagian, at: source };
    }
    dispatchSync({ type: 'SET_OVERRIDE_MAP', map });

    const entries = Object.keys(map).map((l) => ({
      label: l,
      bahagian: typeof map[l] === 'string' ? map[l] : map[l].bahagian,
    }));
    const res = await postOverrides(entries);
    const body = res.body || null;

    if (body && body.rejected && body.rejected.length) {
      await refresh(true);
      return { ok: false, reason: 'rejected', error: body.error || 'tetapan ditolak' };
    }
    if (!(body && body.ok)) {
      await refresh(true);
      return { ok: false, reason: body ? 'rejected' : 'network', error: `HTTP ${res.status}` };
    }
    return { ok: true };
  }, [refresh, dispatchSync]);

  /** Clear every manual assignment in D1. */
  const clearAllOverrides = useCallback(async (): Promise<ActionResult> => {
    const s = stateRef.current;
    if (!s.d1.up) return { ok: false, reason: 'offline', cleared: 0 };
    const labels = Object.keys(s.d1.overrides);
    if (!labels.length) return { ok: true, cleared: 0 };

    dispatchSync({ type: 'SET_OVERRIDE_MAP', map: {} });
    const res = await postOverrides(labels.map((label) => ({ label, bahagian: '' })));
    const body = res.body || null;
    if (!(body && body.ok)) {
      await refresh(true);
      return { ok: false, reason: 'rejected', cleared: 0 };
    }
    return { ok: true, cleared: labels.length };
  }, [refresh, dispatchSync]);

  /** Drop the assignments the source file has since overridden. */
  const dropSuperseded = useCallback(async (): Promise<void> => {
    const s = stateRef.current;
    const map = { ...s.d1.overrides };
    (s.overrides.superseded || []).forEach((x) => { delete map[x.label]; });
    dispatchSync({ type: 'SET_OVERRIDE_MAP', map });
    const entries = Object.keys(map).map((l) => ({
      label: l,
      bahagian: typeof map[l] === 'string' ? map[l] : map[l].bahagian,
    }));
    await postOverrides(entries);
    dispatchSync({ type: 'PUSH_NOTICE', notice: msg.supersededDroppedNotice() });
  }, [dispatchSync]);

  /* ------------------------------------------------------------------- login -- */

  const openLogin = useCallback((): void => {
    dispatchSync({ type: 'SET_LOGIN_OPEN', value: true });
  }, [dispatchSync]);

  const closeLogin = useCallback((): void => {
    dispatchSync({ type: 'SET_LOGIN_OPEN', value: false });
  }, [dispatchSync]);

  /**
   * Sign in with the admin password.
   *
   * The Worker compares it against its own secret and answers with an HttpOnly cookie; the
   * password is never echoed back. Re-reading /api/bootstrap (with a fresh nonce, so a
   * shared cache cannot answer with the pre-login role) is what turns this screen into the
   * admin dashboard - the role is always the server's answer, never a flag set here.
   */
  const login = useCallback(async (password: string): Promise<ActionResult> => {
    const res = await postLogin(password);
    const body = res.body;
    if (!(body && body.ok)) {
      return {
        ok: false,
        reason: res.offline ? 'network' : 'rejected',
        error: (body && body.error) || `HTTP ${res.status}`,
      };
    }
    await loadAll(true);
    dispatchSync({ type: 'SET_LOGIN_OPEN', value: false });
    dispatchSync({ type: 'PUSH_NOTICE', notice: msg.loginOkNotice(stateRef.current.me.email) });
    return { ok: true };
  }, [loadAll, dispatchSync]);

  /** Sign out: the Worker clears its cookie, then the page re-reads who it is. */
  const logout = useCallback(async (): Promise<ActionResult> => {
    await postLogout();
    const res = await loadAll(true);
    dispatchSync({ type: 'PUSH_NOTICE', notice: msg.logoutNotice() });
    return { ok: res.ok };
  }, [loadAll, dispatchSync]);

  /* ------------------------------------------------------------------ intake -- */

  /** Read files, fingerprint them, and hand them to the reducer. */
  const loadFiles = useCallback(async (
    fileList: FileList | File[],
    { quiet = false, append = true }: { quiet?: boolean; append?: boolean } = {},
  ): Promise<void> => {
    const files = Array.from(fileList);
    if (!files.length) return;
    const entries = await Promise.all(files.map(async (f) => {
      try {
        const text = await readAsText(f);
        return { name: f.name, size: f.size, text, sha: await sha256Hex(text) };
      } catch (err) {
        return { name: f.name, size: f.size, text: '', error: (err as Error)?.message || String(err) };
      }
    }));
    dispatchSync({ type: 'LOAD_FILES', entries, append, pendingRun: !quiet });
  }, [dispatchSync]);

  /** The seam the suites use: load files WITHOUT letting them become a point in D1. */
  const loadFilesQuiet = useCallback((entries: { name: string; text: string; sha?: string }[]): void => {
    dispatchSync({
      type: 'LOAD_FILES',
      entries: entries.map((e) => ({ name: e.name, size: e.text.length, text: e.text, sha: e.sha || '' })),
      append: false,
      pendingRun: false,
    });
  }, [dispatchSync]);

  /* -------------------------------------------------------------------- boot -- */

  const booted = useRef(false);
  /*
   * Layout, not passive: the probe has to be IN FLIGHT before anything else can run.
   *
   * A verification harness loads files in its first statement, and that upload decides
   * whether to record a point in D1 (which needs `d1.up`) or to warn that there is no
   * connection. Starting this after the first paint means the harness - and, on a fast
   * load, a real user - can beat the probe and be told the wrong thing.
   */
  useLayoutEffect(() => {
    if (booted.current) return;
    booted.current = true;

    if (apiBase() === null || typeof fetch !== 'function') {
      // Opened from disk: there is no Worker to reach, so settle immediately and say so.
      dispatchSync({ type: 'D1_PATCH', patch: { checked: true, up: false } });
      dispatchSync({ type: 'ME_PATCH', patch: { checked: true, offline: true, mode: 'offline' } });
      return;
    }
    fetchBootstrap(false).then((res) => {
      if (!(res.body && res.body.ok)) {
        dispatchSync({ type: 'D1_PATCH', patch: { up: false, checked: true, lastError: `HTTP ${res.status}` } });
        dispatchSync({ type: 'ME_PATCH', patch: { checked: true, offline: true } });
        return;
      }
      applyBootstrap(res.body);
      if (res.body.me && res.body.me.role === 'viewer') {
        fetchCurrent(false).then((cur) => {
          if (cur.body && cur.body.ok) {
            dispatchSync({ type: 'SET_VIEWER_LIST', records: expand(cur.body) });
            dispatchSync({ type: 'D1_PATCH', patch: { current: cur.body } });
          }
        });
      }
    });
  }, [applyBootstrap, dispatchSync]);

  /*
   * A fresh upload is a new observation point. Sent from an effect (and not while the
   * page merely opens) so reloading cannot fabricate a point in the timeline; the order
   * of "did it change?" is decided by D1, which compares against the last observation it
   * holds.
   */
  useEffect(() => {
    if (!state.pendingRun) return;
    if (!state.merged.length) return;
    /*
     * Wait until the probe has actually answered before judging the connection.
     *
     * An upload can arrive while the boot request is still in flight - which is exactly what
     * happens when a harness loads files in its first statement, and what happens to a real
     * user on a slow connection who drops a file immediately. Acting on `d1.up === false` at
     * that moment would announce "not saved to D1" for an upload that is about to be saved.
     * The effect runs again when `checked` flips, and clears pendingRun once and for all.
     */
    if (!state.d1.checked) return;
    dispatchSync({ type: 'CLEAR_PENDING_RUN' });
    if (!state.d1.up) {
      dispatchSync({ type: 'PUSH_NOTICE', notice: msg.offlineRunNotice() });
      return;
    }
    recordRun('').then((res) => {
      dispatchSync({ type: 'PUSH_NOTICE', notice: msg.recordRunNotice(res) });
    });
  }, [state.pendingRun, state.merged.length, state.d1.checked, state.d1.up, recordRun, dispatchSync]);

  /* ------------------------------------------------------------------- actions -- */

  /*
   * Derived once per state change, and published through a REF.
   *
   * The api object below is built once and reads the newest state through stateRef, which
   * is what lets components and async callbacks share one stable handle. A plain closure
   * over this value would freeze it at the first render - the summary would stay empty
   * forever, which is exactly what happened the first time this was written.
   */
  const summary = useMemo(() => buildSummary(state.merged), [state.merged]);
  const summaryRef = useRef(summary);
  summaryRef.current = summary;

  const api = useMemo<AppApi>(() => ({
    dispatch,
    dispatchSync,
    loadFiles,
    loadFilesQuiet,
    refresh,
    recordRun,
    deleteRun,
    purgeRuns,
    setOverride,
    clearAllOverrides,
    dropSuperseded,
    stateRef,
    apiBase,
    fetchHistoryCsvUrl,
    /** The rows the table shows, and the rows the exports contain. They are the same. */
    rows: () => currentRows(stateRef.current),
    summary: () => summaryRef.current,
    setTab: (tab) => dispatchSync({ type: 'SET_TAB', tab }),
    setPage: (page) => dispatchSync({ type: 'SET_PAGE', page }),
    setQuery: (value) => dispatchSync({ type: 'SET_QUERY', value }),
    setBahagian: (value) => dispatchSync({ type: 'SET_BAHAGIAN', value }),
    setSort: (value) => dispatchSync({ type: 'SET_SORT', value }),
    sortByColumn: (key) => dispatchSync({ type: 'SORT_BY_COLUMN', key }),
    resetFilters: () => dispatchSync({ type: 'RESET_FILTERS' }),
    setKeyStrategy: (value) => dispatchSync({ type: 'SET_KEY_STRATEGY', value }),
    removeFile: (index) => dispatchSync({ type: 'REMOVE_FILE', index }),
    clearFiles: () => dispatchSync({ type: 'CLEAR_FILES' }),
    pushNotice: (n) => dispatchSync({ type: 'PUSH_NOTICE', notice: n }),
    setNotices: (list) => dispatchSync({ type: 'SET_NOTICES', notices: list }),
    togglePreview: () => dispatchSync({ type: 'TOGGLE_PREVIEW' }),
    openLogin,
    closeLogin,
    login,
    logout,
    /** Render every filtered row, print, then put the screen back. */
    print: () => {
      flushSync(() => dispatch({ type: 'SET_PRINT_ALL', value: true }));
      try {
        window.print();
      } finally {
        // afterprint is not fired by every browser, and print() returns immediately in
        // some of them, so the screen is put back on a timer as well.
        setTimeout(() => dispatch({ type: 'SET_PRINT_ALL', value: false }), 2500);
      }
    },
    /** Render as if the print button had been pressed, without opening a dialog. */
    preparePrint: () => {
      // The rows are rendered in full, counted, and put back - and the count is RETURNED,
      // because by the time the caller can look at the DOM the screen already shows one
      // page again. That is the number a test wants anyway: how many rows printing covers.
      const total = currentRows(stateRef.current).length;
      flushSync(() => dispatch({ type: 'SET_PRINT_ALL', value: true }));
      flushSync(() => dispatch({ type: 'SET_PRINT_ALL', value: false }));
      return total;
    },
  }), [
    dispatchSync, loadFiles, loadFilesQuiet, refresh, recordRun, deleteRun, setOverride,
    clearAllOverrides, dropSuperseded,
  ]);

  /*
   * Publish the verification seam during the FIRST commit, not afterwards.
   *
   * A layout effect runs synchronously as part of the commit, and the root is mounted with
   * flushSync, so window.__uiHarness__ exists by the time the script that follows the
   * application runs. A passive effect would be too late: the harnesses read the page in
   * their very next statement.
   */
  useLayoutEffect(() => {
    mountHarness({ api, getState: () => stateRef.current });
  }, [api]);

  const value = useMemo<AppContextValue>(() => ({ state, api }), [state, api]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
