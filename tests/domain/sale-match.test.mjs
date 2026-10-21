// Matching a sale screenshot's line to a catalog item (src/domain/sale-match.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonCode, matchSaleLine } from '../../src/domain/sale-match.js';

test('a code ignores "#", spaces, case and leading zeros', () => {
  assert.equal(canonCode('#0897'), '897');
  assert.equal(canonCode(' 0897 '), '897');
  assert.equal(canonCode('0897-1'), '897-1');
  assert.equal(canonCode('00'), '0');
});

const items = [
  { id: 'i1', productCode: '#0897', status: 'catalogado' },
  { id: 'i2', productCode: '#1204', status: 'catalogado' },
  { id: 'i3', productCode: '#1204-1', status: 'catalogado' },
  { id: 'i4', productCode: '#1204-2', status: 'vendido' },
  { id: 'i5', productCode: '', legacyCode: 'T-42', status: 'catalogado' },
];

test('a SKU matches the item with that product code, exactly', () => {
  const m = matchSaleLine({ sku: '0897' }, items);
  assert.equal(m.item.id, 'i1');
  assert.equal(m.how, 'sku');
  assert.equal(m.confidence, 'exact');
});

test('a SKU of the base code matches its copies when the base item is not there', () => {
  const copies = [
    { id: 'c1', productCode: '#1204-1', status: 'catalogado' },
    { id: 'c2', productCode: '#1204-2', status: 'catalogado' },
  ];
  const m = matchSaleLine({ sku: '1204' }, copies);
  assert.equal(m.item.id, 'c1');
  assert.equal(m.copies, 2);
});

test('an exact code wins over its copies', () => {
  const m = matchSaleLine({ sku: '1204' }, items);
  assert.equal(m.item.id, 'i2');
  assert.equal(m.copies, 1);
});

test('a SKU with no product code falls back to the legacy code', () => {
  const m = matchSaleLine({ sku: 'T-42' }, items);
  assert.equal(m.item.id, 'i5');
  assert.equal(m.how, 'legacy');
});

test('an unknown SKU finds nothing and says so', () => {
  const m = matchSaleLine({ sku: '9999' }, items);
  assert.equal(m.item, null);
  assert.equal(m.skuNotFound, true);
});
