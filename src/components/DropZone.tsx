/*
 * DropZone.jsx - Step 1: getting files in, and showing what arrived.
 *
 * Dropping is allowed anywhere on the page, not only on the dashed box: a user who has
 * just dragged three exports across the screen should not have to aim.
 */
import { useRef, useState } from 'react';
import { useApp } from '../state/AppProvider';
import { fmtSize } from '../lib/compute';
import { Panel, Pill, Empty } from './ui';

export default function DropZone({ hidden }: { hidden?: boolean }) {
  const { state, api } = useApp();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [hot, setHot] = useState(false);

  const pick = () => {
    if (inputRef.current) inputRef.current.click();
  };

  const onDrop = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    setHot(false);
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      api.loadFiles(e.dataTransfer.files);
    }
  };

  /* Dropping anywhere on the page works, so the handlers live on the wrapper. */
  const stop = (e: React.DragEvent<HTMLElement>) => e.preventDefault();

  return (
    <Panel
      id="panelFiles"
      step="1"
      title="Pilih fail senarai aset"
      hint="Fail .xls (jadual HTML), .html, .csv, .tsv atau .json"
      hidden={hidden}
    >
      <div
        className={hot ? 'drop hot' : 'drop'}
        id="drop"
        onClick={(e) => {
          const t = e.target as HTMLElement;
          if (t.id === 'drop' || t.classList.contains('sub') || t.classList.contains('big')) pick();
        }}
        onDragEnter={(e) => { stop(e); setHot(true); }}
        onDragOver={(e) => { stop(e); setHot(true); }}
        onDragLeave={(e) => { stop(e); setHot(false); }}
        onDrop={onDrop}
      >
        <div className="big" aria-hidden="true">{'\u{1F4C1}'}</div>
        <strong>Lepaskan fail ke sini</strong>
        <div className="sub">atau klik butang di bawah untuk memilih fail daripada komputer anda</div>
        <div className="row-actions">
          <button type="button" className="primary" id="btnPick" onClick={pick}>
            {'\u{1F4C1} Pilih fail...'}
          </button>
          <button type="button" id="btnClear" disabled={!state.files.length} onClick={() => api.clearFiles()}>
            Kosongkan senarai
          </button>
        </div>
        <input
          type="file"
          id="fileInput"
          multiple
          accept=".xls,.xlsx,.html,.htm,.csv,.tsv,.txt,.json"
          hidden
          ref={inputRef}
          onChange={(e) => {
            api.loadFiles(e.target.files || []).then(() => { e.target.value = ''; });
          }}
        />
      </div>

      <div id="sourceList" className="mt-4">
        {!state.files.length ? null : (
          <ul className="filelist">
            {state.files.map((f, i) => (
              <li key={`${f.name}-${i}`}>
                <span className="fi" aria-hidden="true">{f.parseError ? '\u26A0\uFE0F' : '\u{1F4C4}'}</span>
                <div>
                  <div className="fname">{f.name}</div>
                  <div className="fmeta">
                    {f.parseError ? (
                      <>{' '}<Pill kind="bad">gagal dibaca</Pill> {f.parseError}</>
                    ) : (
                      <>
                        <Pill kind="ok">{(f.records || []).length} rekod</Pill>{' '}
                        {(f.meta && f.meta.format) || ''} &middot; {fmtSize(f.size)} &middot; cap jari{' '}
                        {String(f.sha).slice(0, 12)}...
                      </>
                    )}
                  </div>
                </div>
                <div className="fx">
                  <button type="button" className="tiny" data-remove={i} onClick={() => api.removeFile(i)}>
                    Buang
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

export { Empty };
