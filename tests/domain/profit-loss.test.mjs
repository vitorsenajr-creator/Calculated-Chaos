// Profit & Loss for one month (src/domain/profit-loss.js). Two sales in
// June 2026 and one in May; the June expenses net a refund.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeProfitLoss } from '../../src/domain/profit-loss.js';

const NOW = new Date(2026, 5, 15, 12).getTime();
const at = (y, m, d) => new Date(y, m - 1, d, 12).getTime();

const items = [
  // June sale: price 100, cost 30, fees 13, shipping 5, other 0 → profit 52
  { id: 'a', status: 'vendido', soldPrice: 100, cost: 30, feesTotal: 13, shippingCost: 5, otherCosts: 0, netProfit: 52, soldAt: at(2026, 6, 10) },
  // June sale: price 50, cost 10, fees 6.5, shipping 0, other 2 → profit 31.5
  { id: 'b', status: 'vendido', soldPrice: 50, cost: 10, feesTotal: 6.5, shippingCost: 0, otherCosts: 2, netProfit: 31.5, soldAt: at(2026, 6, 20) },
  // May sale: outside June
  { id: 'c', status: 'vendido', soldPrice: 999, cost: 1, feesTotal: 0, shippingCost: 0, otherCosts: 0, netProfit: 998, soldAt: at(2026, 5, 30) },
  // Not sold
  { id: 'd', status: 'catalogado', soldPrice: null, cost: 20 },
];

const expenses = [
  { date: '2026-06-05', category: 'advertising', amount: 25, kind: 'expense' },
  { date: '2026-06-12', category: 'advertising', amount: 5, kind: 'refund' },
  { date: '2026-05-20', category: 'advertising', amount: 400, kind: 'expense' },
];

test('June P&L counts only June sales and June expenses', () => {
  const pnl = computeProfitLoss(items, expenses, { period: 'this_month', now: NOW });
  assert.equal(pnl.salesCount, 2);
  assert.equal(pnl.revenue.total, 150);
  assert.equal(pnl.cogs, 40);
  assert.equal(pnl.grossProfit, 110);
  assert.equal(pnl.selling.fees, 19.5);
  assert.equal(pnl.selling.shipping, 5);
  assert.equal(pnl.selling.other, 2);
  assert.equal(pnl.selling.total, 26.5);
  assert.equal(pnl.salesProfit, 83.5);
  assert.equal(pnl.adjustment, 0);
});

test('expenses are net of refunds and the net profit is sales profit minus them', () => {
  const pnl = computeProfitLoss(items, expenses, { period: 'this_month', now: NOW });
  assert.equal(pnl.expenses.total, 20);
  assert.equal(pnl.netProfit, 63.5);
});

test('revenue by platform groups sales without a platform under "outra"', () => {
  const pnl = computeProfitLoss(items, expenses, { period: 'this_month', now: NOW });
  assert.deepEqual(pnl.revenue.byPlatform, [{ platform: 'outra', amount: 150, count: 2 }]);
});
