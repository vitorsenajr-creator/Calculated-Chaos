// The prepared index of src/domain/sale-match.js (v3.27.4) must give exactly
// the answers of the matching it replaced. The old matchSaleLine is kept here
// as the reference and compared with the new one on random catalogs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonCode, nameFit, SUGGEST_MIN_SCORE, matchSaleLine, prepareItems, saleLines, buildPickList } from '../../src/domain/sale-match.js';

const baseCode = (code) => canonCode(code).replace(/-\d+$/, '');
const isSold = (item) => item && item.status === 'vendido';

// The matching without the index (the rules of v3.27.6): every line walks
// every item, sold ones included, scoring each with nameFit().
function referenceMatch(line, items){
  const list = items || [];
  const none = { item: null, how: null, confidence: null, score: 0, copies: 0, pool: [], alternatives: [], suggestions: [], skuNotFound: false };
  const sku = canonCode(line.sku);
  if (sku){
    const exact = list.filter(i => i.productCode && canonCode(i.productCode) === sku);
    const hits = exact.length ? exact : list.filter(i => i.productCode && baseCode(i.productCode) === sku);
    if (hits.length){
      const open = hits.filter(i => !isSold(i)).sort((x, y) => String(x.productCode).localeCompare(String(y.productCode), undefined, { numeric: true }));
      return { ...none, item: open[0] || hits[0], how: 'sku', confidence: 'exact', score: 1, copies: open.length, pool: open };
    }
    const legacy = list.filter(i => i.legacyCode && canonCode(i.legacyCode) === sku);
    if (legacy.length){
      const open = legacy.filter(i => !isSold(i));
      return { ...none, item: open[0] || legacy[0], how: 'legacy', confidence: 'exact', score: 1, copies: open.length, pool: open };
    }
  }
  const fits = list.map(item => ({ item, sold: isSold(item), ...nameFit(line, item) }));
  const ranked = fits.filter(r => r.ok).sort((x, y) => y.score - x.score);
  if (!ranked.length){
    const suggestions = fits.filter(r => !r.conflict && r.score >= SUGGEST_MIN_SCORE)
      .sort((x, y) => y.score - x.score).slice(0, 3).map(r => ({ item: r.item, score: r.score }));
    return { ...none, suggestions, skuNotFound: !!sku };
  }
  if (ranked[0].sold){
    const k = ranked.findIndex(r => !r.sold && ranked[0].score - r.score <= 0.1);
    if (k > 0) ranked.unshift(...ranked.splice(k, 1));
  }
  const [top, next] = ranked;
  const clear = !next || top.score - next.score >= 0.15;
  const confidence = top.score >= 0.8 && clear ? 'high' : top.score >= 0.6 && clear ? 'medium' : 'low';
  return {
    ...none, item: top.item, how: 'name', confidence, score: top.score, copies: 1,
    alternatives: ranked.slice(1, 4).map(r => ({ item: r.item, score: r.score })),
    skuNotFound: !!sku,
  };
}

