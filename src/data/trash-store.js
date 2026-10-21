// Trash writes (v3.26.0). Deleting an item copies it to the business's
// `trash` collection and removes it from `items` in the same batch, so an
// item is never in both places and never in neither. Restore does the
// reverse. The rules (domain/trash.js) decide what a record keeps.
import { bizCol, bizDoc } from '../modules/biz.js';
import { trashRecord, restoredItem } from '../domain/trash.js';

// Each item is two writes (the trash copy and the delete); Firestore allows
// 500 writes per batch, so 200 items fit with room to spare.
export const TRASH_BATCH_SIZE = 200;

// The signed-in person, as the trash log keeps them.
export function currentActor(){
  const user = window.auth && window.auth.currentUser;
  return { uid: user?.uid || null, email: user?.email || null };
}

// Moves items to the trash in batches. `entries` is [{ item, removedFromEbay }].
// Returns { moved: [ids], error }. On a failure it stops after the last batch
// that committed, so the caller can tell what moved.
export async function moveItemsToTrash(entries, { onProgress = () => {} } = {}){
  const { writeBatch } = window.firestoreFns;
  const now = Date.now();
  const actor = currentActor();
  const moved = [];
  for (let k = 0; k < entries.length; k += TRASH_BATCH_SIZE){
    const chunk = entries.slice(k, k + TRASH_BATCH_SIZE);
    try{
      const batch = writeBatch(window.db);
      chunk.forEach(({ item, removedFromEbay }) => {
        batch.set(bizDoc('trash', item.id), trashRecord(item, { now, actor, removedFromEbay: !!removedFromEbay }));
        batch.delete(bizDoc('items', item.id));
      });
      await batch.commit();
    }catch(e){
      console.error('Move to trash failed:', e);
      return { moved, error: (e && e.message) || String(e) };
    }
    chunk.forEach(({ item }) => moved.push(item.id));
    onProgress(moved.length, entries.length);
  }
  return { moved, error: null };
}

// Puts one trashed item back into `items` and takes it out of the trash.
export async function restoreFromTrash(record){
  const { writeBatch } = window.firestoreFns;
  const item = restoredItem(record);
  const batch = writeBatch(window.db);
  batch.set(bizDoc('items', record.id), item);
  batch.delete(bizDoc('trash', record.id));
  await batch.commit();
  return item;
}

// Every record in the trash, expired or not. Throws when it can't be read.
export async function loadTrash(){
  const { getDocs } = window.firestoreFns;
  const snap = await getDocs(bizCol('trash'));
  const records = [];
  snap.forEach(d => records.push({ ...d.data(), id: d.id }));
  return records;
}

// Removes trash records for good, in batches of 400 deletes.
export async function deleteTrashForever(ids){
  const { writeBatch } = window.firestoreFns;
  const done = [];
  for (let k = 0; k < ids.length; k += 400){
    const chunk = ids.slice(k, k + 400);
    try{
      const batch = writeBatch(window.db);
      chunk.forEach(id => batch.delete(bizDoc('trash', id)));
      await batch.commit();
    }catch(e){
      console.error('Delete from trash failed:', e);
      return { deleted: done, error: (e && e.message) || String(e) };
    }
    done.push(...chunk);
  }
  return { deleted: done, error: null };
}
