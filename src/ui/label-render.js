// Thermal label rendering (UI layer; v3.17.2, docs/modularization.md).
// Moved out of main.js unchanged: the on-screen preview markup (sized in
// CSS inches) and the canvas images that get printed or saved, for item
// labels, multi-item batch sheets, storage-box labels and the calibration
// marker. It only reads the label settings from state.js; the print modal,
// Quick Labels, storage boxes and Stock Transfer that call it live in
// src/ui/labels/ (v3.17.3). Every print still goes through
// labels/print-modal.js's openBatchLabelModal (one pipeline, see CLAUDE.md).
import { appSettings } from '../modules/state.js';
import { escapeHtml } from '../modules/format-utils.js';

// Builds the label's inner markup (code / box / secondary line), sized in
// CSS "in" units so the exact same markup looks right both in the on-screen
// preview and on the physical label (1in == 96px on screen, and an actual
// inch when printed — no separate scale math needed).
export function buildLabelInnerHtml(item){
  const fields = appSettings.labelFields || {};
  const w = appSettings.labelWidthIn || 2.25;
  const h = appSettings.labelHeightIn || 1.25;
  const secondaryParts = [];
  if (fields.name !== false && item.name) secondaryParts.push(item.name);
  if (fields.color !== false && item.color) secondaryParts.push(item.color);
  if (fields.category && item.category) secondaryParts.push(item.category);
  if (fields.brand && item.brand) secondaryParts.push(item.brand);
  const secondary = secondaryParts.join(' · ');
  const flagSizeIn = Math.min(0.32, h * 0.14, w * 0.14);

  // Priority order top-to-bottom: SKU code, then name/color, then storage
  // box — matches how important each detail is when scanning the label.
  // The name/color line wraps (never truncates) so the full item name
  // always prints, shrinking font size first via shrinkWrappedToFit.
  // The whole block sits in the bottom third of the label (see
  // .label-sheet's justify-content:flex-end in style.css), bounded by a
  // thin top/bottom rule that doubles as a cut guide.
  return `
      <div class="label-content-block">
        ${item.shipInspectionFlag ? `<div class="label-flag" style="width:${flagSizeIn}in; height:${flagSizeIn}in;" title="Inspect before shipping"><svg viewBox="0 0 100 100" width="100%" height="100%"><path d="M50 4 L96 90 L4 90 Z" fill="#000" stroke="#000" stroke-width="8" stroke-linejoin="round"/><rect x="44" y="31" width="12" height="34" fill="#fff"/><circle cx="50" cy="76" r="7" fill="#fff"/></svg></div>` : ''}
        <div class="label-code">${escapeHtml(item.productCode || '')}</div>
        ${secondary ? `<div class="label-secondary">${escapeHtml(secondary)}</div>` : ''}
        ${fields.box !== false && item.storageBox ? `<div class="label-box">📦 ${escapeHtml(item.storageBox)}</div>` : ''}
      </div>
    `;
}

// Storage box label — same bottom-anchored/rule-bounded block as an item
// label, but the box name fills the "code" slot and the registration
// date is the only secondary line (no item fields apply to a box).
export function buildBoxLabelInnerHtml(box){
  return `
      <div class="label-content-block">
        <div class="label-code">📦 ${escapeHtml(box.name)}</div>
        <div class="label-secondary">${escapeHtml(new Date(box.createdAt).toLocaleDateString('en-US'))}</div>
      </div>
    `;
}

// One sheet, one fixed-height (BATCH_LABEL_HEIGHT_IN) strip per selected
// item — a single shared cut line sits between consecutive strips (see
// .label-sheet-batch CSS), not a rule pair around every item. Font sizes
// are applied afterward by openBatchLabelModal (shared across the whole
// batch, not each strip fitting its own text independently).
export function buildBatchLabelInnerHtml(itemsArr, stripHeightIn){
  return itemsArr.map(item =>
    `<div class="label-batch-strip" style="height:${stripHeightIn}in;">${buildLabelInnerHtml(item)}</div>`
  ).join('');
}

// Wall marker: a crosshair with a small empty gap at the center (so the
// ideal tap point is the gap's geometric center, not a blurry printed
// intersection) plus an alignment tick above the top arm for mounting the
// label level on the wall. Plain rects + one stroked circle — no roundRect.
function markerGeometry(w, h){
  const minDim = Math.min(w, h);
  const armLen = minDim * 0.32;
  const gapR = armLen * 0.24;
  const thick = Math.max(0.018, minDim * 0.03);
  const tickLen = armLen * 0.55;
  const tickGap = armLen * 0.12;
  return { cx: w / 2, cy: h / 2, armLen, gapR, thick, tickLen, tickGap };
}

