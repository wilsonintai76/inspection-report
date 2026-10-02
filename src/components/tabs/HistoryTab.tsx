/*
 * HistoryTab.tsx - what D1 remembers: the points in time, the movement between them, and
 * the assets still outstanding.
 *
 * Three tables, in that order, and the order is the story: what changed since last time,
 * when each list was uploaded, and what is still waiting. tools/verify-history.mjs reads
 * them positionally because of it.
 *
 * The cards above them carry the report's headline figures, and two of those - total aset
 * and sudah diperiksa - may have been written by hand (see FiguresDialog): the register is
 * the authority, and an export that disagrees with it should not silently decide what the
 * report says. "Belum diperiksa" is never one of them: it is a fact about the current list.
 */
import { useState } from 'react';
import { useApp } from '../../state/AppProvider';
import * as msg from '../../state/notices';
import { historyView, NO_DEPT, registerCards, stamp } from '../../lib/compute';
import { Cards, Empty, Spacer, Toolbar } from '../ui';
import ConfirmDialog from '../ConfirmDialog';
import FiguresDialog from '../FiguresDialog';
import type { DeptProgress, HistoryRow } from '../../types';

/* ------------------------------------------------------------------ history -- */

export function HistoryTab({ isViewer }: { isViewer: boolean }) {
  const { state, api } = useApp();
  const h = historyView({ status: state.d1.status, progress: state.d1.progress });
  /* The destructive action lives behind this flag, and the question it asks names the
     numbers: "padam semua" without them is not a confirmation, it is a dare. */
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [figuresOpen, setFiguresOpen] = useState(false);
  const runs = h ? h.summary.runs : (state.d1.status ? state.d1.status.observations : 0);
  const assets = state.d1.status ? state.d1.status.assets : 0;

  const purge = async () => {
    setPurgeOpen(false);
    api.pushNotice(msg.purgeNotice(await api.purgeRuns()));
  };

  const csv = () => {
    if (!state.d1.up) {
      api.pushNotice(msg.historyCsvOfflineNotice());
      return;
    }
    // The file is built by the Worker from the stored records, so what you get is exactly
    // what D1 holds - not a re-derivation from whatever is on screen.
    const a = document.createElement('a');
    a.href = api.fetchHistoryCsvUrl();
    a.download = `Sejarah_Pemeriksaan_Aset_PKS_${stamp()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    api.pushNotice(msg.historyCsvNotice());
  };

  const send = async () => {
    api.pushNotice(msg.recordRunReport(await api.recordRun('')));
  };

  /* Reading is public, so re-reading is public. (This tab is the admin's view, but a
     reader can open it too, and hiding a refresh from them would be silly.) */
  const reload = async () => {
    const ok = await api.refresh(true);
    api.pushNotice(ok
      ? msg.reloadOkNotice('Sejarah dan tetapan dibaca semula daripada D1.')
      : msg.reloadFailNotice(state.d1.lastError));
  };

  const remove = async (id: number | string) => {
    api.pushNotice(msg.deleteRunNotice(await api.deleteRun(id)));
  };

  const lastRun = h && h.runs.length ? h.runs[h.runs.length - 1] : null;
  /* The register's three figures: copied in by hand, so they may not be there yet. Nothing
     invents them - a card that shows a number the register never said is worse than a card
     that admits it does not know. */
  const regTotal = h ? h.summary.total : null;
  const regInspected = h ? h.summary.resolved : null;
  const regOutstanding = h ? h.summary.outstanding : null;
  const fileCount = h ? h.summary.outstandingFile : 0;
  const registerSet = regTotal !== null && regInspected !== null && regOutstanding !== null;
  /* Whether the register's three figures agree with EACH OTHER. They should: all three are
     copied from the same ringkasan, so a difference means a typo - unlike the comparison
     with the file below, which is a real difference between two sources. */
  const gap = registerSet
    ? ((regInspected as number) + (regOutstanding as number)) - (regTotal as number)
    : 0;
  /* The register against the newest file: the number that catches a half-complete export.
     Positive = the register expects more assets than the file listed. */
  const fileGap = regOutstanding === null ? 0 : regOutstanding - fileCount;
  const progressRows: DeptProgress[] = lastRun ? (lastRun.deptProgress || []) : [];
  const totals = progressRows.reduce((a, p) => ({
    awal: a.awal + p.awal,
    inspected: a.inspected + p.inspected,
    added: a.added + p.added,
    akhir: a.akhir + p.akhir,
  }), { awal: 0, inspected: 0, added: 0, akhir: 0 });
  const totalPct = totals.awal ? ((totals.inspected * 100) / totals.awal).toFixed(0) : '0';

  const outstandingRows: HistoryRow[] = (h ? state.d1.history : [])
    .filter((t) => t.Status === 'Belum diperiksa')
    .sort((a, b) => {
      const seen = Number(b['Kali Dilihat'] || 0) - Number(a['Kali Dilihat'] || 0);
      if (seen !== 0) return seen;
      return String(a.Label).localeCompare(String(b.Label), 'ms', { numeric: true });
    });

  /*
   * The card is the question "what is still outstanding?"; pressing it must answer with
   * the list, not leave the number as a dead end - and it must answer with the SAME list
   * the number counted, so any filter left over from an earlier drill-in is cleared.
   *
   * Where that list lives depends on the role. A viewer's own list IS the outstanding one
   * ("Senarai Semasa" reads the newest snapshot from D1), so the card takes them there. An
   * admin's merged tab is their own upload, not D1, so sending them there would show the
   * wrong rows; for them the card moves to the outstanding table on this tab instead.
   */
  const openOutstanding = () => {
    if (isViewer) {
      api.resetFilters();
      api.setTab('merged');
      return;
    }
    const list = document.getElementById('outstandingWrap');
    if (!list) return;
    list.scrollIntoView({ behavior: 'smooth', block: 'start' });
    list.focus({ preventScroll: true });
  };

  return (
    <div id="tab-history" hidden={state.tab !== 'history'}>
      <Toolbar>
        <span className="note">
          Setiap muat naik disimpan sebagai satu titik masa. Halaman ini memerhati satu
          perkara sahaja: label yang <b>hilang</b> daripada senarai terbaharu. Angka{' '}
          <b>belum diperiksa</b>, <b>sudah diperiksa</b> dan <b>total aset</b> pada kad ialah
          angka daftar yang disalin oleh admin - angka belum diperiksa itulah rujukan untuk
          menyemak setiap muat naik.
        </span>
        <Spacer />
        {/* The normal path needs no button: a drop or a file picker sends the upload to D1
            by itself. This is the retry, for the uploads that could not be sent - offline at
            the time, or refused - so it says so instead of looking like the usual way. */}
        <button
          type="button"
          className="primary"
          id="btnRecordRun"
          hidden={isViewer}
          onClick={send}
          title="Muat naik dihantar ke D1 secara automatik. Butang ini untuk menghantar semula senarai yang sedang dipaparkan."
        >
          {'+ Hantar senarai ini ke D1'}
        </button>
        <button type="button" id="btnHistRefresh" onClick={reload}>{'\u21BB'} Muat semula</button>
        <button type="button" id="btnHistCsv" onClick={csv}>{'\u2B07'} Eksport sejarah (CSV)</button>
        {/* The figures are the report's own numbers, so only an admin may change them - and
            only once the report exists, since they qualify it. */}
        {isViewer || !lastRun ? null : (
          <button type="button" id="btnFigures" onClick={() => setFiguresOpen(true)}>
            {'\u270E'} Kemas kini angka
          </button>
        )}        {/* Admin only, and never a silent action: clearing the timeline removes the very
            thing the report compares against, so it asks first and says what it costs. */}
        {isViewer ? null : (
          <button type="button" id="btnPurgeRuns" hidden={!runs} onClick={() => setPurgeOpen(true)}>
            {'\u{1F5D1}'} Padam semua titik masa
          </button>
        )}
      </Toolbar>

      <div id="historyWrap">
        {!state.d1.up ? (
          <Empty>
            Sambungan D1 diperlukan. Sejarah pemeriksaan disimpan dalam pangkalan data,
            bukan dalam pelayar, jadi ia hanya boleh dibaca melalui alamat Worker.
          </Empty>
        ) : !h || !lastRun ? (
          <Empty>
            Belum ada titik masa dalam D1. Muatkan senarai di Langkah 1 - muat naik itu
            sendiri menjadi titik masa pertama.
            <br /><br />
            Selepas itu, setiap muat naik baharu akan dibandingkan dengan yang sebelumnya:
            label yang hilang daripada senarai terbaharu dilihat dalam jadual di bawah.
            Angka <b>belum diperiksa</b> pada kad ialah angka daftar yang ditetapkan oleh
            admin; kiraan fail pula datang daripada senarai yang dimuat naik.
          </Empty>
        ) : (
          <>
            <Cards
              style={{ padding: '16px 16px 0' }}
              items={[
                { k: 'Titik masa direkod', v: h.summary.runs },
                ...registerCards(h, { admin: true, onOutstanding: openOutstanding }),
              ]}
            />
            <div className="note" style={{ padding: '10px 16px 0' }}>
              Tempoh: <b>{String(h.summary.first).slice(0, 10)}</b> hingga{' '}
              <b>{String(h.summary.last).slice(0, 10)}</b> &middot; disimpan dalam D1,
              dikongsi oleh semua pengguna
              {registerSet
                ? <> &middot; <b>Total aset</b>, <b>Sudah diperiksa</b> dan <b>Belum diperiksa</b> disalin daripada ringkasan Sistem Pengurusan Aset Alih</>
                : null}
            </div>

            {/* Three different complaints, and all are real: the report is INCOMPLETE until
                the register's figures are copied in; the register's own three figures may
                disagree with each other (a typo - they come from ONE ringkasan); and the
                register may disagree with the FILE, which is not a typo at all but the
                difference between what the office holds and what the last export listed. */}
            {!registerSet ? (
              <div className="notice warn" id="figuresMissing" style={{ margin: '10px 16px 0' }}>
                <strong>Angka daftar belum ditetapkan</strong>
                {isViewer
                  ? <>Total aset, sudah diperiksa dan belum diperiksa mesti disalin daripada
                    ringkasan <b>Sistem Pengurusan Aset Alih</b>. Maklumkan kepada admin supaya
                    ia disetkan.</>
                  : <>Salin <b>Total aset</b>, <b>Sudah diperiksa</b> dan <b>Belum diperiksa</b>{' '}
                    daripada ringkasan <b>Sistem Pengurusan Aset Alih</b>, kemudian tekan{' '}
                    <b>Kemas kini angka</b>. Angka <b>belum diperiksa</b> itu menjadi rujukan
                    untuk menyemak setiap muat naik.</>}
              </div>
            ) : null}

            {gap ? (
              <div className="notice warn" id="figuresMismatch" style={{ margin: '10px 16px 0' }}>
                <strong>{`Angka daftar tidak sepadan: beza ${Math.abs(gap)} aset`}</strong>
                {`${regInspected} sudah diperiksa + ${regOutstanding} belum diperiksa = `}
                {`${(regInspected as number) + (regOutstanding as number)}, tetapi total aset ialah ${regTotal}. `}
                {'Ketiga-tiga angka ini datang daripada ringkasan yang sama, jadi beza ini bermakna salah satu angka tersalah salin - semak semula sebelum laporan ini dikeluarkan.'}
              </div>
            ) : null}

            {/* The double check the whole feature exists for: SPAA against the uploaded
                file. A warning, never a refusal - a partial upload is a legitimate thing to
                record - but the gap is stated in plain numbers so it cannot pass unnoticed. */}
            {fileGap ? (
              <div className="notice warn" id="figuresFileGap" style={{ margin: '10px 16px 0' }}>
                <strong>{`Angka SPAA berbeza dengan fail: beza ${Math.abs(fileGap)} aset`}</strong>
                {fileGap > 0
                  ? <>{`SPAA kata ${regOutstanding} aset masih belum diperiksa, tetapi fail terakhir menyenaraikan ${fileCount}. `}
                    {'Kemungkinan fail yang dimuat naik itu <b>bukan senarai penuh</b> - semak sama ada semua bahagian dan semua helaian sudah dieksport - atau angka SPAA perlu dikemas kini.'}</>
                  : <>{`Fail terakhir menyenaraikan ${fileCount} aset, lebih banyak daripada ${regOutstanding} yang dikatakan SPAA. `}
                    {'Kemungkinan angka SPAA sudah basi, atau fail mengandungi aset yang sudah diperiksa.'}</>}
              </div>
            ) : null}

            {/* 1. per-department progress since the previous run, grouped by the department
                each asset belongs to in the NEW list. */}
            {progressRows.length && h.runs.length >= 2 ? (
              <>
                <h3 className="section-title">
                  {`Perubahan sejak muat naik terakhir (${String(lastRun.prevAt).slice(0, 10)} \u2192 ${String(lastRun.at).slice(0, 10)})`}
                </h3>
                <div className="table-scroll" style={{ maxHeight: '40vh' }}>
                  <table className="data-grid">
                    <thead>
                      <tr>
                        <th>Bahagian</th>
                        <th className="num">Awal</th>
                        <th className="num">Hilang</th>
                        <th className="num">Baharu</th>
                        <th className="num">Akhir</th>
                        <th className="num">% hilang</th>
                      </tr>
                    </thead>
                    <tbody>
                      {progressRows.map((p) => (
                        <tr key={p.bahagian} className={p.bahagian === NO_DEPT ? 'row-warn' : undefined}>
                          <td><b>{p.bahagian}</b></td>
                          <td className="num">{p.awal}</td>
                          <td className="num cell-warn">{p.inspected || ''}</td>
                          <td className="num">{p.added || ''}</td>
                          <td className="num">{p.akhir}</td>
                          <td className="num"><b>{`${(p.awal ? (p.inspected * 100) / p.awal : 0).toFixed(0)}%`}</b></td>
                        </tr>
                      ))}
                      <tr style={{ fontWeight: 700, background: 'var(--color-head)' }}>
                        <td>JUMLAH</td>
                        <td className="num">{totals.awal}</td>
                        <td className="num">{totals.inspected}</td>
                        <td className="num">{totals.added}</td>
                        <td className="num">{totals.akhir}</td>
                        <td className="num">{`${totalPct}%`}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </>
            ) : h.runs.length === 1 ? (
              <div className="note" style={{ padding: 16 }}>
                Ini titik masa pertama. Perubahan akan muncul selepas muat naik yang seterusnya.
              </div>
            ) : null}

            {/* 2. the recorded points in time */}
            <h3 className="section-title">Titik masa direkod</h3>
            <div className="table-scroll" style={{ maxHeight: '34vh' }}>
              <table className="data-grid">
                <thead>
                  <tr>
                    <th>Tarikh</th>
                    <th className="num">Jumlah</th>
                    <th className="num">Hilang</th>
                    <th className="num">Baharu</th>
                    <th className="no-print" />
                  </tr>
                </thead>
                <tbody>
                  {h.runs.slice().reverse().map((r) => (
                    <tr key={r.id}>
                      <td className="mono">{String(r.at).slice(0, 16).replace('T', ' ')}</td>
                      <td className="num">{r.total}</td>
                      <td className="num cell-warn">{r.inspected || ''}</td>
                      <td className="num">{r.added || ''}</td>
                      <td className="no-print">
                        {/* Deleting a point in the timeline changes what everybody sees, so
                            it stays with the admin - the Worker refuses it for anyone else
                            regardless. */}
                        {isViewer ? null : (
                          <button type="button" className="tiny" data-delrun={r.id} onClick={() => remove(r.id)}>
                            Padam
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 3. the assets still outstanding, longest-waiting first. This is the list the
                "Aset belum diperiksa" card opens, which is why it is the element that
                receives focus when that card is pressed. */}
            <h3 className="section-title">{`Aset masih belum diperiksa (${outstandingRows.length})`}</h3>
            <div className="table-scroll" id="outstandingWrap" tabIndex={-1} style={{ maxHeight: '44vh' }}>
              <table className="data-grid">
                <thead>
                  <tr>
                    <th>Label</th>
                    <th>Jenis Aset</th>
                    <th>Bahagian</th>
                    <th>Lokasi Terkini</th>
                    <th>Dilihat pertama</th>
                    <th className="num">Kali dilihat</th>
                  </tr>
                </thead>
                <tbody>
                  {outstandingRows.slice(0, 300).map((t) => (
                    <tr key={t.Label}>
                      <td className="mono">{t.Label}</td>
                      <td>{t['Jenis Aset'] || ''}</td>
                      <td>{t.Bahagian || ''}</td>
                      <td>{t['Lokasi Terkini'] || ''}</td>
                      <td className="mono">{String(t['Pertama Dilihat'] || '').slice(0, 10)}</td>
                      <td className="num"><b>{t['Kali Dilihat']}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {outstandingRows.length > 300 ? (
              <div className="note" style={{ padding: '8px 16px' }}>
                {`Menunjukkan 300 pertama daripada ${outstandingRows.length} rekod. Eksport CSV untuk senarai penuh.`}
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* Only reachable while the report exists - the button that opens it is part of the
          same branch - but rendered from `h` all the same, so there is no second source of
          truth about which figures are on screen. */}
      {h && figuresOpen ? (
        <FiguresDialog open onClose={() => setFiguresOpen(false)} summary={h.summary} />
      ) : null}

      <ConfirmDialog
        open={purgeOpen}
        title="Padam semua titik masa?"
        confirmLabel="Ya, padam semua"
        message={(
          <>
            Ini memadam <b>{runs} titik masa</b> ({assets} rekod aset) daripada D1. Selepannya
            senarai menjadi kosong, dan muat naik seterusnya menjadi titik masa <b>pertama</b>:
            setiap aset dikira belum diperiksa semula. Tetapan Bahagian manual <b>tidak</b> diubah.
          </>
        )}
        onConfirm={purge}
        onCancel={() => setPurgeOpen(false)}
      />
    </div>
  );
}
