// Home screen (UI layer; v3.20.0). The numbers come from
// domain/home-summary.js; this file only draws them and wires the taps.
// main.js passes in how to reach the other screens (initHomeView).
// Since v3.21.1 each theme lays the screen out its own way: Parcel (the
// pipeline line), Tag Week (shelf by weekly tag color) and Concourse (a
// "Next" band with the most urgent task, then the rest).
import { items, appSettings } from '../../modules/state.js';
import { normalizeIssueChecks } from '../../domain/item-issues.js';
import { escapeHtml } from '../../modules/format-utils.js';
import { computeHomeSummary, HOME_PERIODS } from '../../domain/home-summary.js';
import { shelfByTag, pinkTagStock } from '../../domain/week-tags.js';
import { currentTheme } from '../theme.js';
import { goalsPanelHtml, wireGoalsPanel } from './goals-panel.js';

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
  canEditGoals: () => false,
  getEbaySales: () => [],
  openEbaySales: () => {},
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

// Concourse words each task as a direction to follow.
const NEXT_PHRASE = {
  'no-price': 'Items need a price',
  'ebay-error': 'eBay publish failed: review',
  'duplicate-code': 'Codes used twice: fix them',
  'ebay-sales': 'eBay sales: delist or check',
  'missing-info': 'Items are missing info',
  'drafts': 'Photo drafts to finish',
  'pink': 'Pink tags: 4+ weeks on the shelf',
};
// The stale row's title carries the business's day limit.
const phrase = (r) => r.key === 'stale' ? `${r.title}: drop the price` : (NEXT_PHRASE[r.key] || r.title);
const TASK_ICON = {
  'ebay-error': '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17.5v.01"/>',
  'ebay-sales': '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/>',
  'duplicate-code': '<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
  'no-price': '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  'missing-info': '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  'stale': '<path d="M7 4v16M3 16l4 4 4-4"/><path d="M14 6h7M14 11h5M14 16h3"/>',
  'drafts': '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  'pink': '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
};
const ARROW = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
const CLOSE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

