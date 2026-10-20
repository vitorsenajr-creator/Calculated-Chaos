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

// ---------- Import (v3.23.7) ----------
// `docs` = [{ id, data }] from domain/expense-import.js. Saved in batches of
// 400 (Firestore allows 500 writes per batch), skipping ids in
// `alreadySaved`, so a dropped connection can be continued without
// duplicates. Returns { saved: [ids], error }.
export const EXPENSE_BATCH_SIZE = 400;

export async function saveExpenseBatches(docs, { alreadySaved = new Set(), onProgress = () => {} } = {}){
  const { writeBatch } = window.firestoreFns;
  const todo = docs.filter(d => !alreadySaved.has(d.id));
  const saved = [];
  for (let k = 0; k < todo.length; k += EXPENSE_BATCH_SIZE){
    const chunk = todo.slice(k, k + EXPENSE_BATCH_SIZE);
    try{
      const batch = writeBatch(window.db);
      chunk.forEach(d => batch.set(bizDoc('expenses', d.id), d.data));
      await batch.commit();
    }catch(e){
      console.error('Expense import batch failed:', e);
      return { saved, error: (e && e.message) || String(e) };
    }
    chunk.forEach(d => { saved.push(d.id); cache.push({ ...d.data, id: d.id }); });
    onProgress(alreadySaved.size + saved.length, docs.length);
  }
  return { saved, error: null };
}

// Deletes every expense of an import (found in Firestore, so an import made
// on another device is found too). Returns { deleted: [ids], error }.
export async function undoExpenseImport(importId){
  const { writeBatch, query, where, getDocs } = window.firestoreFns;
  let ids;
  try{
    const snap = await getDocs(query(bizCol('expenses'), where('importId', '==', importId)));
    ids = [];
    snap.forEach(d => { if (d.data() && d.data().importId === importId) ids.push(d.id); });
  }catch(e){
    return { deleted: [], error: (e && e.message) || String(e) };
  }
  const deleted = [];
  for (let k = 0; k < ids.length; k += EXPENSE_BATCH_SIZE){
    const chunk = ids.slice(k, k + EXPENSE_BATCH_SIZE);
    try{
      const batch = writeBatch(window.db);
      chunk.forEach(id => batch.delete(bizDoc('expenses', id)));
      await batch.commit();
    }catch(e){
      return { deleted, error: (e && e.message) || String(e) };
    }
    chunk.forEach(id => deleted.push(id));
  }
  const gone = new Set(deleted);
  cache = cache.filter(e => !gone.has(e.id));
  return { deleted, error: null };
}

export function newExpenseId(){ return newId(); }
