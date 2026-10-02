/*
 * FiguresDialog.tsx - where an admin copies in the register's own headline numbers.
 *
 * WHY THIS EXISTS
 * ---------------
 * The uploaded export decides what the FILE lists: that is a fact about one file, so nothing
 * here can change it. "Total aset", "sudah diperiksa" and the register's own "belum
 * diperiksa" are claims about the register - Sistem Pengurusan Aset Alih - and an export may
 * disagree with it (a department missing, an asset written off but still listed, a list
 * exported before the paperwork caught up). Without a way to say so, one bad export makes
 * every figure in the report wrong and there is nothing an admin can do about it.
 *
 * THE THIRD NUMBER IS THE DOUBLE CHECK
 * ------------------------------------
 * "Belum diperiksa" from the register is the figure the report publishes, and the newest
 * file's own count is what it is checked against. That is the number that catches a HALF
 * export: if the register says 6,984 assets are still waiting and the file lists 340, the
 * difference is visible immediately instead of quietly becoming the report.
 *
 * TWO THINGS THIS DIALOG REFUSES TO HIDE
 * --------------------------------------
 * Both are shown LIVE, as the fields are typed, before anything is saved:
 *   1. The register's own arithmetic - total must equal inspected + outstanding. All three
 *      come from the SAME ringkasan, so a difference here is a typing mistake.
 *   2. The register against the file - which is a real difference, not a mistake: it means
 *      the file is not the whole list, or the register is out of date.
 *
 * Clearing all three is a real action ("Kosongkan angka daftar"), not a validation error.
 */
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useApp } from '../state/AppProvider';
import * as msg from '../state/notices';
import type { HistorySummary } from '../types';

export interface FiguresDialogProps {
  open: boolean;
  onClose: () => void;
  /** The report as it stands: both the figures in force and what the data says. */
  summary: HistorySummary;
}

