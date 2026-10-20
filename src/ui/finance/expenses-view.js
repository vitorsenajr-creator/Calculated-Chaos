// Finances → Expenses (UI layer; v3.23.3): business costs that aren't tied
// to one sale (rent, supplies, sourcing trips...). The math and the
// categories are in domain/expenses.js, the reads and writes in
// data/expense-store.js. One layout for every theme, tokens only.
// Only the owner reaches Finances; canEdit() is checked again before any
// write.
import { escapeHtml } from '../../modules/format-utils.js';
import {
  EXPENSE_CATEGORIES, EXPENSE_PERIODS, MAX_DESCRIPTION, categoryLabel, isoDate,
  validateExpense, signedAmount, expensesInPeriod, summarizeExpenses, groupByMonth, expenseCsvRows,
} from '../../domain/expenses.js';
import { cachedExpenses, expensesState, loadExpenses, saveExpense, deleteExpense } from '../../data/expense-store.js';

const PERIOD_KEY = 'cc.expenses.period';
const PERIOD_LABEL = { month: 'Month', year: 'Year', all: 'All time' };
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

let hooks = {
  canEdit: () => false,
  uid: () => null,
  downloadCsv: () => {},
  // Overview and the P&L also show expenses (v3.23.4).
  onChange: () => {},
};

export function initExpensesView(h){
  hooks = { ...hooks, ...h };
}

// Per-device convenience; storage can be blocked (private mode).
function getPeriod(){
  try{
    const p = localStorage.getItem(PERIOD_KEY);
    return EXPENSE_PERIODS.includes(p) ? p : 'month';
  }catch(e){ return 'month'; }
}
function setPeriod(p){
  try{ localStorage.setItem(PERIOD_KEY, p); }catch(e){ /* not persisted */ }
}

