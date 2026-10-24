// Developer Panel — platform administration (added v3.15.0).
// Separate page/bundle from the main app (see vite.config.js + admin.html),
// same pattern as the Live Catalog. Only platform admins (the server-set
// platformAdmin claim, src/modules/admin-claim.js) get past the gate below;
// that check only drives the UI — firestore.rules is what actually limits
// reading/changing other users' docs to admins.
//
// Today it covers the single-business app: access requests, users, the
// shared eBay connection and the eBay error library. The Businesses and
// Credits & cost sections arrive with the multi-business work
// (docs/multi-tenant.md).
import './config/firebase.js';
import { escapeHtml } from './modules/format-utils.js';
import { EBAY_ERROR_LIBRARY } from './modules/ebay-error-hints.js';
import { APP_VERSION, APP_VERSION_DATE } from './modules/version.js';
import { initUpdateBanner } from './ui/update-banner.js';
import { jsonAuthHeaders } from './modules/api-auth.js';
import { loadAdminClaim } from './modules/admin-claim.js';
import { tokenEmailVerified } from './modules/email-verification.js';
import { AI_CALL_LABELS } from './domain/ai-usage.js';
import { applyTheme, normalizeTheme } from './ui/theme.js';

function db(){ return window.db; }
function fns(){ return window.firestoreFns; }

let users = [];
let currentUid = null;
// Admins' uids, from the "Admin access" card (only the server can list
// other accounts' claims); marks them in the Users tab.
let adminUids = new Set();
// Sign-in details per uid from the server (api/_users.js): emailVerified,
// disabled, lastSignIn. Empty if that call fails; the lists still work.
let authInfo = {};

const fmtDate = (v) => {
  if (!v) return '—';
  try{ return new Date(v).toLocaleString('en-US'); }catch(e){ return String(v); }
};

// ---------- AUTH ----------
function showAuthForm(){
  document.getElementById('authOverlay').style.display = 'flex';
  document.getElementById('authCheckingState').style.display = 'none';
  document.getElementById('authFormState').style.display = 'block';
}
function hideAuthOverlay(){
  document.getElementById('authOverlay').style.display = 'none';
  document.body.classList.remove('auth-locked');
}
function setAuthError(msg){
  const el = document.getElementById('authError');
  el.style.display = msg ? 'block' : 'none';
  el.textContent = msg || '';
}

document.getElementById('authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  setAuthError('');
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const submitBtn = document.getElementById('authSubmitBtn');
  submitBtn.disabled = true;
  try{
    await window.authFns.signInWithEmailAndPassword(window.auth, email, password);
  }catch(err){
    setAuthError(err.message || 'Something went wrong.');
  }finally{
    submitBtn.disabled = false;
  }
});

function waitForFirebaseReady(){
  return new Promise(resolve => {
    (function check(){ if (window.firebaseReady) resolve(); else setTimeout(check, 50); })();
  });
}

waitForFirebaseReady().then(() => {
  window.authFns.onAuthStateChanged(window.auth, async (user) => {
    if (!user){ showAuthForm(); return; }
    hideAuthOverlay();
    // Not signing a non-admin out here: the session is shared with the main
    // app on the same origin, so that would log them out of it too.
    const verified = await tokenEmailVerified(user);
    if (!(await loadAdminClaim(user)) || !verified){
      document.getElementById('adDeniedEmail').textContent = user.email || user.uid;
      // Verified emails are required for admins too (v3.18.4).
      if (!verified) document.getElementById('adDeniedEmail').textContent += ' (email not verified: verify it in the app under Settings → Account, then reload)';
      document.getElementById('adDenied').style.display = 'block';
      return;
    }
    currentUid = user.uid;
    await loadAdminBusiness(user.uid);
    await loadAdminAppearance();
    document.getElementById('adHeaderSub').textContent = `Platform administration · signed in as ${user.email}`;
    document.getElementById('adTabs').style.display = 'flex';
    document.getElementById('adMain').style.display = 'block';
    initTabs();
    await loadUsers();
    renderApp();
  });
});

// ---------- BUSINESS ----------
// The business whose data the Backup and eBay errors tabs read: the admin's
// own (users/{uid}.activeBizId), once it's live (v3.17.1). Platform admins
// may read any business's data (firestore.rules). A Businesses tab to pick
// another one comes with onboarding (docs/multi-tenant.md step 5).
let adminBiz = null; // { id, name } or null = pre-business data

async function loadAdminBusiness(uid){
  adminBiz = null;
  try{
    const { doc, getDoc } = fns();
    const me = await getDoc(doc(db(), 'users', uid));
    const bizId = me.exists() ? me.data().activeBizId : null;
    if (!bizId) return;
    const biz = await getDoc(doc(db(), 'businesses', bizId));
    if (biz.exists() && biz.data().live === true) adminBiz = { id: bizId, name: biz.data().name || bizId };
  }catch(e){
    console.warn('Could not read the business; the panel shows the pre-business data.', e);
  }
}

// ---------- APPEARANCE (v3.24.8) ----------
// The panel uses the theme the business chose in Settings → Appearance
// (config/settings.theme). Before that is known, or with no business yet, it
// uses the theme last applied on this device: the same fallback the app uses.
async function loadAdminAppearance(){
  let key = null;
  try{
    const { doc, getDoc } = fns();
    const ref = adminBiz
      ? doc(db(), 'businesses', adminBiz.id, 'config', 'settings')
      : doc(db(), 'app_config', 'settings');
    const snap = await getDoc(ref);
    if (snap.exists()) key = snap.get('theme') || null;
  }catch(e){
    // The device's theme below.
  }
  if (!key){
    try{ key = localStorage.getItem('cc.theme'); }catch(e){ /* default */ }
  }
  applyTheme(normalizeTheme(key), { remember: false });
}

// ---------- TABS ----------
const loadedTabs = new Set();

function initTabs(){
  document.querySelectorAll('.ad-tab').forEach(btn => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  });
}

