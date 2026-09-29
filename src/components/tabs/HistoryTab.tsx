/*
 * HistoryTab.tsx - what D1 remembers: department progress, the points in time, and the
 * assets still outstanding.
 *
 * Three tables, in that order, and the order is the story: what changed since last time,
 * when each list was uploaded, and what is still waiting. tools/verify-history.mjs reads
 * them positionally because of it.
 */
import { useState } from 'react';
import { useApp } from '../../state/AppProvider';
import * as msg from '../../state/notices';
import { historyView, NO_DEPT, stamp } from '../../lib/compute';
import { Cards, Empty, Spacer, Toolbar } from '../ui';
import ConfirmDialog from '../ConfirmDialog';
import type { DeptProgress, HistoryRow } from '../../types';

/* ------------------------------------------------------------------ history -- */

export function HistoryTab({ isViewer }: { isViewer: boolean }) {
  const { state, api } = useApp();
  const h = historyView({ status: state.d1.status, progress: state.d1.progress });
  /* The destructive action lives behind this flag, and the question it asks names the
     numbers: "padam semua" without them is not a confirmation, it is a dare. */
  const [purgeOpen, setPurgeOpen] = useState(false);
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

  return (
    <div id="tab-history" hidden={state.tab !== 'history'}>
      <Toolbar>
        <span className="note">
          Setiap muat naik dihantar ke D1 sebagai satu titik masa. Aset yang <b>hilang</b>{' '}
          daripada senarai dianggap <b>sudah diperiksa</b>.
        </span>
        <Spacer />
        <button type="button" className="primary" id="btnRecordRun" hidden={isViewer} onClick={send}>
          {'+ Hantar senarai ini ke D1'}
        </button>
        <button type="button" id="btnHistRefresh" onClick={reload}>{'\u21BB'} Muat semula</button>
        <button type="button" id="btnHistCsv" onClick={csv}>{'\u2B07'} Eksport sejarah (CSV)</button>
        {/* Admin only, and never a silent action: clearing the timeline removes the very
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
            Selepas itu, setiap muat naik baharu akan dibandingkan dengan yang sebelumnya dan
            aset yang hilang ditandakan sebagai sudah diperiksa.
          </Empty>
        ) : (
          <>
            <Cards
              style={{ padding: '16px 16px 0' }}
              items={[
                { k: 'Titik masa direkod', v: h.summary.runs },
                { k: 'Aset belum diperiksa', v: h.summary.outstanding, cls: 'warn' },
                { k: 'Sudah diperiksa', v: h.summary.resolved, cls: 'good' },
                { k: 'Pemeriksaan kali terakhir', v: lastRun.inspected, cls: lastRun.inspected ? 'good' : '' },
              ]}
            />
            <div className="note" style={{ padding: '10px 16px 0' }}>
              Tempoh: <b>{String(h.summary.first).slice(0, 10)}</b> hingga{' '}
              <b>{String(h.summary.last).slice(0, 10)}</b> &middot; disimpan dalam D1,
              dikongsi oleh semua pengguna
            </div>

            {/* 1. per-department progress since the previous run */}
            {progressRows.length && h.runs.length >= 2 ? (
              <>
                <h3 className="section-title">
                  {`Kemajuan sejak pemeriksaan terakhir (${String(lastRun.prevAt).slice(0, 10)} \u2192 ${String(lastRun.at).slice(0, 10)})`}
                </h3>
                <div className="table-scroll" style={{ maxHeight: '40vh' }}>
                  <table className="grid">
                    <thead>
                      <tr>
                        <th>Bahagian</th>
                        <th className="num">Awal</th>
                        <th className="num">Diperiksa</th>
                        <th className="num">Baharu</th>
                        <th className="num">Akhir</th>
                        <th className="num">Kemajuan</th>
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
                Ini titik masa pertama. Kemajuan akan muncul selepas muat naik yang seterusnya.
              </div>
            ) : null}

            {/* 2. the recorded points in time */}
            <h3 className="section-title">Titik masa direkod</h3>
            <div className="table-scroll" style={{ maxHeight: '34vh' }}>
              <table className="grid">
                <thead>
                  <tr>
                    <th>Tarikh</th>
                    <th className="num">Jumlah</th>
                    <th className="num">Diperiksa</th>
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

            {/* 3. the assets still outstanding, longest-waiting first */}
            <h3 className="section-title">{`Aset masih belum diperiksa (${outstandingRows.length})`}</h3>
            <div className="table-scroll" style={{ maxHeight: '44vh' }}>
              <table className="grid">
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

      <ConfirmDialog
        open={purgeOpen}
        title="Padam semua titik masa?"
        confirmLabel="Ya, padam semua"
        message={(
          <>
            Ini memadam <b>{runs} titik masa</b> ({assets} rekod aset) daripada D1. Selepannya
            senarai menjadi kosong, dan muat naik seterusnya menjadi titik masa <b>pertama</b>:
            tiada perbandingan lagi, jadi setiap aset dikira belum diperiksa sehingga muat naik
            berikutnya. Tetapan Bahagian manual <b>tidak</b> diubah.
          </>
        )}
        onConfirm={purge}
        onCancel={() => setPurgeOpen(false)}
      />
    </div>
  );
}