function money2(n){
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function monthName(key){
  const [y, m] = key.split('-');
  return `${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}`;
}
function dayName(date){
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function periodName(period, now){
  const d = new Date(now);
  if (period === 'month') return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  if (period === 'year') return String(d.getFullYear());
  return 'All time';
}

const ACCRUAL_NOTE = 'Buying stock isn’t an expense here: an item’s cost counts when it sells. Costs of one sale (fees, shipping) go on that sale.';

export function renderExpenses(){
  const view = document.getElementById('expensesView');
  if (!view) return;
  const now = Date.now();
  const period = getPeriod();
  const all = cachedExpenses();
  const list = expensesInPeriod(all, period, now);
  const sum = summarizeExpenses(list);
  const canEdit = hooks.canEdit();

  const periodButtons = EXPENSE_PERIODS.map(p => `
    <button type="button" class="seg-btn${p === period ? ' active' : ''}" data-expense-period="${p}" aria-pressed="${p === period}">${PERIOD_LABEL[p]}</button>`).join('');

  const head = `
    <div class="fin-head">
      <div class="seg" role="group" aria-label="Period">${periodButtons}</div>
      <span class="fin-period">${periodName(period, now)}</span>
    </div>`;
  const addBtn = canEdit ? `<button type="button" class="primary-btn" data-expense-add>Add expense</button>` : '';

  if (expensesState() === 'idle'){
    view.innerHTML = `${head}<section class="panel fin-panel" aria-label="Expenses"><div class="attn-empty" role="status">Loading expenses\u2026</div></section>`;
    wire(view);
    return;
  }
  if (expensesState() === 'failed'){
    view.innerHTML = `${head}
      <section class="panel fin-panel" aria-label="Expenses">
        <div class="attn-empty exp-load-error" role="alert">Couldn’t load your expenses. Check your connection and try again.
          <div class="exp-actions"><button type="button" class="secondary-btn" data-expense-retry>Try again</button></div></div>
      </section>`;
    wire(view);
    return;
  }

  if (all.length === 0){
    view.innerHTML = `${head}
      <div class="empty-state exp-empty">
        <div class="serif-line">No expenses yet.</div>
        <p>Rent, supplies, sourcing trips, subscriptions: record what the business spends so you can see it by category and export it at tax time.</p>
        <p class="exp-empty-note">${ACCRUAL_NOTE}</p>
        ${addBtn ? `<div class="exp-actions">${addBtn}</div>` : ''}
      </div>`;
    wire(view);
    return;
  }

  const catRows = sum.byCategory.map(c => `
      <div class="fin-row">
        <span class="fin-row-text"><span class="fin-row-name">${escapeHtml(c.label)}</span><span class="fin-row-sub">${c.count} entr${c.count === 1 ? 'y' : 'ies'}</span></span>
        <span class="fin-row-num">${money2(c.total)}</span>
      </div>`).join('');

  const groups = groupByMonth(list);
  const listBody = groups.length ? groups.map(g => `
      <div class="exp-month">
        <div class="exp-month-head"><span>${monthName(g.key)}</span><span class="exp-month-total">${money2(g.total)}</span></div>
        ${g.items.map(e => {
          const refund = e.kind === 'refund';
          const sub = `${dayName(e.date)}${e.description ? ' · ' + escapeHtml(e.description) : ''}`;
          const inner = `
            <span class="fin-row-text"><span class="fin-row-name">${escapeHtml(categoryLabel(e.category))}${refund ? ' <span class="exp-tag">Refund</span>' : ''}</span><span class="fin-row-sub">${sub}</span></span>
            <span class="fin-row-num${refund ? ' positive' : ''}">${money2(signedAmount(e))}</span>`;
          return canEdit
            ? `<button type="button" class="fin-row fin-row-btn" data-expense-edit="${escapeHtml(e.id)}" aria-label="Edit ${escapeHtml(categoryLabel(e.category))}, ${dayName(e.date)}, ${money2(signedAmount(e))}">${inner}</button>`
            : `<div class="fin-row">${inner}</div>`;
        }).join('')}
      </div>`).join('')
    : `<div class="attn-empty">No expenses in ${periodName(period, now)}.</div>`;

  view.innerHTML = `${head}
    <section class="panel fin-panel exp-summary" aria-label="Expense total">
      <div class="panel-head">
        <h2 class="panel-title">Total spent</h2>
        ${addBtn}
      </div>
      <div class="fin-big">${money2(sum.total)}<small> · ${sum.count} entr${sum.count === 1 ? 'y' : 'ies'}${sum.refunds ? ` · ${money2(sum.refunds)} refunded` : ''}</small></div>
      <p class="fin-note">${ACCRUAL_NOTE} Net profit on Overview and in the P&amp;L subtracts these.</p>
    </section>
    <div class="fin-pair">
      <section class="panel fin-panel" aria-label="By category">
        <div class="panel-head"><h2 class="panel-title">By category</h2></div>
        ${catRows ? `<div class="fin-rows">${catRows}</div>` : `<div class="attn-empty">Nothing in this period.</div>`}
      </section>
      <section class="panel fin-panel" aria-label="Expenses">
        <div class="panel-head">
          <h2 class="panel-title">Expenses</h2>
          ${list.length ? `<button type="button" class="link-btn exp-export" data-expense-export>Export ${escapeHtml(periodName(period, now))} (CSV)</button>` : ''}
        </div>
        ${listBody}
      </section>
    </div>`;
  wire(view);
}

function wire(view){
  view.querySelectorAll('[data-expense-period]').forEach(btn => btn.addEventListener('click', () => {
    setPeriod(btn.dataset.expensePeriod);
    renderExpenses();
  }));
  view.querySelectorAll('[data-expense-add]').forEach(btn => btn.addEventListener('click', () => openExpenseEditor(null)));
  view.querySelectorAll('[data-expense-edit]').forEach(btn => btn.addEventListener('click', () => {
    const e = cachedExpenses().find(x => x.id === btn.dataset.expenseEdit);
    if (e) openExpenseEditor(e);
  }));
  view.querySelectorAll('[data-expense-export]').forEach(btn => btn.addEventListener('click', exportPeriodCsv));
  view.querySelectorAll('[data-expense-retry]').forEach(btn => btn.addEventListener('click', async () => {
    btn.disabled = true;
    await loadExpenses();
    renderExpenses();
    hooks.onChange();
  }));
}

// The period on screen (v3.23.5): the file matches what the list shows.
function exportPeriodCsv(){
  const now = Date.now();
  const period = getPeriod();
  const today = isoDate(now);
  const tag = period === 'month' ? today.slice(0, 7) : period === 'year' ? today.slice(0, 4) : 'all';
  hooks.downloadCsv(`calculated-chaos-expenses-${tag}.csv`, expenseCsvRows(expensesInPeriod(cachedExpenses(), period, now)));
}

// Every expense, all time (Reports → Export → All expenses).
export function exportExpensesCsv(){
  hooks.downloadCsv(`calculated-chaos-expenses-${isoDate(Date.now())}.csv`, expenseCsvRows(cachedExpenses()));
}

// A short confirmation after the dialog closes (v3.23.5). Tokens only.
function showToast(text){
  let t = document.getElementById('expToast');
  if (!t){
    t = document.createElement('div');
    t.id = 'expToast';
    t.className = 'exp-toast';
    t.setAttribute('role', 'status');
    document.body.appendChild(t);
  }
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------- EDITOR ----------
export function openExpenseEditor(expense){
  if (!hooks.canEdit()) return;
  const editing = !!expense;
  const start = expense || { date: isoDate(Date.now()), category: '', amount: '', description: '', kind: 'expense' };
  const catOptions = `<option value=""${start.category ? '' : ' selected'} disabled>Choose a category</option>` +
    EXPENSE_CATEGORIES.map(c => `<option value="${c.key}"${c.key === start.category ? ' selected' : ''}>${escapeHtml(c.label)}</option>`).join('');
  const hintFor = (key) => (EXPENSE_CATEGORIES.find(c => c.key === key) || {}).hint || '';

  const dlg = document.createElement('dialog');
  dlg.className = 'goal-dialog exp-dialog';
  dlg.setAttribute('aria-labelledby', 'expDialogTitle');
  dlg.innerHTML = `
    <form method="dialog" class="goal-form" novalidate>
      <h2 id="expDialogTitle">${editing ? 'Edit expense' : 'Add expense'}</h2>
      <div class="seg seg-wide exp-kind" role="radiogroup" aria-label="Type">
        <button type="button" class="seg-btn" role="radio" data-kind="expense">Expense</button>
        <button type="button" class="seg-btn" role="radio" data-kind="refund">Refund</button>
      </div>
      <p class="goal-hint exp-kind-hint"></p>
      <div class="exp-fields">
        <label class="goal-field"><span>Date</span>
          <input type="date" class="exp-input" data-k="date" value="${escapeHtml(start.date)}" required></label>
        <label class="goal-field"><span>Amount</span>
          <span class="goal-input"><span class="goal-affix">$</span><input type="text" data-k="amount" inputmode="decimal" autocomplete="off" value="${start.amount ? Number(start.amount).toFixed(2) : ''}" placeholder="0.00"></span></label>
        <label class="goal-field exp-wide"><span>Category</span>
          <select data-k="category">${catOptions}</select></label>
        <p class="exp-cat-hint exp-wide" aria-live="polite">${escapeHtml(hintFor(start.category))}</p>
        <label class="goal-field exp-wide"><span>Description <small>(optional)</small></span>
          <input type="text" class="exp-input" data-k="description" maxlength="${MAX_DESCRIPTION}" value="${escapeHtml(start.description || '')}" placeholder="e.g. Poly mailers, 100 pack"></label>
        <p class="exp-date-note exp-wide" aria-live="polite" hidden></p>
      </div>
      <div class="goal-actions exp-dialog-actions">
        <p class="exp-saved" role="status" hidden></p>
        <p class="goal-error" role="alert" hidden></p>
        ${editing ? '<button type="button" class="row-btn danger exp-delete" data-exp-delete>Delete</button>' : ''}
        <button type="button" class="secondary-btn" data-exp-cancel>Cancel</button>
        ${editing ? '' : '<button type="button" class="secondary-btn" data-exp-again>Save and add another</button>'}
        <button type="submit" class="primary-btn" data-exp-save>Save</button>
      </div>
    </form>`;
  document.body.appendChild(dlg);

  const field = (k) => dlg.querySelector(`[data-k="${k}"]`);
  const error = dlg.querySelector('.goal-error');
  const saved = dlg.querySelector('.exp-saved');
  const showError = (msg) => { error.textContent = msg; error.hidden = !msg; };
  let kind = start.kind === 'refund' ? 'refund' : 'expense';
  const setKind = (k) => {
    kind = k;
    dlg.querySelectorAll('[data-kind]').forEach(b => {
      const on = b.dataset.kind === k;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    dlg.querySelector('.exp-kind-hint').textContent = k === 'refund'
      ? 'Money you got back on an earlier expense. It lowers the total.'
      : 'Money the business spent.';
  };
  setKind(kind);
  dlg.querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => setKind(b.dataset.kind)));
  field('category').addEventListener('change', () => {
    dlg.querySelector('.exp-cat-hint').textContent = hintFor(field('category').value);
  });
  // A future date is allowed (rent paid ahead) but said out loud (v3.23.5).
  const dateNote = dlg.querySelector('.exp-date-note');
  const checkDate = () => {
    const v = field('date').value;
    const future = /^\d{4}-\d{2}-\d{2}$/.test(v) && v > isoDate(Date.now());
    dateNote.hidden = !future;
    if (future) dateNote.textContent = `This date is in the future; it counts in ${monthName(v.slice(0, 7))}.`;
  };
  field('date').addEventListener('input', checkDate);
  field('date').addEventListener('change', checkDate);
  checkDate();

  const buttons = () => dlg.querySelectorAll('.exp-dialog-actions button');
  const busy = (on) => buttons().forEach(b => { b.disabled = on; });

  async function submit({ again = false } = {}){
    showError('');
    saved.hidden = true;
    if (!hooks.canEdit()) return showError('Only the owner can change expenses.');
    const check = validateExpense({
      date: field('date').value, category: field('category').value,
      amount: field('amount').value, description: field('description').value, kind,
    });
    if (!check.ok){
      const f = field(check.field);
      if (f) f.focus();
      return showError(check.error);
    }
    busy(true);
    const result = await saveExpense(check.expense, { id: editing ? expense.id : null, uid: hooks.uid() });
    busy(false);
    if (!result) return showError('Couldn’t save. Check your connection and try again.');
    renderExpenses();
    hooks.onChange();
    if (again){
      // Same date and category for the next receipt; amount and note clear.
      saved.textContent = `Saved ${money2(signedAmount(result))} · ${categoryLabel(result.category)}.`;
      saved.hidden = false;
      field('amount').value = '';
      field('description').value = '';
      setKind('expense');
      field('amount').focus();
      return;
    }
    dlg.close();
    showToast(`Saved ${money2(signedAmount(result))} \u00b7 ${categoryLabel(result.category)}`);
  }

  dlg.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  const againBtn = dlg.querySelector('[data-exp-again]');
  if (againBtn) againBtn.addEventListener('click', () => submit({ again: true }));
  dlg.querySelector('[data-exp-cancel]').addEventListener('click', () => dlg.close());
  const delBtn = dlg.querySelector('[data-exp-delete]');
  if (delBtn) delBtn.addEventListener('click', async () => {
    if (!hooks.canEdit()) return showError('Only the owner can change expenses.');
    if (!confirm(`Delete this expense (${categoryLabel(expense.category)}, ${money2(signedAmount(expense))})?`)) return;
    busy(true);
    const ok = await deleteExpense(expense.id);
    busy(false);
    if (!ok) return showError('Couldn’t delete. Check your connection and try again.');
    renderExpenses();
    hooks.onChange();
    dlg.close();
    showToast('Expense deleted');
  });
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
  (editing ? field('amount') : field('category')).focus();
}
