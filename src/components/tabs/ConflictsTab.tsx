/*
 * ConflictsTab.tsx - the same label with different details in different files.
 *
 * The one view that is not a plain grid: each conflicting label needs its own small table
 * of what was kept and what disagreed, so the shape is a table inside a row.
 */
import { useApp } from '../../state/AppProvider';
import { exportConflicts } from '../../lib/exports';
import { Empty, Spacer, Toolbar } from '../ui';

export function ConflictsTab() {
  const { state } = useApp();
  return (
    <div id="tab-conflicts" hidden={state.tab !== 'conflicts'}>
      <Toolbar>
        <span className="note">
          Label aset yang sama tetapi butiran berbeza antara fail. Semak dan betulkan dalam
          sistem sumber.
        </span>
        <Spacer />
        <button type="button" id="btnConfCsv" onClick={() => exportConflicts(state.conflicts)}>
          {'\u2B07'} Eksport CSV konflik
        </button>
      </Toolbar>
      <div className="table-scroll" id="conflictsWrap">
        {!state.conflicts.length ? (
          <Empty>Tiada konflik data - semua label yang bertindih mempunyai butiran yang sama.</Empty>
        ) : (
          <table className="grid">
            <tbody>
              {state.conflicts.map((c) => (
                <tr key={`${c.label}-${c.fileName}`}>
                  <td colSpan={4} style={{ background: '#f6f9fd' }}>
                    <b>{c.label}</b>{' '}
                    <span className="note">&middot; nilai berbeza dalam <b>{c.fileName}</b></span>
                    <table className="grid" style={{ marginTop: 8 }}>
                      <thead>
                        <tr>
                          <th>Medan</th>
                          <th>Nilai disimpan (fail pertama)</th>
                          <th>Nilai bercanggah (fail lain)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {c.differing.map((f) => (
                          <tr key={f}>
                            <td className="mono">{f}</td>
                            <td>{c.existing[f]}</td>
                            <td className="miss">{c.incoming[f]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