// A small seeded generator, so a failure can be repeated.
function rng(seed){
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

const WORDS = ['jacket', 'dress', 'zara', 'love', 'tree', 'bodysuit', 'pink', 'mesh', 'sheer', 'denim', 'wool', 'coat', 'silk', 'top', 'skirt', 'jeans', 'boho', 'lace', 'knit', 'cardigan', 'nike', 'adidas', 'levis', 'black', 'blue'];
const BRANDS = ['Zara', 'Love Tree', 'Nike', 'Adidas', "Levi's", 'John + Jenn', ''];
const SIZES = ['S', 'M', 'L', 'XL', 'Small', 'Medium', '2X', 'X-Large', ' m ', ''];
const phrase = (r, n) => Array.from({ length: n }, () => pick(r, WORDS)).join(' ');

function makeItems(r, count){
  return Array.from({ length: count }, (_, i) => {
    const code = pick(r, [`#${String(i + 1).padStart(4, '0')}`, `${i + 1}`, `#${i + 1}-${1 + Math.floor(r() * 3)}`, `AB-${i}`, '', undefined]);
    const name = phrase(r, 2 + Math.floor(r() * 4));
    return {
      id: `it${i}`,
      productCode: code,
      legacyCode: r() < 0.15 ? pick(r, [`T-${i}`, `${i + 7}`, `#00${i}`]) : undefined,
      name,
      listingTitle: r() < 0.3 ? name : (r() < 0.3 ? phrase(r, 3) : undefined),
      brand: pick(r, BRANDS),
      color: r() < 0.5 ? pick(r, WORDS) : undefined,
      clothingType: r() < 0.4 ? pick(r, WORDS) : undefined,
      category: r() < 0.4 ? pick(r, WORDS) : undefined,
      size: pick(r, SIZES),
      listPrice: pick(r, ['25.00', 25, '$30', 12.5, undefined, 'x']),
      status: r() < 0.25 ? 'vendido' : 'catalogado',
    };
  });
}

function makeLines(r, items, count){
  return Array.from({ length: count }, () => {
    const it = pick(r, items);
    const kind = r();
    let sku = '';
    if (kind < 0.35) sku = pick(r, [it.productCode, String(it.productCode || '').replace('#', ''), String(parseInt(String(it.productCode || '0').replace(/\D/g, '') || '0', 10)), `${it.productCode || '1'}-2`]);
    else if (kind < 0.45) sku = it.legacyCode || 'NOPE-1';
    else if (kind < 0.5) sku = '99999';
    const title = kind < 0.35 ? '' : (r() < 0.5 ? it.name : `${phrase(r, 2)} ${it.name.split(' ')[0]}`);
    return {
      sku, title,
      size: pick(r, SIZES),
      price: pick(r, [null, 25, 30, 12.5, 18, undefined]),
    };
  });
}

// Items by id, so two results compare without comparing whole objects.
const plain = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && 'id' in x && 'status' in x ? `item:${x.id}` : x));

test('the index gives the answers of the matching it replaced, on random catalogs', () => {
  let compared = 0, byName = 0, bySku = 0, none = 0;
  for (const seed of [1, 2, 3, 4, 5]){
    const r = rng(seed);
    const items = makeItems(r, 400);
    const lines = makeLines(r, items, 300);
    const index = prepareItems(items);
    for (const line of lines){
      const expected = referenceMatch(line, items);
      const got = matchSaleLine(line, items, index);
      assert.equal(plain(got), plain(expected), `seed ${seed}, line ${JSON.stringify(line)}`);
      // Without an index it builds its own and still agrees.
      if (compared % 17 === 0) assert.equal(plain(matchSaleLine(line, items)), plain(expected));
      compared++;
      if (expected.how === 'name') byName++; else if (expected.how) bySku++; else none++;
    }
  }
  // The random data really exercises every path.
  assert.ok(byName > 100 && bySku > 100 && none > 20, `paths covered: name ${byName}, code ${bySku}, none ${none}`);
});

test('an empty or missing catalog matches nothing', () => {
  const line = { sku: '0897', title: 'Zara dress', size: 'M', price: 20 };
  assert.equal(plain(matchSaleLine(line, [])), plain(referenceMatch(line, [])));
  assert.equal(plain(matchSaleLine(line, undefined)), plain(referenceMatch(line, undefined)));
  assert.equal(matchSaleLine(line, []).item, null);
});

test('a title of only filler words matches no item by name', () => {
  const items = [{ id: 'a', name: 'vintage new nwt', status: 'catalogado', size: 'M' }];
  const line = { sku: '', title: 'Vintage NWT size M', size: 'M', price: null };
  assert.equal(plain(matchSaleLine(line, items)), plain(referenceMatch(line, items)));
});

test('buildPickList matches every line the same as matching them one by one', () => {
  const r = rng(42);
  const items = makeItems(r, 300);
  const shots = [0, 1, 2].map(o => ({
    source: `s${o}`,
    result: { isSale: true, orders: [{ platform: 'poshmark', orderNumber: `ORD${o}`, buyer: `b${o}`, items: makeLines(r, items, 6).map((l, k) => ({ title: l.title || `piece ${o}-${k}`, sku: l.sku, price: l.price === null || l.price === undefined ? '' : `$${l.price}`, size: l.size })) }] },
  }));
  const { lines, skipped } = saleLines(shots, {});
  const pl = buildPickList(lines, items, {});
  assert.equal(pl.total, lines.length);
  // The matcher it hands back is the same one, on the same index.
  for (const l of [...lines, ...skipped]) assert.equal(plain(pl.matchLine(l)), plain(referenceMatch(l, items)));
});
