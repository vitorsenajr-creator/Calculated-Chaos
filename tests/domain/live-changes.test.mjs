// What another device changed, applied to the list in memory
// (src/domain/live-changes.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyChanges } from '../../src/domain/live-changes.js';

const list = () => [
  { id: 'a', name: 'Alpha', price: 10 },
  { id: 'b', name: 'Beta', price: 20 },
  { id: 'c', name: 'Gamma', price: 30 },
];

test('a new document goes at the end and counts as added', () => {
  const r = applyChanges(list(), [{ type: 'added', id: 'd', data: { id: 'd', name: 'Delta' } }]);
  assert.deepEqual(r.list.map(i => i.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual([r.added, r.modified, r.removed], [1, 0, 0]);
});

test('a modified document is replaced where it stood', () => {
  const r = applyChanges(list(), [{ type: 'modified', id: 'b', data: { id: 'b', name: 'Beta', price: 25 } }]);
  assert.deepEqual(r.list.map(i => i.id), ['a', 'b', 'c']);
  assert.equal(r.list[1].price, 25);
  assert.deepEqual([r.added, r.modified, r.removed], [0, 1, 0]);
});

test('a removed document leaves, and an unknown one changes nothing', () => {
  const r = applyChanges(list(), [{ type: 'removed', id: 'a', data: null }, { type: 'removed', id: 'zzz', data: null }]);
  assert.deepEqual(r.list.map(i => i.id), ['b', 'c']);
  assert.deepEqual([r.added, r.modified, r.removed], [0, 0, 1]);
  assert.deepEqual(r.removedIds, ['a']);
});

test('the list passed in is left as it was', () => {
  const before = list();
  const copy = JSON.stringify(before);
  applyChanges(before, [
    { type: 'modified', id: 'a', data: { id: 'a', name: 'Changed' } },
    { type: 'removed', id: 'c', data: null },
    { type: 'added', id: 'x', data: { id: 'x' } },
  ]);
  assert.equal(JSON.stringify(before), copy);
});

test('an "added" for an item already there (a reconnect) is a modification', () => {
  const r = applyChanges(list(), [{ type: 'added', id: 'a', data: { id: 'a', name: 'Alpha again' } }]);
  assert.equal(r.list.length, 3);
  assert.equal(r.list[0].name, 'Alpha again');
  assert.deepEqual([r.added, r.modified], [0, 1]);
});

test('changes apply in order, so a document added then removed is gone', () => {
  const r = applyChanges(list(), [
    { type: 'added', id: 'n', data: { id: 'n' } },
    { type: 'modified', id: 'n', data: { id: 'n', name: 'N2' } },
    { type: 'removed', id: 'n', data: null },
  ]);
  assert.deepEqual(r.list.map(i => i.id), ['a', 'b', 'c']);
  assert.deepEqual([r.added, r.modified, r.removed], [1, 1, 1]);
});

test('the normalize hook runs on every stored document, and the id falls back to the document id', () => {
  const norm = (d) => (!d.listingTitle && d.poshmarkTitle ? { ...d, listingTitle: d.poshmarkTitle } : d);
  const r = applyChanges([], [
    { type: 'added', id: 'p', data: { poshmarkTitle: 'Old name' } },
    { type: 'added', id: 'q', data: { id: 'q', listingTitle: 'New name', poshmarkTitle: 'Old' } },
  ], norm);
  assert.equal(r.list[0].id, 'p');
  assert.equal(r.list[0].listingTitle, 'Old name');
  assert.equal(r.list[1].listingTitle, 'New name');
});

test('no changes, or no list, is fine', () => {
  assert.deepEqual(applyChanges(list(), []).list.map(i => i.id), ['a', 'b', 'c']);
  assert.deepEqual(applyChanges(undefined, undefined).list, []);
  assert.deepEqual(applyChanges([], [{ type: 'added', id: 'e', data: null }]).list, []);
});
