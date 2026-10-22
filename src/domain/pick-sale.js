// Stock → Pick: recording a screenshot's sale on its item (v3.24.4). Pure
// logic, no DOM, window, Firebase or app state. The fields written are
// only the sale's (the data layer uses updateDoc, never saveItem's full
// replace); the profit is the item modal's formula (price − cost − fees −
// shipping paid − other costs). The order number and the line key go on
// the item, so the same screenshot line can't be recorded twice.

import { hasMissingCost } from './sales-ledger.js';

const round2 = (n) => Math.round(n * 100) / 100;
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

// `amount` split in proportion to `weights`: each share is rounded to cents
// and the last positive weight takes the rest, so the shares add up to the
// amount exactly. A weight of 0 or less gets 0.
export function splitProportional(amount, weights){
  const out = weights.map(() => 0);
  const total = round2(weights.reduce((t, w) => t + (w > 0 ? w : 0), 0));
  const last = weights.map(w => w > 0).lastIndexOf(true);
  if (!(amount >= 0) || !total || last < 0) return out;
  let left = round2(amount);
  weights.forEach((w, i) => {
    if (!(w > 0)) return;
    const share = i === last ? left : round2(amount * w / total);
    left = round2(left - share);
    out[i] = share;
  });
  return out;
}

// What one order really sold for (v3.27.1). `lines` are the order's lines
// (all of them, matched or not) with the money the screenshot's pricing
// section showed: orderTotal (the buyer's price, "Price" or "Offer Price"),
// orderFee, orderTax. The listed prices of a bundle are before its
// discount, so the real total is spread over the pieces in the same
// proportion as their listed prices (28.57% off $112 → each piece loses
// 28.57%); the marketplace's fee and the sales tax follow the same split.
// Returns Map(line key → { paid, paidFee, paidTax, note, warn }); a value is
// null when it can't be known (the app then keeps the listed price and the
// platform's fee rule). Never splits when a line is cut off or the total is
// above the listed prices: that is a misread, and the person is told.
export function allocateOrder(lines){
  const out = new Map();
  const money = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const total = money(lines[0] && lines[0].orderTotal);
  const fee = money(lines[0] && lines[0].orderFee);
  const tax = money(lines[0] && lines[0].orderTax);
  const priced = lines.filter(l => l.price !== null && l.price > 0);
  const listed = round2(priced.reduce((t, l) => t + l.price, 0));
  const complete = priced.length > 0 && !lines.some(l => l.partial);
  const none = { paid: null, paidFee: null, paidTax: null, note: '', warn: '' };
  lines.forEach(l => out.set(l.key, { ...none }));
  if (!complete){
    if (total !== null && lines.some(l => l.partial)){
      lines.forEach(l => { out.get(l.key).warn = 'Some lines are cut off, so the order total was not split. Check the prices.'; });
    }
    return out;
  }
  let paid = priced.map(l => l.price);
  let split = false;
  if (total !== null && total > 0){
    if (total > listed + 0.005){
      lines.forEach(l => { out.get(l.key).warn = `The order total ($${total.toFixed(2)}) is above the listed prices ($${listed.toFixed(2)}). Check the screenshot.`; });
    } else if (listed - total >= 0.005){
      paid = splitProportional(total, priced.map(l => l.price));
      split = true;
    } else {
      paid = priced.map(l => l.price);
    }
  }
  const feeShares = fee !== null ? splitProportional(fee, paid) : null;
  const taxShares = tax !== null ? splitProportional(tax, paid) : null;
  const off = split ? (listed - total) / listed * 100 : 0;
  priced.forEach((l, i) => {
    const o = out.get(l.key);
    if (split || total !== null) o.paid = paid[i];
    if (feeShares) o.paidFee = feeShares[i];
    if (taxShares) o.paidTax = taxShares[i];
    if (split) o.note = `Order total $${total.toFixed(2)} for $${listed.toFixed(2)} listed (${off.toFixed(1)}% off). This piece: $${paid[i].toFixed(2)}.`;
  });
  return out;
}

// The platform fee for each line of one order. A marketplace charges a
// bundle on the order total (Poshmark: 20%, or $2.95 under $15), so the
// fee is computed once on the total and split by price; the last line
// takes the rounding cents. `feeFor(platform, price)` is the app's fee
// rule. Returns Map(line key → fee).
export function orderFeeShares(lines, platform, feeFor){
  const out = new Map();
  const priced = lines.filter(l => l.price !== null && l.price > 0);
  const total = round2(priced.reduce((t, l) => t + l.price, 0));
  if (!platform || !total) return out;
  const fee = round2(feeFor(platform, total));
  let left = fee;
  priced.forEach((l, i) => {
    const share = i === priced.length - 1 ? left : round2(fee * l.price / total);
    left = round2(left - share);
    out.set(l.key, share);
  });
  return out;
}

