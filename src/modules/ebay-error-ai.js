// AI fallback for eBay publish errors the error library
// (modules/ebay-error-hints.js) doesn't recognize: sends the raw eBay
// errors + the item's own data to /api/ebay-item-aspects (mode
// 'explain_error' — reuses that existing function to stay inside Vercel
// Hobby's 12-function cap) and turns the answer into the same hint/fix
// shape the library uses, so the error box renders it the same way.

import { targetForAspect } from './ebay-error-hints.js';

// Maps the AI's "fieldToChange" to a library-style fix.
export function aiAnswerToFix(answer){
  const field = String(answer.fieldToChange || 'none');
  const value = String(answer.suggestedValue || '').trim();
  const aspectMatch = field.match(/^aspect:(.+)$/);
  if (aspectMatch || ['size', 'brand', 'color'].includes(field)){
    const target = aspectMatch ? targetForAspect(aspectMatch[1].trim()) : { field };
    const label = aspectMatch ? aspectMatch[1].trim() : field[0].toUpperCase() + field.slice(1);
    if (value) return { type: 'setValue', target, value, label: `Change ${label} to "${value}" & retry` };
    return target.field
      ? { type: 'focusField', fieldId: { size: 'fSize', brand: 'fBrand', color: 'fColor' }[target.field], label: `Edit ${label}` }
      : { type: 'focusField', aspect: target.aspect, label: `Edit ${label}` };
  }
  const focus = {
    condition: ['fCondition', 'Edit Condition'],
    weight: ['fWeight', 'Edit weight'],
    category: ['fEbayCategoryQuery', 'Change eBay category'],
    price: ['fListPrice', 'Edit price'],
    description: ['listingOutputArea', 'Edit description'],
  }[field];
  if (focus) return { type: 'focusField', fieldId: focus[0], label: focus[1] };
  if (field === 'ebay_settings') return { type: 'settings', label: 'Open Settings' };
  return null;
}

// Returns { text, fix } or throws.
export async function explainEbayErrorWithAi(result, item, errors){
  const idToken = await window.auth.currentUser.getIdToken();
  const res = await fetch('/api/ebay-item-aspects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
    body: JSON.stringify({
      mode: 'explain_error',
      step: result.step || null,
      errors: (Array.isArray(result.detail) ? result.detail : result.detail?.errors || result.detail?.Errors || errors || []).slice(0, 5),
      item: {
        name: item.name, category: item.category, clothingType: item.clothingType,
        brand: item.brand, size: item.size, color: item.color, gender: item.gender,
        condition: item.condition, listPrice: item.listPrice, weight: item.weight,
        ebayAspects: item.ebayAspects || null,
      },
      category: { id: result.categoryIdUsed || item.ebayCategoryId || null, path: result.categoryPathUsed || item.ebayCategoryPath || null },
      aspectsSent: result.aspectsSent || result.debugFullInventoryBody?.product?.aspects || null,
    }),
  });
  let data;
  try{ data = await res.json(); }catch(e){ throw new Error(`AI request failed (HTTP ${res.status})`); }
  if (!res.ok) throw new Error(data.error || `AI request failed (HTTP ${res.status})`);
  return { text: data.explanation, fix: aiAnswerToFix(data) };
}
