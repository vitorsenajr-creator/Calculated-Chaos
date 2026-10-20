// The eBay sale tracker's log (data layer; v3.22.5): one doc per detected
// eBay order line in the business's `ebay_sales` collection, keyed by
// saleKey() so a sale is logged once however many times the check runs.
// Everything here is best-effort: the sale itself is marked Sold on the
// item whether or not the log can be written (for instance before the
// Firestore rule for `ebay_sales` is pasted in the Console).
import { bizCol, bizDoc } from '../modules/biz.js';

let cache = [];

export function cachedEbaySales(){ return cache; }

export async function loadEbaySales(){
  try{
    const { getDocs } = window.firestoreFns;
    const snap = await getDocs(bizCol('ebay_sales'));
    cache = snap.docs.map(d => d.data());
  }catch(e){
    console.warn('Could not load the eBay sale log (non-blocking):', e);
  }
  return cache;
}

// Writes the entry only if that sale isn't logged yet (one transaction,
// so two devices checking at once can't log it twice). Returns the saved
// entry, the one already there, or null when the log can't be written.
export async function logEbaySale(entry){
  try{
    const { runTransaction } = window.firestoreFns;
    const ref = bizDoc('ebay_sales', entry.key);
    const saved = await runTransaction(window.db, async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists()) return snap.data();
      tx.set(ref, entry);
      return entry;
    });
    const at = cache.findIndex(e => e.key === saved.key);
    if (at >= 0) cache[at] = saved; else cache.push(saved);
    return saved;
  }catch(e){
    console.warn('Could not log the eBay sale (non-blocking):', e);
    return null;
  }
}

// "Done" on a sale that needed the person (delisted elsewhere, or handled
// by hand). Only `doneAt` is written.
export async function markEbaySaleDone(key, done = true){
  const doneAt = done ? Date.now() : null;
  try{
    const { setDoc } = window.firestoreFns;
    await setDoc(bizDoc('ebay_sales', key), { doneAt }, { merge: true });
    const e = cache.find(x => x.key === key);
    if (e) e.doneAt = doneAt;
    return true;
  }catch(e){
    console.warn('Could not update the eBay sale log:', e);
    return false;
  }
}
