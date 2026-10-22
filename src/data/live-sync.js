// A live copy of a business collection (data layer; v3.27.5). It watches the
// collection instead of reading it once: the first answer is the whole
// collection (the same reads as the single read it replaces) and every later
// one carries only the documents another device changed, so a catalog opened
// on two devices stays current for about one read per changed item.
//
// onFirst(docs): the first snapshot, as a list of documents.
// onChanges(changes): { type, id, data } for what changed afterwards.
// onError(error, beforeFirst): the watch has stopped (Firestore ends it). The
//   Firebase SDK reconnects by itself after a dropped connection; this is
//   only for an error it gives up on, such as a rule refusing the read.
// Returns the function that stops the watch.
//
// A change this device made itself (the document still has a pending write)
// is left out: the app already has it in memory.
import { bizCol } from '../modules/biz.js';

export function watchCollection(name, { onFirst, onChanges, onError }){
  const { onSnapshot } = window.firestoreFns;
  let first = true;
  return onSnapshot(bizCol(name), (snap) => {
    if (first){
      first = false;
      onFirst(snap.docs.map(d => d.data()));
      return;
    }
    const changes = snap.docChanges()
      .filter(c => !c.doc.metadata.hasPendingWrites)
      .map(c => ({ type: c.type, id: c.doc.id, data: c.type === 'removed' ? null : c.doc.data() }));
    if (changes.length) onChanges(changes);
  }, (err) => onError(err, first));
}
