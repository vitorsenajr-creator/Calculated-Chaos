// Stock → Pick (v3.24.2): sale screenshots → the items to pick, by box.
// Pure logic, no DOM, window, Firebase or app state. The AI reads each
// screenshot (src/modules/ai-sale-screenshot.js); this turns its answers
// into sale lines, matches each line to an item and groups them by box.
//
// Matching order: the SKU against the product code (Poshmark shows the
// code without "#", e.g. "SKU: 0897" for #0897; copies "-1", "-2" share
// the base code), then against an imported item's legacy code, then by
// the title's words (old listings without a SKU). Nothing here saves
// anything: the person checks every match.
import { parseMoney } from './import-sheet.js';
import { allocateOrder } from './pick-sale.js';

// "#0897", "0897", " 897 " → "897"; "#4578-2" → "4578-2". Other codes
// (an imported sheet's "AB-12") only lose "#", spaces and case.
export function canonCode(code){
  const s = String(code ?? '').toLowerCase().replace(/[#\s]/g, '');
  const m = s.match(/^(\d+)(-\d+)?$/);
  if (!m) return s;
  return (m[1].replace(/^0+/, '') || '0') + (m[2] || '');
}
const baseCode = (code) => canonCode(code).replace(/-\d+$/, '');

const SIZE_WORDS = { 'x-small': 'xs', xsmall: 'xs', small: 's', medium: 'm', large: 'l', 'x-large': 'xl', xlarge: 'xl', 'xx-large': 'xxl', xxlarge: 'xxl', '2xl': 'xxl', '1x': 'xl', '2x': 'xxl' };
export function canonSize(size){
  const s = String(size ?? '').toLowerCase().trim().replace(/\s+/g, '');
  return SIZE_WORDS[s] || s;
}

// Words that say nothing about which piece it is.
const STOP = new Set(['and', 'the', 'with', 'for', 'in', 'of', 'a', 'an', 'size', 'sz', 'womens', 'mens', 'women', 'men', 'ladies', 'girls', 'boys',
  'new', 'nwt', 'nwot', 'euc', 'guc', 'vintage', 'xs', 's', 'm', 'l', 'xl', 'xxl', 'small', 'medium', 'large', 'petite', 'plus']);
export function titleWords(text){
  return [...new Set(String(text ?? '').toLowerCase().replace(/['’`]/g, '').replace(/&/g, ' ')
    .split(/[^a-z0-9]+/).filter(w => w && !STOP.has(w) && (w.length > 1 || /\d/.test(w))))];
}
const sameText = (a, b) => titleWords(a).join(' ') === titleWords(b).join(' ') && titleWords(a).length > 0;

const isSold = (item) => item && item.status === 'vendido';

// "B12" → "Box B12", but a box already named "Box 2" stays "Box 2".
export function boxTitle(name){
  const n = String(name || '').trim();
  if (!n) return 'No box';
  return /^box\b/i.test(n) ? n : `Box ${n}`;
}

// The AI's answers → one line per sold piece. `results` is a list of
// { source, result } (source = the screenshot's id). The same order line
// read from two screenshots counts once: the later ones come back in
// `skipped`, each with `firstSource`, the screenshot that had it first.
// `platforms` (order ref → platform key) is the person's own choice for an
// order whose platform the AI couldn't tell. Returns { lines, skipped }.
// Each line also carries its order's real money (v3.27.1): the pricing
// section's total, fee, sales tax and net earnings (null when the section
// was closed in the screenshot), and what this piece really sold for, its
// share of the fee and of the tax (`paid`, `paidFee`, `paidTax`, see
// allocateOrder). The same order read from two screenshots shares the
// money of whichever one showed it.
const moneyOf = (v) => { const n = parseMoney(v); return Number.isFinite(n) ? Math.abs(n) : null; };
export function saleLines(results, platforms = {}){
  const lines = [];
  const skipped = [];
  const seen = new Map();
  const moneyByOrder = new Map();
  (results || []).forEach(({ result }) => {
    ((result && result.orders) || []).forEach(order => {
      const n = String(order.orderNumber || '').trim();
      if (!n) return;
      const cur = moneyByOrder.get(n) || { total: null, fee: null, net: null, tax: null };
      const read = { total: moneyOf(order.total), fee: moneyOf(order.fee), net: moneyOf(order.netEarnings), tax: moneyOf(order.salesTax) };
      Object.keys(cur).forEach(k => { if (cur[k] === null) cur[k] = read[k]; });
      moneyByOrder.set(n, cur);
    });
  });
  (results || []).forEach(({ source, result }) => {
    ((result && result.orders) || []).forEach((order, oi) => {
      (order.items || []).forEach((it, i) => {
        const sku = String(it.sku || '').trim();
        const title = String(it.title || '').replace(/\s+/g, ' ').trim();
        if (!sku && !title) return;
        const orderNumber = String(order.orderNumber || '').trim();
        const orderRef = orderNumber || `${source}#${oi}`;
        const piece = sku ? `sku:${canonCode(sku)}` : `t:${titleWords(title).join(' ')}|${it.price || ''}`;
        const key = `${orderNumber || `${source}#${oi}.${i}`}|${piece}`;
        const read = order.platform && order.platform !== 'unknown' ? order.platform : null;
        const price = parseMoney(it.price);
        const own = { total: moneyOf(order.total), fee: moneyOf(order.fee), net: moneyOf(order.netEarnings), tax: moneyOf(order.salesTax) };
        const money = (orderNumber && moneyByOrder.get(orderNumber)) || own;
        const line = {
          key, source, orderRef, sku, title,
          platform: platforms[orderRef] || read,
          platformRead: read,
          orderNumber, orderDate: String(order.orderDate || ''), buyer: String(order.buyer || ''),
          priceText: String(it.price || ''), price: Number.isFinite(price) ? price : null,
          size: String(it.size || ''), partial: !!it.partial,
          orderTotal: money.total, orderFee: money.fee, orderNet: money.net, orderTax: money.tax,
          paid: null, paidFee: null, paidTax: null, bundleNote: '', bundleWarn: '',
        };
        if (seen.has(key)){ skipped.push({ ...line, firstSource: seen.get(key) }); return; }
        seen.set(key, source);
        lines.push(line);
      });
    });
  });
  const byOrder = new Map();
  lines.forEach(l => { if (!byOrder.has(l.orderRef)) byOrder.set(l.orderRef, []); byOrder.get(l.orderRef).push(l); });
  byOrder.forEach(group => {
    const shares = allocateOrder(group);
    group.forEach(l => {
      const a = shares.get(l.key);
      l.paid = a.paid; l.paidFee = a.paidFee; l.paidTax = a.paidTax; l.bundleNote = a.note; l.bundleWarn = a.warn;
    });
  });
  return { lines, skipped };
}

// What kind of garment a title talks about (v3.27.6). A skirt never matches a
// dress, whatever else the two titles share (a brand, a price).
const TYPE_OF = {};
[
  ['skirt', 'skirt skirts skort skorts'],
  ['dress', 'dress dresses gown gowns sundress'],
  ['top', 'top tops tee tees shirt shirts blouse blouses tank tanks cami camisole bustier bodysuit tunic polo henley sweater sweaters pullover cardigan cardigans sweatshirt hoodie jumper'],
  ['outer', 'jacket jackets coat coats blazer blazers vest vests puffer parka trench windbreaker bomber anorak'],
  ['pants', 'pants pant jeans jean trousers leggings joggers sweatpants slacks chinos culottes'],
  ['shorts', 'shorts'],
  ['jumpsuit', 'jumpsuit romper overalls playsuit'],
  ['shoes', 'shoes boots sneakers sandals heels flats loafers'],
  ['bag', 'bag bags purse handbag tote backpack wallet'],
].forEach(([type, words]) => words.split(' ').forEach(w => { TYPE_OF[w] = type; }));
const typesOf = (words) => new Set(words.map(w => TYPE_OF[w]).filter(Boolean));
const sharesType = (a, b) => [...a].some(t => b.has(t));

// "Size S" written in the item's name, for the items whose size field is empty.
const SIZE_IN_TEXT = /\b(?:size|sz)[:\s]+(xxs|xs|xxxl|xxl|xl|s|m|l|\d{1,2}[a-z]?|[23]x)\b/i;
function sizeOfItem(item){
  const own = canonSize(item.size);
  if (own) return own;
  const m = SIZE_IN_TEXT.exec(`${item.name || ''} ${item.listingTitle || ''}`);
  return m ? canonSize(m[1]) : '';
}

// An item ready to be compared with many lines: its words, brand, size,
// price and garment types, split once.
function prepareOne(i){
  const listing = i.listingTitle ? titleWords(i.listingTitle) : [];
  const haveWords = titleWords([i.name, i.listingTitle, i.brand, i.color, i.clothingType, i.category].join(' '));
  return {
    item: i,
    sold: isSold(i),
    have: new Set(haveWords),
    types: typesOf(haveWords),
    brand: titleWords(i.brand),
    size: sizeOfItem(i),
    listPrice: parseMoney(i.listPrice),
    listingKey: listing.length ? listing.join(' ') : null,
  };
}

export const NAME_MIN_SCORE = 0.45;
// Below this a piece isn't even offered as a suggestion.
export const SUGGEST_MIN_SCORE = 0.25;

// How well an item fits a line's title, size and price (a prepared item, see
// prepareOne). { score 0..1, ok, conflict }: `ok` = good enough to be the
// piece: the score reaches NAME_MIN_SCORE, at least one word besides the brand
// is shared (a brand and a price alone are a coincidence), and the two are
// not different kinds of garment. `conflict` = different kinds of garment.
function fitPrepared(words, wordsKey, lineSize, lineTypes, line, p){
  if (p.listingKey !== null && p.listingKey === wordsKey) return { score: 1, ok: true, conflict: false };
  const brandSet = new Set(p.brand);
  const shared = words.filter(w => p.have.has(w));
  const sharedBeyondBrand = shared.filter(w => !brandSet.has(w)).length;
  let score = shared.length / words.length;
  if (p.brand.length && p.brand.every(w => words.includes(w))) score += 0.15;
  if (lineSize && p.size) score += lineSize === p.size ? 0.1 : -0.25;
  if (line.price !== null && Number.isFinite(p.listPrice) && Math.abs(p.listPrice - line.price) < 0.005) score += 0.1;
  const conflict = lineTypes.size > 0 && p.types.size > 0 && !sharesType(lineTypes, p.types);
  if (conflict) score -= 0.5;
  score = Math.max(0, Math.min(1, score));
  return { score, ok: !conflict && sharedBeyondBrand >= 1 && score >= NAME_MIN_SCORE, conflict };
}

// The same for one plain item (the reference the index is tested against).
export function nameFit(line, item){
  const words = titleWords(line.title);
  if (!words.length) return { score: 0, ok: false, conflict: false };
  return fitPrepared(words, words.join(' '), canonSize(line.size), typesOf(words), line, prepareOne(item));
}
export const nameScore = (line, item) => nameFit(line, item).score;

// A lookup built once for a catalog (v3.27.4). Matching a line used to walk
// every item, and to split each item's words again for every line, so a pick
// list of a few dozen lines on a catalog of 1,500 items took seconds on a
// phone. Here the codes sit in maps and each item's words are ready; the
// answers are the same (tests/domain/sale-match-index.test.mjs). Since v3.27.6
// the name matching also looks at sold items, so a piece already sold is found
// and shown as sold.
export function prepareItems(items){
  const byCode = new Map();
  const byBase = new Map();
  const byLegacy = new Map();
  const add = (map, key, item) => {
    const list = map.get(key);
    if (list) list.push(item); else map.set(key, [item]);
  };
  const named = [];
  (items || []).forEach(i => {
    if (i.productCode){
      add(byCode, canonCode(i.productCode), i);
      add(byBase, baseCode(i.productCode), i);
    }
    if (i.legacyCode) add(byLegacy, canonCode(i.legacyCode), i);
    named.push(prepareOne(i));
  });
  return { byCode, byBase, byLegacy, named };
}

// The item a line belongs to. Returns { item, how: 'sku'|'legacy'|'name'|null,
// confidence: 'exact'|'high'|'medium'|'low'|null, score, copies, alternatives,
// suggestions, skuNotFound }. An unsold item always wins over a sold one with
// the same code; by name, an unsold one wins over a sold one that fits at most
// 0.1 better. With no item that fits, `suggestions` holds up to three pieces
// that come close (never a different kind of garment), for the person to
// compare and pick. `index` is prepareItems(items); pass it when matching many
// lines.
export function matchSaleLine(line, items, index){
  const idx = index || prepareItems(items);
  const none = { item: null, how: null, confidence: null, score: 0, copies: 0, pool: [], alternatives: [], suggestions: [], skuNotFound: false };
  const sku = canonCode(line.sku);
  if (sku){
    const exact = idx.byCode.get(sku) || [];
    const hits = exact.length ? exact : (idx.byBase.get(sku) || []);
    if (hits.length){
      const open = hits.filter(i => !isSold(i)).sort((x, y) => String(x.productCode).localeCompare(String(y.productCode), undefined, { numeric: true }));
      return { ...none, item: open[0] || hits[0], how: 'sku', confidence: 'exact', score: 1, copies: open.length, pool: open };
    }
    const legacy = idx.byLegacy.get(sku) || [];
    if (legacy.length){
      const open = legacy.filter(i => !isSold(i));
      return { ...none, item: open[0] || legacy[0], how: 'legacy', confidence: 'exact', score: 1, copies: open.length, pool: open };
    }
  }
  const words = titleWords(line.title);
  const wordsKey = words.join(' ');
  const lineSize = canonSize(line.size);
  const lineTypes = typesOf(words);
  const fits = (words.length ? idx.named : [])
    .map(p => ({ item: p.item, sold: p.sold, ...fitPrepared(words, wordsKey, lineSize, lineTypes, line, p) }));
  const ranked = fits.filter(r => r.ok).sort((x, y) => y.score - x.score);
  if (!ranked.length){
    const suggestions = fits.filter(r => !r.conflict && r.score >= SUGGEST_MIN_SCORE)
      .sort((x, y) => y.score - x.score).slice(0, 3)
      .map(r => ({ item: r.item, score: r.score }));
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

// The pick list: every line with its match (or the person's own pick from
// `chosen`, line key → item id), grouped by box in box order, plus the
// lines with no item. Two sales of one code take different copies while
// there are unsold ones left; two lines left on one item are flagged
// (sold twice).
// A line already recorded as sold from Pick (v3.24.4) stays on the item it
// was recorded on, whatever matching would say now.
export function buildPickList(lines, items, chosen = {}){
  const byId = new Map((items || []).map(i => [i.id, i]));
  const index = prepareItems(items);
  // Package numbers (v3.27.2): one per order, in the order the orders first
  // appear in the lines (screenshot order), so adding screenshots later keeps
  // the numbers already printed. A typed code is its own order.
  const refOf = (l) => l.orderRef || l.key;
  const packages = [];
  const packNo = new Map();
  (lines || []).forEach(l => {
    const ref = refOf(l);
    if (!packNo.has(ref)){
      packNo.set(ref, packages.length + 1);
      packages.push({ n: packages.length + 1, orderRef: ref, buyer: '', orderNumber: '', pieces: 0 });
    }
    const pack = packages[packNo.get(ref) - 1];
    pack.pieces += 1;
    if (!pack.buyer && l.buyer) pack.buyer = l.buyer;
    if (!pack.orderNumber && l.orderNumber) pack.orderNumber = l.orderNumber;
  });
  const recordedBy = new Map((items || []).filter(i => i.saleLineKey).map(i => [i.saleLineKey, i]));
  const used = new Set();
  const rows = (lines || []).map(original => {
    let line = original;
    let match = matchSaleLine(line, items, index);
    const pickedId = chosen[line.key];
    const rec = recordedBy.get(line.key);
    if (rec){
      match = { ...match, item: rec, how: match.item && match.item.id === rec.id ? match.how : 'manual', confidence: 'exact', score: 1 };
    } else if (pickedId && byId.has(pickedId) && (!match.item || match.item.id !== pickedId)){
      match = { ...match, item: byId.get(pickedId), how: 'manual', confidence: 'exact', score: 1 };
    } else if (match.item && used.has(match.item.id)){
      const free = match.pool.find(i => !used.has(i.id));
      if (free) match = { ...match, item: free };
    }
    if (match.item) used.add(match.item.id);
    const item = match.item;
    const recorded = !!rec;
    // A recorded piece shows the platform it was recorded with.
    if (recorded && !line.platform && item.soldPlatform) line = { ...line, platform: item.soldPlatform };
    // With the platform unknown, every platform it's listed on is shown,
    // never "delist it there" for the one it may have sold on. A piece
    // recorded here still lists where to delist it.
    const soldOn = recorded ? item.soldPlatform : line.platform;
    const listedElsewhere = item && (!isSold(item) || recorded)
      ? (item.listedPlatforms || []).filter(p => p !== soldOn && !(p === 'ebay' && item.ebayEndedAt))
      : [];
    return { line, match, item, recorded, alreadySold: isSold(item) && !recorded, listedElsewhere, platformUnknown: !soldOn, soldTwice: false, pack: packNo.get(refOf(line)) };
  });
  const perItem = new Map();
  rows.forEach(r => { if (r.item) perItem.set(r.item.id, (perItem.get(r.item.id) || 0) + 1); });
  rows.forEach(r => { if (r.item && perItem.get(r.item.id) > 1) r.soldTwice = true; });

  const groups = new Map();
  rows.filter(r => r.item).forEach(r => {
    const box = String(r.item.storageBox || '').trim();
    if (!groups.has(box)) groups.set(box, []);
    groups.get(box).push(r);
  });
  const boxes = [...groups.entries()]
    .sort(([a], [b]) => (!a) - (!b) || a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    .map(([box, list]) => ({
      box,
      rows: list.sort((x, y) => String(x.item.productCode || '').localeCompare(String(y.item.productCode || ''), undefined, { numeric: true })),
    }));
  const unmatched = rows.filter(r => !r.item);
  const orders = new Set((lines || []).map(l => l.orderNumber || l.key));
  // matchLine: the same matching for one more line (the skipped repeats), on
  // the index already built.
  const matchLine = (line) => matchSaleLine(line, items, index);
  return { boxes, unmatched, packages, total: rows.length, matched: rows.length - unmatched.length, orders: orders.size, matchLine };
}
