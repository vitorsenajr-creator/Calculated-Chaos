// The trash (v3.26.0): deleted items kept for 30 days, opened from
// Settings → Data. Restore puts an item back in the catalog; Delete forever
// removes it now. Records past their expiry are removed when the list opens.
// The rules for what a record keeps are in domain/trash.js.
import { escapeHtml } from '../../modules/format-utils.js';
import { loadTrash, restoreFromTrash, deleteTrashForever } from '../../data/trash-store.js';
import { restorableTrash, expiredTrash, trashDaysLeft, toMillis, TRASH_DAYS } from '../../domain/trash.js';
import { codeCounts, hasDuplicateCode } from '../../domain/item-issues.js';
import { showToast } from '../toast.js';

let hooks = { getItems: () => [], restored: () => {} };

// getItems(): the catalog in memory. restored(item): called with an item
// that is back in `items`, so the caller can add it and redraw.
export function initTrashPanel(h){ hooks = { ...hooks, ...h }; }

export function openTrash(){
  const dlg = document.createElement('dialog');
  dlg.className = 'trash-dialog trash-list';
  dlg.innerHTML = `
    <div class="trash-body">
      <h2>Trash</h2>
      <p class="trash-note">Deleted items stay here for ${TRASH_DAYS} days. Restore brings one back to the catalog.</p>
      <div class="trash-status" role="status">Loading…</div>
      <ul class="trash-rows"></ul>
      <form method="dialog" class="trash-actions"><button type="submit" class="secondary-btn">Close</button></form>
    </div>`;
  document.body.appendChild(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => onRowClick(dlg, e));
  dlg.showModal();
  refresh(dlg);
  return dlg;
}

// The records shown in the open list, by id, so a click knows its record.
const shown = new Map();

async function refresh(dlg){
  const status = dlg.querySelector('.trash-status');
  const list = dlg.querySelector('.trash-rows');
  let all;
  try{ all = await loadTrash(); }
  catch{
    status.textContent = "Couldn't load the trash. Check your connection and try again.";
    return;
  }
  const now = Date.now();
  const expired = expiredTrash(all, now).map(r => r.id);
  if (expired.length) await deleteTrashForever(expired);
  const rows = restorableTrash(all, now);
  shown.clear();
  rows.forEach(r => shown.set(r.id, r));
  list.innerHTML = rows.map(r => rowHtml(r, now)).join('');
  status.textContent = rows.length ? '' : 'Nothing in the trash.';
}

function rowHtml(record, now){
  const name = record.name || record.productCode || 'Item';
  const days = trashDaysLeft(record, now);
  const who = record.deletedBy?.email || 'unknown';
  const when = new Date(toMillis(record.deletedAt)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const code = record.productCode ? ` · ${record.productCode}` : '';
  const ebay = record.removedFromEbayAt ? ' · removed from eBay' : '';
  return `
    <li class="trash-row" data-trash-id="${escapeHtml(record.id)}">
      <div class="trash-info">
        <b>${escapeHtml(name)}</b>
        <small>Deleted ${escapeHtml(when)} by ${escapeHtml(who)}${escapeHtml(code)} · ${days} day${days === 1 ? '' : 's'} left${ebay}</small>
      </div>
      <div class="trash-btns">
        <button type="button" class="row-btn" data-trash-restore>Restore</button>
        <button type="button" class="row-btn danger" data-trash-forever>Delete forever</button>
      </div>
    </li>`;
}

function setStatus(dlg, text){
  dlg.querySelector('.trash-status').textContent = text;
}

async function onRowClick(dlg, e){
  const restoreBtn = e.target.closest('[data-trash-restore]');
  const foreverBtn = e.target.closest('[data-trash-forever]');
  if (!restoreBtn && !foreverBtn) return;
  const row = (restoreBtn || foreverBtn).closest('.trash-row');
  const record = shown.get(row.dataset.trashId);
  if (!record) return;
  const name = record.name || record.productCode || 'this item';

  if (restoreBtn){
    restoreBtn.disabled = true;
    let item;
    try{ item = await restoreFromTrash(record); }
    catch(err){
      console.error('Restore from trash failed:', err);
      restoreBtn.disabled = false;
      return setStatus(dlg, `Couldn't restore ${name}. Check your connection and try again.`);
    }
    shown.delete(record.id);
    row.remove();
    hooks.restored(item);
    // A restored item can bring back a code another item already uses.
    const counts = codeCounts([...hooks.getItems(), item]);
    const warning = hasDuplicateCode(item, counts) ? ` Its code ${item.productCode} is also used by another item: check it.` : '';
    setStatus(dlg, `Restored ${name}.${warning}`);
    showToast(`Restored ${name}`);
    return;
  }

  if (!confirm(`Delete "${name}" for good? This can't be undone.`)) return;
  foreverBtn.disabled = true;
  const r = await deleteTrashForever([record.id]);
  if (r.error){
    foreverBtn.disabled = false;
    return setStatus(dlg, `Couldn't delete ${name} for good. Check your connection and try again.`);
  }
  shown.delete(record.id);
  row.remove();
  if (!shown.size) setStatus(dlg, 'Nothing in the trash.');
}
