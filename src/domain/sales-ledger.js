// Finances → Sales (v3.23.6, Nifty P2 item 1, third part) — pure logic for
// the per-month sales list and its cost editing. No DOM, window, Firebase
// or app state.
// Item cost "missing" means empty: a typed 0 is a known cost (a free or
// gifted piece), so the Missing cost count can always reach zero.
// The profit formula is the item modal's (saveItemFlow): price − item cost
// − fees − shipping paid − other costs.
import { monthKey } from './finance-summary.js';
import { inferSoldPlatform } from './home-summary.js';

export const MAX_COST = 1000000;

// Sold date, falling back to createdAt for old sales (as Finances does).
function soldTime(item){
  return item.soldAt || item.createdAt;
}

export function hasMissingCost(item){
  return item.cost === undefined || item.cost === null || String(item.cost).trim() === '';
}

const num = (v) => parseFloat(v) || 0;
const round2 = (n) => Math.round(n * 100) / 100;

// The sales of one month ('YYYY-MM'), newest first.
export function salesOfMonth(items, key){
  return items
    .filter(i => i.status === 'vendido' && monthKey(soldTime(i)) === key)
    .sort((a, b) => (soldTime(b) || 0) - (soldTime(a) || 0));
}

// Sales without an item cost, counted per month ('YYYY-MM' → n).
export function missingCostByMonth(items){
  const out = {};
  items.forEach(i => {
    if (i.status !== 'vendido' || !hasMissingCost(i)) return;
    const key = monthKey(soldTime(i));
    out[key] = (out[key] || 0) + 1;
  });
  return out;
}

// One row of the list: what the table and the cards show.
export function saleRow(item){
  return {
    id: item.id,
    date: soldTime(item) || null,
    code: item.productCode || '',
    name: item.name || 'Untitled item',
    platform: inferSoldPlatform(item),
    price: num(item.soldPrice),
    fees: num(item.feesTotal),
    cost: hasMissingCost(item) ? null : num(item.cost),
    shipping: num(item.shippingCost),
    other: num(item.otherCosts),
    profit: item.netProfit || 0,
  };
}

// Column totals for the footer; each equals the month's summary above it.
export function totalsOfRows(rows){
  const sum = (k) => round2(rows.reduce((s, r) => s + (r[k] || 0), 0));
  return { price: sum('price'), fees: sum('fees'), cost: sum('cost'), shipping: sum('shipping'), other: sum('other'), profit: sum('profit') };
}

function parseMoney(raw){
  const s = String(raw ?? '').replace(/[$,\s]/g, '');
  if (s === '') return { empty: true, value: 0 };
  const n = Number(s);
  if (!Number.isFinite(n)) return { error: true };
  return { value: Math.round(n * 100) / 100 };
}

// Checks the three editable costs and recomputes the profit. Returns
// { ok, fields } with exactly the fields to write, or { ok:false, field,
// error }. An empty item cost stays empty (still missing); empty shipping
// or other costs are 0.
export function recomputeSaleCosts(item, input){
  const out = {};
  const parts = [['cost', 'Item cost'], ['shippingCost', 'Shipping'], ['otherCosts', 'Other costs']];
  for (const [key, label] of parts){
    const p = parseMoney(input[key]);
    if (p.error) return { ok: false, field: key, error: `${label} must be a number.` };
    if (p.value < 0) return { ok: false, field: key, error: `${label} can't be negative.` };
    if (p.value > MAX_COST) return { ok: false, field: key, error: `${label} is too large.` };
    if (key === 'cost') out.cost = p.empty ? '' : p.value.toFixed(2);
    else out[key] = p.value;
  }
  out.netProfit = round2(num(item.soldPrice) - num(out.cost) - num(item.feesTotal) - out.shippingCost - out.otherCosts);
  return { ok: true, fields: out };
}
