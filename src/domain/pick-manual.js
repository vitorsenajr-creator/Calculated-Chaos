// Stock → Pick: pieces typed in by their code (v3.25.3). Pure logic, no DOM,
// window, Firebase or app state. The code is digits only: the product code
// without "#" (the SKU on the listing). Each typed code becomes a pick line
// that knows only its SKU, so it matches and lists like a screenshot line.
import { canonCode } from './sale-match.js';

// Digits only: "0897" or "897". A "#" or spaces are dropped.
export function parseManualCode(text){
  const digits = String(text ?? '').replace(/[#\s]/g, '');
  if (!digits) return { ok: false, error: 'Type the item’s code.' };
  if (!/^\d+$/.test(digits)) return { ok: false, error: 'Use numbers only, like 0897.' };
  return { ok: true, code: digits };
}

// Adds a code once, in the order typed. "0897" and "897" are the same code.
export function addManualCode(list, code){
  const key = canonCode(code);
  if (list.some(c => canonCode(c) === key)) return { list, duplicate: true };
  return { list: [...list, code], duplicate: false };
}

export function removeManualCode(list, code){
  const key = canonCode(code);
  return list.filter(c => canonCode(c) !== key);
}

// One pick line per typed code. Each one is its own order, so a platform
// chosen for one piece never applies to another.
export function manualLines(codes){
  return (codes || []).map(code => {
    const key = canonCode(code);
    return {
      key: `manual|${key}`,
      source: 'manual',
      orderRef: `manual|${key}`,
      orderNumber: '',
      orderDate: '',
      buyer: '',
      sku: code,
      title: '',
      platform: null,
      platformRead: null,
      priceText: '',
      price: null,
      size: '',
      partial: false,
    };
  });
}
