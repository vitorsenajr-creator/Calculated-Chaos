// Finances screen (UI layer; v3.21.3): Overview, Months and Reports
// sub-tabs, moved out of main.js. The numbers come from
// domain/finance-summary.js and modules/reports.js; this file only draws
// them and wires the taps. The export buttons keep their ids and are
// wired by main.js (wireExports), unchanged.
// One layout for all three themes; only the theme's tokens differ.
import { items, appSettings } from '../../modules/state.js';
import { escapeHtml, daysSince, statusLabel } from '../../modules/format-utils.js';
import { computeReportsData } from '../../modules/reports.js';
import { computeFinanceOverview, monthlyTotals, monthLabel, FINANCE_PERIODS } from '../../domain/finance-summary.js';

// Its own period, separate from Home's (Vitor, 2026-10-20).
const PERIOD_KEY = 'cc.finance.period';
const PERIOD_LABEL = { month: 'Month', year: 'Year', all: 'All time' };

let hooks = {
  projectedProfit: () => 0,
  platformLabel: (key) => key,
  platformColor: () => 'var(--brand-2)',
  openTab: () => {},
  openItem: () => {},
  wireExports: () => {},
};

// The month opened in the Months list (one at a time).
let openMonth = null;

export function initFinanceView(h){
  hooks = { ...hooks, ...h };
}

// Per-device convenience; storage can be blocked (private mode).
function getPeriod(){
  try{
    const p = localStorage.getItem(PERIOD_KEY);
    return FINANCE_PERIODS.includes(p) ? p : 'month';
  }catch(e){ return 'month'; }
}
function setPeriod(p){
  try{ localStorage.setItem(PERIOD_KEY, p); }catch(e){ /* not persisted */ }
}

