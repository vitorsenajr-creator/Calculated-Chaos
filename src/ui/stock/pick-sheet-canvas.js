// Stock → Pick: the checklist as PNG pages (v3.25.2). The pages that
// paginatePick() lays out are drawn on canvases, like the label images, and
// shared to the label printer app (FlashLabel Pro) instead of going to the
// browser's print dialog. Black on white: the thermal printer is monochrome.
// Sizes are in millimeters, as the printed version had them.
import { SHEET_MM, paginatePick, rowCode, rowName, rowMeta, packText } from './pick-print.js';
import { saveOrShareFiles } from '../../platform/files.js';
import { showToast } from '../toast.js';

const PX_PER_MM = 12; // 100 × 210 mm becomes 1200 × 2520 px (about 305 dpi)
const PX_PER_PT = (25.4 / 72) * PX_PER_MM;
const FAMILY = 'Arial, Helvetica, sans-serif';
const PAD = 5; // mm, the sheet's side and top padding
const TEXT_W = SHEET_MM.width - 2 * PAD; // mm
// The rows' type and their measures are 15% larger since v3.27.24 (pick-print.js
// has the matching heights).
const ROW = { pad: 1.4, check: 6.9, gap: 2.5, first: 4.8, next: 4.1, meta: 3.8, flag: 4.6, badge: 6.9, badgeGap: 2 }; // mm
const mm = (v) => v * PX_PER_MM;

function setFont(ctx, weight, pt){
  ctx.font = `${weight} ${pt * PX_PER_PT}px ${FAMILY}`;
}

// Cuts text to maxW px and ends it with an ellipsis, like text-overflow.
function ellipsize(ctx, text, maxW){
  let s = text;
  while (s.length && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

function fit(ctx, text, maxW){
  return ctx.measureText(text).width <= maxW ? text : ellipsize(ctx, text, maxW);
}

// Greedy word wrap: the first line is firstW px wide, the rest restW px.
function wrapLines(ctx, text, firstW, restW){
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)){
    const next = line ? `${line} ${word}` : word;
    const width = lines.length ? restW : firstW;
    if (!line || ctx.measureText(next).width <= width) line = next;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

// The package number: a black ring with the number inside, centered on
// (cx, cy) mm. Black only (the printer is monochrome); smaller type for
// three digits.
function drawBadge(ctx, cx, cy, d, n){
  ctx.save();
  ctx.lineWidth = mm(0.6);
  ctx.beginPath();
  ctx.arc(mm(cx), mm(cy), mm(d / 2 - 0.3), 0, Math.PI * 2);
  ctx.stroke();
  const text = String(n);
  setFont(ctx, '700', text.length > 2 ? 7.5 : text.length > 1 ? 9.2 : 11);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, mm(cx), mm(cy) + mm(0.15));
  ctx.restore();
}

// A box heading: the title on the left, the count on the right, a rule under.
function drawBox(ctx, top, b){
  const bottom = top + 8;
  const baseline = mm(bottom - 0.4 - 0.8);
  const countText = b.count === null ? '' : `${b.count} item${b.count === 1 ? '' : 's'}`;
  let countW = 0;
  if (countText){
    setFont(ctx, '400', 9.8);
    countW = ctx.measureText(countText).width;
  }
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'left';
  setFont(ctx, '700', 12.6);
  ctx.fillText(fit(ctx, b.title, mm(TEXT_W) - countW - mm(2)), mm(PAD), baseline);
  if (countText){
    setFont(ctx, '400', 9.8);
    ctx.textAlign = 'right';
    ctx.fillText(countText, mm(PAD + TEXT_W), baseline);
    ctx.textAlign = 'left';
  }
  ctx.fillRect(mm(PAD), mm(bottom - 0.4), mm(TEXT_W), mm(0.4));
}

// One piece: an empty box to tick by hand, the code and name (at most two lines), the meta
// line and the flags, all clipped to the row's height.
function drawRow(ctx, top, b, platformLabel){
  const textX = PAD + ROW.check + ROW.gap + ROW.badge + ROW.badgeGap;
  const textW = mm(TEXT_W - (textX - PAD));
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, mm(top), mm(SHEET_MM.width), mm(b.h));
  ctx.clip();

  // The check box: 6 mm square, 0.5 mm stroke, always empty (v3.27.7): the
  // sheet is ticked by hand, whatever is ticked on screen.
  ctx.lineWidth = mm(0.55);
  ctx.strokeRect(mm(PAD + 0.275), mm(top + ROW.pad + 0.5 + 0.275), mm(ROW.check - 0.55), mm(ROW.check - 0.55));

  if (b.row.pack) drawBadge(ctx, PAD + ROW.check + ROW.gap + ROW.badge / 2, top + ROW.pad + 0.5 + ROW.badge / 2, ROW.badge, b.row.pack);
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  let y = top + ROW.pad;
  const code = rowCode(b);
  setFont(ctx, '700', 11.5);
  const codeW = ctx.measureText(code).width;
  setFont(ctx, '400', 9.8);
  const space = ctx.measureText(' ').width;
  const all = wrapLines(ctx, rowName(b), textW - codeW - space, textW);
  const lines = all.slice(0, 2);
  if (all.length > 2) lines[1] = ellipsize(ctx, lines[1], textW);
  setFont(ctx, '700', 11.5);
  ctx.fillText(code, mm(textX), mm(y));
  setFont(ctx, '400', 9.8);
  if (lines[0]) ctx.fillText(lines[0], mm(textX) + codeW + space, mm(y));
  y += ROW.first;
  for (const line of lines.slice(1)){
    ctx.fillText(line, mm(textX), mm(y));
    y += ROW.next;
  }

  setFont(ctx, '400', 8.6);
  ctx.fillText(fit(ctx, rowMeta(b, platformLabel), textW), mm(textX), mm(y));
  y += ROW.meta;
  setFont(ctx, '700', 8.6);
  for (const flag of b.flags){
    ctx.fillText(fit(ctx, flag, textW), mm(textX), mm(y));
    y += ROW.flag;
  }
  ctx.restore();

  ctx.fillRect(mm(PAD), mm(top + b.h - 0.2), mm(TEXT_W), mm(0.2));
}

