/*
 * api.js - the only place that talks to the Worker.
 *
 * Records live in D1, reached through the Worker that serves this page. There is
 * deliberately NO browser persistence: localStorage was removed because a second,
 * invisible copy of the data caused two problems that cannot be fixed from inside the
 * page - it disagreed with D1 (two people saw different numbers for the same list),
 * and it silently expired with the browser's cache.
 *
 * Opened from disk (file://) there is no Worker to reach, so the probe fails
 * immediately and the page says which features that costs. Merging, filtering and
 * exporting keep working, because they need no server.
 */

import type {
  ApiCurrent, ApiResult, AssetRecord, BootstrapBody, CompactOrRecords,
} from '../types';

/** The API origin, or null when there is nothing to talk to. */
export function apiBase(): string | null {
  // Allow the page to point at an API on a DIFFERENT origin - needed when the page is
  // hosted somewhere else and only the API runs on Cloudflare. Set it by adding
  // data-api="https://..." to the <html> element at deploy time; absent or empty means
  // "same origin", which is what the Worker uses because it serves both.
  const explicit = document.documentElement.getAttribute('data-api');
  if (explicit) return String(explicit).replace(/\/$/, '');
  // file:// has no meaningful origin, so there is nothing to talk to.
  if (!window.location.protocol || window.location.protocol === 'file:') return null;
  return '';
}

/*
 * One request helper. Every call resolves to { status, body, offline } and never
 * throws, so a dropped connection becomes a visible error instead of a broken page.
 *
 * `cache: 'default'` (not 'no-store') on purpose: every read carries an ETag and
 * `max-age=0, must-revalidate`, so the browser MUST revalidate - it can never show a
 * stale list, but an unchanged one costs a 304 instead of the whole body.
 */
async function request<T>(
  method: string,
  path: string,
  payload?: unknown,
): Promise<ApiResult<T>> {
  const base = apiBase();
  if (base === null || typeof fetch !== 'function') {
    return { status: 0, body: null, offline: true };
  }
  const init: RequestInit = { method, cache: 'default', headers: {} };
  if (payload !== undefined) {
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    init.body = JSON.stringify(payload);
  }
  try {
    const res = await fetch(base + path, init);
    const text = await res.text();
    let body: T | null = null;
    try {
      body = text ? (JSON.parse(text) as T) : null;
    } catch {
      body = null;
    }
    return { status: res.status, body, offline: false };
  } catch (err) {
    return {
      status: 0,
      body: null,
      offline: true,
      error: (err as Error)?.message || String(err),
    };
  }
}

/** `fresh` appends a nonce, stepping around a shared cache that holds a pre-write answer. */
const bust = (path: string): string => `${path}${path.includes('?') ? '&' : '?'}t=${Date.now()}`;

export const apiGet = <T>(path: string, fresh?: boolean): Promise<ApiResult<T>> =>
  request<T>('GET', fresh ? bust(path) : path);
export const apiPost = <T>(path: string, payload?: unknown): Promise<ApiResult<T>> =>
  request<T>('POST', path, payload);
export const apiDelete = <T>(path: string): Promise<ApiResult<T>> => request<T>('DELETE', path);

/*
 * Undo the compact wire format: `{ fields, rows }` becomes objects again.
 *
 * The Worker states the column names ONCE instead of repeating five long Malay keys in
 * every one of 536 records, which measured 36% smaller for the list and 49% for the
 * history. Nothing above this line has to know that. `records` is still accepted so the
 * page keeps working against an older Worker.
 */
export function expand<T>(body: CompactOrRecords<T> | null | undefined): T[] {
  if (!body) return [];
  if (Array.isArray(body.records)) return body.records;
  const fields = body.fields || [];
  return (body.rows || []).map((row) => {
    const out: Record<string, string | number> = {};
    fields.forEach((f, i) => {
      out[f] = row[i] === undefined ? '' : row[i];
    });
    return out as T;
  });
}

/* ---------------------------------------------------------------- endpoints -- */

/** Everything the page renders, in ONE round trip (it used to be six, in two waves). */
export const fetchBootstrap = (fresh?: boolean) => apiGet<BootstrapBody>('/api/bootstrap', fresh);
export const fetchCurrent = (fresh?: boolean) => apiGet<ApiCurrent>('/api/current', fresh);
export const fetchHistoryCsvUrl = (): string => `${apiBase() || ''}/api/export.csv`;

export interface WriteResult {
  ok?: boolean;
  duplicate?: boolean;
  error?: string;
  observationId?: number;
  assets?: number;
  added?: number;
  inspected?: number;
  rejected?: { label: string; bahagian: string }[];
  set?: number;
  cleared?: number;
  /** The purge answer: how much was thrown away, and what was deliberately kept. */
  runs?: number;
  overridesKept?: boolean;
}

/* Writes go through the prefix Cloudflare Access protects. */
export const postObservation = (payload: {
  observedAt: string;
  source?: string;
  records: Partial<AssetRecord>[];
}) => apiPost<WriteResult>('/api/admin/observations', payload);

export const postOverrides = (entries: { label: string; bahagian: string }[]) =>
  apiPost<WriteResult>('/api/admin/overrides', { overrides: entries });

export const deleteObservation = (id: number | string) =>
  apiDelete<WriteResult>(`/api/admin/observations/${encodeURIComponent(id)}`);

/**
 * Delete EVERY point in time - the clean slate, and the only destructive call here.
 *
 * No id: the collection is the whole timeline. The Worker refuses it for anybody who is
 * not an admin, exactly like the other writes, and leaves the manual Bahagian
 * assignments alone (they are decisions, not snapshots).
 */
export const purgeObservations = () => apiDelete<WriteResult>('/api/admin/observations');

/* ------------------------------------------------------------- login/logout -- */

/**
 * The admin password, posted to the protected prefix.
 *
 * The Worker compares it against its own secret and answers with an HttpOnly cookie, so
 * the password never appears in a URL, a log or the reply - and the page never has to
 * store anything: the browser holds the session, and only the Worker can read it.
 */
export const postLogin = (password: string) =>
  apiPost<WriteResult>('/api/admin/login', { password });

/** Sign out. The Worker clears its cookie; the redirect back to the page is followed. */
export const postLogout = () => apiPost<WriteResult>('/api/admin/logout');
