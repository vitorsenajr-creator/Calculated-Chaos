// Home screen numbers — pure calculations over `items` (no DOM, window,
// Firebase or app state). The caller passes the photo-session drafts, the
// chosen period, the clock and the projected-profit function (it depends
// on settings), so this stays testable in plain Node.
import {
  isIncomplete, isStaleListing, isMissingPrice, hasPrice, hasEbayError, hasDuplicateCode, hasMultipleCodes, codeCounts, normalizeCode,
  DEFAULT_ISSUE_CHECKS,
} from './item-issues.js';
import { salesToConfirm } from './ebay-sales.js';

// Kept for older imports; the checks live in item-issues.js since v3.22.4.
export { isStaleListing, isMissingPrice };

const DAY_MS = 24 * 60 * 60 * 1000;
export const HOME_PERIODS = ['month', 'year', 'all'];

// Start of the period that contains `now`, in local time; 0 for 'all'.
export function periodStart(period, now){
  const d = new Date(now);
  if (period === 'month') return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  if (period === 'year') return new Date(d.getFullYear(), 0, 1).getTime();
  return 0;
}

function daysBetween(ts, now){
  return Math.floor((now - ts) / DAY_MS);
}

// Sold date, falling back to createdAt like the Finances screen does for
// old sales saved without soldAt.
function soldTime(item){
  return item.soldAt || item.createdAt || 0;
}


// Items sold before soldPlatform was reliably recorded (eBay auto-detected
// sales didn't stamp it at first) would all land in "other"; this is the
// best-effort backfill the old Dashboard used: an eBay-detected or
// eBay-listed sale is eBay, and an item listed on exactly one platform
// almost certainly sold there.
export function inferSoldPlatform(item){
  if (item.soldPlatform) return item.soldPlatform;
  if (item.ebayAutoDetectedSale || item.ebayListingId) return 'ebay';
  if (item.listedPlatforms && item.listedPlatforms.length === 1) return item.listedPlatforms[0];
  return 'outra';
}

// "Photos, cost, weight or dimensions", only the parts that are checked.
const PART_WORD = { photos: 'photos', cost: 'cost', weight: 'weight', dimensions: 'dimensions' };
function missingDetail(checks){
  const parts = Object.keys(PART_WORD).filter(k => checks[k] !== false).map(k => PART_WORD[k]);
  const text = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} or ${parts[parts.length - 1]}` : parts.join('');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function computeHomeSummary(items, { drafts = [], period = 'month', now = Date.now(), projectedProfit = () => 0, checks = DEFAULT_ISSUE_CHECKS, ebaySales = [], platformLabel = (k) => k } = {}){
  const start = periodStart(period, now);
  const active = items.filter(i => i.status !== 'vendido');
  const soldInPeriod = items.filter(i => i.status === 'vendido' && soldTime(i) >= start);

  const summary = {
    inStock: active.length,
    sold: soldInPeriod.length,
    revenue: soldInPeriod.reduce((s, i) => s + (parseFloat(i.soldPrice) || 0), 0),
    profit: soldInPeriod.reduce((s, i) => s + (i.netProfit || 0), 0),
    projected: active.reduce((s, i) => s + (projectedProfit(i) || 0), 0),
  };

  const pipeline = {
    cataloged: items.filter(i => i.status === 'catalogado').length,
    listed: items.filter(i => i.status === 'anunciado').length,
    sold: soldInPeriod.length,
  };

  const byPlatform = {};
  soldInPeriod.forEach(i => {
    const p = inferSoldPlatform(i);
    if (!byPlatform[p]) byPlatform[p] = { platform: p, revenue: 0, count: 0 };
    byPlatform[p].revenue += parseFloat(i.soldPrice) || 0;
    byPlatform[p].count += 1;
  });
  const revenueByPlatform = Object.values(byPlatform).sort((a, b) => b.revenue - a.revenue);

  const noPrice = active.filter(i => !hasPrice(i)).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const missing = active.filter(i => isIncomplete(i, checks));
  const stale = active.filter(i => isStaleListing(i, now, checks));
  const ebayErrors = active.filter(hasEbayError);
  const counts = codeCounts(items);
  const dupItems = items.filter(i => hasDuplicateCode(i, counts));
  const multiItems = items.filter(hasMultipleCodes);

  // One row per problem, most urgent first; rows with nothing to do are
  // left out. `count` lets a dismissed row come back when it changes.
  const attention = [];
  if (ebayErrors.length){
    const latest = ebayErrors.reduce((a, b) => ((b.ebayPublishError.at || 0) > (a.ebayPublishError.at || 0) ? b : a));
    attention.push({
      key: 'ebay-error', count: ebayErrors.length, title: 'eBay publish errors', action: 'Review', tone: 'urgent',
      detail: `Latest: ${latest.name || latest.productCode || 'an item'}`,
    });
  }
  // The eBay sale tracker (v3.22.5): sales to delist elsewhere or to
  // handle by hand.
  const toConfirm = salesToConfirm(ebaySales, now, platformLabel);
  if (toConfirm){
    attention.push({
      key: 'ebay-sales', count: toConfirm.count, title: 'eBay sales to confirm', action: 'Review', tone: 'warn',
      detail: toConfirm.detail,
    });
  }
  if (dupItems.length){
    const codes = new Set(dupItems.map(i => normalizeCode(i.productCode))).size;
    attention.push({
      key: 'duplicate-code', count: dupItems.length, title: 'Duplicate codes', action: 'Fix', tone: 'warn',
      detail: `${codes} code${codes === 1 ? '' : 's'} used on more than one item`,
    });
  }
  if (multiItems.length){
    attention.push({
      key: 'multi-code', count: multiItems.length, title: 'Two codes in one field', action: 'Fix', tone: 'warn',
      detail: `A product has one code. Example: ${multiItems[0].productCode}`,
    });
  }
  if (noPrice.length){
    const oldest = noPrice[0];
    attention.push({
      key: 'no-price', count: noPrice.length, title: 'No price set', action: 'Set prices', tone: 'warn',
      detail: `Oldest: ${oldest.name || oldest.productCode || 'an item'}${oldest.createdAt ? `, ${daysBetween(oldest.createdAt, now)} days` : ''}`,
    });
  }
  if (missing.length){
    attention.push({
      key: 'missing-info', count: missing.length, title: 'Missing info', action: 'Fix', tone: 'warn',
      detail: missingDetail(checks),
    });
  }
  if (stale.length){
    const atListPrice = stale.reduce((s, i) => s + (parseFloat(i.listPrice) || 0), 0);
    attention.push({
      key: 'stale', count: stale.length, title: `Listed ${checks.staleDays}+ days`, action: 'Drop price', tone: 'info',
      detail: `$${atListPrice.toFixed(0)} at list price`,
    });
  }
  if (drafts.length){
    attention.push({
      key: 'drafts', count: drafts.length, title: 'Photo-session drafts', action: 'Finish', tone: 'info',
      detail: `${drafts.length} group${drafts.length === 1 ? '' : 's'} of photos to catalog`,
    });
  }

  return { period, summary, pipeline, attention, revenueByPlatform };
}
