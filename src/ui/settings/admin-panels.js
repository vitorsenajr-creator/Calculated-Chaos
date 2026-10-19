// Admin-only Settings panels (UI layer; v3.17.6, docs/modularization.md):
// the pending access-request count and the employee account list. Moved
// out of main.js unchanged.
import { escapeHtml } from '../../modules/format-utils.js';

// Settings only shows how many sign-ups are waiting; approving/denying
// moved to the Developer Panel (admin.html, src/admin.js) in v3.15.0.
// Only reachable for a platform admin (isPlatformAdmin(), the server-set
// claim) — the Firestore rules (firestore.rules) independently enforce this.
export async function renderAuthorizeAccessPanel(){
  const section = document.getElementById('authorizeAccessSection');
  const box = document.getElementById('authorizeAccessBox');
  if (!section || !box) return;
  section.style.display = 'block';
  try{
    const { collection, getDocs } = window.firestoreFns;
    const snap = await getDocs(collection(window.db, 'users'));
    let pending = 0;
    snap.forEach(d => { if (d.data().status === 'pending') pending++; });
    box.innerHTML = pending
      ? `<div class="ebay-status-box pending">⏳ ${pending} access request${pending === 1 ? '' : 's'} waiting for approval.</div>`
      : '<div style="font-size:12px; color:var(--plum-soft);">No pending access requests.</div>';
  }catch(e){
    console.error('Failed to load access requests:', e);
    box.innerHTML = '';
  }
}

// Lets the admin create a login for someone who should only see Catalog
// (a Poshmark-only helper, e.g.) — writes role:'employee' on their user
// doc, which is what applyRoleRestrictions() checks after sign-in to hide
// everything else. Uses a throwaway secondary Firebase app instance to
// create the auth user (see window.createEmployeeAccount in
// config/firebase.js) so it doesn't sign the admin out of their own
// session — createUserWithEmailAndPassword normally does that.
export async function renderEmployeeAccountsPanel(){
  const section = document.getElementById('employeeAccountsSection');
  const listEl = document.getElementById('employeeAccountsList');
  if (!section || !listEl) return;
  section.style.display = 'block';
  try{
    const { collection, getDocs } = window.firestoreFns;
    const snap = await getDocs(collection(window.db, 'users'));
    const employees = [];
    snap.forEach(d => { if (d.data().role === 'employee') employees.push({ id: d.id, ...d.data() }); });
    listEl.innerHTML = employees.length
      ? `<div style="font-size:11px; text-transform:uppercase; letter-spacing:0.05em; color:var(--plum-soft); margin-bottom:6px;">Employee accounts (${employees.length})</div>` +
        employees.map(u => `<div style="font-size:13px; padding:6px 0; border-bottom:1px dashed var(--line);">${escapeHtml(u.email || u.id)} <span style="color:var(--plum-soft); font-size:11px;">· Catalog only</span></div>`).join('')
      : '';
  }catch(e){
    console.error('Failed to load employee accounts:', e);
  }
}
