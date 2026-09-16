// "Number bank" for product codes — added 2026-09-16 after two-terminal
// duplicate registration numbers were found in the wild. Root cause:
// nextProductCode() (catalog-lookups.js) only ever guesses from the
// client's own in-memory `items` array, which is loaded once via getDocs
// (not a live onSnapshot listener — see main.js loadAllData) and only
// refreshed on demand. Two terminals adding an item around the same time
// each guess the same "next" number and both save it — since each item
// document's real Firestore ID is a random uid(), not the product code,
// nothing stops both saves from succeeding with an identical productCode.
//
// Fix has two layers:
//   1. reserveNextProductCode() — an atomic Firestore counter
//      (app_settings/productCodeCounter, incremented via runTransaction,
//      same pattern Live Catalog's SKU counter already uses — see
//      formatLiveSku()/skuCounter in live-catalog.js). Two terminals
//      calling this at the same instant are serialized by Firestore's
//      transaction retry, so they can never walk away with the same
//      number. main.js's save flow calls this instead of trusting the
//      client-side guess whenever the Product Code field is still the
//      auto-filled suggestion (see productCodeIsAutoSuggested there).
//   2. findItemsWithProductCode() — a live Firestore query, used as a
//      safety net whenever someone hand-types/edits the product code
//      instead of accepting the auto-suggestion (that path bypasses the
//      counter above, since the point is she's intentionally choosing a
//      specific number).
//
// Plus a one-off Settings tool (runDuplicateProductCodeAudit /
// renumberDuplicateProductCode) to find and fix any duplicates that were
// already saved before this existed.
import { items } from './state.js';
import { escapeHtml } from './format-utils.js';
import { maxProductCodeNumber } from './catalog-lookups.js';

export async function reserveNextProductCode(){
  const { doc, runTransaction } = window.firestoreFns;
  const counterRef = doc(window.db, 'app_settings', 'productCodeCounter');
  // Floor from the currently-loaded catalog — covers the very first call
  // ever (no counter doc yet) and self-heals if the counter ever fell
  // behind (e.g. an item saved with a manually-typed higher number).
  const floorNum = maxProductCodeNumber(items);
  const assigned = await runTransaction(window.db, async (tx) => {
    const snap = await tx.get(counterRef);
    const current = snap.exists() ? (Number(snap.data().nextNumber) || 1) : 1;
    const next = Math.max(current, floorNum + 1);
    tx.set(counterRef, { nextNumber: next + 1 }, { merge: true });
    return next;
  });
  return '#' + String(assigned).padStart(4, '0');
}

// Live Firestore check (not just the local `items` array) — the whole
// point is catching a collision with something another terminal saved
// that this browser hasn't loaded/refreshed yet.
export async function findItemsWithProductCode(code, excludeId){
  if (!code) return [];
  const { collection, query, where, getDocs } = window.firestoreFns;
  const snap = await getDocs(query(collection(window.db, 'items'), where('productCode', '==', code)));
  const matches = [];
  snap.forEach(d => { if (d.id !== excludeId) matches.push({ id: d.id, ...d.data() }); });
  return matches;
}

// ---------- Settings tool: find & fix existing duplicates ----------
// Groups the already-loaded catalog by exact productCode string. A real
// bug duplicate is two DIFFERENT items sharing the identical string —
// intentional quantity>1 copies ("#0089-1"/"#0089-2") never collide since
// each copy gets its own suffix, so no special-casing is needed here.
function findDuplicateGroups(){
  const byCode = new Map();
  items.forEach(i => {
    if (!i.productCode) return;
    if (!byCode.has(i.productCode)) byCode.set(i.productCode, []);
    byCode.get(i.productCode).push(i);
  });
  return Array.from(byCode.entries())
    .filter(([, group]) => group.length > 1)
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
}

function renderDuplicateAuditReport(){
  const area = document.getElementById('duplicateCodesResult');
  if (!area) return;
  const groups = findDuplicateGroups();
  if (!groups.length){
    area.innerHTML = `<div class="ebay-status-box success">✅ No duplicate registration numbers found (checked ${items.length} items).</div>`;
    return;
  }
  area.innerHTML = `
    <div class="ebay-status-box error">⚠️ Found ${groups.length} registration number${groups.length === 1 ? '' : 's'} used by more than one item.</div>
    ${groups.map(([code, group]) => `
      <div style="border:1px solid var(--line); border-radius:8px; padding:10px; margin-top:8px;">
        <div style="font-weight:600; font-family:monospace; margin-bottom:6px;">${escapeHtml(code)} — ${group.length} items</div>
        ${group.map(i => `
          <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:4px 0; border-bottom:1px dashed var(--line); font-size:13px;">
            <span>${escapeHtml(i.name || '(no name)')} <span style="opacity:0.6;">· created ${i.createdAt ? new Date(i.createdAt).toLocaleString('en-US') : 'unknown'}</span></span>
            <button class="settings-save-btn" style="width:auto; margin:0; padding:5px 10px; font-size:12px;" data-renumber-id="${i.id}">🔢 Give new number</button>
          </div>
        `).join('')}
      </div>
    `).join('')}
  `;
  area.querySelectorAll('[data-renumber-id]').forEach(btn => btn.addEventListener('click', () => renumberDuplicateProductCode(btn.dataset.renumberId)));
}

export function runDuplicateProductCodeAudit(){
  const area = document.getElementById('duplicateCodesResult');
  if (area) area.innerHTML = `<div class="ebay-status-box pending">⏳ Checking ${items.length} items…</div>`;
  renderDuplicateAuditReport();
}

export async function renumberDuplicateProductCode(itemId){
  const item = items.find(i => i.id === itemId);
  if (!item) return;
  const area = document.getElementById('duplicateCodesResult');
  if (area) area.innerHTML = `<div class="ebay-status-box pending">⏳ Assigning a new number to "${escapeHtml(item.name || itemId)}"…</div>`;
  try{
    const newCode = await reserveNextProductCode();
    const { doc, updateDoc } = window.firestoreFns;
    await updateDoc(doc(window.db, 'items', item.id), { productCode: newCode });
    item.productCode = newCode;
    renderDuplicateAuditReport();
  }catch(e){
    console.error('Renumber failed', e);
    if (area) area.innerHTML = `<div class="ebay-status-box error">❌ Couldn't assign a new number: ${escapeHtml(e?.message || String(e))}</div>`;
  }
}
