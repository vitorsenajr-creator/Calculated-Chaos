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
export function saleLines(results, platforms = {}){
  const lines = [];
  const skipped = [];
  const seen = new Map();
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
        const line = {
          key, source, orderRef, sku, title,
          platform: platforms[orderRef] || read,
          platformRead: read,
          orderNumber, orderDate: String(order.orderDate || ''), buyer: String(order.buyer || ''),
          priceText: String(it.price || ''), price: Number.isFinite(price) ? price : null,
          size: String(it.size || ''), partial: !!it.partial,
        };
        if (seen.has(key)){ skipped.push({ ...line, firstSource: seen.get(key) }); return; }
        seen.set(key, source);
        lines.push(line);
      });
    });
  });
  return { lines, skipped };
}

// How well an unsold item fits a line's title, size and price: 0..1.
export function nameScore(line, item){
  const words = titleWords(line.title);
  if (!words.length) return 0;
  if (item.listingTitle && sameText(item.listingTitle, line.title)) return 1;
  const have = new Set(titleWords([item.name, item.listingTitle, item.brand, item.color, item.clothingType, item.category].join(' ')));
  let score = words.filter(w => have.has(w)).length / words.length;
  const brand = titleWords(item.brand);
  if (brand.length && brand.every(w => words.includes(w))) score += 0.15;
  const a = canonSize(line.size), b = canonSize(item.size);
  if (a && b) score += a === b ? 0.1 : -0.25;
  const listPrice = parseMoney(item.listPrice);
  if (line.price !== null && Number.isFinite(listPrice) && Math.abs(listPrice - line.price) < 0.005) score += 0.1;
  return Math.max(0, Math.min(1, score));
}

export const NAME_MIN_SCORE = 0.45;

// The item a line belongs to. Returns { item, how: 'sku'|'legacy'|'name'|null,
// confidence: 'exact'|'high'|'medium'|'low'|null, score, copies, alternatives,
// skuNotFound }. An unsold item always wins over a sold one with the same code.
export function matchSaleLine(line, items){
  const list = items || [];
  const none = { item: null, how: null, confidence: null, score: 0, copies: 0, pool: [], alternatives: [], skuNotFound: false };
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
  const ranked = list.filter(i => !isSold(i))
    .map(item => ({ item, score: nameScore(line, item) }))
    .filter(r => r.score >= NAME_MIN_SCORE)
    .sort((x, y) => y.score - x.score);
  if (!ranked.length) return { ...none, skuNotFound: !!sku };
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
  const recordedBy = new Map((items || []).filter(i => i.saleLineKey).map(i => [i.saleLineKey, i]));
  const used = new Set();
  const rows = (lines || []).map(original => {
    let line = original;
    let match = matchSaleLine(line, items);
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
    return { line, match, item, recorded, alreadySold: isSold(item) && !recorded, listedElsewhere, platformUnknown: !soldOn, soldTwice: false };
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
  return { boxes, unmatched, total: rows.length, matched: rows.length - unmatched.length, orders: orders.size };
}
