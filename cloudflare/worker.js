/*
 * worker.js - the whole backend: static app + JSON API + D1 storage.
 *
 * ONE DEPLOYMENT
 * --------------
 * `dist/` is bound as static assets, so this single Worker serves the page at `/`
 * and answers `/api/*` itself. There is no second service to keep in sync, and
 * nothing to install on the client: the page works the moment it is opened.
 *
 *   GET  /                 -> dist/index.html (the app)
 *   GET|POST /api/...      -> handled below, records kept in D1
 *
 * Anything that matches a file in dist/ is served by the asset handler without
 * waking this Worker at all; only unmatched paths (the API) reach `fetch`.
 *
 * WHY NO FRAMEWORK
 * ----------------
 * This app parses the malformed .xls exports in the browser and stores the
 * resulting records. Nothing here renders HTML, so React (or any UI framework)
 * would add a build step and hundreds of KB to solve a problem this project does
 * not have. The deliverable stays a single static file.
 *
 * WHY THE PARSER IS NOT PORTED
 * ----------------------------
 * src/parser.mjs is the single source of parsing truth and is shared with the
 * browser. Re-implementing it in the Worker would create a second copy that drifts
 * silently. So the browser parses, the Worker stores.
 */

const NO_DEPT = '(TIADA BAHAGIAN)';
const STATUS_OUTSTANDING = 'Belum diperiksa';
const STATUS_INSPECTED = 'Sudah diperiksa';
const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
};

/* No pretty-printing: this is wire format, read by a parser, never by a person. The
   1-space indent used to add indentation to every line of every record - on a
   536-row list that is thousands of bytes of nothing. */
const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { ...JSON_HEADERS, ...extra } });

const fail = (status, error) => json({ ok: false, error }, status);

/* ------------------------------------------------------------------ caching --
 *
 * Reads are revalidated instead of re-sent. Every list answer carries a strong ETag
 * over its body, so a repeat visit costs a 304 with no body at all - and the browser
 * never has to trust a stale list.
 *
 * max-age=0, must-revalidate keeps the browser honest (it always asks), while
 * s-maxage/stale-while-revalidate let a shared cache absorb a burst of viewers
 * without running this Worker or touching D1. The list only changes when an admin
 * uploads, which is why a short window is a fair trade; the page busts the cache with
 * a timestamp after a write, so an admin never sees their own upload disappear.
 */
const READ_CACHE = 'public, max-age=0, s-maxage=15, stale-while-revalidate=60';

/*
 * A request that carries credentials must never be answered - or stored - by a shared
 * cache.
 *
 * /api/me and /api/bootstrap contain the CALLER's role, and a shared cache keys on the
 * URL alone: an admin who had just logged in was handed the anonymous copy of /api/me
 * (role "viewer") that the edge had cached seconds earlier, which read as "logging in did
 * nothing". The page hides that with a cache-busting nonce after a login, but the rule
 * belongs here: private responses get a private policy, so no other visitor can ever be
 * served somebody else's identity. Anonymous reads keep the shared window, which is
 * where the burst-absorbing actually pays.
 */
const PRIVATE_CACHE = 'private, max-age=0, must-revalidate';
const carriesCredentials = (request) => !!request.headers.get('Cookie')
  || !!request.headers.get(ACCESS_HEADER);

/** SHA-256 over the exact body, truncated - the only cheap way to be sure. */
async function strongEtag(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const bytes = new Uint8Array(digest).subarray(0, 16);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return `"${hex}"`;
}

/** A cacheable JSON read: 200 with a validator, or a bodyless 304 if nothing changed. */
async function cachedJson(request, obj, cacheControl) {
  const policy = cacheControl
    || (carriesCredentials(request) ? PRIVATE_CACHE : READ_CACHE);
  const body = JSON.stringify(obj);
  const etag = await strongEtag(body);
  const headers = { ...JSON_HEADERS, ETag: etag, 'Cache-Control': policy };

  const inm = request.headers.get('If-None-Match');
  if (inm) {
    const tags = inm.split(',').map((t) => t.trim());
    if (tags.includes(etag) || tags.includes('*') || tags.includes(`W/${etag}`)) {
      return new Response(null, { status: 304, headers });
    }
  }
  return new Response(body, { status: 200, headers });
}

/* ------------------------------------------------------------------ compact --
 *
 * Lists are sent as a field list plus arrays of values rather than one object per
 * record. On the 536-asset list every record repeated the same five long Malay key
 * names - the names are the same in every row, so they are stated once.
 */
const CURRENT_FIELDS = ['Label', 'Jenis Aset', 'Pegawai Penempatan', 'Bahagian', 'Lokasi Terkini'];
const HISTORY_FIELDS = [
  'Label', 'Jenis Aset', 'Bahagian', 'Lokasi Terkini',
  'Pertama Dilihat', 'Terakhir Dilihat', 'Kali Dilihat', 'Kali Hilang', 'Muncul Semula', 'Status',
];

/** `{ fields, rows }` where each row is the values in `fields` order. */
function compact(fields, records) {
  return {
    fields,
    rows: records.map((r) => fields.map((f) => {
      const v = r[f];
      return v === null || v === undefined ? '' : v;
    })),
  };
}

