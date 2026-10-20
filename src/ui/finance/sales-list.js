// Finances → Sales: the list of one month's sales (UI layer; v3.23.6).
// A table on desktop, cards on a phone (both rendered, CSS shows one).
// Costs are edited in place on desktop (Enter saves and moves to the next
// sale without a cost, Esc cancels) and in a bottom sheet on a phone.
// Writes go through data/sale-costs-store.js (updateDoc of the cost fields
// and netProfit only). Tokens only.
import { items } from '../../modules/state.js';
import { escapeHtml } from '../../modules/format-utils.js';
import { monthLabel } from '../../domain/finance-summary.js';
import { salesOfMonth, hasMissingCost, saleRow, totalsOfRows, recomputeSaleCosts } from '../../domain/sales-ledger.js';
import { saveSaleCosts } from '../../data/sale-costs-store.js';
import { showToast } from '../toast.js';

const DESKTOP = '(min-width: 900px)';
// Per month: 'all' or 'missing'. Kept while the screen redraws.
const filterByMonth = {};
// The sale being edited in place on desktop.
let editingId = null;

function money2(n){
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function day(ts){
  return ts ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'No date';
}
const codeBox = (r) => r.code ? `<span class="code-box">${escapeHtml(r.code)}</span>` : '';
const costCell = (r) => r.cost === null
  ? `<button type="button" class="cost-add" data-sale-edit="${escapeHtml(r.id)}">Add cost</button>`
  : money2(r.cost);

// The list for month `key`; `opts.platformLabel` names the platforms.
export function salesListHtml(key, { platformLabel = (k) => k } = {}){
  const sales = salesOfMonth(items, key);
  if (!sales.length) return '';
  const missing = sales.filter(hasMissingCost);
  const mode = missing.length && filterByMonth[key] === 'missing' ? 'missing' : 'all';
  const shown = (mode === 'missing' ? missing : sales).map(saleRow);
  const tot = totalsOfRows(sales.map(saleRow));
  const plat = (r) => escapeHtml(platformLabel(r.platform));

  const filter = missing.length ? `
    <div class="seg sales-filter" role="group" aria-label="Show">
      <button type="button" class="seg-btn${mode === 'all' ? ' active' : ''}" data-sales-filter="all" aria-pressed="${mode === 'all'}">All (${sales.length})</button>
      <button type="button" class="seg-btn${mode === 'missing' ? ' active' : ''}" data-sales-filter="missing" aria-pressed="${mode === 'missing'}">Missing cost (${missing.length})</button>
    </div>` : '';

  const row = (r) => {
    if (r.id === editingId){
      const item = items.find(i => i.id === r.id) || {};
      const v = (x) => (x === null || x === undefined ? '' : Number(x).toFixed(2));
      return `
        <tr class="sale-editing" data-sale-row="${escapeHtml(r.id)}">
          <td>${day(r.date)}</td>
          <td><span class="sale-name">${codeBox(r)}<span>${escapeHtml(r.name)}</span></span></td>
          <td>${plat(r)}</td>
          <td class="num">${money2(r.price)}</td>
          <td class="num">${money2(r.fees)}</td>
          <td class="num"><input class="sale-in" data-k="cost" inputmode="decimal" autocomplete="off" aria-label="Item cost" value="${v(r.cost)}" placeholder="0.00"></td>
          <td class="num"><input class="sale-in" data-k="shippingCost" inputmode="decimal" autocomplete="off" aria-label="Shipping paid" value="${v(item.shippingCost || 0)}"></td>
          <td class="num"><input class="sale-in" data-k="otherCosts" inputmode="decimal" autocomplete="off" aria-label="Other costs" value="${v(item.otherCosts || 0)}"></td>
          <td class="num"><span class="sale-preview" aria-live="polite">${money2(r.profit)}</span></td>
          <td class="sale-act">
            <button type="button" class="row-btn" data-sale-save>Save</button>
            <button type="button" class="row-btn" data-sale-cancel>Cancel</button>
          </td>
        </tr>
        <tr class="sale-edit-msg" data-sale-msg-row hidden><td colspan="10"><span class="goal-error" role="alert"></span></td></tr>`;
    }
    return `
      <tr data-sale-row="${escapeHtml(r.id)}">
        <td>${day(r.date)}</td>
        <td><span class="sale-name">${codeBox(r)}<span>${escapeHtml(r.name)}</span></span></td>
        <td>${plat(r)}</td>
        <td class="num">${money2(r.price)}</td>
        <td class="num">${money2(r.fees)}</td>
        <td class="num">${costCell(r)}</td>
        <td class="num">${money2(r.shipping)}</td>
        <td class="num">${money2(r.other)}</td>
        <td class="num${r.profit < 0 ? ' negative' : ''}"><b>${money2(r.profit)}</b></td>
        <td class="sale-act"><button type="button" class="row-btn" data-sale-edit="${escapeHtml(r.id)}" aria-label="Edit costs of ${escapeHtml(r.name)}">Edit</button></td>
      </tr>`;
  };

  const table = `
    <table class="sales-table">
      <caption class="sr-only">Sales in ${monthLabel(key, { long: true })}</caption>
      <thead><tr>
        <th scope="col">Date</th><th scope="col">Item</th><th scope="col">Platform</th>
        <th scope="col" class="num">Price</th><th scope="col" class="num">Fees</th><th scope="col" class="num">Item cost</th>
        <th scope="col" class="num">Shipping</th><th scope="col" class="num">Other</th><th scope="col" class="num">Sales profit</th>
        <th scope="col"><span class="sr-only">Actions</span></th>
      </tr></thead>
      <tbody>${shown.map(row).join('')}</tbody>
      ${mode === 'all' ? `<tfoot><tr>
        <th scope="row" colspan="3">Total, ${sales.length} sale${sales.length === 1 ? '' : 's'}</th>
        <td class="num">${money2(tot.price)}</td><td class="num">${money2(tot.fees)}</td><td class="num">${money2(tot.cost)}</td>
        <td class="num">${money2(tot.shipping)}</td><td class="num">${money2(tot.other)}</td>
        <td class="num${tot.profit < 0 ? ' negative' : ''}"><b>${money2(tot.profit)}</b></td><td></td>
      </tr></tfoot>` : ''}
    </table>`;

  const cards = `
    <ul class="sales-cards">${shown.map(r => `
      <li class="sale-card" data-sale-card="${escapeHtml(r.id)}">
        <div class="sale-card-top">
          <span class="sale-name">${codeBox(r)}<span>${escapeHtml(r.name)}</span></span>
          <b class="sale-card-profit${r.profit < 0 ? ' negative' : ''}">${money2(r.profit)}</b>
        </div>
        <div class="sale-card-sub">${day(r.date)} · ${plat(r)} · ${money2(r.price)} · fees ${money2(r.fees)}</div>
        <div class="sale-card-costs">
          ${r.cost === null ? `<button type="button" class="cost-add" data-sale-edit="${escapeHtml(r.id)}">Add cost</button>` : `<span class="cost-chip">Cost ${money2(r.cost)}</span>`}
          <span class="cost-chip">Ship ${money2(r.shipping)}</span>
          <span class="cost-chip">Other ${money2(r.other)}</span>
          <button type="button" class="row-btn sale-card-edit" data-sale-edit="${escapeHtml(r.id)}" aria-label="Edit costs of ${escapeHtml(r.name)}">Edit costs</button>
        </div>
      </li>`).join('')}</ul>`;

  return `
    <div class="sales-list" data-sales-month="${key}">
      <div class="sales-head">
        <h3 class="sales-title">Sales</h3>
        ${filter}
      </div>
      ${table}
      ${cards}
    </div>`;
}

// Wires the list inside `root` for month `key`. `rerender()` redraws the
// Sales tab; `onChange()` redraws everything that shows profit.
export function wireSalesList(root, key, { rerender = () => {}, onChange = () => {}, openItem = () => {} } = {}){
  const list = root.querySelector(`.sales-list[data-sales-month="${key}"]`);
  if (!list) return;
  list.querySelectorAll('[data-sales-filter]').forEach(b => b.addEventListener('click', () => {
    filterByMonth[key] = b.dataset.salesFilter;
    editingId = null;
    rerender();
  }));
  list.querySelectorAll('[data-sale-edit]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.saleEdit;
    if (window.matchMedia && window.matchMedia(DESKTOP).matches){
      editingId = id;
      rerender();
      focusEditing(root);
    } else {
      openCostSheet(id, key, { onChange, openItem });
    }
  }));

  const editRow = list.querySelector('tr.sale-editing');
  if (!editRow) return;
  const item = items.find(i => i.id === editRow.dataset.saleRow);
  if (!item){ editingId = null; return; }
  const inputs = [...editRow.querySelectorAll('.sale-in')];
  const val = () => Object.fromEntries(inputs.map(i => [i.dataset.k, i.value]));
  const preview = editRow.querySelector('.sale-preview');
  const msgRow = list.querySelector('[data-sale-msg-row]');
  const showError = (m) => { msgRow.hidden = !m; msgRow.querySelector('.goal-error').textContent = m; };
  // Only the preview text changes while typing (no re-render: iOS keeps
  // its keyboard).
  const update = () => {
    showError('');
    const r = recomputeSaleCosts(item, val());
    preview.textContent = r.ok ? previewText(item.netProfit || 0, r.fields.netProfit) : money2(item.netProfit || 0);
  };
  inputs.forEach(i => i.addEventListener('input', update));
  const cancel = () => { editingId = null; rerender(); };
  const save = async () => {
    const r = recomputeSaleCosts(item, val());
    if (!r.ok){
      const f = editRow.querySelector(`[data-k="${r.field}"]`);
      if (f) f.focus();
      return showError(r.error);
    }
    editRow.querySelectorAll('button, input').forEach(el => { el.disabled = true; });
    const before = item.netProfit || 0;
    const ok = await saveSaleCosts(item.id, r.fields);
    if (!ok){
      editRow.querySelectorAll('button, input').forEach(el => { el.disabled = false; });
      return showError('Couldn’t save. Check your connection and try again.');
    }
    Object.assign(item, r.fields);
    announce(key, before, r.fields.netProfit);
    // Enter moves on to the next sale of the month that still has no cost.
    editingId = nextMissing(key, item.id);
    onChange();
    if (editingId) focusEditing(root);
  };
  editRow.querySelector('[data-sale-save]').addEventListener('click', save);
  editRow.querySelector('[data-sale-cancel]').addEventListener('click', cancel);
  inputs.forEach(i => i.addEventListener('keydown', (e) => {
    if (e.key === 'Enter'){ e.preventDefault(); save(); }
    if (e.key === 'Escape'){ e.preventDefault(); cancel(); }
  }));
}

