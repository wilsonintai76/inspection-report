/*
 * SourcesTab.tsx - what each uploaded file contributed.
 */
import { useApp } from '../../state/AppProvider';
import { DataGrid } from '../ui';
import type { GridColumn } from '../ui';
import type { SourceStat } from '../../types';

export function SourcesTab() {
  const { state } = useApp();
  const totals = state.sourceStats.reduce((a, s) => {
    a.rows += s.rows;
    a.added += s.added;
    a.duplicate += s.duplicate;
    return a;
  }, { rows: 0, added: 0, duplicate: 0 });

  const columns: GridColumn<SourceStat>[] = [
    { key: 'fileName', label: 'Fail' },
    { key: 'format', label: 'Format' },
    { key: 'rows', label: 'Baris', num: true },
    { key: 'unique', label: 'Label unik dalam fail', num: true },
    { key: 'added', label: 'Ditambah', num: true },
    { key: 'duplicate', label: 'Bertindih', num: true },
    { key: 'internalDuplicates', label: 'Pertindihan dalaman', num: true },
  ];

  return (
    <div id="tab-sources" hidden={state.tab !== 'sources'}>
      <div className="table-scroll" id="sourcesWrap">
        <DataGrid
          columns={columns}
          rows={state.sourceStats}
          empty="Tiada fail berjaya dibaca."
          rowKey={(s) => s.fileName}
          footer={(
            <tr style={{ fontWeight: 700, background: 'var(--color-head)' }}>
              <td colSpan={2}>JUMLAH</td>
              <td className="num">{totals.rows}</td>
              <td className="num">&mdash;</td>
              <td className="num">{totals.added}</td>
              <td className="num">{totals.duplicate}</td>
              <td className="num">&mdash;</td>
            </tr>
          )}
        />
      </div>
    </div>
  );
}
