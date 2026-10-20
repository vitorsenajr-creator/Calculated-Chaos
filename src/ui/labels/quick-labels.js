// Quick Labels (UI layer; v3.17.3, docs/modularization.md): reprint by
// typed product code, optionally moving the items to a box first, either
// one label at a time through the print modal or as one multi-page PDF.
// Moved out of main.js unchanged except for its interface.
import { items, appSettings } from '../../modules/state.js';
import { escapeHtml } from '../../modules/format-utils.js';
import { findItemByProductCodeDigits } from '../../domain/product-code-match.js';
import { drawBatchLabelToCanvas } from '../label-render.js';
import { saveOrShareFile } from '../../platform/files.js';
import { openBatchLabelModal } from './print-modal.js';

let saveItem, saveSettings, getAllStorageBoxes;

// Quick Labels prints each matched code as its own individual label (same
// "batch of one" pipeline the card's single-item print button uses) rather
// than grouping all 4 into one combined sheet/image — queued one at a time
// so each Print/Save click only ever produces one label. Once the queue is
// empty, the print modal hands control back to the Quick Labels tool itself
// (through the session's onClose) instead of revealing whatever view was
// open behind it.
let quickLabelPrintQueue = [];
let quickLabelPrintTotal = 0;

function quickLabelPrintSession(){
  return {
    title: quickLabelPrintTotal > 1
      ? `Print label (${quickLabelPrintTotal - quickLabelPrintQueue.length} of ${quickLabelPrintTotal})`
      : null,
    onClose: onQuickLabelPrintClosed,
  };
}

function onQuickLabelPrintClosed(reason){
  if (reason === 'cancel') quickLabelPrintQueue = [];
  if (quickLabelPrintQueue.length > 0){
    openBatchLabelModal([quickLabelPrintQueue.shift()], quickLabelPrintSession());
  } else {
    quickLabelPrintTotal = 0;
    openQuickLabelModal();
  }
}