export function buildMarkerInnerHtml(w, h){
  const { cx, cy, armLen, gapR, thick, tickLen, tickGap } = markerGeometry(w, h);
  const color = '#2B241E';
  const bar = (left, top, width, height) =>
    `<div style="position:absolute; left:${left}in; top:${top}in; width:${width}in; height:${height}in; background:${color};"></div>`;
  return `
      <div style="position:relative; width:${w}in; height:${h}in;">
        ${bar(cx - thick / 2, cy - gapR - armLen, thick, armLen)}
        ${bar(cx - thick / 2, cy + gapR, thick, armLen)}
        ${bar(cx - gapR - armLen, cy - thick / 2, armLen, thick)}
        ${bar(cx + gapR, cy - thick / 2, armLen, thick)}
        ${bar(cx - thick / 2, cy - gapR - armLen - tickGap - tickLen, thick, tickLen)}
        <div style="position:absolute; left:${cx - gapR}in; top:${cy - gapR}in; width:${gapR * 2}in; height:${gapR * 2}in; border-radius:50%; border:${thick * 0.6}in solid ${color}; box-sizing:border-box;"></div>
      </div>
    `;
}

export function drawMarkerToCanvas(w, h){
  const dpi = 300;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * dpi);
  canvas.height = Math.round(h * dpi);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFDF9';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const g = markerGeometry(w, h);
  const cx = g.cx * dpi, cy = g.cy * dpi;
  const armLen = g.armLen * dpi, gapR = g.gapR * dpi, thick = g.thick * dpi;
  const tickLen = g.tickLen * dpi, tickGap = g.tickGap * dpi;
  const color = '#2B241E';

  ctx.fillStyle = color;
  ctx.fillRect(cx - thick / 2, cy - gapR - armLen, thick, armLen);
  ctx.fillRect(cx - thick / 2, cy + gapR, thick, armLen);
  ctx.fillRect(cx - gapR - armLen, cy - thick / 2, armLen, thick);
  ctx.fillRect(cx + gapR, cy - thick / 2, armLen, thick);
  ctx.fillRect(cx - thick / 2, cy - gapR - armLen - tickGap - tickLen, thick, tickLen);

  ctx.strokeStyle = color;
  ctx.lineWidth = thick * 0.6;
  ctx.beginPath();
  ctx.arc(cx, cy, gapR, 0, Math.PI * 2);
  ctx.stroke();

  return canvas;
}

// Fixed physical height of one label when printing several at once —
// a locked constant (not derived from the "paper" setting) so batch
// labels always come out a known, predictable size.
export const BATCH_LABEL_HEIGHT_IN = 2;

