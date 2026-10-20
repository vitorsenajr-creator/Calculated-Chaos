// Home screen (UI layer; v3.20.0). The numbers come from
// domain/home-summary.js; this file only draws them and wires the taps.
// main.js passes in how to reach the other screens (initHomeView).
import { items } from '../../modules/state.js';
import { escapeHtml } from '../../modules/format-utils.js';
import { computeHomeSummary, HOME_PERIODS } from '../../domain/home-summary.js';

const PERIOD_KEY = 'cc.home.period';
const DISMISSED_KEY = 'cc.home.dismissed';
const PERIOD_LABEL = { month: 'Month', year: 'Year', all: 'All time' };

let hooks = {
  getDrafts: () => [],
  projectedProfit: () => 0,
  getDailyMessage: () => '',
  platformLabel: (key) => key,
  platformColor: () => 'var(--brand-2)',
  openCatalog: () => {},
  openTab: () => {},
  finishDrafts: () => {},
};

export function initHomeView(h){
  hooks = { ...hooks, ...h };
}

// Per-device conveniences only: the chosen period and dismissed rows.
// Storage can be blocked (private mode), so every access is guarded.
function readJson(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  }catch(e){ return fallback; }
}
function writeJson(key, value){
  try{ localStorage.setItem(key, JSON.stringify(value)); }catch(e){ /* not persisted */ }
}

function getPeriod(){
  const p = readJson(PERIOD_KEY, 'month');
  return HOME_PERIODS.includes(p) ? p : 'month';
}

function periodSuffix(period, now){
  if (period === 'month') return ` in ${new Date(now).toLocaleDateString('en-US', { month: 'short' })}`;
  if (period === 'year') return ` in ${new Date(now).getFullYear()}`;
  return '';
}

