/*
 * LoginDialog.jsx - the way in for an admin, opened from "Muat naik".
 *
 * A reader who clicks an upload button is asking a question, not making a mistake, so
 * this answers it: who may upload here, and what to do about it. The dialog never
 * pretends a login is possible when it is not - the Worker reports which method it
 * accepts (loginMethod) and the dialog shows exactly that one thing:
 *
 *   "password"  the form, for a deployment using the ADMIN_PASSWORD secret
 *   "access"    a link into Cloudflare Access, which is the only thing that can
 *               authenticate in that mode
 *   "none"      an explanation, because a wrong button teaches the wrong thing
 *
 * The password never reaches application state: it is passed straight to the Worker,
 * which answers with an HttpOnly cookie. Nothing here stores or logs it.
 */
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useApp } from '../state/AppProvider';

/** Why the dialog cannot log anybody in, when no method is available. */
function unavailableReason(mode: string, offline: boolean, configured: boolean): string {
  if (offline) {
    return 'Halaman ini dibuka daripada fail (tiada Worker), jadi tiada log masuk. Buka'
      + ' alamat Worker untuk memuat naik.';
  }
  if (mode === 'password' && !configured) {
    return 'Mod kata laluan dipilih, tetapi rahsia ADMIN_PASSWORD belum ditetapkan untuk'
      + ' Worker ini, jadi tiada siapa boleh memuat naik. Tetapkan rahsia itu, kemudian'
      + ' cuba lagi.';
  }
  if (mode === 'open') {
    return 'Halaman ini awam dan baca sahaja: log masuk admin belum disediakan. Pilih satu'
      + ' cara log masuk (kata laluan atau Cloudflare Access) sebelum sesiapa boleh memuat naik.';
  }
  return 'Log masuk admin tidak tersedia untuk tetapan ini.';
}

export default function LoginDialog() {
  const { state, api } = useApp();
  const { me, loginOpen } = state;
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  /* Start clean every time it opens, and put the cursor where the admin expects it. */
  useEffect(() => {
    if (!loginOpen) return undefined;
    setPassword('');
    setError('');
    const t = setTimeout(() => {
      if (inputRef.current) inputRef.current.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [loginOpen]);

  /* Escape closes it, as a dialog should. */
  useEffect(() => {
    if (!loginOpen) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') api.closeLogin();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [loginOpen, api]);

  if (!loginOpen) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const res = await api.login(password);
    setBusy(false);
    // A successful login closes the dialog from inside api.login(), which swaps this
    // screen for the admin dashboard. Only a refusal has anything to say here.
    if (!res.ok) setError(res.error || 'Log masuk gagal.');
  };

  const canUsePassword = me.loginMethod === 'password' && me.passwordConfigured;

  return (
    <div className="overlay" id="loginDialog" role="dialog" aria-modal="true" aria-labelledby="loginTitle"
      onMouseDown={(e) => { if (e.target === e.currentTarget) api.closeLogin(); }}>
      <div className="modal">
        <h3 id="loginTitle">Log masuk admin</h3>
        <div className="body">
          {canUsePassword ? (
            <>
              <p>
                Memuat naik senarai aset menukar apa yang dilihat oleh <b>semua</b> orang,
                jadi ia memerlukan log masuk admin. Masukkan kata laluan admin.
              </p>
              <form onSubmit={submit}>
                <label htmlFor="loginPassword">Kata laluan admin</label>
                <input
                  type="password"
                  id="loginPassword"
                  name="password"
                  autoComplete="current-password"
                  value={password}
                  disabled={busy}
                  /* onInput, not onChange: React skips onChange when the value was set
                     programmatically, which is exactly how the suites type. */
                  onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
                  ref={inputRef}
                />
                {error ? <p className="err" id="loginError">{error}</p> : null}
                <div className="row">
                  <button type="submit" className="primary" id="loginSubmit" disabled={busy}>
                    {busy ? 'Menyemak...' : 'Log masuk'}
                  </button>
                  <button type="button" id="loginCancel" onClick={() => api.closeLogin()}>
                    Batal
                  </button>
                </div>
              </form>
            </>
          ) : me.loginMethod === 'access' ? (
            <>
              <p>
                Memuat naik senarai aset menukar apa yang dilihat oleh <b>semua</b> orang,
                jadi ia memerlukan log masuk sebagai admin.
              </p>
              <div className="row">
                <a className="primary" id="loginAccess" href={me.loginPath || '/api/admin/login'}>
                  {'\u{1F511} Log masuk (Cloudflare Access)'}
                </a>
                <button type="button" id="loginCancel" onClick={() => api.closeLogin()}>
                  Batal
                </button>
              </div>
            </>
          ) : (
            <>
              <p id="loginUnavailable">{unavailableReason(me.mode, me.offline, me.passwordConfigured)}</p>
              <div className="row">
                <button type="button" id="loginCancel" onClick={() => api.closeLogin()}>
                  Tutup
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
