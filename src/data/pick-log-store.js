// The Pick activity log (data layer; v3.27.7): one doc per action in the
// business's `pick_log` collection, only ever added (the rule allows create
// and read, never update or delete). Writing is best-effort: Pick works
// the same if the log can't be written, for instance before the rule is
// pasted in the Console.
import { bizCol, bizDoc } from '../modules/biz.js';
import { makeEntry, monthRange } from '../domain/pick-log.js';

export async function logPick(type, details){
  try{
    const { setDoc } = window.firestoreFns;
    const user = window.auth && window.auth.currentUser;
    const entry = makeEntry(type, details, user);
    await setDoc(bizDoc('pick_log', entry.id), entry);
    return true;
  }catch(e){
    console.warn('Could not write the Pick log (non-blocking):', e);
    return false;
  }
}

// One month ("YYYY-MM") of entries. Throws when it can't be read.
export async function loadPickLog(ym){
  const range = monthRange(ym);
  if (!range) return [];
  const { getDocs, query, where } = window.firestoreFns;
  const snap = await getDocs(query(bizCol('pick_log'), where('at', '>=', range[0]), where('at', '<', range[1])));
  return snap.docs.map(d => d.data());
}