function showTab(tab){
  document.querySelectorAll('.ad-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('[data-panel]').forEach(p => { p.style.display = p.dataset.panel === tab ? 'block' : 'none'; });
  if (loadedTabs.has(tab)) return;
  loadedTabs.add(tab);
  if (tab === 'ebay') renderEbay();
  if (tab === 'errors') renderErrors();
  if (tab === 'backup') renderBackup();
  if (tab === 'ai') renderAi();
}

// ---------- USERS (Approvals + Users tabs share one load) ----------
async function loadUsers(){
  const approvalsEl = document.getElementById('panelApprovals');
  approvalsEl.innerHTML = '<div class="ad-card ad-empty">Loading…</div>';
  try{
    const { collection, getDocs } = fns();
    const snap = await getDocs(collection(db(), 'users'));
    users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    users.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    authInfo = await platformAction({ action: 'users_auth_info' }).then(r => r.users || {}).catch(e => {
      console.error('Failed to load sign-in details:', e);
      return {};
    });
  }catch(e){
    console.error('Failed to load users:', e);
    approvalsEl.innerHTML = `<div class="ad-card"><div class="ebay-status-box error">Could not load users: ${escapeHtml(e.message || String(e))}</div></div>`;
    document.getElementById('panelUsers').innerHTML = '';
    return;
  }
  renderApprovals();
  renderUsers();
}

function statusPill(u){
  if (u.status === 'removed') return '<span class="ad-pill unknown">removed</span>';
  const status = u.status === 'approved' ? 'approved' : 'pending';
  return `<span class="ad-pill ${status}">${status}</span>`;
}
// " · email verified · last sign-in …" from the server's details.
function authMeta(u){
  const a = authInfo[u.id];
  if (!a) return '';
  if (a.missing) return ' · no login (deleted)';
  return ` · email ${a.emailVerified ? 'verified' : 'not verified'}${a.disabled ? ' · login disabled' : ''}${a.lastSignIn ? ` · last sign-in ${escapeHtml(fmtDate(a.lastSignIn))}` : ''}`;
}
function rolePill(u){
  return u.role === 'employee' ? '<span class="ad-pill employee">employee</span>' : '';
}

function renderApprovals(){
  const el = document.getElementById('panelApprovals');
  const pending = users.filter(u => u.status !== 'approved' && u.status !== 'removed');
  const badge = document.getElementById('adPendingBadge');
  badge.textContent = String(pending.length);
  badge.style.display = pending.length ? 'inline-block' : 'none';

  el.innerHTML = `
    <div class="ad-card">
      <h3>Access requests</h3>
      <div class="ad-desc">People who created an account and are waiting for access. Denying deletes their request and their login; they can sign up again later.</div>
      ${pending.length ? pending.map(u => `
        <div class="ad-row">
          <div>
            <div class="ad-main-text">${escapeHtml(u.email || u.id)}</div>
            <div class="ad-meta">Requested ${escapeHtml(fmtDate(u.createdAt))}${authMeta(u)}</div>
          </div>
          <div class="ad-actions">
            <button class="ad-btn" data-approve="${escapeHtml(u.id)}">Approve</button>
            <button class="ad-btn danger" data-deny="${escapeHtml(u.id)}">Deny</button>
          </div>
        </div>`).join('') : '<div class="ad-empty">No pending requests.</div>'}
    </div>`;

  el.querySelectorAll('[data-approve]').forEach(btn => btn.addEventListener('click', () => approveUser(btn, btn.dataset.approve)));
  el.querySelectorAll('[data-deny]').forEach(btn => btn.addEventListener('click', () => {
    if (!confirm('Deny this request? Their login is deleted; they can sign up again later.')) return;
    userAction(btn, 'user_deny', btn.dataset.deny);
  }));
}

function renderUsers(){
  const el = document.getElementById('panelUsers');
  const approvedCount = users.filter(u => u.status === 'approved').length;
  const removedCount = users.filter(u => u.status === 'removed').length;
  el.innerHTML = `
    <div class="ad-card">
      <h3>Users (${users.length})</h3>
      <div class="ad-desc">${approvedCount} approved · ${users.length - approvedCount - removedCount} pending${removedCount ? ` · ${removedCount} removed` : ''}. Employees only see the Catalog tab. Remove disables the login and signs it out everywhere; Restore undoes it.</div>
      ${users.length ? users.map(u => {
        const isSelf = u.id === currentUid;
        const isApproved = u.status === 'approved';
        const isEmployee = u.role === 'employee';
        const isRemoved = u.status === 'removed';
        const isAdmin = adminUids.has(u.id);
        return `
        <div class="ad-row">
          <div>
            <div class="ad-main-text">${escapeHtml(u.email || u.id)}${statusPill(u)}${rolePill(u)}${isSelf ? ' <span class="ad-meta">(you)</span>' : ''}</div>
            <div class="ad-meta">Created ${escapeHtml(fmtDate(u.createdAt))}${isAdmin ? ' · admin' : ''}${authMeta(u)}</div>
          </div>
          ${isSelf || isAdmin ? '' : isRemoved ? `
          <div class="ad-actions">
            <button class="ad-btn secondary" data-restore="${escapeHtml(u.id)}">Restore</button>
          </div>` : `
          <div class="ad-actions">
            ${isApproved
              ? `<button class="ad-btn secondary" data-revoke="${escapeHtml(u.id)}">Revoke access</button>`
              : `<button class="ad-btn" data-approve="${escapeHtml(u.id)}">Approve</button>`}
            ${isApproved ? `<button class="ad-btn secondary" data-role="${escapeHtml(u.id)}" data-next-role="${isEmployee ? 'owner' : 'employee'}">${isEmployee ? 'Make full access' : 'Make employee'}</button>` : ''}
            <button class="ad-btn danger" data-remove="${escapeHtml(u.id)}">Remove</button>
          </div>`}
        </div>`;
      }).join('') : '<div class="ad-empty">No users yet.</div>'}
    </div>`;

  el.querySelectorAll('[data-approve]').forEach(btn => btn.addEventListener('click', () => approveUser(btn, btn.dataset.approve)));
  el.querySelectorAll('[data-revoke]').forEach(btn => btn.addEventListener('click', () => {
    if (!confirm('Revoke access? They go back to "pending" and lose access until approved again.')) return;
    updateUser(btn, btn.dataset.revoke, { status: 'pending' });
  }));
  el.querySelectorAll('[data-role]').forEach(btn => btn.addEventListener('click', () =>
    updateUser(btn, btn.dataset.role, { role: btn.dataset.nextRole })));
  el.querySelectorAll('[data-remove]').forEach(btn => btn.addEventListener('click', () => {
    if (!confirm('Remove this user? Their login is disabled and signed out on every device. Nothing is deleted; Restore undoes it.')) return;
    userAction(btn, 'user_remove', btn.dataset.remove);
  }));
  el.querySelectorAll('[data-restore]').forEach(btn => btn.addEventListener('click', () =>
    userAction(btn, 'user_restore', btn.dataset.restore)));
}

// Approving someone whose email isn't verified asks first (v3.18.3):
// verified emails will be required, and an unverified address may not
// even belong to them.
function approveUser(btn, uid){
  const a = authInfo[uid];
  if (a && !a.missing && !a.emailVerified &&
      !confirm("This person hasn't verified their email yet. Approve anyway?\n\nOnce verified emails are required, they'll need to verify it (from the app) before they can use it.")) return;
  updateUser(btn, uid, { status: 'approved' });
}

async function updateUser(btn, uid, fields){
  btn.disabled = true;
  try{
    const { doc, setDoc } = fns();
    await setDoc(doc(db(), 'users', uid), fields, { merge: true });
    await loadUsers();
  }catch(e){
    btn.disabled = false;
    alert(`Could not update this user: ${e.message || e}`);
  }
}

// Remove / Restore / Deny go through the server (api/_users.js): only
// Firebase Admin can disable or delete a login.
async function userAction(btn, action, uid){
  btn.disabled = true;
  try{
    await platformAction({ action, uid });
    await loadUsers();
  }catch(e){
    btn.disabled = false;
    alert(`Could not update this user: ${e.message || e}`);
  }
}

// ---------- EBAY CONNECTION ----------
// Shows the shared connection's status only, never the tokens themselves.
async function renderEbay(){
  const el = document.getElementById('panelEbay');
  el.innerHTML = '<div class="ad-card ad-empty">Loading…</div>';
  // Since v3.16.0 the tokens live only on the server; this asks it for the
  // connection's status (api/ebay-auth.js action=status).
  let t = null;
  try{
    const res = await fetch('/api/ebay-auth?action=status', { method: 'POST', headers: await jsonAuthHeaders(), body: '{}' });
    t = await res.json().catch(() => null);
    if (!res.ok) throw new Error((t && t.error) || `HTTP ${res.status}`);
  }catch(e){
    el.innerHTML = `<div class="ad-card"><div class="ebay-status-box error">Could not load the eBay connection: ${escapeHtml(e.message || String(e))}</div></div>`;
    return;
  }
  if (!t || !t.connected){
    el.innerHTML = `<div class="ad-card"><h3>eBay connection</h3><div class="ebay-status-box pending">Not connected. Connect from the main app: Settings → eBay.</div></div>`;
    return;
  }
  const expiresAt = (t.connected_at || 0) + (t.expires_in || 7200) * 1000;
  const accessValid = Date.now() < expiresAt;
  el.innerHTML = `
    <div class="ad-card">
      <h3>eBay connection</h3>
      <div class="ad-desc">Your store's connection, held on the server (ebay_connections/{store id}; the app never sees the tokens). Each store connects its own eBay account.</div>
      <dl class="ad-kv">
        <dt>Account</dt><dd>${escapeHtml(t.sellerUsername || 'unknown')}</dd>
        <dt>Access token</dt><dd>${accessValid ? `valid until ${escapeHtml(fmtDate(expiresAt))}` : 'expired (the server refreshes it on next use)'}</dd>
        <dt>Last issued</dt><dd>${escapeHtml(fmtDate(t.connected_at))}</dd>
        <dt>Last connection test</dt><dd>${escapeHtml(fmtDate(t.lastTestedAt))}</dd>
        ${t.connectedBy ? `<dt>Connected by</dt><dd>${escapeHtml(t.connectedBy)}</dd>` : ''}
      </dl>
    </div>`;
}

// ---------- EBAY ERROR LIBRARY ----------
async function renderErrors(){
  const el = document.getElementById('panelErrors');
  el.innerHTML = '<div class="ad-card ad-empty">Loading…</div>';
  let log = [];
  try{
    const { collection, getDocs } = fns();
    const ref = adminBiz ? collection(db(), 'businesses', adminBiz.id, 'ebay_error_log') : collection(db(), 'ebay_error_log');
    const snap = await getDocs(ref);
    log = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }catch(e){
    el.innerHTML = `<div class="ad-card"><div class="ebay-status-box error">Could not load the eBay error log: ${escapeHtml(e.message || String(e))}<br>If this says "permission", the Firestore rules in the Console are older than v3.14.2 (firestore.rules).</div></div>`;
    return;
  }
  log.sort((a, b) => (b.count || 0) - (a.count || 0));
  const unknown = log.filter(e => !e.libraryKey);
  const total = log.reduce((sum, e) => sum + (e.count || 0), 0);

  const row = (e) => {
    const libTitle = e.libraryKey ? (EBAY_ERROR_LIBRARY.find(entry => entry.key === e.libraryKey)?.title || e.libraryKey) : null;
    return `
      <div class="ad-row" style="display:block;">
        <div class="ad-main-text">${e.count || 0}× ${e.code ? `eBay ${escapeHtml(String(e.code))}` : 'no code'}${libTitle ? ` <span class="ad-pill approved">${escapeHtml(libTitle)}</span>` : ' <span class="ad-pill unknown">not in library</span>'}</div>
        <div class="ad-err-msg">${escapeHtml(e.message || '')}</div>
        <div class="ad-meta">Last seen ${escapeHtml(fmtDate(e.lastSeen))}${e.step ? ` · step: ${escapeHtml(e.step)}` : ''}${e.lastItem?.name ? ` · last item: ${escapeHtml(e.lastItem.productCode ? e.lastItem.productCode + ' ' : '')}${escapeHtml(e.lastItem.name)}` : ''}</div>
      </div>`;
  };

  el.innerHTML = `
    <div class="ad-card">
      <h3>eBay publish errors</h3>
      <div class="ad-desc">${adminBiz ? `Business: ${escapeHtml(adminBiz.name)}. ` : ''}${log.length} distinct error${log.length === 1 ? '' : 's'}, ${total} occurrence${total === 1 ? '' : 's'} in total, most frequent first. ${unknown.length} not in the error library yet; those are candidates for new library entries (src/modules/ebay-error-hints.js).</div>
      ${log.length ? log.map(row).join('') : '<div class="ad-empty">No eBay errors logged yet.</div>'}
    </div>`;
}

// ---------- BACKUP ----------
// Downloads the app's Firestore data as one JSON file (v3.15.5). Since the
// business switch (v3.17.1) the main backup reads the business
// (businesses/{bizId} and its subcollections) plus users; the frozen
// pre-business root collections have their own, secondary button until
// they're removed. Read-only: there is deliberately no restore button;
// restoring would be written for the case at hand.
// Left out on purpose:
//  - ebay_connections: it's a credential (refresh token), and the browser
//    can't read it anyway (server only). Reconnecting eBay replaces it.
//  - ebay_category_cache: rebuilt automatically on use.
// Photos stay in Firebase Storage; items keep their URLs.
const BUSINESS_BACKUP_SUBCOLLECTIONS = [
  'items', 'drafts', 'liveSessions', 'liveItems', 'ebay_error_log',
  'options', 'counters', 'config', 'members',
];
const ROOT_BACKUP_COLLECTIONS = [
  'items', 'drafts', 'users', 'app_config', 'app_settings', 'ebay_error_log',
  'liveSessions', 'liveItems', 'live_catalog_options',
];

// What a backup reads: [{ key, path: [...] }] collection paths, keyed in
// the JSON by their full path.
function backupPlan(kind){
  if (kind === 'business' && adminBiz){
    return [
      ...BUSINESS_BACKUP_SUBCOLLECTIONS.map(n => ({ key: `businesses/${adminBiz.id}/${n}`, path: ['businesses', adminBiz.id, n] })),
      { key: 'users', path: ['users'] },
    ];
  }
  return ROOT_BACKUP_COLLECTIONS.map(n => ({ key: n, path: [n] }));
}

// Firestore Timestamps (if any) become ISO strings tagged so a restore can
// tell them apart from plain strings.
function toPlain(value){
  if (value && typeof value.toDate === 'function') return { __timestamp: value.toDate().toISOString() };
  if (Array.isArray(value)) return value.map(toPlain);
  if (value && typeof value === 'object'){
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toPlain(v)]));
  }
  return value;
}

