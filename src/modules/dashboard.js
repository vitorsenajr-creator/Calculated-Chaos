// Desktop dashboard data — pure calculations over `items`, same pattern as
// reports.js (no DOM here; renderDashboard() in main.js builds the HTML).
import { daysSince } from './format-utils.js';
import { isIncomplete } from './catalog-filters.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(ts){
  const d = new Date(ts);
  d.setHours(0,0,0,0);
  return d.getTime();
}

export function computeDashboardData(items){
  const now = Date.now();
  const today = startOfDay(now);
  const sold = items.filter(i => i.status === 'vendido');
  const active = items.filter(i => i.status !== 'vendido');

  // ---- Stat cards ----
  const weekAgo = today - 7 * DAY_MS;
  const inventoryCount = active.length;
  const addedThisWeek = items.filter(i => i.createdAt && i.createdAt >= weekAgo).length;

  // "Pending listings" = cataloged, has everything needed to publish, just
  // hasn't been marked as listed anywhere yet.
  const pendingListings = items.filter(i => i.status === 'catalogado' && !isIncomplete(i) && i.listPrice);

  const yearStart = new Date(new Date(now).getFullYear(), 0, 1).getTime();
  const soldThisYear = sold.filter(i => i.soldAt && i.soldAt >= yearStart);
  const profitYTD = soldThisYear.reduce((s,i) => s + (i.netProfit || 0), 0);

  // Same Jan-1-through-today window, one year back, for the YTD comparison.
  const lastYearStart = new Date(new Date(now).getFullYear() - 1, 0, 1).getTime();
  const lastYearSameDay = new Date(new Date(now).getFullYear() - 1, new Date(now).getMonth(), new Date(now).getDate()).getTime();
  const soldLastYearToDate = sold.filter(i => i.soldAt && i.soldAt >= lastYearStart && i.soldAt <= lastYearSameDay);
  const profitLastYearToDate = soldLastYearToDate.reduce((s,i) => s + (i.netProfit || 0), 0);
  const profitYTDDeltaPct = profitLastYearToDate > 0 ? ((profitYTD - profitLastYearToDate) / profitLastYearToDate) * 100 : null;

  const totalRevenue = sold.reduce((s,i) => s + (parseFloat(i.soldPrice) || 0), 0);
  const totalProfit = sold.reduce((s,i) => s + (i.netProfit || 0), 0);
  const avgMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
  const sellThroughPct = items.length > 0 ? (sold.length / items.length) * 100 : 0;

  // ---- Revenue by platform (realized, from sold items) ----
  const byPlatform = {};
  sold.forEach(i => {
    const p = i.soldPlatform || 'outra';
    if (!byPlatform[p]) byPlatform[p] = { revenue: 0, count: 0 };
    byPlatform[p].revenue += parseFloat(i.soldPrice) || 0;
    byPlatform[p].count += 1;
  });
  const revenueByPlatform = Object.keys(byPlatform)
    .map(p => ({ platform: p, revenue: byPlatform[p].revenue, count: byPlatform[p].count }))
    .sort((a,b) => b.revenue - a.revenue);
  const totalPlatformRevenue = revenueByPlatform.reduce((s,r) => s + r.revenue, 0);

  // ---- Profit, last 7 days (for the sparkline) ----
  const profitByDay = [];
  for (let i = 6; i >= 0; i--){
    const dayStart = today - i * DAY_MS;
    const dayEnd = dayStart + DAY_MS;
    const dayProfit = sold.filter(it => it.soldAt && it.soldAt >= dayStart && it.soldAt < dayEnd)
      .reduce((s,it) => s + (it.netProfit || 0), 0);
    profitByDay.push({ date: dayStart, profit: dayProfit });
  }
  const profitLast7Days = profitByDay.reduce((s,d) => s + d.profit, 0);

  // ---- Recent activity: merge Added / Listed on eBay / Sold events ----
  const events = [];
  items.forEach(i => {
    if (i.createdAt) events.push({ item: i, ts: i.createdAt, kind: 'added' });
    if (i.ebayListedAt) events.push({ item: i, ts: i.ebayListedAt, kind: 'listed', platform: 'eBay' });
    if (i.soldAt) events.push({ item: i, ts: i.soldAt, kind: 'sold' });
  });
  events.sort((a,b) => b.ts - a.ts);
  const recentActivity = events.slice(0, 8);

  // ---- Needs attention: blocked from listing, or stale (30d+ listed) ----
  const blocked = items.filter(i => i.status === 'catalogado' && isIncomplete(i));
  const stale = items.filter(i => i.status === 'anunciado' && (i.ebayListedAt || i.createdAt) && daysSince(i.ebayListedAt || i.createdAt) >= 30);
  const needsAttention = [...stale, ...blocked].slice(0, 6);
  const needsAttentionMoreCount = Math.max(0, stale.length + blocked.length - needsAttention.length);

  // ---- Sourcing streak: consecutive days (through today) with >= 1 item added ----
  const createdDays = new Set(items.filter(i => i.createdAt).map(i => startOfDay(i.createdAt)));
  let sourcingStreak = 0;
  let cursor = today;
  // Today doesn't break the streak if nothing's been added yet — start
  // counting from today if it has an entry, otherwise from yesterday.
  if (!createdDays.has(cursor)) cursor -= DAY_MS;
  while (createdDays.has(cursor)){
    sourcingStreak++;
    cursor -= DAY_MS;
  }

  return {
    inventoryCount, addedThisWeek, pendingListings, profitYTD, profitYTDDeltaPct,
    avgMargin, sellThroughPct, revenueByPlatform, totalPlatformRevenue,
    profitByDay, profitLast7Days, recentActivity, needsAttention, needsAttentionMoreCount,
    sourcingStreak,
  };
}