function corsHeaders(request) {
  // Only needed when the page and API are on different origins. The app sends no
  // credentials, so a wildcard origin is appropriate and keeps deployment simple.
  const origin = request.headers.get('Origin');
  if (!origin) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

const withCors = (request, response) => {
  const extra = corsHeaders(request);
  const keys = Object.keys(extra);
  // Same-origin requests (the normal case: the Worker serves both the page and
  // the API) carry no Origin header, so this is a no-op there - and, importantly,
  // it does not touch the headers of a response that may be immutable (assets are
  // handed over by the asset handler, whose headers cannot be written to).
  if (!keys.length) return response;
  const copy = new Response(response.body, response);
  for (const k of keys) copy.headers.set(k, extra[k]);
  return copy;
};

/* ------------------------------------------------------------------ schema -- */

/* One CREATE TABLE pass per database binding.
 *
 * Keyed by the binding itself rather than by a single module-level flag: a Worker
 * handed a different database (the test suite does exactly this, and a second D1
 * binding would too) must still create its own tables. With one binding the
 * behaviour is identical - the map simply holds one entry. A failed attempt is
 * dropped so the next request retries instead of caching the failure forever. */
const schemaReady = new WeakMap();

/**
 * Create tables on first use. D1 is SQLite, so a single `CREATE TABLE IF NOT
 * EXISTS` pass is enough - there is no migration step to run by hand.
 */
function ensureSchema(env) {
  let ready = schemaReady.get(env.DB);
  if (!ready) {
    ready = (async () => {
    const statements = [
      `CREATE TABLE IF NOT EXISTS observations (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         observed_at TEXT NOT NULL,
         label TEXT,
         source TEXT,
         assets INTEGER NOT NULL,
         note TEXT,
         created TEXT NOT NULL,
         received_by TEXT)`,
      `CREATE TABLE IF NOT EXISTS observation_assets (
         observation_id INTEGER NOT NULL,
         label TEXT NOT NULL,
         jenis_aset TEXT,
         pegawai TEXT,
         bahagian TEXT,
         lokasi TEXT,
         PRIMARY KEY (observation_id, label))`,
      `CREATE TABLE IF NOT EXISTS dept_snapshots (
         observation_id INTEGER NOT NULL,
         bahagian TEXT NOT NULL,
         bilangan INTEGER NOT NULL,
         PRIMARY KEY (observation_id, bahagian))`,
      `CREATE TABLE IF NOT EXISTS bahagian_overrides (
         label TEXT PRIMARY KEY,
         bahagian TEXT NOT NULL,
         ditetapkan TEXT NOT NULL,
         oleh TEXT)`,
      'CREATE INDEX IF NOT EXISTS idx_oa_label ON observation_assets(label)',
      'CREATE INDEX IF NOT EXISTS idx_oa_obs ON observation_assets(observation_id)',
      'CREATE INDEX IF NOT EXISTS idx_obs_at ON observations(observed_at)',
    ];
    for (const sql of statements) await env.DB.prepare(sql).run();
    })()
      .catch((err) => {
        schemaReady.delete(env.DB);
        throw err;
      });
    schemaReady.set(env.DB, ready);
  }
  return ready;
}

/* ------------------------------------------------------------ normalising -- */

/**
 * D1/SQLite stores timestamps as text. Normalise to second precision with a Z so
 * ordering is lexicographic and stable.
 */
function normaliseInstant(value) {
  const raw = String(value || '').trim();
  if (!raw) return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/* ------------------------------------------------------------ observation -- */

/**
 * One string that stands for "this exact snapshot".
 *
 * Every field a record carries, sorted so the order in the file cannot matter: that is
 * what lets an unchanged upload be recognised and a CORRECTED one be accepted, even when
 * both have the same labels.
 */
function snapshotFingerprint(rows) {
  return JSON.stringify(rows
    .map((r) => [
      String(r.label || ''), String(r.jenis_aset || ''), String(r.pegawai || ''),
      String(r.bahagian || ''), String(r.lokasi || ''),
    ])
    .sort());
}

async function recordObservation(env, payload, receivedBy) {
  const records = payload && payload.records;
  if (!Array.isArray(records) || records.length === 0) {
    return { status: 400, body: { ok: false, error: 'Tiada rekod dalam muatan.' } };
  }

  const labels = [];
  const cleaned = [];
  for (const r of records) {
    if (typeof r !== 'object' || r === null) {
      return { status: 400, body: { ok: false, error: 'Setiap rekod mesti objek JSON.' } };
    }
    const label = String(r.Label || '').trim();
    if (!label) {
      return { status: 400, body: { ok: false, error: 'Setiap rekod mesti mempunyai Label.' } };
    }
    labels.push(label);
    cleaned.push({
      label,
      jenis_aset: String(r['Jenis Aset'] || ''),
      pegawai: String(r['Pegawai Penempatan'] || ''),
      bahagian: String(r.Bahagian || ''),
      lokasi: String(r['Lokasi Terkini'] || ''),
    });
  }

  if (new Set(labels).size !== labels.length) {
    const seen = new Set();
    const dupes = new Set();
    labels.forEach((l) => { if (seen.has(l)) dupes.add(l); seen.add(l); });
    return {
      status: 400,
      body: {
        ok: false,
        error: `Label berulang dalam muatan: ${[...dupes].slice(0, 5).join(', ')}`,
      },
    };
  }

  const observedAt = normaliseInstant(payload.observedAt);
  if (!observedAt) {
    return {
      status: 400,
      body: { ok: false, error: `observedAt tidak sah: ${payload.observedAt}` },
    };
  }

  const prev = await env.DB.prepare(
    'SELECT id, observed_at FROM observations ORDER BY observed_at DESC, id DESC LIMIT 1',
  ).first();

  /*
   * The duplicate guard compares the CONTENT, not just the labels.
   *
   * It used to compare the set of labels, which got two cases the wrong way round: a
   * corrected export (same assets, one Bahagian fixed in the source) was refused as
   * "the same list" so the correction could never land, while an asset whose details had
   * changed was treated as no change at all. What the user actually means by "I already
   * uploaded this" is "byte-for-byte the same snapshot".
   */
  if (prev) {
    const prevRows = await env.DB.prepare(
      `SELECT label, jenis_aset, pegawai, bahagian, lokasi
         FROM observation_assets WHERE observation_id = ?`,
    ).bind(prev.id).all();
    const previous = snapshotFingerprint(prevRows.results || []);
    if (previous === snapshotFingerprint(cleaned)) {
      return {
        status: 409,
        body: {
          ok: false,
          duplicate: true,
          error: 'Senarai ini sama tepat dengan pemerhatian terakhir - tiada perubahan.',
          previousAt: prev.observed_at,
        },
      };
    }
  }

  const created = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const inserted = await env.DB.prepare(
    `INSERT INTO observations (observed_at, label, source, assets, note, created, received_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    observedAt,
    String(payload.label || ''),
    String(payload.source || ''),
    labels.length,
    String(payload.note || ''),
    created,
    receivedBy,
  ).run();
  const obsId = inserted.meta.last_row_id;

  // D1 has no multi-row VALUES binding helper, so batch the inserts.
  const stmts = cleaned.map((c) => env.DB.prepare(
    `INSERT INTO observation_assets (observation_id, label, jenis_aset, pegawai, bahagian, lokasi)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(obsId, c.label, c.jenis_aset, c.pegawai, c.bahagian, c.lokasi));

  const perDept = {};
  cleaned.forEach((c) => {
    const d = c.bahagian || NO_DEPT;
    perDept[d] = (perDept[d] || 0) + 1;
  });
  for (const [dept, n] of Object.entries(perDept)) {
    stmts.push(env.DB.prepare(
      'INSERT OR REPLACE INTO dept_snapshots (observation_id, bahagian, bilangan) VALUES (?, ?, ?)',
    ).bind(obsId, dept, n));
  }
  if (stmts.length) await env.DB.batch(stmts);

  const deltas = await computeDeltas(env, obsId, labels);
  return {
    status: 201,
    body: {
      ok: true,
      observationId: obsId,
      observedAt,
      assets: labels.length,
      departments: Object.keys(perDept).length,
      ...deltas,
    },
  };
}

/**
 * Compare this observation with the previous one.
 * "Inspected" is inferred from a label DISAPPEARING, which is the only signal the
 * source report provides.
 */
async function computeDeltas(env, obsId, labels) {
  const prev = await env.DB.prepare(
    'SELECT id FROM observations WHERE id < ? ORDER BY id DESC LIMIT 1',
  ).bind(obsId).first();
  let prevLabels = new Set();
  if (prev) {
    const rows = await env.DB.prepare(
      'SELECT label FROM observation_assets WHERE observation_id = ?',
    ).bind(prev.id).all();
    prevLabels = new Set((rows.results || []).map((r) => r.label));
  }
  const present = new Set(labels);
  let inspected = 0;
  let added = 0;
  for (const l of prevLabels) if (!present.has(l)) inspected += 1;
  for (const l of present) if (!prevLabels.has(l)) added += 1;
  return { inspected, added, reappeared: 0, outstanding: present.size };
}

/* ------------------------------------------------------------- overrides --- */

async function setOverrides(env, entries, oleh) {
  if (!Array.isArray(entries)) {
    return { status: 400, body: { ok: false, error: "'overrides' mesti senarai." } };
  }

  const knownRows = await env.DB.prepare(
    "SELECT DISTINCT bahagian FROM observation_assets WHERE bahagian IS NOT NULL AND bahagian <> ''",
  ).all();
  const known = new Set((knownRows.results || []).map((r) => r.bahagian));

  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const stmts = [];
  let set = 0;
  let cleared = 0;
  const rejected = [];

  for (const e of entries) {
    if (typeof e !== 'object' || e === null) {
      return { status: 400, body: { ok: false, error: 'Setiap tetapan mesti objek JSON.' } };
    }
    const label = String(e.label || '').trim();
    const bahagian = String(e.bahagian || '').trim();
    if (!label) {
      return { status: 400, body: { ok: false, error: "Setiap tetapan mesti mempunyai 'label'." } };
    }
    if (!bahagian) {
      stmts.push(env.DB.prepare('DELETE FROM bahagian_overrides WHERE label = ?').bind(label));
      cleared += 1;
      continue;
    }
    // Refuse an invented department: a typo would create a unit no asset belongs to.
    if (known.size && !known.has(bahagian)) {
      rejected.push({ label, bahagian });
      continue;
    }
    stmts.push(env.DB.prepare(
      `INSERT INTO bahagian_overrides (label, bahagian, ditetapkan, oleh)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(label) DO UPDATE SET
         bahagian = excluded.bahagian, ditetapkan = excluded.ditetapkan, oleh = excluded.oleh`,
    ).bind(label, bahagian, now, oleh));
    set += 1;
  }
  if (stmts.length) await env.DB.batch(stmts);

  const listed = await listOverrides(env);
  const body = { ...listed, ok: true, set, cleared };
  if (rejected.length) {
    body.rejected = rejected;
    body.error = `${rejected.length} tetapan ditolak: bahagian tidak wujud dalam data. `
      + 'Ini menghalang bahagian palsu daripada dicipta.';
    return { status: 207, body };
  }
  return { status: 200, body };
}

async function listOverrides(env) {
  const rows = await env.DB.prepare(
    'SELECT label, bahagian, ditetapkan, oleh FROM bahagian_overrides ORDER BY label',
  ).all();
  const overrides = (rows.results || []).map((r) => ({
    label: r.label,
    bahagian: r.bahagian,
    ditetapkan: r.ditetapkan,
    oleh: r.oleh || '',
  }));
  return { count: overrides.length, overrides };
}

/* ------------------------------------------------------------------ reads -- */

async function status(env) {
  const counts = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM observations) AS runs,
       (SELECT MIN(observed_at) FROM observations) AS first,
       (SELECT MAX(observed_at) FROM observations) AS last,
       (SELECT COUNT(DISTINCT label) FROM observation_assets) AS total`,
  ).first();

  const total = counts.total || 0;
  if (!total) {
    return { observations: 0, assets: 0, outstanding: 0, inspected: 0, departments: [] };
  }

  // The newest observation defines what is still outstanding.
  const newest = await env.DB.prepare(
    'SELECT id FROM observations ORDER BY observed_at DESC, id DESC LIMIT 1',
  ).first();
  const outstandingRows = await env.DB.prepare(
    'SELECT label, bahagian FROM observation_assets WHERE observation_id = ?',
  ).bind(newest.id).all();
  const outstanding = (outstandingRows.results || []).length;

  const deptMap = {};
  (outstandingRows.results || []).forEach((r) => {
    const d = (r.bahagian && r.bahagian.trim()) ? r.bahagian : NO_DEPT;
    deptMap[d] = (deptMap[d] || 0) + 1;
  });
  const departments = Object.entries(deptMap)
    .map(([bahagian, bilangan]) => ({ bahagian, bilangan }))
    .sort((a, b) => b.bilangan - a.bilangan);

  return {
    observations: counts.runs,
    first: counts.first,
    last: counts.last,
    assets: total,
    outstanding,
    inspected: total - outstanding,
    progressPercent: Math.round(((total - outstanding) * 100 / total) * 10) / 10,
    reappeared: 0,
    departments,
  };
}

/**
 * The list as it stands: every asset in the newest observation, with its details.
 *
 * This is what a viewer reads, and it is the newest observation by definition - the
 * report only ever lists assets that have NOT been inspected yet. It exists as its
 * own endpoint because the alternative (filtering /api/history) ships every label
 * ever seen, which grows forever, to answer a question about today.
 */
async function currentList(env) {
  const newest = await env.DB.prepare(
    'SELECT id, observed_at FROM observations ORDER BY observed_at DESC, id DESC LIMIT 1',
  ).first();
  if (!newest) {
    return { id: null, observedAt: null, assets: 0, departments: [], records: [] };
  }
  const rows = await env.DB.prepare(
    `SELECT label, jenis_aset, pegawai, bahagian, lokasi
       FROM observation_assets WHERE observation_id = ? ORDER BY label`,
  ).bind(newest.id).all();
  const records = (rows.results || []).map((r) => ({
    Label: r.label,
    'Jenis Aset': r.jenis_aset || '',
    'Pegawai Penempatan': r.pegawai || '',
    Bahagian: r.bahagian || '',
    'Lokasi Terkini': r.lokasi || '',
  }));

  const deptMap = {};
  records.forEach((r) => {
    const d = (r.Bahagian || '').trim() || NO_DEPT;
    deptMap[d] = (deptMap[d] || 0) + 1;
  });

  return {
    id: newest.id,
    observedAt: newest.observed_at,
    assets: records.length,
    departments: Object.entries(deptMap)
      .map(([bahagian, bilangan]) => ({ bahagian, bilangan }))
      .sort((a, b) => b.bilangan - a.bilangan),
    ...compact(CURRENT_FIELDS, records),
  };
}

/**
 * Everything the page needs to become useful in ONE round trip.
 *
 * The page used to ask for /api/me and /api/health, wait, then ask for overrides,
 * status, progress, history and current in a second wave - six requests, two round
 * trips and five separate D1 conversations before a reader saw a single asset. The
 * queries inside this handler run in parallel, so the reader waits for the slowest
 * one instead of for their sum.
 */
async function bootstrap(env, identity, request) {
  const [health, st, cur, prog, hist, ovr] = await Promise.all([
    env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM observations) AS observations,
              (SELECT COUNT(DISTINCT label) FROM observation_assets) AS assets`,
    ).first(),
    status(env),
    currentList(env),
    progress(env),
    historyRows(env),
    listOverrides(env),
  ]);

  return {
    ok: true,
    me: {
      role: identity.role,
      email: identity.email,
      mode: identity.mode,
      accessConfigured: identity.accessConfigured,
      adminsConfigured: identity.adminsConfigured,
      passwordConfigured: identity.passwordConfigured,
      loginMethod: identity.loginMethod,
      writeAllowed: identity.role === 'admin',
      adminLoginPath: `${ADMIN_PATH}/login`,
    },
    health: { observations: health.observations || 0, assets: health.assets || 0, db: 'd1' },
    status: st,
    current: cur,
    progress: { progress: prog.progress },
    history: { count: hist.length, ...compact(HISTORY_FIELDS, hist) },
    overrides: ovr,
  };
}

