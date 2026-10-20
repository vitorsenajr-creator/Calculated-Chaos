// Settings → eBay → Sale tracker (v3.22.5): the eBay sales the app
// detected in the last 60 days and what it did with each (marked sold,
// already sold, no matching item, couldn't save), with "Done" on the ones
// that need the person (delist elsewhere, or handle by hand). The log
// comes from data/ebay-sales-store.js; the check itself is
// checkEbaySalesNow() in ebay-api.js, which redraws this after logging.
// Tokens only.
import { appSettings } from '../../modules/state.js';
import { escapeHtml } from '../../modules/format-utils.js';
import { getPlatformLabel } from '../../modules/platforms.js';
import { cachedEbaySales, loadEbaySales, markEbaySaleDone } from '../../data/ebay-sales-store.js';
import { recentSales, needsAttention, SALE_OUTCOME_LABEL, SALES_LOG_DAYS } from '../../domain/ebay-sales.js';

export function ebaySalesSectionHtml(){
  return `
      <div class="settings-section" id="ebaySalesSection">
        <h3>Sale tracker</h3>
        <div class="ss-desc">Every time it opens, the app checks your recent eBay orders and marks the matching items as Sold. Each sale it finds is listed here for ${SALES_LOG_DAYS} days with what the app did. eBay ends its own listing; if the item was also listed on another platform, delist it there and tap Done.</div>
        <button class="settings-save-btn" onclick="checkEbaySalesNow(true)">Check for eBay sales now</button>
        <div id="ebaySalesCheckResult" class="settings-result"></div>
        <div id="ebaySalesTracker" class="sale-tracker"></div>
      </div>`;
}

// The platform's name without its emoji ("👗 Poshmark" → "Poshmark"),
// like Home's rows.
function platformName(key){
  return String(getPlatformLabel(appSettings, key)).replace(/^[^\p{L}\p{N}]+/u, '');
}

function money(n){
  return `$${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function rowHtml(e){
  const open = needsAttention(e);
  const when = new Date(e.saleAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const item = e.itemId
    ? `<button type="button" class="link-btn" data-sale-open-item="${escapeHtml(e.itemId)}">${e.productCode ? escapeHtml(e.productCode) + ' · ' : ''}${escapeHtml(e.itemName || 'Open item')}</button>`
    : '';
  let todo = '';
  if (e.outcome === 'no-match'){
    todo = `No item in the catalog has this eBay listing${e.legacyItemId ? ` (#${escapeHtml(e.legacyItemId)})` : ''}. Mark it sold by hand if it's yours.`;
  } else if (e.outcome === 'save-failed'){
    todo = 'The sale could not be saved on the item. Mark it sold by hand.';
  } else if ((e.delistOn || []).length){
    todo = `Delist on ${e.delistOn.map(p => escapeHtml(platformName(p))).join(', ')}.`;
  }
  const tone = e.outcome === 'no-match' || e.outcome === 'save-failed' ? 'warn' : e.outcome === 'marked-sold' ? 'ok' : 'neutral';
  return `
        <li class="sale-row${open ? ' open' : ''}${e.doneAt ? ' done' : ''}">
          <div class="sale-top">
            <span class="sale-title">${escapeHtml(e.title || e.itemName || 'eBay sale')}</span>
            <span class="sale-amt">${e.total !== null && e.total !== undefined ? money(e.total) : ''}</span>
          </div>
          <div class="sale-meta">
            <span>${when}</span>
            <span class="sale-outcome tone-${tone}">${SALE_OUTCOME_LABEL[e.outcome] || e.outcome}</span>
            ${item}
          </div>
          ${todo ? `
          <div class="sale-todo">
            <span>${e.doneAt ? `<s>${todo}</s>` : todo}</span>
            <button type="button" class="secondary-btn" data-sale-done="${escapeHtml(e.key)}" data-done="${e.doneAt ? '0' : '1'}">${e.doneAt ? 'Undo' : 'Done'}</button>
          </div>` : ''}
        </li>`;
}

// Fills #ebaySalesTracker from the cached log (loads it the first time).
export async function renderEbaySalesPanel({ reload = false } = {}){
  const el = document.getElementById('ebaySalesTracker');
  if (!el) return;
  if (reload) await loadEbaySales();
  const list = recentSales(cachedEbaySales(), Date.now());
  const openCount = list.filter(needsAttention).length;
  el.innerHTML = list.length ? `
        <div class="sale-head">${list.length} sale${list.length === 1 ? '' : 's'} in the last ${SALES_LOG_DAYS} days${openCount ? ` · <b>${openCount} to review</b>` : ''}</div>
        <ul class="sale-list">${list.map(rowHtml).join('')}</ul>`
    : `<div class="sale-head">No eBay sales detected in the last ${SALES_LOG_DAYS} days.</div>`;
  el.querySelectorAll('[data-sale-done]').forEach(btn => btn.addEventListener('click', async () => {
    btn.disabled = true;
    const ok = await markEbaySaleDone(btn.dataset.saleDone, btn.dataset.done === '1');
    if (!ok){
      btn.disabled = false;
      btn.textContent = "Couldn't save";
      return;
    }
    renderEbaySalesPanel();
    document.dispatchEvent(new CustomEvent('ebaysaleschange'));
  }));
  el.querySelectorAll('[data-sale-open-item]').forEach(btn => btn.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('openitem', { detail: btn.dataset.saleOpenItem }));
  }));
}
