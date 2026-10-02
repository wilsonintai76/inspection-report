/*
 * DropZone.jsx - Step 1: getting files in, and showing what arrived.
 *
 * Dropping is allowed anywhere on the page, not only on the dashed box: a user who has
 * just dragged three exports across the screen should not have to aim. Folders are part
 * of the payload on purpose - the exports for one report live in a folder per month, and
 * a folder per department, which is why src/intake.mjs exists.
 */
import { useRef, useState } from 'react';
import { useApp } from '../state/AppProvider';
import { fmtSize } from '../lib/compute';
import { Panel, Pill, Empty } from './ui';

export default function DropZone({ hidden }: { hidden?: boolean }) {
  const { state, api } = useApp();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const folderRef = useRef<HTMLInputElement | null>(null);
  const [hot, setHot] = useState(false);

  const pick = () => {
    if (inputRef.current) inputRef.current.click();
  };

  const pickFolder = () => {
    if (folderRef.current) folderRef.current.click();
  };

  /*
   * The drop itself is handled in ONE place: the page-wide listener in App.jsx.
   *
   * This box used to load the files as well, and because a drop here also bubbles to the
   * window, every file dropped on the box was loaded TWICE - which then showed up as a
   * bogus "Kandungan fail yang sama dikesan" warning and as two identical rows in the
   * per-file tab. Keeping the handler here means keeping both bugs, so it only reports
   * the drag state now.
   */
  const stop = (e: React.DragEvent<HTMLElement>) => e.preventDefault();

  /* Where a file sat inside the folder it came from, so two "Senarai_Aset.xls" - one per
     month-folder - are two visibly different rows. */
  const folderOf = (path?: string): string => {
    if (!path) return '';
    const cut = path.lastIndexOf('/');
    return cut > 0 ? path.slice(0, cut + 1) : '';
  };

  return (
    <Panel
      id="panelFiles"
      step="1"
      title="Pilih fail senarai aset"
      hint="Fail .xls (jadual HTML), .html, .csv, .tsv atau .json - fail atau folder"
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
        onDrop={(e) => { stop(e); setHot(false); }}
      >
        <div className="big" aria-hidden="true">{'\u{1F4C1}'}</div>
        <strong>Lepaskan fail atau folder ke sini</strong>
        <div className="sub">
          atau klik butang di bawah untuk memilih fail atau folder daripada komputer anda.
          Senarai ini ditambah, bukan diganti - pilih daripada beberapa folder dan
          kesemuanya kekal di sini.
        </div>
        <div className="row-actions">
          <button type="button" className="primary" id="btnPick" onClick={pick}>
            {'\u{1F4C1} Pilih fail...'}
          </button>
          <button
            type="button"
            id="btnPickFolder"
            title="Satu folder setiap dialog (had dialog Windows) - tekan lagi untuk menambah folder seterusnya"
            onClick={pickFolder}
          >
            {'\u{1F4C2} Tambah folder...'}
          </button>
          <button type="button" id="btnClear" disabled={!state.files.length} onClick={() => api.clearFiles()}>
            Kosongkan senarai
          </button>
        </div>
        {/*
          * The folder dialog takes ONE folder per press, and that is the Windows dialog's
          * own limit (Chromium asks for FOS_PICKFOLDERS and never FOS_ALLOWMULTISELECT), not
          * something the page can change - the input already carries `multiple`. A user who
          * CTRL-clicks two folders and gets one cannot tell that from a broken picker, so the
          * two routes that DO take several folders at once are named here.
          */}
        <div className="tip" id="folderTip">
          <b>Tambah folder</b> memberi <b>satu folder setiap dialog</b> (had dialog Windows,
          bukan had halaman ini). Tekan butang itu lagi untuk folder seterusnya, lepaskan
          beberapa folder sekali gus dari Explorer, atau pilih folder induk yang
          subfoldernya mengandungi semua eksport itu.
        </div>
        <input
          type="file"
          id="fileInput"
          multiple
          accept=".xls,.xlsx,.html,.htm,.csv,.tsv,.txt,.json"
          hidden
          ref={inputRef}
          onChange={(e) => {
            const input = e.target as HTMLInputElement;
            api.loadFiles(input.files || []).then(() => { input.value = ''; });
          }}
        />
        {/*
          * The folder picker. `webkitdirectory` is not in React's attribute types but it
          * must be in the markup or the browser shows the ordinary file dialog - the
          * paths arrive as `webkitRelativePath` on every File.
          */}
        <input
          type="file"
          id="folderInput"
          multiple
          hidden
          ref={folderRef}
          {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
          onChange={(e) => {
            const input = e.target as HTMLInputElement;
            api.loadFolder(input.files).then(() => { input.value = ''; });
          }}
        />
      </div>

      <div id="sourceList" className="mt-4">
        {!state.files.length ? null : (
          <ul className="filelist">
            {state.files.map((f, i) => (
              <li key={`${f.path || f.name}-${i}`}>
                <span className="fi" aria-hidden="true">{f.parseError ? '\u26A0\uFE0F' : '\u{1F4C4}'}</span>
                <div>
                  <div className="fname">
                    {folderOf(f.path) ? <span className="fdir">{folderOf(f.path)}</span> : null}
                    {f.name}
                  </div>
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
