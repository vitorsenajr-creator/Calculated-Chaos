// Business-scoped Firestore paths (docs/multi-tenant.md step 4, v3.16.4).
//
// Every read/write of business data (catalog, drafts, Live Catalog,
// counters, settings, eBay error library) goes through bizCol()/bizDoc()
// with a logical name, so moving the data under businesses/{bizId}/… is
// a change here instead of at ~30 call sites. Global data (users,
// ebay_category_cache) doesn't use these.
//
// For now every logical path resolves to today's root collection, so
// nothing moves yet. The switch comes with the migration (step 3c).

// Logical collection → today's root collection.
const LEGACY_COLLECTIONS = {
  items: 'items',
  drafts: 'drafts',
  liveSessions: 'liveSessions',
  liveItems: 'liveItems',
  options: 'live_catalog_options',
  ebay_error_log: 'ebay_error_log',
};

// Single docs whose logical home differs from today's location. In the
// business model they become counters/* and config/settings.
const LEGACY_DOCS = {
  'counters/productCode': ['app_settings', 'productCodeCounter'],
  'counters/liveSku': ['live_catalog_options', 'skuCounter'],
  'config/settings': ['app_config', 'settings'],
};

function fns(){ return window.firestoreFns; }

function legacyCollection(name){
  const path = LEGACY_COLLECTIONS[name];
  if (!path) throw new Error(`bizCol: unknown business collection "${name}"`);
  return path;
}

// A business collection, e.g. bizCol('items').
export function bizCol(name){
  return fns().collection(window.db, legacyCollection(name));
}

// A business doc, e.g. bizDoc('items', id) or bizDoc('config', 'settings').
export function bizDoc(name, id){
  const fixed = LEGACY_DOCS[`${name}/${id}`];
  if (fixed) return fns().doc(window.db, fixed[0], fixed[1]);
  return fns().doc(window.db, legacyCollection(name), id);
}