function money(n){
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

export function renderHome(){
  const view = document.getElementById('homeView');
  if (!view) return;
  const now = Date.now();
  const period = getPeriod();
  const { summary, pipeline, attention, revenueByPlatform } = computeHomeSummary(items, {
    drafts: hooks.getDrafts(), period, now, projectedProfit: hooks.projectedProfit,
  });
  // A dismissed row stays hidden only while its count is unchanged.
  const dismissed = readJson(DISMISSED_KEY, {});
  const openRows = attention.filter(r => dismissed[r.key] !== r.count);
  const suffix = periodSuffix(period, now);
  // The daily quote, alternating with an insight about the stock (main.js).
  const dailyMessage = hooks.getDailyMessage();

  const periodButtons = HOME_PERIODS.map(p => `
    <button type="button" class="seg-btn${p === period ? ' active' : ''}" data-home-period="${p}" aria-pressed="${p === period}">${PERIOD_LABEL[p]}</button>`).join('');

  const cell = (stat, label, value, extraClass = '') => `
    <button type="button" class="summary-cell" data-home-stat="${stat}">
      <span class="summary-label">${label}</span>
      <span class="summary-value${extraClass}">${value}</span>
    </button>`;

  const stop = (label, count, filled) => `
    <div class="pipeline-stop">
      <span class="pipeline-dot${filled ? '' : ' open'}" aria-hidden="true"></span>
      <span class="pipeline-count">${count}</span>
      <span class="pipeline-label">${label}</span>
    </div>`;

  const rows = openRows.map(r => `
    <div class="attn-row">
      <span class="attn-count tone-${r.tone}">${r.count}</span>
      <div class="attn-text">
        <div class="attn-title">${escapeHtml(r.title)}</div>
        <div class="attn-detail">${escapeHtml(r.detail)}</div>
      </div>
      <button type="button" class="attn-action" data-home-action="${r.key}">${escapeHtml(r.action)}</button>
      <button type="button" class="attn-dismiss" data-home-dismiss="${r.key}" data-count="${r.count}" aria-label="Dismiss: ${escapeHtml(r.title)}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>`).join('');

  const hiddenCount = attention.length - openRows.length;
  const attentionBody = rows || `<div class="attn-empty">${attention.length
    ? 'Everything here was dismissed. It comes back when something changes.'
    : items.length ? 'Nothing needs you right now.' : 'Add your first item with the + button to get started.'}</div>`;

  const totalRevenue = revenueByPlatform.reduce((t, r) => t + r.revenue, 0);
  const revenueBody = totalRevenue > 0 ? `
      <div class="rev-bar" aria-hidden="true">${revenueByPlatform.map(r =>
        `<span style="width:${(r.revenue / totalRevenue * 100).toFixed(2)}%; background:${hooks.platformColor(r.platform)};"></span>`).join('')}</div>
      <ul class="rev-legend">${revenueByPlatform.map(r => `
        <li><span class="rev-dot" style="background:${hooks.platformColor(r.platform)};"></span>
          <span class="rev-name">${escapeHtml(hooks.platformLabel(r.platform))}</span>
          <span class="rev-amt">${money(r.revenue)}</span>
          <span class="rev-count">${r.count} sold</span></li>`).join('')}</ul>`
    : `<div class="attn-empty">No sales${suffix} yet.</div>`;

  view.innerHTML = `
    <div class="home-head">
      <h1 class="screen-title">Today</h1>
      <div class="seg" role="group" aria-label="Period">${periodButtons}</div>
    </div>
    ${dailyMessage ? `<p class="daily-line">${escapeHtml(dailyMessage)}</p>` : ''}
    <section class="summary-panel" aria-label="Summary">
      ${cell('instock', 'In stock', summary.inStock.toLocaleString('en-US'))}
      ${cell('sold', `Sold${suffix}`, summary.sold.toLocaleString('en-US'))}
      ${cell('profit', `Profit${suffix}`, money(summary.profit), summary.profit >= 0 ? ' positive' : ' negative')}
      ${cell('projected', 'Projected, in stock', money(summary.projected))}
    </section>
    <section class="pipeline" aria-label="Pipeline">
      <span class="pipeline-line" aria-hidden="true"></span>
      ${stop('Cataloged', pipeline.cataloged, true)}
      ${stop('Listed', pipeline.listed, true)}
      ${stop(`Sold${suffix}`, pipeline.sold, false)}
    </section>
    <div class="home-lower">
    <section class="panel attention" aria-label="Needs attention">
      <div class="panel-head">
        <h2 class="panel-title">Needs attention</h2>
        <span class="panel-meta">${openRows.length} open${hiddenCount ? ` · <button type="button" class="link-btn" data-home-undismiss>Show dismissed</button>` : ''}</span>
      </div>
      ${attentionBody}
    </section>
    <section class="panel revenue" aria-label="Revenue by platform">
      <div class="panel-head">
        <h2 class="panel-title">Revenue by platform</h2>
        <span class="panel-meta">${money(totalRevenue)}${suffix}</span>
      </div>
      ${revenueBody}
    </section>
    </div>`;

  view.querySelectorAll('[data-home-period]').forEach(btn => btn.addEventListener('click', () => {
    writeJson(PERIOD_KEY, btn.dataset.homePeriod);
    renderHome();
  }));
  view.querySelectorAll('[data-home-stat]').forEach(btn => btn.addEventListener('click', () => {
    const stat = btn.dataset.homeStat;
    if (stat === 'instock') hooks.openCatalog({ notSold: true });
    else if (stat === 'sold') hooks.openCatalog({ status: 'vendido' });
    else if (stat === 'profit') hooks.openTab('finance');
    else if (stat === 'projected') hooks.openTab('reports');
  }));
  view.querySelectorAll('[data-home-action]').forEach(btn => btn.addEventListener('click', () => {
    const key = btn.dataset.homeAction;
    if (key === 'no-price') hooks.openCatalog({ noPrice: true });
    else if (key === 'missing-info') hooks.openCatalog({ incomplete: true, notSold: true });
    else if (key === 'stale') hooks.openCatalog({ stale: true });
    else if (key === 'drafts') hooks.finishDrafts();
  }));
  view.querySelectorAll('[data-home-dismiss]').forEach(btn => btn.addEventListener('click', () => {
    const next = readJson(DISMISSED_KEY, {});
    next[btn.dataset.homeDismiss] = Number(btn.dataset.count);
    writeJson(DISMISSED_KEY, next);
    renderHome();
  }));
  const undismiss = view.querySelector('[data-home-undismiss]');
  if (undismiss) undismiss.addEventListener('click', () => {
    writeJson(DISMISSED_KEY, {});
    renderHome();
  });
}
