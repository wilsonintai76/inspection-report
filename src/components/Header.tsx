/*
 * Header.jsx - the banner, and the two whole-page actions.
 */
import { useApp } from '../state/AppProvider';
import * as msg from '../state/notices';
import { list } from '../state/notices';

export interface HeaderProps {
  isViewer: boolean;
  onDemo: () => void;
}

export default function Header({ isViewer, onDemo }: HeaderProps) {
  const { api } = useApp();

  const showHelp = () => {
    api.setNotices([{
      ...msg.notice('info', 'Cara guna', [
        list([
          ['Dapatkan senarai daripada sistem e-Harta / JKM dan simpan sebagai fail ', { t: 'b', v: '.xls' }, ' (eksport "Web Page") atau ', { t: 'b', v: '.csv' }, '.'],
          ['Lepaskan ', { t: 'b', v: 'semua' }, ' fail ke dalam kotak di langkah 1 - lebih daripada dua fail pun boleh.'],
          ['Langkah 2: pilih kunci padanan pertindihan dan tapisan.'],
          ['Langkah 3: semak tab ', { t: 'b', v: 'Pertindihan' }, ' dan ', { t: 'b', v: 'Konflik Data' }, ', kemudian eksport ke Excel.'],
        ]),
        'Gabungan, tapisan dan eksport berlaku di dalam pelayar anda - fail asal tidak ke mana-mana.',
        ' Tetapi muat naik oleh admin dihantar ke D1 supaya senarai itu dikongsi dengan semua pengguna.',
      ]),
    }]);
    const box = document.getElementById('notices');
    if (box) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <header className="top">
      <div className="inner">
        <div className="brand-mark" aria-hidden="true">{'\u{1F4CB}'}</div>
        <div>
          <h1>Laporan Aset Yang Belum Diperiksa - PKS</h1>
          <p>
            Gabungkan beberapa fail senarai aset, kesan pertindihan dan konflik data,
            kemudian eksport ke Excel / CSV.
          </p>
        </div>
        <div className="top-actions">
          <button type="button" className="ghost-light" id="btnHelp" onClick={showHelp}>
            {'\u2139 Panduan'}
          </button>
          <button type="button" className="ghost-light" id="btnDemo" hidden={isViewer} onClick={onDemo}>
            Muat contoh
          </button>
        </div>
      </div>
    </header>
  );
}
