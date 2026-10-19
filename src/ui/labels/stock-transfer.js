// Stock Transfer (UI layer; v3.17.3, docs/modularization.md). Moved out of
// main.js unchanged except for its interface.
import { items, appSettings } from '../../modules/state.js';
import { escapeHtml } from '../../modules/format-utils.js';
import { findItemByProductCodeDigits } from '../../domain/product-code-match.js';
import { openBatchLabelModal } from './print-modal.js';
import { openQuickLabelModalWithCodes } from './quick-labels.js';

let saveItem, saveSettings, getAllStorageBoxes;

// Stock transfer: pick a box once, then scan item codes one after another
// — each one moves instantly and the field clears itself, so a whole box
// can be filled without touching anything but the numeric keypad between
// scans. Same digit-matching as Quick Labels (findItemByProductCodeDigits).
function populateTransferBoxSelect(selectName){
  const select = document.getElementById('transferBoxSelect');
  // Registered boxes (Settings) are a curated subset — a box name only
  // ever typed into an item's Storage Box field (never formally
  // "registered") wouldn't show up here otherwise, which is exactly
  // what happened with "Gray Box" on a real item. getAllStorageBoxes()
  // already merges both sources for the item modal's own datalist —
  // reused here for the same reason.
  const boxes = getAllStorageBoxes();
  const current = selectName !== undefined ? selectName : select.value;
  select.innerHTML = `<option value="">— Select box —</option>` +
    boxes.map(b => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('');
  if (current && boxes.includes(current)) select.value = current;
}

// Opening the Stock Transfer tool right after login/refresh — before
// Firestore's item load finishes — used to leave its box dropdown
// permanently empty for that session: it only ever populated once, at
// modal-open time, off whatever `items` held right then (real report:
// the dropdown showed nothing while the page behind it still read
// "Loading your pieces…"). renderAll() runs again once items actually
// load, so re-populating here (only while the modal is visible) means
// the list fills in on its own instead of needing to close and reopen.
export function refreshStockTransferBoxListIfOpen(){
  const overlay = document.getElementById('stockTransferOverlay');
  if (overlay && !overlay.classList.contains('hidden')) populateTransferBoxSelect();
}

// Last 5 moves made in the current Stock Transfer session (newest
// first) — a running checklist so a mis-scan is easy to spot, plus a
// single "undo last" button that reverts the most recent one (not a
// per-row undo — the most recent move is overwhelmingly the one that
// needs correcting, and it keeps the tool as fast to use as before).
let transferRecentMoves = [];

// The template keeps main.js's old indentation on purpose: that
// whitespace is part of the generated HTML (see docs/modularization.md).
function renderTransferRecentList(){
  const list = document.getElementById('transferRecentList');
  list.innerHTML = transferRecentMoves.map(m => `
      <div style="display:flex; align-items:center; gap:6px; font-size:12.5px; color:var(--plum-soft); padding:3px 0;">
        <span>✅</span>
        <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(m.productCode || '')} ${escapeHtml(m.name || 'Item')} → ${escapeHtml(m.toBox)}</span>
      </div>
    `).join('');
  document.getElementById('transferUndoBtn').disabled = transferRecentMoves.length === 0;
  document.getElementById('transferToLabelsBtn').disabled = transferRecentMoves.length === 0;
}

function openStockTransferModal(){
  populateTransferBoxSelect('');
  document.getElementById('transferNewBoxRow').style.display = 'none';
  document.getElementById('transferNewBoxInput').value = '';
  document.getElementById('transferCodeInput').value = '';
  document.getElementById('transferStatus').textContent = '';
  transferRecentMoves = [];
  renderTransferRecentList();
  document.getElementById('stockTransferOverlay').classList.remove('hidden');
  document.getElementById('transferBoxSelect').focus();
}

function closeStockTransferModal(){
  document.getElementById('stockTransferOverlay').classList.add('hidden');
}

function setTransferStatus(text, isError){
  const el = document.getElementById('transferStatus');
  el.textContent = text;
  el.style.color = isError ? 'var(--danger)' : 'var(--sage-deep)';
}

async function addNewTransferBox(){
  const input = document.getElementById('transferNewBoxInput');
  const name = input.value.trim();
  if (!name){ setTransferStatus('Enter a box name first.', true); return; }
  if ((appSettings.storageBoxes || []).some(b => b.name.toLowerCase() === name.toLowerCase())){
    setTransferStatus('A box with that name already exists.', true);
    return;
  }
  appSettings.storageBoxes = [...(appSettings.storageBoxes || []), { name, createdAt: Date.now() }];
  await saveSettings();
  populateTransferBoxSelect(name);
  input.value = '';
  document.getElementById('transferNewBoxRow').style.display = 'none';
  setTransferStatus(`Box "${name}" added.`, false);
  document.getElementById('transferCodeInput').focus();
}

async function submitTransferCode(){
  const box = document.getElementById('transferBoxSelect').value;
  const input = document.getElementById('transferCodeInput');
  const code = input.value.trim();
  if (!code) return;
  if (!box){
    setTransferStatus('Select a destination box first.', true);
    return;
  }
  const item = findItemByProductCodeDigits(items, code);
  if (!item){
    setTransferStatus(`❌ Code not found: ${code}`, true);
    input.value = '';
    input.focus();
    return;
  }
  const fromBox = item.storageBox || '';
  const updated = { ...item, storageBox: box };
  const idx = items.findIndex(i => i.id === item.id);
  if (idx >= 0) items[idx] = updated;
  input.value = '';
  input.disabled = true;
  try{
    await saveItem(updated);
    setTransferStatus(`✅ ${item.productCode || ''} ${item.name || 'Item'} → ${box}`.trim(), false);
    transferRecentMoves.unshift({ id: item.id, productCode: item.productCode, name: item.name, fromBox, toBox: box });
    transferRecentMoves = transferRecentMoves.slice(0, 5);
    renderTransferRecentList();
    // Opens on top of this still-open modal (printLabelOverlay's z-index
    // is set above the transfer/label overlays for exactly this) rather
    // than closing Stock Transfer first — the whole point of this
    // checkbox is printing one label per scan without losing her place
    // mid-session.
    if (document.getElementById('transferPrintCheck').checked){
      openBatchLabelModal([updated]);
    }
  }catch(e){
    setTransferStatus('Save failed — check your connection and try that code again.', true);
  }
  input.disabled = false;
  input.focus();
}

async function undoLastTransferMove(){
  if (transferRecentMoves.length === 0) return;
  const move = transferRecentMoves[0];
  const item = items.find(i => i.id === move.id);
  if (!item){
    setTransferStatus('That item no longer exists — nothing to undo.', true);
    transferRecentMoves.shift();
    renderTransferRecentList();
    return;
  }
  const reverted = { ...item, storageBox: move.fromBox };
  const idx = items.findIndex(i => i.id === move.id);
  if (idx >= 0) items[idx] = reverted;
  document.getElementById('transferUndoBtn').disabled = true;
  try{
    await saveItem(reverted);
    transferRecentMoves.shift();
    renderTransferRecentList();
    setTransferStatus(`↩ ${move.productCode || ''} ${move.name || 'Item'} back to ${move.fromBox || '(no box)'}`.trim(), false);
  }catch(e){
    setTransferStatus('Undo failed — check your connection and try again.', true);
    document.getElementById('transferUndoBtn').disabled = false;
  }
  document.getElementById('transferCodeInput').focus();
}

// Wires the Stock Transfer buttons and inputs, once at startup. saveItem,
// saveSettings and getAllStorageBoxes come from main.js.
export function initStockTransfer(deps){
  ({ saveItem, saveSettings, getAllStorageBoxes } = deps);

  document.getElementById('stockTransferOpenBtnMobile').addEventListener('click', openStockTransferModal);
  document.getElementById('stockTransferOpenBtnDesktop').addEventListener('click', openStockTransferModal);
  document.getElementById('transferDoneBtn').addEventListener('click', closeStockTransferModal);
  document.getElementById('stockTransferOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'stockTransferOverlay') closeStockTransferModal();
  });
  document.getElementById('transferNewBoxToggleBtn').addEventListener('click', () => {
    const row = document.getElementById('transferNewBoxRow');
    const showing = row.style.display !== 'none';
    row.style.display = showing ? 'none' : 'flex';
    if (!showing) document.getElementById('transferNewBoxInput').focus();
  });
  document.getElementById('transferNewBoxAddBtn').addEventListener('click', addNewTransferBox);
  document.getElementById('transferNewBoxInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addNewTransferBox();
  });
  document.getElementById('transferBoxSelect').addEventListener('change', () => {
    document.getElementById('transferCodeInput').focus();
  });
  document.getElementById('transferCodeInput').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/[^0-9]/g, '');
  });
  document.getElementById('transferCodeInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitTransferCode();
  });
  // A numeric-only mobile keypad has no real Enter/Return key — its
  // "Done"/checkmark toolbar button just dismisses the keyboard, it
  // doesn't fire a 'keydown' Enter the way a physical keyboard does. The
  // Enter listener above only ever helps on desktop; this button is the
  // one that actually works on a phone, which is the primary device this
  // tool is used from during a stock-take.
  document.getElementById('transferMoveBtn').addEventListener('click', submitTransferCode);
  document.getElementById('transferUndoBtn').addEventListener('click', undoLastTransferMove);
  document.getElementById('transferToLabelsBtn').addEventListener('click', () => {
    if (transferRecentMoves.length === 0) return;
    const codes = transferRecentMoves.map(m => (m.productCode || '').replace(/\D/g, ''));
    closeStockTransferModal();
    openQuickLabelModalWithCodes(codes);
  });
}
