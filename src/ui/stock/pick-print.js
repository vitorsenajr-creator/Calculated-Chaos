// Stock → Pick: the printed checklist (v3.24.3). One or more 100 × 210 mm
// labels (the shipping-label stock), printed through platform/print.js
// like every other label. Black only (the thermal printer is monochrome),
// a box to tick by hand per piece, grouped by box in the screen's order.
// The page breaks are computed here from fixed heights (millimeters), so
// the print stays synchronous inside the click (iOS Safari, v3.13.47).
import { escapeHtml } from '../../modules/format-utils.js';
import { boxTitle } from '../../domain/sale-match.js';

export const SHEET_MM = { width: 100, height: 210 };
const MM_PER_IN = 25.4;
export const SHEET_IN = { widthIn: SHEET_MM.width / MM_PER_IN, heightIn: SHEET_MM.height / MM_PER_IN };

// Heights in mm, kept a little generous so a long name never spills.
const H = { pad: 5, header: 18, footer: 6, box: 7, row: 14, note: 4, sign: 12 };

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
  blocks.push({ type: 'sign', h: H.sign });

  const pages = [[]];
  let room = SHEET_MM.height - 2 * H.pad - H.footer - H.header;
  const newPage = () => { pages.push([]); room = SHEET_MM.height - 2 * H.pad - H.footer; };
  blocks.forEach((b, i) => {
    const next = blocks[i + 1];
    // A heading never ends a page alone.
    const need = b.type === 'box' && next && next.type === 'row' ? b.h + next.h : b.h;
    if (need > room && pages[pages.length - 1].length){
      newPage();
      if (b.type === 'row'){
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

const orderTail = (n) => (n && n.length > 8 ? `…${n.slice(-6)}` : n || '');

function rowHtml(b, picked, platformLabel){
  const r = b.row;
  const l = r.line;
  const code = b.unmatched ? (l.sku ? `SKU ${l.sku}` : 'No SKU') : (r.item.productCode || 'No code');
  const name = b.unmatched ? l.title : (r.item.name || l.title);
  const meta = [
    l.size ? `Size ${l.size}` : '',
    l.platform ? platformLabel(l.platform) : '',
    l.price !== null ? `$${l.price.toFixed(2)}` : l.priceText,
    l.buyer,
    orderTail(l.orderNumber),
  ].filter(Boolean).map(escapeHtml).join(' · ');
  return `
    <div class="pps-row" style="height:${b.h}mm">
      <span class="pps-check">${picked ? '✓' : ''}</span>
      <div class="pps-main">
        <div class="pps-line1"><b class="pps-code">${escapeHtml(code)}</b> <span class="pps-name">${escapeHtml(name)}</span></div>
        <div class="pps-meta">${meta}</div>
        ${b.flags.map(f => `<div class="pps-flag">${escapeHtml(f)}</div>`).join('')}
      </div>
    </div>`;
}

// The sheets' markup. `picked` = line keys already ticked on screen.
export function pickSheetHtml(pl, { picked = new Set(), storeName = '', when = new Date(), platformLabel = (k) => k } = {}){
  const pages = paginatePick(pl, platformLabel);
  const stamp = when.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  return `<div class="pps-sheets">${pages.map((blocks, p) => `
    <div class="pps-sheet">
      ${p === 0 ? `
      <div class="pps-head">
        <div class="pps-title">Pick list</div>
        <div class="pps-sub">${escapeHtml(storeName || 'Calculated Chaos')} · ${escapeHtml(stamp)}</div>
        <div class="pps-sub">${pl.total} item${pl.total === 1 ? '' : 's'} · ${pl.orders} order${pl.orders === 1 ? '' : 's'}${pl.unmatched.length ? ` · ${pl.unmatched.length} not found` : ''}</div>
      </div>` : ''}
      ${blocks.map(b => b.type === 'box'
        ? `<div class="pps-box">${escapeHtml(b.title)}${b.count !== null ? `<span>${b.count} item${b.count === 1 ? '' : 's'}</span>` : ''}</div>`
        : b.type === 'row' ? rowHtml(b, picked.has(b.row.line.key), platformLabel)
        : `<div class="pps-sign"><span>Picked by</span><span>Date</span></div>`).join('')}
      <div class="pps-foot">${p + 1}/${pages.length}</div>
    </div>`).join('')}</div>`;
}
