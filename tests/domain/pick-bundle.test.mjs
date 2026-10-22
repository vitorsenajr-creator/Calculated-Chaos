// Real bundle money from a sale screenshot's pricing section (v3.27.1):
// src/domain/pick-sale.js (allocateOrder, pickSaleFields, quickSaleDefaults),
// src/domain/sale-match.js (saleLines) and the server prompt and schema.
// The numbers are Vitor's real Poshmark order of 2026-10-20: six pieces
// listed at $112.00, sold as a $80.00 offer, $16.00 fee, $64.00 net, $2.59 tax.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitProportional, allocateOrder, pickSaleFields, quickSaleDefaults } from '../../src/domain/pick-sale.js';
import { saleLines } from '../../src/domain/sale-match.js';
import { buildSaleScreenshotRequest } from '../../src/modules/ai-sale-screenshot.js';

const LISTED = [11, 15, 30, 15, 13, 28];
const sum = (a) => Math.round(a.reduce((t, n) => t + n, 0) * 100) / 100;

const order = (money = {}) => ({
  platform: 'poshmark', orderNumber: '6ad7db83014fb5b7438f266b', orderDate: '2026-10-20', buyer: '@jbvogt777',
  total: '', fee: '', netEarnings: '', salesTax: '', ...money,
  items: LISTED.map((p, i) => ({ title: `Piece ${i + 1}`, price: `$${p.toFixed(2)}`, size: 'M', sku: `0${i + 1}00`, partial: false })),
});
const REAL = { total: '$80.00', fee: '-$16.00', netEarnings: '$64.00', salesTax: '$2.59' };

test('the offer is spread over the pieces in proportion to their listed prices', () => {
  const paid = splitProportional(80, LISTED);
  assert.deepEqual(paid, [7.86, 10.71, 21.43, 10.71, 9.29, 20]);
  assert.equal(sum(paid), 80);
  assert.deepEqual(splitProportional(16, paid).map(n => n), splitProportional(16, paid));
  assert.equal(sum(splitProportional(16, paid)), 16);
  assert.equal(sum(splitProportional(2.59, paid)), 2.59);
});

test('shares always add up to the amount, with the rounding cents on the last piece', () => {
  [[100, [1, 1, 1]], [0.07, [3, 5, 9]], [33.33, [10.01, 20.02, 7.77, 1]]].forEach(([amount, w]) => {
    assert.equal(sum(splitProportional(amount, w)), amount);
  });
  assert.deepEqual(splitProportional(10, [5, 0, 5]), [5, 0, 5]);
  assert.deepEqual(splitProportional(10, []), []);
});

test('saleLines: the real total, fee and tax are read and split across the order', () => {
  const { lines } = saleLines([{ source: 's1', result: { isSale: true, orders: [order(REAL)] } }]);
  assert.equal(lines.length, 6);
  assert.deepEqual(lines.map(l => l.paid), [7.86, 10.71, 21.43, 10.71, 9.29, 20]);
  assert.equal(sum(lines.map(l => l.paidFee)), 16);
  assert.equal(sum(lines.map(l => l.paidTax)), 2.59);
  assert.equal(lines[0].orderFee, 16, 'the minus sign of the fee row is dropped');
  assert.equal(lines[0].orderNet, 64);
  assert.match(lines[0].bundleNote, /\$80\.00 for \$112\.00 listed \(28\.6% off\)/);
  assert.equal(lines[0].price, 11, 'the listed price stays as read');
});

test('a closed pricing section keeps today\'s behavior: listed prices, no real fee', () => {
  const { lines } = saleLines([{ source: 's1', result: { isSale: true, orders: [order()] } }]);
  lines.forEach(l => {
    assert.equal(l.paid, null);
    assert.equal(l.paidFee, null);
    assert.equal(l.paidTax, null);
    assert.equal(l.bundleNote, '');
  });
});

test('the same order read from two screenshots shares the money of the one that showed it', () => {
  const shotB = { ...order(REAL), items: [] };
  const { lines } = saleLines([
    { source: 's1', result: { isSale: true, orders: [order()] } },
    { source: 's2', result: { isSale: true, orders: [shotB] } },
  ]);
  assert.equal(lines.length, 6);
  assert.equal(sum(lines.map(l => l.paid)), 80);
});

