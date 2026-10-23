// The Pick checklist's message and its room on the page (v3.27.24):
// src/domain/pick-messages.js and src/ui/stock/pick-print.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PICK_MESSAGES, PICK_MESSAGE_MAX, normalizePickMessage, pickMessageFor,
} from '../../src/domain/pick-messages.js';
import { paginatePick, quoteLines, quoteHeight, SHEET_MM, H } from '../../src/ui/stock/pick-print.js';
import { saleLines, buildPickList } from '../../src/domain/sale-match.js';

test('there are 365 messages, all different, short, one line of plain text each', () => {
  assert.equal(PICK_MESSAGES.length, 365);
  assert.equal(new Set(PICK_MESSAGES).size, 365);
  PICK_MESSAGES.forEach(m => {
    assert.ok(m.length >= 10 && m.length <= 60, `"${m}" is ${m.length} characters`);
    assert.equal(m, m.trim());
    assert.ok(!/[\n\r\t`$\\<>]/.test(m), `"${m}" has a character the sheet should not print`);
    assert.ok(quoteLines(m) <= 2, `"${m}" fits two lines`);
  });
});

test('the setting is cleaned: unknown mode is off, text trimmed and cut', () => {
  assert.deepEqual(normalizePickMessage(undefined), { mode: 'off', text: '' });
  assert.deepEqual(normalizePickMessage({ mode: 'shout', text: 'x' }), { mode: 'off', text: 'x' });
  assert.deepEqual(normalizePickMessage({ mode: 'fixed', text: '  Keep   going \n now ' }), { mode: 'fixed', text: 'Keep going now' });
  assert.equal(normalizePickMessage({ mode: 'fixed', text: 'a'.repeat(500) }).text.length, PICK_MESSAGE_MAX);
});

test('off prints nothing, fixed prints the typed text, random one of the 365', () => {
  assert.deepEqual(pickMessageFor({ mode: 'off', text: 'ignored' }), { text: '', index: -1 });
  assert.deepEqual(pickMessageFor(undefined), { text: '', index: -1 });
  assert.deepEqual(pickMessageFor({ mode: 'fixed', text: 'Hi there' }), { text: 'Hi there', index: -1 });
  assert.deepEqual(pickMessageFor({ mode: 'fixed', text: '   ' }), { text: '', index: -1 });
  const r = pickMessageFor({ mode: 'random' }, { random: () => 0.5 });
  assert.equal(r.text, PICK_MESSAGES[r.index]);
  assert.equal(r.index, Math.floor(0.5 * 365));
});

test('random can reach every message, never the edge, and never repeats the last one', () => {
  assert.equal(pickMessageFor({ mode: 'random' }, { random: () => 0 }).index, 0);
  assert.equal(pickMessageFor({ mode: 'random' }, { random: () => 0.9999999 }).index, 364);
  assert.equal(pickMessageFor({ mode: 'random' }, { random: () => 1 }).index, 364, 'a 1 from a faulty source stays in range');
  for (let last = 0; last < 365; last++){
    assert.notEqual(pickMessageFor({ mode: 'random' }, { random: () => last / 365 + 1e-9, last }).index, last);
  }
  const seen = new Set();
  for (let i = 0; i < 20000; i++) seen.add(pickMessageFor({ mode: 'random' }).index);
  assert.ok(seen.size > 360, `${seen.size} different messages in 20,000 draws`);
});

const piece = (n, name) => ({ title: name, price: '$12.00', size: 'M', sku: String(n).padStart(4, '0'), partial: false });
const list = (names) => {
  const order = { platform: 'poshmark', orderNumber: 'o-1', orderDate: '2026-10-20', buyer: '@b', total: '', fee: '', netEarnings: '', salesTax: '', items: names.map((nm, i) => piece(i + 1, nm)) };
  const { lines } = saleLines([{ source: 's', result: { isSale: true, orders: [order] } }]);
  const catalog = names.map((nm, i) => ({ id: `id${i}`, productCode: `#${String(i + 1).padStart(4, '0')}`, name: nm, status: 'catalogado', storageBox: 'A', listedPlatforms: [] }));
  return buildPickList(lines, catalog, {});
};
const LONG = 'Free People Intimately Women\'s Floral Embroidered Lace Trim Boho Maxi Dress with Adjustable Straps and Side Pockets Cream Multi';

test('the message sits on the last page, right above the signature line', () => {
  const pl = list(['Zara Top', 'Lee Shorts']);
  const pages = paginatePick(pl, (k) => k, 'Small steps every day add up to big results.');
  const last = pages[pages.length - 1];
  assert.deepEqual(last.slice(-2).map(b => b.type), ['quote', 'sign']);
  assert.equal(last.at(-2).text, 'Small steps every day add up to big results.');
  assert.equal(pages.flat().filter(b => b.type === 'quote').length, 1, 'only once');
  assert.equal(paginatePick(pl).flat().some(b => b.type === 'quote'), false, 'no message, no block');
  assert.equal(paginatePick(pl, (k) => k, '   ').flat().some(b => b.type === 'quote'), false);
});

test('a fixed message of 120 characters gets three lines and still fits', () => {
  const text = 'x'.repeat(10) + ' ' + 'word '.repeat(21).trim();
  assert.equal(quoteLines(text), 3);
  assert.ok(quoteHeight(3) > quoteHeight(2));
  const pages = paginatePick(list(['A']), (k) => k, text.slice(0, PICK_MESSAGE_MAX));
  assert.equal(pages.flat().find(b => b.type === 'quote').lines, 3);
});

test('long titles and the message: no page overflows, the message never leaves its signature line', () => {
  for (const count of [1, 5, 6, 7, 12, 40]){
    const names = Array.from({ length: count }, (_, i) => (i % 3 === 0 ? LONG : `Short name ${i}`));
    const pages = paginatePick(list(names), (k) => k, PICK_MESSAGES[count]);
    const roomFirst = SHEET_MM.height - 2 * H.pad - H.footer - H.header;
    const roomNext = SHEET_MM.height - 2 * H.pad - H.footer;
    pages.forEach((blocks, p) => {
      const used = blocks.reduce((a, b) => a + b.h, 0);
      assert.ok(used <= (p === 0 ? roomFirst : roomNext) + 1e-9, `${count} pieces, page ${p + 1}: ${used} mm`);
      const q = blocks.findIndex(b => b.type === 'quote');
      if (q >= 0) assert.equal(blocks[q + 1]?.type, 'sign', 'the signature follows the message on the same page');
    });
    assert.equal(pages.flat().filter(b => b.type === 'row').length, count);
    // the last page never starts with a lone heading
    pages.forEach(blocks => assert.ok(!(blocks.length === 1 && blocks[0].type === 'box')));
  }
});

test('with the type 15% larger the first page holds 10 plain rows, where it held 12', () => {
  const names = Array.from({ length: 20 }, (_, i) => `Plain piece ${i}`);
  const firstPage = paginatePick(list(names)).at(0).filter(b => b.type === 'row').length;
  assert.equal(firstPage, Math.floor((SHEET_MM.height - 2 * H.pad - H.footer - H.header - H.box) / H.row));
  assert.equal(firstPage, 10);
});