// Quick reprint-by-code: type up to 4 exact product codes and jump
// straight to the same batch label sheet openBatchLabelModal already
// builds for the Catalog's bulk "Print labels" flow — no digging
// through search/select/deselect just to swap a label mid-packing.
// Same box list as Stock Transfer (registered boxes + every box name
// actually used on an item — see v3.13.86 for why the merge matters).
function populateQuickLabelBoxSelect(selectValue){
  const select = document.getElementById('quickLabelBoxSelect');
  const boxes = getAllStorageBoxes();
  const current = selectValue !== undefined ? selectValue : select.value;
  select.innerHTML = `<option value="">— No change —</option>` +
    boxes.map(b => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('');
  if (current && boxes.includes(current)) select.value = current;
}

function openQuickLabelModal(){
  document.getElementById('quickLabelError').style.display = 'none';
  const inputs = document.querySelectorAll('#quickLabelInputs .quick-label-input');
  inputs.forEach(inp => { inp.value = ''; });
  populateQuickLabelBoxSelect('');
  document.getElementById('quickLabelNewBoxRow').style.display = 'none';
  document.getElementById('quickLabelNewBoxInput').value = '';
  document.getElementById('quickLabelOverlay').classList.remove('hidden');
  inputs[0].focus();
}

async function addNewQuickLabelBox(){
  const input = document.getElementById('quickLabelNewBoxInput');
  const errorEl = document.getElementById('quickLabelError');
  const name = input.value.trim();
  if (!name){
    errorEl.textContent = 'Enter a box name first.';
    errorEl.style.display = '';
    return;
  }
  if ((appSettings.storageBoxes || []).some(b => b.name.toLowerCase() === name.toLowerCase())){
    errorEl.textContent = 'A box with that name already exists.';
    errorEl.style.display = '';
    return;
  }
  appSettings.storageBoxes = [...(appSettings.storageBoxes || []), { name, createdAt: Date.now() }];
  await saveSettings();
  populateQuickLabelBoxSelect(name);
  input.value = '';
  document.getElementById('quickLabelNewBoxRow').style.display = 'none';
  errorEl.style.display = 'none';
}

function closeQuickLabelModal(){
  document.getElementById('quickLabelOverlay').classList.add('hidden');
}

// Bridges Stock Transfer into this tool: rather than retyping the codes
// she just scanned to print a batch sheet for them, this pre-fills
// Quick Labels' 4 slots with the most recent transferred items and
// opens straight to it — same modal, same openBatchLabelModal() print
// path, just skipping the re-entry.
export function openQuickLabelModalWithCodes(codes){
  openQuickLabelModal();
  const inputs = [...document.querySelectorAll('#quickLabelInputs .quick-label-input')];
  codes.slice(0, inputs.length).forEach((code, i) => { inputs[i].value = code; });
}

// Shared by both "Generate labels" (the print queue) and "Save all as
// images" — resolves the up-to-4 typed codes against the catalog and,
// if a destination box was picked, moves every matched item there first
// (both actions should reflect the move). Disables/relabels whichever
// trigger button is passed while the move is in flight. Returns the
// matched items array, or null if it already showed an error and the
// caller should stop.
async function resolveQuickLabelMatchedItems(triggerBtn, triggerDefaultLabel){
  const inputs = [...document.querySelectorAll('#quickLabelInputs .quick-label-input')];
  const codes = inputs.map(inp => inp.value.trim()).filter(v => v !== '');
  const errorEl = document.getElementById('quickLabelError');
  if (codes.length === 0){
    errorEl.textContent = 'Type at least one item code.';
    errorEl.style.display = '';
    return null;
  }
  let matched = [];
  const notFound = [];
  codes.forEach(code => {
    const item = findItemByProductCodeDigits(items, code);
    if (item) matched.push(item); else notFound.push(code);
  });
  if (notFound.length > 0){
    errorEl.textContent = `Code${notFound.length===1?'':'s'} not found: ${notFound.join(', ')}`;
    errorEl.style.display = '';
    return null;
  }

  // Move all matched items to the chosen box before printing/saving, so
  // the labels come out already showing the new box — the whole point of
  // combining transfer + print into one step instead of using Stock
  // Transfer first and Quick Labels after.
  const box = document.getElementById('quickLabelBoxSelect').value;
  if (box){
    if (triggerBtn){
      triggerBtn.disabled = true;
      triggerBtn.textContent = `Moving ${matched.length} item${matched.length===1?'':'s'} to "${box}"…`;
    }
    try{
      matched = await Promise.all(matched.map(async item => {
        const updated = { ...item, storageBox: box };
        const idx = items.findIndex(i => i.id === item.id);
        if (idx >= 0) items[idx] = updated;
        await saveItem(updated);
        return updated;
      }));
    }catch(e){
      errorEl.textContent = 'Failed to move one or more items — check your connection and try again.';
      errorEl.style.display = '';
      if (triggerBtn){
        triggerBtn.disabled = false;
        triggerBtn.textContent = triggerDefaultLabel;
      }
      return null;
    }
    if (triggerBtn){
      triggerBtn.disabled = false;
      triggerBtn.textContent = triggerDefaultLabel;
    }
  }
  return matched;
}

async function submitQuickLabelModal(){
  const goBtn = document.getElementById('quickLabelGoBtn');
  const matched = await resolveQuickLabelMatchedItems(goBtn, '🖨️ Generate labels');
  if (!matched) return;

  closeQuickLabelModal();
  quickLabelPrintTotal = matched.length;
  quickLabelPrintQueue = matched.slice(1);
  openBatchLabelModal([matched[0]], quickLabelPrintSession());
}

// "Save all as images" — instead of stepping through the print modal
// once per item (Print/Save clicking 4 separate times), this renders
// every matched item's individual label canvas up front (same pipeline,
// same physical size as the single-item print/save flow) and stitches
// them into ONE multi-page PDF — one label per page, each page sized to
// her real configured label dimensions — rather than separate image
// files. A single PDF is what her printing app (any PDF-capable app,
// AirPrint, FlashLabel Pro's own PDF import, etc.) can reliably open and
// print as one job with N physical pages, unlike relying on the OS share
// sheet to fan N separate image files out into N recognized items (not
// guaranteed to be supported by whatever app receives them).
async function saveAllQuickLabelImages(){
  const saveBtn = document.getElementById('quickLabelSaveAllBtn');
  const defaultLabel = '📄 Save all as PDF (1 page per label)';
  const matched = await resolveQuickLabelMatchedItems(saveBtn, defaultLabel);
  if (!matched) return;

  const errorEl = document.getElementById('quickLabelError');
  errorEl.style.display = 'none';
  saveBtn.disabled = true;
  saveBtn.textContent = `Preparing ${matched.length}-page PDF…`;
  try{
    try{ await document.fonts.ready; }catch(e){}
    // Loaded on demand — jsPDF (and the html2canvas/dompurify code it
    // bundles for a feature this app never uses) is a heavy dependency
    // that would otherwise bloat every page load just for this one
    // rarely-used button.
    const { jsPDF } = await import('jspdf');
    const w = appSettings.labelWidthIn || 2.25;
    const h = appSettings.labelHeightIn || 1.25;
    const orientation = w >= h ? 'landscape' : 'portrait';
    const pdf = new jsPDF({ orientation, unit: 'in', format: [w, h] });

    matched.forEach((item, i) => {
      if (i > 0) pdf.addPage([w, h], orientation);
      const canvas = drawBatchLabelToCanvas([item]);
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, w, h);
    });

    const filename = `labels-${matched.length}-pages-${Date.now()}.pdf`;
    const blob = pdf.output('blob');

    // Web Share API for a single PDF file is well supported (unlike
    // sharing several separate image files, which depends on the
    // receiving app accepting a multi-file share) — same "share sheet
    // straight to FlashLabel Pro/Files" pattern the single-item Save
    // Image flow already relies on. A failed share is an error here, not
    // a fallback to the download link.
    await saveOrShareFile(blob, filename, 'application/pdf', { onShareError: 'throw' });
    closeQuickLabelModal();
    openQuickLabelModal();
  }catch(e){
    errorEl.textContent = 'Failed to build the label PDF — check your connection and try again.';
    errorEl.style.display = '';
  }finally{
    saveBtn.disabled = false;
    saveBtn.textContent = defaultLabel;
  }
}

