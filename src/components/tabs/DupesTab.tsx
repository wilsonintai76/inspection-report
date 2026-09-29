/*
 * DupesTab.tsx - labels that appeared more than once while merging.
 */
import { useApp } from '../../state/AppProvider';
import { exportDuplicates } from '../../lib/exports';
import { DataGrid, Pill, Spacer, Toolbar } from '../ui';
import type { GridColumn } from '../ui';
import type { DuplicateGroup } from '../../types';

/* ------------------------------------------------------- duplicates, conflicts -- */

export function DupesTab() {
  const { state } = useApp();
  const columns: GridColumn<DuplicateGroup>[] = [
    { key: 'label', label: 'Label', cls: 'mono' },
    { key: 'jenisAset', label: 'Jenis Aset' },
    {
      key: 'count',
      label: 'Bilangan',
      num: true,
      render: (d) => <Pill kind="warn">{`${d.count}\u00d7`}</Pill>,
    },
    {
      key: 'sources',
      label: 'Muncul dalam fail',
      render: (d) => (d.sources || []).map((s, i) => (
        <span key={`${s}-${i}`}>{i ? <br /> : null}{s}</span>
      )),
    },
  ];
  return (
    <div id="tab-dupes" hidden={state.tab !== 'dupes'}>
      <Toolbar>
        <span className="note">
          Aset yang muncul dalam lebih daripada satu fail (atau berulang dalam fail yang
          sama). Senarai gabungan menyimpannya sekali sahaja.
        </span>
        <Spacer />
        <button type="button" id="btnDupCsv" onClick={() => exportDuplicates(state.duplicates)}>
          {'\u2B07'} Eksport CSV pertindihan
        </button>
      </Toolbar>
      <div className="table-scroll" id="dupesWrap">
        <DataGrid columns={columns} rows={state.duplicates} empty="Tiada pertindihan label dikesan." />
      </div>
    </div>
  );
}
