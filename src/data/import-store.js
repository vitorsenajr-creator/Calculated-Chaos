// Spreadsheet import writes (data layer; v3.23.1). Items go to the
// business's `items` collection in batches (Firestore allows 500 writes per
// batch; 400 leaves room), each one tagged with its importId so a dropped
// connection can be continued without duplicates and a whole import can be
// undone. No new collection: an import is the set of items carrying its id.
import { bizCol, bizDoc } from '../modules/biz.js';

export const IMPORT_BATCH_SIZE = 400;

// Saves `docs` (complete items with their ids) in batches, skipping any id
// in `alreadySaved`. Calls onProgress(savedSoFar, total) after each batch.
// Returns { saved: [ids], error } — on a failure it stops there, so the
// caller can offer to continue with the rest.
export async function saveImportBatches(docs, { alreadySaved = new Set(), onProgress = () => {} } = {}){
  const { writeBatch } = window.firestoreFns;
  const todo = docs.filter(d => !alreadySaved.has(d.id));
  const saved = [];
  for (let k = 0; k < todo.length; k += IMPORT_BATCH_SIZE){
    const chunk = todo.slice(k, k + IMPORT_BATCH_SIZE);
    try{
      const batch = writeBatch(window.db);
      chunk.forEach(d => batch.set(bizDoc('items', d.id), d));
      await batch.commit();
    }catch(e){
      console.error('Import batch failed:', e);
      return { saved, error: (e && e.message) || String(e) };
    }
    chunk.forEach(d => saved.push(d.id));
    onProgress(alreadySaved.size + saved.length, docs.length);
  }
  return { saved, error: null };
}

// The ids of every item saved by this import, read from Firestore (not just
// this device's copy, so an import made on another device is found too).
export async function importedItemIds(importId){
  const { query, where, getDocs } = window.firestoreFns;
  const snap = await getDocs(query(bizCol('items'), where('importId', '==', importId)));
  const ids = [];
  snap.forEach(d => { const data = d.data(); if (data && data.importId === importId) ids.push(d.id); });
  return ids;
}

// Deletes every item of the import, in batches. Returns { deleted, error }.
export async function undoImport(importId, { onProgress = () => {} } = {}){
  const { writeBatch } = window.firestoreFns;
  let ids;
  try{ ids = await importedItemIds(importId); }
  catch(e){ return { deleted: [], error: (e && e.message) || String(e) }; }
  const deleted = [];
  for (let k = 0; k < ids.length; k += IMPORT_BATCH_SIZE){
    const chunk = ids.slice(k, k + IMPORT_BATCH_SIZE);
    try{
      const batch = writeBatch(window.db);
      chunk.forEach(id => batch.delete(bizDoc('items', id)));
      await batch.commit();
    }catch(e){
      return { deleted, error: (e && e.message) || String(e) };
    }
    chunk.forEach(id => deleted.push(id));
    onProgress(deleted.length, ids.length);
  }
  return { deleted, error: null };
}