// Wires the Quick Labels buttons and inputs, once at startup. saveItem,
// saveSettings and getAllStorageBoxes come from main.js.
export function initQuickLabels(deps){
  ({ saveItem, saveSettings, getAllStorageBoxes } = deps);

  document.getElementById('quickLabelOpenBtn').addEventListener('click', openQuickLabelModal);
  document.getElementById('quickLabelCancelBtn').addEventListener('click', closeQuickLabelModal);
  document.getElementById('quickLabelOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'quickLabelOverlay') closeQuickLabelModal();
  });
  document.getElementById('quickLabelGoBtn').addEventListener('click', submitQuickLabelModal);
  document.getElementById('quickLabelSaveAllBtn').addEventListener('click', saveAllQuickLabelImages);
  document.getElementById('quickLabelNewBoxToggleBtn').addEventListener('click', () => {
    const row = document.getElementById('quickLabelNewBoxRow');
    const showing = row.style.display !== 'none';
    row.style.display = showing ? 'none' : 'flex';
    if (!showing) document.getElementById('quickLabelNewBoxInput').focus();
  });
  document.getElementById('quickLabelNewBoxAddBtn').addEventListener('click', addNewQuickLabelBox);
  document.getElementById('quickLabelNewBoxInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addNewQuickLabelBox();
  });
  document.querySelectorAll('#quickLabelInputs .quick-label-input').forEach((inp, idx, all) => {
    inp.addEventListener('input', () => {
      inp.value = inp.value.replace(/[^0-9]/g, '');
      // Auto-advance to the next empty field once this one has 4 digits
      // (the app's product codes are 4-digit numbers) — keeps the flow
      // fully numeric-keyboard, no manual tapping between fields.
      if (inp.value.length >= 4 && idx < all.length - 1){
        all[idx + 1].focus();
      }
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitQuickLabelModal();
      if (e.key === 'Backspace' && inp.value === '' && idx > 0){
        all[idx - 1].focus();
      }
    });
  });
}
