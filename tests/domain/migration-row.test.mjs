import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrationRowState } from '../../src/domain/migration-row.js';

const LIVE_NOTE = 'Live on business data (old collection frozen)';

test('live with more docs on the business is OK with the live note', () => {
  assert.deepEqual(migrationRowState({ source: 1442, target: 1478 }, true),
    { state: 'ok', pill: 'OK', detail: 'Current: 1442 · Copied: 1478', note: LIVE_NOTE });
  assert.deepEqual(migrationRowState({ source: 0, target: 1 }, true),
    { state: 'ok', pill: 'OK', detail: 'Current: 0 · Copied: 1', note: LIVE_NOTE });
});

test('live with fewer docs on the business is a warning', () => {
  assert.deepEqual(migrationRowState({ source: 1478, target: 1442 }, true), {
    state: 'warning', pill: 'Fewer on business', detail: 'Current: 1478 · Copied: 1442',
    note: 'The business has 36 fewer docs than the old collection'
  });
  assert.equal(migrationRowState({ source: 5, target: 4 }, true).note, 'The business has 1 fewer doc than the old collection');
});

test('not live keeps the old rule: OK only when the counts match', () => {
  assert.deepEqual(migrationRowState({ source: 10, target: 10 }, false), { state: 'ok', pill: 'OK', detail: 'Current: 10 · Copied: 10' });
  assert.deepEqual(migrationRowState({ source: 10, target: 12 }, false), { state: 'pending', pill: 'Pending', detail: 'Current: 10 · Copied: 12' });
  assert.equal(migrationRowState({ source: 12, target: 10 }, false).state, 'pending');
});
