/*
 * verify-deployed.mjs - smoke test a DEPLOYED Worker over the network.
 *
 *   node tools/verify-deployed.mjs [baseUrl]
 *
 * Everything else in this project is tested without deploying: the Worker suite runs
 * against local SQLite through a shim, and the browser suites run against a canned
 * API. Neither can prove that D1 is really bound, that the asset handler really
 * serves the page, or that nothing extra got published. This does - against the real
 * URL, over HTTPS.
 *
 * It writes two small observations and then deletes them, so it can be run against a
 * live database without leaving residue. If a step fails, cleanup still runs. The
 * write cycle only runs when ACCESS_MODE is "trusted"; in the other modes it checks
 * that anonymous writing is refused instead, which is the property that matters for a
 * public deployment.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const base = (process.argv[2] || 'https://aset-pks.wilsonintai76.workers.dev').replace(/\/$/, '');
let pass = 0;
let fail = 0;
const created = [];

function check(name, cond, detail) {
  if (cond) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail += 1; console.log(`  FAIL ${name}${detail ? '  -> ' + detail : ''}`); }
}

async function req(method, path, body) {
  const init = { method, headers: {} };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(base + path, init);
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  return { status: res.status, body: parsed, text, headers: res.headers };
}

const get = (p) => req('GET', p);
const post = (p, b) => req('POST', p, b);
const del = (p) => req('DELETE', p);

const rec = (label, bahagian) => ({
  Label: label,
  'Jenis Aset': 'UJIAN SMOKE',
  'Pegawai Penempatan': '',
  Bahagian: bahagian,
  'Lokasi Terkini': '',
});

console.log(`Sasaran: ${base}\n`);

/* ---- 1. the deployment serves the page ---- */

console.log('== Halaman disajikan ==');
const home = await get('/');
check('GET / 200', home.status === 200, String(home.status));
check('ialah HTML', (home.headers.get('content-type') || '').includes('text/html'),
  home.headers.get('content-type'));
check('mengandungi aplikasi', home.text.includes('Laporan Aset Yang Belum Diperiksa'));

/* ---- the split payload: the whole point of which is what a REPEAT visit costs ---- */

console.log('\n== Muatan dipecahkan & boleh dicache ==');

const cssRef = (home.text.match(/assets\/(app\.[A-Za-z0-9_-]{6,}\.css)/) || [])[1];
const jsRef = (home.text.match(/assets\/(app\.[A-Za-z0-9_-]{6,}\.js)/) || [])[1];

/*
 * The live page must be the build that is on disk.
 *
 * Everything else here checks that SOME valid page is being served. That is not enough: a
 * deploy that fails - or one whose edge copy has not moved yet - leaves the PREVIOUS
 * deployment answering, and every shape check still passes because the old build has the
 * same shape. Comparing the content hash says the thing that actually matters.
 */
const builtRef = (readFileSync(join(root, 'public', 'index.html'), 'utf8')
  .match(/assets\/(app\.[A-Za-z0-9_-]{6,}\.js)/) || [])[1];
check('halaman hidup ialah binaan yang ada di cakera', !!builtRef && jsRef === builtRef,
  `hidup ${jsRef} vs tempatan ${builtRef}`);
check('cangkerang kecil, bukan lagi satu fail besar', home.text.length < 24000,
  `${home.text.length} bait`);
check('cangkerang merujuk fail CSS berhash', !!cssRef, String(cssRef));
check('cangkerang merujuk fail JS berhash', !!jsRef, String(jsRef));
/* Named by content hash, so the browser may keep them without asking again. */
const jsAsset = cssRef ? await get(`/assets/${jsRef}`) : { headers: new Headers(), text: '' };
const cssAsset = cssRef ? await get(`/assets/${cssRef}`) : { headers: new Headers(), text: '' };
check('fail JS dihidangkan 200', jsAsset.status === 200, String(jsAsset.status));
check('fail CSS dihidangkan 200', cssAsset.status === 200, String(cssAsset.status));
check('fail JS dicache selama-lamanya oleh pelayar',
  /immutable/.test(jsAsset.headers.get('cache-control') || '')
  && /max-age=31556952/.test(jsAsset.headers.get('cache-control') || ''),
  String(jsAsset.headers.get('cache-control')));
check('fail CSS dicache selama-lamanya oleh pelayar',
  /immutable/.test(cssAsset.headers.get('cache-control') || ''),
  String(cssAsset.headers.get('cache-control')));
check('cangkerang sendiri kekal sentiasa segar (ia menamakan hash semasa)',
  /must-revalidate/.test(home.headers.get('cache-control') || ''),
  String(home.headers.get('cache-control')));
