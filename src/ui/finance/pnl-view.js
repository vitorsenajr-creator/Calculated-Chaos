// Finances → Reports → Profit & Loss (UI layer; v3.23.4). The statement
// comes from domain/profit-loss.js; this file draws it at the top of
// Reports, with its own period (`cc.pnl.period`, per device) and a CSV
// export. Tokens only, one layout for every theme.
import { items } from '../../modules/state.js';
import { escapeHtml } from '../../modules/format-utils.js';
import { cachedExpenses, expensesState } from '../../data/expense-store.js';
import { PNL_PERIODS, PNL_PERIOD_LABEL, computeProfitLoss, pnlPeriodName, pnlCsvRows } from '../../domain/profit-loss.js';

const PERIOD_KEY = 'cc.pnl.period';

let hooks = {
  platformLabel: (key) => key,
  downloadCsv: () => {},
};

export function initPnlView(h){
  hooks = { ...hooks, ...h };
}

function getPeriod(){
  try{
    const p = localStorage.getItem(PERIOD_KEY);
    return PNL_PERIODS.includes(p) ? p : 'this_year';
  }catch(e){ return 'this_year'; }
}
function setPeriod(p){
  try{ localStorage.setItem(PERIOD_KEY, p); }catch(e){ /* not persisted */ }
}

// Overview's "See P&L" opens the statement on Overview's period (v3.23.5).
const FROM_OVERVIEW = { month: 'this_month', year: 'this_year', all: 'all' };
export function setPnlPeriodFromOverview(period){
  if (FROM_OVERVIEW[period]) setPeriod(FROM_OVERVIEW[period]);
}

function money2(n){
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const line = (name, amount, { cls = '', sub = '' } = {}) => `
  <div class="pnl-row${cls}">
    <span class="pnl-name">${name}${sub ? `<small>${sub}</small>` : ''}</span>
    <span class="pnl-amt">${money2(amount)}</span>
  </div>`;
const head = (name) => `<h3 class="pnl-sec">${name}</h3>`;

// Draws the panel into `slot` (an element at the top of Reports).
export function renderPnl(slot){
  if (!slot) return;
  const now = Date.now();
  const period = getPeriod();
  const pnl = computeProfitLoss(items, cachedExpenses(), { period, now });
  const name = pnlPeriodName(period, now);
  const options = PNL_PERIODS.map(p => `<option value="${p}"${p === period ? ' selected' : ''}>${PNL_PERIOD_LABEL[p]}</option>`).join('');
  const expNote = expensesState() === 'failed'
    ? '<p class="fin-note pnl-warn" role="alert">Expenses couldn’t be loaded, so they’re missing below. Open Expenses to try again.</p>' : '';

  const empty = pnl.salesCount === 0 && pnl.expenses.count === 0;
  const sellingTotal = Math.round((pnl.selling.total - pnl.adjustment) * 100) / 100;
  const body = empty ? `<div class="attn-empty">No sales or expenses in ${escapeHtml(name)}.</div>` : `
    <div class="pnl-eq" role="group" aria-label="Revenue ${money2(pnl.revenue.total)} minus item and selling costs ${money2(pnl.cogs + sellingTotal)} minus expenses ${money2(pnl.expenses.total)} equals net profit ${money2(pnl.netProfit)}">
      <span class="pnl-eq-item"><small>Revenue</small><span>${money2(pnl.revenue.total)}</span></span><b aria-hidden="true">−</b>
      <span class="pnl-eq-item"><small><i class="pnl-op" aria-hidden="true">− </i>Item &amp; selling costs</small><span>${money2(pnl.cogs + sellingTotal)}</span></span><b aria-hidden="true">−</b>
      <span class="pnl-eq-item"><small><i class="pnl-op" aria-hidden="true">− </i>Expenses</small><span>${money2(pnl.expenses.total)}</span></span><b aria-hidden="true">=</b>
      <span class="pnl-eq-item pnl-eq-net${pnl.netProfit < 0 ? ' negative' : ''}"><small><i class="pnl-op" aria-hidden="true">= </i>Net profit</small><span>${money2(pnl.netProfit)}</span></span>
    </div>
    <div class="pnl">
      ${head('Revenue')}
      ${pnl.revenue.byPlatform.map(r => line(escapeHtml(hooks.platformLabel(r.platform)), r.amount, { sub: `${r.count} sold` })).join('')}
      ${line('Total revenue', pnl.revenue.total, { cls: ' total' })}
      ${head('Cost of goods sold')}
      ${line('Item cost', pnl.cogs)}
      ${line('Gross profit', pnl.grossProfit, { cls: ' result' })}
      ${head('Selling costs')}
      ${line('Platform fees', pnl.selling.fees)}
      ${line('Shipping paid', pnl.selling.shipping)}
      ${line('Other sale costs', pnl.selling.other)}
      ${pnl.adjustment ? line('Sale adjustments', -pnl.adjustment, { sub: 'Difference between these lines and the profit saved on each sale' }) : ''}
      ${line('Total selling costs', sellingTotal, { cls: ' total' })}
      ${head('Operating expenses')}
      ${pnl.expenses.byCategory.length ? pnl.expenses.byCategory.map(c => line(escapeHtml(c.label), c.total)).join('') : '<div class="pnl-row pnl-none"><span class="pnl-name">No expenses recorded</span></div>'}
      ${line('Total operating expenses', pnl.expenses.total, { cls: ' total' })}
      ${line('Net profit', pnl.netProfit, { cls: ` result net${pnl.netProfit < 0 ? ' negative' : ''}` })}
    </div>`;

  slot.innerHTML = `
    <section class="panel fin-panel pnl-panel" aria-label="Profit and loss">
      <div class="panel-head">
        <h2 class="panel-title">Profit &amp; Loss</h2>
        <label class="pnl-period"><span class="sr-only">Period</span>
          <select data-pnl-period>${options}</select></label>
      </div>
      <p class="fin-note">${escapeHtml(name)} · an item’s cost counts when it sells; expenses by their date.</p>
      ${expNote}
      ${body}
      <div class="fin-panel-foot pnl-foot"><button type="button" class="link-btn" data-pnl-export>Export CSV</button></div>
    </section>`;

  slot.querySelector('[data-pnl-period]').addEventListener('change', (e) => {
    setPeriod(e.target.value);
    renderPnl(slot);
  });
  slot.querySelector('[data-pnl-export]').addEventListener('click', exportPnlCsv);
}

// The statement for the period picked in the panel.
export function exportPnlCsv(){
  const now = Date.now();
  const period = getPeriod();
  const pnl = computeProfitLoss(items, cachedExpenses(), { period, now });
  const name = pnlPeriodName(period, now);
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  hooks.downloadCsv(`calculated-chaos-profit-loss-${slug}.csv`, pnlCsvRows(pnl, { periodName: name, platformLabel: hooks.platformLabel }));
}
