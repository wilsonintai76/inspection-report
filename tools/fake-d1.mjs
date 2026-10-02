/*
 * fake-d1.mjs - serve canned D1 answers to the page inside a headless browser.
 *
 *   import { fakeApiScript, buildPage } from './fake-d1.mjs';
 *
 * WHY A STUB AND NOT THE REAL WORKER
 * ----------------------------------
 * The browser suites check what the PAGE does with what the API says - which
 * numbers it renders, what it sends back. The API's own correctness is proved
 * against real SQLite by cloudflare/verify-worker.mjs. Pointing the page at the
 * real Worker here would mean starting workerd (which does not run in this
 * workspace) and would duplicate the Worker's logic in the test.
 *
 * The stub is injected BEFORE the app's script, because the page probes /api/health
 * while it boots: a stub installed afterwards would be too late and the page would
 * have already settled into offline mode.
 *
 * Every call is recorded on window.__apiLog, and POSTed observations on
 * window.__apiStore.posts, so a harness can assert what the page sent.
 */
import { readFileSync } from 'node:fs';

/** Source of a script tag that replaces window.fetch with the canned API. */
export function fakeApiScript(payload) {
  const data = JSON.stringify(payload);
  return `<script>
(function () {
  var payload = ${data};
  var store = { overrides: (payload.overrides || []).slice(), posts: [], deletes: [], purges: [] };
  window.__apiLog = [];
  window.__apiStore = store;
  var me = payload.me || { role: 'admin', email: 'admin@contoh.my', mode: 'enforce',
    accessConfigured: true, adminsConfigured: true, adminLoginPath: '/api/admin/login' };
  if (me.loginMethod === undefined) me.loginMethod = me.mode === 'enforce' ? 'access' : 'none';
  if (me.passwordConfigured === undefined) me.passwordConfigured = !!payload.adminPassword;

  /* The figures an admin writes by hand. The stub STORES them, so a suite can prove the
     page shows what was saved (after a real re-read of the API) rather than echoing back
     what was typed - and that both the date and the arithmetic follow from them. */
  var figures = Object.assign(
    { totalAssets: null, inspected: null, outstanding: null, updatedAt: null, updatedBy: '' },
    payload.status.manual || {},
  );

  function statusBody() {
    return Object.assign({ ok: true }, payload.status, { manual: figures });
  }

  /* The real Worker proves the role from a signed cookie. A file:// page cannot keep
     cookies, and the suite is testing the PAGE, so a flag stands in for the session -
     and canWrite() is read fresh on every call, so logging in changes it. */
  function canWrite() { return me.role !== 'viewer' && me.mode !== 'open'; }

  /* The Worker sends lists as { fields, rows } so the long field names are stated
     once instead of repeated in every record. The suites below still describe their
     data as objects - that is easier to read and to assert on - so the stub does the
     compacting here, exactly as the Worker does, and the page expands it back. */
  function compact(fields, records) {
    return { fields: fields, rows: (records || []).map(function (r) {
      return fields.map(function (f) { return r[f] === undefined || r[f] === null ? '' : r[f]; });
    }) };
  }
  var CURRENT_FIELDS = ['Label', 'Jenis Aset', 'Pegawai Penempatan', 'Bahagian', 'Lokasi Terkini'];
  var HISTORY_FIELDS = ['Label', 'Jenis Aset', 'Bahagian', 'Lokasi Terkini', 'Pertama Dilihat',
    'Terakhir Dilihat', 'Kali Dilihat', 'Kali Hilang', 'Muncul Semula', 'Status'];
  function currentBody() {
    var cur = payload.current || {};
    var records = (cur.records || []);
    var out = { ok: true, id: cur.id === undefined ? 1 : cur.id,
      observedAt: cur.observedAt || null, assets: records.length,
      departments: cur.departments || [] };
    return Object.assign(out, compact(CURRENT_FIELDS, records));
  }
  function reply(status, obj) {
    var text = JSON.stringify(obj);
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status: status,
      text: function () { return Promise.resolve(text); },
      json: function () { return Promise.resolve(obj); }
    });
  }

  window.fetch = function (url, init) {
    /* Route on the PATH, exactly as the Worker does (it reads url.pathname).
       The app appends a cache-busting nonce after a write, and matching the whole URL
       would turn those into 404s that only appear in the rejection paths - a stub
       that is stricter than the server is a stub that lies. */
    var raw = String(url).replace(/^[a-z]+:\\/\\/[^/]+/i, '').split('?')[0];
    /* The page writes through /api/admin/* so Access can protect exactly that prefix.
       The stub resolves both prefixes the way the Worker does, but records the path
       the page actually asked for - that is the thing a suite wants to assert. */
    var path = raw;
    if (raw.indexOf('/api/admin/') === 0) path = '/api' + raw.slice('/api/admin'.length);
    var method = ((init && init.method) || 'GET').toUpperCase();
    var body = null;
    try { body = init && init.body ? JSON.parse(init.body) : null; } catch (e) { body = null; }
    window.__apiLog.push({ method: method, path: raw, route: path, body: body });

    if (path === '/api/health') {
      return reply(200, { ok: true, observations: payload.status.observations,
        assets: payload.status.assets, db: 'd1' });
    }
    if (path === '/api/me') {
      return reply(200, Object.assign({ ok: true, writeAllowed: canWrite() }, me));
    }
    if (path === '/api/current') return reply(200, currentBody());
    /* One call that answers everything the page needs - the shape the Worker now
       serves, so what the suites boot through is what a reader boots through. */
    if (path === '/api/bootstrap') {
      return reply(200, {
        ok: true,
        me: Object.assign({ writeAllowed: canWrite() }, me),
        health: { observations: payload.status.observations, assets: payload.status.assets, db: 'd1' },
        status: statusBody(),
        current: currentBody(),
        progress: { ok: true, progress: payload.progress },
        history: Object.assign({ ok: true, count: payload.history.length },
          compact(HISTORY_FIELDS, payload.history)),
        overrides: { ok: true, count: store.overrides.length, overrides: store.overrides }
      });
    }
    /* The login dialog. Same routes and same refusals as the Worker: a wrong password is
       401 and leaves the page exactly as it was, and only a correct one changes the role. */
    if (path === '/api/login' && method === 'POST') {
      if (me.mode !== 'password' || !payload.adminPassword) {
        return reply(403, { ok: false, error: 'log masuk kata laluan tidak disediakan' });
      }
      if (!(body && body.password === payload.adminPassword)) {
        return reply(401, { ok: false, error: 'Kata laluan salah.' });
      }
      me.role = 'admin';
      return reply(200, { ok: true, role: 'admin', mode: me.mode });
    }
    if (path === '/api/logout' && method === 'POST') {
      me.role = 'viewer';
      return reply(200, { ok: true, role: 'viewer' });
    }
    /* A viewer must not be able to write, and neither can anyone while the Worker has
       no login configured ("open" refuses writes so a public URL cannot be edited).
       The stub refuses the same way the Worker does, so a page that forgot to hide a
       write cannot pass by accident. */
    if (!canWrite() && (method === 'POST' || method === 'DELETE')) {
      var why = me.mode === 'open' ? 403 : (me.mode === 'password' ? 401 : (me.role === 'viewer' ? 403 : 401));
      return reply(why, { ok: false,
        error: why === 403 ? 'Akaun ini hanya boleh membaca.'
          : 'Log masuk diperlukan untuk mengubah rekod.' });
    }
    if (path === '/api/status') return reply(200, statusBody());
    if (path === '/api/progress') return reply(200, { ok: true, progress: payload.progress });
    if (path === '/api/history') {
      return reply(200, Object.assign({ ok: true, count: payload.history.length },
        compact(HISTORY_FIELDS, payload.history)));
    }
    if (path === '/api/overrides' && method === 'GET') {
      return reply(200, { ok: true, count: store.overrides.length, overrides: store.overrides });
    }
    if (path === '/api/overrides' && method === 'POST') {
      var entries = (body && body.overrides) || [];
      var rejected = [];
      entries.forEach(function (e) {
        if (!e.bahagian) {
          store.overrides = store.overrides.filter(function (o) { return o.label !== e.label; });
          return;
        }
        if (payload.knownDepartments && payload.knownDepartments.indexOf(e.bahagian) === -1) {
          rejected.push(e);
          return;
        }
        var found = false;
        store.overrides.forEach(function (o) { if (o.label === e.label) { o.bahagian = e.bahagian; found = true; } });
        if (!found) store.overrides.push({ label: e.label, bahagian: e.bahagian, ditetapkan: 'x', oleh: '' });
      });
      var out = { ok: true, count: store.overrides.length, overrides: store.overrides,
        set: entries.length - rejected.length, cleared: 0 };
      if (rejected.length) {
        out.rejected = rejected;
        out.error = rejected.length + ' tetapan ditolak';
        return reply(207, out);
      }
      return reply(200, out);
    }
    /* The report's own three figures (copied from the register). Blank clears, and null on
       ALL THREE means "trust the data again" - the same contract the Worker has, arithmetic
       check included. (No backticks in here: this whole stub is inside one template
       literal.) */
    if (path === '/api/figures' && method === 'POST') {
      var one = function (x) {
        if (x === null || x === undefined || x === '') return null;
        var n = Number(x);
        return Number.isFinite(n) && n >= 0 ? Math.round(n) : NaN;
      };
      var t = one(body && body.totalAssets);
      var i = one(body && body.inspected);
      var o = one(body && body.outstanding);
      if (Number.isNaN(t) || Number.isNaN(i) || Number.isNaN(o)) {
        return reply(400, { ok: false, error: 'Angka mesti nombor bulat 0 atau lebih.' });
      }
      if (t === null && i === null && o === null) {
        figures = { totalAssets: null, inspected: null, outstanding: null,
          updatedAt: null, updatedBy: '' };
        return reply(200, { ok: true, cleared: true, figures: figures });
      }
      /* A fixed stamp, so a suite can assert the card without depending on the clock. */
      figures = { totalAssets: t, inspected: i, outstanding: o,
        updatedAt: '2026-03-01T09:30:00Z', updatedBy: me.email || 'admin' };
      return reply(200, { ok: true, figures: figures });
    }
    if (path === '/api/observations' && method === 'POST') {
      store.posts.push(body);
      var n = (body && body.records ? body.records.length : 0);
      return reply(201, { ok: true, observationId: 100 + store.posts.length, assets: n,
        added: n, inspected: 0, reused: false });
    }
    if (path === '/api/observations' && method === 'DELETE') {
      /* Recorded, not applied: the canned payload IS the fixture the rest of the suite
         asserts on, so emptying it half-way through would break every later check. The
         page's job - ask first, then send the call to the protected prefix - is what is
         being verified here; that the rows really go is proved in cloudflare/verify-worker.mjs. */
      store.purges.push(true);
      return reply(200, { ok: true, runs: payload.status.observations, assets: payload.status.assets,
        overridesKept: true });
    }
    if (path.indexOf('/api/observations/') === 0 && method === 'DELETE') {
      store.deletes.push(path.slice('/api/observations/'.length));
      return reply(200, { ok: true, deleted: Number(path.slice('/api/observations/'.length)) });
    }
    return reply(404, { ok: false, error: 'laluan tidak dijumpai: ' + path });
  };
})();
</script>`;
}