async function observations(env) {
  const rows = await env.DB.prepare(
    'SELECT * FROM observations ORDER BY observed_at DESC, id DESC',
  ).all();
  return {
    observations: (rows.results || []).map((r) => ({
      id: r.id,
      observedAt: r.observed_at,
      assets: r.assets,
      label: r.label,
      source: r.source,
      note: r.note,
      created: r.created,
    })),
  };
}

/**
 * Delete one observation and everything derived from it.
 *
 * Uploading the wrong file by mistake is easy, and without this the false point in
 * the timeline would be permanent. The rows are removed as one batch: there are no
 * foreign keys in this schema, so the child tables are cleared explicitly.
 */
async function deleteObservation(env, id) {
  const head = await env.DB.prepare('SELECT id FROM observations WHERE id = ?').bind(id).first();
  if (!head) return { status: 404, body: { ok: false, error: 'Pemerhatian tidak dijumpai.' } };
  await env.DB.batch([
    env.DB.prepare('DELETE FROM observation_assets WHERE observation_id = ?').bind(id),
    env.DB.prepare('DELETE FROM dept_snapshots WHERE observation_id = ?').bind(id),
    env.DB.prepare('DELETE FROM observations WHERE id = ?').bind(id),
  ]);
  return { status: 200, body: { ok: true, deleted: id } };
}

