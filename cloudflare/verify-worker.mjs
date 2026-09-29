/*
 * verify-worker.mjs - run the API assertions against the Cloudflare Worker.
 *
 *   npm run cf:test
 *
 * cloudflare/worker.js is the whole backend, so this exercises it directly: the
 * fetch handler runs against real SQLite through the D1 shim (see d1-shim.mjs),
 * and the static-asset branch is checked with a stub binding instead of a real
 * deployment.
 *
 * It cannot check D1-specific behaviour (remote limits, cold starts, eventual
 * consistency). Those need `wrangler deploy`.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import nodeCrypto from 'node:crypto';
import { parseFile } from '../src/parser.mjs';
import { makeEnv } from './d1-shim.mjs';
import worker from './worker.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const env = makeEnv();
// The default mode is "open" (public reads, no writes at all), so the data assertions
// below run in "trusted": the mode for a private copy where everybody is an admin.
// The three modes and their write rules are checked separately, further down.
env.ACCESS_MODE = 'trusted';

// D1 speaks SQLite; the Worker's schema is created on first request.
async function call(method, path, body) {
  const url = 'http://worker.test' + path;
  const init = { method, headers: {} };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await worker.fetch(new Request(url, init), env);
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed, headers: res.headers, raw: text };
}
const get = (p) => call('GET', p);
const post = (p, b) => call('POST', p, b);

let pass = 0;
let fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail += 1; failures.push(name); console.log(`  FAIL ${name}${detail ? '  -> ' + detail : ''}`); }
}

const strip = (recs) => recs.map((r) => ({
  Label: r.Label,
  'Jenis Aset': r['Jenis Aset'],
  'Pegawai Penempatan': r['Pegawai Penempatan'],
  Bahagian: r.Bahagian,
  'Lokasi Terkini': r['Lokasi Terkini'],
}));

/** Undo the compact `{fields, rows}` wire format, exactly as the page does. */
const expand = (body) => (body?.rows || []).map((row) => {
  const out = {};
  (body?.fields || []).forEach((f, i) => { out[f] = row[i]; });
  return out;
});

console.log('== Worker: kesihatan & pengendalian ralat ==');
const health = await get('/api/health');
check('GET /api/health 200', health.status === 200, String(health.status));
check('laporan ok', health.body?.ok === true, JSON.stringify(health.body));
check('kosong pada mulanya', health.body?.observations === 0, String(health.body?.observations));

check('laluan tidak wujud -> 404', (await get('/api/nope')).status === 404);
check('kaedah tidak dibenarkan -> 405', (await call('DELETE', '/api/status')).status === 405);
check('rekod kosong -> 400', (await post('/api/observations', { records: [] })).status === 400);
check('rekod tanpa Label -> 400',
  (await post('/api/observations', { records: [{ 'Jenis Aset': 'X' }] })).status === 400);
check('label berulang -> 400',
  (await post('/api/observations', { records: [{ Label: 'A' }, { Label: 'A' }] })).status === 400);
check('observedAt tidak sah -> 400',
  (await post('/api/observations', { observedAt: 'bukan-tarikh', records: [{ Label: 'A' }] })).status === 400);
check('id pemerhatian bukan nombor -> 400', (await get('/api/observations/abc')).status === 400);
check('id pemerhatian tiada -> 404', (await get('/api/observations/9999')).status === 404);
check('timeline tiada -> 404', (await get('/api/timeline/TIDAK-ADA')).status === 404);

/* ---- static files come from the assets binding ---- */

