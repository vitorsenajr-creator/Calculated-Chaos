// Stock screen (UI layer; v3.20.1): Pick (v3.24.2, ui/stock/pick-view.js),
// Labels, Transfer, Boxes and Wall markers sub-tabs. Labels and Transfer
// open their full-screen tools (ui/labels/); Boxes and Wall markers moved
// here from Settings.
import { items, appSettings } from '../../modules/state.js';
import { escapeHtml } from '../../modules/format-utils.js';
import { summarizeBoxes } from '../../domain/stock-boxes.js';
import { openBoxLabelModal } from '../labels/print-modal.js';
import { renderPick } from './pick-view.js';

const SECTION_KEY = 'cc.stock.section';
const SECTIONS = ['pick', 'labels', 'transfer', 'boxes', 'markers'];

let hooks = { openCatalog: () => {} };

// Per-device convenience: the last sub-tab opened. Storage can be blocked
// (private mode), so every access is guarded.
function getSection(){
  try{
    const s = localStorage.getItem(SECTION_KEY);
    return SECTIONS.includes(s) ? s : 'labels';
  }catch(e){ return 'labels'; }
}
function setSection(s){
  try{ localStorage.setItem(SECTION_KEY, s); }catch(e){ /* not persisted */ }
}

export function initStockView(h){
  hooks = { ...hooks, ...h };
  document.querySelectorAll('[data-stock-section]').forEach(btn => {
    btn.addEventListener('click', () => {
      setSection(btn.dataset.stockSection);
      renderStock();
    });
  });
}

export function renderStock(){
  const section = getSection();
  document.querySelectorAll('[data-stock-section]').forEach(btn => {
    const on = btn.dataset.stockSection === section;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  SECTIONS.forEach(s => {
    const pane = document.getElementById(`stockPane-${s}`);
    if (pane) pane.hidden = s !== section;
  });
  if (section === 'pick') renderPick();
  if (section === 'boxes') renderBoxes();
  if (section === 'markers') renderMarkers();
}

function renderBoxes(){
  const pane = document.getElementById('stockPane-boxes');
  const boxes = summarizeBoxes(items, appSettings.storageBoxes || []);
  const total = boxes.reduce((t, b) => t + b.inStock, 0);
  const rows = boxes.map(b => `
    <div class="box-row">
      <button type="button" class="box-open" data-open-box="${escapeHtml(b.name)}">
        <span class="box-name">${escapeHtml(b.name)}</span>
        <span class="box-count">${b.inStock} item${b.inStock === 1 ? '' : 's'}${b.registeredIndex === null ? ' · not registered' : ''}</span>
      </button>
      <button type="button" class="row-btn" data-print-box="${escapeHtml(b.name)}">Print label</button>
      ${b.registeredIndex !== null ? `<button type="button" class="row-btn danger" data-remove-box="${b.registeredIndex}">Remove</button>` : ''}
    </div>`).join('');

  pane.innerHTML = `
    <section class="panel">
      <div class="panel-head">
        <h2 class="panel-title">Boxes</h2>
        <span class="panel-meta">${boxes.length} box${boxes.length === 1 ? '' : 'es'} · ${total} item${total === 1 ? '' : 's'} in stock</span>
      </div>
      ${rows || `<div class="attn-empty">No boxes yet. Register one below and print its label.</div>`}
    </section>
    <section class="panel stock-form">
      <h2 class="panel-title">Register a box</h2>
      <p class="stock-form-desc">Register a box by name and print its label right away, before any item goes in. Uses the label size from Settings.</p>
      <div class="stock-form-row">
        <input type="text" id="sNewBoxName" placeholder="Box name or number" aria-label="Box name or number">
        <button type="button" class="primary-btn" id="registerBoxBtn">Register &amp; print</button>
      </div>
    </section>`;

  pane.querySelectorAll('[data-open-box]').forEach(btn => btn.addEventListener('click', () => {
    hooks.openCatalog({ box: btn.dataset.openBox, notSold: true });
  }));
  pane.querySelectorAll('[data-print-box]').forEach(btn => btn.addEventListener('click', () => {
    const registered = (appSettings.storageBoxes || []).find(b => b.name === btn.dataset.printBox);
    openBoxLabelModal(registered || { name: btn.dataset.printBox, createdAt: Date.now() });
  }));
  pane.querySelectorAll('[data-remove-box]').forEach(btn => btn.addEventListener('click', () => {
    window.removeStorageBox(Number(btn.dataset.removeBox));
  }));
  document.getElementById('registerBoxBtn').addEventListener('click', () => window.registerAndPrintBox());
}

function renderMarkers(){
  const pane = document.getElementById('stockPane-markers');
  pane.innerHTML = `
    <section class="panel stock-form">
      <h2 class="panel-title">Wall measurement markers</h2>
      <p class="stock-form-desc">Print 4 crosshair targets and mount them on a wall (measure center to center with a tape measure, once). The measuring tool then calibrates itself when you tap the 4 markers in a photo. Use wider spacing for bulkier items like dresses.</p>
      <label class="stock-field">
        <span><b>Horizontal spacing</b><small>Inches, center to center (left to right markers)</small></span>
        <input type="number" id="sMarkerSpacingH" value="${appSettings.wallMarkerSpacingHIn || 24}" min="4" max="120" step="0.5">
      </label>
      <label class="stock-field">
        <span><b>Vertical spacing</b><small>Inches, center to center (top to bottom markers)</small></span>
        <input type="number" id="sMarkerSpacingV" value="${appSettings.wallMarkerSpacingVIn || 24}" min="4" max="120" step="0.5">
      </label>
      <div class="stock-form-row">
        <button type="button" class="primary-btn" id="saveMarkersBtn">Save spacing</button>
        <span class="settings-success" id="markerSaveMsg">Saved</span>
      </div>
      <div class="stock-form-row">
        <button type="button" class="secondary-btn" id="printMarkerBtn">Print a marker</button>
        <button type="button" class="secondary-btn" id="calibHelpBtn">Calibration instructions</button>
      </div>
    </section>`;
  document.getElementById('saveMarkersBtn').addEventListener('click', () => window.saveWallMarkerSettings());
  // Printing stays synchronous inside the click (iOS Safari drops it otherwise).
  document.getElementById('printMarkerBtn').addEventListener('click', () => window.openMarkerPrintModal());
  document.getElementById('calibHelpBtn').addEventListener('click', () => window.openCalibInstructionsModal());
}