// Pure measurement (no drawing): the font sizes THIS item alone would
// want at the given slot height, same fitting rules as drawBatchItemAt.
// Batch printing uses this to find the smallest size any item in the
// selection needs, then draws every item at that ONE shared size —
// otherwise a short-text item ends up with a much bigger, bolder-looking
// font than a long-text item right next to it on the same sheet.
function measureItemLabelFonts(ctx, item, w, dpi, h){
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const maxWidth = w * dpi - (w * 0.16 * dpi);

  function fitFontIn(text, family, weight, maxFontIn, minFontIn){
    let fontIn = maxFontIn;
    while (fontIn > minFontIn){
      ctx.font = `${weight} ${fontIn * dpi}px ${family}`;
      if (ctx.measureText(text).width <= maxWidth) break;
      fontIn -= 0.02;
    }
    return fontIn;
  }
  function wrapCanvasText(text, maxW){
    const words = text.split(' ');
    const lines = [];
    let current = '';
    for (const word of words){
      const test = current ? current + ' ' + word : word;
      if (!current || ctx.measureText(test).width <= maxW) current = test;
      else { lines.push(current); current = word; }
    }
    if (current) lines.push(current);
    return lines;
  }
  const fields = appSettings.labelFields || {};
  const code = item.productCode || '';
  const secondaryParts = [];
  if (fields.name !== false && item.name) secondaryParts.push(item.name);
  if (fields.color !== false && item.color) secondaryParts.push(item.color);
  if (fields.category && item.category) secondaryParts.push(item.category);
  if (fields.brand && item.brand) secondaryParts.push(item.brand);
  const secondary = secondaryParts.join(' · ');
  const boxText = (fields.box !== false && item.storageBox) ? ('📦 ' + item.storageBox) : '';

  // Code is the most important thing to scan at a glance, so its cap is
  // generous enough to actually use most of a tall/wide label instead of
  // stopping at a fixed, modest ceiling — bounded only by its own width
  // fit (fitFontIn's maxWidth check). Box's cap is fixed and, unlike the
  // name, is never adjusted for anything else on the label — per Vitor's
  // request, the storage box's own text always gets the same treatment
  // regardless of how long the item name happens to be.
  let codeFontIn = fitFontIn(code, "'JetBrains Mono', monospace", 700, Math.min(1.19, h * 0.4675), 0.14);
  let boxFontIn = boxText ? fitFontIn(boxText, "'Inter', sans-serif", 600, Math.min(0.16, h * 0.075), 0.09) : 0;

  const gapIn = 0.035, lineHeightMult = 1.15;
  const maxBlockIn = h * 0.92;
  // Whatever vertical room code + box (fixed above) don't use is what the
  // name gets to work with — it's the only one of the three that flexes,
  // shrinking (and, since a smaller font fits more characters per line,
  // often needing fewer wrapped lines too) until its own block actually
  // fits that leftover space. No artificial floor here: forcing a minimum
  // budget when code+box already consume all of maxBlockIn (or more) is
  // exactly what let the box line get cut off — the name's own minFontIn
  // loop below is the only floor that's safe to rely on.
  const nameBudgetIn = maxBlockIn - codeFontIn - (boxText ? gapIn + boxFontIn : 0) - (secondary ? gapIn : 0);

  let secFontIn = 0;
  if (secondary){
    let fontIn = Math.min(0.38, h * 0.17);
    let lines;
    while (fontIn > 0.11){
      ctx.font = `700 ${fontIn * dpi}px 'Inter', sans-serif`;
      lines = wrapCanvasText(secondary, maxWidth);
      if (lines.length <= 3 && fontIn * lineHeightMult * lines.length <= nameBudgetIn) break;
      fontIn -= 0.02;
    }
    secFontIn = fontIn;
  }

  return { code, secondary, boxText, codeFontIn, secFontIn, boxFontIn };
}

// Finds the uniform font sizes (smallest needed by any item that has
// that field) shared by every label in a batch print.
export function computeSharedBatchFonts(ctx, itemsArr, w, dpi, h){
  const measures = itemsArr.map(item => measureItemLabelFonts(ctx, item, w, dpi, h));
  const codeFontIn = Math.min(...measures.map(m => m.codeFontIn));
  const secSizes = measures.filter(m => m.secondary).map(m => m.secFontIn);
  const secFontIn = secSizes.length ? Math.min(...secSizes) : 0;
  const boxSizes = measures.filter(m => m.boxText).map(m => m.boxFontIn);
  const boxFontIn = boxSizes.length ? Math.min(...boxSizes) : 0;
  return { measures, codeFontIn, secFontIn, boxFontIn };
}

