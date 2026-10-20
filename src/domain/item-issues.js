// Item issues (v3.22.4) — pure checks, no DOM, window, Firebase or app
// state. One definition of "what's wrong with this item" for the catalog's
// Issues filter, the card warning and Home's "Needs attention", so the
// three always agree. Which optional checks run is a business setting
// (`appSettings.issueChecks`, Settings → Warnings), passed in as `checks`.
//
// Always on: no price, eBay publish error, duplicate product code.
// Optional (on by default): each part of "missing info" (photos, cost,
// weight, dimensions) and "listed N+ days" (30, 45, 60 or 90; 0 = off).
// Unsold items get every check; a sold item only the duplicate code,
// since a shared code can still make a label lookup pick the wrong item.

const DAY_MS = 24 * 60 * 60 * 1000;
export const STALE_DAY_OPTIONS = [30, 45, 60, 90];
export const DEFAULT_ISSUE_CHECKS = { photos: true, cost: true, weight: true, dimensions: true, staleDays: 30 };
export const MISSING_PARTS = ['photos', 'cost', 'weight', 'dimensions'];

// Most urgent first; the card shows the first one.
export const ISSUE_KEYS = ['ebay-error', 'duplicate-code', 'no-price', 'missing-info', 'stale'];

export function normalizeIssueChecks(raw){
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  MISSING_PARTS.forEach(k => { out[k] = r[k] !== false; });
  out.staleDays = r.staleDays === 0 || STALE_DAY_OPTIONS.includes(r.staleDays) ? r.staleDays : DEFAULT_ISSUE_CHECKS.staleDays;
  return out;
}

export function hasPrice(item){
  return parseFloat(item.listPrice) > 0;
}

export function isMissingPrice(item){
  return item.status !== 'vendido' && !hasPrice(item);
}

// The parts of "missing info" this item lacks, among the checks that are on.
export function missingFields(item, checks = DEFAULT_ISSUE_CHECKS){
  const missing = [];
  if (checks.photos !== false && !(item.photos && item.photos.length > 0)) missing.push('photos');
  if (checks.cost !== false && !item.cost) missing.push('cost');
  if (checks.weight !== false && !item.weight) missing.push('weight');
  if (checks.dimensions !== false && (!item.length || !item.width)) missing.push('dimensions');
  return missing;
}

export function isIncomplete(item, checks = DEFAULT_ISSUE_CHECKS){
  return missingFields(item, checks).length > 0;
}

// Listed N+ days and still unsold. Only eBay stamps a listing date, so
// other platforms fall back to when the item was cataloged.
export function isStaleListing(item, now, checks = DEFAULT_ISSUE_CHECKS){
  const days = checks.staleDays === undefined ? DEFAULT_ISSUE_CHECKS.staleDays : checks.staleDays;
  if (!days || item.status !== 'anunciado') return false;
  const since = item.ebayListedAt || item.createdAt;
  return !!since && Math.floor((now - since) / DAY_MS) >= days;
}

// The last eBay publish failed (ebay-api.js stamps it, a successful publish
// clears it); a sold item no longer needs it.
export function hasEbayError(item){
  return item.status !== 'vendido' && !!(item.ebayPublishError && item.ebayPublishError.at);
}

// Codes compared without case, spaces or a leading "#".
export function normalizeCode(code){
  return String(code || '').trim().replace(/^#/, '').replace(/\s+/g, '').toLowerCase();
}

// How many items carry each code; pass the whole catalog, not a filtered list.
export function codeCounts(items){
  const counts = new Map();
  items.forEach(i => {
    const c = normalizeCode(i.productCode);
    if (c) counts.set(c, (counts.get(c) || 0) + 1);
  });
  return counts;
}

export function hasDuplicateCode(item, counts){
  const c = normalizeCode(item.productCode);
  return !!c && (counts.get(c) || 0) > 1;
}

// Every issue of one item, in ISSUE_KEYS order.
// ctx: { checks, now, counts } (counts from codeCounts(allItems)).
export function itemIssues(item, { checks = DEFAULT_ISSUE_CHECKS, now = Date.now(), counts = new Map() } = {}){
  const out = [];
  const unsold = item.status !== 'vendido';
  if (hasEbayError(item)) out.push('ebay-error');
  if (hasDuplicateCode(item, counts)) out.push('duplicate-code');
  if (unsold && !hasPrice(item)) out.push('no-price');
  if (unsold && isIncomplete(item, checks)) out.push('missing-info');
  if (isStaleListing(item, now, checks)) out.push('stale');
  return out;
}

export function hasIssues(item, ctx){
  return itemIssues(item, ctx).length > 0;
}
