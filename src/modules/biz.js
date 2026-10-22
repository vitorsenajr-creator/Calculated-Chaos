// Business-scoped Firestore paths (docs/multi-tenant.md step 4).
//
// Every read/write of business data (catalog, drafts, counters, settings,
// eBay error library) goes through bizCol()/bizDoc()
// with a logical name. Global data (users, ebay_category_cache) doesn't.
//
// Two modes (v3.17.0):
//  - business: once the signed-in user's business is live
//    (businesses/{activeBizId}.live === true), paths are
//    businesses/{bizId}/{name}/…
//  - root (before the switch, or if the business can't be read): today's
//    root collections, as in v3.16.4.
// loadActiveBusiness() picks the mode at sign-in, before any data loads.
// firestore.rules blocks root writes once the business is live, so a page
// still in root mode after the switch gets an error instead of writing to
// the old place.

// Logical collection → root collection (root mode).
const LEGACY_COLLECTIONS = {
  items: 'items',
  drafts: 'drafts',
  ebay_error_log: 'ebay_error_log',
};

// Single docs whose root location has a different name (root mode). In the
// business they live at counters/* and config/settings.
const LEGACY_DOCS = {
  'counters/productCode': ['app_settings', 'productCodeCounter'],
  'config/settings': ['app_config', 'settings'],
};

// ebay_sales (v3.22.5, the eBay sale tracker) and expenses (v3.23.3) exist
// only in the business; in root mode bizCol/bizDoc throw for them and their
// callers report it (the sale log is skipped, Expenses says it couldn't load).
// The trash (v3.26.0) and the Pick activity log (v3.27.7) are business-only too.
const BUSINESS_COLLECTIONS = new Set([...Object.keys(LEGACY_COLLECTIONS), 'counters', 'config', 'ebay_sales', 'expenses', 'trash', 'pick_log']);

let activeBizId = null;

function fns(){ return window.firestoreFns; }

// Call with the signed-in user's doc data. Never throws: anything that
// goes wrong keeps root mode (which the rules then lock if it's stale).
export async function loadActiveBusiness(userData){
  activeBizId = null;
  const bizId = userData && userData.activeBizId;
  if (!bizId) return null;
  try{
    const snap = await fns().getDoc(fns().doc(window.db, 'businesses', bizId));
    if (snap.exists() && snap.data().live === true) activeBizId = bizId;
  }catch(e){
    console.warn('Could not read the business; using the pre-business data.', e);
  }
  return activeBizId;
}

// The live business id, or null in root mode.
export function currentBizId(){ return activeBizId; }

function checkName(name){
  if (!BUSINESS_COLLECTIONS.has(name)) throw new Error(`bizCol: unknown business collection "${name}"`);
}

// A business collection, e.g. bizCol('items').
export function bizCol(name){
  checkName(name);
  if (activeBizId) return fns().collection(window.db, 'businesses', activeBizId, name);
  if (!LEGACY_COLLECTIONS[name]) throw new Error(`bizCol: "${name}" has no root collection`);
  return fns().collection(window.db, LEGACY_COLLECTIONS[name]);
}

// A business doc, e.g. bizDoc('items', id) or bizDoc('config', 'settings').
export function bizDoc(name, id){
  checkName(name);
  if (activeBizId) return fns().doc(window.db, 'businesses', activeBizId, name, id);
  const fixed = LEGACY_DOCS[`${name}/${id}`];
  if (fixed) return fns().doc(window.db, fixed[0], fixed[1]);
  if (!LEGACY_COLLECTIONS[name]) throw new Error(`bizDoc: "${name}/${id}" has no root location`);
  return fns().doc(window.db, LEGACY_COLLECTIONS[name], id);
}
