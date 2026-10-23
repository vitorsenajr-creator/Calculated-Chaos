// The label print modal (UI layer; v3.17.3, docs/modularization.md).
// Moved out of main.js unchanged except for its interface. Every label
// print goes through openBatchLabelModal (one pipeline, see CLAUDE.md);
// the box label and the wall marker share the same modal. Printing and
// saving the image go through src/platform/.
//
// A caller that needs to know when the modal closes (Quick Labels steps
// through its queue that way) passes a `session` to openBatchLabelModal:
// { title, onClose(reason) }, where reason is 'cancel' for the Cancel
// button or the backdrop, else 'done'. The modal no longer reads the
// Quick Labels queue itself.
import { items, appSettings } from '../../modules/state.js';
import {
  buildBoxLabelInnerHtml, buildBatchLabelInnerHtml, buildMarkerInnerHtml,
  drawMarkerToCanvas, drawBoxLabelToCanvas, drawBatchLabelToCanvas,
  computeSharedBatchFonts, shrinkToFit, shrinkWrappedToFit, BATCH_LABEL_HEIGHT_IN,
} from '../label-render.js';
import { printHtml } from '../../platform/print.js';
import { saveOrShareFile } from '../../platform/files.js';

let saveItem;

let printBoxData = null;
let printBatchItems = [];
let printMode = 'batch'; // 'marker' | 'box' | 'batch' — a single item prints as a batch of one
let printSession = null;

export function openBoxLabelModal(box){
  printMode = 'box';
  printBoxData = box;
  printSession = null;
  const w = appSettings.labelWidthIn || 2.25;
  const h = appSettings.labelHeightIn || 1.25;
  const wrap = document.getElementById('labelPreviewWrap');
  wrap.innerHTML = `<div class="label-sheet" style="width:${w}in; height:${h}in;">${buildBoxLabelInnerHtml(box)}</div>`;

  const sheet = wrap.querySelector('.label-sheet');
  shrinkToFit(sheet.querySelector('.label-code'), Math.min(0.5, h * 0.2), 0.14);
  shrinkWrappedToFit(sheet.querySelector('.label-secondary'), Math.min(0.35, h * 0.15), 0.1, 2);

  const flagRow = document.getElementById('printLabelFlagRow');
  if (flagRow) flagRow.style.display = 'none';

  document.querySelector('#printLabelOverlay h3').textContent = 'Print box label';
  document.getElementById('printLabelOverlay').classList.remove('hidden');
}

// Up to 3 items on one sheet, divided into equal stacked strips — see
// drawBatchLabelToCanvas for the print-image side of this.
export function openBatchLabelModal(itemsArr, session = null){
  printMode = 'batch';
  printBatchItems = itemsArr;
  printSession = session;
  const w = appSettings.labelWidthIn || 2.25;
  // Single item ("batch" of one) uses her real configured label height,
  // not the fixed multi-item strip slot — see drawBatchLabelToCanvas.
  const h = itemsArr.length === 1 ? (appSettings.labelHeightIn || 1.25) : BATCH_LABEL_HEIGHT_IN;
  const dpi = 300;

  // Measure once to get font sizes shared by every item in this batch
  // (see computeSharedBatchFonts) — applied directly as inline
  // font-size, not each strip auto-fitting its own text independently.
  const scratch = document.createElement('canvas');
  scratch.width = Math.round(w * dpi);
  scratch.height = Math.round(h * dpi);
  const { codeFontIn, secFontIn, boxFontIn, storeFontIn } =
    computeSharedBatchFonts(scratch.getContext('2d'), itemsArr, w, dpi, h);

  const wrap = document.getElementById('labelPreviewWrap');
  wrap.innerHTML = `<div class="label-sheet label-sheet-batch" style="width:${w}in; height:${h * itemsArr.length}in;">${buildBatchLabelInnerHtml(itemsArr, h)}</div>`;

  wrap.querySelectorAll('.label-batch-strip').forEach(strip => {
    const codeEl = strip.querySelector('.label-code');
    const secEl = strip.querySelector('.label-secondary');
    const boxEl = strip.querySelector('.label-box');
    const storeEl = strip.querySelector('.label-store');
    if (storeEl) storeEl.style.fontSize = storeFontIn.toFixed(3) + 'in';
    if (codeEl) codeEl.style.fontSize = codeFontIn.toFixed(3) + 'in';
    if (secEl) secEl.style.fontSize = secFontIn.toFixed(3) + 'in';
    if (boxEl) boxEl.style.fontSize = boxFontIn.toFixed(3) + 'in';
  });

  // The "ship inspection" flag only makes sense per-item, so it's only
  // ever shown/editable here when this "batch" is really just one item
  // (the card's single-item print button, and Stock Transfer's
  // print-after-move, both go through this same function now).
  const flagRow = document.getElementById('printLabelFlagRow');
  const flagCheck = document.getElementById('printLabelShipFlagCheck');
  if (itemsArr.length === 1){
    if (flagRow) flagRow.style.display = '';
    if (flagCheck) flagCheck.checked = !!itemsArr[0].shipInspectionFlag;
  } else if (flagRow) {
    flagRow.style.display = 'none';
  }

  document.querySelector('#printLabelOverlay h3').textContent =
    itemsArr.length === 1
      ? ((session && session.title) || 'Print label')
      : `Print label sheet (${itemsArr.length} items)`;
  document.getElementById('printLabelOverlay').classList.remove('hidden');
}

