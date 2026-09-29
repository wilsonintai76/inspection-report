/*
 * App.jsx - the page: chrome, then the four steps in order.
 *
 * The layout is the same one the single-file version had, and the roles are decided in one
 * place here rather than by hiding buttons from six different renderers:
 *
 *   a viewer (or an admin previewing as one) has no Step 1 or Step 2 - they cannot upload,
 *   so the filters live in the list itself - and no merge-diagnosis tabs.
 *
 * The notices panel sits directly under the connection panel because that is where a
 * failure to reach D1 needs to be seen.
 */
import { useEffect } from 'react';
import { useApp } from './state/AppProvider';
import Header from './components/Header';
import LinkPanel from './components/LinkPanel';
import DropZone from './components/DropZone';
import OptionsPanel from './components/OptionsPanel';
import AssignPanel from './components/AssignPanel';
import ResultPanel from './components/ResultPanel';
import LoginDialog from './components/LoginDialog';
import { NoticeList } from './components/ui';

/** Two small, DIFFERENT sources: the second differs on one record so the conflict
 *  detection has something to find. Loaded from memory, so the demo needs no network. */
function demoFiles() {
  const recs = [
    ['KPT/PKS/H/89/91', 'AIR COMPRESSOR MACHINE', 'THANDAYUTHAPANI A/L SEPERAMANIAM', 'JABATAN KEJURUTERAAN MEKANIKAL', 'BENGKEL LOJI'],
    ['KPT/PKS/H/10/115', 'ALAT HAWA DINGIN UNIT BERASINGAN (ASET TAK ALIH)', 'NORPARINA BINTI SULIMAN', 'UNIT LATIHAN & PENDIDIKAN LANJUTAN', 'STOR 1'],
    ['KPT/PKS/H/10/221', 'ANTI LOCK BRAKING SYSTEM SIMULATOR', "MOHD FITRI BIN SAFE'I", 'JABATAN KEJURUTERAAN MEKANIKAL', 'Autotronic lab'],
    ['KPT/PKS/H/17/3', 'BASIC HYDRAULIC BENCH', 'SYARIZAL BIN BAKRI', 'JABATAN KEJURUTERAAN MEKANIKAL', 'BENGKEL SAINS BAHAN'],
    ['KPT/PKS/H/91/11', 'BENDING MACHINE', 'ALIFF BIN AB TAHIR', 'JABATAN KEJURUTERAAN MEKANIKAL', 'BENGKEL SHEETMETAL'],
  ];
  const make = (rows: string[][]) => {
    const esc = (v: string) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const body = rows.map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join('')}<td>Sedang Digunakan</td></tr>`).join('\n');
    return '<html><body><table><tr><td><b>Label</b></td><td><b>Jenis Aset</b></td>'
      + '<td><b>Pegawai Penempatan</b></td><td><b>Bahagian</b></td><td><b>Lokasi Terkini</b></td>'
      + `<td><b>Status Aset</b></td></tr>${body}</table></body></html>`;
  };
  const second = recs.map((r) => r.slice());
  second[0][4] = 'BENGKEL LOJI (PINDAH)';
  second.push(['KPT/PKS/H/21/2', 'WELDING MACHINE', 'ALIFF BIN AB TAHIR', 'JABATAN KEJURUTERAAN MEKANIKAL', 'BENGKEL SHEETMETAL']);
  return [
    { name: 'Contoh_Senarai_ABR_JKM.xls', size: 1200, text: make(recs), sha: 'demo-a' },
    { name: 'Contoh_Senarai_HM_JKM.xls', size: 1300, text: make(second), sha: 'demo-b' },
  ];
}

export default function App() {
  const { state, api } = useApp();
  const isViewer = state.me.role === 'viewer' || state.preview;
  const hasData = state.sourceStats.length > 0;

  /* Dropping anywhere on the page works, not only on the dashed box. */
  useEffect(() => {
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      if (isViewer) return;
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
        api.loadFiles(e.dataTransfer.files);
      }
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [api, isViewer]);

  const loadDemo = () => {
    api.dispatchSync({ type: 'LOAD_FILES', entries: demoFiles(), append: false, pendingRun: true });
    const el = document.getElementById('panelResult');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <>
      <Header isViewer={isViewer} onDemo={loadDemo} />

      <div className="wrap">
        <LinkPanel isViewer={isViewer} />

        <NoticeList items={state.notices} id="notices" />

        <DropZone hidden={isViewer} />

        <OptionsPanel hidden={isViewer || !hasData} isViewer={isViewer} />

        <AssignPanel hidden={isViewer || !hasData} isViewer={isViewer} />

        <ResultPanel />

        <footer className="foot" id="footNote">
          Berjalan sepenuhnya di dalam pelayar anda &mdash; fail tidak dimuat naik ke
          mana-mana pelayan.
        </footer>
      </div>

      {/* Mounted last so it sits above everything, and only rendered when it is open. */}
      <LoginDialog />
    </>
  );
}
