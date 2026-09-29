/*
 * setup-access.mjs - create the Cloudflare Access application that makes the admin
 * actions require a sign-in.
 *
 *   node tools/setup-access.mjs --token-file <path> [options]
 *
 * WHY THIS EXISTS
 * ---------------
 * The list itself is public: anybody may read it, and no login is asked for. Only the
 * WRITE endpoints need protecting, so the Access application is scoped to the PATH
 * /api/admin - the prefix the page posts to. Scoping it to the whole hostname would
 * put a login in front of a public list, which is exactly what this design avoids.
 *
 * The `wrangler login` credentials can READ Access (verified) but not create
 * anything - POST /access/apps answers 403 auth.forbidden. Creating the application
 * needs a token with "Access: Apps and Policies: Edit", so this script does the whole
 * job in one repeatable step instead of a dozen dashboard clicks: create the app, add
 * the allow policy, read back the AUD tag and the team domain, and write all four
 * Worker variables into wrangler.toml.
 *
 * It is IDEMPOTENT: running it twice reuses the existing application and policy.
 *
 * The token is read from a file (or an environment variable) and is never printed.
 * Pass --dry-run first to see exactly what would be created.
 *
 *   node tools/setup-access.mjs --token-file %USERPROFILE%\.cf-access-token --dry-run
 *   node tools/setup-access.mjs --token-file %USERPROFILE%\.cf-access-token
 *   npm run cf:deploy
 *
 * Everything runs inside main() and the process is never force-exited: calling
 * process.exit() while fetch is still settling trips an assertion in Node on Windows,
 * which turned a clean "token rejected" message into a garbage exit code.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const configPath = join(root, 'cloudflare', 'wrangler.toml');

const HOSTNAME = 'aset-pks.wilsonintai76.workers.dev';
const ADMIN_PATH = '/api/admin';
const APP_NAME = 'aset-pks (admin)';
const POLICY_NAME = 'Admin PKS';
const API = 'https://api.cloudflare.com/client/v4';

const MISSING = Symbol('flag-not-given');

/** Read a `--flag value` argument. `true` means the flag was given without a value. */
function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  if (v === undefined || v.startsWith('--')) return true;
  return v;
}

const asList = (value) => String(value).split(',').map((s) => s.trim()).filter(Boolean);

const dryRun = process.argv.includes('--dry-run') || process.argv.includes('-n');
const tokenFile = arg('--token-file', '');
const accountArg = arg('--account', '');
const adminArg = arg('--admin', MISSING);
const allowDomainArg = arg('--allow-domain', MISSING);

const admins = adminArg === MISSING ? ['wilsonintai76@gmail.com']
  : (adminArg === true ? [] : asList(adminArg));
/* Nobody but an admin needs a login: readers are anonymous because the list is a
   public document. Pass --allow-domain only if you deliberately want extra staff able
   to sign in (they would still only be able to read). */
const allowDomains = allowDomainArg === MISSING ? []
  : (allowDomainArg === true ? [] : asList(allowDomainArg));

function loadToken() {
  const fromEnv = process.env.CLOUDFLARE_ACCESS_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
  if (fromEnv) return { token: fromEnv.trim(), how: 'pemboleh ubah persekitaran' };
  const file = tokenFile ? String(tokenFile).replace(/^~(?=$|[\\/])/, homedir()) : '';
  if (file && existsSync(file)) return { token: readFileSync(file, 'utf8').trim(), how: `fail ${file}` };
  return { token: '', how: '' };
}