console.log('\n== Worker: fail statik ==');
const asked = [];
const stubEnv = {
  ...env,
  ASSETS: {
    fetch: (req) => {
      asked.push(new URL(req.url).pathname);
      return new Response('<!doctype html><title>Laporan Aset</title>', {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    },
  },
};

const home = await worker.fetch(new Request('http://worker.test/'), stubEnv);
const homeText = await home.text();
check('GET / dijawab oleh binding ASSETS', home.status === 200 && asked[0] === '/');
check('halaman disajikan sebagai HTML',
  (home.headers.get('content-type') || '').includes('text/html'));
check('halaman bukan JSON ralat', !homeText.includes('"ok":false'), homeText.slice(0, 80));

await worker.fetch(new Request('http://worker.test/index.html'), stubEnv);
check('/index.html juga fail statik', asked[1] === '/index.html', String(asked[1]));

const api = await worker.fetch(new Request('http://worker.test/api/health'), stubEnv);
check('/api/* tidak dihantar ke fail statik',
  api.status === 200 && asked.length === 2, JSON.stringify(asked));

/* Without an assets binding the Worker must fail honestly rather than pretend. */
const noAssets = await worker.fetch(new Request('http://worker.test/'), env);
check('tanpa binding ASSETS, / memberi 404', noAssets.status === 404, String(noAssets.status));

const A = join(root, 'fixture', 'Senarai_Aset_Belum_Periksa_ABR_JKM.xls');
const B = join(root, 'fixture', 'Senarai_Aset_Belum_Periksa_HM_JKM.xls');
if (!existsSync(A) || !existsSync(B)) {
  console.log('\n(fixture tiada - ujian data sebenar dilangkau)');
  console.log(`\nKEPUTUSAN: ${pass} lulus, ${fail} gagal`);
  process.exit(fail ? 1 : 0);
}

const a = parseFile(readFileSync(A, 'utf8'), 'ABR');
const b = parseFile(readFileSync(B, 'utf8'), 'HM');
const recs1 = strip(a.records);
const recs2 = strip([...a.records.slice(0, 200), ...b.records]);
const RUN1 = new Date(Date.now() + 3600e3).toISOString();
const RUN2 = new Date(Date.now() + 7200e3).toISOString();
const RUN3 = new Date(Date.now() + 10800e3).toISOString();

console.log('\n== Worker: rekod pemerhatian ==');
const o1 = await post('/api/observations', { observedAt: RUN1, source: 'w-A', records: recs1 });
check('pemerhatian 1 diterima (201)', o1.status === 201, `${o1.status} ${JSON.stringify(o1.body)}`);
check(`mencatat ${recs1.length} aset`, o1.body?.assets === recs1.length, String(o1.body?.assets));
check('semuanya baharu', o1.body?.added === recs1.length, String(o1.body?.added));
check('tiada diperiksa', o1.body?.inspected === 0, String(o1.body?.inspected));

const o2 = await post('/api/observations', { observedAt: RUN2, source: 'w-B', records: recs2 });
check('pemerhatian 2 diterima (201)', o2.status === 201, `${o2.status} ${JSON.stringify(o2.body)}`);
const expected = recs1.length - 200;
check(`mengesan ${expected} aset diperiksa`, o2.body?.inspected === expected,
  `${o2.body?.inspected} vs ${expected}`);
check('mengesan 63 aset baharu', o2.body?.added === 63, String(o2.body?.added));
check('imbangan betul',
  recs1.length - (o2.body?.inspected ?? 0) + (o2.body?.added ?? 0) === recs2.length,
  `${recs1.length} - ${o2.body?.inspected} + ${o2.body?.added} vs ${recs2.length}`);

const dup = await post('/api/observations', { observedAt: RUN3, records: recs2 });
check('muatan berulang ditolak (409)', dup.status === 409, String(dup.status));
check('ditanda duplicate', dup.body?.duplicate === true, JSON.stringify(dup.body));

console.log('\n== Worker: bacaan balik ==');
const st = await get('/api/status');
check('status melaporkan 2 pemerhatian', st.body?.observations === 2, String(st.body?.observations));
check(`status melaporkan ${recs2.length} belum diperiksa`,
  st.body?.outstanding === recs2.length, `${st.body?.outstanding} vs ${recs2.length}`);
check('bilangan diperiksa sepadan',
  st.body?.inspected === 536 - recs2.length, `${st.body?.inspected} vs ${536 - recs2.length}`);
const dsum = (st.body?.departments || []).reduce((x, d) => x + d.bilangan, 0);
check('jumlah bahagian = belum diperiksa', dsum === st.body?.outstanding,
  `${dsum} vs ${st.body?.outstanding}`);
check('peratus dikira', typeof st.body?.progressPercent === 'number');

/* The viewer's screen: the current list, with the five asset fields it renders. */
const cur = await get('/api/current');
check('GET /api/current 200', cur.status === 200, String(cur.status));
check('senarai semasa sepadan dengan pemerhatian terakhir',
  cur.body?.id === o2.body.observationId, `${cur.body?.id} vs ${o2.body.observationId}`);
check(`senarai semasa mengandungi ${recs2.length} aset`,
  cur.body?.assets === recs2.length, `${cur.body?.assets} vs ${recs2.length}`);
check('senarai dihantar dalam bentuk padat: lajur + baris',
  JSON.stringify(cur.body?.fields)
  === JSON.stringify(['Label', 'Jenis Aset', 'Pegawai Penempatan', 'Bahagian', 'Lokasi Terkini'])
  && Array.isArray(cur.body?.rows) && cur.body?.records === undefined,
  JSON.stringify(Object.keys(cur.body || {})));
check('setiap baris membawa lima nilai, dalam susunan lajur',
  (cur.body?.rows || []).every((r) => r.length === 5),
  JSON.stringify((cur.body?.rows || []).find((r) => r.length !== 5)));
/* Compare as SETS: the endpoint sorts by label, and asserting on the first element
   would only be testing the fixture's extraction order. */
const curRows = expand(cur.body);
const curLabels = curRows.map((r) => r.Label).sort();
const wantLabels = recs2.map((r) => r.Label).sort();
check('setiap label dalam pemerhatian terakhir hadir',
  JSON.stringify(curLabels) === JSON.stringify(wantLabels),
  `${curLabels.length} vs ${wantLabels.length}`);
check('medan Bahagian datang daripada rekod',
  curRows.every((r) => r.Bahagian === (recs2.find((x) => x.Label === r.Label)?.Bahagian || '')),
  'ada rekod yang tidak sepadan');
check('bahagian disertakan untuk tapisan',
  (cur.body?.departments || []).length > 0, JSON.stringify(cur.body?.departments));
check('baki bahagian = bilangan aset',
  (cur.body?.departments || []).reduce((n, d) => n + d.bilangan, 0) === recs2.length);

const pr = await get('/api/progress');
check('progress mengembalikan 2 titik masa', (pr.body?.progress || []).length === 2,
  String((pr.body?.progress || []).length));
const p2 = (pr.body?.progress || [])[1];
check('progress: peratus sepadan',
  p2?.percent === Math.round((expected * 100 / recs1.length) * 10) / 10,
  `${p2?.percent} vs ${Math.round((expected * 100 / recs1.length) * 10) / 10}`);

/* Per-department deltas must be exact set differences, not count arithmetic: a
   department that lost 5 and gained 5 is not the same as one that lost 10 and
   gained 10, and the page reports these as facts. */
const dp = p2?.deptProgress || [];
const dpSum = (key) => dp.reduce((n, d) => n + (d[key] || 0), 0);
check('progress: pecahan bahagian disertakan', dp.length > 0, String(dp.length));
check('progress: jumlah diperiksa setiap bahagian = jumlah keseluruhan',
  dpSum('inspected') === expected, `${dpSum('inspected')} vs ${expected}`);
check('progress: jumlah baharu setiap bahagian = 63', dpSum('added') === 63, String(dpSum('added')));
check('progress: awal - diperiksa + baharu = akhir untuk setiap bahagian',
  dp.every((d) => d.awal - d.inspected + d.added === d.akhir),
  JSON.stringify(dp.find((d) => d.awal - d.inspected + d.added !== d.akhir)));
check('progress: titik masa pertama tiada pecahan',
  (pr.body?.progress?.[0]?.deptProgress || []).length === 0);

const mem = await get(`/api/observations/${o2.body.observationId}`);
check('keahlian pemerhatian 2 tepat', mem.body?.labels?.length === recs2.length,
  `${mem.body?.labels?.length} vs ${recs2.length}`);
const want = new Set(recs2.map((r) => r.Label));
const got = new Set(mem.body?.labels || []);
check('setiap label dipulihara', want.size === got.size && [...want].every((l) => got.has(l)));

const gone = recs1[400].Label;
const tl = await get(`/api/timeline/${encodeURIComponent(gone)}`);
check(`timeline ${gone} dijumpai`, tl.status === 200, String(tl.status));
check('label hilang ditandakan sudah diperiksa', tl.body?.status === 'Sudah diperiksa',
  String(tl.body?.status));
check('muncul dalam 1 pemerhatian sahaja', tl.body?.present?.length === 1,
  JSON.stringify(tl.body?.present?.length));
const alive = recs1[10].Label;
const tl2 = await get(`/api/timeline/${encodeURIComponent(alive)}`);
check('label masih ada ditandakan belum diperiksa', tl2.body?.status === 'Belum diperiksa',
  String(tl2.body?.status));

const hist = await get('/api/history');
check('history mengembalikan 536 label', hist.body?.count === 536, String(hist.body?.count));
const histRows = expand(hist.body);
const outstandingRows = histRows.filter((r) => r.Status === 'Belum diperiksa');
check('history: bilangan belum diperiksa sepadan',
  outstandingRows.length === recs2.length, `${outstandingRows.length} vs ${recs2.length}`);
check('history: lajur dijangka',
  JSON.stringify(hist.body?.fields)
  === JSON.stringify(['Label', 'Jenis Aset', 'Bahagian', 'Lokasi Terkini', 'Pertama Dilihat',
    'Terakhir Dilihat', 'Kali Dilihat', 'Kali Hilang', 'Muncul Semula', 'Status'])
  && histRows.every((r) => r.Label && r.Status),
  JSON.stringify(hist.body?.fields));

/* ---- caching and payload size: the difference between a usable page and a slow one -- */

console.log('\n== Worker: cache & muatan ==');

check('bacaan membawa ETag', !!cur.headers.get('etag'), String(cur.headers.get('etag')));
check('bacaan membenarkan cache kongsi sebentar, tetapi pelayar sentiasa mengesahkan',
  /s-maxage=\d+/.test(cur.headers.get('cache-control') || '')
  && /max-age=0/.test(cur.headers.get('cache-control') || '')
  && /stale-while-revalidate=\d+/.test(cur.headers.get('cache-control') || ''),
  String(cur.headers.get('cache-control')));

/* The whole point: a repeat visit costs a 304 and no body. */
const again = await callAs('GET', '/api/current', undefined,
  { 'If-None-Match': cur.headers.get('etag') }, env);
check('permintaan ulangan dijawab 304 tanpa badan', again.status === 304 && again.body === '',
  `${again.status} ${JSON.stringify(again.body).slice(0, 40)}`);
check('304 tetap membawa ETag untuk pengesahan seterusnya',
  again.headers.get('etag') === cur.headers.get('etag'), String(again.headers.get('etag')));
const stale = await callAs('GET', '/api/current', undefined,
  { 'If-None-Match': '"tidak-sepadan"' }, env);
check('ETag yang tidak sepadan mendapat badan penuh', stale.status === 200 && stale.body.assets > 0,
  String(stale.status));

/* Static assets have no validator on this deployment (measured), which is why the
   page's payload has to be split into separately cached files - but the JSON API must
   never repeat that mistake. */
check('jawapan berbeza mendapat ETag berbeza',
  !!hist.headers.get('etag') && hist.headers.get('etag') !== cur.headers.get('etag'),
  `${hist.headers.get('etag')} vs ${cur.headers.get('etag')}`);

/* Identity must never be share-cached. /api/me reports the CALLER's role, and a shared
   cache keys on the URL alone, so an admin who had just logged in was handed the cached
   anonymous answer ("viewer") - which looks exactly like "logging in did nothing".
   Found on the live deployment, not here: a shim has no edge cache, so the header is
   what can be asserted. */
const meCacheAnon = await callAs('GET', '/api/me', undefined, {}, env);
check('bacaan awam masih boleh dicache secara kongsi',
  /public/.test(meCacheAnon.headers.get('cache-control') || '')
  && /s-maxage/.test(meCacheAnon.headers.get('cache-control') || ''),
  String(meCacheAnon.headers.get('cache-control')));
const meCacheCookie = await callAs('GET', '/api/me', undefined, { Cookie: 'aset_admin=apa-apa' }, env);
check('bacaan dengan kuki TIDAK boleh dicache secara kongsi',
  /private/.test(meCacheCookie.headers.get('cache-control') || '')
  && !/s-maxage/.test(meCacheCookie.headers.get('cache-control') || ''),
  String(meCacheCookie.headers.get('cache-control')));
const bootCacheCookie = await callAs('GET', '/api/bootstrap', undefined, { Cookie: 'aset_admin=apa-apa' }, env);
check('/api/bootstrap dengan kuki juga peribadi',
  /private/.test(bootCacheCookie.headers.get('cache-control') || '')
  && !/s-maxage/.test(bootCacheCookie.headers.get('cache-control') || ''),
  String(bootCacheCookie.headers.get('cache-control')));

const compactBytes = JSON.stringify({ fields: cur.body.fields, rows: cur.body.rows }).length;
const objectBytes = JSON.stringify({ records: expand(cur.body) }).length;
check(`bentuk padat lebih kecil daripada bentuk objek (${compactBytes} vs ${objectBytes})`,
  compactBytes < objectBytes * 0.75, `${Math.round((compactBytes / objectBytes) * 100)}%`);

const histCompact = JSON.stringify(hist.body).length;
const histObject = JSON.stringify({ rows: histRows }).length;
check(`sejarah padat lebih kecil (${histCompact} vs ${histObject})`,
  histCompact < histObject * 0.75, `${Math.round((histCompact / histObject) * 100)}%`);

/* Writes must never be cached: a cached 201 or 409 would be a lie. This runs against
   its own database, so the data assertions above keep the counts they expect. */
const writeEnv = { ...makeEnv(), ACCESS_MODE: 'trusted' };
const writeRes = await callAs('POST', '/api/observations', {
  observedAt: '2026-06-01T00:00:00Z',
  records: [{ Label: 'CACHE/UJIAN/1', Bahagian: 'BENGKEL CACHE' }],
}, {}, writeEnv);
check('tulisan diterima sebagai pemerhatian baharu', writeRes.status === 201,
  `${writeRes.status} ${JSON.stringify(writeRes.body)}`);
check('jawapan tulis tiada ETag', !writeRes.headers.get('etag'), String(writeRes.headers.get('etag')));
check('jawapan tulis tiada cache awam',
  !/public/.test(writeRes.headers.get('cache-control') || ''),
  String(writeRes.headers.get('cache-control')));

/* ---- one call instead of six ---- */

console.log('\n== Worker: /api/bootstrap ==');
const boot = await get('/api/bootstrap');
check('GET /api/bootstrap 200', boot.status === 200, String(boot.status));
check('membawa identiti pemanggil', boot.body?.me?.role === 'admin' || boot.body?.me?.role === 'viewer',
  JSON.stringify(boot.body?.me));
check('membawa pengiraan kesihatan', typeof boot.body?.health?.assets === 'number',
  JSON.stringify(boot.body?.health));
check('membawa ringkasan status', typeof boot.body?.status?.outstanding === 'number');
check('membawa senarai semasa dalam bentuk padat',
  Array.isArray(boot.body?.current?.rows) && boot.body?.current?.assets === cur.body.assets,
  `${boot.body?.current?.assets} vs ${cur.body.assets}`);
check('membawa kemajuan setiap titik masa',
  (boot.body?.progress?.progress || []).length === (pr.body?.progress || []).length,
  String((boot.body?.progress?.progress || []).length));
check('membawa sejarah dalam bentuk padat',
  Array.isArray(boot.body?.history?.rows) && boot.body?.history?.count === hist.body.count,
  `${boot.body?.history?.count} vs ${hist.body.count}`);
check('membawa tetapan Bahagian', Array.isArray(boot.body?.overrides?.overrides)
  && typeof boot.body?.overrides?.count === 'number', JSON.stringify(boot.body?.overrides));
/* Same numbers as the individual endpoints, so splitting or merging them cannot change
   what the page shows. */
const bootRows = expand(boot.body.current);
check('senarai dalam bootstrap sepadan dengan /api/current',
  JSON.stringify(bootRows.map((r) => r.Label).sort())
  === JSON.stringify(curRows.map((r) => r.Label).sort()),
  `${bootRows.length} vs ${curRows.length}`);
check('bootstrap juga boleh disahkan dengan ETag',
  (await callAs('GET', '/api/bootstrap', undefined,
    { 'If-None-Match': boot.headers.get('etag') }, env)).status === 304);
check('bootstrap melalui laluan admin juga berfungsi',
  (await call('GET', '/api/admin/bootstrap')).status === 200);


console.log('\n== Worker: CSV ==');
/* Read the BODY AS BYTES. Response.text() decodes UTF-8 and consumes a leading
   BOM, so a byte-level check must come from arrayBuffer() - the same trap that
   produced a false failure in the HTTP suite. */
const csvRaw = await worker.fetch(new Request('http://worker.test/api/export.csv'), env);
const csvBytes = new Uint8Array(await csvRaw.arrayBuffer());
const csvText = new TextDecoder('utf-8').decode(csvBytes);
check('CSV 200', csvRaw.status === 200, String(csvRaw.status));
check('CSV bermula dengan BOM UTF-8',
  csvBytes[0] === 0xEF && csvBytes[1] === 0xBB && csvBytes[2] === 0xBF,
  [...csvBytes.slice(0, 3)].map((n) => n.toString(16)).join(' '));
check('CSV mempunyai 537 baris', csvText.replace(/^\uFEFF/, '').trim().split('\r\n').length === 537,
  String(csvText.replace(/^\uFEFF/, '').trim().split('\r\n').length));
check('CSV menggunakan CRLF', csvText.indexOf('\r\n') > 0, 'tiada CRLF');
check('tajuk CSV betul',
  csvText.replace(/^\uFEFF/, '').split('\r\n')[0].startsWith('Label,Jenis Aset,Bahagian'),
  csvText.split('\r\n')[0]);

console.log('\n== Worker: tetapan Bahagian ==');
const ov0 = await get('/api/overrides');
check('bermula tanpa tetapan', ov0.body?.count === 0, String(ov0.body?.count));
const blankLabel = recs1.find((r) => !(r.Bahagian || '').trim())?.Label;
const dept = (st.body?.departments || [])[0]?.bahagian;
check('ada rekod tanpa Bahagian untuk diuji', !!blankLabel, String(blankLabel));

if (blankLabel && dept) {
  const set = await post('/api/overrides', { overrides: [{ label: blankLabel, bahagian: dept }] });
  check('tetapan sah diterima', set.status === 200, `${set.status} ${JSON.stringify(set.body)}`);
  check('satu tetapan disimpan', set.body?.set === 1, String(set.body?.set));
  check('tetapan boleh dibaca semula', (await get('/api/overrides')).body?.count === 1);

  const bogus = await post('/api/overrides', {
    overrides: [{ label: blankLabel, bahagian: 'JABATAN TIDAK WUJUD SAMA SEKALI' }],
  });
  check('bahagian tidak wujud ditolak (207)', bogus.status === 207, String(bogus.status));
  check('penolakan disenaraikan', (bogus.body?.rejected || []).length === 1,
    JSON.stringify(bogus.body?.rejected));
  check('tiada tetapan tambahan disimpan', bogus.body?.count === 1, String(bogus.body?.count));

  const cleared = await post('/api/overrides', { overrides: [{ label: blankLabel, bahagian: '' }] });
  check('membatalkan tetapan berfungsi', cleared.body?.cleared === 1, JSON.stringify(cleared.body));

  check('tetapan tanpa label ditolak',
    (await post('/api/overrides', { overrides: [{ bahagian: dept }] })).status === 400);
  check('overrides bukan senarai ditolak',
    (await post('/api/overrides', { overrides: 'x' })).status === 400);
}

/* Deleting a point in the timeline is the escape hatch for uploading the wrong
   file, so it runs LAST: it changes the data every earlier assertion depends on. */
console.log('\n== Worker: padam pemerhatian ==');
check('id tidak sah -> 400', (await call('DELETE', '/api/observations/abc')).status === 400);
check('id tidak wujud -> 404', (await call('DELETE', '/api/observations/9999')).status === 404);
check('laluan lain -> 405', (await call('DELETE', '/api/status')).status === 405);

const del = await call('DELETE', `/api/observations/${o2.body.observationId}`);
check('padam pemerhatian ke-2 -> 200', del.status === 200, `${del.status} ${JSON.stringify(del.body)}`);
check('id yang dipadam dilaporkan', del.body?.deleted === o2.body.observationId,
  JSON.stringify(del.body));

const after = await get('/api/status');
check('tinggal 1 pemerhatian', after.body?.observations === 1, String(after.body?.observations));
check(`aset kembali kepada ${recs1.length}`, after.body?.assets === recs1.length,
  `${after.body?.assets} vs ${recs1.length}`);
check('semuanya belum diperiksa semula', after.body?.outstanding === recs1.length,
  `${after.body?.outstanding} vs ${recs1.length}`);
const histAfter = await get('/api/history');
check('sejarah dipadam bersama pemerhatiannya', histAfter.body?.count === recs1.length,
  `${histAfter.body?.count} vs ${recs1.length}`);
check('anak-anak baris turut dibuang',
  (await get(`/api/observations/${o2.body.observationId}`)).status === 404);

/* --------------------------------------------------- repeated vs corrected --
 *
 * Two cases that used to be one. "I already uploaded this" means the SNAPSHOT is the
 * same, not that the labels are: a corrected export - same assets, one Bahagian fixed
 * in the source - must be accepted, or the correction can never land.
 *
 * Its own database, so the counts asserted above stay exactly as they are.
 */
console.log('\n== Worker: muatan berulang vs fail yang dibetulkan ==');
const dupEnv = { ...makeEnv(), ACCESS_MODE: 'trusted' };
const postSnapshot = async (records, at) => {
  const res = await worker.fetch(new Request('http://worker.test/api/observations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ observedAt: at, records }),
  }), dupEnv);
  return { status: res.status, body: await res.json() };
};
const three = [
  { Label: 'U/1', 'Jenis Aset': 'PC', Bahagian: 'BENGKEL A' },
  { Label: 'U/2', 'Jenis Aset': 'PC', Bahagian: 'BENGKEL A' },
  { Label: 'U/3', 'Jenis Aset': 'PC', Bahagian: 'BENGKEL B' },
];
const first = await postSnapshot(three, '2026-04-01T00:00:00Z');
check('snapshot pertama diterima', first.status === 201, String(first.status));
const same = await postSnapshot(three, '2026-04-02T00:00:00Z');
check('snapshot yang sama tepat ditolak (409)', same.status === 409, String(same.status));
check('penolakan ditanda duplicate', same.body?.duplicate === true, JSON.stringify(same.body));
check('penolakan tidak mencipta titik masa',
  (await callAs('GET', '/api/status', undefined, {}, dupEnv)).body.observations === 1);
const shuffled = await postSnapshot([three[2], three[0], three[1]], '2026-04-03T00:00:00Z');
check('susunan berbeza tetapi kandungan sama tetap ditolak (409)',
  shuffled.status === 409, String(shuffled.status));
const corrected = await postSnapshot(
  three.map((r) => (r.Label === 'U/3' ? { ...r, Bahagian: 'BENGKEL C' } : r)),
  '2026-04-04T00:00:00Z',
);
check('fail yang DIBETULKAN (label sama, Bahagian berbeza) diterima',
  corrected.status === 201, `${corrected.status} ${JSON.stringify(corrected.body)}`);
check('pembetulan menjadi titik masa baharu',
  (await callAs('GET', '/api/status', undefined, {}, dupEnv)).body.observations === 2);
check('label yang sama tidak dikira diperiksa',
  corrected.body?.inspected === 0, JSON.stringify(corrected.body));
check('pembetulan itulah yang dibaca pembaca',
  (await callAs('GET', '/api/current', undefined, {}, dupEnv)).body.rows
    ?.some((r) => r[0] === 'U/3' && r[3] === 'BENGKEL C'),
  JSON.stringify((await callAs('GET', '/api/current', undefined, {}, dupEnv)).body.rows?.find((r) => r[0] === 'U/3')));

/* --------------------------------------------------------------- purge -- */
console.log('\n== Worker: kosongkan semua titik masa ==');
const purgeEnv = { ...makeEnv(), ACCESS_MODE: 'trusted' };
await worker.fetch(new Request('http://worker.test/api/observations', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ observedAt: '2026-05-01T00:00:00Z', records: three }),
}), purgeEnv);
const purge = await worker.fetch(
  new Request('http://worker.test/api/observations', { method: 'DELETE' }), purgeEnv,
);
const purgeBody = await purge.json();
check('padam semua titik masa diterima', purge.status === 200, String(purge.status));
check('bilangan titik masa dilaporkan', purgeBody?.runs === 1, JSON.stringify(purgeBody));
check('titik masa benar-benar hilang',
  (await callAs('GET', '/api/status', undefined, {}, purgeEnv)).body.observations === 0);
