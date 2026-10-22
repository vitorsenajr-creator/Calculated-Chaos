// The Pick activity log (src/domain/pick-log.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEntry, cleanDetails, monthRange, monthOf, describeEntry, filterLog, logUsers } from '../../src/domain/pick-log.js';

const user = { uid: 'u1', email: 'a@x.com' };

test('an entry carries who, when and what, with no undefined or empty values', () => {
  const e = makeEntry('sold', { code: '#0919', name: 'Dress', price: 13, fee: 0, buyer: undefined, orderNumber: '' }, user, 1000, 0.5);
  assert.equal(e.uid, 'u1');
  assert.equal(e.email, 'a@x.com');
  assert.equal(e.at, 1000);
  assert.equal(e.type, 'sold');
  assert.equal(e.fee, 0); // a real zero stays
  assert.ok(!('buyer' in e) && !('orderNumber' in e));
  assert.match(e.id, /^1000-/);
  assert.ok(Object.values(e).every(v => v !== undefined));
});

test('long lists are cut and turned to text', () => {
  const d = cleanDetails({ codes: Array.from({ length: 200 }, (_, i) => i) });
  assert.equal(d.codes.length, 60);
  assert.equal(typeof d.codes[0], 'string');
});

test('a month range is local and half-open; bad input gives null', () => {
  const [s, e] = monthRange('2026-12');
  assert.equal(new Date(s).getMonth(), 11);
  assert.equal(new Date(e).getFullYear(), 2027);
  assert.equal(new Date(e).getMonth(), 0);
  assert.equal(monthOf(s), '2026-12');
  assert.equal(monthOf(e - 1), '2026-12');
  assert.equal(monthOf(e), '2027-01');
  assert.equal(monthRange('2026-13'), null);
  assert.equal(monthRange(''), null);
});

test('each kind of entry reads as one sentence', () => {
  assert.equal(describeEntry({ type: 'screenshot', file: 's.png', orders: 1, pieces: 6, orderNumbers: ['6ad7'] }), 'Read a screenshot "s.png": 1 order (6ad7), 6 pieces.');
  assert.equal(describeEntry({ type: 'sold', code: '#0919', name: 'Dress', price: 13, platform: 'poshmark', fee: 2.6, profit: 5, orderNumber: '6ad7' }),
    'Recorded sale of #0919 Dress: $13.00 on poshmark, fee $2.60, profit $5.00, order 6ad7.');
  assert.match(describeEntry({ type: 'clear', pieces: 6, orders: 1, screenshots: 2, picked: 4, recorded: 3, codes: ['#1', '#2'] }), /Cleared the list: 6 pieces from 1 order \(2 screenshots, 4 picked, 3 recorded\)\. Pieces: #1, #2\./);
  assert.equal(describeEntry({ type: 'checklist', pieces: 6, orders: 2 }), 'Shared the checklist: 6 pieces from 2 orders.');
});

test('the log shows newest first and filters by person', () => {
  const list = [{ at: 1, uid: 'a', email: 'a@x' }, { at: 3, uid: 'b', email: 'b@x' }, { at: 2, uid: 'a', email: 'a@x' }];
  assert.deepEqual(filterLog(list).map(e => e.at), [3, 2, 1]);
  assert.deepEqual(filterLog(list, 'a').map(e => e.at), [2, 1]);
  assert.deepEqual(logUsers(list), [{ uid: 'a', email: 'a@x' }, { uid: 'b', email: 'b@x' }]);
});
