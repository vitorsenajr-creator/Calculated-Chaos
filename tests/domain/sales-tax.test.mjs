// The sales tax record (v3.27.3): src/domain/finance-summary.js (salesTaxOf and
// the Overview's salesTax). The tax is only recorded: it must never change
// revenue, fees or profit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salesTaxOf, totalsOf, computeFinanceOverview } from '../../src/domain/finance-summary.js';

const NOW = new Date(2026, 9, 22, 12).getTime();
const sale = (over = {}) => ({ status: 'vendido', soldPrice: 20, feesTotal: 4, cost: 5, netProfit: 11, soldAt: new Date(2026, 9, 10, 12).getTime(), ...over });

test('the tax is summed in exact cents over the sales that have it', () => {
  const r = salesTaxOf([sale({ saleTax: 0.1 }), sale({ saleTax: 0.2 }), sale({ saleTax: '2.59' }), sale()]);
  assert.deepEqual(r, { total: 2.89, recorded: 3, sales: 4 });
});

test('a typed 0 counts as recorded; empty, null, undefined and junk do not', () => {
  const r = salesTaxOf([sale({ saleTax: 0 }), sale({ saleTax: null }), sale({ saleTax: '' }), sale({ saleTax: 'abc' }), sale({ saleTax: undefined })]);
  assert.deepEqual(r, { total: 0, recorded: 1, sales: 5 });
  assert.deepEqual(salesTaxOf([]), { total: 0, recorded: 0, sales: 0 });
});

test('the Overview carries the tax for the period only, and no other total moves', () => {
  const inMonth = sale({ saleTax: 1.29 });
  const lastYear = sale({ saleTax: 9.99, soldAt: new Date(2025, 2, 3, 12).getTime() });
  const noTax = sale();
  const withTax = computeFinanceOverview([inMonth, lastYear], { period: 'month', now: NOW });
  const without = computeFinanceOverview([{ ...inMonth, saleTax: undefined }, { ...lastYear, saleTax: undefined }], { period: 'month', now: NOW });
  assert.deepEqual(withTax.salesTax, { total: 1.29, recorded: 1, sales: 1 });
  assert.deepEqual(withTax.totals, without.totals, 'revenue, fees and profit are identical with or without the tax');
  assert.deepEqual(withTax.split, without.split);
  assert.deepEqual(computeFinanceOverview([noTax], { period: 'month', now: NOW }).salesTax, { total: 0, recorded: 0, sales: 1 });
  const all = computeFinanceOverview([inMonth, lastYear], { period: 'all', now: NOW });
  assert.equal(all.salesTax.total, 11.28);
  assert.equal(totalsOf([inMonth, lastYear]).revenue, 40);
});