function focusEditing(root){
  const f = root.querySelector('tr.sale-editing [data-k="cost"]');
  if (f){ f.focus(); f.select(); }
}

function previewText(before, after){
  return Math.abs(after - before) < 0.005 ? money2(after) : `${money2(before)} → ${money2(after)}`;
}

// The next sale without a cost in the month's order, after `afterId`.
function nextMissing(key, afterId){
  const sales = salesOfMonth(items, key);
  const at = sales.findIndex(i => i.id === afterId);
  const rest = [...sales.slice(at + 1), ...sales.slice(0, Math.max(at, 0))];
  const next = rest.find(hasMissingCost);
  return next ? next.id : null;
}

function announce(key, before, after){
  const diff = Math.round((after - before) * 100) / 100;
  const [y, m] = key.split('-').map(Number);
  const month = new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long' });
  showToast(diff ? `${month} sales profit updated: ${diff > 0 ? '+' : '−'}${money2(Math.abs(diff))}` : 'Costs saved');
}

// ---------- PHONE: bottom sheet ----------
function openCostSheet(id, key, { onChange, openItem }){
  const item = items.find(i => i.id === id);
  if (!item) return;
  const r = saleRow(item);
  const v = (x) => (x === null || x === undefined ? '' : Number(x).toFixed(2));
  const hasNext = !!nextMissing(key, id) && nextMissing(key, id) !== id;
  const dlg = document.createElement('dialog');
  dlg.className = 'goal-dialog sale-sheet';
  dlg.setAttribute('aria-labelledby', 'saleSheetTitle');
  dlg.innerHTML = `
    <form method="dialog" class="goal-form" novalidate>
      <h2 id="saleSheetTitle">Costs of this sale</h2>
      <p class="sale-sheet-item"><span class="sale-name">${codeBox(r)}<span>${escapeHtml(r.name)}</span></span></p>
      <div class="sale-sheet-ro">
        <span>Price <b>${money2(r.price)}</b></span><span>Fees <b>${money2(r.fees)}</b></span>
        <button type="button" class="link-btn" data-sheet-item>Edit in item</button>
      </div>
      <div class="exp-fields">
        <label class="goal-field exp-wide"><span>Item cost</span>
          <span class="goal-input"><span class="goal-affix">$</span><input type="text" data-k="cost" inputmode="decimal" autocomplete="off" value="${v(r.cost)}" placeholder="0.00"></span></label>
        <p class="exp-cat-hint exp-wide">Enter 0 for free or gifted pieces.</p>
        <label class="goal-field"><span>Shipping paid</span>
          <span class="goal-input"><span class="goal-affix">$</span><input type="text" data-k="shippingCost" inputmode="decimal" autocomplete="off" value="${v(item.shippingCost || 0)}"></span></label>
        <label class="goal-field"><span>Other costs</span>
          <span class="goal-input"><span class="goal-affix">$</span><input type="text" data-k="otherCosts" inputmode="decimal" autocomplete="off" value="${v(item.otherCosts || 0)}"></span></label>
      </div>
      <p class="sale-sheet-profit">Sales profit <b class="sale-preview" aria-live="polite">${money2(r.profit)}</b></p>
      <div class="goal-actions exp-dialog-actions">
        <p class="goal-error" role="alert" hidden></p>
        <button type="button" class="secondary-btn" data-sheet-cancel>Cancel</button>
        ${hasNext ? '<button type="button" class="secondary-btn" data-sheet-next>Save &amp; next missing</button>' : ''}
        <button type="submit" class="primary-btn" data-sheet-save>Save</button>
      </div>
    </form>`;
  document.body.appendChild(dlg);
  const field = (k) => dlg.querySelector(`[data-k="${k}"]`);
  const val = () => ({ cost: field('cost').value, shippingCost: field('shippingCost').value, otherCosts: field('otherCosts').value });
  const error = dlg.querySelector('.goal-error');
  const showError = (m) => { error.textContent = m; error.hidden = !m; };
  const preview = dlg.querySelector('.sale-preview');
  dlg.querySelectorAll('[data-k]').forEach(i => i.addEventListener('input', () => {
    showError('');
    const c = recomputeSaleCosts(item, val());
    preview.textContent = c.ok ? previewText(item.netProfit || 0, c.fields.netProfit) : money2(item.netProfit || 0);
  }));
  const buttons = () => dlg.querySelectorAll('.exp-dialog-actions button');
  async function submit({ next = false } = {}){
    showError('');
    const c = recomputeSaleCosts(item, val());
    if (!c.ok){
      const f = field(c.field);
      if (f) f.focus();
      return showError(c.error);
    }
    buttons().forEach(b => { b.disabled = true; });
    const before = item.netProfit || 0;
    const ok = await saveSaleCosts(item.id, c.fields);
    buttons().forEach(b => { b.disabled = false; });
    if (!ok) return showError('Couldn’t save. Check your connection and try again.');
    Object.assign(item, c.fields);
    announce(key, before, c.fields.netProfit);
    const nextId = next ? nextMissing(key, item.id) : null;
    dlg.close();
    onChange();
    if (nextId) openCostSheet(nextId, key, { onChange, openItem });
  }
  dlg.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  const nextBtn = dlg.querySelector('[data-sheet-next]');
  if (nextBtn) nextBtn.addEventListener('click', () => submit({ next: true }));
  dlg.querySelector('[data-sheet-cancel]').addEventListener('click', () => dlg.close());
  dlg.querySelector('[data-sheet-item]').addEventListener('click', () => { dlg.close(); openItem(item.id); });
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
  field('cost').focus();
}
