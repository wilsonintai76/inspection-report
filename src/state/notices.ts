/*
 * notices.js - the messages the page shows, as data.
 *
 * The old page built these as HTML strings and assigned them with innerHTML. Everything
 * in this application mentions a file name, a label or a department, and all of those
 * come from an uploaded export - so every interpolation was one forgotten escape away
 * from injecting markup into the page. Here a notice is a small tree of fragments and
 * React escapes every value on the way out; there is no string-to-HTML path at all.
 *
 *   { kind: 'warn' | 'info' | 'ok' | 'bad', title, parts: [fragment] }
 */

import type { ActionResult, Notice, NoticeKind, NoticePart, SourceEntry } from '../types';

export const text = (v: string | number): NoticePart => ({ t: 'text', v: String(v) });
export const bold = (v: string | number): NoticePart => ({ t: 'b', v: String(v) });
export const mono = (v: string | number): NoticePart => ({ t: 'mono', v: String(v) });
/** items: one array of fragments per bullet. */
export const list = (items: NoticePart[][]): NoticePart => ({ t: 'ul', items });

export const notice = (kind: NoticeKind, title: string, parts: NoticePart[] = []): Notice => ({
  kind,
  title,
  parts: Array.isArray(parts) ? parts : [parts],
});

/* ------------------------------------------------------- merge-time messages -- */

export function parseFailureNotice(failures: SourceEntry[]): Notice {
  return notice('bad', `${failures.length} fail tidak dapat dibaca`,
    [list(failures.map((f) => [bold(f.name), text(' - '), text(f.parseError || '')]))]);
}

export function identicalFilesNotice(groups: string[][]): Notice {
  return notice('warn', 'Kandungan fail yang sama dikesan', [
    text('Fail berikut mempunyai kandungan yang '), bold('sama tepat'),
    text(' (cap jari SHA-256 sepadan), jadi barisnya akan bertindih sepenuhnya dan digabungkan menjadi satu:'),
    list(groups.map((names) => [text(names.join('  =  '))])),
  ]);
}

export function parseNotesNotice(withWarnings: SourceEntry[]): Notice {
  return notice('info', 'Nota penghuraian',
    [list(withWarnings.map((f) => [
      bold(f.name),
      list((f.warnings || []).map((w) => [text(w)])),
    ]))]);
}

export function conflictsNotice(count: number): Notice {
  return notice('bad', `${count} label dengan data bercanggah`,
    [text('Label aset yang sama muncul dengan butiran berbeza. Lihat tab '), bold('Konflik Data'),
      text(' sebelum menggunakan hasil ini.')]);
}

export const doneNotice = (fileCount: number, recordCount: number): Notice => notice('ok', 'Selesai',
  [`${fileCount} fail dibaca, ${recordCount} rekod unik terhasil.`]);

export const offlineRunNotice = (): Notice => notice('warn', 'Tidak dihantar ke D1',
  [text('Tiada sambungan, jadi muat naik ini '), bold('tidak'),
    text(' direkod sebagai titik masa. Buka halaman ini daripada alamat Worker, kemudian muat naik semula.')]);

/* -------------------------------------------------------- record-run messages -- */

export function recordRunNotice(res: ActionResult): Notice {
  if (res.ok) {
    const parts = [];
    if (res.runs === 1) {
      parts.push(`Ini titik masa pertama (${res.summary ? res.summary.outstanding : 0} aset belum diperiksa).`);
    } else if (res.last) {
      parts.push(res.last.inspected
        ? [bold(res.last.inspected), text(' aset hilang -> dianggap '), bold('sudah diperiksa'), text('.')]
        : 'Tiada aset hilang sejak titik masa lepas.');
      if (res.last.added) parts.push([bold(res.last.added), text(' aset baharu.')]);
      parts.push([text('Baki belum diperiksa: '), bold(res.summary ? res.summary.outstanding : 0), text('.')]);
    }
    return notice('ok', `Titik masa ke-${res.runs} disimpan dalam D1`, parts);
  }
  if (res.reason === 'duplicate') {
    return notice('info', 'Senarai sama seperti titik masa terakhir',
      ['D1 sudah menyimpan senarai ini tepat, jadi tiada titik masa baharu dicipta.']);
  }
  if (res.reason === 'empty') {
    return notice('info', 'Tiada data', ['Muatkan fail senarai terlebih dahulu.']);
  }
  return notice('bad', 'Muat naik tidak dapat disimpan',
    [`D1 menolak permintaan itu${res.error ? `: ${res.error}` : ''}. Senarai ini masih boleh digabung dan dieksport.`]);
}

