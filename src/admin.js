// Developer Panel — platform administration (added v3.15.0).
// Separate page/bundle from the main app (see vite.config.js + admin.html),
// same pattern as the Live Catalog. Only ADMIN_EMAILS get past the gate
// below; that check only drives the UI — firestore.rules is what actually
// limits reading/changing other users' docs to admins.
//
// Today it covers the single-business app: access requests, users, the
// shared eBay connection and the eBay error library. The Businesses and
// Credits & cost sections arrive with the multi-business work
// (docs/multi-tenant.md).
import './config/firebase.js';
import { escapeHtml } from './modules/format-utils.js';
import { EBAY_ERROR_LIBRARY } from './modules/ebay-error-hints.js';
import { APP_VERSION, APP_VERSION_DATE } from './modules/version.js';
import { jsonAuthHeaders } from './modules/api-auth.js';

function db(){ return window.db; }
function fns(){ return window.firestoreFns; }

let users = [];
let currentUid = null;

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
    if (!window.isAdminEmail(user.email)){
      document.getElementById('adDeniedEmail').textContent = user.email || user.uid;
      document.getElementById('adDenied').style.display = 'block';
      return;
    }
    currentUid = user.uid;
    document.getElementById('adHeaderSub').textContent = `Platform administration · signed in as ${user.email}`;
    document.getElementById('adTabs').style.display = 'flex';
    document.getElementById('adMain').style.display = 'block';
    initTabs();
    await loadUsers();
    renderApp();
  });
});

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
  const status = u.status === 'approved' ? 'approved' : 'pending';
  return `<span class="ad-pill ${status}">${status}</span>`;
}
function rolePill(u){
  return u.role === 'employee' ? '<span class="ad-pill employee">employee</span>' : '';
}

function renderApprovals(){
  const el = document.getElementById('panelApprovals');
  const pending = users.filter(u => u.status !== 'approved');
  const badge = document.getElementById('adPendingBadge');
  badge.textContent = String(pending.length);
  badge.style.display = pending.length ? 'inline-block' : 'none';

  el.innerHTML = `
    <div class="ad-card">
      <h3>Access requests</h3>
      <div class="ad-desc">People who created an account and are waiting for access. Denying removes their request; they can sign up again later.</div>
      ${pending.length ? pending.map(u => `
        <div class="ad-row">
          <div>
            <div class="ad-main-text">${escapeHtml(u.email || u.id)}</div>
            <div class="ad-meta">Requested ${escapeHtml(fmtDate(u.createdAt))}</div>
          </div>
          <div class="ad-actions">
            <button class="ad-btn" data-approve="${escapeHtml(u.id)}">Approve</button>
            <button class="ad-btn danger" data-deny="${escapeHtml(u.id)}">Deny</button>
          </div>
        </div>`).join('') : '<div class="ad-empty">No pending requests.</div>'}
    </div>`;

  el.querySelectorAll('[data-approve]').forEach(btn => btn.addEventListener('click', () =>
    updateUser(btn, btn.dataset.approve, { status: 'approved' })));
  el.querySelectorAll('[data-deny]').forEach(btn => btn.addEventListener('click', () => {
    if (!confirm('Deny this request? They will need to sign up again to request access.')) return;
    deleteUser(btn, btn.dataset.deny);
  }));
}