/**
 * Delete EVERY point in time - the clean slate, and the only destructive action here.
 *
 * This is what "reset everything and start again" means, and it is deliberately manual
 * and admin-only rather than something an upload does: the timeline IS the report. Once
 * the snapshots are gone there is nothing left to compare, so every asset the next upload
 * contains looks new again and the count of inspected assets starts from zero.
 *
 * `bahagian_overrides` is NOT touched. Manual assignments are decisions keyed by asset
 * label, they have their own "Kosongkan" button in the assign panel, and wiping them as a
 * side effect of clearing the timeline would destroy work nobody asked to lose.
 */
async function purgeObservations(env) {
  const before = await env.DB.prepare(
    'SELECT COUNT(*) AS runs, COALESCE(SUM(assets), 0) AS assets FROM observations',
  ).first();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM observation_assets'),
    env.DB.prepare('DELETE FROM dept_snapshots'),
    env.DB.prepare('DELETE FROM observations'),
  ]);
  return {
    status: 200,
    body: {
      ok: true,
      runs: before.runs || 0,
      assets: before.assets || 0,
      overridesKept: true,
    },
  };
}

async function observationMembers(env, id) {
  const head = await env.DB.prepare('SELECT * FROM observations WHERE id = ?').bind(id).first();
  if (!head) return null;
  const rows = await env.DB.prepare(
    'SELECT label FROM observation_assets WHERE observation_id = ? ORDER BY label',
  ).bind(id).all();
  return {
    id: head.id,
    observedAt: head.observed_at,
    assets: head.assets,
    labels: (rows.results || []).map((r) => r.label),
  };
}

/**
 * Exact per-department movement between one observation and the previous one.
 *
 * The department SNAPSHOTS only hold counts, so they cannot say how many of a
 * department's assets were actually inspected - a department that lost 5 and gained
 * 5 looks identical to one that lost 10 and gained 10. The set difference is
 * computed here from the labels themselves, because the page reports these numbers
 * as facts and an approximation would quietly overstate progress.
 *
 * Blank Bahagian is bucketed as NO_DEPT, exactly like the app's summary.
 */
async function deptProgress(env, obsId, prevId) {
  if (!prevId) return [];
  const gone = await env.DB.prepare(
    `SELECT COALESCE(NULLIF(TRIM(b.bahagian), ''), ?) AS bahagian, COUNT(*) AS n
       FROM observation_assets b
      WHERE b.observation_id = ?
        AND NOT EXISTS (SELECT 1 FROM observation_assets c
                        WHERE c.observation_id = ? AND c.label = b.label)
      GROUP BY bahagian`,
  ).bind(NO_DEPT, prevId, obsId).all();
  const fresh = await env.DB.prepare(
    `SELECT COALESCE(NULLIF(TRIM(c.bahagian), ''), ?) AS bahagian, COUNT(*) AS n
       FROM observation_assets c
      WHERE c.observation_id = ?
        AND NOT EXISTS (SELECT 1 FROM observation_assets b
                        WHERE b.observation_id = ? AND b.label = c.label)
      GROUP BY bahagian`,
  ).bind(NO_DEPT, obsId, prevId).all();
  const awal = await env.DB.prepare(
    `SELECT COALESCE(NULLIF(TRIM(bahagian), ''), ?) AS bahagian, COUNT(*) AS n
       FROM observation_assets WHERE observation_id = ? GROUP BY bahagian`,
  ).bind(NO_DEPT, prevId).all();
  const akhir = await env.DB.prepare(
    `SELECT COALESCE(NULLIF(TRIM(bahagian), ''), ?) AS bahagian, COUNT(*) AS n
       FROM observation_assets WHERE observation_id = ? GROUP BY bahagian`,
  ).bind(NO_DEPT, obsId).all();

  const toMap = (rows) => {
    const m = new Map();
    (rows.results || []).forEach((r) => m.set(r.bahagian, r.n));
    return m;
  };
  const g = toMap(gone);
  const f = toMap(fresh);
  const a = toMap(awal);
  const z = toMap(akhir);

  const names = new Set([...a.keys(), ...z.keys()]);
  return [...names].map((bahagian) => {
    const start = a.get(bahagian) || 0;
    const end = z.get(bahagian) || 0;
    return {
      bahagian,
      awal: start,
      inspected: g.get(bahagian) || 0,
      added: f.get(bahagian) || 0,
      akhir: end,
      percent: start ? Math.round(((g.get(bahagian) || 0) * 100 / start) * 10) / 10 : 0,
    };
  }).sort((x, y) => y.akhir - x.akhir || x.bahagian.localeCompare(y.bahagian));
}

