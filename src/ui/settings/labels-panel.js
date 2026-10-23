// Settings → Labels (v3.27.25): a live preview of the label, the size, and one
// row per line that can print. Ticking a line or changing the size re-draws
// the preview with the real printing code, and when the label would get too
// tight (src/domain/label-fit.js) a window says so and the change can be
// undone. The handlers that save are in forms.js (saveLabelSettings).
import { appSettings, items } from '../../modules/state.js';
import { escapeHtml } from '../../modules/format-utils.js';
import { drawBatchLabelToCanvas, measureItemLabelFit } from '../label-render.js';
import { judgeLabelFit } from '../../domain/label-fit.js';
import { hasMultipleCodes } from '../../domain/item-issues.js';

const SAMPLE = {
  productCode: '#0000-1', name: 'Free People Floral Embroidered Lace Trim Maxi Dress',
  color: 'Cream Multi', category: 'Dresses', brand: 'Free People', storageBox: 'Box B12',
};

function row(id, title, hint, checked, extra = ''){
  return `
        <label class="settings-row" for="${id}">
          <div><div class="sr-label">${title}</div><div class="sr-sub">${hint}</div></div>
          <input type="checkbox" id="${id}" ${checked ? 'checked' : ''} ${extra}>
        </label>`;
}

export function labelsPageHtml(){
  const f = appSettings.labelFields || {};
  const store = String(appSettings.storeName || '').trim();
  return `
      <div class="settings-section">
        <h3>Preview</h3>
        <div class="ss-desc">One label as it prints, drawn with the longest values in your catalog.</div>
        <div class="lbl-preview"><canvas id="labelPreviewCanvas" width="10" height="10" role="img" aria-label="Label preview"></canvas></div>
      </div>
      <div class="settings-section">
        <h3>Size</h3>
        <div class="ss-desc">The labels loaded in your thermal printer.</div>
        <label class="settings-row" for="sLabelWidth">
          <div><div class="sr-label">Width</div><div class="sr-sub">Inches</div></div>
          <input type="number" id="sLabelWidth" value="${appSettings.labelWidthIn || 2.25}" min="1" max="6" step="0.05">
        </label>
        <label class="settings-row" for="sLabelHeight">
          <div><div class="sr-label">Height</div><div class="sr-sub">Inches</div></div>
          <input type="number" id="sLabelHeight" value="${appSettings.labelHeightIn || 1.25}" min="0.5" max="6" step="0.05">
        </label>
      </div>
      <div class="settings-section">
        <h3>What prints</h3>
        <div class="ss-desc">Each line shrinks to fit. A window warns you when a choice makes the label too tight.</div>
        ${row('sLabelFieldStore', 'Store name', store ? `“${escapeHtml(store.toUpperCase())}” above the code` : 'Set your store name in Appearance first', f.storeName === true)}
        ${row('sLabelFieldCode', 'Product code', 'Always printed', true, 'disabled')}
        ${row('sLabelFieldName', 'Item name', 'First line under the code', f.name !== false)}
        ${row('sLabelFieldColor', 'Color', 'After the name', f.color !== false)}
        ${row('sLabelFieldCategory', 'Category / type', 'After the color', !!f.category)}
        ${row('sLabelFieldBrand', 'Brand', 'After the category', !!f.brand)}
        ${row('sLabelFieldBarcode', 'Barcode', 'Code 128 of the code, under the name', f.barcode !== false)}
        ${row('sLabelFieldBox', 'Storage box', '📦 and its name, last line', f.box !== false)}
        <button class="settings-save-btn" onclick="saveLabelSettings()">Save label settings</button>
        <div class="settings-success" id="labelSaveMsg">Saved</div>
      </div>`;
}

// The catalog's longest value of each field on one made-up item, so the
// preview and the fit check show the hardest label this business can print.
function worstCaseItem(){
  const longest = (key, fallback) => items.reduce((best, it) => (String(it[key] || '').length > best.length ? String(it[key]) : best), '') || fallback;
  // A field holding two codes is a data error flagged elsewhere (v3.27.26):
  // it must not set the size of the preview.
  const code = items.reduce((best, it) => (!hasMultipleCodes(it) && String(it.productCode || '').length > best.length ? String(it.productCode) : best), '') || SAMPLE.productCode;
  return {
    productCode: code.length >= SAMPLE.productCode.length ? code : SAMPLE.productCode,
    name: longest('name', SAMPLE.name),
    color: longest('color', SAMPLE.color),
    category: longest('category', SAMPLE.category),
    brand: longest('brand', SAMPLE.brand),
    storageBox: longest('storageBox', SAMPLE.storageBox),
  };
}

