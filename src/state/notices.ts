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

import type { ActionResult, ManualFigures, Notice, NoticeKind, NoticePart, SourceEntry } from '../types';

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
    [list(failures.map((f) => [bold(f.path || f.name), text(' - '), text(f.parseError || '')]))]);
}

export function identicalFilesNotice(groups: string[][]): Notice {
  return notice('warn', 'Kandungan fail yang sama dikesan', [
    text('Fail berikut mempunyai kandungan yang '), bold('sama tepat'),
    text(' (cap jari SHA-256 sepadan), jadi barisnya akan bertindih sepenuhnya dan digabungkan menjadi satu:'),
    list(groups.map((names) => [text(names.join('  =  '))])),
  ]);
}

/**
 * Files that were inside a folder that was dropped or picked, and were NOT read.
 *
 * A skip that is not reported is indistinguishable from a file that was never in the
 * folder, and the two lead to opposite conclusions about the report.
 */
export function intakeSkipNotice(skipped: { path: string; reason: string }[]): Notice {
  const why: Record<string, string> = {
    unsupported: 'bukan format jadual yang boleh dibaca',
    junk: 'fail sistem atau fail tersembunyi',
    big: 'terlalu besar untuk dibaca',
    deep: 'folder terlalu dalam',
    limit: 'melebihi had bilangan fail',
  };

  const byReason = new Map<string, string[]>();
  skipped.forEach((s) => {
    const key = why[s.reason] ? s.reason : 'unsupported';
    byReason.set(key, (byReason.get(key) || []).concat([s.path]));
  });

  const items: NoticePart[][] = [];
  byReason.forEach((paths, reason) => {
    const shown = paths.slice(0, 3).join(', ') + (paths.length > 3 ? ', ...' : '');
    items.push([bold(paths.length), text(` x ${why[reason]} - contoh: ${shown}`)]);
  });

  return notice('info', `${skipped.length} fail dalam folder dilangkau`,
    [text('Fail berikut ada dalam folder yang dibaca, tetapi tidak digunakan:'), list(items)]);
}

