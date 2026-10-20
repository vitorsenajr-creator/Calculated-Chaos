// Profit & Loss statement (v3.23.4, Nifty P2 item 1, second part) — pure
// logic over items and expenses, no DOM, window, Firebase or app state.
// Accrual: an item's cost counts in the period it sells. Platform fees,
// shipping and other per-sale costs are selling costs, below gross profit.
// Sales profit is the netProfit saved on each sale, like every other
// screen; when the lines don't add up to it (a sale saved with an older
// formula, a cost edited later), "Sale adjustments" carries the difference
// so the statement ends on the same number as Overview and Home.
import { totalsOf } from './finance-summary.js';
import { inferSoldPlatform } from './home-summary.js';
import { isoDate, signedAmount, summarizeExpenses } from './expenses.js';

export const PNL_PERIODS = ['this_month', 'last_month', 'this_year', 'last_year', 'all'];
export const PNL_PERIOD_LABEL = {
  this_month: 'This month', last_month: 'Last month', this_year: 'This year', last_year: 'Last year', all: 'All time',
};

const round2 = (n) => Math.round(n * 100) / 100;

// Sold date, falling back to createdAt for old sales saved without soldAt
// (the same rule as Finances).
function soldTime(item){
  return item.soldAt || item.createdAt || 0;
}

// The period as times (start inclusive, end exclusive) and as local dates
// for the expenses ('YYYY-MM-DD', end exclusive).
export function pnlWindow(period, now = Date.now()){
  const d = new Date(now);
  const y = d.getFullYear(), m = d.getMonth();
  let start, end;
  if (period === 'this_month'){ start = new Date(y, m, 1); end = new Date(y, m + 1, 1); }
  else if (period === 'last_month'){ start = new Date(y, m - 1, 1); end = new Date(y, m, 1); }
  else if (period === 'this_year'){ start = new Date(y, 0, 1); end = new Date(y + 1, 0, 1); }
  else if (period === 'last_year'){ start = new Date(y - 1, 0, 1); end = new Date(y, 0, 1); }
  else return { period: 'all', start: 0, end: Infinity, startDate: '', endDate: '￿' };
  return { period, start: start.getTime(), end: end.getTime(), startDate: isoDate(start), endDate: isoDate(end) };
}

// "October 2026", "September 2026", "2026", "2025", "All time".
export function pnlPeriodName(period, now = Date.now()){
  const w = pnlWindow(period, now);
  if (period === 'all' || !PNL_PERIODS.includes(period)) return 'All time';
  const s = new Date(w.start);
  if (period === 'this_month' || period === 'last_month') return s.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  return String(s.getFullYear());
}

export function computeProfitLoss(items, expenses, { period = 'this_month', now = Date.now() } = {}){
  const w = pnlWindow(period, now);
  const sales = items.filter(i => i.status === 'vendido').filter(i => {
    const t = soldTime(i);
    return t >= w.start && t < w.end;
  });
  const t = totalsOf(sales);

  const byP = {};
  sales.forEach(i => {
    const p = inferSoldPlatform(i);
    if (!byP[p]) byP[p] = { platform: p, amount: 0, count: 0 };
    byP[p].amount += parseFloat(i.soldPrice) || 0;
    byP[p].count += 1;
  });
  const byPlatform = Object.values(byP)
    .map(r => ({ ...r, amount: round2(r.amount) }))
    .sort((a, b) => b.amount - a.amount || a.platform.localeCompare(b.platform));

  const exp = (expenses || []).filter(e => typeof e.date === 'string' && e.date >= w.startDate && e.date < w.endDate);
  const expSum = summarizeExpenses(exp);

  const revenue = round2(t.revenue);
  const cogs = round2(t.cost);
  const selling = { fees: round2(t.fees), shipping: round2(t.shipping), other: round2(t.other) };
  selling.total = round2(selling.fees + selling.shipping + selling.other);
  const grossProfit = round2(revenue - cogs);
  const salesProfit = round2(t.profit);
  let adjustment = round2(salesProfit - (grossProfit - selling.total));
  if (Math.abs(adjustment) < 0.005) adjustment = 0;
  const netProfit = round2(salesProfit - expSum.total);

  return {
    window: w,
    salesCount: sales.length,
    revenue: { total: revenue, byPlatform },
    cogs,
    grossProfit,
    selling,
    adjustment,
    salesProfit,
    expenses: { total: expSum.total, count: expSum.count, byCategory: expSum.byCategory },
    netProfit,
  };
}

// Expenses (net of refunds) in one of Overview's periods ('month', 'year',
// 'all'): the whole calendar month or year, like the Expenses tab.
const OVERVIEW_TO_PNL = { month: 'this_month', year: 'this_year', all: 'all' };
export function expensesForPeriod(expenses, period, now = Date.now()){
  const w = pnlWindow(OVERVIEW_TO_PNL[period] || 'all', now);
  return round2((expenses || []).filter(e => typeof e.date === 'string' && e.date >= w.startDate && e.date < w.endDate)
    .reduce((s, e) => s + signedAmount(e), 0));
}

// CSV rows for the statement: Section, Line, Amount. Costs and expenses
// are positive within their section; the result lines carry their sign.
export function pnlCsvRows(pnl, { periodName = '', platformLabel = (k) => k } = {}){
  const f = (n) => n.toFixed(2);
  const rows = [['Section', 'Line', 'Amount']];
  rows.push(['Period', periodName, '']);
  pnl.revenue.byPlatform.forEach(r => rows.push(['Revenue', platformLabel(r.platform), f(r.amount)]));
  rows.push(['Revenue', 'Total revenue', f(pnl.revenue.total)]);
  rows.push(['Cost of goods sold', 'Item cost', f(pnl.cogs)]);
  rows.push(['Gross profit', 'Gross profit', f(pnl.grossProfit)]);
  rows.push(['Selling costs', 'Platform fees', f(pnl.selling.fees)]);
  rows.push(['Selling costs', 'Shipping paid', f(pnl.selling.shipping)]);
  rows.push(['Selling costs', 'Other sale costs', f(pnl.selling.other)]);
  if (pnl.adjustment) rows.push(['Selling costs', 'Sale adjustments', f(-pnl.adjustment)]);
  rows.push(['Selling costs', 'Total selling costs', f(round2(pnl.selling.total - pnl.adjustment))]);
  pnl.expenses.byCategory.forEach(c => rows.push(['Operating expenses', c.label, f(c.total)]));
  rows.push(['Operating expenses', 'Total operating expenses', f(pnl.expenses.total)]);
  rows.push(['Net profit', 'Net profit', f(pnl.netProfit)]);
  return rows;
}
