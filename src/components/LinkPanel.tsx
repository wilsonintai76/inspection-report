/*
 * LinkPanel.jsx - the state of the link to D1, and the two doors to the admin role.
 *
 * Records live in D1, not in the browser, so the state of that link is part of what the
 * page means: history and manual department assignments cannot be read or saved without
 * it. It is therefore always visible, never collapsed.
 *
 * This panel is also where the access model becomes visible to a reader. It is NOT the
 * access control - the Worker refuses writes from anyone it cannot identify as an admin.
 * What it does is avoid offering an action that could not succeed, and say which of the
 * three modes the deployment is in, because "baca sahaja" and "mod terbuka" look
 * identical on screen until someone tries to upload.
 */
import { useApp } from '../state/AppProvider';
import { Pill, Panel } from './ui';
import type { ReactNode } from 'react';
import type { MeState } from '../types';

/**
 * One sentence per mode, saying who may write and why. Written out rather than left for
 * the reader to infer.
 */
function ModeNote({ me, isViewer }: { me: MeState; isViewer: boolean }) {
  if (me.mode === 'enforce') {
    return (
      <div className="note mt-1.5">
        {me.role === 'admin'
          ? 'Anda log masuk sebagai admin - memuat naik, memadam titik masa dan menukar tetapan Bahagian dibenarkan.'
          : (
            <>
              Senarai ini terbuka kepada semua orang. Untuk memuat naik atau menukar tetapan,{' '}
              <b>log masuk sebagai admin</b>.
            </>
          )}
      </div>
    );
  }
  if (me.mode === 'open') {
    return (
      <div className="note mt-1.5">
        <b>Log masuk admin belum disediakan.</b> Halaman ini awam dan <b>baca sahaja</b>:
        tiada siapa boleh memuat naik atau memadam. Aktifkan Cloudflare Access pada laluan{' '}
        <b>/api/admin</b> dan tetapkan <b>ACCESS_MODE = &quot;enforce&quot;</b> untuk membuka
        tindakan admin (langkahnya dalam README).
      </div>
    );
  }
  if (me.mode === 'trusted') {
    return (
      <div className="note mt-1.5">
        <b>Mod &quot;trusted&quot; tiada log masuk.</b> Sesiapa yang mempunyai pautan ini boleh
        memuat naik dan memadam rekod, jadi jangan gunakannya pada halaman awam - tetapkan{' '}
        <b>ACCESS_MODE = &quot;enforce&quot;</b> untuk mengasingkan admin daripada pembaca.
      </div>
    );
  }
  if (me.mode === 'password') {
    return (
      <div className="note mt-1.5">
        {me.role === 'admin' ? (
          <>
            Anda log masuk sebagai admin - memuat naik, memadam titik masa dan menukar tetapan
            Bahagian dibenarkan. Log keluar untuk kembali kepada paparan awam.
          </>
        ) : me.passwordConfigured ? (
          <>
            Senarai ini terbuka kepada semua orang, tetapi <b>memuat naik memerlukan log masuk
            admin</b>: tekan <b>Muat naik senarai</b> pada tab Senarai Semasa.
          </>
        ) : (
          <>
            <b>Log masuk admin belum disediakan pada Worker ini</b> (rahsia ADMIN_PASSWORD belum
            ditetapkan), jadi halaman ini <b>baca sahaja</b> untuk semua orang. Tetapkan rahsia
            itu - lihat README, bahagian &quot;Log masuk admin&quot; - kemudian tekan{' '}
            <b>Muat naik senarai</b>.
          </>
        )}
      </div>
    );
  }
  return (
    <div className="note mt-1.5">
      Halaman ini dibuka daripada fail tempatan, jadi tiada Worker untuk dihubungi.
      {isViewer ? '' : ' Gabung, tapis dan eksport masih berfungsi; sejarah dan tetapan Bahagian tidak.'}
    </div>
  );
}

