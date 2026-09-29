/*
 * synthetic-data.mjs - build asset-list exports at the size and shape of the
 * real reports, without using any real data.
 *
 * The ABR report holds about 473 asset labels and the HM report about 63, and
 * the two overlap to an unknown degree. This module reproduces that shape,
 * including the malformed markup of the real exports, so the pipeline can be
 * exercised at full size.
 */
import { FIELDS } from '../src/parser.mjs';

const DEPARTMENTS = [
  'JABATAN KEJURUTERAAN MEKANIKAL',
  'JABATAN KEJURUTERAAN ELEKTRIK',
  'JABATAN KEJURUTERAAN AWAM',
  'JABATAN PERDAGANGAN',
  'UNIT LATIHAN & PENDIDIKAN LANJUTAN',
  'JABATAN TEKNOLOGI MAKLUMAT',
];

const LOCATIONS = [
  'BENGKEL LOJI', 'BENGKEL SHEETMETAL', 'BENGKEL GEGAS', 'BENGKEL SAINS BAHAN',
  'STOR 1', 'STOR 2', 'Autotronic lab', 'MAKMAL TROUBLESHOOTING & MAINTENANCE',
  'MAKMAL KOMPUTER 1', 'MAKMAL KOMPUTER 2',
];

const OFFICERS = [
  'THANDAYUTHAPANI A/L SEPERAMANIAM', 'NORPARINA BINTI SULIMAN', "MOHD FITRI BIN SAFE'I",
  'SYARIZAL BIN BAKRI', 'ALIFF BIN AB TAHIR', 'WEE CHIAU YEN',
  'ZAINAL ABIDDIN BIN AHMAD', 'SITI NURHALIZA BINTI OSMAN',
];

const TYPES = [
  'AIR COMPRESSOR MACHINE', 'BENDING MACHINE', 'CUTTING MACHINE', 'WELDING MACHINE',
  'BASIC HYDRAULIC BENCH', 'DIGITAL PRESSURE METER', 'DISTANCE MEASURING INSTRUMENT',
  'SURFACE PLATE/PARALLEL BLOCK', 'LATHE MACHINE', 'MILLING MACHINE',
  'ALAT HAWA DINGIN UNIT BERASINGAN (ASET TAK ALIH)', 'SYSTEM DIAGNOSTIC TOOL',
];

// Kept only to fill the source's trailing "Status Aset" column, which this app
// no longer tracks but must still read past. See makeHtml().
const STATUSES = ['Sedang Digunakan', 'Sedang Diselenggara', 'Tidak Digunakan'];

/** Deterministic pseudo-random so every run produces the same data. */
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeRecord(rng, index, prefix) {
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  return {
    Label: `KPT/PKS/${prefix}/${String(80 + (index % 20)).padStart(2, '0')}/${String(index + 1).padStart(3, '0')}`,
    'Jenis Aset': pick(TYPES),
    'Pegawai Penempatan': pick(OFFICERS),
    Bahagian: pick(DEPARTMENTS),
    'Lokasi Terkini': pick(LOCATIONS),
  };
}

/**
 * Render records as the source system does: an .xls file that is really an HTML
 * table, with unclosed <tr> tags and the header sharing a row with the first
 * data row.
 *
 * `extraColumns` reproduces the source's trailing "Status Aset" column, which
 * this app no longer tracks. It defaults to ON so the fixtures keep exercising
 * the read-past-an-untracked-column path that the real files require.
 */
export function makeHtml(records, options = {}) {
  const extra = options.extraColumns === false ? [] : ['Status Aset'];
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const header = FIELDS.concat(extra).map((f) => `<td><b>${f}</b></td>`).join('');
  const body = records.map((r, i) => {
    const cells = FIELDS.map((f) => `<td style="mso-number-format:\\@">${esc(r[f])}</td>`)
      .concat(extra.map(() => '<td style="mso-number-format:\\@">Sedang Digunakan</td>'))
      .join('\n');
    return i === 0 ? `${cells}\n</tr>` : `<tr>\n${cells}\n</tr>`;
  }).join('\n');
  return '\r\n\r\n<script type="text/javascript">\nfunction NewWindow(){}\n</script>\r\n'
    + '<table width="100%" cellpadding="0" cellspacing="0" border="1">\r\n<tr>\r\n'
    + `${header}\n${body}\r\n</table>\r\n`;
}

/**
 * Build a pair of reports.
 * @param {{abr?: number, hm?: number, overlap?: number, seedA?: number, seedH?: number}} options
 * @returns {{abrText: string, hmText: string, abrRecords: Array, hmRecords: Array,
 *            sharedCount: number, hmOwnRecords: Array}}
 */
export function buildReports(options = {}) {
  const abr = options.abr ?? 473;
  const hm = options.hm ?? 63;
  const seedA = options.seedA ?? 20260929;
  const seedH = options.seedH ?? 777;

  const rngA = makeRng(seedA);
  const abrRecords = [];
  for (let i = 0; i < abr; i += 1) abrRecords.push(makeRecord(rngA, i, 'H'));

  // `overlap` is how many HM labels also appear in ABR. The real value is
  // unknown, so it is an explicit input rather than a guess.
  const sharedCount = Math.max(0, Math.min(options.overlap ?? 40, hm, abr));
  const shared = abrRecords.slice(0, sharedCount).map((r) => ({ ...r }));

  const rngH = makeRng(seedH);
  const hmOwnRecords = [];
  for (let i = 0; i < hm - sharedCount; i += 1) hmOwnRecords.push(makeRecord(rngH, i, 'M'));

  const hmRecords = [...shared, ...hmOwnRecords];

  return {
    abrText: makeHtml(abrRecords),
    hmText: makeHtml(hmRecords),
    abrRecords,
    hmRecords,
    hmOwnRecords,
    sharedCount,
  };
}
