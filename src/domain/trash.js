// The trash for deleted items (v3.26.0): what a deleted item keeps, who
// deleted it, when it expires, and what a restore puts back. Pure logic: no
// Firestore, no DOM, no app state. The writes are in data/trash-store.js.

export const TRASH_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// Fields the trash adds to an item; a restore takes them off again.
const TRASH_FIELDS = ['deletedAt', 'deletedBy', 'expiresAt', 'removedFromEbayAt'];
// Fields that describe a live eBay listing; cleared when the delete ended it.
const EBAY_LISTING_FIELDS = ['ebayListingId', 'ebayListingUrl', 'ebayOfferId', 'ebaySku', 'ebayListedAt', 'ebayEndedAt'];

// A Firestore Timestamp, a Date or a number → milliseconds (undefined if none).
export function toMillis(value){
  if (value == null) return undefined;
  if (typeof value === 'number') return value;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return undefined;
}

// What the eBay step of a delete needs:
//  'none'   no active eBay listing, nothing to ask
//  'ask'    an active listing the app can end: ask, "remove and delete" first
//  'manual' a listing with no offer ID saved: the app can't end it, so the
//           person ends it on eBay or deletes the item in the app only
export function ebayDeleteStep(item){
  if (!item || !item.ebayListingId || item.ebayEndedAt) return 'none';
  return item.ebayOfferId ? 'ask' : 'manual';
}

// The record kept in the trash for a deleted item. `removedFromEbay` is true
// only when the app ended the eBay listing during this delete.
export function trashRecord(item, { now, actor, removedFromEbay }){
  const record = {
    ...item,
    deletedAt: new Date(now),
    deletedBy: { uid: actor.uid || null, email: actor.email || null },
    expiresAt: new Date(now + TRASH_DAYS * DAY_MS),
  };
  if (removedFromEbay) record.removedFromEbayAt = new Date(now);
  return record;
}

// The item as it was before the delete. When the delete ended its eBay
// listing, the listing fields go and 'ebay' leaves listedPlatforms; the
// status stays as it was.
export function restoredItem(record){
  const item = { ...record };
  TRASH_FIELDS.forEach(key => delete item[key]);
  if (record.removedFromEbayAt){
    EBAY_LISTING_FIELDS.forEach(key => delete item[key]);
    if (Array.isArray(item.listedPlatforms)) item.listedPlatforms = item.listedPlatforms.filter(p => p !== 'ebay');
  }
  return item;
}

// A record past its expiry (or with none) can't be restored any more.
export function isTrashExpired(record, now){
  const expires = toMillis(record.expiresAt);
  return expires === undefined || expires <= now;
}

// Whole days left before the record expires, rounded up (0 when expired).
export function trashDaysLeft(record, now){
  const expires = toMillis(record.expiresAt);
  if (expires === undefined) return 0;
  return Math.max(0, Math.ceil((expires - now) / DAY_MS));
}

// Records still restorable, newest deletion first.
export function restorableTrash(records, now){
  return records
    .filter(record => !isTrashExpired(record, now))
    .sort((a, b) => (toMillis(b.deletedAt) || 0) - (toMillis(a.deletedAt) || 0));
}

// Records past their expiry, to be removed for good.
export function expiredTrash(records, now){
  return records.filter(record => isTrashExpired(record, now));
}
