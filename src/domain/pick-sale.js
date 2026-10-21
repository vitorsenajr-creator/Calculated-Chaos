// Stock → Pick: recording a screenshot's sale on its item (v3.24.4). Pure
// logic, no DOM, window, Firebase or app state. The fields written are
// only the sale's (the data layer uses updateDoc, never saveItem's full
// replace); the profit is the item modal's formula (price − cost − fees −
// shipping paid − other costs). The order number and the line key go on
// the item, so the same screenshot line can't be recorded twice.

const round2 = (n) => Math.round(n * 100) / 100;
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

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
  const fields = {
    status: 'vendido',
    soldPrice: price > 0 ? round2(price) : null,
    soldPlatform: input.platform || null,
    feesTotal: round2(fee),
    shippingCost: round2(shippingCost),
    otherCosts,
    netProfit: incomplete ? null : round2(price - num(item.cost) - fee - shippingCost - otherCosts),
    soldAt: soldAtFor(line.orderDate, now),
    saleOrderNumber: line.orderNumber || null,
    saleBuyer: line.buyer || null,
    saleLineKey: line.key,
  };
  if (typed) fields.manualSale = true;
  return { ok: true, fields };
}

// What the quick sale form starts with (v3.25.4). The price is the one the
// screenshot read; a typed piece starts at its listed price, or empty when
// the item has none. The platform is set for a typed piece only when the
// item is listed on exactly one platform.
export function quickSaleDefaults(item, line){
  const listed = parseFloat(item.listPrice);
  const hasRead = line.price !== null && line.price !== undefined;
  const price = hasRead ? line.price : (listed > 0 ? listed : null);
  const listedOn = item.listedPlatforms || [];
  const platform = line.platform || (line.source === 'manual' && listedOn.length === 1 ? listedOn[0] : '');
  return { price, platform: platform || '', noPrice: price === null };
}
