// Reading money and dates from a spreadsheet, US formats (src/domain/import-sheet.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney, parseDate, detectDateOrder } from '../../src/domain/import-sheet.js';

test('money: dollar signs, thousands commas, negatives and blanks', () => {
  assert.equal(parseMoney('$1,234.50'), 1234.5);
  assert.equal(parseMoney('1,234'), 1234);
  assert.equal(parseMoney('(12.00)'), -12);
  assert.equal(parseMoney('-5'), -5);
  assert.equal(parseMoney(7.25), 7.25);
  assert.equal(parseMoney(''), null);
  assert.ok(Number.isNaN(parseMoney('abc')));
});

test('dates: month first by default, two-digit years, ISO and Excel serials', () => {
  const june15 = new Date(2026, 5, 15, 12).getTime();
  assert.equal(parseDate('06/15/2026'), june15);
  assert.equal(parseDate('6/15/26'), june15);
  assert.equal(parseDate('2026-06-15'), june15);
  // Excel serial 46188 is 2026-06-15 (days since 1899-12-30).
  assert.equal(parseDate(46188), june15);
});

test('day-first dates are read only when asked for', () => {
  assert.equal(parseDate('15/06/2026', 'dmy'), new Date(2026, 5, 15, 12).getTime());
  assert.ok(Number.isNaN(parseDate('15/06/2026', 'mdy')));
});

test('the date order comes from the column: a first part over 12 means day first', () => {
  assert.equal(detectDateOrder(['06/15/2026', '07/01/2026']), 'mdy');
  assert.equal(detectDateOrder(['15/06/2026', '01/07/2026']), 'dmy');
  assert.equal(detectDateOrder(['01/02/2026']), 'mdy');
});