export function recordRunReport(res: ActionResult): Notice {
  if (res.ok) {
    const parts: NoticePart[] = [`Titik masa ke-${res.runs} disimpan dalam D1. `];
    if (res.last) {
      if (res.last.inspected) {
        parts.push([bold(res.last.inspected), text(' aset hilang daripada senarai, jadi dianggap '),
          bold('sudah diperiksa'), text('. ')]);
      } else if ((res.runs || 0) > 1) {
        parts.push('Tiada aset yang hilang - tiada pemeriksaan baharu dikesan. ');
      }
      if (res.last.added) parts.push([bold(res.last.added), text(' aset baharu muncul. ')]);
    }
    if (res.summary) parts.push([text('Baki belum diperiksa: '), bold(res.summary.outstanding), text('.')]);
    return notice('ok', 'Pemeriksaan disimpan', parts);
  }
  if (res.reason === 'empty') return notice('info', 'Tiada data', ['Muatkan fail senarai terlebih dahulu.']);
  if (res.reason === 'duplicate') {
    return notice('info', 'Sudah ada dalam D1',
      [`Senarai ini sama tepat dengan titik masa terakhir (${String(res.at || '').slice(0, 16).replace('T', ' ')}). Tiada perubahan untuk disimpan.`]);
  }
  if (res.reason === 'offline') {
    return notice('warn', 'Tiada sambungan D1', ['Rekod hanya boleh disimpan melalui alamat Worker.']);
  }
  return notice('bad', 'Tidak dapat disimpan', [`D1 menolak permintaan itu${res.error ? `: ${res.error}` : ''}.`]);
}

/* ------------------------------------------------------------ write messages -- */

export const overrideRejectedNotice = (error?: string): Notice => notice('warn', 'Tetapan tidak dapat disimpan',
  [`D1 menolak tetapan itu${error ? `: ${error}` : ''}.`]);

export const overrideOfflineNotice = (): Notice => notice('warn', 'Tetapan tidak dapat disimpan',
  ['Tiada sambungan D1, jadi tetapan manual tidak tersedia di sini.']);

export const overrideSetNotice = (label: string, bahagian: string, left: number): Notice => notice('ok', 'Bahagian ditetapkan',
  [bold(label), text(' -> '), bold(bahagian), text('. '),
    left ? `${left} rekod lagi perlu ditetapkan.` : 'Semua rekod kini mempunyai Bahagian.']);

export const overrideClearedNotice = (): Notice => notice('info', 'Tetapan dibatalkan', ['Rekod itu kembali kosong.']);

export const allOverridesClearedNotice = (n: number): Notice => notice('info', 'Semua tetapan manual dipadam',
  [`${n} tetapan dibuang daripada D1. Rekod kembali kepada nilai dalam fail.`]);

export const supersededDroppedNotice = (): Notice => notice('info', 'Tetapan yang diatasi dibuang',
  ['Rekod itu kini menggunakan nilai daripada fail sumber.']);

export const reloadOkNotice = (what: string): Notice => notice('ok', 'Dimuat semula', [what]);

export const reloadFailNotice = (error?: string): Notice => notice('warn', 'Gagal dimuat semula',
  [`Sambungan D1 tidak dapat dihubungi${error ? `: ${error}` : ''}.`]);

export const deleteRunNotice = (res: ActionResult): Notice => (res.ok
  ? notice('info', 'Titik masa dipadam', [`${res.runs} titik masa tinggal dalam D1.`])
  : notice('warn', 'Tidak dapat dipadam', [res.reason === 'offline' ? 'Tiada sambungan D1.' : 'D1 menolak permintaan itu.']));

/**
 * The one destructive action, reported with its numbers.
 *
 * "Reset" used to be a question the user asked; the answer is that the timeline IS the
 * report, so after this the next upload starts as the first point again. Saying so in the
 * message is the difference between a feature and a trap.
 */
export const purgeNotice = (res: ActionResult): Notice => notice(
  res.ok ? 'info' : 'warn',
  res.ok ? 'Semua titik masa dipadam' : 'Tidak dapat dipadam',
  [res.ok
    ? `${res.runs || 0} titik masa dan ${res.assets || 0} rekod aset dibuang. Senarai sekarang kosong, jadi muat naik seterusnya menjadi titik masa PERTAMA - tiada perbandingan lagi, dan setiap aset dikira belum diperiksa. Tetapan Bahagian manual tidak diubah.`
    : (res.reason === 'offline' ? 'Tiada sambungan D1.' : 'D1 menolak permintaan itu.')],
);

export const historyCsvNotice = (): Notice => notice('ok', 'Eksport diminta',
  ['Fail CSV dijana daripada rekod dalam D1 (sejarah penuh, satu baris per label).']);

export const historyCsvOfflineNotice = (): Notice => notice('warn', 'Tiada sambungan D1',
  ['Eksport sejarah dibina oleh Worker daripada rekod dalam D1.']);

export const previewNotice = (on: boolean): Notice => (on
  ? notice('info', 'Pratonton viewer', [
    'Ini yang dilihat oleh pengguna biasa: tab Senarai Semasa, Ringkasan Bahagian dan Sejarah Pemeriksaan sahaja. Tiada muat naik, tiada padam, tiada tetapan Bahagian.'])
  : notice('info', 'Kembali ke mod admin', ['Semua tindakan admin dipulihkan.']));

export const loginOkNotice = (email?: string): Notice => notice('ok', 'Log masuk berjaya',
  [email
    ? `Anda kini admin${` (${email})`}. Muat naik, padam titik masa dan tetapan Bahagian dibenarkan.`
    : 'Anda kini admin. Muat naik, padam titik masa dan tetapan Bahagian dibenarkan.']);

export const logoutNotice = (): Notice => notice('info', 'Log keluar',
  ['Sesi admin ditamatkan. Halaman ini kembali kepada paparan awam.']);