async function progress(env) {
  const runs = await env.DB.prepare(
    'SELECT id, observed_at, assets FROM observations ORDER BY observed_at, id',
  ).all();
  const list = runs.results || [];
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    const o = list[i];
    const prev = i > 0 ? list[i - 1] : null;
    let inspected = 0;
    let added = 0;
    if (prev) {
      const g = await env.DB.prepare(
        `SELECT COUNT(*) AS c FROM observation_assets b
         WHERE b.observation_id = ?
           AND NOT EXISTS (SELECT 1 FROM observation_assets c
                           WHERE c.observation_id = ? AND c.label = b.label)`,
      ).bind(prev.id, o.id).first();
      const a = await env.DB.prepare(
        `SELECT COUNT(*) AS c FROM observation_assets c
         WHERE c.observation_id = ?
           AND NOT EXISTS (SELECT 1 FROM observation_assets b
                           WHERE b.observation_id = ? AND b.label = c.label)`,
      ).bind(o.id, prev.id).first();
      inspected = g.c || 0;
      added = a.c || 0;
    }
    const depts = await env.DB.prepare(
      'SELECT bahagian, bilangan FROM dept_snapshots WHERE observation_id = ? ORDER BY bilangan DESC',
    ).bind(o.id).all();
    out.push({
      id: o.id,
      observedAt: o.observed_at,
      assets: o.assets,
      previous: prev ? prev.assets : null,
      inspected,
      added,
      percent: prev && prev.assets
        ? Math.round((inspected * 100 / prev.assets) * 10) / 10
        : null,
      departments: depts.results || [],
      deptProgress: await deptProgress(env, o.id, prev ? prev.id : null),
    });
  }
  return { progress: out };
}

/**
 * One asset's history: which observations listed it, and which did not.
 *
 * The per-label view is recomputed on read rather than kept in a derived table.
 * At 536 labels that is cheap, and it cannot drift from the observations it came
 * from.
 */
async function timeline(env, label) {
  const presentRows = await env.DB.prepare(
    `SELECT o.observed_at FROM observations o
     JOIN observation_assets oa ON oa.observation_id = o.id
     WHERE oa.label = ? ORDER BY o.observed_at`,
  ).bind(label).all();
  const present = (presentRows.results || []).map((r) => r.observed_at);

  const allRows = await env.DB.prepare(
    'SELECT observed_at FROM observations ORDER BY observed_at',
  ).all();
  const all = (allRows.results || []).map((r) => r.observed_at);

  if (!present.length) return null;

  const detail = await env.DB.prepare(
    'SELECT * FROM observation_assets WHERE label = ? ORDER BY observation_id DESC LIMIT 1',
  ).bind(label).first();
  const absent = all.filter((d) => !present.includes(d));
  const outstanding = present.length > 0 && all.length > 0
    && present[present.length - 1] === all[all.length - 1];

  return {
    label,
    jenisAset: detail ? detail.jenis_aset : '',
    bahagian: detail ? (detail.bahagian || '') : '',
    lokasi: detail ? detail.lokasi : '',
    status: outstanding ? STATUS_OUTSTANDING : STATUS_INSPECTED,
    firstSeen: present[0],
    lastSeen: present[present.length - 1],
    timesSeen: present.length,
    timesAbsent: absent.length,
    reappearances: 0,
    present,
    absent,
  };
}

async function historyRows(env) {
  const runs = await env.DB.prepare(
    'SELECT id, observed_at FROM observations ORDER BY observed_at, id',
  ).all();
  const all = runs.results || [];
  if (!all.length) return [];

  const membership = await env.DB.prepare(
    'SELECT observation_id, label, jenis_aset, bahagian, lokasi FROM observation_assets',
  ).all();

  const byLabel = new Map();
  const orderOf = new Map(all.map((r, i) => [r.id, i]));
  (membership.results || []).forEach((m) => {
    if (!byLabel.has(m.label)) {
      byLabel.set(m.label, { label: m.label, jenis: m.jenis_aset, dept: m.bahagian, lok: m.lokasi, seen: [] });
    }
    const e = byLabel.get(m.label);
    e.seen.push(orderOf.get(m.observation_id));
  });

  const lastIdx = all.length - 1;
  const rows = [];
  for (const e of byLabel.values()) {
    e.seen.sort((a, b) => a - b);
    const first = e.seen[0];
    const last = e.seen[e.seen.length - 1];
    const outstanding = e.seen.includes(lastIdx);
    rows.push({
      Label: e.label,
      'Jenis Aset': e.jenis || '',
      Bahagian: e.dept || '',
      'Lokasi Terkini': e.lok || '',
      'Pertama Dilihat': String(all[first].observed_at).slice(0, 10),
      'Terakhir Dilihat': String(all[last].observed_at).slice(0, 10),
      'Kali Dilihat': e.seen.length,
      'Kali Hilang': (lastIdx + 1) - e.seen.length,
      'Muncul Semula': 0,
      Status: outstanding ? STATUS_OUTSTANDING : STATUS_INSPECTED,
    });
  }
  rows.sort((a, b) => {
    if (a.Status !== b.Status) return a.Status === STATUS_OUTSTANDING ? -1 : 1;
    return a.Label.localeCompare(b.Label);
  });
  return rows;
}

