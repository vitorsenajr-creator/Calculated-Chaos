// Finances screen numbers (v3.21.3) — pure calculations over `items` (no
// DOM, window, Firebase or app state). The caller passes the period, the
// clock and the projected-profit function (it depends on settings), so
// this stays testable in plain Node.
// Profit is always the netProfit saved at sale time, like Home, the stats
// strip and Reports (v3.19.1), so every screen shows the same number.
import { periodStart, inferSoldPlatform } from './home-summary.js';

export const FINANCE_PERIODS = ['month', 'year', 'all'];
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Sold date, falling back to createdAt for old sales saved without soldAt.
function soldTime(item){
  return item.soldAt || item.createdAt;
}

// 'YYYY-MM' in local time; 'unknown' when the item has no usable date.
export function monthKey(ts){
  const d = new Date(ts);
  if (ts === undefined || ts === null || isNaN(d.getTime())) return 'unknown';
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

export function monthLabel(key, { long = false } = {}){
  if (key === 'unknown') return 'No date';
  const [y, m] = key.split('-');
  return long ? `${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}` : MONTH_NAMES[parseInt(m, 10) - 1];
}

// Revenue, the costs it paid for, profit and margin of a list of sales.
export function totalsOf(sales){
  const sum = (fn) => sales.reduce((s, i) => s + fn(i), 0);
  const revenue = sum(i => parseFloat(i.soldPrice) || 0);
  const profit = sum(i => i.netProfit || 0);
  return {
    count: sales.length,
    revenue,
    cost: sum(i => parseFloat(i.cost) || 0),
    fees: sum(i => i.feesTotal || 0),
    shipping: sum(i => parseFloat(i.shippingCost) || 0),
    other: sum(i => parseFloat(i.otherCosts) || 0),
    profit,
    margin: revenue > 0 ? profit / revenue * 100 : 0,
  };
}

// The sales tax the marketplaces collected on a list of sales (v3.27.3): the
// sum of `saleTax` where it is recorded (a typed 0 counts as recorded), and
// how many sales have it. Kept apart: it is never part of revenue, fees or
// profit, so no other total reads it.
export function salesTaxOf(sales){
  let cents = 0;
  let recorded = 0;
  sales.forEach(i => {
    if (i.saleTax === null || i.saleTax === undefined || i.saleTax === '') return;
    const t = parseFloat(i.saleTax);
    if (!Number.isFinite(t)) return;
    cents += Math.round(t * 100);
    recorded += 1;
  });
  return { total: cents / 100, recorded, sales: sales.length };
}

// One row per month with sales, newest first ("No date" last).
export function monthlyTotals(items){
  const byMonth = {};
  items.filter(i => i.status === 'vendido').forEach(i => {
    const key = monthKey(soldTime(i));
    if (!byMonth[key]) byMonth[key] = [];
    byMonth[key].push(i);
  });
  return Object.keys(byMonth)
    .sort((a, b) => (a === 'unknown') - (b === 'unknown') || (a < b ? 1 : a > b ? -1 : 0))
    .map(key => ({ key, ...totalsOf(byMonth[key]) }));
}

// The 12 months ending with the one that contains `now`, oldest first,
// with zeros for months without sales.
export function lastTwelveMonths(monthly, now){
  const byKey = Object.fromEntries(monthly.map(m => [m.key, m]));
  const d = new Date(now);
  const out = [];
  for (let k = 11; k >= 0; k--){
    const key = monthKey(new Date(d.getFullYear(), d.getMonth() - k, 1).getTime());
    const m = byKey[key];
    out.push({ key, profit: m ? m.profit : 0, revenue: m ? m.revenue : 0, count: m ? m.count : 0 });
  }
  return out;
}

// Where each dollar of revenue went. Costs are what the sales recorded;
// profit is the saved netProfit. When those don't add up to the revenue
// exactly (an item's cost edited after the sale), the bar scales to the
// larger of the two so the parts stay comparable.
export function revenueSplit(totals){
  const parts = [
    { key: 'cost', label: 'Item cost', amount: totals.cost },
    { key: 'fees', label: 'Platform fees', amount: totals.fees },
    { key: 'shipping', label: 'Shipping', amount: totals.shipping },
    { key: 'other', label: 'Other costs', amount: totals.other },
    { key: 'profit', label: 'Sales profit', amount: Math.max(totals.profit, 0) },
  ];
  const scale = Math.max(totals.revenue, parts.reduce((t, p) => t + p.amount, 0));
  return parts.map(p => ({ ...p, share: scale > 0 ? p.amount / scale : 0 }));
}

// The stretch of time the current period is compared with (v3.22.2): the
// same days of the previous month ("Oct 1-20" vs "Sep 1-20"), or the same
// point of the previous year, so a period still running isn't measured
// against a whole one. A day the previous month doesn't have (Mar 31 vs
// February) takes the whole previous month. 'all' has nothing to compare.
export function previousWindow(period, now){
  const d = new Date(now);
  const y = d.getFullYear(), m = d.getMonth(), day = d.getDate();
  const time = [d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()];
  if (period === 'month'){
    const start = new Date(y, m - 1, 1).getTime();
    const end = new Date(y, m - 1, day, ...time);
    return { start, end: end.getMonth() === new Date(start).getMonth() ? end.getTime() : new Date(y, m, 1).getTime() };
  }
  if (period === 'year'){
    const end = new Date(y - 1, m, day, ...time);
    return { start: new Date(y - 1, 0, 1).getTime(), end: end.getMonth() === m ? end.getTime() : new Date(y - 1, m + 1, 1).getTime() };
  }
  return null;
}

// Sell-through of a stretch of time: items sold in it ÷ items that were
// available during it (in stock when it began, or cataloged during it).
// Every sale is also an available item, so it never goes over 100%. Items
// without createdAt count as cataloged long ago.
export function sellThroughOf(items, start, end){
  let available = 0, sold = 0;
  items.forEach(i => {
    const created = i.createdAt || 0;
    if (created >= end) return;
    if (i.status === 'vendido'){
      const t = soldTime(i) || 0;
      if (t < start) return;
      if (t < end) sold += 1;
    }
    available += 1;
  });
  return { sold, available, rate: available > 0 ? sold / available * 100 : null };
}

// Days from cataloging to sale, like daysToSell() in Reports; null when
// either date is missing.
function daysToSell(item){
  if (!item.soldAt || !item.createdAt) return null;
  return Math.floor((item.soldAt - item.createdAt) / 86400000);
}

// Revenue, units, profit and averages per platform, most revenue first.
export function platformTotals(sales){
  const by = {};
  sales.forEach(i => {
    const p = inferSoldPlatform(i);
    if (!by[p]) by[p] = { platform: p, revenue: 0, count: 0, profit: 0, days: [] };
    by[p].revenue += parseFloat(i.soldPrice) || 0;
    by[p].count += 1;
    by[p].profit += i.netProfit || 0;
    const days = daysToSell(i);
    if (days !== null) by[p].days.push(days);
  });
  return Object.values(by)
    .map(({ days, ...r }) => ({
      ...r,
      avgProfit: r.profit / r.count,
      avgDaysToSell: days.length ? days.reduce((a, b) => a + b, 0) / days.length : null,
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

// Top values of a text field (brand, category) by units sold, then profit.
// Spellings that differ only in case or spaces count together, under the
// first one seen; items without the field are left out.
export function topBy(sales, field, limit = 5){
  const by = {};
  sales.forEach(i => {
    const name = String(i[field] || '').trim().replace(/\s+/g, ' ');
    if (!name) return;
    const key = name.toLowerCase();
    if (!by[key]) by[key] = { name, count: 0, revenue: 0, profit: 0 };
    by[key].count += 1;
    by[key].revenue += parseFloat(i.soldPrice) || 0;
    by[key].profit += i.netProfit || 0;
  });
  return Object.values(by)
    .sort((a, b) => b.count - a.count || b.profit - a.profit || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export function computeFinanceOverview(items, { period = 'month', now = Date.now(), projectedProfit = () => 0 } = {}){
  const start = periodStart(period, now);
  const sold = items.filter(i => i.status === 'vendido');
  const inPeriod = sold.filter(i => (soldTime(i) || 0) >= start);
  const totals = totalsOf(inPeriod);
  const byPlatform = platformTotals(inPeriod);

  // The previous stretch, for the changes under the summary numbers.
  const prevWin = previousWindow(period, now);
  const previous = prevWin ? {
    ...prevWin,
    totals: totalsOf(sold.filter(i => { const t = soldTime(i) || 0; return t >= prevWin.start && t < prevWin.end; })),
    sellThrough: sellThroughOf(items, prevWin.start, prevWin.end),
  } : null;

  const active = items.filter(i => i.status !== 'vendido');
  return {
    period,
    totals,
    salesTax: salesTaxOf(inPeriod),
    previous,
    sellThrough: sellThroughOf(items, start, Infinity),
    split: revenueSplit(totals),
    lastTwelve: lastTwelveMonths(monthlyTotals(items), now),
    revenueByPlatform: byPlatform.map(({ platform, revenue, count }) => ({ platform, revenue, count })),
    byPlatform,
    topBrands: topBy(inPeriod, 'brand'),
    topCategories: topBy(inPeriod, 'category'),
    stock: {
      count: active.length,
      projected: active.reduce((s, i) => s + (projectedProfit(i) || 0), 0),
      atListPrice: active.reduce((s, i) => s + (parseFloat(i.listPrice) || 0), 0),
    },
  };
}