/**
 * The app page with the stub injected before the app boots and the harness left at
 * the end of the body (where the existing harnesses expect to be).
 *
 * `data-api="/"` is added to <html> on purpose: a page opened from file:// has no
 * origin, so the app decides it is offline and never calls fetch at all. Pointing it
 * at a named API is the documented way to run the page against a Worker, so the
 * suites exercise that path rather than a special test hook.
 */
export function buildPage(appHtml, payload, harnessSource) {
  const bodyAt = appHtml.indexOf('<body>');
  if (bodyAt < 0) throw new Error('Penanda <body> tidak dijumpai dalam aplikasi.');
  let withStub = appHtml.slice(0, bodyAt + '<body>'.length)
    + '\n' + fakeApiScript(payload)
    + appHtml.slice(bodyAt + '<body>'.length);

  if (!/<html[^>]*\sdata-api=/.test(withStub)) {
    withStub = withStub.replace(/<html(\s[^>]*)?>/, (m) => m.replace(/^<html/, '<html data-api="/"'));
  }
  if (!/data-api="\/"/.test(withStub)) {
    throw new Error('Tidak dapat menetapkan data-api pada <html> dalam halaman ujian.');
  }

  const closeAt = withStub.lastIndexOf('</body>');
  return withStub.slice(0, closeAt) + harnessSource + withStub.slice(closeAt);
}

/** The same page with no API at all - what a double-clicked file:// copy sees. */
export function buildOfflinePage(appHtml, harnessSource) {
  const closeAt = appHtml.lastIndexOf('</body>');
  if (closeAt < 0) throw new Error('Penanda </body> tidak dijumpai dalam aplikasi.');
  return appHtml.slice(0, closeAt) + harnessSource + appHtml.slice(closeAt);
}

export function readApp(root, filename) {
  return readFileSync(`${root}/dist/${filename}`, 'utf8');
}