// One package: its number in a ring, then the buyer and the piece count.
function drawPack(ctx, top, b){
  const d = 6;
  drawBadge(ctx, PAD + d / 2, top + b.h / 2 - 0.1, d, b.pack.n);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  setFont(ctx, '700', 10.4);
  ctx.fillText(fit(ctx, packText(b.pack), mm(TEXT_W - d - 3)), mm(PAD + d + 3), mm(top + b.h / 2));
  ctx.fillRect(mm(PAD), mm(top + b.h - 0.2), mm(TEXT_W), mm(0.2));
}

// The "Picked by / Date" line at the foot of a page's list.
function drawSign(ctx, top, h){
  const y = top + h - 4.75;
  ctx.fillRect(mm(PAD), mm(y), mm(58), mm(0.3));
  ctx.fillRect(mm(PAD + 62), mm(y), mm(28), mm(0.3));
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  setFont(ctx, '400', 8.5);
  ctx.fillText('Picked by', mm(PAD), mm(y + 1.3));
  ctx.fillText('Date', mm(PAD + 62), mm(y + 1.3));
}

// The message above the signature line (v3.27.24): centered, bold italic,
// black. It is wrapped to the lines pick-print.js reserved for it; when the
// text still needs more, the type shrinks a little, and as a last resort the
// last line ends with an ellipsis.
function drawQuote(ctx, top, b){
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const maxW = mm(TEXT_W - 6);
  let pt = 10.5;
  let lines;
  for (;;){
    ctx.font = `italic 700 ${pt * PX_PER_PT}px ${FAMILY}`;
    lines = wrapLines(ctx, b.text, maxW, maxW);
    if (lines.length <= b.lines || pt <= 7.5) break;
    pt -= 0.5;
  }
  if (lines.length > b.lines){
    lines = lines.slice(0, b.lines);
    lines[b.lines - 1] = ellipsize(ctx, lines[b.lines - 1], maxW);
  }
  const lineH = b.h > 0 ? (b.h - 4) / b.lines : 0;
  lines.forEach((line, i) => ctx.fillText(line, mm(SHEET_MM.width / 2), mm(top + 2 + lineH * (i + 0.5))));
  ctx.restore();
}

// The title and the two summary lines, on the first page only.
function drawHead(ctx, pl, storeName, stamp){
  const counts = `${pl.total} item${pl.total === 1 ? '' : 's'} · ${pl.orders} order${pl.orders === 1 ? '' : 's'}${pl.unmatched.length ? ` · ${pl.unmatched.length} not found` : ''}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  setFont(ctx, '700', 14);
  ctx.fillText('Pick list', mm(PAD), mm(PAD));
  setFont(ctx, '400', 8);
  ctx.fillText(fit(ctx, `${storeName || 'Calculated Chaos'} · ${stamp}`, mm(TEXT_W)), mm(PAD), mm(PAD + 5.4));
  ctx.fillText(fit(ctx, counts, mm(TEXT_W)), mm(PAD), mm(PAD + 5.4 + 3.7));
  ctx.fillRect(mm(PAD), mm(PAD + 18 - 0.6), mm(TEXT_W), mm(0.6));
}

// One canvas per 100 × 210 mm page, in the same order and with the same
// breaks as paginatePick(). The boxes are always empty.
export function renderPickPages(pl, { storeName = '', when = new Date(), platformLabel = (k) => k, message = '' } = {}){
  const pages = paginatePick(pl, platformLabel, message);
  const stamp = when.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  return pages.map((blocks, p) => {
    const canvas = document.createElement('canvas');
    canvas.width = mm(SHEET_MM.width);
    canvas.height = mm(SHEET_MM.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    ctx.strokeStyle = '#000';

    let top = PAD;
    if (p === 0){
      drawHead(ctx, pl, storeName, stamp);
      top = PAD + 18 + 1;
    }
    for (const b of blocks){
      if (b.type === 'box') drawBox(ctx, top, b);
      else if (b.type === 'row') drawRow(ctx, top, b, platformLabel);
      else if (b.type === 'pack') drawPack(ctx, top, b);
      else if (b.type === 'quote') drawQuote(ctx, top, b);
      else drawSign(ctx, top, b.h);
      top += b.h;
    }
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'right';
    setFont(ctx, '400', 7.5);
    ctx.fillText(`${p + 1}/${pages.length}`, mm(PAD + TEXT_W), mm(SHEET_MM.height - 2));
    return canvas;
  });
}

// The PNG bytes, made without await so the share sheet keeps the tap (iOS
// Safari drops navigator.share after an await).
function pngBlob(canvas){
  const bytes = Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), c => c.charCodeAt(0));
  return new Blob([bytes], { type: 'image/png' });
}

// Shares the checklist, one PNG per page. Call it from the tap handler.
export function shareChecklist(pl, opts = {}){
  const when = opts.when || new Date();
  const day = when.toLocaleDateString('en-CA'); // YYYY-MM-DD, local time
  const entries = renderPickPages(pl, { ...opts, when }).map((canvas, p) => ({
    blob: pngBlob(canvas),
    filename: `pick-list-${day}-${p + 1}.png`,
    type: 'image/png',
  }));
  return saveOrShareFiles(entries).catch(() => showToast('Could not share the checklist. Try again.'));
}