function renderBackup(){
  const main = adminBiz
    ? `<div class="ad-desc">Downloads the business <b>${escapeHtml(adminBiz.name)}</b> (${escapeHtml(adminBiz.id)}): ${BUSINESS_BACKUP_SUBCOLLECTIONS.join(', ')}, plus the business doc and users, as one JSON file. This is the data the app uses now. Keep it somewhere safe (computer, Drive). Not included: the eBay token (it's a password; reconnecting eBay replaces it) and the eBay category cache (rebuilt on its own). Photos stay in Firebase Storage; items keep their links.</div>`
    : `<div class="ad-desc">Downloads every collection the app uses (${ROOT_BACKUP_COLLECTIONS.join(', ')}) as one JSON file. Keep it somewhere safe (computer, Drive). Not included: the eBay token (it's a password; reconnecting eBay replaces it) and the eBay category cache (rebuilt on its own). Photos stay in Firebase Storage; items keep their links.</div>`;
  document.getElementById('panelBackup').innerHTML = `
    <div class="ad-card">
      <h3>Full backup</h3>
      ${main}
      <button class="ad-btn" id="adBackupBtn">Download full backup</button>
      <div id="adBackupResult" style="margin-top:12px;"></div>
    </div>
    ${adminBiz ? `
    <div class="ad-card">
      <h3>Pre-business data (frozen)</h3>
      <div class="ad-desc">The root collections the app used before the switch to the business (${ROOT_BACKUP_COLLECTIONS.join(', ')}). They stopped changing at the switch and stay until they're removed in a separate step. Only needed for a last copy before that.</div>
      <button class="ad-btn secondary" id="adBackupRootBtn">Download pre-business backup</button>
      <div id="adBackupRootResult" style="margin-top:12px;"></div>
    </div>` : ''}
    <div class="ad-card">
      <h3>Google Cloud export (Blaze plan)</h3>
      <div class="ad-desc">A second, server-side copy of the whole database, including everything above. Run it before big changes, like removing the pre-business data.</div>
      <ol style="font-size:13px; color:var(--plum); padding-left:20px; margin:0;">
        <li>Open <a href="https://console.cloud.google.com/firestore/databases/-default-/import-export?project=${escapeHtml(window.db?.app?.options?.projectId || '')}" target="_blank" rel="noopener">Firestore Import/Export</a> in Google Cloud (same Google account as Firebase).</li>
        <li>Click <b>Export</b>, choose <b>Export entire database</b>.</li>
        <li>Pick a bucket in the <b>us</b> multi-region, then <b>Export</b>. Don't use the photos bucket (…firebasestorage.app): it's in us-east1 and the export is rejected. To create one: Cloud Storage → Buckets → Create → Multi-region → us.</li>
        <li>It shows up under the bucket in a few minutes. Storage costs cents per month.</li>
      </ol>
    </div>`;
  document.getElementById('adBackupBtn').addEventListener('click', () => runBackup('business', 'adBackupBtn', 'adBackupResult'));
  document.getElementById('adBackupRootBtn')?.addEventListener('click', () => runBackup('root', 'adBackupRootBtn', 'adBackupRootResult'));
}