export default function LinkPanel({ isViewer }: { isViewer: boolean }) {
  const { state, api } = useApp();
  const { me, d1 } = state;

  const rolePill = me.mode === 'enforce'
    ? (me.role === 'admin'
      ? <Pill kind="ok">Admin</Pill>
      : <Pill>Akses awam &middot; baca sahaja</Pill>)
    : (me.mode === 'trusted'
      ? <Pill kind="warn">Mod terbuka</Pill>
      : (me.mode === 'password'
        ? (me.role === 'admin'
          ? <Pill kind="ok">Admin</Pill>
          : <Pill kind="warn">{me.passwordConfigured
            ? 'Baca sahaja'
            : 'Baca sahaja \u00b7 log masuk belum diset'}</Pill>)
        : <Pill kind="warn">Baca sahaja</Pill>));

  let body: ReactNode;
  if (!d1.checked) {
    body = <Pill>Menyemak sambungan...</Pill>;
  } else if (!d1.up) {
    body = (
      <>
        <Pill kind="bad">Tiada sambungan D1</Pill>{' '}
        <span className="note">
          Gandingkan fail, tapis dan eksport masih berfungsi sepenuhnya. Tetapi{' '}
          <b>sejarah pemeriksaan</b> dan <b>penetapan Bahagian</b> memerlukan pangkalan data,
          jadi kedua-duanya tidak tersedia di sini. Buka halaman ini daripada alamat Worker
          (contohnya <b>https://aset-pks.&lt;akaun&gt;.workers.dev</b>) supaya rekod disimpan
          dan dikongsi.
        </span>
        {d1.lastError ? (
          <div className="note mt-1.5"><b>Ralat terakhir:</b> {d1.lastError}</div>
        ) : null}
      </>
    );
  } else {
    const info = d1.info;
    body = (
      <>
        {rolePill} <Pill kind="ok">D1 disambung</Pill>{' '}
        <span className="note" id="serverLinkText">
          {`${(info && info.observations) || 0} pemerhatian, ${(info && info.assets) || 0} aset dalam pangkalan data`}
          {me.email ? <> &middot; {me.email}</> : null}
          {d1.pushed ? <> &middot; {d1.pushed} dihantar sesi ini</> : null}
          {d1.lastError ? <> &middot; <b>ralat terakhir:</b> {d1.lastError}</> : null}
        </span>
        <ModeNote me={me} isViewer={isViewer} />
      </>
    );
  }

  const showLogin = me.mode === 'enforce' && me.role === 'viewer' && !state.preview;
  /* A password session is a real session, so an admin can end it. The link is a plain
     anchor on purpose: sign-out must work even if the page's state is stale. */
  const showLogout = (me.mode === 'enforce' || me.mode === 'password')
    && me.role === 'admin' && !state.preview;
  const showPreview = me.role === 'admin' && me.checked && !me.offline;

  return (
    <Panel id="panelLink" step="&#9781;" title="Sambungan D1"
      hint="Rekod disimpan dalam pangkalan data D1 (Cloudflare)" bodyStyle={{ paddingTop: 12 }}>
      {/* This element is read by the suites via #serverLink; the text lives inside. */}
      <div id="serverLink">{body}</div>
      <div className="toolbar plain no-print pt-2.5">
        <a id="adminLogin" className="link-btn" href={me.loginPath || '/api/admin/login'} hidden={!showLogin}>
          {'\u{1F511} Admin log masuk'}
        </a>
        <a id="adminLogout" className="link-btn" href="/api/admin/logout" hidden={!showLogout}>
          Log keluar
        </a>
        <button type="button" id="btnPreview" hidden={!showPreview} onClick={() => api.togglePreview()}>
          {state.preview ? 'Kembali ke mod admin' : 'Pratonton sebagai viewer'}
        </button>
        <div className="spacer" />
        <span className="note" id="roleNote">
          {state.preview ? <><b>Pratonton viewer</b> - tindakan admin disembunyikan buat sementara.</> : ''}
        </span>
      </div>
    </Panel>
  );
}
