// eBay sale tracker (v3.22.5) — pure logic, no DOM, window, Firebase or
// app state. The app still marks a detected eBay sale as Sold on its own
// (ebay-api.js checkEbaySalesNow); this decides what each detected sale
// was, what goes in the log, and which ones need the person: a sale with
// no matching item, a sale whose save failed, and a sold item still
// listed on another platform (eBay ends its own listing; Poshmark, Mercari
// and the rest have no API, so a double sale is possible until it's
// delisted by hand).

const DAY_MS = 24 * 60 * 60 * 1000;
export const SALES_LOG_DAYS = 60;

export const SALE_OUTCOME_LABEL = {
  'marked-sold': 'Marked sold',
  'already-sold': 'Already marked sold',
  'no-match': 'No matching item',
  'save-failed': "Couldn't save the sale",
};

// One log entry per order line, so checking again never logs it twice.
// Firestore ids can't contain "/".
export function saleKey(sale){
  const line = sale.legacyItemId || sale.sku || 'line';
  return `${sale.orderId || 'order'}_${line}`.replace(/[\/\s]/g, '-').slice(0, 200);
}

// The item this sale belongs to, by eBay SKU or listing ID. An unsold
// match wins over a sold one (a relisted item can share the listing ID).
export function matchSaleItem(sale, items){
  const hits = items.filter(i =>
    (sale.sku && i.ebaySku === sale.sku) ||
    (sale.legacyItemId && i.ebayListingId === String(sale.legacyItemId)));
  return hits.find(i => i.status !== 'vendido') || hits[0] || null;
}

// The other platforms the item was listed on when it sold on eBay.
export function otherPlatforms(item){
  return (item && item.listedPlatforms || []).filter(p => p !== 'ebay');
}

// What the check should do with this sale before saving anything:
// 'mark' (an unsold match), 'already-sold' or 'no-match'. An item the app
// itself marked sold from eBay before the log existed counts as
// 'marked-sold', so its delisting reminder still shows.
export function planSale(sale, item){
  if (!item) return { action: 'no-match', outcome: 'no-match', delistOn: [] };
  if (item.status !== 'vendido') return { action: 'mark', outcome: 'marked-sold', delistOn: otherPlatforms(item) };
  if (item.ebayAutoDetectedSale) return { action: 'none', outcome: 'marked-sold', delistOn: otherPlatforms(item) };
  return { action: 'none', outcome: 'already-sold', delistOn: [] };
}

// The log document for a sale.
export function saleEntry(sale, item, outcome, delistOn, now){
  const saleAt = sale.creationDate ? new Date(sale.creationDate).getTime() : now;
  return {
    key: saleKey(sale),
    orderId: sale.orderId || null,
    sku: sale.sku || null,
    legacyItemId: sale.legacyItemId ? String(sale.legacyItemId) : null,
    title: sale.title || (item && item.name) || null,
    total: typeof sale.total === 'number' ? sale.total : null,
    saleAt: Number.isFinite(saleAt) ? saleAt : now,
    detectedAt: now,
    outcome,
    itemId: item ? item.id : null,
    itemName: item ? (item.name || null) : null,
    productCode: item ? (item.productCode || null) : null,
    delistOn: delistOn || [],
    doneAt: null,
  };
}

export function needsAttention(entry){
  if (!entry || entry.doneAt) return false;
  return entry.outcome === 'no-match' || entry.outcome === 'save-failed' || (entry.delistOn || []).length > 0;
}

// The last SALES_LOG_DAYS days, newest first.
export function recentSales(entries, now, days = SALES_LOG_DAYS){
  const since = now - days * DAY_MS;
  return entries.filter(e => (e.saleAt || 0) >= since).sort((a, b) => (b.saleAt || 0) - (a.saleAt || 0));
}

// Home's "eBay sales to confirm" row, or null when nothing needs the person.
export function salesToConfirm(entries, now, platformLabel = (k) => k){
  const open = recentSales(entries, now).filter(needsAttention);
  if (!open.length) return null;
  const delist = open.filter(e => (e.delistOn || []).length && e.outcome !== 'no-match' && e.outcome !== 'save-failed');
  const noMatch = open.filter(e => e.outcome === 'no-match').length;
  const failed = open.filter(e => e.outcome === 'save-failed').length;
  const parts = [];
  if (delist.length){
    const where = [...new Set(delist.flatMap(e => e.delistOn))].map(platformLabel);
    parts.push(`${delist.length} to delist on ${where.join(', ')}`);
  }
  if (noMatch) parts.push(`${noMatch} with no matching item`);
  if (failed) parts.push(`${failed} not saved`);
  return { count: open.length, detail: parts.join(' · ') };
}
