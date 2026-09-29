/*
 * MergedTab.tsx - the list itself, with the filters the reader gets when Step 2 is out
 * of reach, and the exports that write what is on screen.
 */
import { useApp } from '../../state/AppProvider';
import { currentRows, LABEL_FIELDS, NO_DEPT, PAGE_SIZE } from '../../lib/compute';
import { exportRows } from '../../lib/exports';
import { DataGrid, DebouncedSearch, Empty, Pager, Pill, Spacer, Toolbar } from '../ui';
import type { GridColumn } from '../ui';
import type { AssetRecord, PrintHeader } from '../../types';

/* ------------------------------------------------------------------- merged -- */

const SORT_KEYS: Record<string, string> = {
  Label: 'label',
  'Jenis Aset': 'jenis',
  'Pegawai Penempatan': 'pegawai',
  Bahagian: 'bahagian',
  'Lokasi Terkini': 'lokasi',
  Salinan: 'salinan',
};

export function MergedTab({ isViewer, printHeader }: { isViewer: boolean; printHeader: PrintHeader }) {
  const { state, api } = useApp();
  const rows = currentRows(state);
  const page = state.page;
  const slice = state.printAll ? rows : rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  /** The copy count, offered to an admin only. */
  const copyColumn: GridColumn<AssetRecord> = {
    key: 'salinan',
    label: 'Salinan',
    num: true,
    sort: 'Salinan',
    sortable: true,
    onSort: () => api.sortByColumn('salinan'),
    render: (r) => (Number(r['_Bilangan Salinan'] || 0) > 1
      ? <Pill kind="warn">{`${r['_Bilangan Salinan']}\u00d7`}</Pill>
      : <Pill>{'1\u00d7'}</Pill>),
  };

  const columns: GridColumn<AssetRecord>[] = [
    { key: 'no', label: '#', num: true, render: (_r, i) => (page - 1) * PAGE_SIZE + i + 1 },
    ...LABEL_FIELDS.map((f): GridColumn<AssetRecord> => ({
      key: f,
      label: f,
      sort: f,
      sortable: true,
      cls: f === 'Label' ? 'mono' : undefined,
      onSort: () => api.sortByColumn(SORT_KEYS[f]),
      render: (r) => {
        const v = r[f];
        return v === undefined || v === null ? '' : String(v);
      },
    })),
    // "Salinan" counts copies found while merging. A viewer reads one shared list, so the
    // column would always read 1x and only invite a question.
    ...(isViewer ? [] : [copyColumn]),
  ];

  const note = isViewer
    ? (rows.length === state.merged.length
      ? `Menunjukkan semua ${rows.length} aset belum diperiksa.`
      : `Menapis ${rows.length} daripada ${state.merged.length} aset belum diperiksa.`)
    : (rows.length === state.merged.length
      ? `Memaparkan semua ${rows.length} rekod unik.`
      : `Menapis ${rows.length} daripada ${state.merged.length} rekod unik.`);

  /**
   * "Muat naik senarai" from the viewer's toolbar.
   *
   * An admin is already allowed to upload, so for them the button simply leaves the
   * viewer preview - the dashboard with Step 1 is behind it. Everybody else is asked to
   * sign in, because hiding the button would not make the API any less protected.
   */
  const requestUpload = () => {
    if (state.me.role === 'admin') {
      api.togglePreview();
      return;
    }
    api.openLogin();
  };

  return (
    <div id="tab-merged" hidden={state.tab !== 'merged'}>
      <div className="print-only" id="printHead">
        <h2>{printHeader.title}</h2>
        <div className="meta">{printHeader.meta}</div>
      </div>

      {/* A viewer cannot upload, so the filters in Step 2 are out of reach for them.
          Their own compact controls sit here instead, driving the same table. */}
      <div className="toolbar" id="viewerTools" hidden={!isViewer}>
        {/* The way in for an admin: a reader who wants to upload gets the login dialog,
            and an admin who is only PREVIEWING the viewer's screen is taken back to the
            dashboard they already have. */}
        <button type="button" className="primary" id="btnUpload" onClick={requestUpload}>
          {'\u2B06 Muat naik senarai'}
        </button>
        <DebouncedSearch
          id="qViewer"
          label="Carian"
          placeholder="Label, jenis aset, pegawai, lokasi..."
          value={state.query}
          apply={api.setQuery}
          style={{ minWidth: 240 }}
        />
        <div className="field">
          <label htmlFor="selViewerBahagian">Tapis Bahagian</label>
          <select id="selViewerBahagian" value={state.bahagian} onChange={(e) => api.setBahagian(e.target.value)}>
            <option value="">Semua bahagian</option>
            {departmentKeys(state.merged).map((k) => (
              <option value={k} key={k}>{`${k} (${departmentTally(state.merged)[k]})`}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="selViewerSort">Susun ikut</label>
          <select id="selViewerSort" value={state.sortKey} onChange={(e) => api.setSort(e.target.value)}>
            <option value="jenis">Jenis Aset, kemudian Label</option>
            <option value="label">Label aset</option>
            <option value="bahagian">Bahagian</option>
            <option value="lokasi">Lokasi Terkini</option>
            <option value="pegawai">Pegawai Penempatan</option>
          </select>
        </div>
        <Spacer />
        <button type="button" id="btnViewerReset" onClick={() => api.resetFilters()}>Set semula tapisan</button>
        {/* Reading is public, so refreshing is too: anybody may re-read D1. Only UPLOADING a
            snapshot needs a login, and that is the button next to this one. */}
        <button type="button" id="btnViewerRefresh" onClick={() => api.refresh(true)}>
          {'\u21BB'} Muat semula
        </button>
      </div>

      <Toolbar>
        <span className="note" id="mergedCount">{note}</span>
        <Spacer />
        <button type="button" className="primary" id="btnXls" onClick={() => exportRows(state, 'xls', rows)}>
          {'\u2B07'} Eksport Excel (.xls)
        </button>
        <button type="button" id="btnCsv" onClick={() => exportRows(state, 'csv', rows)}>
          {'\u2B07'} Eksport CSV
        </button>
        <button type="button" id="btnJson" onClick={() => exportRows(state, 'json', state.merged)}>
          {'\u2B07'} Eksport JSON
        </button>
        <button type="button" id="btnPrint" onClick={() => api.print()}>{'\u{1F5A8}'} Cetak / PDF</button>
      </Toolbar>

      <div className="table-scroll" id="mergedWrap">
        {!slice.length ? (
          <Empty>Tiada rekod sepadan dengan tapisan semasa.</Empty>
        ) : (
          <>
            <DataGrid columns={columns} rows={slice} rowKey={(r, i) => `${r.Label}-${i}`} />
            {state.printAll ? null : <Pager total={rows.length} page={page} onPage={api.setPage} />}
          </>
        )}
      </div>
    </div>
  );
}

/** Department keys and counts, in the order the viewer's dropdown shows them. */
function departmentTally(merged: AssetRecord[]): Record<string, number> {
  const counts: Record<string, number> = {};
  merged.forEach((r) => {
    const k = r.Bahagian || NO_DEPT;
    counts[k] = (counts[k] || 0) + 1;
  });
  return counts;
}

function departmentKeys(merged: AssetRecord[]): string[] {
  return Object.keys(departmentTally(merged)).sort((a, b) => {
    if (a === NO_DEPT) return 1;
    if (b === NO_DEPT) return -1;
    return a.localeCompare(b, 'ms');
  });
}
