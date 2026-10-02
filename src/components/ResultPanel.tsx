/*
 * ResultPanel.jsx - Step 3: the counters, the tab bar, and the views themselves.
 *
 * The tab bar is rendered from one list of definitions rather than six hand-written
 * buttons, which is how the role rules stay in one place: a viewer never sees the
 * merge-diagnosis tabs, and never sees the "gabungan" wording, because they did not merge
 * anything - they are reading the shared list.
 */
import { useApp } from '../state/AppProvider';
import { mergedCards, printHeaderParts, tabCounts } from '../lib/compute';
import { Cards, Panel } from './ui';
import {
  ConflictsTab, DupesTab, HistoryTab, MergedTab, SourcesTab, SummaryTab,
} from './tabs';
import type { TabName } from '../types';

/** One tab definition: which view it is, what its counter counts, and who may see it. */
interface TabDef {
  tab: TabName;
  id: string;
  label: string;
  /** Field of the tab-counter set this tab reports, or null when it counts something else. */
  countKey: 'merged' | 'dupes' | 'conf' | 'src' | null;
  viewerLabel?: string;
  adminOnly?: boolean;
  first?: boolean;
}

/** Order matters: the first tab is the one an admin lands on, and the viewer's landing tab. */
const TAB_DEFS: TabDef[] = [
  { tab: 'summary', id: 'cSum', label: 'Ringkasan Bahagian', countKey: null },
  /* Sejarah Pemeriksaan is the ADMIN's tool: it carries the register's figures, the
     movement between uploads and the destructive buttons behind it. A reader's job is to
     read the list, so they get no such tab - see where it is rendered below. */
  { tab: 'history', id: 'cHist', label: 'Sejarah Pemeriksaan', countKey: null, adminOnly: true },
  { tab: 'merged', id: 'cMerged', label: 'Senarai Gabungan', countKey: 'merged', viewerLabel: 'Senarai Semasa', first: true },
  { tab: 'dupes', id: 'cDupes', label: 'Pertindihan', countKey: 'dupes', adminOnly: true },
  { tab: 'conflicts', id: 'cConf', label: 'Konflik Data', countKey: 'conf', adminOnly: true },
  { tab: 'sources', id: 'cSrc', label: 'Butiran Fail', countKey: 'src', adminOnly: true },
];

export default function ResultPanel() {
  const { state, api } = useApp();
  const isViewer = state.me.role === 'viewer' || state.preview;
  const counts = tabCounts(state, isViewer);
  const historyRuns = state.d1.status ? state.d1.status.observations : 0;
  /*
   * Step 3 is offered when there is something to show. An admin used to need files loaded
   * before the tabs appeared at all, which hid the HISTORY tab behind an irrelevant step:
   * that tab reads D1, not the merge, so it is exactly what an admin needs when they open
   * the page to look at (or clear) the timeline without uploading anything.
   */
  const ready = isViewer
    ? !!state.d1.current
    : (state.sourceStats.length > 0 || historyRuns > 0);

  /*
   * Tab counters. The list, overlap and conflict counts come from the data on screen; the
   * summary counts the groups it renders; the history count is D1's, because that timeline
   * is not something this page computes. Keeping all four here - rather than letting each
   * view set its own, which is what the old code did - is why they cannot go blank on the
   * first paint any more.
   */
  const counterFor = (def: TabDef): number => {
    if (def.tab === 'summary') return api.summary().length;
    if (def.tab === 'history') return historyRuns;
    return def.countKey ? counts[def.countKey] : 0;
  };

  const printHeader = printHeaderParts(state, state.merged.length, isViewer);

  return (
    <Panel
      id="panelResult"
      step="3"
      title={<span id="resultTitle">{isViewer ? 'Senarai aset belum diperiksa' : 'Hasil gabungan'}</span>}
      hint={isViewer ? 'Dibaca daripada pangkalan data D1 - senarai yang dikongsi' : ''}
      hidden={!ready}
      bodyStyle={{ paddingBottom: 0 }}
      hintId="resultHint"
    >      <Cards items={mergedCards(state, isViewer)} id="cards" />

      <div className="tabs" role="tablist" id="tabs">
        {/* An admin-only tab is NOT RENDERED for a reader, rather than rendered and hidden:
            a hidden node is still in the DOM, still carries its counter, and is one style
            mistake away from being visible. The tabs a reader may use are the tabs they get. */}
        {TAB_DEFS.filter((t) => !(t.adminOnly && isViewer)).map((t) => (
          <button
            type="button"
            role="tab"
            key={t.tab}
            data-tab={t.tab}
            aria-selected={state.tab === t.tab}
            onClick={() => api.setTab(t.tab)}
          >
            <span className="tabLabel">{isViewer && t.viewerLabel ? t.viewerLabel : t.label}</span>{' '}
            <span className="count" id={t.id}>{counterFor(t)}</span>
          </button>
        ))}
      </div>

      <SummaryTab isViewer={isViewer} />
      {/* HistoryTab is not rendered for a reader at all. Hiding the tab BUTTON while leaving
          the panel in the DOM would still put the register's figures and the whole movement
          table one keyboard tab away, and "hidden" is not a permission - the same reason
          the admin buttons are not rendered either. */}
      {isViewer ? null : <HistoryTab isViewer={false} />}
      <MergedTab isViewer={isViewer} printHeader={printHeader} />
      <DupesTab />
      <ConflictsTab />
      <SourcesTab />
    </Panel>
  );
}