/** CSV with a UTF-8 BOM and CRLF, so Excel opens it correctly. */
function toCsv(rows) {
  if (!rows.length) return '\uFEFF';
  const cols = Object.keys(rows[0]);
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [cols.join(',')];
  rows.forEach((r) => lines.push(cols.map((c) => esc(r[c])).join(',')));
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

/* ----------------------------------------------------------------- access --
 *
 * WHO MAY WRITE, AND WHY THE ANSWER IS DECIDED HERE
 * -------------------------------------------------
 * Reading is PUBLIC. The list of assets still to be inspected is information the
 * whole institution may have, so the viewer screen needs no login at all.
 *
 * Writing is not. Uploading a list, deleting a point in the timeline and setting a
 * department are decisions with consequences for everybody, so they require a
 * sign-in as an admin. Hiding the buttons in the page would not make that true - the
 * API is reachable by URL, so anyone could still POST with curl.
 *
 * Identity comes from Cloudflare Access on the ADMIN PATH ONLY, so the public site
 * stays public: Access is applied to /api/admin/*, the page writes there, and the
 * Worker verifies the JWT it hands over (signature, audience, issuer, expiry) before
 * trusting any email. Two independent gates, and neither is a hidden button.
 *
 * ACCESS_MODE says which of those applies:
 *
 *   "enforce"  Access is in front of /api/admin/*. Reads are public; writes need a
 *              sign-in, and only emails in ADMIN_EMAILS are admins. This is the
 *              mode for a published site.
 *
 *   "password" Access is NOT used: the page offers an admin login dialog, the Worker
 *              compares the password against the ADMIN_PASSWORD secret (constant
 *              time) and sets an HMAC-signed cookie. One shared credential, no
 *              Cloudflare plan needed - the pragmatic choice for a single admin.
 *              There is no per-person identity, so the audit trail says "admin".
 *
 *   "open"     DEFAULT, and the safe one while no login exists yet: there is no way
 *              to tell people apart, so NOTHING may be written. The page becomes
 *              read-only for everyone and says why. Failing closed matters here - a
 *              public URL with open writes means anyone who has the link can wipe the
 *              records.
 *
 *   "trusted"  No login, and everybody is an admin. Only for a private copy that is
 *              not reachable from the internet. The page shows a loud warning.
 */

const ACCESS_MODES = ['enforce', 'password', 'open', 'trusted'];
const ADMIN_PATH = '/api/admin';
const ACCESS_HEADER = 'Cf-Access-Jwt-Assertion';

/** The password-mode session: a signed expiry stamp, so no server-side store is needed. */
const SESSION_COOKIE = 'aset_admin';
const SESSION_TTL_SECONDS = 12 * 60 * 60;

function accessConfig(env) {
  const raw = String(env.ACCESS_MODE || 'open').trim().toLowerCase();
  return {
    mode: ACCESS_MODES.indexOf(raw) >= 0 ? raw : 'open',
    admins: String(env.ADMIN_EMAILS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    teamDomain: String(env.ACCESS_TEAM_DOMAIN || '')
      .trim()
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, ''),
    aud: String(env.ACCESS_AUD || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    password: String(env.ADMIN_PASSWORD || ''),
  };
}

function b64urlToBytes(input) {
  const s = String(input).replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const bin = atob(s + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeSegment(segment) {
  try {
    return JSON.parse(new TextDecoder().decode(b64urlToBytes(segment)));
  } catch (e) {
    return null;
  }
}

/** Signed token from the Access header, or the cookie it also sets. */
function accessToken(request) {
  const header = request.headers.get(ACCESS_HEADER);
  if (header) return header.trim();
  const cookie = request.headers.get('Cookie');
  if (!cookie) return '';
  const hit = cookie.split(';').map((c) => c.trim())
    .find((c) => c.startsWith('CF_Authorization='));
  return hit ? hit.slice('CF_Authorization='.length).trim() : '';
}

/* ------------------------------------------------- password-mode sessions -- */

/** One value of a Cookie header, or '' when it is not there. */
function cookieValue(request, name) {
  const cookie = request.headers.get('Cookie');
  if (!cookie) return '';
  const hit = cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : '';
}

/** `Max-Age: 0` is how a cookie is deleted; the other attributes must match. */
function sessionCookie(value, maxAge) {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

/** Constant-time byte comparison: a wrong password cannot be found one byte at a time. */
function constEq(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Compare a submitted password with the configured one.
 *
 * Both sides are hashed first, so what is compared has a fixed length: the check takes
 * the same time whichever bytes disagree, and it does not leak the real length.
 */
async function passwordMatches(given, expected) {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(`kata-laluan:${String(given)}`)),
    crypto.subtle.digest('SHA-256', enc.encode(`kata-laluan:${String(expected)}`)),
  ]);
  return constEq(new Uint8Array(a), new Uint8Array(b));
}

/**
 * The HMAC key for the session cookie, derived FROM the password.
 *
 * That is one secret to keep instead of two, and changing the password invalidates
 * every session that was handed out before it.
 */
const sessionKey = (cfg) => crypto.subtle.importKey(
  'raw',
  new TextEncoder().encode(`aset-pks-session-v1:${cfg.password}`),
  { name: 'HMAC', hash: 'SHA-256' },
  false,
  ['sign'],
);

function b64url(bytes) {
  let bin = '';
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** `<expiry>.<signature>` - the expiry is readable, the signature is not forgeable. */
async function makeSession(cfg) {
  const payload = b64url(new TextEncoder().encode(JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  })));
  const sig = await crypto.subtle.sign('HMAC', await sessionKey(cfg),
    new TextEncoder().encode(payload));
  return `${payload}.${b64url(sig)}`;
}

/** True only for a cookie this Worker signed, that has not expired. */
async function sessionValid(cfg, request) {
  if (!cfg.password) return false;
  const raw = cookieValue(request, SESSION_COOKIE);
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return false;
  const payload = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  let expected;
  try {
    expected = b64url(await crypto.subtle.sign('HMAC', await sessionKey(cfg),
      new TextEncoder().encode(payload)));
  } catch (e) {
    return false;
  }
  // The signature is checked before the payload is trusted, so a forged cookie never
  // gets as far as being parsed.
  const enc = new TextEncoder();
  if (!constEq(enc.encode(sig), enc.encode(expected))) return false;
  const claims = decodeSegment(payload);
  if (!claims) return false;
  return Number(claims.exp || 0) > Math.floor(Date.now() / 1000);
}

/* Access keys rarely change, and fetching them per request would add a round trip
   to every call, so they are cached per team domain. */
const jwksCache = new Map();
const JWKS_TTL_MS = 60 * 60 * 1000;

async function accessKeys(cfg) {
  const url = `https://${cfg.teamDomain}/cdn-cgi/access/certs`;
  const hit = jwksCache.get(url);
  if (hit && Date.now() - hit.at < JWKS_TTL_MS) return hit.keys;
  try {
    const res = await fetch(url, { cf: { cacheTtl: 3600 } });
    if (!res.ok) return null;
    const body = await res.json();
    const keys = Array.isArray(body.keys) ? body.keys : [];
    jwksCache.set(url, { at: Date.now(), keys });
    return keys;
  } catch (e) {
    return null;
  }
}

/**
 * Verify an Access JWT and return its claims, or null.
 *
 * Checks the signature (RS256 against Access's published key for the token's kid),
 * the audience, the issuer and the expiry. Skipping any one of those is how
 * "verification" becomes decoration.
 */
async function verifyAccessJwt(token, cfg) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const header = decodeSegment(parts[0]);
  const claims = decodeSegment(parts[1]);
  if (!header || !claims) return null;
  if (String(header.alg || '').toUpperCase() !== 'RS256') return null;

  const keys = await accessKeys(cfg);
  if (!keys || !keys.length) return null;
  const jwk = keys.find((k) => k.kid && header.kid && k.kid === header.kid) || keys[0];
  if (!jwk) return null;

  let key;
  try {
    key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
  } catch (e) {
    return null;
  }

  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  let okSig = false;
  try {
    okSig = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), signed,
    );
  } catch (e) {
    return null;
  }
  if (!okSig) return null;

  const now = Math.floor(Date.now() / 1000);
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (cfg.aud.length && !auds.some((a) => cfg.aud.includes(a))) return null;
  if (claims.exp && now >= Number(claims.exp)) return null;
  if (claims.nbf && now < Number(claims.nbf) - 60) return null;
  if (cfg.teamDomain && claims.iss && claims.iss !== `https://${cfg.teamDomain}`) return null;
  return claims;
}

