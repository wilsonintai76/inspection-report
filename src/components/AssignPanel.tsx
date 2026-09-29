/*
 * AssignPanel.jsx - Tetapkan Bahagian.
 *
 * The source exports leave `Bahagian` blank for some assets. Those records are invisible
 * to every per-department report and to the department filter, so they silently
 * understate whatever unit actually owns them. This panel is the correction.
 *
 * An assignment is stored against the asset LABEL, not a row number, so it survives
 * re-importing corrected exports. It is a user decision, so it wins over the source value
 * - but only while the source has no value of its own (see applyOverrides in
 * src/lib/compute.js, which explains the two guards).
 *
 * The panel is hidden entirely when there is nothing to fix and nothing already fixed:
 * a permanent "0 records need attention" box is noise.
 */
import { useApp } from '../state/AppProvider';
import { knownDepartments } from '../lib/compute';
import * as msg from '../state/notices';
import { Panel, Empty, Notice } from './ui';
import type { NoticePart } from '../types';

export default function AssignPanel({ hidden, isViewer }: { hidden?: boolean; isViewer: boolean }) {
  const { state, api } = useApp();
  const { merged, overrides, d1 } = state;

  const unassigned = merged.filter((r) => !(r.Bahagian || '').trim());
  const assigned = merged.filter((r) => r['_Bahagian Diteta']);
  const departments = knownDepartments(merged);
  const assignedCount = Object.keys(d1.overrides).length;

  // Nothing to do and nothing done: keep the panel out of the way entirely.
  const visible = !hidden && !isViewer && merged.length > 0
    && (unassigned.length > 0 || assignedCount > 0);

  const setOne = async (label: string, want: string) => {
    const res = await api.setOverride(label, want);
    if (!res.ok) {
      api.pushNotice(res.reason === 'offline' ? msg.overrideOfflineNotice() : msg.overrideRejectedNotice(res.error));
      return;
    }
    const left = state.merged.filter((r) => !(r.Bahagian || '').trim()).length;
    api.pushNotice(want ? msg.overrideSetNotice(label, want, left) : msg.overrideClearedNotice());
  };

  const clearAll = async () => {
    const res = await api.clearAllOverrides();
    api.pushNotice(res.ok
      ? msg.allOverridesClearedNotice(res.cleared || 0)
      : msg.overrideRejectedNotice(res.error));
  };

  const staleCount = (overrides.stale || []).length;
  const superCount = (overrides.superseded || []).length;

  return (
    <Panel
      id="panelAssign"
      step="&#9998;"
      title="Tetapkan Bahagian"
      hint={(
        <span id="assignHint">
          {unassigned.length
            ? <><b>{unassigned.length}</b> rekod tiada Bahagian &mdash; tidak muncul dalam laporan mengikut bahagian sehingga ditetapkan</>
            : 'Semua rekod sudah mempunyai Bahagian'}
        </span>
      )}
      hidden={!visible}
      bodyId="assignBody"
    >
      {/* Assignments live in D1, so offering the dropdowns without a connection would
          invite a decision that cannot be stored. Say why instead. */}
      {!d1.up ? (
        <Empty>
          Sambungan D1 diperlukan. Tetapan Bahagian disimpan dalam jadual{' '}
          <b>bahagian_overrides</b>, bukan dalam pelayar, supaya tetapan itu dikongsi dan
          kekal. Buka halaman ini daripada alamat Worker untuk menetapkan bahagian.
        </Empty>
      ) : !departments.length ? (
        <Empty>
          Tiada senarai bahagian untuk dipilih. Muatkan fail yang mempunyai medan Bahagian.
        </Empty>
      ) : (
        <>
          {staleCount ? (
            <Notice item={msg.notice('warn', `${staleCount} tetapan tidak dapat digunakan`, [
              'Bahagian yang ditetapkan tidak wujud dalam data semasa, jadi ia diabaikan supaya tidak mencipta bahagian palsu. Semak semula tetapan di bawah.',
            ])} />
          ) : null}

          {/* A correction found in the SOURCE file takes precedence over a stored
              assignment, and that is reported loudly rather than applied silently:
              otherwise fixing the export appeared to change nothing at all. */}
          {superCount ? (
            <Notice item={msg.notice('warn', `${superCount} tetapan manual diatasi oleh fail sumber`, [
              'Fail yang anda muatkan kini mengandungi nilai Bahagian sendiri untuk rekod ini, jadi nilai ',
              { t: 'b', v: 'fail' },
              ' digunakan dan tetapan manual diabaikan. Ini betul jika anda sudah membetulkannya dalam sistem sumber.',
              { t: 'ul', items: (overrides.superseded || []).slice(0, 8).map((s): NoticePart[] => [
                { t: 'mono', v: s.label },
                ' - fail kata ',
                { t: 'b', v: s.sumber },
                ', menggantikan tetapan manual ',
                { t: 'mono', v: s.ditetapkan },
              ]).concat(superCount > 8 ? [[`... dan ${superCount - 8} lagi`]] : []) },
            ])} />
          ) : null}

          {staleCount || superCount ? (
            <div className="mb-3">
              {superCount ? (
                <button type="button" id="btnDropSuperseded" onClick={() => api.dropSuperseded()}>
                  Buang tetapan manual yang sudah diatasi
                </button>
              ) : null}
            </div>
          ) : null}

          {unassigned.length ? (
            <>
              <h3 className="section-title">Perlu ditetapkan ({unassigned.length})</h3>
              <div className="table-scroll max-h-[44vh]">
                <table className="grid">
                  <thead>
                    <tr>
                      <th>Label</th><th>Jenis Aset</th><th>Lokasi Terkini</th><th>Bahagian</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unassigned.map((r) => (
                      <tr key={r.Label}>
                        <td className="mono">{r.Label}</td>
                        <td>{r['Jenis Aset'] || ''}</td>
                        <td>{r['Lokasi Terkini'] || ''}</td>
                        <td>
                          <select
                            data-assign={r.Label}
                            value=""
                            onChange={(e) => setOne(r.Label, e.target.value)}
                          >
                            <option value="">&mdash; pilih bahagian &mdash;</option>
                            {departments.map((d) => (
                              <option value={d.name} key={d.name}>{`${d.name} (${d.count})`}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="notice ok">
              <strong>Semua rekod sudah ada Bahagian.</strong>
              Tiada lagi rekod yang terlepas daripada laporan mengikut bahagian.
            </div>
          )}

          {assigned.length ? (
            <>
              <h3 className="section-title">Ditetapkan secara manual ({assigned.length})</h3>
              <div className="table-scroll max-h-[30vh]">
                <table className="grid">
                  <thead>
                    <tr>
                      <th>Label</th><th>Bahagian dalam fail</th><th>Ditetapkan kepada</th>
                      <th className="no-print" />
                    </tr>
                  </thead>
                  <tbody>
                    {assigned.map((r) => (
                      <tr key={r.Label}>
                        <td className="mono">{r.Label}</td>
                        <td className="miss">{r['_Bahagian Asal'] || '(kosong)'}</td>
                        <td><b>{r.Bahagian}</b></td>
                        <td className="no-print">
                          <button type="button" className="tiny" data-unassign={r.Label}
                            onClick={() => setOne(r.Label, '')}>
                            Batal
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="toolbar plain pt-3">
                <button type="button" id="btnClearAssign" onClick={clearAll}>
                  Padam semua tetapan manual
                </button>
                <div className="spacer" />
                <span className="note">
                  Tetapan disimpan mengikut <b>Label</b>, jadi ia kekal apabila anda
                  mengimport semula fail yang dikemas kini.
                </span>
              </div>
            </>
          ) : null}
        </>
      )}
    </Panel>
  );
}