async function main() {
  const { token, how } = loadToken();
  if (!token) {
    console.error('Tiada token. Sediakan token dengan kebenaran "Access: Apps and Policies: Edit",');
    console.error('simpan dalam fail, kemudian:');
    console.error('');
    console.error('  node tools/setup-access.mjs --token-file <laluan fail token> [--dry-run]');
    console.error('');
    console.error('Atau tetapkan CLOUDFLARE_ACCESS_TOKEN dalam terminal anda sendiri.');
    console.error('Jangan tampalkan token ke dalam sembang.');
    return 2;
  }
  console.log(`Token dibaca daripada ${how} (tidak dipaparkan).`);

  const headers = { Authorization: `Bearer ${token}` };
  const api = async (method, path, body) => {
    const res = await fetch(API + path, {
      method,
      headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, ok: res.ok, body: json, text };
  };
  const explain = (res) => {
    const errs = (res.body && res.body.errors) || [];
    return errs.length
      ? errs.map((e) => `${e.code}: ${e.message || e.error || ''}`).join('; ')
      : String(res.text).slice(0, 200);
  };

  /* ------------------------------------------------------------ account -- */

  let accountId = accountArg === true ? '' : String(accountArg || process.env.CLOUDFLARE_ACCOUNT_ID || '');
  if (!accountId) {
    const accts = await api('GET', '/accounts?per_page=50');
    if (!accts.ok) {
      console.error(`Tidak dapat membaca senarai akaun (HTTP ${accts.status}): ${explain(accts)}`);
      console.error('Semak token: ia perlu kebenaran "Access: Apps and Policies: Edit".');
      return 1;
    }
    const list = (accts.body && accts.body.result) || [];
    if (list.length === 0) {
      console.error('Token ini tiada akses kepada mana-mana akaun.');
      return 1;
    }
    if (list.length > 1) {
      console.error('Lebih daripada satu akaun. Nyatakan dengan --account <id>:');
      list.forEach((a) => console.error(`  ${a.id}  ${a.name}`));
      return 1;
    }
    accountId = list[0].id;
    console.log(`Akaun: ${list[0].name} (${accountId})`);
  }

  /* ------------------------------------------------------------ the app -- */

  const apps = await api('GET', `/accounts/${accountId}/access/apps`);
  if (!apps.ok) {
    console.error(`Tidak dapat menyenaraikan aplikasi Access (HTTP ${apps.status}): ${explain(apps)}`);
    if (apps.status === 403) {
      console.error('\nToken ini tiada kebenaran Access. Perlu "Access: Apps and Policies: Edit".');
    }
    return 1;
  }

  let app = ((apps.body && apps.body.result) || [])
    .find((a) => a.domain === HOSTNAME && (a.path || '') === ADMIN_PATH) || null;
  /* An app covering the whole hostname would ask every reader to log in, before the
     Worker ever sees the request. Say so instead of leaving a surprise in place. */
  const wholeHost = ((apps.body && apps.body.result) || [])
    .find((a) => a.domain === HOSTNAME && !a.path) || null;
  if (wholeHost) {
    console.log('');
    console.log(`AMARAN: aplikasi Access "${wholeHost.name}" melindungi SELURUH hosname.`);
    console.log('Ia menjadikan senarai awam memerlukan log masuk. Padam ia dalam dashboard');
    console.log('(Zero Trust > Access > Applications) supaya pembaca awam kekal tanpa log masuk.');
  }

  const include = [];
  admins.forEach((email) => include.push({ email: { email } }));
  allowDomains.forEach((domain) => include.push({ email_domain: { domain } }));

  console.log('');
  console.log('Pelan:');
  console.log(`  aplikasi   ${app ? 'SUDAH ADA' : 'akan dicipta'}  ${APP_NAME}`);
  console.log(`  dilindungi ${HOSTNAME}${ADMIN_PATH}   (senarai awam kekal terbuka)`);
  console.log(`  polisi     ${POLICY_NAME}`);
  console.log(`  benarkan   ${include.map((i) => (i.email ? i.email.email : '@' + i.email_domain.domain)).join(', ')}`);
  console.log(`  admin      ${admins.join(', ')}  (ditulis ke ADMIN_EMAILS)`);
  console.log('');

  if (dryRun) {
    console.log('--dry-run: tiada perubahan dibuat.');
    return 0;
  }

  /* ------------------------------------------------------------ create -- */

  if (!app) {
    const created = await api('POST', `/accounts/${accountId}/access/apps`, {
      name: APP_NAME,
      domain: HOSTNAME,
      path: ADMIN_PATH,
      type: 'self_hosted',
      session_duration: '24h',
      app_launcher_visible: false,
      auto_redirect_to_identity: false,
    });
    if (!created.ok) {
      console.error(`Gagal mencipta aplikasi (HTTP ${created.status}): ${explain(created)}`);
      console.error('\nJika ralat menyebut organisasi Zero Trust, hidupkan Zero Trust sekali dalam');
      console.error('dashboard (Zero Trust > Settings) dan jalankan skrip ini semula.');
      return 1;
    }
    app = created.body.result;
    console.log(`Aplikasi dicipta: ${app.id}`);
  } else {
    console.log(`Aplikasi sedia ada digunakan semula: ${app.id}`);
  }

  const policies = await api('GET', `/accounts/${accountId}/access/apps/${app.id}/policies`);
  const hasPolicy = ((policies.body && policies.body.result) || []).some((p) => p.name === POLICY_NAME);
  if (hasPolicy) {
    console.log('Polisi sedia ada digunakan semula.');
  } else {
    const made = await api('POST', `/accounts/${accountId}/access/apps/${app.id}/policies`, {
      name: POLICY_NAME,
      decision: 'allow',
      include,
    });
    if (!made.ok) {
      console.error(`Gagal mencipta polisi (HTTP ${made.status}): ${explain(made)}`);
      return 1;
    }
    console.log('Polisi dicipta.');
  }

  /* ------------------------------------------------------------ team domain -- */

  let teamDomain = '';
  const org = await api('GET', `/accounts/${accountId}/access/organizations`);
  if (org.ok && org.body && org.body.result && org.body.result.auth_domain) {
    teamDomain = org.body.result.auth_domain;
    console.log(`Team domain daripada API: ${teamDomain}`);
  } else {
    /* The organisation endpoint needs a wider scope than apps do, so fall back to
       reading the team domain out of the redirect Access sends to its login page.
       The probe goes to the PROTECTED path on purpose: the site root no longer
       redirects anywhere, because reading it needs no login. */
    try {
      const res = await fetch(`https://${HOSTNAME}${ADMIN_PATH}/login`, { redirect: 'manual' });
      const loc = res.headers.get('location') || '';
      const m = loc.match(/^https:\/\/([a-z0-9-]+\.cloudflareaccess\.com)/i);
      if (m) {
        teamDomain = m[1];
        console.log(`Team domain daripada ubah hala: ${teamDomain}`);
      }
    } catch (e) { /* reported below */ }
  }

  const aud = app.aud || '';
  if (!aud || !teamDomain) {
    console.error('');
    console.error('Aplikasi dan polisi sudah wujud, tetapi satu nilai tidak dapat dibaca:');
    console.error(`  ACCESS_AUD         = ${aud || '(tidak terbaca)'}`);
    console.error(`  ACCESS_TEAM_DOMAIN = ${teamDomain || '(tidak terbaca)'}`);
    console.error('Ambil kedua-duanya daripada dashboard (Zero Trust > Access > Applications)');
    console.error('dan isikan sendiri dalam cloudflare/wrangler.toml.');
    return 1;
  }

  /* ------------------------------------------------------------ patch config -- */

  let toml = readFileSync(configPath, 'utf8');
  const setVar = (key, value) => {
    const re = new RegExp(`^(${key}\\s*=\\s*)"[^"]*"`, 'm');
    if (!re.test(toml)) throw new Error(`Kunci ${key} tidak dijumpai dalam wrangler.toml`);
    toml = toml.replace(re, `$1"${value}"`);
  };
  setVar('ACCESS_MODE', 'enforce');
  setVar('ADMIN_EMAILS', admins.join(','));
  setVar('ACCESS_TEAM_DOMAIN', teamDomain);
  setVar('ACCESS_AUD', aud);
  writeFileSync(configPath, toml, 'utf8');

  console.log('');
  console.log('wrangler.toml dikemas kini:');
  console.log('  ACCESS_MODE        = "enforce"');
  console.log(`  ADMIN_EMAILS       = "${admins.join(',')}"`);
  console.log(`  ACCESS_TEAM_DOMAIN = "${teamDomain}"`);
  console.log(`  ACCESS_AUD         = "${aud}"`);
  console.log('');
  console.log('Langkah seterusnya:');
  console.log('  npm run cf:deploy     # hantar pemboleh ubah ke Worker');
  console.log('  npm run cf:smoke      # sahkan; tulisan tanpa log masuk patut ditolak');
  console.log('');
  console.log(`Buka https://${HOSTNAME} - senarai terbuka tanpa log masuk.`);
  console.log('Butang "Admin log masuk" pada panel sambungan yang meminta log masuk.');
  return 0;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((err) => {
    console.error('Ralat tidak dijangka: ' + (err && err.stack ? err.stack : String(err)));
    process.exitCode = 1;
  });