function money(n){
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

export function renderHome(){
  const view = document.getElementById('homeView');
  if (!view) return;
  const now = Date.now();
  const period = getPeriod();
  const theme = currentTheme();
  const { summary, pipeline, attention: baseAttention, revenueByPlatform } = computeHomeSummary(items, {
    drafts: hooks.getDrafts(), period, now, projectedProfit: hooks.projectedProfit,
    checks: normalizeIssueChecks(appSettings.issueChecks),
    ebaySales: hooks.getEbaySales(), platformLabel: hooks.platformLabel,
  });
  // Tag Week swaps "Listed 30+ days" for the pink tags, so the row and the
  // shelf run on one clock (4+ weeks since cataloging).
  let attention = baseAttention;
  if (theme === 'tagweek'){
    const pink = pinkTagStock(items, now);
    const pinkRow = pink.count ? [{
      key: 'pink', count: pink.count, title: 'Pink tags (4+ weeks)', action: 'Review', tone: 'info',
      detail: `${money(pink.value)} at list price`,
    }] : [];
    const at = baseAttention.findIndex(r => r.key === 'stale' || r.key === 'drafts');
    const others = baseAttention.filter(r => r.key !== 'stale');
    const pos = at < 0 ? others.length : Math.min(at, others.length);
    attention = [...others.slice(0, pos), ...pinkRow, ...others.slice(pos)];
  }
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

  const rowTitle = r => r.title;
  const rows = openRows.map(r => `
    <div class="attn-row">
      <span class="attn-count tone-${r.tone}">${r.count}</span>
      <div class="attn-text">
        <div class="attn-title">${escapeHtml(rowTitle(r))}</div>
        <div class="attn-detail">${escapeHtml(r.detail)}</div>
      </div>
      <button type="button" class="attn-action" data-home-action="${r.key}">${escapeHtml(r.action)}</button>
      <button type="button" class="attn-dismiss" data-home-dismiss="${r.key}" data-count="${r.count}" aria-label="Dismiss: ${escapeHtml(rowTitle(r))}">${CLOSE}</button>
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

  const head = `
    <div class="home-head">
      <h1 class="screen-title">Today</h1>
      <div class="seg" role="group" aria-label="Period">${periodButtons}</div>
    </div>
    ${dailyMessage ? `<p class="daily-line">${escapeHtml(dailyMessage)}</p>` : ''}`;
  // Goals (v3.22.3) sit under the summary in every theme.
  const goalsPanel = goalsPanelHtml(items, { canEdit: hooks.canEditGoals(), now });
  const summaryCells = `
      ${cell('instock', 'In stock', summary.inStock.toLocaleString('en-US'))}
      ${cell('sold', `Sold${suffix}`, summary.sold.toLocaleString('en-US'))}
      ${cell('profit', `Sales profit${suffix}`, money(summary.profit), summary.profit >= 0 ? ' positive' : ' negative')}
      ${cell('projected', 'Projected, in stock', money(summary.projected))}`;
  const attentionPanel = (title, body, openCount) => `
    <section class="panel attention" aria-label="${title}">
      <div class="panel-head">
        <h2 class="panel-title">${title}</h2>
        <span class="panel-meta">${openCount} open${hiddenCount ? ` · <button type="button" class="link-btn" data-home-undismiss>Show dismissed</button>` : ''}</span>
      </div>
      ${body}
    </section>`;
  const revenuePanel = `
    <section class="panel revenue" aria-label="Revenue by platform">
      <div class="panel-head">
        <h2 class="panel-title">Revenue by platform</h2>
        <span class="panel-meta">${money(totalRevenue)}${suffix}</span>
      </div>
      ${revenueBody}
    </section>`;

  if (theme === 'tagweek'){
    // The shelf by weekly tag color replaces the pipeline line.
    const shelf = shelfByTag(items, now);
    const inStock = shelf.reduce((t, w) => t + w.count, 0);
    view.innerHTML = `
      ${head}
      <section class="summary-free" aria-label="Summary">${summaryCells}</section>
      ${goalsPanel}
      <section class="panel shelf" aria-label="Shelf by tag">
        <div class="panel-head">
          <h2 class="panel-title">Shelf by tag</h2>
          <span class="panel-meta">color = week it came in</span>
        </div>
        <div class="shelf-bar">${shelf.map(w => `
          <button type="button" class="shelf-seg tag-${w.index}" data-home-week="${w.index}" style="flex-grow:${inStock ? Math.max(w.count, inStock * 0.06) : 1};" aria-label="${w.name} tags, ${w.age}: ${w.count} items">${w.count}</button>`).join('')}
        </div>
        <div class="shelf-ends"><span>This week</span><span>4+ weeks</span></div>
      </section>
      <div class="home-lower">${attentionPanel('Needs attention', attentionBody, openRows.length)}${revenuePanel}</div>`;
  } else if (theme === 'concourse'){
    // The most urgent task leads as a "Next" band; the rest follow.
    const [next, ...rest] = openRows;
    const thenRows = rest.map(r => `
      <div class="then-row">
        <button type="button" class="then-main" data-home-action="${r.key}">
          <span class="then-icon" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${TASK_ICON[r.key] || ''}</svg></span>
          <span class="then-text">${escapeHtml(phrase(r))}<small class="then-detail">${escapeHtml(r.detail)}</small></span>
          <span class="then-count">${r.count}</span>${ARROW}
        </button>
        <button type="button" class="attn-dismiss" data-home-dismiss="${r.key}" data-count="${r.count}" aria-label="Dismiss: ${escapeHtml(r.title)}">${CLOSE}</button>
      </div>`).join('');
    view.innerHTML = `
      ${next ? `
      <div class="next-band">
        <button type="button" class="next-main" data-home-action="${next.key}">
          <span class="next-count">${next.count}</span>
          <span class="next-text"><small>Next</small><b>${escapeHtml(phrase(next))}</b><span class="next-detail">${escapeHtml(next.detail)}</span></span>
          <span class="next-go">${ARROW}</span>
        </button>
        <button type="button" class="next-dismiss" data-home-dismiss="${next.key}" data-count="${next.count}" aria-label="Dismiss: ${escapeHtml(next.title)}">${CLOSE}</button>
      </div>` : ''}
      ${head}
      <section class="summary-mono" aria-label="Summary">${summaryCells}</section>
      ${goalsPanel}
      <div class="home-lower">
        <section class="then" aria-label="Then">
          <div class="panel-head then-head">
            <h2 class="panel-title">${next ? 'Then' : 'Needs attention'}</h2>
            ${hiddenCount ? `<span class="panel-meta"><button type="button" class="link-btn" data-home-undismiss>Show dismissed</button></span>` : ''}
          </div>
          ${thenRows || `<div class="attn-empty">${next ? 'Nothing else waiting.' : attentionBody.replace(/<[^>]+>/g, '')}</div>`}
        </section>
        ${revenuePanel}
      </div>`;
  } else {
    view.innerHTML = `
      ${head}
      <section class="summary-panel" aria-label="Summary">${summaryCells}</section>
      ${goalsPanel}
      <section class="pipeline" aria-label="Pipeline">
        <span class="pipeline-line" aria-hidden="true"></span>
        ${stop('Cataloged', pipeline.cataloged, true)}
        ${stop('Listed', pipeline.listed, true)}
        ${stop(`Sold${suffix}`, pipeline.sold, false)}
      </section>
      <div class="home-lower">${attentionPanel('Needs attention', attentionBody, openRows.length)}${revenuePanel}</div>`;
  }

  wireGoalsPanel(view, { onSaved: renderHome });
  view.querySelectorAll('[data-home-week]').forEach(btn => btn.addEventListener('click', () => {
    hooks.openCatalog({ weekTag: Number(btn.dataset.homeWeek), notSold: true });
  }));
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
    if (key === 'ebay-error') hooks.openCatalog({ ebayError: true });
    else if (key === 'duplicate-code') hooks.openCatalog({ duplicateCode: true });
    else if (key === 'ebay-sales') hooks.openEbaySales();
    else if (key === 'no-price') hooks.openCatalog({ noPrice: true });
    else if (key === 'missing-info') hooks.openCatalog({ incomplete: true, notSold: true });
    else if (key === 'stale') hooks.openCatalog({ stale: true });
    else if (key === 'drafts') hooks.finishDrafts();
    else if (key === 'pink') hooks.openCatalog({ weekTag: 4, notSold: true });
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