check('aset juga hilang',
  (await callAs('GET', '/api/history', undefined, {}, purgeEnv)).body.count === 0);
check('senarai semasa kosong, bukan ralat',
  (await callAs('GET', '/api/current', undefined, {}, purgeEnv)).body.assets === 0);
check('tetapan Bahagian manual TIDAK dipadam', purgeBody?.overridesKept === true);
/* The purge is a write, so it must be refused wherever writing is refused. */
const purgeOpen = await worker.fetch(
  new Request('http://worker.test/api/observations', { method: 'DELETE' }), makeEnv(),
);
check('mod open: kosongkan ditolak (fail closed)', purgeOpen.status === 403, String(purgeOpen.status));
check('kaedah lain pada laluan yang sama masih 405',
  (await callAs('PUT', '/api/observations', undefined, {}, purgeEnv)).status === 405);

/* ------------------------------------------------------------------ roles --
 *
 * The role split is the part of this Worker that must not be decorative: a viewer
 * has to be unable to write even when calling the API directly. So a REAL RSA key is
 * generated here, real JWTs are signed with it, and Access's certificate endpoint is
 * stubbed. Anything less would only be testing the header parsing.
 */
console.log('\n== Worker: peranan (admin vs viewer) ==');

const roleFailures = [];
const roleCheck = (name, cond, detail) => {
  if (cond) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail += 1; roleFailures.push(name); console.log(`  FAIL ${name}${detail ? '  -> ' + detail : ''}`); }
};