async function runBackup(kind, btnId, outId){
  const btn = document.getElementById(btnId);
  const out = document.getElementById(outId);
  const plan = backupPlan(kind);
  const isBusiness = kind === 'business' && !!adminBiz;
  btn.disabled = true;
  out.innerHTML = '<div class="ad-empty">Reading the database…</div>';
  const backup = {
    app: 'Calculated Chaos',
    version: APP_VERSION,
    projectId: window.db?.app?.options?.projectId || null,
    kind: isBusiness ? 'business' : 'pre-business',
    business: isBusiness ? { id: adminBiz.id, name: adminBiz.name } : null,
    createdAt: new Date().toISOString(),
    createdBy: window.auth?.currentUser?.email || null,
    counts: {},
    collections: {},
  };
  try{
    const { collection, getDocs, doc, getDoc } = fns();
    if (isBusiness){
      const bizSnap = await getDoc(doc(db(), 'businesses', adminBiz.id));
      backup.businessDoc = bizSnap.exists() ? toPlain(bizSnap.data()) : null;
    }
    for (const { key, path } of plan){
      out.innerHTML = `<div class="ad-empty">Reading ${escapeHtml(key)}…</div>`;
      const snap = await getDocs(collection(db(), ...path));
      backup.collections[key] = Object.fromEntries(snap.docs.map(d => [d.id, toPlain(d.data())]));
      backup.counts[key] = snap.docs.length;
    }
  }catch(e){
    btn.disabled = false;
    out.innerHTML = `<div class="ebay-status-box error">Backup failed while reading the database: ${escapeHtml(e.message || String(e))}<br>Nothing was downloaded.${/permission/i.test(String(e.message)) ? '<br>If this says "permission", the Firestore rules in the Console are older than v3.17.1 (firestore.rules).' : ''}</div>`;
    return;
  }

  const json = JSON.stringify(backup);
  const fileName = `calculated-chaos-${isBusiness ? 'business' : 'pre-business'}-backup-${backup.createdAt.slice(0, 10)}.json`;
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);

  const sizeMb = (json.length / (1024 * 1024)).toFixed(2);
  out.innerHTML = `
    <div class="ebay-status-box success">Backup downloaded: ${escapeHtml(fileName)} (${sizeMb} MB)</div>
    ${plan.map(({ key }) => `<div class="ad-row"><div class="ad-main-text">${escapeHtml(key)}</div><div class="ad-meta">${backup.counts[key]} doc${backup.counts[key] === 1 ? '' : 's'}</div></div>`).join('')}`;
  btn.disabled = false;
}

