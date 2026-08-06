// Small stateless formatting/utility helpers — pure functions with no
// dependency on app state or the DOM, moved out of main.js's IIFE verbatim.

export function escapeHtml(s){
  return (s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Capitalizes just the first letter of each word — deliberately leaves the
// rest of each word untouched (doesn't force lowercase) so things like
// "iPhone" or "USB-C" already in the name aren't mangled.
export function toTitleCase(s){
  return (s || '').replace(/\S+/g, w => w.charAt(0).toUpperCase() + w.slice(1));
}

export function daysSince(ts){
  return Math.floor((Date.now() - ts) / 86400000);
}

export function daysToSell(item){
  if (!item.soldAt || !item.createdAt) return null;
  return Math.floor((item.soldAt - item.createdAt) / 86400000);
}

export function uid(){ return 'it_' + Date.now() + '_' + Math.random().toString(36).slice(2,8); }

export function statusLabel(s){
  return {catalogado:'Cataloged', anunciado:'Listed', vendido:'Sold'}[s] || s;
}

export function csvEscape(val){
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')){
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// Forces full-cents display (e.g. "18" -> "18.00") on blur for USD number
// inputs. Pure DOM wiring, no app-state dependency — takes the input ids
// as a param already.
export function attachCurrencyFormatting(ids){
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el || el.dataset.currencyFormatBound) return;
    el.dataset.currencyFormatBound = '1';
    el.addEventListener('blur', () => {
      if (el.value === '') return;
      const n = parseFloat(el.value);
      if (!isNaN(n)) el.value = n.toFixed(2);
    });
  });
}