function openMarkerPrintModal(){
  printMode = 'marker';
  printSession = null;
  const w = appSettings.labelWidthIn || 2.25;
  const h = appSettings.labelHeightIn || 1.25;
  const wrap = document.getElementById('labelPreviewWrap');
  wrap.innerHTML = `<div class="label-sheet" style="width:${w}in; height:${h}in; border:none;">${buildMarkerInnerHtml(w, h)}</div>`;

  const flagRow = document.getElementById('printLabelFlagRow');
  if (flagRow) flagRow.style.display = 'none';

  document.querySelector('#printLabelOverlay h3').textContent = 'Print wall marker';
  document.getElementById('printLabelOverlay').classList.remove('hidden');
}

function closePrintLabelModal(reason = 'done'){
  document.getElementById('printLabelOverlay').classList.add('hidden');
  printBoxData = null;
  printBatchItems = [];
  const session = printSession;
  printSession = null;
  if (session && session.onClose) session.onClose(reason);
}

// Wires the modal's buttons and the Settings handlers (wall marker,
// calibration instructions), once at startup. saveItem comes from main.js.
export function initPrintModal(deps){
  ({ saveItem } = deps);

  // Only meaningful when printBatchItems is exactly one item (see the
  // flagRow handling in openBatchLabelModal) — updates that item's
  // shipInspectionFlag and re-renders through the same batch pipeline
  // everything else here uses, so a single-item print never has its own
  // separate rendering path to fall out of sync with the real batch one.
  document.getElementById('printLabelShipFlagCheck').addEventListener('change', async (e) => {
    if (printMode !== 'batch' || printBatchItems.length !== 1) return;
    const checked = e.target.checked;
    const updated = { ...printBatchItems[0], shipInspectionFlag: checked };
    const idx = items.findIndex(i => i.id === updated.id);
    if (idx >= 0) items[idx] = updated;
    openBatchLabelModal([updated], printSession);
    try{ await saveItem(updated); }catch(err){ /* saveItem already alerts */ }
  });

  window.openMarkerPrintModal = openMarkerPrintModal;

  window.openCalibInstructionsModal = function(){
    document.getElementById('calibInstructionsOverlay').classList.remove('hidden');
  };
  document.getElementById('calibInstructionsCloseBtn').addEventListener('click', () => {
    document.getElementById('calibInstructionsOverlay').classList.add('hidden');
  });
  document.getElementById('calibInstructionsOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'calibInstructionsOverlay') e.target.classList.add('hidden');
  });

  // Cancelling (or dismissing via the backdrop) tells the session it was
  // cancelled, so Quick Labels abandons the rest of its queue instead of
  // advancing to the next item and returns straight to its own screen,
  // same as finishing the last item normally.
  document.getElementById('labelPrintCancelBtn').addEventListener('click', () => closePrintLabelModal('cancel'));
  document.getElementById('printLabelOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'printLabelOverlay') closePrintLabelModal('cancel');
  });

  // Synchronous all the way to printHtml's window.print() (iOS, v3.13.47).
  document.getElementById('labelPrintBtn').addEventListener('click', () => {
    if (printMode === 'batch' && printBatchItems.length === 0) return;
    if (printMode === 'box' && !printBoxData) return;
    const w = appSettings.labelWidthIn || 2.25;
    const previewSheet = document.querySelector('#labelPreviewWrap .label-sheet');
    const h = printMode === 'batch'
      ? (printBatchItems.length === 1 ? (appSettings.labelHeightIn || 1.25) : BATCH_LABEL_HEIGHT_IN * printBatchItems.length)
      : (appSettings.labelHeightIn || 1.25);

    // Reuse the already-fitted markup from the preview so the printed
    // label matches exactly what was just shown — including any modifier
    // classes (e.g. label-sheet-batch's stacked-strip layout). Built before
    // closing, since closing can open the next queued label in the preview.
    const html = `<div class="${previewSheet.className}" style="width:${w}in; height:${h}in;">${previewSheet.innerHTML}</div>`;

    closePrintLabelModal();
    printHtml(html, { widthIn: w, heightIn: h });
  });

  document.getElementById('labelSaveImgBtn').addEventListener('click', async () => {
    if (printMode === 'batch' && printBatchItems.length === 0) return;
    if (printMode === 'box' && !printBoxData) return;
    try{ await document.fonts.ready; }catch(e){}
    const w = appSettings.labelWidthIn || 2.25;
    const h = appSettings.labelHeightIn || 1.25;
    const canvas = printMode === 'marker' ? drawMarkerToCanvas(w, h)
      : printMode === 'box' ? drawBoxLabelToCanvas(printBoxData)
      : drawBatchLabelToCanvas(printBatchItems);
    const filename = printMode === 'marker' ? 'wall-marker.png'
      : printMode === 'box' ? `box-${(printBoxData.name || 'label').replace(/[^a-z0-9-_]/gi, '_')}.png`
      : `labels-batch-${Date.now()}.png`;

    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const result = await saveOrShareFile(blob, filename, 'image/png');
      if (result !== 'cancelled') closePrintLabelModal();
    }, 'image/png');
  });
}
