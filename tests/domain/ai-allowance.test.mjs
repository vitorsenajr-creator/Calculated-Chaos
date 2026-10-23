// Monthly AI allowance per business (src/domain/ai-allowance.js, v3.28.1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { businessAiLimit, usedCalls, resetDate, monthName, allowanceOf, limitMessage } from '../../src/domain/ai-allowance.js';

test('only a positive number is a limit', () => {
  assert.equal(businessAiLimit({ aiMonthlyLimit: 100 }), 100);
  assert.equal(businessAiLimit({ aiMonthlyLimit: 99.7 }), 99);
  assert.equal(businessAiLimit({ aiMonthlyLimit: 0 }), null);
  assert.equal(businessAiLimit({ aiMonthlyLimit: '100' }), null);
  assert.equal(businessAiLimit({}), null);
  assert.equal(businessAiLimit(null), null);
});

test('calls add up across rows', () => {
  assert.equal(usedCalls([{ calls: 3 }, { calls: 2, inputTokens: 900 }, { calls: -1 }, {}, null]), 5);
  assert.equal(usedCalls([]), 0);
});

test('the reset is the first of the next month, December included', () => {
  assert.equal(resetDate('2026-10'), '2026-11-01');
  assert.equal(resetDate('2026-12'), '2027-01-01');
  assert.equal(monthName('2026-02'), 'February');
});

test('allowed until the limit, then refused', () => {
  assert.deepEqual(allowanceOf({ limit: 100, used: 99, month: '2026-10' }),
    { limited: true, limit: 100, used: 99, remaining: 1, allowed: true, month: '2026-10', resetsOn: '2026-11-01' });
  assert.equal(allowanceOf({ limit: 100, used: 100, month: '2026-10' }).allowed, false);
  assert.equal(allowanceOf({ limit: 100, used: 103, month: '2026-10' }).remaining, 0);
  const free = allowanceOf({ limit: null, used: 0, month: '2026-10' });
  assert.equal(free.limited, false);
  assert.equal(free.allowed, true);
});

test('the message names the month and the reset day', () => {
  assert.equal(limitMessage({ limit: 100, month: '2026-10' }), 'Your store used its 100 AI actions for October. They reset on November 1.');
  assert.equal(limitMessage({ limit: 100, month: '2026-12' }), 'Your store used its 100 AI actions for December. They reset on January 1.');
});
