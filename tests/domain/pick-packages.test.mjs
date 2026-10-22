// Package numbers on the Pick checklist (v3.27.2): src/domain/sale-match.js
// (buildPickList) and the page layout in src/ui/stock/pick-print.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saleLines, buildPickList } from '../../src/domain/sale-match.js';
import { manualLines } from '../../src/domain/pick-manual.js';
import { paginatePick, packText, SHEET_MM } from '../../src/ui/stock/pick-print.js';

const bundle = (n, count, buyer) => ({
  platform: 'poshmark', orderNumber: `order-${n}`, orderDate: '2026-10-20', buyer,
  total: '', fee: '', netEarnings: '', salesTax: '',
  items: Array.from({ length: count }, (_, i) => ({ title: `Piece ${n}-${i + 1}`, price: '$10.00', size: 'M', sku: String(n * 100 + i + 1).padStart(4, '0'), partial: false })),
});
const catalog = (orders) => orders.flatMap(o => o.items.map((it, i) => ({
  id: `id-${it.sku}`, productCode: `#${it.sku}`, name: it.title, status: 'catalogado', storageBox: i % 2 ? 'B' : 'A', listedPlatforms: [],
})));
const run = (orders, extra = []) => {
  const { lines } = saleLines(orders.map((o, i) => ({ source: `s${i}`, result: { isSale: true, orders: [o] } })));
  const all = [...lines, ...extra];
  return { lines: all, pl: buildPickList(all, catalog(orders), {}) };
};

test('every order gets a package number, in the order the orders first appear', () => {
  const orders = [bundle(1, 6, '@jbvogt777'), bundle(2, 1, '@aevanwinkle')];
  const { pl } = run(orders, manualLines(['0999']));
  assert.deepEqual(pl.packages.map(p => [p.n, p.buyer, p.pieces]), [[1, '@jbvogt777', 6], [2, '@aevanwinkle', 1], [3, '', 1]]);
  const rows = [...pl.boxes.flatMap(b => b.rows), ...pl.unmatched];
  const byOrder = new Map();
  rows.forEach(r => byOrder.set(r.line.orderRef, new Set([...(byOrder.get(r.line.orderRef) || []), r.pack])));
  byOrder.forEach(set => assert.equal(set.size, 1, 'all the pieces of one order share its number'));
  assert.equal(rows.filter(r => r.pack === 1).length, 6);
  assert.ok(pl.unmatched.every(r => r.pack >= 1), 'a piece not in the catalog still has its package');
});

test('adding a later screenshot keeps the numbers already given', () => {
  const first = run([bundle(1, 3, '@a'), bundle(2, 2, '@b')]).pl.packages.map(p => [p.orderNumber, p.n]);
  const later = run([bundle(1, 3, '@a'), bundle(2, 2, '@b'), bundle(3, 4, '@c')]).pl.packages.map(p => [p.orderNumber, p.n]);
  assert.deepEqual(later.slice(0, 2), first);
  assert.deepEqual(later[2], ['order-3', 3]);
});

test('the packages are listed at the end of the checklist with buyer and piece count', () => {
  const orders = [bundle(1, 6, '@jbvogt777'), bundle(2, 1, '')];
  const { pl } = run(orders);
  const blocks = paginatePick(pl).flat();
  const at = blocks.findIndex(b => b.type === 'box' && b.title === 'Packages');
  assert.ok(at > 0);
  assert.deepEqual(blocks.slice(at + 1, at + 3).map(b => [b.type, b.pack.n]), [['pack', 1], ['pack', 2]]);
  assert.equal(blocks[blocks.length - 1].type, 'sign');
  assert.equal(packText(pl.packages[0]), '@jbvogt777 · 6 pieces');
  assert.equal(packText(pl.packages[1]), 'No buyer name · 1 piece');
});

test('a long checklist with packages still fits its pages: no overflow, no heading left alone', () => {
  const orders = Array.from({ length: 12 }, (_, i) => bundle(i + 1, 4, `@buyer${i + 1}`));
  const { pl } = run(orders);
  const pages = paginatePick(pl);
  assert.ok(pages.length > 1);
  const room = SHEET_MM.height - 2 * 5 - 6;
  pages.forEach((blocks, p) => {
    const used = blocks.reduce((t, b) => t + b.h, 0);
    assert.ok(used <= room - (p === 0 ? 18 : 0) + 1e-9, `page ${p + 1} uses ${used} mm`);
    assert.notEqual(blocks[blocks.length - 1].type, 'box', `page ${p + 1} ends on a heading`);
  });
  const packBlocks = pages.flat().filter(b => b.type === 'pack');
  assert.equal(packBlocks.length, 12);
  pages.forEach(blocks => {
    const first = blocks[0];
    if (first.type === 'pack') assert.fail('a page may not start in the middle of the packages without its heading');
  });
});