// ---------- APP ----------
function renderApp(){
  document.getElementById('panelApp').innerHTML = `
    <div class="ad-card">
      <h3>App</h3>
      <dl class="ad-kv">
        <dt>Version</dt><dd>${escapeHtml(APP_VERSION)} · ${escapeHtml(APP_VERSION_DATE)}</dd>
        <dt>Firebase project</dt><dd>${escapeHtml(window.db?.app?.options?.projectId || 'unknown')}</dd>
      </dl>
    </div>
    <div class="ad-card">
      <h3>Server admin access</h3>
      <div class="ad-desc">Whether the server can use its Firebase Admin key (FIREBASE_SERVICE_ACCOUNT in Vercel). Needed for the upcoming multi-business work; until it works, sign-in checks use the older fallback.</div>
      <div id="adHealthResult" class="ad-empty">Checking…</div>
      <button class="ad-btn secondary" id="adHealthBtn" style="margin-top:10px;">Check again</button>
    </div>
    <div class="ad-card">
      <h3>Admin access</h3>
      <div class="ad-desc">Platform admins are marked on their account by the server (the <code>platformAdmin</code> claim), which the security rules read. Who is an admin is set by UID in the code (PLATFORM_ADMIN_UIDS in api/_firebaseAdmin.js); "Sync admin access" copies that list onto the accounts.</div>
      <div id="adClaimsStatus" class="ad-empty">Loading…</div>
      <div id="adClaimsProgress" class="ad-meta" style="margin-top:8px;"></div>
      <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
        <button class="ad-btn secondary" id="adClaimsRefreshBtn">Refresh</button>
        <button class="ad-btn" id="adClaimsSyncBtn">Sync admin access</button>
      </div>
    </div>
    <div class="ad-card">
      <h3>Self-serve sign-up</h3>
      <div class="ad-desc">When on, a new account that verifies its email creates its own store ("Create your store") and gets in without approval. When off, new accounts wait in Approvals as before. Turn it on only after the server-side AI limit and App Check are in place.</div>
      <div id="adSelfServeStatus" class="ad-empty">Loading…</div>
      <div id="adSelfServeProgress" class="ad-meta" style="margin-top:8px;"></div>
      <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
        <button class="ad-btn" id="adSelfServeBtn" disabled>…</button>
      </div>
    </div>
    <div class="ad-card">
      <h3>App Check on the server</h3>
      <div class="ad-desc">How our functions treat the App Check token the app sends (reCAPTCHA Enterprise). <b>Off:</b> not checked. <b>Monitor:</b> calls go on, and calls without a valid token are logged as <code>app-check-monitor</code> in Vercel. <b>Enforce:</b> those calls are refused. Firestore, Auth and Storage are enforced separately, in Firebase Console → App Check. Move to Enforce only after the Console metrics show nearly every request verified.</div>
      <div id="adAppCheckStatus" class="ad-empty">Loading…</div>
      <div id="adAppCheckProgress" class="ad-meta" style="margin-top:8px;"></div>
      <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;" role="group" aria-label="App Check mode">
        <button class="ad-btn secondary" data-appcheck-mode="off" disabled>Off</button>
        <button class="ad-btn secondary" data-appcheck-mode="monitor" disabled>Monitor</button>
        <button class="ad-btn secondary" data-appcheck-mode="enforce" disabled>Enforce</button>
      </div>
    </div>
    <div class="ad-card">
      <h3>Business migration</h3>
      <div class="ad-desc">Copies today's catalog, drafts, Live Catalog, counters, settings, eBay error library and eBay connection into one business (businesses/{id}). <b>Copy, never move:</b> the app keeps using the current data until the switch, and nothing is deleted. Safe to run again.</div>
      <div class="ad-desc">Before copying: download a backup in the Backup tab and run a Google Cloud export.</div>
      <div id="adMigrationStatus" class="ad-empty">Loading…</div>
      <div id="adMigrationProgress" class="ad-meta" style="margin-top:8px;"></div>
      <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
        <button class="ad-btn secondary" id="adMigrationRefreshBtn">Refresh counts</button>
        <button class="ad-btn secondary" id="adMigrationCopyBtn" disabled>Copy to business</button>
        <button class="ad-btn" id="adMigrationSwitchBtn" disabled>Switch to business data</button>
        <button class="ad-btn secondary" id="adMigrationMembersBtn" style="display:none;">Sync members</button>
        <button class="ad-btn secondary" id="adRetireMainBtn" style="display:none;">Retire the old eBay connection</button>
        <button class="ad-btn danger" id="adMigrationBackBtn" style="display:none;">Switch back</button>
      </div>
    </div>
    <div class="ad-card ad-links">
      <h3>Links</h3>
      <a href="https://vercel.com/dashboard" target="_blank" rel="noopener">Vercel dashboard (deploys, logs)</a>
      <a href="https://console.firebase.google.com/" target="_blank" rel="noopener">Firebase Console (rules, auth, data)</a>
      <a href="https://developer.ebay.com/my/keys" target="_blank" rel="noopener">eBay developer portal</a>
      <a href="https://console.anthropic.com/" target="_blank" rel="noopener">Anthropic Console (API usage)</a>
      <a href="https://github.com/vitorsenajr-creator/Calculated-Chaos" target="_blank" rel="noopener">GitHub repository</a>
    </div>`;
  document.getElementById('adHealthBtn').addEventListener('click', runHealthCheck);
  runHealthCheck();
  document.getElementById('adClaimsRefreshBtn').addEventListener('click', () => loadAdminClaims());
  document.getElementById('adClaimsSyncBtn').addEventListener('click', runAdminClaimsSync);
  loadAdminClaims();
  document.getElementById('adSelfServeBtn').addEventListener('click', toggleSelfServe);
  loadSelfServe();
  document.querySelectorAll('[data-appcheck-mode]').forEach(btn => btn.addEventListener('click', () => setAppCheckMode(btn.dataset.appcheckMode)));
  loadAppCheckMode();
  document.getElementById('adMigrationRefreshBtn').addEventListener('click', loadMigrationStatus);
  document.getElementById('adMigrationCopyBtn').addEventListener('click', runMigrationCopy);
  document.getElementById('adMigrationSwitchBtn').addEventListener('click', runMigrationSwitch);
  document.getElementById('adMigrationMembersBtn').addEventListener('click', runMembersSync);
  document.getElementById('adRetireMainBtn').addEventListener('click', runRetireMain);
  document.getElementById('adMigrationBackBtn').addEventListener('click', runMigrationSwitchBack);
  loadMigrationStatus();
}

