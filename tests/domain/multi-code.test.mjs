// Two codes in one product code field (v3.27.26): src/domain/item-issues.js,
// the catalog filter, Home's row and the label's barcode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeHasMultiple, hasMultipleCodes, itemIssues, hasIssues, ISSUE_KEYS, codeCounts } from '../../src/domain/item-issues.js';
import { applyFilters, filtersActiveCount } from '../../src/modules/catalog-filters.js';
import { computeHomeSummary } from '../../src/domain/home-summary.js';
import { barcodeTextOf, barcodeLayout } from '../../src/domain/code128.js';

const item = (productCode, extra = {}) => ({ id: `id-${productCode}`, productCode, name: 'Piece', status: 'catalogado', listPrice: '20', photos: ['p'], cost: 5, weight: 1, length: 1, width: 1, ...extra });

test('what is one code and what is two', () => {
  for (const one of ['#0897', '0897', '#0897-1', 'A-12', '  #0897  ', '', null, undefined, '#']){
    assert.equal(codeHasMultiple(one), false, JSON.stringify(one));
  }
  for (const two of ['#1475 , #1473', '1475, 1473', '#1475 #1473', '#1475;#1473', '#1475/#1473', '#1475 & #1473', '1475 1473']){
    assert.equal(codeHasMultiple(two), true, JSON.stringify(two));
  }
  assert.equal(hasMultipleCodes(item('#1475 , #1473')), true);
});

test('the issue is always on, for sold items too, after the duplicate code', () => {
  assert.ok(ISSUE_KEYS.indexOf('multi-code') > ISSUE_KEYS.indexOf('duplicate-code'));
  assert.ok(ISSUE_KEYS.indexOf('multi-code') < ISSUE_KEYS.indexOf('no-price'));
  assert.deepEqual(itemIssues(item('#1475 , #1473')), ['multi-code']);
  assert.deepEqual(itemIssues(item('#1475 , #1473', { status: 'vendido' })), ['multi-code']);
  assert.deepEqual(itemIssues(item('#0897')), []);
  assert.equal(hasIssues(item('#1475 , #1473')), true);
});

test('the catalog filter lists exactly the two-code items and counts as a filter', () => {
  const all = [item('#0897'), item('#1475 , #1473'), item('#0900', { status: 'vendido' }), item('#1 , #2', { status: 'vendido' })];
  const picked = applyFilters(all, { multiCode: true, platformsInclude: [], platformsExclude: [] }, '', { counts: codeCounts(all) });
  assert.deepEqual(picked.map(i => i.productCode), ['#1475 , #1473', '#1 , #2']);
  assert.equal(filtersActiveCount({ multiCode: true, platformsInclude: [], platformsExclude: [] }), 1);
  // the Issues chip shows the same items among its union
  const issues = applyFilters(all, { issues: true, platformsInclude: [], platformsExclude: [] }, '', { counts: codeCounts(all) });
  assert.deepEqual(issues.map(i => i.productCode), ['#1475 , #1473', '#1 , #2']);
});

test('Home gets one row with the same count as the filter', () => {
  const all = [item('#0897'), item('#1475 , #1473'), item('#1 , #2', { status: 'vendido' })];
  const row = computeHomeSummary(all).attention.find(r => r.key === 'multi-code');
  assert.equal(row.count, 2);
  assert.equal(row.action, 'Fix');
  assert.match(row.detail, /1475 , #1473/);
  assert.equal(computeHomeSummary([item('#0897')]).attention.some(r => r.key === 'multi-code'), false);
});

test('no barcode for a field with two codes, the normal ones keep theirs', () => {
  assert.equal(barcodeTextOf({ productCode: '#1475 , #1473' }), '');
  assert.equal(barcodeLayout({ productCode: '#1475 , #1473' }, 4, 300), null);
  assert.equal(barcodeTextOf({ productCode: '#0897-1' }), '0897-1');
  assert.ok(barcodeLayout({ productCode: '#0897-1' }, 4, 300));
});
