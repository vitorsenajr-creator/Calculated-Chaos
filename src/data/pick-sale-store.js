// Sales recorded from Stock → Pick (data layer; v3.24.4). Writes only the
// sale's fields with updateDoc: saveItem() is a full setDoc replace that
// would wipe any field the Pick screen doesn't carry. Returns true or false.
import { bizDoc } from '../modules/biz.js';

export async function recordPickSale(itemId, fields){
  try{
    const { updateDoc } = window.firestoreFns;
    await updateDoc(bizDoc('items', itemId), fields);
    return true;
  }catch(e){
    console.warn('Could not record the sale:', e);
    return false;
  }
}