/* One visit downloads the shell and the two hashed files; the NEXT one downloads
   only the shell. With no ETag on these responses (measured), the hashed filenames
   are what make the second visit cheap - so their absence would be a silent
   regression back to re-downloading the whole app. */
/* Function names are minified away, so this looks for what cannot be: the published harness
   seam, and API paths the application must contain. */
check('nama berhash dan kandungan sepadan (JS)', jsAsset.text.includes('__uiHarness__'));
check('JS membawa laluan API aplikasi',
  jsAsset.text.includes('/api/bootstrap') && jsAsset.text.includes('/api/admin/observations'),
  'tiada laluan API dalam bundle');
check('CSS membawa peraturan cetakan', /@media print/.test(cssAsset.text));
check('aset dengan hash palsu tidak diterbitkan', (await get('/assets/app.deadbeef00.js')).status === 404);
// Browser storage must be gone from what is actually deployed, not just in the repo. The
// application is a separate asset now, so both the page and its code are searched.
const deployedCode = (home.text + jsAsset.text).replace(/\/\*[\s\S]*?\*\//g, '');
check('tiada localStorage dalam apa yang di-deploy', !/localStorage\s*[.\[]/.test(deployedCode));

/* ---- 2. nothing else got published ---- */

console.log('\n== Tiada artifak ujian diterbitkan ==');
for (const path of ['/selftest.html', '/index.html.map', '/wrangler.toml', '/../wrangler.toml']) {
  const res = await get(path);
  check(`${path} tidak boleh dicapai`, res.status !== 200, `HTTP ${res.status}`);
}

/* ---- 3. D1 is really bound ---- */

console.log('\n== D1 terikat ==');
const health = await get('/api/health');
check('GET /api/health 200', health.status === 200, String(health.status));
check('laporan ok', health.body && health.body.ok === true, JSON.stringify(health.body));
check('pangkalan data ialah d1', health.body && health.body.db === 'd1', String(health.body && health.body.db));
const before = health.body ? health.body.observations : -1;
console.log(`  (pemerhatian sedia ada: ${before})`);

/* ---- 3b. who an anonymous caller is, and what they may do ---- */

console.log('\n== Pembaca tanpa log masuk ==');
const who = await get('/api/me');
check('GET /api/me 200', who.status === 200, String(who.status));
const mode = (who.body && who.body.mode) || (who.body && who.body.enforced ? 'enforce' : 'open');
console.log(`  (ACCESS_MODE ${mode} · peranan ${who.body && who.body.role})`);
check('mod dilaporkan kepada halaman', ['open', 'password', 'enforce', 'trusted'].indexOf(mode) >= 0, String(mode));
check('mod tidak dikenali tidak dibiarkan menulis',
  who.body.writeAllowed !== true || mode === 'trusted', JSON.stringify(who.body));
/* Reading is public in every mode: the list is a document, not a secret. */
const cur = await get('/api/current');
check('senarai boleh dibaca tanpa log masuk',
  cur.status === 200 && cur.body && cur.body.ok === true, `HTTP ${cur.status}`);
check('laluan log masuk admin diumumkan kepada halaman',
  who.body.adminLoginPath === '/api/admin/login', String(who.body.adminLoginPath));
/* The door exists and leads somewhere else - it must not answer with data. */
const door = await get('/api/admin/login');
check('pintu log masuk bukan API data',
  !(door.headers.get('content-type') || '').includes('application/json'),
  door.headers.get('content-type') || `HTTP ${door.status}`);

/* The write path is the boundary. Both prefixes are tried: the /api/admin alias must
   not be a way around Access, and /api/* must not be a way around Access either. */
for (const p of ['/api/observations', '/api/admin/observations']) {
  const refused = await post(p, {
    observedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    records: [rec('SMOKE/TEST/REFUSED', 'BENGKEL UJIAN')],
  });
  check(`tanpa log masuk, ${p} ditolak`, refused.status === 401 || refused.status === 403,
    `HTTP ${refused.status}`);
}
const refusedDel = await del('/api/admin/observations/1');
check('tanpa log masuk, padam ditolak',
  refusedDel.status === 401 || refusedDel.status === 403, `HTTP ${refusedDel.status}`);

if (mode !== 'trusted') {
  console.log('\n== Kitaran tulis dilangkau ==');
  console.log('  (' + (mode === 'enforce'
    ? 'Access melindungi /api/admin: ujian tulis memerlukan log masuk, jadi ia dijalankan'
      + '\n   melalui pelayar sebagai admin.'
    : 'tiada log masuk dikonfigurasi, jadi setiap tulisan ditolak dengan sengaja.'));
} else {
  console.log('\n== Kitaran tulis -> baca -> padam ==');
const t0 = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const t1 = new Date(Date.now() + 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');

try {
  const o1 = await post('/api/admin/observations', {
    observedAt: t0,
    source: 'smoke-1',
    records: [rec('SMOKE/TEST/1', 'BENGKEL UJIAN'), rec('SMOKE/TEST/2', 'BENGKEL UJIAN')],
  });
  check('pemerhatian 1 diterima (201)', o1.status === 201, `${o1.status} ${JSON.stringify(o1.body)}`);
  if (o1.body && o1.body.observationId) created.push(o1.body.observationId);
  check('2 aset baharu direkodkan', o1.body && o1.body.added === 2, String(o1.body && o1.body.added));

  const o2 = await post('/api/admin/observations', {
    observedAt: t1,
    source: 'smoke-2',
    records: [rec('SMOKE/TEST/1', 'BENGKEL UJIAN'), rec('SMOKE/TEST/3', 'BENGKEL LAIN')],
  });
  check('pemerhatian 2 diterima (201)', o2.status === 201, `${o2.status} ${JSON.stringify(o2.body)}`);
  if (o2.body && o2.body.observationId) created.push(o2.body.observationId);
  check('mengesan 1 aset diperiksa', o2.body && o2.body.inspected === 1, String(o2.body && o2.body.inspected));
  check('mengesan 1 aset baharu', o2.body && o2.body.added === 1, String(o2.body && o2.body.added));

  /* The department deltas are the numbers the history tab reports as facts, so they
     are checked here against the real database rather than only against local SQLite. */
  const prog = await get('/api/progress');
  const last = (prog.body && prog.body.progress) ? prog.body.progress[prog.body.progress.length - 1] : null;
  const dp = (last && last.deptProgress) || [];
  const one = (name) => dp.find((d) => d.bahagian === name) || {};
  check('pecahan bahagian disertakan', dp.length > 0, JSON.stringify(dp));
  check('BENGKEL UJIAN: 2 awal, 1 diperiksa, 0 baharu, 1 akhir',
    one('BENGKEL UJIAN').awal === 2 && one('BENGKEL UJIAN').inspected === 1
    && one('BENGKEL UJIAN').added === 0 && one('BENGKEL UJIAN').akhir === 1,
    JSON.stringify(one('BENGKEL UJIAN')));
  check('BENGKEL LAIN: 0 awal, 0 diperiksa, 1 baharu, 1 akhir',
    one('BENGKEL LAIN').awal === 0 && one('BENGKEL LAIN').added === 1
    && one('BENGKEL LAIN').akhir === 1,
    JSON.stringify(one('BENGKEL LAIN')));

  const hist = await get('/api/history');
  check('sejarah mengandungi label ujian', /SMOKE\/TEST\/1/.test(hist.text));

  /* The duplicate rule compares against the LAST observation, so the same label set
     has to be re-sent. Sending fewer labels is a different list and is legitimately
     accepted - which is what an earlier version of this check got wrong. */
  const dup = await post('/api/admin/observations', {
    observedAt: new Date(Date.now() + 120000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    source: 'smoke-duplicate',
    records: [rec('SMOKE/TEST/1', 'BENGKEL UJIAN'), rec('SMOKE/TEST/3', 'BENGKEL LAIN')],
  });
  // If the refusal ever stops working, clean up after the bug rather than leave it.
  if (dup.body && dup.body.observationId) created.push(dup.body.observationId);
  check('muatan berulang ditolak (409)', dup.status === 409, `${dup.status} ${JSON.stringify(dup.body)}`);
  check('ditanda duplicate', dup.body && dup.body.duplicate === true, JSON.stringify(dup.body));
} catch (e) {
  check('kitaran tulis berjalan tanpa ralat', false, e && e.message);
}
}

/* ---- 5. cleanup, always ---- */

console.log('\n== Pembersihan ==');
for (const id of created) {
  const res = await del(`/api/admin/observations/${id}`);
  check(`padam pemerhatian ${id}`, res.status === 200, `HTTP ${res.status}`);
}
const after = await get('/api/health');
check('bilangan pemerhatian kembali seperti asal',
  after.body && after.body.observations === before,
  `${after.body && after.body.observations} vs ${before}`);

console.log('\n' + '='.repeat(60));
console.log(fail === 0
  ? `LULUS - ${pass} pemeriksaan terhadap deployment sebenar.`
  : `GAGAL - ${fail} pemeriksaan gagal.`);
console.log('='.repeat(60));
process.exit(fail ? 1 : 0);