function money(n){
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}
function money2(n){
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function periodName(period, now){
  const d = new Date(now);
  if (period === 'month') return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  if (period === 'year') return String(d.getFullYear());
  return 'All time';
}
// "Sep 1–20" / "Jan 1–Oct 20, 2025": the stretch the changes compare with.
function compareName(prev, now){
  const start = new Date(prev.start);
  const last = new Date(prev.end - 1);
  const md = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const sameMonth = start.getMonth() === last.getMonth();
  const range = sameMonth ? `${md(start)}–${last.getDate()}` : `${md(start)}–${md(last)}`;
  return start.getFullYear() === new Date(now).getFullYear() ? range : `${range}, ${start.getFullYear()}`;
}

// The change under a summary number. `fmt` formats the size of the change.
function delta(cur, prev, fmt, compare){
  if (prev === null || cur === null || (cur === 0 && prev === 0)) return '';
  const diff = cur - prev;
  const flat = Math.abs(diff) < 0.005;
  const word = flat ? 'No change' : diff > 0 ? 'Up' : 'Down';
  const mark = flat ? '' : diff > 0 ? '▲ ' : '▼ ';
  const text = flat ? 'No change' : `${mark}${fmt(Math.abs(diff))}`;
  return `<span class="fin-delta${!flat && diff > 0 ? ' up' : ''}" aria-label="${word}${flat ? '' : ' ' + fmt(Math.abs(diff))} vs ${compare}">${text}</span>`;
}

function periodSuffix(period, now){
  if (period === 'month') return ` in ${new Date(now).toLocaleDateString('en-US', { month: 'short' })}`;
  if (period === 'year') return ` in ${new Date(now).getFullYear()}`;
  return '';
}

const row = (name, sub, num, { numClass = '', attrs = '' } = {}) => {
  const tag = attrs ? 'button' : 'div';
  return `
    <${tag} ${attrs ? `type="button" ${attrs}` : ''} class="fin-row${attrs ? ' fin-row-btn' : ''}">
      <span class="fin-row-text"><span class="fin-row-name">${name}</span>${sub ? `<span class="fin-row-sub">${sub}</span>` : ''}</span>
      <span class="fin-row-num${numClass}">${num}</span>
    </${tag}>`;
};

const panel = (title, meta, body, extraClass = '') => `
  <section class="panel fin-panel${extraClass}" aria-label="${escapeHtml(title)}">
    <div class="panel-head">
      <h2 class="panel-title">${escapeHtml(title)}</h2>
      ${meta ? `<span class="panel-meta">${meta}</span>` : ''}
    </div>
    ${body}
  </section>`;

// Renders all three panes; only the active one is visible (main.js).
export function renderFinance(){
  renderOverview();
  renderMonths();
  renderReports();
}

// ---------- OVERVIEW ----------
function renderOverview(){
  const view = document.getElementById('financeView');
  if (!view) return;
  const now = Date.now();
  const period = getPeriod();
  const { totals, previous, sellThrough, split, lastTwelve, byPlatform, topBrands, topCategories, stock } = computeFinanceOverview(items, {
    period, now, projectedProfit: hooks.projectedProfit,
  });
  const suffix = periodSuffix(period, now);

  const periodButtons = FINANCE_PERIODS.map(p => `
    <button type="button" class="seg-btn${p === period ? ' active' : ''}" data-finance-period="${p}" aria-pressed="${p === period}">${PERIOD_LABEL[p]}</button>`).join('');

  const compare = previous ? compareName(previous, now) : '';
  const cell = (label, value, extraClass = '', change = '') => `
    <div class="summary-cell static">
      <span class="summary-label">${label}</span>
      <span class="summary-value${extraClass}">${value}</span>
      ${change}
    </div>`;
  const prevTotals = previous ? previous.totals : null;
  const change = (cur, key, fmt) => previous ? delta(cur, prevTotals[key], fmt, compare) : '';
  const pts = (n) => `${n.toFixed(1)} pts`;
  const count = (n) => Math.round(n).toLocaleString('en-US');

  // Where each dollar went: one stacked bar, then the parts in words.
  const splitBody = totals.revenue > 0 ? `
      <div class="split-bar" role="img" aria-label="${split.map(p => `${p.label} ${money(p.amount)}`).join(', ')}">${split.filter(p => p.share > 0).map(p =>
        `<span class="split-seg split-${p.key}" style="flex-grow:${p.share.toFixed(4)};" title="${p.label}: ${money2(p.amount)}"></span>`).join('')}</div>
      <ul class="split-legend">${split.map(p => `
        <li><span class="split-dot split-${p.key}" aria-hidden="true"></span>
          <span class="split-name">${p.label}</span>
          <span class="split-cents">${Math.round(totals.revenue > 0 ? p.amount / totals.revenue * 100 : 0)}¢ per $1</span>
          <span class="split-amt">${money2(p.amount)}</span></li>`).join('')}</ul>
      ${totals.profit < 0 ? `<p class="fin-note">Costs were ${money2(-totals.profit)} more than the revenue${suffix}.</p>` : ''}`
    : `<div class="attn-empty">No sales${suffix} yet.</div>`;

  // Profit by month, last 12 months; a month with sales opens in Months.
  const maxPos = Math.max(0, ...lastTwelve.map(m => m.profit));
  const maxNeg = Math.max(0, ...lastTwelve.map(m => -m.profit));
  const range = maxPos + maxNeg;
  const zero = range > 0 ? maxPos / range * 100 : 100;
  const best = lastTwelve.reduce((b, m) => (m.profit > (b ? b.profit : 0) ? m : b), null);
  const twelveTotal = lastTwelve.reduce((t, m) => t + m.profit, 0);
  const bars = lastTwelve.map(m => {
    const h = range > 0 ? Math.abs(m.profit) / range * 100 : 0;
    const pos = m.profit >= 0;
    const label = `${monthLabel(m.key, { long: true })}: ${money2(m.profit)} profit, ${m.count} sold`;
    const tag = m.count ? 'button' : 'div';
    return `
      <${tag} ${m.count ? `type="button" data-finance-month="${m.key}"` : ''} class="month-col${m.count ? '' : ' empty'}" aria-label="${label}" title="${label}">
        <span class="month-plot">
          <span class="month-zero" style="top:${zero}%;" aria-hidden="true"></span>
          <span class="month-bar${pos ? '' : ' neg'}${m.key === lastTwelve[11].key ? ' current' : ''}" style="${pos ? `bottom:${100 - zero}%` : `top:${zero}%`}; height:${h.toFixed(2)}%;"></span>
          ${best && m.key === best.key ? `<span class="month-peak" style="bottom:calc(${(100 - zero + h).toFixed(2)}% + 2px);">${money(m.profit)}</span>` : ''}
        </span>
        <span class="month-name">${monthLabel(m.key).charAt(0)}<span class="month-name-rest">${monthLabel(m.key).slice(1)}</span></span>
      </${tag}>`;
  }).join('');
  const chartBody = lastTwelve.some(m => m.count) ? `
      <div class="month-chart">${bars}</div>`
    : `<div class="attn-empty">No sales in the last 12 months.</div>`;

  // By platform: the revenue bar, then units, average profit and days to
  // sell for each.
  const totalPlatform = byPlatform.reduce((t, r) => t + r.revenue, 0);
  const platformBody = byPlatform.length ? `
      ${totalPlatform > 0 ? `<div class="rev-bar" aria-hidden="true">${byPlatform.map(r =>
        `<span style="width:${(r.revenue / totalPlatform * 100).toFixed(2)}%; background:${hooks.platformColor(r.platform)};"></span>`).join('')}</div>` : ''}
      <ul class="plat-list">${byPlatform.map(r => `
        <li class="plat-row">
          <span class="rev-dot" style="background:${hooks.platformColor(r.platform)};" aria-hidden="true"></span>
          <span class="plat-text">
            <span class="plat-name">${escapeHtml(hooks.platformLabel(r.platform))}</span>
            <span class="plat-sub">${r.count} sold · ${money2(r.avgProfit)} avg profit${r.avgDaysToSell !== null ? ` · ${Math.round(r.avgDaysToSell)}d avg to sell` : ''}</span>
          </span>
          <span class="plat-amt">${money(r.revenue)}</span>
        </li>`).join('')}</ul>`
    : `<div class="attn-empty">No sales${suffix} yet.</div>`;

  // Top brands and categories by units sold in the period.
  const topBody = (list, what) => list.length ? `
      <ol class="fin-rows top-list">${list.map((r, n) => `
        <li class="fin-row">
          <span class="top-rank" aria-hidden="true">${n + 1}</span>
          <span class="fin-row-text"><span class="fin-row-name">${escapeHtml(r.name)}</span><span class="fin-row-sub">${money(r.revenue)} revenue · ${money(r.profit)} profit</span></span>
          <span class="fin-row-num">${r.count} sold</span>
        </li>`).join('')}</ol>`
    : `<div class="attn-empty">No sales with a ${what}${suffix} yet.</div>`;

  const stockBody = `
      <div class="fin-big">${money(stock.projected)}</div>
      <p class="fin-note">Projected profit from ${stock.count.toLocaleString('en-US')} item${stock.count === 1 ? '' : 's'} not sold yet, after fees and shipping. ${money(stock.atListPrice)} at list price.</p>
      <div class="fin-panel-foot"><button type="button" class="link-btn" data-finance-goto="reports">By category in Reports</button></div>`;

  view.innerHTML = `
    <div class="fin-head">
      <div class="seg" role="group" aria-label="Period">${periodButtons}</div>
      <span class="fin-period">${periodName(period, now)}${previous ? `<span class="fin-compare"> · vs ${compare}</span>` : ''}</span>
    </div>
    <section class="summary-panel fin-summary" aria-label="Summary">
      ${cell('Revenue', money(totals.revenue), '', change(totals.revenue, 'revenue', money))}
      ${cell('Net profit', money(totals.profit), totals.profit >= 0 ? ' positive' : ' negative', change(totals.profit, 'profit', money))}
      ${cell('Margin', `${totals.margin.toFixed(1)}%`, '', previous && totals.revenue > 0 && prevTotals.revenue > 0 ? delta(totals.margin, prevTotals.margin, pts, compare) : '')}
      ${cell('Items sold', totals.count.toLocaleString('en-US'), '', change(totals.count, 'count', count))}
      ${cell('Sell-through', sellThrough.rate === null ? '–' : `${sellThrough.rate.toFixed(0)}%`, '',
        previous ? delta(sellThrough.rate, previous.sellThrough.rate, pts, compare) : '')}
    </section>
    ${sellThrough.available ? `<p class="fin-note fin-summary-note">Sell-through: ${sellThrough.sold.toLocaleString('en-US')} sold of ${sellThrough.available.toLocaleString('en-US')} item${sellThrough.available === 1 ? '' : 's'} in stock or cataloged${period === 'all' ? '' : suffix}.</p>` : ''}
    ${panel('Where each dollar went', money(totals.revenue) + ' revenue', splitBody, ' split')}
    ${panel('Profit, last 12 months', range > 0 ? `${money(twelveTotal)} total` : '', chartBody, ' months-chart')}
    <div class="home-lower">
      ${panel('By platform', `${money(totalPlatform)}${suffix}`, platformBody, ' revenue')}
      ${panel('In stock', '', stockBody)}
    </div>
    <div class="fin-pair">
      ${panel('Top brands', 'by units sold', topBody(topBrands, 'brand'), ' top')}
      ${panel('Top categories', 'by units sold', topBody(topCategories, 'category'), ' top')}
    </div>`;

  view.querySelectorAll('[data-finance-period]').forEach(btn => btn.addEventListener('click', () => {
    setPeriod(btn.dataset.financePeriod);
    renderOverview();
  }));
  view.querySelectorAll('[data-finance-month]').forEach(btn => btn.addEventListener('click', () => {
    openMonth = btn.dataset.financeMonth;
    renderMonths();
    hooks.openTab('months');
    const target = document.querySelector(`[data-month-row="${openMonth}"]`);
    if (target) target.scrollIntoView({ block: 'start' });
  }));
  view.querySelectorAll('[data-finance-goto]').forEach(btn => btn.addEventListener('click', () => {
    hooks.openTab(btn.dataset.financeGoto);
  }));
}

// ---------- MONTHS ----------
// One row per month; the open one shows the full breakdown, the same
// numbers the old Finances screen showed.
function renderMonths(){
  const view = document.getElementById('monthsView');
  if (!view) return;
  const months = monthlyTotals(items);
  if (months.length === 0){
    view.innerHTML = `<div class="empty-state">
      <div class="serif-line">Nothing sold just yet.</div>
      <p>Mark an item as "Sold" and your monthly financial summary will show up here.</p>
    </div>`;
    return;
  }
  const detail = (m) => `
    <dl class="month-detail">
      <div><dt>Gross revenue</dt><dd>${money2(m.revenue)}</dd></div>
      <div><dt>Acquisition cost</dt><dd class="cost">${money2(m.cost)}</dd></div>
      <div><dt>Platform fees</dt><dd class="cost">${money2(m.fees)}</dd></div>
      <div><dt>Shipping paid</dt><dd class="cost">${money2(m.shipping)}</dd></div>
      <div><dt>Other costs</dt><dd class="cost">${money2(m.other)}</dd></div>
      <div><dt>Net profit</dt><dd class="${m.profit >= 0 ? 'positive' : 'negative'}">${money2(m.profit)}</dd></div>
      <div><dt>Net margin</dt><dd>${m.margin.toFixed(1)}%</dd></div>
    </dl>`;
  const rows = months.map(m => {
    const open = m.key === openMonth;
    return `
      <div class="month-item${open ? ' open' : ''}" data-month-row="${m.key}">
        <button type="button" class="month-row" data-month-toggle="${m.key}" aria-expanded="${open}">
          <span class="month-row-name">${monthLabel(m.key, { long: true })}<small>${m.count} sold</small></span>
          <span class="month-row-cell"><small>Revenue</small>${money(m.revenue)}</span>
          <span class="month-row-cell${m.profit >= 0 ? '' : ' negative'}"><small>Profit</small>${money(m.profit)}</span>
          <span class="month-row-cell"><small>Margin</small>${m.margin.toFixed(0)}%</span>
          <svg class="month-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
        </button>
        ${open ? detail(m) : ''}
      </div>`;
  }).join('');
  view.innerHTML = `<section class="panel months-list" aria-label="Months">${rows}</section>`;
  view.querySelectorAll('[data-month-toggle]').forEach(btn => btn.addEventListener('click', () => {
    openMonth = openMonth === btn.dataset.monthToggle ? null : btn.dataset.monthToggle;
    renderMonths();
    const again = view.querySelector(`[data-month-toggle="${btn.dataset.monthToggle}"]`);
    if (again) again.focus();
  }));
}

// ---------- REPORTS ----------
function renderReports(){
  const view = document.getElementById('reportsView');
  if (!view) return;
  const { sold, active, catRows, projectedRows, totalProjected, topItemsByProfit, topProjectedItems, slowMovers } = computeReportsData(items, appSettings);
  const sub = (i) => `${escapeHtml(i.category || '')}${i.brand ? ' · ' + escapeHtml(i.brand) : ''}`;

  let html = '';

  if (active.length > 0){
    html += panel('Projected pipeline', '', `
      <p class="fin-note">What's still on the shelf, estimated at today's suggested or listed prices, after fees and shipping.</p>
      <div class="fin-big">${money2(totalProjected)}<small> across ${active.length} active item${active.length === 1 ? '' : 's'}</small></div>
      <div class="fin-rows">${projectedRows.map(r =>
        row(escapeHtml(r.cat), `${r.count} item${r.count === 1 ? '' : 's'} not yet sold`, money(r.projected))).join('')}</div>`);
  }

  if (catRows.length > 0){
    html += panel('Category performance', '', `
      <p class="fin-note">Realized profit from items already sold.</p>
      <div class="fin-rows">${catRows.map(r => {
        const proj = projectedRows.find(p => p.cat === r.cat);
        return row(escapeHtml(r.cat),
          `${r.count} sold · avg ${r.avgDaysToSell.toFixed(0)}d to sell · ${r.margin.toFixed(0)}% margin${proj ? ` · $${proj.projected.toFixed(0)} more projected` : ''}`,
          money(r.profit), { numClass: r.profit >= 0 ? ' positive' : ' negative' });
      }).join('')}</div>`);
  }

  if (topProjectedItems.length > 0){
    html += panel('Biggest upside waiting to sell', '', `
      <div class="fin-rows">${topProjectedItems.map(i =>
        row(escapeHtml(i.name), `${sub(i)} · ${statusLabel(i.status)}`, money2(hooks.projectedProfit(i)))).join('')}</div>`);
  }

  if (topItemsByProfit.length > 0){
    html += panel('Best earners', '', `
      <div class="fin-rows">${topItemsByProfit.map(i =>
        row(escapeHtml(i.name), sub(i), money2(i.netProfit || 0), { numClass: ' positive' })).join('')}</div>`);
  }

  if (slowMovers.length > 0){
    html += panel('Stale eBay listings (30+ days, unsold)', '', `
      <p class="fin-note">Still live and hasn't sold. Worth a price drop, refreshed photos, or a Best Offer.</p>
      <div class="fin-rows">${slowMovers.map(i =>
        row(escapeHtml(i.name), `${escapeHtml(i.category || '')} · listed at $${(parseFloat(i.listPrice) || 0).toFixed(2)}`,
          `${daysSince(i.ebayListedAt)}d`, { numClass: ' warn', attrs: `data-open-item="${i.id}"` })).join('')}</div>`);
  }

  if (sold.length === 0 && catRows.length === 0 && slowMovers.length === 0 && active.length === 0){
    html += `<div class="empty-state">
      <div class="serif-line">Reports build themselves as you go.</div>
      <p>Once you've cataloged and sold a few pieces, performance insights will show up here.</p>
    </div>`;
  }

  const exportBtn = (id, title, desc) => `
    <button type="button" class="export-btn" id="${id}">
      <span><span class="et-title">${title}</span><span class="et-sub">${desc}</span></span>
      <svg class="et-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v12M6 11l6 6 6-6M5 20h14"/></svg>
    </button>`;
  html += panel('Export', '', `
    <div class="export-list">
      ${exportBtn('exportExcel', 'Excel (.xlsx)', 'The original Clothing Inventory Tracker format, ready to open in Excel')}
      ${exportBtn('exportFullInventory', 'Full inventory (CSV)', 'Every item, every status, for backup or spreadsheet work')}
      ${exportBtn('exportSoldOnly', 'Sold items only (CSV)', 'For taxes or bookkeeping')}
      ${exportBtn('exportCategoryReport', 'Performance by category (CSV)', "See what's worth sourcing more of")}
      ${exportBtn('exportExpenses', 'Expenses (CSV)', 'Every expense and refund, with its category')}
    </div>`, ' export');

  view.innerHTML = html;
  hooks.wireExports();
  view.querySelectorAll('[data-open-item]').forEach(btn => btn.addEventListener('click', () => {
    hooks.openItem(btn.dataset.openItem);
  }));
}