export function parseNotesNotice(withWarnings: SourceEntry[]): Notice {
  return notice('info', 'Nota penghuraian',
    [list(withWarnings.map((f) => [
      bold(f.path || f.name),
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
    text(' direkod sebagai titik masa. Buka halaman ini daripada alamat Worker, kemudian'
      + ' muat naik semula - atau hantar semula dari tab Sejarah Pemeriksaan.')]);

/* -------------------------------------------------------- record-run messages -- */

export function recordRunNotice(res: ActionResult): Notice {
  if (res.ok) {
    const parts = [];
    if (res.runs === 1) {
      parts.push(`Ini titik masa pertama (${res.summary ? res.summary.outstandingFile : 0} aset belum diperiksa).`);
    } else if (res.last) {
      parts.push(res.last.inspected
        ? [bold(res.last.inspected), text(' label hilang daripada senarai terbaharu.')]
        : 'Tiada label hilang daripada senarai terbaharu.');
      if (res.last.added) parts.push([bold(res.last.added), text(' aset baharu.')]);
      parts.push([text('Baki belum diperiksa: '), bold(res.summary ? res.summary.outstandingFile : 0), text('.')]);
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
    [`D1 menolak permintaan itu${res.error ? `: ${res.error}` : ''}. Senarai ini masih boleh digabung dan dieksport.`,
      ' Cuba hantar semula dengan butang "+ Hantar senarai ini ke D1" dalam tab Sejarah Pemeriksaan.']);
}

export function recordRunReport(res: ActionResult): Notice {
  if (res.ok) {
    const parts: NoticePart[] = [`Titik masa ke-${res.runs} disimpan dalam D1. `];
    if (res.last) {
      if (res.last.inspected) {
        parts.push([bold(res.last.inspected), text(' label hilang daripada senarai terbaharu. ')]);
      } else if ((res.runs || 0) > 1) {
        parts.push('Tiada label yang hilang - senarai baharu sama kandungannya. ');
      }
      if (res.last.added) parts.push([bold(res.last.added), text(' aset baharu muncul. ')]);
    }
    if (res.summary) parts.push([text('Baki belum diperiksa: '), bold(res.summary.outstandingFile), text('.')]);
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

/* -------------------------------------------------------- report figures --
 *
 * Why the figures message states the arithmetic, including when it does NOT add up: a
 * report whose three numbers disagree is a real situation (the export and the register are
 * two different things), so it is said out loud rather than smoothed over - an admin who
 * sees 17 + 550 under a total of 600 is told about the 33, not left to notice it.
 */

export function figuresSavedNotice(figures: ManualFigures, fileCount: number): Notice {
  const { totalAssets: t, inspected: i, outstanding: o } = figures;
  const parts: NoticePart[] = [];
  if (t === null && i === null && o === null) {
    return notice('info', 'Angka daftar dibuang',
      ['Total aset, sudah diperiksa dan belum diperiksa kembali kosong pada kad. Salin semula daripada ringkasan Sistem Pengurusan Aset Alih apabila sedia.']);
  }
  /* The register's own arithmetic first: all three numbers come from ONE ringkasan, so a
     difference between them is a slip of the pen, not a disagreement between two sources. */
  if (t !== null && i !== null && o !== null) {
    const sum = i + o;
    if (sum === t) {
      parts.push([text('Angka daftar sepadan: '), bold(i), text(' sudah + '), bold(o),
        text(' belum = '), bold(t), text('. ')]);
    } else {
      parts.push([text('Angka daftar tidak sepadan: '), bold(i), text(' sudah + '), bold(o),
        text(' belum = '), bold(sum), text(', bukan '), bold(t), text(' - beza '),
        bold(Math.abs(t - sum)), text(' aset. Semak semula angka yang disalin. ')]);
    }
  } else {
    const missing = [
      t === null ? 'Total aset' : null,
      i === null ? 'Sudah diperiksa' : null,
      o === null ? 'Belum diperiksa' : null,
    ].filter(Boolean);
    parts.push([text(`${missing.join(', ')} masih kosong - kad itu menunjukkan "-". `)]);
  }
  /* Then the comparison the register figure exists for: SPAA against the uploaded file. */
  if (o !== null) {
    const gap = o - fileCount;
    parts.push(gap === 0
      ? [text('Fail terakhir menyenaraikan '), bold(fileCount),
        text(' aset - sama dengan angka SPAA.')]
      : [text('Fail terakhir menyenaraikan '), bold(fileCount), text(' aset, '),
        bold(Math.abs(gap)), text(gap > 0
          ? ' kurang daripada angka SPAA - semak sama ada fail itu senarai penuh (semua bahagian, semua helaian).'
          : ' lebih daripada angka SPAA - semak sama ada angka itu sudah basi.')]);
  }
  return notice('ok', 'Angka daftar dikemas kini', parts);
}

export const figuresFailedNotice = (error?: string): Notice => notice('bad', 'Angka tidak dapat disimpan',
  [`D1 menolak perubahan itu${error ? `: ${error}` : ''}.`]);

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
    'Ini yang dilihat oleh pengguna biasa: tab Senarai Semasa dan Ringkasan Bahagian sahaja. Sejarah Pemeriksaan ialah alat admin - angka daftar, pergerakan antara muat naik dan butang padam semuanya di sana - jadi tiada padam, tiada muat naik dan tiada tab itu untuk pembaca.'])
  : notice('info', 'Kembali ke mod admin', ['Semua tindakan admin dipulihkan.']));

export const loginOkNotice = (email?: string): Notice => notice('ok', 'Log masuk berjaya',
  [email
    ? `Anda kini admin${` (${email})`}. Muat naik, padam titik masa dan tetapan Bahagian dibenarkan.`
    : 'Anda kini admin. Muat naik, padam titik masa dan tetapan Bahagian dibenarkan.']);

export const logoutNotice = (): Notice => notice('info', 'Log keluar',
  ['Sesi admin ditamatkan. Halaman ini kembali kepada paparan awam.']);