const TEAM = 'poliku.cloudflareaccess.com';
const AUD = 'aud-tag-123';
const ADMIN = 'bos@poliku.edu.my';
const VIEWER = 'pegawai@poliku.edu.my';

const b64u = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
function signJwt(claims, key, kid = 'test-key-1') {
  const input = `${b64u({ alg: 'RS256', kid, typ: 'JWT' })}.${b64u(claims)}`;
  const sig = nodeCrypto.createSign('RSA-SHA256').update(input).sign(key).toString('base64url');
  return `${input}.${sig}`;
}

const keyPair = nodeCrypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherPair = nodeCrypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = { ...keyPair.publicKey.export({ format: 'jwk' }), kid: 'test-key-1', alg: 'RS256', use: 'sig' };

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).indexOf('/cdn-cgi/access/certs') >= 0) {
    return new Response(JSON.stringify({ keys: [publicJwk] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }
  return realFetch(url, init);
};

const now = Math.floor(Date.now() / 1000);
const claimsFor = (email, extra) => ({
  email, iss: `https://${TEAM}`, aud: AUD, iat: now - 10, exp: now + 600, ...(extra || {}),
});
const adminToken = signJwt(claimsFor(ADMIN), keyPair.privateKey);
const viewerToken = signJwt(claimsFor(VIEWER), keyPair.privateKey);
const forgedToken = signJwt(claimsFor(ADMIN), otherPair.privateKey);   // right claims, wrong key
const expiredToken = signJwt(claimsFor(ADMIN, { exp: now - 60 }), keyPair.privateKey);
const wrongAudToken = signJwt(claimsFor(ADMIN, { aud: 'aud-lain' }), keyPair.privateKey);

const enforcedEnv = () => ({
  ...makeEnv(),
  ACCESS_MODE: 'enforce',
  ADMIN_EMAILS: `${ADMIN}, kedua@poliku.edu.my`,
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUD,
});
async function callAs(method, path, body, headers, env2) {
  const init = { method, headers: { ...(headers || {}) } };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await worker.fetch(new Request('http://worker.test' + path, init), env2);
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return {
    status: res.status,
    body: parsed,
    location: res.headers.get('location'),
    headers: res.headers,
  };
}

const auth = (token) => ({ 'Cf-Access-Jwt-Assertion': token });
const upload = { observedAt: '2026-03-01T00:00:00Z', records: [{ Label: 'PERANAN/1', Bahagian: 'BENGKEL UJIAN' }] };
// A different label set, so a second write is a genuine insert rather than the
// duplicate guard answering 409.
const upload2 = { observedAt: '2026-03-02T00:00:00Z', records: [{ Label: 'PERANAN/2', Bahagian: 'BENGKEL UJIAN' }] };

/* ---- "open": the default. Public reads, and nothing may be written ---- */
const openEnv = makeEnv();
const meOpen = await callAs('GET', '/api/me', undefined, {}, openEnv);
roleCheck('mod lalai (open): peranan viewer', meOpen.body.role === 'viewer', JSON.stringify(meOpen.body));
roleCheck('mod lalai (open): mod dilaporkan', meOpen.body.mode === 'open', JSON.stringify(meOpen.body));
roleCheck('mod lalai (open): log masuk admin belum disediakan',
  meOpen.body.accessConfigured === false, JSON.stringify(meOpen.body));
roleCheck('mod lalai (open): membaca dibenarkan tanpa log masuk',
  (await callAs('GET', '/api/status', undefined, {}, openEnv)).status === 200);
const openWrite = await callAs('POST', '/api/observations', upload, {}, openEnv);
roleCheck('mod lalai (open): tulis ditolak (fail closed)', openWrite.status === 403,
  `${openWrite.status}`);
roleCheck('mod lalai (open): mesej menyebut bagaimana membetulkannya',
  /ACCESS_MODE/.test(String(openWrite.body && openWrite.body.error)),
  JSON.stringify(openWrite.body));
roleCheck('mod lalai (open): padam juga ditolak',
  (await callAs('DELETE', '/api/observations/1', undefined, {}, openEnv)).status === 403);

/* ---- "trusted": a private copy, no login, everybody an admin ---- */
const trustedEnv = { ...makeEnv(), ACCESS_MODE: 'trusted' };
const meTrusted = await callAs('GET', '/api/me', undefined, {}, trustedEnv);
roleCheck('mod trusted: peranan admin tanpa token',
  meTrusted.body.role === 'admin', JSON.stringify(meTrusted.body));
roleCheck('mod trusted: mod dilaporkan', meTrusted.body.mode === 'trusted', JSON.stringify(meTrusted.body));
roleCheck('mod trusted: tulis dibenarkan',
  (await callAs('POST', '/api/observations', upload, {}, trustedEnv)).status === 201);

/* ---- "password": the login dialog, with no Cloudflare Access in front ----
 *
 * This mode exists so a single admin can sign in on a deployment that has no Access
 * application. The credential is a secret, so the checks that matter are the failures:
 * wrong password, no secret configured, a tampered cookie, a cookie signed with a
 * different password, and a cookie whose expiry has passed.
 */
console.log('\n== Worker: log masuk kata laluan ==');

const PW = 'kata-laluan-ujian-yang-panjang';
const passwordEnv = () => ({
  ...makeEnv(), ACCESS_MODE: 'password', ADMIN_EMAILS: ADMIN, ADMIN_PASSWORD: PW,
});
const bearer = (cookie) => ({ Cookie: String(cookie).split(';')[0] });

/* Choosing the mode without setting the secret must fail CLOSED, and say what to fix. */
const pwUnset = { ...makeEnv(), ACCESS_MODE: 'password' };
const meUnset = await callAs('GET', '/api/me', undefined, {}, pwUnset);
roleCheck('mod password tanpa rahsia: peranan viewer',
  meUnset.body.role === 'viewer', JSON.stringify(meUnset.body));
roleCheck('mod password tanpa rahsia: dilaporkan kepada halaman',
  meUnset.body.passwordConfigured === false && meUnset.body.loginMethod === 'none',
  JSON.stringify(meUnset.body));
const unsetWrite = await callAs('POST', '/api/observations', upload, {}, pwUnset);
roleCheck('mod password tanpa rahsia: tulis ditolak (fail closed)', unsetWrite.status === 403,
  String(unsetWrite.status));
roleCheck('mod password tanpa rahsia: mesej menyebut pembetulan',
  /ADMIN_PASSWORD/.test(String(unsetWrite.body && unsetWrite.body.error)),
  JSON.stringify(unsetWrite.body));
roleCheck('mod password tanpa rahsia: log masuk ditolak',
  (await callAs('POST', '/api/admin/login', { password: PW }, {}, pwUnset)).status === 403);

/* Other modes must not accept a password, and must say which method they do use. */
roleCheck('mod open: kaedah log masuk dilaporkan sebagai tiada',
  (await callAs('GET', '/api/me', undefined, {}, openEnv)).body.loginMethod === 'none');
roleCheck('mod enforce: kaedah log masuk dilaporkan sebagai Access',
  (await callAs('GET', '/api/me', undefined, {}, enforcedEnv())).body.loginMethod === 'access');
roleCheck('mod enforce: log masuk kata laluan ditolak (400)',
  (await callAs('POST', '/api/admin/login', { password: PW }, {}, enforcedEnv())).status === 400);

/* With the secret set, this is the way in. */
const pwEnv = passwordEnv();
const mePw = await callAs('GET', '/api/me', undefined, {}, pwEnv);
roleCheck('mod password: kaedah log masuk diumumkan ke halaman',
  mePw.body.loginMethod === 'password' && mePw.body.passwordConfigured === true,
  JSON.stringify(mePw.body));
roleCheck('mod password: tanpa sesi, peranan viewer',
  mePw.body.role === 'viewer', JSON.stringify(mePw.body));
roleCheck('mod password tanpa sesi: tulis ditolak (401)',
  (await callAs('POST', '/api/observations', upload, {}, pwEnv)).status === 401);

const wrongPw = await callAs('POST', '/api/admin/login', { password: 'salah-sekali' }, {}, pwEnv);
roleCheck('kata laluan salah ditolak (401)', wrongPw.status === 401, String(wrongPw.status));
roleCheck('penolakan tidak menyebut kata laluan sebenar',
  !String(wrongPw.body && wrongPw.body.error || '').includes(PW),
  JSON.stringify(wrongPw.body));
roleCheck('kata laluan kosong ditolak (400)',
  (await callAs('POST', '/api/admin/login', {}, {}, pwEnv)).status === 400);
roleCheck('badan bukan JSON ditolak (400)',
  (await callAs('POST', '/api/admin/login', 'bukan-json', {}, pwEnv)).status === 400);

const login = await callAs('POST', '/api/admin/login', { password: PW }, {}, pwEnv);
roleCheck('kata laluan betul diterima',
  login.status === 200 && login.body.role === 'admin',
  `${login.status} ${JSON.stringify(login.body)}`);
const setCookie = String(login.headers.get('set-cookie') || '');
roleCheck('kuki sesi dihantar', setCookie.indexOf('aset_admin=') === 0, setCookie);
roleCheck('kuki sesi HttpOnly, Secure dan SameSite',
  /HttpOnly/.test(setCookie) && /Secure/.test(setCookie) && /SameSite=Lax/.test(setCookie),
  setCookie);
roleCheck('kuki sesi mempunyai had masa',
  /Max-Age=\d+/.test(setCookie) && Number(/Max-Age=(\d+)/.exec(setCookie)[1]) > 60, setCookie);
roleCheck('jawapan log masuk tidak mengandungi kata laluan',
  JSON.stringify(login.body).includes(PW) === false, JSON.stringify(login.body));
const jar = bearer(setCookie);
const meCookie = await callAs('GET', '/api/me', undefined, jar, pwEnv);
roleCheck('kuki sesi memberi peranan admin', meCookie.body.role === 'admin', JSON.stringify(meCookie.body));
roleCheck('kuki sesi melaporkan e-mel admin', meCookie.body.email === ADMIN, meCookie.body.email);
roleCheck('kuki sesi membenarkan tulisan',
  (await callAs('POST', '/api/admin/observations', upload, jar, pwEnv)).status === 201);
/* 207 means the department was rejected by the DATA, which is a different question:
   what is being proved here is that the write door opened for a session holder. */
roleCheck('kuki sesi membuka pintu tetapan Bahagian (bukan 401/403)',
  [200, 207].indexOf((await callAs('POST', '/api/admin/overrides',
    { overrides: [{ label: 'X', bahagian: 'Y' }] }, jar, pwEnv)).status) >= 0);
roleCheck('log masuk hanya di bawah awalan /api/admin, seperti dahulu',
  (await callAs('POST', '/api/login', { password: PW }, {}, pwEnv)).status === 404);

/* A cookie is a claim, so every way of bending one has to be refused. */
const cookieValue = String(setCookie).split(';')[0];
const flipLast = (value) => value.slice(0, -1) + (value.endsWith('A') ? 'B' : 'A');
roleCheck('kuki yang diubah tanda tangannya ditolak',
  (await callAs('GET', '/api/me', undefined, { Cookie: flipLast(cookieValue) }, pwEnv))
    .body.role === 'viewer');
roleCheck('kuki tanpa tanda tangan ditolak',
  (await callAs('GET', '/api/me', undefined,
    { Cookie: cookieValue.slice(0, cookieValue.lastIndexOf('.')) }, pwEnv))
    .body.role === 'viewer');
const otherPassword = await callAs('POST', '/api/admin/login', { password: PW },
  {}, { ...pwEnv, ADMIN_PASSWORD: 'kata-laluan-lain-sama-panjang' });
roleCheck('kuki daripada kata laluan lain ditolak',
  (await callAs('GET', '/api/me', undefined, bearer(otherPassword.headers.get('set-cookie')), pwEnv))
    .body.role === 'viewer');

/* Expiry cannot be reached over HTTP - the key is needed - so the seam signs one. */
const { __sessionInternals } = await import('./worker.js');
const sessionKey = await __sessionInternals.sessionKey({ password: PW });
const encode = (value) => new TextEncoder().encode(value);
const signPayload = async (claims) => {
  const payload = __sessionInternals.b64url(encode(JSON.stringify(claims)));
  const sig = __sessionInternals.b64url(
    await nodeCrypto.subtle.sign('HMAC', sessionKey, encode(payload)),
  );
  return { Cookie: `aset_admin=${payload}.${sig}` };
};
const expiredJar = await signPayload({ exp: now - 1 });
roleCheck('kuki yang sudah lupus ditolak',
  (await callAs('GET', '/api/me', undefined, expiredJar, pwEnv)).body.role === 'viewer');
roleCheck('kuki lupus tidak membenarkan tulisan',
  (await callAs('POST', '/api/observations', upload, expiredJar, pwEnv)).status === 401);
const liveJar = await signPayload({ exp: now + 600 });
roleCheck('kuki yang sah tetapi ditandatangan sendiri diterima (bukti kunci betul)',
  (await callAs('GET', '/api/me', undefined, liveJar, pwEnv)).body.role === 'admin');

/* Signing out is the Worker clearing its own cookie. */
const logoutPw = await callAs('POST', '/api/admin/logout', undefined, jar, pwEnv);
roleCheck('log keluar mengalihkan kembali ke halaman',
  logoutPw.status === 302 && logoutPw.location === '/?logout=1',
  `${logoutPw.status} ${logoutPw.location}`);
roleCheck('log keluar membersihkan kuki sesi',
  /aset_admin=;/.test(String(logoutPw.headers.get('set-cookie') || ''))
  && /Max-Age=0/.test(String(logoutPw.headers.get('set-cookie') || '')),
  String(logoutPw.headers.get('set-cookie')));
roleCheck('mod password: /api/me tidak menyenaraikan admin',
  JSON.stringify(mePw.body).includes(ADMIN) === false, JSON.stringify(mePw.body));

/* ---- the admin path: the same handlers behind a prefix Access can protect ---- */
const roleEnv = enforcedEnv();
roleCheck('laluan admin: tulis melalui /api/admin/observations diterima',
  (await callAs('POST', '/api/admin/observations', upload2, {}, trustedEnv)).status === 201);
roleCheck('laluan admin: bacaan juga sampai ke pengendali yang sama',
  (await callAs('GET', '/api/admin/status', undefined, {}, trustedEnv)).status === 200);
roleCheck('laluan admin: /api/admin/login mengubah hala kembali ke halaman',
  (await callAs('GET', '/api/admin/login', undefined, {}, trustedEnv)).status === 302);
roleCheck('laluan admin: /api/admin/logout mengubah hala ke domain Access',
  (await callAs('GET', '/api/admin/logout', undefined, {},
    { ...trustedEnv, ACCESS_TEAM_DOMAIN: 'pks.cloudflareaccess.com' })).location
    === 'https://pks.cloudflareaccess.com/cdn-cgi/access/logout');
roleCheck('laluan admin: tanpa team domain, log keluar kembali ke halaman',
  (await callAs('GET', '/api/admin/logout', undefined, {}, openEnv)).location === '/?logout=1');
roleCheck('laluan admin: /api/admin/me melaporkan laluan log masuk untuk butang halaman',
  (await callAs('GET', '/api/admin/me', undefined, {}, roleEnv)).body.adminLoginPath
    === '/api/admin/login');
roleCheck('mod enforce: accessConfigured benar',
  (await callAs('GET', '/api/me', undefined, {}, roleEnv)).body.accessConfigured === true);
roleCheck('laluan admin: viewer dalam mod enforce tetap ditolak',
  (await callAs('POST', '/api/admin/observations', upload, auth(viewerToken), roleEnv)).status === 403);
roleCheck('laluan admin: tanpa token dalam mod enforce ditolak',
  (await callAs('POST', '/api/admin/observations', upload, {}, roleEnv)).status === 401);

/* ---- "enforce": public reads, admin login for writes ---- */

roleCheck('tanpa token: /api/me ialah viewer',
  (await callAs('GET', '/api/me', undefined, {}, roleEnv)).body.role === 'viewer');
const anonUpload = await callAs('POST', '/api/observations', upload, {}, roleEnv);
roleCheck('tanpa token: muat naik ditolak (401)', anonUpload.status === 401,
  JSON.stringify(anonUpload));
roleCheck('tanpa token: padam ditolak (401)',
  (await callAs('DELETE', '/api/observations/1', undefined, {}, roleEnv)).status === 401);
roleCheck('tanpa token: tetapan Bahagian ditolak (401)',
  (await callAs('POST', '/api/overrides', { overrides: [{ label: 'A', bahagian: 'B' }] }, {}, roleEnv)).status === 401);

const meViewer = await callAs('GET', '/api/me', undefined, auth(viewerToken), roleEnv);
roleCheck('pengguna biasa: peranan viewer', meViewer.body.role === 'viewer', JSON.stringify(meViewer.body));
roleCheck('pengguna biasa: e-mel dilaporkan', meViewer.body.email === VIEWER, meViewer.body.email);
roleCheck('pengguna biasa: writeAllowed palsu', meViewer.body.writeAllowed === false);
roleCheck('pengguna biasa: membaca masih dibenarkan',
  (await callAs('GET', '/api/status', undefined, auth(viewerToken), roleEnv)).status === 200);
roleCheck('pengguna biasa: muat naik ditolak (403)',
  (await callAs('POST', '/api/observations', upload, auth(viewerToken), roleEnv)).status === 403);
roleCheck('pengguna biasa: padam ditolak (403)',
  (await callAs('DELETE', '/api/observations/1', undefined, auth(viewerToken), roleEnv)).status === 403);
roleCheck('pengguna biasa: tetapan Bahagian ditolak (403)',
  (await callAs('POST', '/api/overrides', { overrides: [{ label: 'A', bahagian: 'B' }] }, auth(viewerToken), roleEnv)).status === 403);
roleCheck('pengguna biasa: /api/me tidak mendedahkan senarai admin',
  JSON.stringify(meViewer.body).indexOf(ADMIN) < 0, JSON.stringify(meViewer.body));

const meAdmin = await callAs('GET', '/api/me', undefined, auth(adminToken), roleEnv);
roleCheck('admin: peranan admin', meAdmin.body.role === 'admin', JSON.stringify(meAdmin.body));
roleCheck('admin: muat naik diterima',
  (await callAs('POST', '/api/observations', upload, auth(adminToken), roleEnv)).status === 201);

/* A forged token is the attack this whole section exists to stop. */
roleCheck('token palsu (kunci salah) ditolak',
  (await callAs('POST', '/api/observations', upload, auth(forgedToken), roleEnv)).status === 401);
roleCheck('token lupus ditolak',
  (await callAs('POST', '/api/observations', upload, auth(expiredToken), roleEnv)).status === 401);
roleCheck('token dengan aud salah ditolak',
  (await callAs('POST', '/api/observations', upload, auth(wrongAudToken), roleEnv)).status === 401);
roleCheck('token sampah ditolak',
  (await callAs('POST', '/api/observations', upload, auth('bukan.token.sah'), roleEnv)).status === 401);

/* Cloudflare also sets a cookie, and a browser will send that rather than the header. */
const cookieEnv = enforcedEnv();
roleCheck('token melalui kuki CF_Authorization juga diterima',
  (await callAs('GET', '/api/me', undefined, { Cookie: `CF_Authorization=${adminToken}` }, cookieEnv))
    .body.role === 'admin');

/* Misconfiguration must fail closed AND say what to fix. */
const noAdmins = { ...enforcedEnv(), ADMIN_EMAILS: '' };
const meNoAdmins = await callAs('GET', '/api/me', undefined, auth(adminToken), noAdmins);
roleCheck('ADMIN_EMAILS kosong dilaporkan kepada halaman',
  meNoAdmins.body.adminsConfigured === false, JSON.stringify(meNoAdmins.body));
const blocked = await callAs('POST', '/api/observations', upload, auth(adminToken), noAdmins);
roleCheck('ADMIN_EMAILS kosong: tulis ditolak (fail closed)', blocked.status === 403, String(blocked.status));
roleCheck('ADMIN_EMAILS kosong: mesej menyebut pembetulan',
  /ADMIN_EMAILS/.test(String(blocked.body && blocked.body.error)), JSON.stringify(blocked.body));

globalThis.fetch = realFetch;

console.log('\n' + '='.repeat(60));
console.log(fail === 0
  ? `LULUS - ${pass} pemeriksaan Worker (SQLite sebenar melalui shim D1).`
  : `GAGAL - ${fail} gagal: ${failures.join(', ')}`);
console.log('='.repeat(60));
console.log('\nNOTA: ini menguji logik Worker terhadap SQLite tempatan.');
console.log('D1 sebenar (had, konsistensi, cold start) belum diuji - perlu wrangler deploy.');
process.exit(fail ? 1 : 0);
