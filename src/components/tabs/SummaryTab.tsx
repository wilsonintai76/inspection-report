/*
 * SummaryTab.tsx - the same list, grouped by department.
 *
 * Every number here comes from src/lib/compute.ts, so the count in a row always equals
 * the number of rows its own filter selects: clicking a row cannot disagree with the
 * table it opens.
 */
import { useApp } from '../../state/AppProvider';
import { toCsv } from '../../parser';
import { buildBreakdown, NO_DEPT, stamp } from '../../lib/compute';
import { download } from '../../lib/exports';
import { DataGrid, Empty, Spacer, Toolbar } from '../ui';
import type { GridColumn } from '../ui';
import type { DeptGroup } from '../../types';

/* ------------------------------------------------------------------ summary -- */

export function SummaryTab({ isViewer }: { isViewer: boolean }) {
  const { state, api } = useApp();
  /* Shared with the tab counter in ResultPanel, so the groups are built once per change
     rather than once per component that asks. */
  const groups = api.summary();
  const grand = state.merged.length;
  const blankCount = groups.filter((g) => g.key === NO_DEPT).reduce((a, g) => a + g.total, 0);

  const exportSummary = () => {
    const cols = ['Bahagian', 'Jumlah Aset', 'Peratus (%)', 'Bilangan Lokasi'];
    const rows = groups.map((g) => ({
      Bahagian: g.label,
      'Jumlah Aset': g.total,
      'Peratus (%)': grand ? Number(((g.total * 100) / grand).toFixed(1)) : 0,
      'Bilangan Lokasi': Object.keys(g.lokasi).length,
    }));
    download(`Ringkasan_Bahagian_PKS_${stamp()}.csv`, toCsv(rows, cols, cols), 'text/csv');
  };

  const exportBreakdown = () => {
    const cols = ['Bahagian', 'Lokasi Terkini', 'Bilangan'];
    download(`Pecahan_Bahagian_Lokasi_PKS_${stamp()}.csv`,
      toCsv(buildBreakdown(state.merged), cols, cols), 'text/csv');
  };

  const columns: GridColumn<DeptGroup>[] = [
    { key: 'dept', label: 'Bahagian', render: (g) => <b>{g.label}</b> },
    { key: 'total', label: 'Jumlah Aset', num: true, render: (g) => <b>{g.total}</b> },
    { key: 'pct', label: '%', num: true, render: (g) => `${(grand ? (g.total * 100) / grand : 0).toFixed(1)}%` },
    { key: 'locs', label: 'Bilangan Lokasi', num: true, render: (g) => Object.keys(g.lokasi).length },
    {
      key: 'top',
      label: 'Contoh Lokasi',
      render: (g) => {
        // The busiest locations are the most useful summary of a department.
        const keys = Object.keys(g.lokasi)
          .sort((a, b) => g.lokasi[b] - g.lokasi[a] || a.localeCompare(b, 'ms'));
        return (
          <>
            {keys.slice(0, 3).map((l) => `${l} (${g.lokasi[l]})`).join(', ')}
            {keys.length > 3 ? <span className="note">{` +${keys.length - 3} lagi`}</span> : null}
          </>
        );
      },
    },
  ];

  return (
    <div id="tab-summary" hidden={state.tab !== 'summary'}>
      <Toolbar>
        <span className="note">
          Bilangan aset belum diperiksa bagi setiap bahagian. Klik mana-mana baris untuk
          menapis senarai penuh kepada bahagian itu.
        </span>
        <Spacer />
        <button type="button" className="primary" id="btnSumCsv" onClick={exportSummary}>
          {'\u2B07'} Eksport CSV ringkasan
        </button>
        <button type="button" id="btnSumAllCsv" onClick={exportBreakdown}>
          {'\u2B07'} Eksport pecahan penuh (lokasi)
        </button>
      </Toolbar>

      <div className="table-scroll" id="summaryWrap" data-groups={groups.length}>
        {!groups.length ? (
          <Empty>Tiada rekod untuk diringkaskan.</Empty>
        ) : (
          <>
            {blankCount ? (
              <div className="notice warn mx-4 mt-3.5">
                <strong>{`${blankCount} rekod tiada bahagian`}</strong>
                Rekod ini tidak akan muncul apabila anda menapis mengikut bahagian.{' '}
                {isViewer
                  ? <>Maklumkan kepada admin supaya medan <b>Bahagian</b> itu dibetulkan atau ditetapkan.</>
                  : (
                    <>
                      Semak dan lengkapkan medan <b>Bahagian</b> dalam sistem sumber, atau
                      tetapkan secara manual dalam panel <b>Tetapkan Bahagian</b>.
                    </>
                  )}
              </div>
            ) : null}
            <DataGrid
              columns={columns}
              rows={groups}
              rowKey={(g) => g.key}
              rowTitle="Klik untuk menapis senarai kepada bahagian ini"
              rowClass={(g) => `clickable${g.key === NO_DEPT ? ' row-warn' : ''}`}
              rowDept={(g) => g.key}
              onRowClick={(g) => {
                api.setBahagian(g.key);
                api.setTab('merged');
              }}
              footer={(
                <tr style={{ fontWeight: 700, background: 'var(--color-head)' }}>
                  <td>JUMLAH</td>
                  <td className="num">{grand}</td>
                  <td className="num">100%</td>
                  <td className="num">&mdash;</td>
                  <td>&mdash;</td>
                </tr>
              )}
            />
          </>
        )}
      </div>
    </div>
  );
}
