// Mileage at the IRS standard rate (src/domain/mileage.js). Expected values
// are worked out by hand from the published rates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rateFor, mileageAmount } from '../../src/domain/mileage.js';

test('the rate follows the trip date, including the July 1, 2026 change', () => {
  assert.equal(rateFor('2026-06-30').rate, 0.725);
  assert.equal(rateFor('2026-07-01').rate, 0.76);
  assert.equal(rateFor('2024-03-10').rate, 0.67);
});

test('dates outside the table are estimated and use the nearest rate', () => {
  assert.deepEqual(
    { rate: rateFor('2027-01-05').rate, estimated: rateFor('2027-01-05').estimated },
    { rate: 0.76, estimated: true },
  );
  assert.equal(rateFor('2022-12-31').estimated, true);
  assert.equal(rateFor('2025-06-01').estimated, false);
});

test('a trip is miles times the rate of its date, rounded to cents', () => {
  const july = mileageAmount(42, '2026-07-15');
  assert.deepEqual(july, { miles: 42, rate: 0.76, amount: 31.92 });
  const oneDecimal = mileageAmount(10.25, '2025-02-01');
  assert.equal(oneDecimal.miles, 10.3);
  assert.equal(oneDecimal.amount, 7.21);
});
