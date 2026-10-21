// Goal periods and progress on Home (src/domain/goals.js). Weeks run Monday
// to Sunday; June 15, 2026 is a Monday.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goalWindow, goalProgress } from '../../src/domain/goals.js';

const WED = new Date(2026, 5, 17, 12).getTime();

test('the week runs from Monday to the next Monday', () => {
  const w = goalWindow('week', WED);
  assert.equal(w.start, new Date(2026, 5, 15).getTime());
  assert.equal(w.end, new Date(2026, 5, 22).getTime());
});

test('quarters start in January, April, July and October', () => {
  const q = goalWindow('quarter', WED);
  assert.equal(q.start, new Date(2026, 3, 1).getTime());
  assert.equal(q.end, new Date(2026, 6, 1).getTime());
});

test('month and year windows', () => {
  assert.equal(goalWindow('month', WED).start, new Date(2026, 5, 1).getTime());
  assert.equal(goalWindow('year', WED).end, new Date(2027, 0, 1).getTime());
});

test('progress counts only sales inside the window, and reports the pace', () => {
  const items = [
    { status: 'vendido', soldAt: new Date(2026, 5, 16, 12).getTime(), netProfit: 40 },
    // Last week's sale is outside the goal's window.
    { status: 'vendido', soldAt: new Date(2026, 5, 9, 12).getTime(), netProfit: 500 },
  ];
  const p = goalProgress(items, { metric: 'profit', period: 'week', target: 100 }, WED);
  assert.equal(p.current, 40);
  assert.equal(p.done, false);
  assert.equal(p.remaining, 60);
  assert.equal(p.behindBy, 0);
  assert.equal(p.ahead, true);
  // Wednesday noon is 2.5 days into a 7-day week.
  assert.ok(Math.abs(p.elapsed - 2.5 / 7) < 1e-9);
  assert.equal(p.daysLeft, 5);
});
