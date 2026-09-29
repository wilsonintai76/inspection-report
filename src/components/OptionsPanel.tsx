/*
 * OptionsPanel.jsx - Step 2: how the merge treats overlaps, and how the list is filtered.
 *
 * The search box is debounced by 160 ms because every keystroke would otherwise re-filter
 * 536 records and re-render the table. The delay is short enough that the browser suites
 * (which wait 300 ms after typing) see the result.
 */
import { useApp } from '../state/AppProvider';
import { departmentCounts, NO_DEPT } from '../lib/compute';
import { Panel, Toolbar, Field, Spacer, DebouncedSearch } from './ui';
import type { ReactNode } from 'react';

const KEY_EXPLAIN: Record<string, ReactNode> = {
  label: (
    <>Satu aset = satu label. Label ialah identiti aset, jadi pertindihan bermakna label
      yang sama muncul lebih daripada sekali.</>
  ),
  labelAndType: (
    <>Rekod dikira bertindih apabila <b>Label aset dan Jenis Aset</b> kedua-duanya sama.</>
  ),
  full: (
    <>Rekod dikira bertindih hanya apabila <b>semua medan</b> sama tepat.</>
  ),
};

/** Department options, with the blank-department sentinel sorted last. */
export function departmentOptions(counts: Record<string, number>): string[] {
  return Object.keys(counts).sort((a, b) => {
    if (a === NO_DEPT) return 1;
    if (b === NO_DEPT) return -1;
    return a.localeCompare(b, 'ms');
  });
}

export default function OptionsPanel({ hidden, isViewer }: { hidden?: boolean; isViewer: boolean }) {
  const { state, api } = useApp();
  const counts = departmentCounts(state.merged);
  void isViewer;

  return (
    <Panel id="panelOptions" step="2" title="Tetapan penggabungan" hidden={hidden}>
      <Toolbar plain>
        <Field label="Kunci padanan pertindihan" htmlFor="selKey">
          <select
            id="selKey"
            value={state.keyStrategy}
            onChange={(e) => api.setKeyStrategy(e.target.value)}
          >
            <option value="label">Label aset (disyorkan)</option>
            <option value="labelAndType">Label aset + Jenis Aset</option>
            <option value="full">Semua medan sama (padanan penuh)</option>
          </select>
        </Field>
        <Field label="Tapis Bahagian" htmlFor="selBahagian">
          <select id="selBahagian" value={state.bahagian} onChange={(e) => api.setBahagian(e.target.value)}>
            <option value="">Semua bahagian</option>
            {departmentOptions(counts).map((k) => (
              <option value={k} key={k}>{`${k} (${counts[k]})`}</option>
            ))}
          </select>
        </Field>
        <Field label="Susun ikut" htmlFor="selSort">
          <select id="selSort" value={state.sortKey} onChange={(e) => api.setSort(e.target.value)}>
            <option value="jenis">Jenis Aset, kemudian Label</option>
            <option value="label">Label aset</option>
            <option value="pegawai">Pegawai Penempatan</option>
            <option value="bahagian">Bahagian</option>
            <option value="lokasi">Lokasi Terkini</option>
            <option value="salinan">Bilangan Salinan (menurun)</option>
          </select>
        </Field>
        <DebouncedSearch
          id="q"
          label="Carian bebas"
          placeholder="Taip label, jenis aset, pegawai, lokasi..."
          value={state.query}
          apply={api.setQuery}
          style={{ minWidth: 260 }}
        />
        <Spacer />
        <button
          type="button"
          id="btnReset"
          onClick={() => api.resetFilters()}
        >
          Set semula tapisan
        </button>
      </Toolbar>
      <div className="note mt-3" id="keyExplain">{KEY_EXPLAIN[state.keyStrategy]}</div>
    </Panel>
  );
}
