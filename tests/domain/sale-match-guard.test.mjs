// Name matching must not pair a sale with a different kind of piece, must find
// a piece that is already sold, and offers suggestions when nothing fits
// (v3.27.6, after a Love Tree skirt was matched to a Love Tree dress).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchSaleLine, nameFit, buildPickList } from '../../src/domain/sale-match.js';

const line = { key: 'k1', sku: '', title: 'Love Tree Olive Corduroy Mini Skirt with Frayed Hem', size: 'XL', price: 13 };
const dress = { id: 'd', productCode: '#0919', name: "Love Tree Dress Size S Green Women's", brand: 'Love Tree', size: '', listPrice: '13.00', status: 'catalogado', storageBox: 'Box 2' };
const skirt = { id: 's', productCode: '#1209', name: 'Love Tree Olive Green XL', brand: 'Love Tree', size: 'XL', listPrice: '13.00', status: 'vendido', storageBox: 'Box 16' };

test('a skirt is never matched to a dress, even with the brand and price in common', () => {
  const m = matchSaleLine(line, [dress]);
  assert.equal(m.item, null);
  assert.deepEqual(m.suggestions, []);
  assert.equal(nameFit(line, dress).conflict, true);
});

test('the sold skirt is found and handed back as the item (shown as sold)', () => {
  const m = matchSaleLine(line, [dress, skirt]);
  assert.equal(m.item.id, 's');
  assert.equal(m.how, 'name');
  const pl = buildPickList([line], [dress, skirt]);
  assert.equal(pl.unmatched.length, 0);
  assert.equal(pl.boxes[0].rows[0].alreadySold, true);
});

test('a brand and a price alone are not a match, but the piece is suggested', () => {
  const vague = { id: 'v', productCode: '#0500', name: 'Love Tree Cute Piece', brand: 'Love Tree', listPrice: '13.00', status: 'catalogado' };
  const l = { key: 'k2', sku: '', title: 'Love Tree Olive Skirt', size: '', price: 13 };
  const m = matchSaleLine(l, [vague]);
  assert.equal(m.item, null);
  assert.equal(m.suggestions[0].item.id, 'v');
  const pl = buildPickList([l], [vague]);
  assert.equal(pl.unmatched.length, 1);
  assert.equal(pl.unmatched[0].match.suggestions[0].item.id, 'v');
});

test('a piece that shares more than the brand but not the size is suggested, not matched', () => {
  const close = { id: 'c', productCode: '#0600', name: 'Love Tree Olive Green', brand: 'Love Tree', size: 'M', status: 'catalogado' };
  const m = matchSaleLine(line, [close]);
  assert.equal(m.item, null);
  assert.equal(m.suggestions[0].item.id, 'c');
});

test('the size written in the name counts when the size field is empty', () => {
  const l = { key: 'k3', sku: '', title: 'Love Tree Green Dress', size: 'XL', price: null };
  const inName = nameFit(l, { ...dress, listPrice: '' }).score;
  const noSize = nameFit(l, { ...dress, listPrice: '', name: "Love Tree Dress Green Women's" }).score;
  assert.ok(inName < noSize, `${inName} should be lower than ${noSize}`);
});

test('an unsold copy wins over a sold one that fits about as well; a sold one is found when alone', () => {
  const sold = { id: 'a', productCode: '#1', name: 'Zara Mesh Top', brand: 'Zara', size: 'M', status: 'vendido', listPrice: '20' };
  const open = { id: 'b', productCode: '#2', name: 'Zara Mesh Top', brand: 'Zara', size: 'M', status: 'catalogado', listPrice: '25' };
  const l = { key: 'k4', sku: '', title: 'Zara Mesh Top', size: 'M', price: 20 };
  assert.equal(matchSaleLine(l, [sold, open]).item.id, 'b');
  assert.equal(matchSaleLine(l, [sold]).item.id, 'a');
});
