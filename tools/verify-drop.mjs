/*
 * verify-drop.mjs - the drop path, in a real browser.
 *
 *   node tools/verify-drop.mjs
 *
 * WHY THIS EXISTS
 * ---------------
 * Everything about a drop is browser behaviour, so nothing in the Node suite can prove it:
 *
 *  1. A drop on the dashed box ALSO bubbles to the window, and both handlers used to load
 *     the files. Every file dropped on the box therefore arrived TWICE - which did not look
 *     like a bug, it looked like the user's own files overlapping ("Kandungan fail yang
 *     sama dikesan"). The count is asserted here, at 3 rather than 4, because that is the
 *     difference.
 *  2. The same file name from two folders must stay two sources. That rule lives in the
 *     merge (src/lib/compute.ts), which Node cannot import - so it is checked against the
 *     rendered per-file tab instead.
 *  3. Two folder PICKS in a row must accumulate. "Tambah folder..." gives one folder per
 *     dialog on Windows (Chromium asks for FOS_PICKFOLDERS and never FOS_ALLOWMULTISELECT),
 *     so picking folder after folder IS the multi-folder route - and if the second pick
 *     replaced the first, that route would silently lose a whole department's export. The
 *     picker is the one intake route no other suite touches, which is exactly why it is
 *     driven here.
 *
 * A synthetic DataTransfer cannot fabricate a directory entry, so the folder WALK itself is
 * covered by tests/run-tests.mjs against fabricated FileSystemEntries. What is left for a
 * browser is the wiring: the event, the route through the intake, and the count.
 *
 * Chrome is required. If it cannot start, the script says so and exits 2 rather than
 * passing quietly.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { APP_FILENAME } from './artifacts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const dist = join(root, 'dist');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chrome) {
  console.error('Chrome/Edge tidak dijumpai. Tetapkan CHROME_PATH untuk menjalankan ujian ini.');
  process.exit(2);
}

const appPath = join(dist, APP_FILENAME);
if (!existsSync(appPath)) {
  console.error(`Artefak binaan tiada: ${appPath}. Jalankan "npm run build" dahulu.`);
  process.exit(2);
}

const appHtml = readFileSync(appPath, 'utf8');

/* ---------- the page under test ------------------------------------------- */

/*
 * The script appends itself AFTER the app, so window.__uiHarness__ already exists. The
 * anchor must be the LAST </body>: the bundle contains its own "</body>" inside an HTML
 * template string and a plain replace() would patch that copy instead.
 */
const bodyAnchor = appHtml.lastIndexOf('</body>');
if (bodyAnchor < 0) {
  console.error('Struktur HTML tidak dijangka - jalankan "npm run build" dahulu.');
  process.exit(2);
}

