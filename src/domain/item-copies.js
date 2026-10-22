// Extra copies of an item (v3.24.12). Pure logic: no DOM, no Firestore.
// Copies are named off the item's base code: "#1487" plus two copies gives
// "#1487-2" and "#1487-3", and the original keeps its code (its label is
// already printed). The numbers never repeat, even after copies are sold.

export const MAX_COPIES = 50;

// Sale and listing fields a copy must not inherit: it is a new, unsold piece.
const SALE_KEYS = ['soldPrice', 'soldPlatform', 'soldAt', 'netProfit', 'feesTotal',
  'saleOrderNumber', 'saleBuyer', 'saleLineKey', 'manualSale', 'saleTax'];
const LISTING_KEYS = ['ebayListingId', 'ebayListingUrl', 'ebayOfferId', 'ebaySku',
  'ebayListedAt', 'ebayPublishError'];

// The next `count` codes for copies of `baseCode`, after every code already
// in `existingCodes` that belongs to the same base ("#1487", "#1487-1", …).
export function copyCodes(baseCode, existingCodes, count){
  const base = String(baseCode).replace(/-\d+$/, '');
  let highest = 1;
  for (const code of existingCodes){
    const text = String(code || '');
    if (text === base) continue;
    const match = text.match(/^(.*)-(\d+)$/);
    if (match && match[1] === base) highest = Math.max(highest, Number(match[2]));
  }
  return Array.from({ length: count }, (_, i) => `${base}-${highest + 1 + i}`);
}

// A new, unsold, unlisted piece with the same details as `item`.
export function unsoldCopy(item, { id, productCode, now }){
  const copy = { ...item };
  SALE_KEYS.forEach(key => { delete copy[key]; });
  LISTING_KEYS.forEach(key => { copy[key] = null; });
  return {
    ...copy,
    id,
    productCode,
    status: 'catalogado',
    listedPlatforms: [],
    createdAt: now,
  };
}

// Reads a quantity field: a whole number between `min` and MAX_COPIES, and
// `min` when the field is empty or not a number.
export function readQuantity(value, min){
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(MAX_COPIES, n));
}