// When it sold: the screenshot's order date at noon local time, or now
// when the date is today, missing, unreadable or in the future.
export function soldAtFor(orderDate, now){
  const m = String(orderDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return now;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
  if (Number.isNaN(d.getTime()) || d.getMonth() !== Number(m[2]) - 1) return now;
  const today = new Date(now);
  const sameDay = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  return sameDay || d.getTime() > now ? now : d.getTime();
}

// The item a line was already recorded on, if any.
export function recordedItem(line, items){
  return (items || []).find(i => i.saleLineKey && i.saleLineKey === line.key) || null;
}

// Validates the person's values and builds the fields to write.
// input: { price, platform, fee, shippingCost } as typed (strings ok).
// Returns { ok: true, fields } or { ok: false, field, error }.
// A piece typed in by its code (v3.25.3) may be sold without its price or
// platform yet. It is still recorded as sold, with those left empty and no
// profit, and `manualSale` marks it so the card can flag the missing sale info.
export function pickSaleFields(item, input, line, now){
  const money = (v) => (String(v ?? '').trim() === '' ? 0 : parseFloat(String(v).replace(/[$,\s]/g, '')));
  const price = money(input.price);
  const typed = line.source === 'manual';
  const incomplete = typed && (!(price > 0) || !input.platform);
  if (!incomplete){
    if (!(price > 0)) return { ok: false, field: 'price', error: 'Enter the sale price.' };
    if (!input.platform) return { ok: false, field: 'platform', error: 'Pick the platform it sold on.' };
  }
  const fee = money(input.fee);
  if (!Number.isFinite(fee) || fee < 0) return { ok: false, field: 'fee', error: 'Enter the fee as 0 or more.' };
  const shippingCost = money(input.shippingCost);
  if (!Number.isFinite(shippingCost) || shippingCost < 0) return { ok: false, field: 'shippingCost', error: 'Enter shipping paid as 0 or more.' };
  const otherCosts = num(item.otherCosts);
  // An item with no cost yet gets it here (v3.27.1). Left empty, the sale is
  // still recorded, with no profit until the cost is known (Finances → Sales
  // lists it as missing); a typed 0 is a known cost.
  const costMissing = hasMissingCost(item);
  const typedCost = String(input.cost ?? '').trim();
  let cost = num(item.cost);
  if (costMissing && typedCost !== ''){
    cost = money(typedCost);
    if (!Number.isFinite(cost) || cost < 0) return { ok: false, field: 'cost', error: 'Enter the cost as 0 or more.' };
  }
  const costKnown = !costMissing || typedCost !== '';
  const fields = {
    status: 'vendido',
    soldPrice: price > 0 ? round2(price) : null,
    soldPlatform: input.platform || null,
    feesTotal: round2(fee),
    shippingCost: round2(shippingCost),
    otherCosts,
    netProfit: incomplete || !costKnown ? null : round2(price - cost - fee - shippingCost - otherCosts),
    soldAt: soldAtFor(line.orderDate, now),
    saleOrderNumber: line.orderNumber || null,
    saleBuyer: line.buyer || null,
    saleLineKey: line.key,
  };
  if (typed) fields.manualSale = true;
  if (costMissing && typedCost !== '') fields.cost = round2(cost).toFixed(2);
  // The sales tax the marketplace collected for the state: kept apart, never part
  // of the price or the fee.
  if (line.paidTax !== null && line.paidTax !== undefined) fields.saleTax = round2(line.paidTax);
  return { ok: true, fields };
}

// What the quick sale form starts with (v3.25.4). The price is the one the
// screenshot read; a typed piece starts at its listed price, or empty when
// the item has none. The platform is set for a typed piece only when the
// item is listed on exactly one platform.
export function quickSaleDefaults(item, line){
  const listed = parseFloat(item.listPrice);
  const real = line.paid !== null && line.paid !== undefined ? line.paid : line.price;
  const hasRead = real !== null && real !== undefined;
  const price = hasRead ? real : (listed > 0 ? listed : null);
  const listedOn = item.listedPlatforms || [];
  const platform = line.platform || (line.source === 'manual' && listedOn.length === 1 ? listedOn[0] : '');
  return { price, platform: platform || '', noPrice: price === null };
}