async function platformAction(body){
  const res = await fetch('/api/platform', { method: 'POST', headers: await jsonAuthHeaders(), body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error((data && data.error) || `HTTP ${res.status}`);
  return data;
}

// ---------- AI USAGE (v3.24.5): api/platform.js action 'ai_usage' ----------
// The meter counts every successful AI call per user, month, call type and
// model (api/_aiUsage.js). Only platform admins see it here.
const aiNum = (v) => (Number(v) || 0).toLocaleString('en-US');
const aiMonthNow = () => new Date().toISOString().slice(0, 7);

async function renderAi(month = aiMonthNow()){
  const el = document.getElementById('panelAi');
  el.innerHTML = `
    <div class="ad-card">
      <h3>AI usage</h3>
      <div class="ad-desc">Successful AI calls this month, per user. Counted on the server when the answer comes back; failed calls don't count. Nothing is charged yet: this measures the calls before the credits and plans.</div>
      <div class="ad-row">
        <label for="adAiMonth" class="ad-meta">Month (UTC)</label>
        <input type="month" id="adAiMonth" value="${escapeHtml(month)}">
      </div>
    </div>
    <div id="adAiBody"><div class="ad-card ad-empty">Loading…</div></div>`;
  document.getElementById('adAiMonth').addEventListener('change', (e) => {
    if (e.target.value) renderAi(e.target.value);
  });

  const body = document.getElementById('adAiBody');
  let report = null;
  try{
    report = await platformAction({ action: 'ai_usage', month });
  }catch(e){
    body.innerHTML = `<div class="ad-card"><div class="ebay-status-box error">Could not load the AI usage: ${escapeHtml(e.message || String(e))}</div></div>`;
    return;
  }
  const t = report.total;
  body.innerHTML = `
    <div class="ad-card">
      <div class="ad-totals">
        <div class="ad-total"><div class="ad-total-label">Calls</div><div class="ad-total-value">${aiNum(t.calls)}</div></div>
        <div class="ad-total"><div class="ad-total-label">Input tokens</div><div class="ad-total-value">${aiNum(t.inputTokens)}</div></div>
        <div class="ad-total"><div class="ad-total-label">Output tokens</div><div class="ad-total-value">${aiNum(t.outputTokens)}</div></div>
        <div class="ad-total"><div class="ad-total-label">Cache written / read</div><div class="ad-total-value">${aiNum(t.cacheWriteTokens)} / ${aiNum(t.cacheReadTokens)}</div></div>
        <div class="ad-total"><div class="ad-total-label">Users</div><div class="ad-total-value">${aiNum(report.byUser.length)}</div></div>
      </div>
      <h3>By user</h3>
      ${report.byUser.length ? `
      <div class="ad-table-wrap"><table class="ad-table">
        <thead><tr><th>User</th><th>Business</th><th class="num">Calls</th><th class="num">Input</th><th class="num">Output</th><th class="num">Cache w / r</th></tr></thead>
        <tbody>${report.byUser.map(u => `
          <tr>
            <td>${escapeHtml(u.email || u.uid || 'anonymous')}${u.role ? `<div class="ad-meta">${escapeHtml(u.role)}</div>` : ''}</td>
            <td>${escapeHtml(u.bizId || '—')}</td>
            <td class="num">${aiNum(u.calls)}</td>
            <td class="num">${aiNum(u.inputTokens)}</td>
            <td class="num">${aiNum(u.outputTokens)}</td>
            <td class="num">${aiNum(u.cacheWriteTokens)} / ${aiNum(u.cacheReadTokens)}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>` : '<div class="ad-empty">No AI calls recorded this month.</div>'}
    </div>
    <div class="ad-card">
      <h3>By call type</h3>
      ${report.byCall.length ? `
      <div class="ad-table-wrap"><table class="ad-table">
        <thead><tr><th>Call</th><th class="num">Calls</th><th class="num">Input</th><th class="num">Output</th><th class="num">Cache w / r</th></tr></thead>
        <tbody>${report.byCall.map(c => `
          <tr>
            <td>${escapeHtml(AI_CALL_LABELS[c.call] || c.call)}<div class="ad-meta">${escapeHtml(c.call)}</div></td>
            <td class="num">${aiNum(c.calls)}</td>
            <td class="num">${aiNum(c.inputTokens)}</td>
            <td class="num">${aiNum(c.outputTokens)}</td>
            <td class="num">${aiNum(c.cacheWriteTokens)} / ${aiNum(c.cacheReadTokens)}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>` : '<div class="ad-empty">No AI calls recorded this month.</div>'}
    </div>`;
}

// ---------- Admin access (api/_adminClaims.js) ----------
function renderAdminClaims(s, mine){
  const rows = s.admins.map(a => `
    <div class="ad-row" style="display:block;">
      <div class="ad-main-text">${escapeHtml(a.email || a.uid)} ${a.missing ? '<span class="ad-pill unknown">Missing</span>' : a.hasClaim ? '<span class="ad-pill approved">Claim</span>' : '<span class="ad-pill pending">No claim</span>'}</div>
      <div class="ad-meta">${a.missing ? `No account with UID ${escapeHtml(a.uid)}.` : `UID ${escapeHtml(a.uid)} · ${a.hasClaim ? 'has the claim' : 'no claim yet'} · email ${a.emailVerified ? 'verified' : 'not verified'}${a.disabled ? ' · disabled' : ''}`}</div>
    </div>`).join('') + s.extra.map(u => `
    <div class="ad-row" style="display:block;">
      <div class="ad-main-text">${escapeHtml(u.email || u.uid)} <span class="ad-pill unknown">Extra claim</span></div>
      <div class="ad-meta">Has the claim but isn't an admin. "Sync admin access" removes it.</div>
    </div>`).join('');
  return `${rows}
    <div class="ad-meta" style="margin-top:8px;">This browser's session: ${mine ? 'carries the claim' : 'no claim yet (Sync refreshes it; other devices pick it up within an hour or at the next sign-in)'}</div>`;
}

async function loadAdminClaims(forceRefresh = false){
  const el = document.getElementById('adClaimsStatus');
  el.innerHTML = '<div class="ad-empty">Loading…</div>';
  try{
    const [s, mine] = await Promise.all([platformAction({ action: 'admin_claims' }), loadAdminClaim(window.auth.currentUser, forceRefresh)]);
    el.innerHTML = renderAdminClaims(s, mine);
    adminUids = new Set(s.admins.filter(a => a.hasClaim).map(a => a.uid));
    renderUsers();
  }catch(e){
    el.innerHTML = `<div class="ebay-status-box error">Could not load admin access: ${escapeHtml(e.message || String(e))}</div>`;
  }
}

async function runAdminClaimsSync(){
  const btn = document.getElementById('adClaimsSyncBtn');
  const progress = document.getElementById('adClaimsProgress');
  btn.disabled = true;
  progress.textContent = 'Syncing…';
  try{
    await platformAction({ action: 'admin_claims_sync' });
    progress.textContent = 'Synced.';
    await loadAdminClaims(true);
  }catch(e){
    progress.textContent = `Could not sync: ${e.message || e}`;
  }finally{
    btn.disabled = false;
  }
}

// ---------- Self-serve sign-up (v3.28.0, api/_business.js) ----------
let selfServeOn = null;

function drawSelfServe(){
  const el = document.getElementById('adSelfServeStatus');
  const btn = document.getElementById('adSelfServeBtn');
  el.innerHTML = selfServeOn
    ? '<div class="ebay-status-box success">On: new accounts create their own store after verifying their email.</div>'
    : '<div class="ebay-status-box pending">Off: new accounts wait for approval.</div>';
  btn.textContent = selfServeOn ? 'Turn off' : 'Turn on';
  btn.className = selfServeOn ? 'ad-btn danger' : 'ad-btn';
  btn.disabled = false;
}

async function loadSelfServe(){
  try{
    const r = await platformAction({ action: 'self_serve' });
    selfServeOn = r.selfServe === true;
    drawSelfServe();
  }catch(e){
    document.getElementById('adSelfServeStatus').innerHTML = `<div class="ebay-status-box error">Could not load the sign-up switch: ${escapeHtml(e.message || String(e))}</div>`;
  }
}

async function toggleSelfServe(){
  const on = !selfServeOn;
  if (on && !confirm('Turn on self-serve sign-up? Anyone who creates an account and verifies the email will get their own store, with AI use, without your approval.')) return;
  const btn = document.getElementById('adSelfServeBtn');
  const progress = document.getElementById('adSelfServeProgress');
  btn.disabled = true;
  progress.textContent = on ? 'Turning on…' : 'Turning off…';
  try{
    const r = await platformAction({ action: 'self_serve_set', on });
    selfServeOn = r.selfServe === true;
    progress.textContent = selfServeOn ? 'Self-serve sign-up is on.' : 'Self-serve sign-up is off.';
    drawSelfServe();
  }catch(e){
    progress.textContent = `Could not change it: ${e.message || e}`;
    btn.disabled = false;
  }
}

// ---------- App Check on the server (v3.28.2, api/_appCheck.js) ----------
const APP_CHECK_TEXT = {
  off: ['pending', 'Off: our functions do not check the App Check token.'],
  monitor: ['pending', 'Monitor: calls without a valid token go on and are logged (app-check-monitor).'],
  enforce: ['success', 'Enforce: calls without a valid token are refused.'],
};

function drawAppCheckMode(mode){
  const [kind, text] = APP_CHECK_TEXT[mode] || APP_CHECK_TEXT.off;
  document.getElementById('adAppCheckStatus').innerHTML = `<div class="ebay-status-box ${kind}">${escapeHtml(text)}</div>`;
  document.querySelectorAll('[data-appcheck-mode]').forEach(btn => {
    const on = btn.dataset.appcheckMode === mode;
    btn.className = on ? 'ad-btn' : 'ad-btn secondary';
    btn.setAttribute('aria-pressed', String(on));
    btn.disabled = false;
  });
}

async function loadAppCheckMode(){
  try{
    const r = await platformAction({ action: 'app_check' });
    drawAppCheckMode(r.mode);
  }catch(e){
    document.getElementById('adAppCheckStatus').innerHTML = `<div class="ebay-status-box error">Could not load the App Check mode: ${escapeHtml(e.message || String(e))}</div>`;
  }
}

async function setAppCheckMode(mode){
  if (mode === 'enforce' && !confirm('Enforce App Check on the server? Calls from an app without a valid token (an old cached copy, a blocked reCAPTCHA) will be refused.')) return;
  const progress = document.getElementById('adAppCheckProgress');
  document.querySelectorAll('[data-appcheck-mode]').forEach(btn => { btn.disabled = true; });
  progress.textContent = 'Saving…';
  try{
    const r = await platformAction({ action: 'app_check_set', mode });
    progress.textContent = `Saved. Functions pick it up within a minute.`;
    drawAppCheckMode(r.mode);
  }catch(e){
    progress.textContent = `Could not change it: ${e.message || e}`;
    loadAppCheckMode();
  }
}

// ---------- Business migration (api/_migration.js) ----------

function migrationButtons(){
  return ['adMigrationRefreshBtn', 'adMigrationCopyBtn', 'adMigrationSwitchBtn', 'adMigrationMembersBtn', 'adMigrationBackBtn', 'adRetireMainBtn']
    .map(id => document.getElementById(id));
}

async function loadMigrationStatus(){
  const el = document.getElementById('adMigrationStatus');
  const [refreshBtn, copyBtn, switchBtn, membersBtn, backBtn, retireBtn] = migrationButtons();
  copyBtn.disabled = true;
  switchBtn.disabled = true;
  el.innerHTML = '<div class="ad-empty">Counting…</div>';
  try{
    const s = await platformAction({ action: 'migrate_status' });
    const mark = (ok) => ok ? '<span class="ad-pill approved">OK</span>' : '<span class="ad-pill pending">Pending</span>';
    const rows = s.collections.map(c => `
      <div class="ad-row" style="display:block;">
        <div class="ad-main-text">${escapeHtml(c.name)} ${mark(c.target === c.source)}</div>
        <div class="ad-meta">Current: ${c.source} · Copied: ${c.target}</div>
      </div>`).join('') + s.docs.map(d => `
      <div class="ad-row" style="display:block;">
        <div class="ad-main-text">${escapeHtml(d.from)} → ${escapeHtml(d.to)} ${d.source ? mark(d.target) : '—'}</div>
        <div class="ad-meta">${d.source ? (d.target ? 'Copied' : 'Not copied yet') : 'Doesn\'t exist (nothing to copy)'}</div>
      </div>`).join('') + `
      <div class="ad-row" style="display:block;">
        <div class="ad-main-text">Members ${mark(s.members.target >= s.members.source)}</div>
        <div class="ad-meta">Approved users: ${s.members.source} · Members: ${s.members.target}</div>
      </div>`;
    el.innerHTML = `
      <dl class="ad-kv">
        <dt>Business id</dt><dd>${s.bizId ? escapeHtml(s.bizId) : 'Not created yet (the first copy creates it)'}</dd>
        <dt>Last copy</dt><dd>${s.lastCopiedAt ? fmtDate(s.lastCopiedAt) : 'Never'}</dd>
        <dt>App uses</dt><dd>${s.live ? '<b>Business data</b> (live)' : 'Pre-business data'}</dd>
      </dl>
      ${s.live ? '<div class="ebay-status-box success">The app uses the business data; copying the old data again is blocked. "Sync members" adds approved accounts that have no store yet to this business; accounts that already have a store (this one or their own) are left alone.</div>' : ''}
      ${s.mainRetiredAt ? `<div class="ad-meta">Old eBay connection retired ${escapeHtml(fmtDate(s.mainRetiredAt))} → ebay_connections/${escapeHtml(s.mainRetiredTo || '')}</div>` : ''}
      ${s.unmapped.length ? `<div class="ebay-status-box error">These docs won't be copied (no business home yet): ${s.unmapped.map(escapeHtml).join(', ')}</div>` : ''}
      ${rows}`;
    copyBtn.disabled = s.live;
    copyBtn.style.display = s.live ? 'none' : '';
    switchBtn.disabled = s.live || !s.lastCopiedAt;
    switchBtn.style.display = s.live ? 'none' : '';
    membersBtn.style.display = s.live ? '' : 'none';
    backBtn.style.display = s.live ? '' : 'none';
    // Only once the app is live and the old shared doc is still there.
    const mainConn = s.docs.find(d => d.from === 'ebay_connections/main');
    retireBtn.style.display = s.live && mainConn && mainConn.source ? '' : 'none';
    refreshBtn.disabled = false;
  }catch(e){
    el.innerHTML = `<div class="ebay-status-box error">Could not load the migration status: ${escapeHtml(e.message || String(e))}</div>`;
  }
}

// Runs every copy step (after the switch, only the members step runs).
// Returns a "name: count" summary; throws on the first failed step.
async function copyAllSteps(label){
  const progress = document.getElementById('adMigrationProgress');
  const totals = {};
  let removed = 0;
  const summary = () => Object.entries(totals).map(([k, v]) => `${k}: ${v}`).join(' · ') + (removed ? ` · removed: ${removed}` : '');
  let next = { step: 0, cursor: null };
  while (next){
    const r = await platformAction({ action: 'migrate_copy', step: next.step, cursor: next.cursor });
    totals[r.step] = (totals[r.step] || 0) + (r.copied || 0);
    removed += r.removed || 0;
    progress.textContent = `${label}… ${summary()}`;
    next = r.next;
  }
  return summary();
}

// Disables every button while `work` runs, then reloads the status.
async function withMigrationBusy(work){
  migrationButtons().forEach(b => { b.disabled = true; });
  try{
    await work();
  }finally{
    await loadMigrationStatus();
  }
}

async function runMigrationCopy(){
  if (!confirm('Copy the current data into the business now?\n\nNothing is deleted and the app keeps using the current data. Did you download a fresh backup first?')) return;
  const progress = document.getElementById('adMigrationProgress');
  await withMigrationBusy(async () => {
    try{
      progress.textContent = `Copy finished. ${await copyAllSteps('Copying')}`;
    }catch(e){
      progress.textContent = `Copy stopped: ${e.message || e}. It's safe to press Copy again; it starts over and rewrites the same docs.`;
    }
  });
}

// Final copy (picks up everything changed since the last one, including
// the refreshed eBay token), then turns the business data on.
async function runMigrationSwitch(){
  if (!confirm('Switch the app to the business data now?\n\n1. Ask everyone to stop using the app for a few minutes.\n2. A final copy runs first, then the switch.\n3. Afterwards, reload the app on every device.\n\nYou can switch back from here, but anything saved after the switch stays only in the business data.')) return;
  const progress = document.getElementById('adMigrationProgress');
  await withMigrationBusy(async () => {
    try{
      const copied = await copyAllSteps('Final copy');
      progress.textContent = `Final copy done (${copied}). Switching…`;
      await platformAction({ action: 'migrate_switch', live: true });
      progress.textContent = `Switched. The app now uses the business data. Reload the app on every device. Final copy: ${copied}`;
    }catch(e){
      progress.textContent = `Not switched: ${e.message || e}. The app still uses the pre-business data.`;
    }
  });
}

async function runMigrationSwitchBack(){
  if (!confirm('Switch the app back to the pre-business data?\n\nAnything saved since the switch stays only in the business data and will NOT be in the app after switching back. Reload the app on every device afterwards.')) return;
  const progress = document.getElementById('adMigrationProgress');
  await withMigrationBusy(async () => {
    try{
      await platformAction({ action: 'migrate_switch', live: false });
      progress.textContent = 'Switched back. The app uses the pre-business data again. Reload the app on every device.';
    }catch(e){
      progress.textContent = `Could not switch back: ${e.message || e}`;
    }
  });
}

// After the switch: adds newly approved users to the business.
async function runMembersSync(){
  const progress = document.getElementById('adMigrationProgress');
  await withMigrationBusy(async () => {
    try{
      progress.textContent = `Members synced (accounts that already have a store are skipped). ${await copyAllSteps('Syncing members')}`;
    }catch(e){
      progress.textContent = `Could not sync members: ${e.message || e}`;
    }
  });
}

// v3.28.8: moves ebay_connections/main aside. Nothing reads it any more;
// every eBay call uses the store's own connection.
async function runRetireMain(){
  if (!confirm('Retire the old eBay connection (ebay_connections/main)?\n\nFirst check in the Firestore Console that your store has its own doc in ebay_connections (the business id above). The old doc is moved to ebay_connections/_retired_main_<date>, not deleted.')) return;
  const progress = document.getElementById('adMigrationProgress');
  await withMigrationBusy(async () => {
    try{
      const r = await platformAction({ action: 'ebay_retire_main' });
      progress.textContent = `Retired: moved to ebay_connections/${r.retiredTo}. Publish one item on eBay to confirm the store's connection works.`;
    }catch(e){
      progress.textContent = `Could not retire it: ${e.message || e}`;
    }
  });
}

// api/platform.js action:'health' — see that file for what each check means.
async function runHealthCheck(){
  const el = document.getElementById('adHealthResult');
  const btn = document.getElementById('adHealthBtn');
  el.innerHTML = '<div class="ad-empty">Checking…</div>';
  btn.disabled = true;
  try{
    const res = await fetch('/api/platform', {
      method: 'POST',
      headers: await jsonAuthHeaders(),
      body: JSON.stringify({ action: 'health' }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !Array.isArray(data.checks)){
      el.innerHTML = `<div class="ebay-status-box error">Could not run the check: ${escapeHtml((data && data.error) || `HTTP ${res.status}`)}</div>`;
      return;
    }
    el.innerHTML = `
      <div class="ebay-status-box ${data.ok ? 'success' : 'error'}">${data.ok ? 'Working' : 'Not working yet — see the failed check below'}</div>
      ${data.checks.map(c => `
        <div class="ad-row" style="display:block;">
          <div class="ad-main-text">${escapeHtml(c.name)} <span class="ad-pill ${c.ok ? 'approved' : 'unknown'}">${c.ok ? 'OK' : 'Failed'}</span></div>
          <div class="ad-meta">${escapeHtml(c.detail || '')}</div>
        </div>`).join('')}`;
  }catch(e){
    el.innerHTML = `<div class="ebay-status-box error">Could not reach the server: ${escapeHtml(e.message || String(e))}</div>`;
  }finally{
    btn.disabled = false;
  }
}

initUpdateBanner();