const harness = `
<pre id="drop-snapshot">pending</pre>
<script>
(function () {
  var H = window.__uiHarness__;
  var out = document.getElementById('drop-snapshot');
  var result = { secure: !!window.isSecureContext };

  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  /*
   * Poll the app's own state instead of sleeping a guessed number of milliseconds. Under
   * Chrome's virtual clock a timer fires long before a real file read finishes, so a fixed
   * wait reports "the drop did nothing" for a drop that is merely still being read.
   */
  async function until(cond, tries) {
    for (var i = 0; i < (tries || 600); i += 1) {
      if (cond()) return true;
      await wait(5);
    }
    return false;
  }

  /* Every drop the page sees, so a failure says which one went missing. */
  var events = [];
  window.addEventListener('drop', function (e) {
    events.push({
      target: e.target && e.target.id ? e.target.id : String(e.target && e.target.tagName),
      items: e.dataTransfer ? e.dataTransfer.items.length : -1,
      files: e.dataTransfer ? e.dataTransfer.files.length : -1,
      count: H.snapshot().perFile.length,
    });
  });

  /* A real JKM-shaped export: an HTML table saved as .xls. */
  function tableHtml(label) {
    return '<html><body><table>'
      + '<tr><td><b>Label</b></td><td><b>Jenis Aset</b></td><td><b>Pegawai Penempatan</b></td>'
      + '<td><b>Bahagian</b></td><td><b>Lokasi Terkini</b></td><td><b>Status Aset</b></td></tr>'
      + '<tr><td>' + label + '</td><td>MESIN UJIAN</td><td>ALI BIN ABU</td>'
      + '<td>JABATAN A</td><td>STOR 1</td><td>Sedang Digunakan</td></tr>'
      + '</table></body></html>';
  }

  function fileOf(label, name) {
    return new File([tableHtml(label)], name, { type: 'text/html' });
  }

  function transferOf(list) {
    var dt = new DataTransfer();
    for (var i = 0; i < list.length; i += 1) dt.items.add(list[i]);
    return dt;
  }

  function dropOn(target, files) {
    target.dispatchEvent(new DragEvent('drop', { dataTransfer: transferOf(files), bubbles: true, cancelable: true }));
  }

  /*
   * A folder PICK, the way the picker button delivers one.
   *
   * input.files is assignable from a DataTransfer's FileList, so the real change handler
   * runs against a real FileList. The files cannot carry webkitRelativePath (only the
   * browser's own folder walk sets that), so a picked file's path falls back to its name -
   * which is what this check asserts, rather than pretending otherwise.
   */
  function folderPick(names, folder) {
    var input = document.getElementById('folderInput');
    var list = [];
    for (var i = 0; i < names.length; i += 1) {
      list.push(fileOf('KPT/PKS/H/' + folder + '/' + (i + 1) + '/' + (i + 1), names[i]));
    }
    try {
      input.files = transferOf(list).files;
    } catch (err) {
      return false;
    }
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function snap() {
    var s = H.snapshot();
    return {
      files: s.perFile.map(function (p) { return { name: p.name, path: p.path, rows: p.rows }; }),
      notices: s.noticeTitles,
      listNames: Array.prototype.slice.call(document.querySelectorAll('#sourceList .filelist li .fname'))
        .map(function (el) { return el.textContent; }),
    };
  }

  function finish(state) {
    result.state = state;
    result.events = events;
    out.textContent = JSON.stringify(result, null, 1);
    document.documentElement.setAttribute('data-drop-verify', state);
  }

  (async function () {
    if (typeof DataTransfer !== 'function') {
      finish('skip');
      return;
    }

    /* 1. The same NAME from two folders, the shape a folder drop produces. */
    H.loadFiles([
      { name: 'Senarai.xls', path: '2026-08/Senarai.xls', text: tableHtml('KPT/PKS/H/1/1') },
      { name: 'Senarai.xls', path: '2026-09/Senarai.xls', text: tableHtml('KPT/PKS/H/2/2') },
    ]);
    result.twoFolders = snap();

    document.querySelector('#tabs button[data-tab="sources"]').click();
    result.sourcesRows = Array.prototype.slice.call(document.querySelectorAll('#sourcesWrap tbody tr'))
      .map(function (tr) { return tr.querySelector('td').textContent; });
    document.querySelector('#tabs button[data-tab="merged"]').click();

    /* 2. A drop on the dashed box: once, not twice. */
    dropOn(document.getElementById('drop'), [fileOf('KPT/PKS/H/3/3', 'drop-1.xls')]);
    result.boxArrived = await until(function () { return H.snapshot().perFile.length === 3; });
    result.dropOnBox = snap();

    /* 3. A drop anywhere else on the page still arrives - it is the same listener. */
    dropOn(document.body, [fileOf('KPT/PKS/H/4/4', 'drop-2.xls')]);
    result.pageArrived = await until(function () { return H.snapshot().perFile.length === 4; });
    result.dropOnPage = snap();

    /* 4. Two folder picks in a row: the second must not replace the first. */
    result.pickable = folderPick(['folder-a.xls'], 'FOLDER-A');
    if (result.pickable) {
      result.pickAArrived = await until(function () { return H.snapshot().perFile.length === 5; });
      result.afterPickA = snap();
      folderPick(['folder-b.xls'], 'FOLDER-B');
      result.pickBArrived = await until(function () { return H.snapshot().perFile.length === 6; });
      result.afterPickB = snap();
    }

    finish('done');
  })().catch(function (err) {
    result.error = String(err && err.message ? err.message : err);
    finish('error');
  });
})();
</script>
`;

mkdirSync(dist, { recursive: true });
const pagePath = join(dist, 'drop-verify.html');
writeFileSync(pagePath, appHtml.slice(0, bodyAnchor) + harness + appHtml.slice(bodyAnchor), 'utf8');

/* ---------- run it -------------------------------------------------------- */

const uri = 'file:///' + pagePath.replace(/\\/g, '/');
const userDataDir = join(process.env.TEMP || '/tmp', 'chrome-drop-verify-' + Date.now());

const run = spawnSync(chrome, [
  '--headless',
  '--disable-gpu',
  '--no-sandbox',
  '--user-data-dir=' + userDataDir,
  '--virtual-time-budget=25000',
  '--dump-dom',
  uri,
], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

if (run.error) {
  console.error('Gagal memulakan Chrome:', run.error.message);
  process.exit(2);
}
if (!run.stdout || run.stdout.length < 1000) {
  console.error('Chrome tidak menghasilkan DOM. stderr:');
  console.error((run.stderr || '').split('\n').slice(0, 10).join('\n'));
  process.exit(2);
}

const dom = run.stdout;
writeFileSync(join(dist, 'drop-verify-dump.html'), dom, 'utf8');

const marker = dom.indexOf('id="drop-snapshot"');
const open = dom.indexOf('>', marker);
const close = dom.indexOf('</pre>', open);
let snapshot = null;
try {
  snapshot = JSON.parse(dom.slice(open + 1, close));
} catch {
  snapshot = null;
}

if (!snapshot) {
  console.error('Snapshot tidak dapat dibaca. Dump: dist/drop-verify-dump.html');
  process.exit(2);
}
if (snapshot.state === 'error') {
  console.error('RALAT dalam halaman:', snapshot.error);
  process.exit(1);
}
if (snapshot.state === 'skip') {
  console.log('DILANGKAU: pelayar ini tidak menyokong DataTransfer - ujian drop tidak dapat dijalankan.');
  process.exit(2);
}

/* ---------- assertions ---------------------------------------------------- */

let problems = 0;
const check = (name, cond, detail) => {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    problems += 1;
    console.error(`  FAIL ${name}${detail ? `  -> ${detail}` : ''}`);
  }
};

