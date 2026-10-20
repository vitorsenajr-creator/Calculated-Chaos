// Business expenses (data layer; v3.23.3): one doc per expense in the
// business's `expenses` collection. Business-only (no root path), like
// `ebay_sales`. A failed load leaves the list as it was and reports it, so
// the screen can say so instead of showing "no expenses".
import { bizCol, bizDoc } from '../modules/biz.js';

let cache = [];
// 'idle' until the first load ends, then 'loaded' or 'failed'.
let state = 'idle';

export function cachedExpenses(){ return cache; }
export function expensesState(){ return state; }

export async function loadExpenses(){
  try{
    const { getDocs } = window.firestoreFns;
    const snap = await getDocs(bizCol('expenses'));
    cache = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    state = 'loaded';
  }catch(e){
    console.warn('Could not load expenses:', e);
    state = 'failed';
  }
  return cache;
}

let seq = 0;
function newId(){
  return 'e_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8) + (seq++).toString(36);
}

// Saves a new expense (no id) or replaces an existing one. `fields` are the
// validated values from domain/expenses.js. Returns the saved expense, or
// null when the write fails.
export async function saveExpense(fields, { id = null, uid = null } = {}){
  try{
    const { setDoc } = window.firestoreFns;
    const now = Date.now();
    const old = id ? cache.find(e => e.id === id) : null;
    const docId = id || newId();
    const data = {
      ...fields,
      createdAt: old?.createdAt || now,
      createdBy: old?.createdBy || uid || null,
      updatedAt: now,
    };
    await setDoc(bizDoc('expenses', docId), data);
    const saved = { ...data, id: docId };
    const at = cache.findIndex(e => e.id === docId);
    if (at >= 0) cache[at] = saved; else cache.push(saved);
    return saved;
  }catch(e){
    console.warn('Could not save the expense:', e);
    return null;
  }
}

export async function deleteExpense(id){
  try{
    const { deleteDoc } = window.firestoreFns;
    await deleteDoc(bizDoc('expenses', id));
    cache = cache.filter(e => e.id !== id);
    return true;
  }catch(e){
    console.warn('Could not delete the expense:', e);
    return false;
  }
}
