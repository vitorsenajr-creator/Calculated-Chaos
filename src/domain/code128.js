// Code 128 (set B) for the item label's barcode (v3.27.24). Pure: text in,
// a string of bars ("1") and spaces ("0") out; the label drawing lives in
// ui/label-render.js. Set B covers every character a product code uses
// (digits, "-", letters), so one table is enough.

import { codeHasMultiple } from './item-issues.js';

// Bar/space widths of each symbol, bar first, six digits that add up to 11
// modules. Index = symbol value; 103-105 are Start A/B/C. The stop pattern
// has seven widths (13 modules).
const WIDTHS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232',
];
const STOP = '2331112';
const START_B = 104;

function barsOf(widths){
  let out = '';
  for (let i = 0; i < widths.length; i++) out += (i % 2 === 0 ? '1' : '0').repeat(Number(widths[i]));
  return out;
}

export const CODE128_WIDTHS = WIDTHS;

// Symbol values for the text (start B, one per character, check symbol), or
// null when the text is empty or has a character outside ASCII 32-126.
export function code128Values(text){
  const s = String(text ?? '');
  if (!s.length) return null;
  const values = [START_B];
  for (const ch of s){
    const c = ch.charCodeAt(0);
    if (c < 32 || c > 126) return null;
    values.push(c - 32);
  }
  let sum = values[0];
  for (let i = 1; i < values.length; i++) sum += values[i] * i;
  values.push(sum % 103);
  return values;
}

// The bars and spaces, one character per module, or '' when it can't be encoded.
export function code128Bits(text){
  const values = code128Values(text);
  if (!values) return '';
  return values.map(v => barsOf(WIDTHS[v])).join('') + barsOf(STOP);
}

// What the label's barcode says: the product code without the "#", the same
// number a Pick screenshot shows as the SKU. '' when the item has no code.
// Nothing when the field holds more than one code (v3.27.26): a barcode of
// "1475 , #1473" would be read as one code and match no item.
export function barcodeTextOf(item){
  const code = String(item?.productCode ?? '').replace(/^#/, '').trim();
  return codeHasMultiple(code) ? '' : code;
}

// Quiet zone (white space each side) and the narrowest bar worth printing
// (0.012 in is about 2.4 dots at 203 dpi). Narrower than that and the
// barcode is left off instead of printing something a scanner can't read.
export const BARCODE_QUIET_IN = 0.2;
export const BARCODE_MIN_MODULE_IN = 0.012;
export const BARCODE_HEIGHT_IN = 0.16;

// The barcode for an item on a label `widthIn` wide, drawn at `dpi`: its
// bits and a bar width that is a whole number of pixels, so every bar prints
// with the same width. null when there is no code or it would be too narrow.
export function barcodeLayout(item, widthIn, dpi = 300){
  const bits = code128Bits(barcodeTextOf(item));
  if (!bits) return null;
  const modulePx = Math.floor((widthIn - 2 * BARCODE_QUIET_IN) * dpi / bits.length);
  if (modulePx / dpi < BARCODE_MIN_MODULE_IN) return null;
  return { bits, modulePx, widthPx: modulePx * bits.length, moduleIn: modulePx / dpi, widthIn: modulePx * bits.length / dpi };
}