function renderUsers(){
  const el = document.getElementById('panelUsers');
  const approvedCount = users.filter(u => u.status === 'approved').length;
  el.innerHTML = `
    <div class="ad-card">
      <h3>Users (${users.length})</h3>
      <div class="ad-desc">${approvedCount} approved · ${users.length - approvedCount} pending. Employees only see the Catalog tab. Removing a user deletes their access record, not their login; signing in again puts them back in the approval queue.</div>
      ${users.length ? users.map(u => {
        const isSelf = u.id === currentUid;
        const isApproved = u.status === 'approved';
        const isEmployee = u.role === 'employee';
        return `
        <div class="ad-row">
          <div>
            <div class="ad-main-text">${escapeHtml(u.email || u.id)}${statusPill(u)}${rolePill(u)}${isSelf ? ' <span class="ad-meta">(you)</span>' : ''}</div>
            <div class="ad-meta">Created ${escapeHtml(fmtDate(u.createdAt))}${window.isAdminEmail(u.email) ? ' · admin' : ''}</div>
          </div>
          ${isSelf ? '' : `
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

  el.querySelectorAll('[data-approve]').forEach(btn => btn.addEventListener('click', () =>
    updateUser(btn, btn.dataset.approve, { status: 'approved' })));
  el.querySelectorAll('[data-revoke]').forEach(btn => btn.addEventListener('click', () => {
    if (!confirm('Revoke access? They go back to "pending" and lose access until approved again.')) return;
    updateUser(btn, btn.dataset.revoke, { status: 'pending' });
  }));
  el.querySelectorAll('[data-role]').forEach(btn => btn.addEventListener('click', () =>
    updateUser(btn, btn.dataset.role, { role: btn.dataset.nextRole })));
  el.querySelectorAll('[data-remove]').forEach(btn => btn.addEventListener('click', () => {
    if (!confirm('Remove this user? Their login still exists; signing in again puts them back in the approval queue.')) return;
    deleteUser(btn, btn.dataset.remove);
  }));
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

async function deleteUser(btn, uid){
  btn.disabled = true;
  try{
    const { doc, deleteDoc } = fns();
    await deleteDoc(doc(db(), 'users', uid));
    await loadUsers();
  }catch(e){
    btn.disabled = false;
    alert(`Could not remove this user: ${e.message || e}`);
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
      <div class="ad-desc">One connection for the whole app today, held on the server (ebay_connections/main; the app never sees the tokens). Per-business connections come with the multi-business work.</div>
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
    const snap = await getDocs(collection(db(), 'ebay_error_log'));
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
      <div class="ad-desc">${log.length} distinct error${log.length === 1 ? '' : 's'}, ${total} occurrence${total === 1 ? '' : 's'} in total, most frequent first. ${unknown.length} not in the error library yet; those are candidates for new library entries (src/modules/ebay-error-hints.js).</div>
      ${log.length ? log.map(row).join('') : '<div class="ad-empty">No eBay errors logged yet.</div>'}
    </div>`;
}

// ---------- BACKUP ----------
// Downloads every Firestore collection the app uses as one JSON file
// (v3.15.5), so there's a copy on hand before the multi-business data
// migration (docs/multi-tenant.md step 6). Read-only: there is deliberately
// no restore button; restoring would be written for the case at hand.
// Left out on purpose:
//  - ebay_tokens: it's a credential (refresh token); a stray copy of the
//    file would give access to the eBay account. Reconnecting eBay replaces it.
//  - ebay_category_cache: rebuilt automatically on use.
// Photos stay in Firebase Storage; items keep their URLs.
const BACKUP_COLLECTIONS = [
  'items', 'drafts', 'users', 'app_config', 'app_settings', 'ebay_error_log',
  'liveSessions', 'liveItems', 'live_catalog_options',
];

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
  document.getElementById('panelBackup').innerHTML = `
    <div class="ad-card">
      <h3>Full backup</h3>
      <div class="ad-desc">Downloads every collection the app uses (${BACKUP_COLLECTIONS.join(', ')}) as one JSON file. Keep it somewhere safe (computer, Drive). Not included: the eBay token (it's a password; reconnecting eBay replaces it) and the eBay category cache (rebuilt on its own). Photos stay in Firebase Storage; items keep their links.</div>
      <button class="ad-btn" id="adBackupBtn">Download full backup</button>
      <div id="adBackupResult" style="margin-top:12px;"></div>
    </div>
    <div class="ad-card">
      <h3>Google Cloud export (Blaze plan)</h3>
      <div class="ad-desc">A second, server-side copy of the whole database, including everything above. Run it right before the data migration.</div>
      <ol style="font-size:13px; color:var(--plum); padding-left:20px; margin:0;">
        <li>Open <a href="https://console.cloud.google.com/firestore/databases/-default-/import-export?project=${escapeHtml(window.db?.app?.options?.projectId || '')}" target="_blank" rel="noopener">Firestore Import/Export</a> in Google Cloud (same Google account as Firebase).</li>
        <li>Click <b>Export</b>, choose <b>Export entire database</b>.</li>
        <li>Pick a bucket in the <b>us</b> multi-region, then <b>Export</b>. Don't use the photos bucket (…firebasestorage.app): it's in us-east1 and the export is rejected. To create one: Cloud Storage → Buckets → Create → Multi-region → us.</li>
        <li>It shows up under the bucket in a few minutes. Storage costs cents per month.</li>
      </ol>
    </div>`;
  document.getElementById('adBackupBtn').addEventListener('click', runBackup);
}

async function runBackup(){
  const btn = document.getElementById('adBackupBtn');
  const out = document.getElementById('adBackupResult');
  btn.disabled = true;
  out.innerHTML = '<div class="ad-empty">Reading the database…</div>';
  const backup = {
    app: 'Calculated Chaos',
    version: APP_VERSION,
    projectId: window.db?.app?.options?.projectId || null,
    createdAt: new Date().toISOString(),
    createdBy: window.auth?.currentUser?.email || null,
    counts: {},
    collections: {},
  };
  try{
    const { collection, getDocs } = fns();
    for (const name of BACKUP_COLLECTIONS){
      out.innerHTML = `<div class="ad-empty">Reading ${escapeHtml(name)}…</div>`;
      const snap = await getDocs(collection(db(), name));
      backup.collections[name] = Object.fromEntries(snap.docs.map(d => [d.id, toPlain(d.data())]));
      backup.counts[name] = snap.docs.length;
    }
  }catch(e){
    btn.disabled = false;
    out.innerHTML = `<div class="ebay-status-box error">❌ Backup failed while reading the database: ${escapeHtml(e.message || String(e))}<br>Nothing was downloaded.</div>`;
    return;
  }

  const json = JSON.stringify(backup);
  const fileName = `calculated-chaos-backup-${backup.createdAt.slice(0, 10)}.json`;
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
    <div class="ebay-status-box success">✅ Backup downloaded: ${escapeHtml(fileName)} (${sizeMb} MB)</div>
    ${BACKUP_COLLECTIONS.map(n => `<div class="ad-row"><div class="ad-main-text">${escapeHtml(n)}</div><div class="ad-meta">${backup.counts[n]} doc${backup.counts[n] === 1 ? '' : 's'}</div></div>`).join('')}`;
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
      el.innerHTML = `<div class="ebay-status-box error">❌ Could not run the check: ${escapeHtml((data && data.error) || `HTTP ${res.status}`)}</div>`;
      return;
    }
    el.innerHTML = `
      <div class="ebay-status-box ${data.ok ? 'success' : 'error'}">${data.ok ? '✅ Working' : '❌ Not working yet — see the failed check below'}</div>
      ${data.checks.map(c => `
        <div class="ad-row" style="display:block;">
          <div class="ad-main-text">${c.ok ? '✅' : '❌'} ${escapeHtml(c.name)}</div>
          <div class="ad-meta">${escapeHtml(c.detail || '')}</div>
        </div>`).join('')}`;
  }catch(e){
    el.innerHTML = `<div class="ebay-status-box error">❌ Could not reach the server: ${escapeHtml(e.message || String(e))}</div>`;
  }finally{
    btn.disabled = false;
  }
}