test('an order without a discount is not changed', () => {
  const { lines } = saleLines([{ source: 's1', result: { isSale: true, orders: [order({ total: '$112.00', fee: '$22.40' })] } }]);
  assert.deepEqual(lines.map(l => l.paid), LISTED);
  assert.equal(lines[0].bundleNote, '');
  assert.equal(sum(lines.map(l => l.paidFee)), 22.4);
});

test('a total above the listed prices, or a cut-off line, is a misread: not split, and said', () => {
  const above = saleLines([{ source: 's1', result: { isSale: true, orders: [order({ total: '$150.00' })] } }]).lines;
  assert.deepEqual(above.map(l => l.paid), LISTED);
  assert.match(above[0].bundleWarn, /above the listed prices/);
  const cut = order(REAL);
  cut.items[2].partial = true;
  const lines = saleLines([{ source: 's1', result: { isSale: true, orders: [cut] } }]).lines;
  lines.forEach(l => { assert.equal(l.paid, null); assert.equal(l.paidFee, null); });
  assert.match(lines[0].bundleWarn, /cut off/);
});

test('a single piece: $12.00 with a $2.95 fee and $1.29 tax keeps the tax out of price and fee', () => {
  const single = { platform: 'poshmark', orderNumber: '6ad95085e98802527a4edfc4', orderDate: '2026-10-21', buyer: '@aevanwinkle',
    total: '$12.00', fee: '-$2.95', netEarnings: '$9.05', salesTax: '$1.29',
    items: [{ title: 'ALYA Skort', price: '$12.00', size: 'S', sku: '0510', partial: false }] };
  const [l] = saleLines([{ source: 's1', result: { isSale: true, orders: [single] } }]).lines;
  assert.equal(l.paid, 12);
  assert.equal(l.paidFee, 2.95);
  assert.equal(l.paidTax, 1.29);
});

test('the sale: real price default, the tax saved apart, and the profit from the real numbers', () => {
  const { lines } = saleLines([{ source: 's1', result: { isSale: true, orders: [order(REAL)] } }]);
  const l = lines[0];
  assert.equal(quickSaleDefaults({ listPrice: '11' }, l).price, 7.86);
  const r = pickSaleFields({ cost: '3.00' }, { price: '7.86', platform: 'poshmark', fee: String(l.paidFee), shippingCost: '0' }, l, Date.now());
  assert.equal(r.ok, true);
  assert.equal(r.fields.soldPrice, 7.86);
  assert.equal(r.fields.saleTax, l.paidTax);
  assert.equal(r.fields.netProfit, Math.round((7.86 - 3 - l.paidFee) * 100) / 100);
  assert.equal('cost' in r.fields, false, 'a known cost is left alone');
});

test('an item with no cost: typed cost is saved with the profit; empty records the sale without a profit', () => {
  const l = { key: 'k', source: 'screenshot', orderDate: '2026-10-20', orderNumber: '1', buyer: '', paidTax: null };
  const base = { price: '20', platform: 'poshmark', fee: '4', shippingCost: '0' };
  const typed = pickSaleFields({ cost: '' }, { ...base, cost: '6.5' }, l, Date.now());
  assert.equal(typed.fields.cost, '6.50');
  assert.equal(typed.fields.netProfit, 9.5);
  const zero = pickSaleFields({}, { ...base, cost: '0' }, l, Date.now());
  assert.equal(zero.fields.cost, '0.00', 'a typed 0 is a known cost');
  assert.equal(zero.fields.netProfit, 16);
  const empty = pickSaleFields({ cost: '' }, { ...base, cost: '' }, l, Date.now());
  assert.equal(empty.ok, true);
  assert.equal(empty.fields.netProfit, null);
  assert.equal('cost' in empty.fields, false);
  assert.equal('saleTax' in empty.fields, false);
  const bad = pickSaleFields({ cost: '' }, { ...base, cost: 'abc' }, l, Date.now());
  assert.deepEqual([bad.ok, bad.field], [false, 'cost']);
});

test('the server prompt and schema ask for the pricing section and keep the tax out of price and fee', () => {
  const { promptText, schema } = buildSaleScreenshotRequest({ platforms: [{ key: 'poshmark', label: 'Poshmark' }] });
  const o = schema.properties.orders.items;
  ['total', 'fee', 'netEarnings', 'salesTax'].forEach(k => {
    assert.ok(o.required.includes(k), `${k} is required`);
    assert.equal(o.properties[k].type, 'string');
  });
  assert.match(promptText, /"Price" or "Offer Price"/);
  assert.match(promptText, /never put it in total, fee or netEarnings/);
});
