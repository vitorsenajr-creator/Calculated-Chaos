// Recording a screenshot sale on its item (src/domain/pick-sale.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderFeeShares, pickSaleFields } from '../../src/domain/pick-sale.js';

test('a bundle fee is split by price, and the last line takes the rounding cents', () => {
  const lines = [{ key: 'a', price: 10 }, { key: 'b', price: 20.01 }];
  // Fee on the total: 30.01 × 20% = 6.002 → 6.00, split 2.00 and 4.00.
  const shares = orderFeeShares(lines, 'poshmark', (p, total) => total * 0.2);
  assert.equal(shares.get('a'), 2);
  assert.equal(shares.get('b'), 4);
  assert.equal(shares.get('a') + shares.get('b'), 6);
});

test('lines without a price get no fee share, and no platform gives no fees', () => {
  const lines = [{ key: 'a', price: 10 }, { key: 'c', price: null }];
  const shares = orderFeeShares(lines, 'ebay', (p, total) => total * 0.1);
  assert.equal(shares.has('c'), false);
  assert.equal(shares.get('a'), 1);
  assert.equal(orderFeeShares(lines, '', () => 5).size, 0);
});

const NOW = new Date(2026, 5, 15, 12).getTime();
const line = { key: 'k1', source: 'screenshot', orderDate: '2026-06-10', orderNumber: '123', buyer: 'buyer1' };
const item = { cost: 30, otherCosts: 1 };

test('a recorded sale: profit is price minus cost, fees, shipping and other costs', () => {
  const r = pickSaleFields(item, { price: '$50.00', platform: 'poshmark', fee: '7.50', shippingCost: '0' }, line, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.fields.netProfit, 11.5);
  assert.equal(r.fields.soldPrice, 50);
  assert.equal(r.fields.status, 'vendido');
  assert.equal(r.fields.soldAt, new Date(2026, 5, 10, 12).getTime());
  assert.equal(r.fields.saleLineKey, 'k1');
});

test('a sale needs a price and a platform', () => {
  const noPrice = pickSaleFields(item, { price: '', platform: 'ebay', fee: '0', shippingCost: '0' }, line, NOW);
  assert.deepEqual([noPrice.ok, noPrice.field], [false, 'price']);
  const noPlatform = pickSaleFields(item, { price: '20', platform: '', fee: '0', shippingCost: '0' }, line, NOW);
  assert.deepEqual([noPlatform.ok, noPlatform.field], [false, 'platform']);
});

test('a typed piece sold without its price is recorded with no profit', () => {
  const typed = { ...line, source: 'manual' };
  const r = pickSaleFields(item, { price: '', platform: '', fee: '0', shippingCost: '0' }, typed, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.fields.netProfit, null);
  assert.equal(r.fields.manualSale, true);
});
