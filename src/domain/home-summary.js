// Home screen numbers — pure calculations over `items` (no DOM, window,
// Firebase or app state). The caller passes the photo-session drafts, the
// chosen period, the clock and the projected-profit function (it depends
// on settings), so this stays testable in plain Node.
import { isIncomplete } from '../modules/catalog-filters.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const STALE_LISTING_DAYS = 30;
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

function hasPrice(item){
  return parseFloat(item.listPrice) > 0;
}

// Listed 30+ days and still unsold. Only eBay stamps a listing date, so
// other platforms fall back to when the item was cataloged.
export function isStaleListing(item, now){
  if (item.status !== 'anunciado') return false;
  const since = item.ebayListedAt || item.createdAt;
  return !!since && daysBetween(since, now) >= STALE_LISTING_DAYS;
}

export function isMissingPrice(item){
  return item.status !== 'vendido' && !hasPrice(item);
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

export function computeHomeSummary(items, { drafts = [], period = 'month', now = Date.now(), projectedProfit = () => 0 } = {}){
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
  const missing = active.filter(isIncomplete);
  const stale = active.filter(i => isStaleListing(i, now));

  // One row per problem, most urgent first; rows with nothing to do are
  // left out. `count` lets a dismissed row come back when it changes.
  const attention = [];
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
      detail: 'Photos, cost, weight or dimensions',
    });
  }
  if (stale.length){
    const atListPrice = stale.reduce((s, i) => s + (parseFloat(i.listPrice) || 0), 0);
    attention.push({
      key: 'stale', count: stale.length, title: `Listed ${STALE_LISTING_DAYS}+ days`, action: 'Drop price', tone: 'info',
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