/** A field's text as a number, or null when it is blank (blank = "not set"). */
function typedNumber(value: string): number | null {
  const s = value.trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export default function FiguresDialog({ open, onClose, summary }: FiguresDialogProps) {
  const { api } = useApp();
  const [total, setTotal] = useState('');
  const [inspected, setInspected] = useState('');
  const [outstanding, setOutstanding] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  /* Open on what is stored, so the dialog shows the current answer rather than blanks
     the admin cannot tell apart from "nothing set". */
  useEffect(() => {
    if (!open) return;
    setTotal(summary.total === null ? '' : String(summary.total));
    setInspected(summary.resolved === null ? '' : String(summary.resolved));
    setOutstanding(summary.outstanding === null ? '' : String(summary.outstanding));
    setError('');
    setBusy(false);
  }, [open, summary.total, summary.resolved, summary.outstanding]);

  /* Escape closes it, as a dialog should. */
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  /* What the cards would say if this were saved. An empty field is NOT "use the system's
     count": the register's figures cannot be derived from the uploads, so empty means the
     card stays blank - which is why the line below says so instead of doing arithmetic on
     numbers nobody entered. */
  const effTotal = typedNumber(total);
  const effInspected = typedNumber(inspected);
  const effOutstanding = typedNumber(outstanding);
  const missing = [
    effTotal === null ? 'Total aset' : null,
    effInspected === null ? 'Sudah diperiksa' : null,
    effOutstanding === null ? 'Belum diperiksa' : null,
  ].filter(Boolean);
  const sum = (effInspected || 0) + (effOutstanding || 0);
  const off = sum - (effTotal || 0);
  const offBy = missing.length === 0 && off !== 0;

  /* The register against the newest file: how many assets the register says are still
     waiting, minus how many the file actually listed. Zero means the export agrees. */
  const fileGap = effOutstanding === null ? 0 : effOutstanding - summary.outstandingFile;

  const save = async (payload: {
    totalAssets: number | null; inspected: number | null; outstanding: number | null;
  }) => {
    if (busy) return;
    setBusy(true);
    setError('');
    const res = await api.setFigures(payload);
    setBusy(false);
    if (res.ok && res.figures) {
      api.pushNotice(msg.figuresSavedNotice(res.figures, summary.outstandingFile));
      onClose();
      return;
    }
    setError(res.reason === 'offline'
      ? 'Tiada sambungan D1, jadi angka ini tidak boleh disimpan dari sini.'
      : `Angka tidak dapat disimpan: ${res.error || 'D1 menolak permintaan itu.'}`);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save({
      totalAssets: typedNumber(total),
      inspected: typedNumber(inspected),
      outstanding: typedNumber(outstanding),
    });
  };

  return (
    <div
      className="overlay"
      id="figuresDialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="figuresTitle"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal">
        <h3 id="figuresTitle">Kemas kini angka daftar</h3>
        <div className="body">
          <p>
            Salin <b>Total aset</b>, <b>Sudah diperiksa</b> dan <b>Belum diperiksa</b>{' '}
            daripada ringkasan <b>Sistem Pengurusan Aset Alih</b>. Ketiga-tiganya tidak boleh
            dikira daripada muat naik: setiap fail yang dimuat naik ialah senarai aset yang{' '}
            <b>belum diperiksa</b>, jadi ia tidak memberitahu berapa banyak aset yang dipegang
            atau berapa banyak yang sudah diperiksa.
          </p>
          <p>
            <b>Angka SPAA &quot;belum diperiksa&quot;</b> ialah angka yang laporan paparkan,
            dan kiraan fail <b>({summary.outstandingFile} aset)</b> ialah yang
            dibandingkannya - itulah cara fail yang <b>bukan senarai penuh</b> dapat dikesan.
            Angka daftar yang anda taip <b>kekal sehingga anda menukarnya semula</b>: muat
            naik baharu tidak menimpanya.
          </p>
          <form onSubmit={submit}>
            <label htmlFor="figTotal">Total aset</label>
            <input
              type="number"
              id="figTotal"
              min="0"
              step="1"
              inputMode="numeric"
              placeholder={`Kiraan sistem: ${summary.derived.total}`}
              value={total}
              disabled={busy}
              onInput={(e) => setTotal((e.target as HTMLInputElement).value)}
            />
            <label htmlFor="figInspected">Sudah diperiksa</label>
            <input
              type="number"
              id="figInspected"
              min="0"
              step="1"
              inputMode="numeric"
              placeholder={`Kiraan sistem: ${summary.derived.inspected}`}
              value={inspected}
              disabled={busy}
              onInput={(e) => setInspected((e.target as HTMLInputElement).value)}
            />
            <label htmlFor="figOutstanding">Belum diperiksa (angka SPAA)</label>
            <input
              type="number"
              id="figOutstanding"
              min="0"
              step="1"
              inputMode="numeric"
              placeholder={`Kiraan fail: ${summary.outstandingFile}`}
              value={outstanding}
              disabled={busy}
              onInput={(e) => setOutstanding((e.target as HTMLInputElement).value)}
            />

            {/* (1) The register's own arithmetic: all three come from ONE ringkasan, so a
                difference here is a typo, not a disagreement between two sources. */}
            <p className={offBy ? 'fig-off' : 'note'} id="figCheck">
              {missing.length
                ? `Tanpa ${missing.join(', ')} dan angka lain, kad itu akan menunjukkan "-" (belum ditetapkan).`
                : (off === 0
                  ? `${effInspected} sudah + ${effOutstanding} belum = ${effTotal} - angka daftar sepadan.`
                  : `${effInspected} sudah + ${effOutstanding} belum = ${sum}, bukan ${effTotal} - beza `
                    + `${Math.abs(off)} aset. Angka daftar tidak sepatutnya bercanggah dengan dirinya sendiri: `
                    + 'semak semula angka yang disalin.')}
            </p>

            {/* (2) The register against the newest file - the check that catches a half
                export. Different from the line above: this one is a REAL difference. */}
            <p className={fileGap ? 'fig-off' : 'note'} id="figFileCheck">
              {effOutstanding === null
                ? `Masukkan angka SPAA "belum diperiksa" untuk membandingkannya dengan fail ini (${summary.outstandingFile} aset).`
                : (fileGap === 0
                  ? `SPAA ${effOutstanding} = fail ${summary.outstandingFile} aset - fail yang dimuat naik sepadan dengan daftar.`
                  : `SPAA ${effOutstanding} berbanding fail ${summary.outstandingFile} aset - beza ${Math.abs(fileGap)}. `
                    + (fileGap > 0
                      ? 'Daftar mengatakan lebih banyak aset masih belum diperiksa daripada yang disenaraikan fail ini: kemungkinan fail itu bukan senarai penuh.'
                      : 'Fail ini menyenaraikan lebih banyak aset daripada daftar: kemungkinan daftar sudah basi, atau fail mengandungi aset yang sudah diperiksa.'))}
            </p>

            {summary.total !== null || summary.resolved !== null || summary.outstanding !== null ? (
              <p className="note" id="figSource">
                Ditulis oleh <b>{summary.updatedBy || 'admin'}</b> pada{' '}
                <b>{String(summary.updatedAt || '').slice(0, 16).replace('T', ' ')}</b>.
              </p>
            ) : null}

            {error ? <p className="err" id="figuresError">{error}</p> : null}

            <div className="row">
              <button type="submit" className="primary" id="figSave" disabled={busy}>
                {busy ? 'Menyimpan...' : 'Simpan angka'}
              </button>
              <button
                type="button"
                id="figClear"
                disabled={busy || (summary.total === null && summary.resolved === null
                  && summary.outstanding === null)}
                onClick={() => save({ totalAssets: null, inspected: null, outstanding: null })}
              >
                Kosongkan angka daftar
              </button>
              <button type="button" id="figCancel" onClick={onClose}>Batal</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
