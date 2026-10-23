// The label's Code 128 barcode (v3.27.24): src/domain/code128.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CODE128_WIDTHS, code128Values, code128Bits, barcodeTextOf, barcodeLayout,
  BARCODE_QUIET_IN, BARCODE_MIN_MODULE_IN,
} from '../../src/domain/code128.js';

const bitsOf = (widths) => [...widths].map((w, i) => (i % 2 ? '0' : '1').repeat(Number(w))).join('');
const STOP_BITS = '1100011101011';

// A small reader written from the spec, to check what the encoder writes:
// start B, symbols of 11 modules, the check symbol, the stop pattern.
function decode(bits){
  assert.ok(bits.endsWith(STOP_BITS), 'ends with the stop pattern');
  const body = bits.slice(0, -STOP_BITS.length);
  assert.equal(body.length % 11, 0);
  const table = new Map(CODE128_WIDTHS.map((w, v) => [bitsOf(w), v]));
  const values = [];
  for (let i = 0; i < body.length; i += 11){
    const v = table.get(body.slice(i, i + 11));
    assert.notEqual(v, undefined, `symbol at module ${i} is in the table`);
    values.push(v);
  }
  assert.equal(values[0], 104, 'starts with Start B');
  const check = values.pop();
  const sum = values.reduce((a, v, i) => a + (i ? v * i : v), 0);
  assert.equal(check, sum % 103, 'check symbol');
  return values.slice(1).map(v => String.fromCharCode(v + 32)).join('');
}

test('the symbol table is well formed', () => {
  assert.equal(CODE128_WIDTHS.length, 106);
  CODE128_WIDTHS.forEach((w, v) => {
    assert.match(w, /^[1-4]{6}$/, `symbol ${v}`);
    assert.equal([...w].reduce((a, d) => a + Number(d), 0), 11, `symbol ${v} is 11 modules`);
  });
  assert.equal(new Set(CODE128_WIDTHS).size, 106, 'no two symbols share a pattern');
  assert.equal(bitsOf(CODE128_WIDTHS[104]), '11010010000', 'Start B');
  assert.equal(bitsOf(CODE128_WIDTHS[0]), '11011001100', 'space');
});

test('0897 gets the check symbol worked out by hand', () => {
  // 104 + 16*1 + 24*2 + 25*3 + 23*4 = 335, and 335 mod 103 = 26.
  assert.deepEqual(code128Values('0897'), [104, 16, 24, 25, 23, 26]);
  const bits = code128Bits('0897');
  assert.equal(bits.length, 11 * 6 + 13);
  assert.ok(bits.startsWith('11010010000'));
  assert.ok(bits.endsWith(STOP_BITS));
});

test('every code a product can have reads back as itself', () => {
  for (const text of ['0897', '0897-1', '12', 'A-12', 'abc XYZ ~!', ' ', '9999999999']) assert.equal(decode(code128Bits(text)), text);
  // every character the set holds, one by one
  for (let c = 32; c <= 126; c++){
    const ch = String.fromCharCode(c);
    assert.equal(decode(code128Bits(ch + '7' + ch)), ch + '7' + ch);
  }
});

test('what cannot be encoded gives nothing', () => {
  assert.equal(code128Bits(''), '');
  assert.equal(code128Bits('café'), '');
  assert.equal(code128Bits('a\nb'), '');
  assert.equal(code128Values(null), null);
});

test('the barcode says the product code without the #', () => {
  assert.equal(barcodeTextOf({ productCode: '#0897' }), '0897');
  assert.equal(barcodeTextOf({ productCode: '#0897-1' }), '0897-1');
  assert.equal(barcodeTextOf({ productCode: '0897' }), '0897');
  assert.equal(barcodeTextOf({}), '');
});

test('the layout: whole-pixel bars inside the quiet zones, or none when too narrow', () => {
  const l = barcodeLayout({ productCode: '#0897' }, 2.25, 300);
  assert.equal(l.bits, code128Bits('0897'));
  assert.equal(l.modulePx, Math.floor((2.25 - 2 * BARCODE_QUIET_IN) * 300 / 79));
  assert.equal(l.widthPx, l.modulePx * 79);
  assert.ok(l.widthPx <= (2.25 - 2 * BARCODE_QUIET_IN) * 300);
  assert.ok(l.moduleIn >= BARCODE_MIN_MODULE_IN);
  // a copy's code is longer and its bars narrower, still readable
  const copy = barcodeLayout({ productCode: '#0897-1' }, 2.25, 300);
  assert.ok(copy.modulePx < l.modulePx && copy.moduleIn >= BARCODE_MIN_MODULE_IN);
  // a very long code on a small label is left off instead of printed too thin
  assert.equal(barcodeLayout({ productCode: '#ABCDEFGHIJKL' }, 2.25, 300), null);
  assert.equal(barcodeLayout({ productCode: '#0897' }, 0.9, 300), null);
  assert.equal(barcodeLayout({ productCode: '' }, 2.25, 300), null);
});
