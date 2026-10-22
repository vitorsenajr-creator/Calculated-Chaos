// Applying what another device changed in a collection (v3.27.5). Pure logic,
// no DOM, window or Firebase: `changes` come from a Firestore snapshot as
// { type: 'added' | 'modified' | 'removed', id, data }, `data` being the
// document (null for a removal).
//
// Returns a new list (the one passed in is left as it was), how many of each
// kind really changed it, and the ids that were removed (a selection can drop
// them). A modified item keeps its position and a new one goes at the end; the
// Catalog sorts anyway. `normalize` gets each document before it is stored (the
// old field names are mapped to the new ones there).
export function applyChanges(list, changes, normalize = (doc) => doc){
  const byId = new Map((list || []).map(item => [item.id, item]));
  let added = 0, modified = 0, removed = 0;
  const removedIds = [];
  for (const c of changes || []){
    if (c.type === 'removed'){
      if (byId.delete(c.id)){ removed += 1; removedIds.push(c.id); }
      continue;
    }
    if (!c.data) continue;
    const doc = normalize({ ...c.data, id: c.data.id ?? c.id });
    if (byId.has(doc.id)) modified += 1; else added += 1;
    byId.set(doc.id, doc);
  }
  return { list: [...byId.values()], added, modified, removed, removedIds };
}