// Draws one item's label using pre-decided (shared) font sizes, centered
// within a yTopIn..yTopIn+h slot — no rules of its own; the caller draws
// one shared line between consecutive items instead.
function drawBatchItemAt(ctx, w, dpi, yTopIn, h, fonts, m){
  const canvasWidthPx = w * dpi;
  const maxWidth = canvasWidthPx - (w * 0.16 * dpi);
  const gapIn = 0.035, lineHeightMult = 1.15;

  let secLines = [];
  if (m.secondary){
    ctx.font = `700 ${fonts.secFontIn * dpi}px 'Inter', sans-serif`;
    const words = m.secondary.split(' ');
    let current = '';
    for (const word of words){
      const test = current ? current + ' ' + word : word;
      if (!current || ctx.measureText(test).width <= maxWidth) current = test;
      else { secLines.push(current); current = word; }
    }
    if (current) secLines.push(current);
  }

  const secBlockIn = secLines.length ? fonts.secFontIn * lineHeightMult * secLines.length : 0;
  const totalIn = fonts.codeFontIn + (secLines.length ? gapIn + secBlockIn : 0) + (m.boxText ? gapIn + fonts.boxFontIn : 0);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let curY = (yTopIn + (h - totalIn) / 2 + fonts.codeFontIn / 2) * dpi;

  ctx.fillStyle = '#2B241E';
  ctx.font = `700 ${fonts.codeFontIn * dpi}px 'JetBrains Mono', monospace`;
  ctx.fillText(m.code, canvasWidthPx / 2, curY);
  curY += (fonts.codeFontIn / 2) * dpi;

  if (secLines.length){
    curY += (gapIn + fonts.secFontIn * lineHeightMult / 2) * dpi;
    ctx.font = `700 ${fonts.secFontIn * dpi}px 'Inter', sans-serif`;
    ctx.fillStyle = '#2B241E';
    for (let i = 0; i < secLines.length; i++){
      ctx.fillText(secLines[i], canvasWidthPx / 2, curY + i * fonts.secFontIn * lineHeightMult * dpi);
    }
    curY += (secLines.length - 0.5) * fonts.secFontIn * lineHeightMult * dpi;
  }

  if (m.boxText){
    curY += (gapIn + fonts.boxFontIn / 2) * dpi;
    ctx.font = `600 ${fonts.boxFontIn * dpi}px 'Inter', sans-serif`;
    ctx.fillStyle = '#6E5F4E';
    ctx.fillText(m.boxText, canvasWidthPx / 2, curY);
  }
}

// Storage box label — box name fills the "code" slot, registration date
// is the only secondary line. Same bottom-anchored/rule-bounded visual
// language as an item label, drawn directly (no item fields apply).
export function drawBoxLabelToCanvas(box){
  const w = appSettings.labelWidthIn || 2.25;
  const h = appSettings.labelHeightIn || 1.25;
  const dpi = 300;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * dpi);
  canvas.height = Math.round(h * dpi);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFDF9';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const maxWidth = canvas.width - (w * 0.16 * dpi);
  function fitFontIn(text, family, weight, maxFontIn, minFontIn){
    let fontIn = maxFontIn;
    while (fontIn > minFontIn){
      ctx.font = `${weight} ${fontIn * dpi}px ${family}`;
      if (ctx.measureText(text).width <= maxWidth) break;
      fontIn -= 0.02;
    }
    return fontIn;
  }

  const nameText = '📦 ' + box.name;
  const dateText = new Date(box.createdAt).toLocaleDateString('en-US');
  const nameFontIn = fitFontIn(nameText, "'Inter', sans-serif", 700, Math.min(0.6, h * 0.24), 0.14);
  const dateFontIn = 0.13;
  const gapIn = 0.035;
  const totalIn = nameFontIn + gapIn + dateFontIn;

  const marginXIn = 0.08;
  const innerPadIn = 0.05;
  const bottomMarginIn = Math.min(0.08, h * 0.04);
  const lineThicknessIn = 0.012;
  const blockOuterIn = totalIn + innerPadIn * 2;
  const bottomLineY = (h - bottomMarginIn) * dpi;
  const topLineY = bottomLineY - blockOuterIn * dpi;

  ctx.strokeStyle = '#6E5F4E';
  ctx.lineWidth = lineThicknessIn * dpi;
  ctx.beginPath();
  ctx.moveTo(marginXIn * dpi, topLineY);
  ctx.lineTo(canvas.width - marginXIn * dpi, topLineY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(marginXIn * dpi, bottomLineY);
  ctx.lineTo(canvas.width - marginXIn * dpi, bottomLineY);
  ctx.stroke();

  let curY = topLineY + (innerPadIn + nameFontIn / 2) * dpi;
  ctx.fillStyle = '#2B241E';
  ctx.font = `700 ${nameFontIn * dpi}px 'Inter', sans-serif`;
  ctx.fillText(nameText, canvas.width / 2, curY);
  curY += (nameFontIn / 2) * dpi + (gapIn + dateFontIn / 2) * dpi;

  ctx.font = `600 ${dateFontIn * dpi}px 'Inter', sans-serif`;
  ctx.fillStyle = '#6E5F4E';
  ctx.fillText(dateText, canvas.width / 2, curY);

  return canvas;
}

