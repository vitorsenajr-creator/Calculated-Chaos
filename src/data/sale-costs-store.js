// Cost edits from Finances → Sales (data layer; v3.23.6). Writes only the
// given fields with updateDoc: an item save is a full setDoc replace
// (saveItem in main.js), which would wipe any field without a form input,
// so the sales list never goes through it. Returns true or false.
import { bizDoc } from '../modules/biz.js';

export async function saveSaleCosts(itemId, fields){
  try{
    const { updateDoc } = window.firestoreFns;
    await updateDoc(bizDoc('items', itemId), fields);
    return true;
  }catch(e){
    console.warn('Could not save the sale costs:', e);
    return false;
  }
}