const num = (id, fallback, min, max) => {
  const v = parseFloat(document.getElementById(id)?.value);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
};
const tick = (id) => !!document.getElementById(id)?.checked;

function readDraft(){
  return {
    labelWidthIn: num('sLabelWidth', appSettings.labelWidthIn || 2.25, 1, 6),
    labelHeightIn: num('sLabelHeight', appSettings.labelHeightIn || 1.25, 0.5, 6),
    labelFields: {
      storeName: tick('sLabelFieldStore'),
      name: tick('sLabelFieldName'),
      color: tick('sLabelFieldColor'),
      category: tick('sLabelFieldCategory'),
      brand: tick('sLabelFieldBrand'),
      barcode: tick('sLabelFieldBarcode'),
      box: tick('sLabelFieldBox'),
    },
  };
}

function writeDraft(d){
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  const check = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };
  set('sLabelWidth', d.labelWidthIn);
  set('sLabelHeight', d.labelHeightIn);
  const f = d.labelFields;
  check('sLabelFieldStore', f.storeName); check('sLabelFieldName', f.name); check('sLabelFieldColor', f.color);
  check('sLabelFieldCategory', f.category); check('sLabelFieldBrand', f.brand); check('sLabelFieldBarcode', f.barcode);
  check('sLabelFieldBox', f.box);
}

// Runs fn with the draft in place of the saved label settings, then puts the
// saved ones back (the drawing code reads appSettings).
function withDraft(draft, fn){
  const saved = { w: appSettings.labelWidthIn, h: appSettings.labelHeightIn, f: appSettings.labelFields };
  appSettings.labelWidthIn = draft.labelWidthIn;
  appSettings.labelHeightIn = draft.labelHeightIn;
  appSettings.labelFields = draft.labelFields;
  try{ return fn(); }
  finally{
    appSettings.labelWidthIn = saved.w;
    appSettings.labelHeightIn = saved.h;
    appSettings.labelFields = saved.f;
  }
}

const reportFor = (draft) => withDraft(draft, () => judgeLabelFit(measureItemLabelFit(worstCaseItem())));

async function redraw(){
  const canvas = document.getElementById('labelPreviewCanvas');
  if (!canvas) return;
  try{
    await Promise.all([
      document.fonts.load("700 24px 'JetBrains Mono'"), document.fonts.load("700 24px 'Inter'"), document.fonts.load("600 24px 'Inter'"),
    ]);
  }catch(e){}
  const drawn = withDraft(readDraft(), () => drawBatchLabelToCanvas([worstCaseItem()]));
  canvas.width = drawn.width;
  canvas.height = drawn.height;
  canvas.getContext('2d').drawImage(drawn, 0, 0);
}

// Opens the warning; resolves true to keep the change, false to undo it.
function askKeep(problems){
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'trash-dialog';
    dlg.setAttribute('aria-labelledby', 'labelFitTitle');
    dlg.innerHTML = `
      <div class="trash-body">
        <h2 id="labelFitTitle">This label is getting tight</h2>
        <ul class="lbl-fit-list">${problems.map(p => `<li>${escapeHtml(p.text)}</li>`).join('')}</ul>
        <p>Untick a line, or use a bigger label, to keep it easy to read.</p>
        <form method="dialog" class="trash-actions">
          <button type="submit" value="keep" class="secondary-btn">Keep anyway</button>
          <button type="submit" value="undo" class="primary-btn" autofocus>Undo</button>
        </form>
      </div>`;
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => { const keep = dlg.returnValue === 'keep'; dlg.remove(); resolve(keep); });
    dlg.showModal();
  });
}

export function wireLabelsPanel(){
  const page = document.querySelector('[data-settings-page="labels"]');
  if (!page) return;
  let accepted = { draft: readDraft(), keys: new Set(reportFor(readDraft()).problems.map(p => p.key)) };
  redraw();
  let busy = false;
  page.addEventListener('change', async (e) => {
    if (busy || !e.target.matches('input')) return;
    busy = true;
    try{
      const draft = readDraft();
      const report = reportFor(draft);
      const fresh = report.problems.filter(p => !accepted.keys.has(p.key));
      if (!fresh.length || await askKeep(report.problems)){
        accepted = { draft, keys: new Set(report.problems.map(p => p.key)) };
      }else{
        writeDraft(accepted.draft);
      }
      await redraw();
    }finally{ busy = false; }
  });
}