/**
 * Who is asking. `role: 'admin'` is the only thing that may write.
 *
 * "trusted" is the one mode where a request with no token is still an admin - it
 * exists for a private copy that the internet cannot reach, and the page warns about
 * it. "open" is the opposite: nobody can be identified, so nobody may write.
 */
async function resolveIdentity(request, env) {
  const cfg = accessConfig(env);
  const base = {
    mode: cfg.mode,
    email: '',
    adminsConfigured: cfg.admins.length > 0,
    accessConfigured: cfg.mode === 'enforce',
    passwordConfigured: cfg.password.length > 0,
    /* What the page should offer: a password field, an Access button, or an
       explanation. Deciding it here means the page never has to guess. */
    loginMethod: cfg.mode === 'enforce' ? 'access'
      : (cfg.mode === 'password' && cfg.password ? 'password' : 'none'),
  };

  if (cfg.mode === 'trusted') {
    return { ...base, role: 'admin', email: '', reason: 'trusted' };
  }
  if (cfg.mode === 'open') {
    return { ...base, role: 'viewer', email: '', reason: 'no-login-configured' };
  }

  /* Password mode: the credential IS the password, so a valid signed cookie is the
     only thing that grants admin. There is no per-person identity - the timeline
     records the action, not who performed it. */
  if (cfg.mode === 'password') {
    if (!cfg.password) {
      return { ...base, role: 'viewer', reason: 'no-password-configured' };
    }
    const ok = await sessionValid(cfg, request);
    return {
      ...base,
      role: ok ? 'admin' : 'viewer',
      email: ok ? (cfg.admins[0] || '') : '',
      reason: ok ? 'password-session' : 'no-session',
    };
  }

  const token = accessToken(request);
  if (!token) return { ...base, role: 'viewer', reason: 'no-token' };

  const claims = await verifyAccessJwt(token, cfg);
  if (!claims) return { ...base, role: 'viewer', reason: 'bad-token' };

  const email = String(claims.email || '').toLowerCase();
  const isAdmin = !!email && cfg.admins.includes(email);
  return { ...base, role: isAdmin ? 'admin' : 'viewer', email, reason: isAdmin ? 'admin' : 'not-admin' };
}

/** null when the caller may write, otherwise the response explaining why not. */
function denyWrite(identity) {
  if (identity.role === 'admin') return null;

  if (identity.mode === 'password') {
    if (!identity.passwordConfigured) {
      return fail(403, 'Mod kata laluan dipilih, tetapi rahsia ADMIN_PASSWORD belum'
        + ' ditetapkan, jadi tiada siapa boleh mengubah rekod. Tetapkan rahsia itu'
        + ' (lihat README), kemudian cuba lagi.');
    }
    return fail(401, 'Log masuk admin diperlukan untuk mengubah rekod.');
  }
  if (identity.mode === 'open') {
    return fail(403, 'Log masuk admin belum disediakan untuk Worker ini, jadi tiada siapa'
      + ' boleh mengubah rekod. Ini pilihan yang selamat untuk halaman awam: tetapkan'
      + ' ACCESS_MODE kepada "enforce" dan lengkapkan ACCESS_TEAM_DOMAIN serta'
      + ' ACCESS_AUD (lihat README).');
  }
  if (identity.adminsConfigured === false) {
    return fail(403, 'Worker ini belum menetapkan ADMIN_EMAILS, jadi tiada siapa boleh '
      + 'mengubah rekod. Tetapkan senarai e-mel admin (lihat README), kemudian deploy semula.');
  }
  if (identity.reason === 'no-token' || identity.reason === 'bad-token') {
    return fail(401, 'Log masuk diperlukan untuk mengubah rekod.');
  }
  return fail(403, 'Akaun ini hanya boleh membaca. Hanya admin boleh memuat naik atau '
    + 'menukar tetapan.');
}

/* ------------------------------------------------------------------ router -- */

