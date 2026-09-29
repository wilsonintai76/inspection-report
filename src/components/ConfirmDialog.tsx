/*
 * ConfirmDialog.tsx - one question, two answers, and the words are the caller's.
 *
 * It exists because the delete-everything action is the one thing in this application
 * that cannot be undone from the page. A destructive button that fires immediately is a
 * trap; a browser `confirm()` cannot be styled, cannot be read by the suites, and shows
 * a URL in the title bar on some browsers.
 *
 * Deliberately NOT a global dialog store: the only caller owns the open/closed state, so
 * there is nothing to keep in sync with the application state. The ids below are fixed
 * because the browser suites drive this dialog by name.
 */
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** The question, in full. It must name what will be lost - a vague warning is useless. */
  message: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open, title, message, confirmLabel, onConfirm, onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  /* Escape cancels, and the destructive button is NOT focused first: a stray Enter must
     not delete anything. Focus goes to the dialog itself. */
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    const t = setTimeout(() => { if (confirmRef.current) confirmRef.current.blur(); }, 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(t);
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="overlay" id="confirmDialog" role="alertdialog" aria-modal="true"
      aria-labelledby="confirmTitle"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="modal">
        <h3 id="confirmTitle">{title}</h3>
        <div className="body">
          <p id="confirmMessage">{message}</p>
          <div className="row">
            <button type="button" className="danger" id="confirmYes" onClick={onConfirm}>
              {confirmLabel}
            </button>
            <button type="button" id="confirmNo" onClick={onCancel} ref={confirmRef}>
              Batal
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