console.log('== Drop: satu fail dari dua folder ==');
const two = snapshot.twoFolders;
check('dua sumber dilaporkan', two.files.length === 2, JSON.stringify(two.files));
check('nama fail kedua-duanya sama', two.files.every((f) => f.name === 'Senarai.xls'),
  JSON.stringify(two.files.map((f) => f.name)));
check('path membezakan kedua-duanya',
  two.files[0].path === '2026-08/Senarai.xls' && two.files[1].path === '2026-09/Senarai.xls',
  JSON.stringify(two.files.map((f) => f.path)));
check('senarai fail menunjukkan folder', two.listNames.some((n) => n.indexOf('2026-08/') >= 0)
  && two.listNames.some((n) => n.indexOf('2026-09/') >= 0), JSON.stringify(two.listNames));
check('tab per-fail menunjukkan folder',
  snapshot.sourcesRows.filter((r) => r !== 'JUMLAH').join('|') === '2026-08/Senarai.xls|2026-09/Senarai.xls',
  JSON.stringify(snapshot.sourcesRows));

console.log('== Drop: fail yang dilepaskan di atas kotak ==');
const box = snapshot.dropOnBox;
check('fail baharu tiba', box.files.length === 3, 'files=' + box.files.length);
check('SEKALI sahaja, bukan dua kali',
  box.files.filter((f) => f.name === 'drop-1.xls').length === 1,
  JSON.stringify(box.files.map((f) => f.name)));
check('fail yang dilepaskan itu tiada folder',
  box.files[2].path === '', JSON.stringify(box.files[2]));
check('tiada amaran "kandungan sama" palsu',
  !box.notices.some((n) => n.indexOf('sama dikesan') >= 0), JSON.stringify(box.notices));

console.log('== Drop: fail yang dilepaskan di tempat lain pada halaman ==');
const page = snapshot.dropOnPage;
check('drop di mana-mana masih berfungsi', page.files.length === 4, 'files=' + page.files.length);
check('dan sekali sahaja juga',
  page.files.filter((f) => f.name === 'drop-2.xls').length === 1,
  JSON.stringify(page.files.map((f) => f.name)));

console.log('== Folder: dua pilihan berturut-turut menambah, bukan mengganti ==');
if (!snapshot.pickable) {
  console.log('  DILANGKAU: pelayar ini tidak membenarkan input.files ditetapkan; laluan pemilih folder tidak dapat diuji di sini.');
} else {
  const a = snapshot.afterPickA;
  const b = snapshot.afterPickB;
  check('folder pertama menambah satu sumber',
    snapshot.pickAArrived && a.files.length === 5, 'files=' + a.files.length);
  check('folder kedua menambah, bukan mengganti',
    snapshot.pickBArrived && b.files.length === 6, 'files=' + b.files.length);
  check('fail folder pertama masih ada selepas folder kedua',
    b.files.some((f) => f.name === 'folder-a.xls'), JSON.stringify(b.files.map((f) => f.name)));
  check('fail folder kedua ada',
    b.files.some((f) => f.name === 'folder-b.xls'), JSON.stringify(b.files.map((f) => f.name)));
  check('pilihan folder membawa nama fail sebagai laluan',
    b.files.filter((f) => f.name === 'folder-a.xls').every((f) => f.path === 'folder-a.xls'),
    JSON.stringify(b.files.filter((f) => f.name === 'folder-a.xls')));
  check('senarai fail menunjukkan kedua-dua folder',
    b.listNames.some((n) => n.indexOf('folder-a.xls') >= 0)
      && b.listNames.some((n) => n.indexOf('folder-b.xls') >= 0), JSON.stringify(b.listNames));
}

console.log(`\n${'='.repeat(60)}`);
if (problems) {
  console.error(`GAGAL - ${problems} pemeriksaan. Dump: dist/drop-verify-dump.html`);
  process.exit(1);
}
console.log('LULUS - laluan drop berkelakuan seperti yang dijangkakan.');
console.log('='.repeat(60));
