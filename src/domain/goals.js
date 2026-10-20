// Goals on Home (v3.22.3) — pure calculations, no DOM, window, Firebase
// or app state. Goals are business settings (`appSettings.goals`, a list
// of { id, metric, period, target }); progress is always computed from
// the items, so every period starts again from zero on its own.
// The numbers use Finances' own helpers, so both screens agree.
import { totalsOf, sellThroughOf } from './finance-summary.js';

export const GOAL_METRICS = {
  profit: { label: 'Profit', unit: 'money' },
  revenue: { label: 'Revenue', unit: 'money' },
  sold: { label: 'Items sold', unit: 'count' },
  cataloged: { label: 'Items cataloged', short: 'Cataloged', unit: 'count' },
  sellThrough: { label: 'Sell-through', unit: 'pct' },
};
export const GOAL_PERIODS = ['week', 'month', 'quarter', 'year'];
export const MAX_GOALS = 4;
const DAY_MS = 86400000;

// Sold date, falling back to createdAt like Finances.
function soldTime(item){
  return item.soldAt || item.createdAt || 0;
}

// The period that contains `now`, as [start, end). Weeks run Monday to
// Sunday (Vitor, 2026-10-20); quarters are Jan-Mar, Apr-Jun, ...
export function goalWindow(period, now){
  const d = new Date(now);
  const y = d.getFullYear(), m = d.getMonth();
  if (period === 'week'){
    const back = (d.getDay() + 6) % 7;
    return { start: new Date(y, m, d.getDate() - back).getTime(), end: new Date(y, m, d.getDate() - back + 7).getTime() };
  }
  if (period === 'quarter'){
    const q = m - (m % 3);
    return { start: new Date(y, q, 1).getTime(), end: new Date(y, q + 3, 1).getTime() };
  }
  if (period === 'year') return { start: new Date(y, 0, 1).getTime(), end: new Date(y + 1, 0, 1).getTime() };
  return { start: new Date(y, m, 1).getTime(), end: new Date(y, m + 1, 1).getTime() };
}

// Only well-formed goals, at most MAX_GOALS; anything else in the saved
// list (a removed metric, a bad target) is left out instead of breaking Home.
export function normalizeGoals(raw){
  if (!Array.isArray(raw)) return [];
  return raw.filter(g => g && typeof g.id === 'string' && GOAL_METRICS[g.metric] && GOAL_PERIODS.includes(g.period)
    && Number.isFinite(g.target) && g.target > 0 && !(g.metric === 'sellThrough' && g.target > 100))
    .slice(0, MAX_GOALS)
    .map(({ id, metric, period, target }) => ({ id, metric, period, target }));
}

// The metric's value over [start, end).
export function metricValue(items, metric, start, end){
  if (metric === 'cataloged') return items.filter(i => (i.createdAt || 0) >= start && (i.createdAt || 0) < end).length;
  if (metric === 'sellThrough') return sellThroughOf(items, start, end).rate || 0;
  const sales = items.filter(i => i.status === 'vendido' && soldTime(i) >= start && soldTime(i) < end);
  const t = totalsOf(sales);
  return metric === 'profit' ? t.profit : metric === 'revenue' ? t.revenue : t.count;
}

// Progress of one goal at `now`. `expected` is where a steady pace would
// be by now (the target times the share of the period gone by), so 40% on
// the 20th of the month isn't mistaken for falling behind.
export function goalProgress(items, goal, now){
  const { start, end } = goalWindow(goal.period, now);
  const current = metricValue(items, goal.metric, start, end);
  const elapsed = Math.min(1, Math.max(0, (now - start) / (end - start)));
  const expected = goal.target * elapsed;
  return {
    ...goal,
    ...GOAL_METRICS[goal.metric],
    start, end,
    current,
    share: current / goal.target,
    elapsed,
    expected,
    done: current >= goal.target,
    ahead: current >= expected,
    remaining: Math.max(0, goal.target - current),
    behindBy: Math.max(0, expected - current),
    daysLeft: Math.max(0, Math.ceil((end - now) / DAY_MS)),
  };
}

export function computeGoals(items, goals, now = Date.now()){
  return normalizeGoals(goals).map(g => goalProgress(items, g, now));
}