async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  /* The page writes to /api/admin/* so Access can protect exactly that prefix, while
     reads stay public. Both prefixes are normalised to one routing name, so
     /api/observations and /api/admin/observations reach the same handler: one
     implementation, two doors, and both guarded by denyWrite(). */
  const isAdminPath = path === ADMIN_PATH || path.startsWith(`${ADMIN_PATH}/`);
  const route = isAdminPath
    ? (path.slice(ADMIN_PATH.length) || '/')
    : (path.slice('/api'.length) || '/');

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  /* Everything that is not /api/* is a static file. In production the asset
     handler usually answers these before this Worker runs at all; this branch is
     what serves `/` when the Worker is invoked directly, and what makes a
     deployment without an assets binding fail honestly (404) rather than leak
     anything. Skipped before ensureSchema so a page view costs no database work. */
  if (!path.startsWith('/api/')) {
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return fail(404, 'Laluan tidak dijumpai.');
  }

  /* Where the "admin log masuk" button lands. In "enforce" mode Access has already
     authenticated the caller by the time this runs, so the only job is to send the
     browser back to the page instead of showing it JSON. */
  if (isAdminPath && (route === '/login' || route === '/login/') && method !== 'POST') {
    return new Response(null, {
      status: 302,
      headers: { Location: '/?admin=1', 'Cache-Control': 'no-store' },
    });
  }

  /* Password login: the page posts what the admin typed, and a correct answer earns an
     HttpOnly cookie. Nothing about the password comes back in the response, and the
     reply is never cached. */
  if (isAdminPath && (route === '/login' || route === '/login/') && method === 'POST') {
    const cfg = accessConfig(env);
    if (cfg.mode !== 'password') {
      return fail(400, cfg.mode === 'enforce'
        ? 'Worker ini menggunakan Cloudflare Access, bukan kata laluan.'
        : `Mod "${cfg.mode}" tidak menggunakan log masuk kata laluan.`);
    }
    if (!cfg.password) {
      return fail(403, 'Rahsia ADMIN_PASSWORD belum ditetapkan, jadi log masuk tidak'
        + ' tersedia. Lihat README, bahagian "Log masuk admin".');
    }
    let payload = null;
    try {
      payload = await request.json();
    } catch (e) {
      payload = null;
    }
    const given = payload && typeof payload.password === 'string' ? payload.password : '';
    if (!given) return json({ ok: false, error: 'Kata laluan diperlukan.' }, 400,
      { 'Cache-Control': 'no-store' });
    if (!(await passwordMatches(given, cfg.password))) {
      return json({ ok: false, error: 'Kata laluan salah.' }, 401,
        { 'Cache-Control': 'no-store' });
    }
    return json({ ok: true, role: 'admin', mode: cfg.mode }, 200, {
      'Cache-Control': 'no-store',
      'Set-Cookie': sessionCookie(await makeSession(cfg), SESSION_TTL_SECONDS),
    });
  }

  /* The way back out.

     In password mode this Worker clears its own cookie - the whole session lives in
     that cookie, so there is nothing else to end. In "enforce" mode only the Access
     team domain can clear the Access cookie, so sign-out is a redirect there. Either
     way the cookie is cleared when one might exist, so switching modes cannot leave a
     session behind. */
  if (isAdminPath && (route === '/logout' || route === '/logout/')) {
    const cfg = accessConfig(env);
    const to = cfg.teamDomain ? `https://${cfg.teamDomain}/cdn-cgi/access/logout` : '/?logout=1';
    const headers = { Location: to, 'Cache-Control': 'no-store' };
    if (cfg.mode === 'password' || method === 'POST') {
      headers['Set-Cookie'] = sessionCookie('', 0);
    }
    return new Response(null, { status: 302, headers });
  }

  await ensureSchema(env);

  const identity = await resolveIdentity(request, env);

  if (method === 'GET' || method === 'HEAD') {
    /* Every read below is cacheable (see cachedJson). They all carry an ETag, so a
       repeat request is answered with 304 and no body, and a shared cache is allowed
       to hold them for a few seconds. Writes never come through here. */
    if (route === '/bootstrap') {
      return cachedJson(request, await bootstrap(env, identity, request));
    }
    if (route === '/me') {
      // Never returns the admin list: a viewer has no business knowing who the
      // admins are, and the page does not need it.
      return cachedJson(request, {
        ok: true,
        role: identity.role,
        email: identity.email,
        mode: identity.mode,
        accessConfigured: identity.accessConfigured,
        adminsConfigured: identity.adminsConfigured,
        passwordConfigured: identity.passwordConfigured,
        loginMethod: identity.loginMethod,
        writeAllowed: identity.role === 'admin',
        adminLoginPath: `${ADMIN_PATH}/login`,
      });
    }
    if (route === '/health') {
      const c = await env.DB.prepare(
        `SELECT (SELECT COUNT(*) FROM observations) AS observations,
                (SELECT COUNT(DISTINCT label) FROM observation_assets) AS assets`,
      ).first();
      return cachedJson(request, {
        ok: true, observations: c.observations || 0, assets: c.assets || 0, db: 'd1',
      });
    }
    if (route === '/status') return cachedJson(request, { ok: true, ...(await status(env)) });
    if (route === '/current') return cachedJson(request, { ok: true, ...(await currentList(env)) });
    if (route === '/overrides') {
      return cachedJson(request, { ok: true, ...(await listOverrides(env)) });
    }
    if (route === '/observations') {
      return cachedJson(request, { ok: true, ...(await observations(env)) });
    }
    if (route === '/progress') return cachedJson(request, { ok: true, ...(await progress(env)) });
    if (route === '/history') {
      const rows = await historyRows(env);
      return cachedJson(request, {
        ok: true, count: rows.length, ...compact(HISTORY_FIELDS, rows),
      });
    }
    if (route === '/export.csv') {
      const rows = await historyRows(env);
      return new Response(toCsv(rows), {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="Sejarah_Aset_PKS.csv"',
          ...corsHeaders(request),
        },
      });
    }
    if (route.startsWith('/observations/')) {
      const raw = route.slice('/observations/'.length);
      if (!/^\d+$/.test(raw)) return fail(400, 'ID pemerhatian tidak sah.');
      const data = await observationMembers(env, Number(raw));
      if (!data) return fail(404, 'Pemerhatian tidak dijumpai.');
      return cachedJson(request, { ok: true, ...data });
    }
    if (route.startsWith('/timeline/')) {
      const label = decodeURIComponent(route.slice('/timeline/'.length));
      const data = await timeline(env, label);
      if (!data) return fail(404, `Label tidak dijumpai: ${label}`);
      return cachedJson(request, { ok: true, ...data });
    }
    return fail(404, 'Laluan tidak dijumpai.');
  }

  if (method === 'DELETE') {
    // Two shapes only, so a typo cannot silently look like a successful delete:
    //   /observations/<id>  one point in time
    //   /observations       every point in time (the clean slate)
    if (route === '/observations') {
      const denied = denyWrite(identity);
      if (denied) return denied;
      const res = await purgeObservations(env);
      return json(res.body, res.status);
    }
    if (route.startsWith('/observations/')) {
      const denied = denyWrite(identity);
      if (denied) return denied;
      const raw = route.slice('/observations/'.length);
      if (!/^\d+$/.test(raw)) return fail(400, 'ID pemerhatian tidak sah.');
      const res = await deleteObservation(env, Number(raw));
      return json(res.body, res.status);
    }
    return fail(405, 'Kaedah tidak dibenarkan.');
  }

  if (method === 'POST') {
    if (route !== '/observations' && route !== '/overrides') {
      return fail(404, 'Laluan tidak dijumpai.');
    }
    // Uploading a list and changing department assignments are the two things that
    // define the records, so both are admin-only.
    const denied = denyWrite(identity);
    if (denied) return denied;
    const len = Number(request.headers.get('Content-Length') || 0);
    if (len > MAX_UPLOAD_BYTES) {
      return fail(413, `Muatan terlalu besar (had ${MAX_UPLOAD_BYTES / 1048576} MB).`);
    }
    let payload;
    try {
      payload = await request.json();
    } catch (e) {
      return fail(400, `JSON tidak sah: ${e && e.message}`);
    }
    const who = request.headers.get('CF-Connecting-IP') || '';

    if (route === '/overrides') {
      const entries = payload && payload.overrides !== undefined ? payload.overrides : payload;
      const res = await setOverrides(env, entries, who);
      return json(res.body, res.status);
    }
    const res = await recordObservation(env, payload, who);
    return json(res.body, res.status);
  }

  return fail(405, 'Kaedah tidak dibenarkan.');
}

/*
 * Test seam, in the same spirit as `__internals` in src/state/reducer.js.
 *
 * The session helpers are the one part of the login story that cannot be reached
 * through the HTTP surface: a cookie with a genuine signature whose expiry has already
 * passed needs the signing key, so the suite has to be given them. Handing them over
 * lets cloudflare/verify-worker.mjs prove expiry and key-binding instead of trusting
 * this file by reading it.
 */
export const __sessionInternals = { sessionKey, b64url, makeSession, sessionValid, passwordMatches };

export default {
  async fetch(request, env) {
    try {
      const res = await handle(request, env);
      return withCors(request, res);
    } catch (err) {
      // Keep the Worker alive on any single failure instead of returning an
      // opaque 500 from the runtime.
      return withCors(request, fail(500, `Ralat pelayan: ${err && err.message}`));
    }
  },
};