// Inspection flag drawn as a solid black vector warning triangle with a
// white "!" instead of the ⚠️ emoji: the emoji is mostly yellow, and the
// thermal printer app's B/W conversion (FlashLabel Pro's threshold) turns
// yellow into white, so the flag vanished from the saved image entirely.
// Pure black/white survives any threshold. (x, y) = top-left, size in px.
function drawInspectionFlagIcon(ctx, x, y, size){
  const triH = size * 0.9;
  ctx.save();
  ctx.fillStyle = '#000000';
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.08;
  ctx.strokeStyle = '#000000';
  ctx.beginPath();
  ctx.moveTo(x + size / 2, y);
  ctx.lineTo(x + size, y + triH);
  ctx.lineTo(x, y + triH);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#FFFFFF';
  const barW = size * 0.12;
  ctx.fillRect(x + size / 2 - barW / 2, y + triH * 0.3, barW, triH * 0.38);
  ctx.beginPath();
  ctx.arc(x + size / 2, y + triH * 0.8, barW * 0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Every item gets the same fixed BATCH_LABEL_HEIGHT_IN slot and the same
// shared font sizes (see computeSharedBatchFonts) — a single cut line
// between consecutive items, no rule pair around each one. That fixed
// slot only makes sense for a real multi-item sheet, though — for the
// single-item case (the card's print button, item modal's print button,
// and Stock Transfer's print-after-move all route through here as a
// "batch" of one, per v3.13.99) it silently overrode her actual
// configured label height with an unrelated constant, changing the
// physical proportions of what got printed. Use her real setting when
// there's only one item, same as the pre-v3.13.99 single-item path did.
export function drawBatchLabelToCanvas(itemsArr){
  const w = appSettings.labelWidthIn || 2.25;
  const h = itemsArr.length === 1 ? (appSettings.labelHeightIn || 1.25) : BATCH_LABEL_HEIGHT_IN;
  const dpi = 300;

  const scratch = document.createElement('canvas');
  scratch.width = Math.round(w * dpi);
  scratch.height = Math.round(h * dpi);
  const { measures, codeFontIn, secFontIn, boxFontIn } =
    computeSharedBatchFonts(scratch.getContext('2d'), itemsArr, w, dpi, h);
  const fonts = { codeFontIn, secFontIn, boxFontIn };

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * dpi);
  canvas.height = Math.round(h * dpi * itemsArr.length);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFDF9';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  itemsArr.forEach((item, i) => {
    drawBatchItemAt(ctx, w, dpi, i * h, h, fonts, measures[i]);
    if (item.shipInspectionFlag){
      const flagSizeIn = Math.min(0.32, h * 0.14, w * 0.14);
      drawInspectionFlagIcon(ctx, canvas.width - (0.06 + flagSizeIn) * dpi, (i * h + 0.04) * dpi, flagSizeIn * dpi);
    }
    if (i < itemsArr.length - 1){
      ctx.strokeStyle = '#6E5F4E';
      ctx.lineWidth = 0.012 * dpi;
      const yPx = (i + 1) * h * dpi;
      ctx.beginPath();
      ctx.moveTo(0.08 * dpi, yPx);
      ctx.lineTo(canvas.width - 0.08 * dpi, yPx);
      ctx.stroke();
    }
  });
  return canvas;
}

// Shrinks an element's font-size (in inches) until it fits its container's
// width, so long product codes / box names never get cut off mid-character.
export function shrinkToFit(el, maxFontIn, minFontIn){
  if (!el) return;
  let fontIn = maxFontIn;
  el.style.fontSize = fontIn + 'in';
  const container = el.parentElement;
  let guard = 0;
  while (el.scrollWidth > container.clientWidth && fontIn > minFontIn && guard < 60){
    fontIn -= 0.015;
    el.style.fontSize = fontIn.toFixed(3) + 'in';
    guard++;
  }
}

// Like shrinkToFit, but for text allowed to wrap onto multiple lines
// (the CSS already allows wrapping) — shrinks the font until the wrapped
// block's height fits within targetLines lines at that font size, or
// bottoms out at minFontIn and just wraps onto however many lines it
// needs. Text is never truncated with an ellipsis.
export function shrinkWrappedToFit(el, maxFontIn, minFontIn, targetLines){
  if (!el) return;
  let fontIn = maxFontIn;
  let guard = 0;
  while (fontIn > minFontIn && guard < 60){
    el.style.fontSize = fontIn.toFixed(3) + 'in';
    const maxHeightPx = fontIn * 1.15 * targetLines * 96 + 1;
    if (el.scrollHeight <= maxHeightPx) break;
    fontIn -= 0.01;
    guard++;
  }
  el.style.fontSize = fontIn.toFixed(3) + 'in';
}
