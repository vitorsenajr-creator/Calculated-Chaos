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
    { key: 'profit', label: 'Profit', amount: Math.max(totals.profit, 0) },
  ];
  const scale = Math.max(totals.revenue, parts.reduce((t, p) => t + p.amount, 0));
  return parts.map(p => ({ ...p, share: scale > 0 ? p.amount / scale : 0 }));
}

export function computeFinanceOverview(items, { period = 'month', now = Date.now(), projectedProfit = () => 0 } = {}){
  const start = periodStart(period, now);
  const sold = items.filter(i => i.status === 'vendido');
  const inPeriod = sold.filter(i => (soldTime(i) || 0) >= start);
  const totals = totalsOf(inPeriod);

  const byPlatform = {};
  inPeriod.forEach(i => {
    const p = inferSoldPlatform(i);
    if (!byPlatform[p]) byPlatform[p] = { platform: p, revenue: 0, count: 0 };
    byPlatform[p].revenue += parseFloat(i.soldPrice) || 0;
    byPlatform[p].count += 1;
  });

  const active = items.filter(i => i.status !== 'vendido');
  return {
    period,
    totals,
    split: revenueSplit(totals),
    lastTwelve: lastTwelveMonths(monthlyTotals(items), now),
    revenueByPlatform: Object.values(byPlatform).sort((a, b) => b.revenue - a.revenue),
    stock: {
      count: active.length,
      projected: active.reduce((s, i) => s + (projectedProfit(i) || 0), 0),
      atListPrice: active.reduce((s, i) => s + (parseFloat(i.listPrice) || 0), 0),
    },
  };
}
