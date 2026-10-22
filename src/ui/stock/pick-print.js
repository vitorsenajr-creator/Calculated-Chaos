// Stock → Pick: the checklist's pages (v3.24.3, shared as PNG pages since
// v3.25.2). One or more 100 × 210 mm labels (the shipping-label stock), a box
// to tick by hand per piece, grouped by box in the screen's order. This file
// holds the layout rules (page breaks from fixed heights in millimeters) and
// the text of each row; pick-sheet-canvas.js draws the pages.
import { boxTitle } from '../../domain/sale-match.js';

export const SHEET_MM = { width: 100, height: 210 };

// Heights in mm, kept a little generous so a long name never spills.
const H = { pad: 5, header: 18, footer: 6, box: 7, row: 14, note: 4, sign: 12, pack: 7 };

// The notes printed under a row, in capitals so they stand out in black.
export function rowFlags(r, platformLabel = (k) => k){
  const out = [];
  if (r.alreadySold) out.push('ALREADY MARKED SOLD');
  if (r.soldTwice) out.push('2 SALES ON THIS ITEM');
  if (r.listedElsewhere.length){
    const where = r.listedElsewhere.map(platformLabel).join(', ');
    out.push(r.platformUnknown ? `LISTED ON: ${where}` : `DELIST: ${where}`);
  }
  if (r.match && r.match.how === 'name' && r.match.confidence !== 'high') out.push('CHECK: MATCHED BY NAME');
  if (r.match && r.match.skuNotFound) out.push(`SKU ${r.line.sku} NOT IN CATALOG`);
  return out;
}

// Splits the list into pages. Blocks: a box heading (kept with its first
// row; repeated as "(cont.)" on the next page), rows, the "Not found"
// part, and the signature line at the end. Returns [[block, …], …].
export function paginatePick(pl, platformLabel = (k) => k){
  const blocks = [];
  pl.boxes.forEach(b => {
    blocks.push({ type: 'box', title: boxTitle(b.box), count: b.rows.length, h: H.box });
    b.rows.forEach(r => blocks.push({ type: 'row', row: r, box: boxTitle(b.box), flags: rowFlags(r, platformLabel), h: H.row + rowFlags(r, platformLabel).length * H.note }));
  });
  if (pl.unmatched.length){
    blocks.push({ type: 'box', title: 'Not found in the catalog', count: pl.unmatched.length, h: H.box });
    pl.unmatched.forEach(r => blocks.push({ type: 'row', row: r, box: 'Not found in the catalog', flags: [], unmatched: true, h: H.row }));
  }
  // The packages, one line each (v3.27.2): the number, who it is for, how many
  // pieces. It is what the person packs from after picking.
  if (pl.packages && pl.packages.length){
    blocks.push({ type: 'box', title: 'Packages', count: pl.packages.length, h: H.box });
    pl.packages.forEach(p => blocks.push({ type: 'pack', pack: p, box: 'Packages', h: H.pack }));
  }
  blocks.push({ type: 'sign', h: H.sign });

  const pages = [[]];
  let room = SHEET_MM.height - 2 * H.pad - H.footer - H.header;
  const newPage = () => { pages.push([]); room = SHEET_MM.height - 2 * H.pad - H.footer; };
  blocks.forEach((b, i) => {
    const next = blocks[i + 1];
    // A heading never ends a page alone.
    const need = b.type === 'box' && next && (next.type === 'row' || next.type === 'pack') ? b.h + next.h : b.h;
    if (need > room && pages[pages.length - 1].length){
      newPage();
      if (b.type === 'row' || b.type === 'pack'){
        const cont = { type: 'box', title: `${b.box} (cont.)`, count: null, h: H.box };
        pages[pages.length - 1].push(cont);
        room -= cont.h;
      }
    }
    pages[pages.length - 1].push(b);
    room -= b.h;
  });
  return pages;
}

// What a package line says: its buyer and its piece count.
export function packText(p){
  return `${p.buyer || 'No buyer name'} · ${p.pieces} piece${p.pieces === 1 ? '' : 's'}`;
}

const orderTail = (n) => (n && n.length > 8 ? `…${n.slice(-6)}` : n || '');

// The row's code and name, as printed.
export function rowCode(b){
  const l = b.row.line;
  return b.unmatched ? (l.sku ? `SKU ${l.sku}` : 'No SKU') : (b.row.item.productCode || 'No code');
}
export function rowName(b){
  const l = b.row.line;
  return b.unmatched ? l.title : (b.row.item.name || l.title);
}

// The line under the name: size, platform, price, buyer and the order's tail.
export function rowMeta(b, platformLabel = (k) => k){
  const l = b.row.line;
  return [
    l.size ? `Size ${l.size}` : '',
    l.platform ? platformLabel(l.platform) : '',
    l.price !== null ? `$${l.price.toFixed(2)}` : l.priceText,
    l.buyer,
    orderTail(l.orderNumber),
  ].filter(Boolean).join(' · ');
}
