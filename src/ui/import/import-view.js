// Import a spreadsheet (UI layer; v3.23.1). Settings → Data → "Import a
// spreadsheet" opens this screen: 1. choose the file (and its sheets),
// 2. match the columns and values, 3. preview, 4. save in batches (with
// Continue after a dropped connection), 5. summary with Undo. The
// conversion is domain/import-sheet.js; the writes data/import-store.js;
// the file reading platform/sheetjs.js. main.js passes the business's
// settings and what to do after saving (initImportView). Tokens only.
import { escapeHtml } from '../../modules/format-utils.js';
import {
  IMPORT_FIELDS, FIELD_BY_KEY, MAX_IMPORT_ROWS, suggestMapping, suggestValueMap, detectDateOrder,
  buildImportRows, importTotals, itemsToImport, findHeaderRow, buildImportDocs, importsInCatalog, normalizeText, parseDate, splitList,
} from '../../domain/import-sheet.js';
import { readSpreadsheet } from '../../platform/sheetjs.js';
import { saveImportBatches, undoImport } from '../../data/import-store.js';
import { reserveProductCodeBlock } from '../../modules/product-code-bank.js';
import { mergeAiMapping, mergeAiValues, STATUS_KEYS, CONDITION_KEYS, AI_MAX_ROWS, AI_MAX_VALUES } from '../../modules/ai-import.js';

const PAGE = 50;
const STATUS_OPTIONS = [['catalogado', 'Cataloged (in stock)'], ['anunciado', 'Listed'], ['vendido', 'Sold']];
const CONDITION_OPTIONS = [['novo_etiqueta', 'New with tags'], ['novo_sem_etiqueta', 'New without tags'], ['excelente', 'Excellent'], ['bom', 'Good'], ['aceitavel', 'Fair'], ['defeito', 'For parts / flawed']];

let hooks = {
  getItems: () => [],
  platforms: () => [],          // [{ key, label }]
  fee: () => 0,                 // (platform, price) → fee
  categories: () => [],
  prepFor: () => 'ready',
  newId: () => String(Math.random()),
  canImport: () => false,
  afterSave: () => {},          // (docs) → add to the catalog and redraw
  afterUndo: () => {},          // (ids) → remove from the catalog and redraw
  back: () => {},
  openImported: () => {},       // (importId) → the catalog filtered to it
  openWarnings: () => {},
  aiMapColumns: null,           // (input) → { ok, result | message, skipped }
};
export function initImportView(h){ hooks = { ...hooks, ...h }; }

let st = null;
// Opening the screen keeps an import that's still in the middle (columns,
// preview, a stopped save); a finished one starts over.
export function openImport(){
  if (!st || ['upload', 'sheets', 'done'].includes(st.step)) st = fresh();
  renderImport();
}
function fresh(){
  return { step: 'upload', fileName: '', sheets: [], chosen: [], headers: [], rows: [], mapping: [], valueMap: null,
    userValues: { status: {}, condition: {}, platform: {} }, aiValues: [], ai: null, dateOrder: 'mdy', built: [], skip: new Set(),
    filter: 'all', page: 0, importId: null, docs: [], saved: new Set(), progress: 0, error: '', busy: '', undoArm: null, undone: null };
}

const view = () => document.getElementById('importView');
const money = (n) => `$${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const plural = (n, w) => `${n.toLocaleString('en-US')} ${w}${n === 1 ? '' : 's'}`;

export function renderImport({ reset = false } = {}){
  if (reset || !st) st = fresh();
  const el = view();
  if (!el) return;
  if (!hooks.canImport()){
    el.innerHTML = `${head()}<div class="panel imp-panel"><p class="imp-note">Only the account owner can import a spreadsheet.</p></div>`;
    wireHead();
    return;
  }
  const body = { upload: uploadHtml, sheets: sheetsHtml, map: mapHtml, preview: previewHtml, saving: savingHtml, done: doneHtml }[st.step]();
  el.innerHTML = head() + body;
  wireHead();
  ({ upload: wireUpload, sheets: wireSheets, map: wireMap, preview: wirePreview, saving: wireSaving, done: wireDone })[st.step]();
}

const STEPS = [['upload', 'File'], ['map', 'Columns'], ['preview', 'Preview'], ['saving', 'Save']];
function head(){
  const at = { upload: 0, sheets: 0, map: 1, preview: 2, saving: 3, done: 3 }[st ? st.step : 'upload'];
  return `
    <div class="imp-head">
      <button type="button" class="settings-back" data-imp-back aria-label="Back to Settings">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg><span>Settings</span>
      </button>
      <h1 class="screen-title">Import a spreadsheet</h1>
      <ol class="imp-steps" aria-label="Steps">${STEPS.map(([k, label], i) => `
        <li class="${i < at ? 'done' : i === at ? 'on' : ''}"${i === at ? ' aria-current="step"' : ''}><span>${i + 1}</span>${label}</li>`).join('')}
      </ol>
    </div>`;
}
function wireHead(){
  view().querySelector('[data-imp-back]')?.addEventListener('click', () => {
    if (st && st.step === 'saving' && st.busy) return;
    hooks.back();
  });
}

// ---------- 1. File ----------
function uploadHtml(){
  const past = importsInCatalog(hooks.getItems());
  return `
    <section class="panel imp-panel">
      <h2 class="panel-title">Choose the file</h2>
      <p class="imp-note">The spreadsheet you use today to track your inventory and sales: Excel (.xlsx, .xls) or CSV. Each row becomes an item, with a new code from the app; your own code is kept on the item as its legacy code, so you can still search by it. Sold rows come in as sales, with their profit. Photos aren't imported.</p>
      <label class="primary-btn imp-file">Choose a file<input type="file" id="impFile" accept=".xlsx,.xls,.csv,.tsv,.ods,text/csv"></label>
      ${st.error ? `<p class="imp-error" role="alert">${escapeHtml(st.error)}</p>` : ''}
      ${st.busy ? `<p class="imp-note" role="status">${escapeHtml(st.busy)}</p>` : ''}
      ${st.undone ? `<p class="imp-done-msg" role="status">${escapeHtml(st.undone)}</p>` : ''}
    </section>
    ${past.length ? `
    <section class="panel imp-panel">
      <h2 class="panel-title">Past imports</h2>
      <ul class="imp-past">${past.map(p => `
        <li>
          <span class="imp-past-text"><b>${escapeHtml(p.fileName || 'Spreadsheet')}</b><small>${new Date(p.importedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · ${plural(p.count, 'item')}</small></span>
          <button type="button" class="row-btn" data-imp-open="${escapeHtml(p.importId)}">Show</button>
          <button type="button" class="row-btn danger" data-imp-undo="${escapeHtml(p.importId)}" data-count="${p.count}">${st.undoArm === p.importId ? `Delete ${plural(p.count, 'item')}?` : 'Undo'}</button>
        </li>`).join('')}
      </ul>
    </section>` : ''}`;
}
function wireUpload(){
  document.getElementById('impFile')?.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    st.error = ''; st.busy = 'Reading the file…'; renderImport();
    try{
      const sheets = (await readSpreadsheet(file)).filter(s => s.aoa.some(r => r.some(c => String(c).trim())));
      st.busy = '';
      if (!sheets.length){ st.error = "That file has no data."; return renderImport(); }
      st.fileName = file.name;
      st.sheets = sheets;
      if (sheets.length === 1){ st.chosen = [sheets[0].name]; return startMapping(); }
      st.chosen = [sheets[0].name];
      st.step = 'sheets';
      renderImport();
    }catch(err){
      st.busy = '';
      st.error = `Couldn't read that file: ${err.message || err}`;
      renderImport();
    }
  });
  wirePastImports();
}
function wirePastImports(){
  view().querySelectorAll('[data-imp-open]').forEach(b => b.addEventListener('click', () => hooks.openImported(b.dataset.impOpen)));
  view().querySelectorAll('[data-imp-undo]').forEach(b => b.addEventListener('click', async () => {
    const id = b.dataset.impUndo;
    if (st.undoArm !== id){ st.undoArm = id; return renderImport(); }
    st.undoArm = null;
    b.disabled = true; b.textContent = 'Deleting…';
    const r = await undoImport(id);
    if (r.deleted.length) hooks.afterUndo(r.deleted);
    st.undone = r.error ? `Deleted ${plural(r.deleted.length, 'item')}, then it stopped: ${r.error}. Try Undo again.` : `Deleted ${plural(r.deleted.length, 'item')}.`;
    renderImport();
  }));
}

// ---------- 1b. Sheets ----------
function sheetsHtml(){
  return `
    <section class="panel imp-panel">
      <h2 class="panel-title">Which sheets?</h2>
      <p class="imp-note">${escapeHtml(st.fileName)} has ${st.sheets.length} sheets. Pick the ones with your items; their columns are matched together.</p>
      <ul class="imp-checks">${st.sheets.map(s => `
        <li><label><input type="checkbox" data-imp-sheet="${escapeHtml(s.name)}" ${st.chosen.includes(s.name) ? 'checked' : ''}>
          <span>${escapeHtml(s.name)}</span><small>${plural(Math.max(0, s.aoa.length - 1), 'row')}</small></label></li>`).join('')}
      </ul>
      <div class="imp-actions">
        <button type="button" class="secondary-btn" data-imp-restart>Choose another file</button>
        <button type="button" class="primary-btn" data-imp-next ${st.chosen.length ? '' : 'disabled'}>Continue</button>
      </div>
    </section>`;
}
function wireSheets(){
  view().querySelectorAll('[data-imp-sheet]').forEach(c => c.addEventListener('change', () => {
    const n = c.dataset.impSheet;
    st.chosen = c.checked ? [...new Set([...st.chosen, n])] : st.chosen.filter(x => x !== n);
    renderImport();
  }));
  view().querySelector('[data-imp-restart]').addEventListener('click', () => renderImport({ reset: true }));
  view().querySelector('[data-imp-next]').addEventListener('click', startMapping);
}

// The chosen sheets as one table: the headers of all of them (same name =
// same column), each row laid out on those headers.
function startMapping(){
  const headers = [];
  const rows = [];
  st.sheets.filter(s => st.chosen.includes(s.name)).forEach(s => {
    const h = findHeaderRow(s.aoa);
    const own = (s.aoa[h] || []).map(c => String(c ?? '').trim());
    const at = own.map(name => {
      const n = normalizeText(name);
      let k = headers.findIndex(x => normalizeText(x) === n && n);
      if (k < 0){ headers.push(name || `Column ${headers.length + 1}`); k = headers.length - 1; }
      return k;
    });
    s.aoa.slice(h + 1).forEach(r => {
      const row = [];
      at.forEach((k, i) => { row[k] = r[i] ?? ''; });
      rows.push(row);
    });
  });
  rows.forEach(r => { for (let i = 0; i < headers.length; i++) if (r[i] === undefined) r[i] = ''; });
  if (rows.length > MAX_IMPORT_ROWS){
    st.error = `That's ${rows.length.toLocaleString('en-US')} rows; one import takes up to ${MAX_IMPORT_ROWS.toLocaleString('en-US')}. Split the file and import it in parts.`;
    st.step = 'upload';
    return renderImport();
  }
  st.headers = headers;
  st.rows = rows;
  st.mapping = suggestMapping(headers);
  refreshValues();
  const dateCols = st.mapping.map((m, i) => (m.field && FIELD_BY_KEY[m.field].kind === 'date' ? i : -1)).filter(i => i >= 0);
  st.dateOrder = detectDateOrder(rows.flatMap(r => dateCols.map(i => r[i])));
  st.step = 'map';
  st.ai = null; st.aiValues = [];
  renderImport();
  runAiCheck();
}

// Suggested value words, with the person's own choices on top.
function refreshValues(){
  let vm = suggestValueMap(st.rows, st.mapping, hooks.platforms());
  if (st.aiValues.length) vm = mergeAiValues(vm, st.aiValues, allowedKeys(), st.userValues).valueMap;
  ['status', 'condition', 'platform'].forEach(k => Object.assign(vm[k], pick(st.userValues[k], Object.keys(vm[k]))));
  st.valueMap = vm;
}
function allowedKeys(){
  return { status: STATUS_KEYS, condition: CONDITION_KEYS, platform: hooks.platforms().map(p => p.key) };
}

// The AI check of the columns (v3.23.2): runs once per file when the
// Columns step opens, on the headers, 10 sample rows and the value words.
// Its answer only replaces matches it's more sure about, never the
// person's own picks; until it answers, the rule-based matches stand.
async function runAiCheck(){
  if (!hooks.aiMapColumns || st.ai) return;
  const token = {};
  st.ai = { status: 'running', token };
  if (st.step === 'map') renderImport();
  const sampleRows = st.rows.filter(r => r.some(c => String(c ?? '').trim())).slice(0, AI_MAX_ROWS);
  // Every distinct word in any column a value could come from, so the AI
  // can map them even if it moves the status/condition/platform column.
  const words = (fields) => {
    const set = new Set();
    st.mapping.forEach((m, i) => {
      if (!m.field || !fields.includes(m.field)) return;
      st.rows.forEach(r => (m.field === 'listedPlatforms' ? splitList(r[i]) : [String(r[i] ?? '').trim()]).forEach(w => { if (w) set.add(w); }));
    });
    return [...set].slice(0, AI_MAX_VALUES);
  };
  const input = {
    headers: st.headers,
    rows: sampleRows.map(r => r.map(c => (typeof c === 'number' ? c : String(c ?? '')))),
    platforms: hooks.platforms(),
    values: { status: words(['status']), condition: words(['condition']), platform: words(['soldPlatform', 'listedPlatforms']) },
  };
  let r;
  try{ r = await hooks.aiMapColumns(input); }
  catch(e){ r = { ok: false, message: e.message || String(e) }; }
  if (!st.ai || st.ai.token !== token) return;
  if (!r || !r.ok || !r.result){
    st.ai = { status: r && r.skipped ? 'skipped' : 'failed', token };
  } else {
    const m = mergeAiMapping(st.mapping, r.result.columns);
    st.mapping = m.mapping;
    st.aiValues = Array.isArray(r.result.values) ? r.result.values : [];
    const before = JSON.stringify(st.valueMap);
    refreshValues();
    const valuesChanged = Object.keys(st.valueMap).reduce((t, k) => t + Object.entries(st.valueMap[k]).filter(([raw, key]) => key && !JSON.parse(before)[k][raw]).length, 0);
    st.ai = { status: 'done', token, columns: m.changed, values: valuesChanged };
  }
  if (st.step === 'map') renderImport();
}
function pick(obj, keys){ return Object.fromEntries(Object.entries(obj).filter(([k]) => keys.includes(k))); }

// ---------- 2. Columns ----------
// Up to three distinct values of a column, dates shown as dates (Excel
// keeps them as day numbers).
function sample(i){
  const seen = [];
  const isDate = st.mapping[i] && st.mapping[i].field && FIELD_BY_KEY[st.mapping[i].field].kind === 'date';
  for (const r of st.rows){
    let v = String(r[i] ?? '').trim();
    if (v && isDate){
      const t = parseDate(r[i], st.dateOrder);
      if (Number.isFinite(t)) v = new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    if (v && !seen.includes(v)) seen.push(v);
    if (seen.length === 3) break;
  }
  return seen;
}
function aiNote(){
  const a = st.ai;
  if (!a) return '';
  if (a.status === 'running') return '<p class="imp-ai running" role="status">The AI is checking the columns and values…</p>';
  if (a.status === 'done'){
    const parts = [a.columns ? plural(a.columns, 'column') : '', a.values ? plural(a.values, 'value') : ''].filter(Boolean);
    return `<p class="imp-ai" role="status">${parts.length ? `The AI checked the sheet and matched ${parts.join(' and ')} (marked "AI").` : 'The AI checked the sheet and agrees with these matches.'}</p>`;
  }
  if (a.status === 'skipped') return '<p class="imp-ai" role="status">The AI check was skipped: the AI usage limit for this period is used up. The matches below come from the column names.</p>';
  return '<p class="imp-ai" role="status">The AI check isn\'t available right now. The matches below come from the column names.</p>';
}

function mapHtml(){
  const fieldOptions = (cur) => `<option value="">Don't import</option>` + IMPORT_FIELDS.map(f =>
    `<option value="${f.key}"${f.key === cur ? ' selected' : ''}>${escapeHtml(f.label)}</option>`).join('');
  const cols = st.headers.map((h, i) => {
    const m = st.mapping[i] || {};
    const badge = m.field ? (m.confidence === 'high' ? '<span class="imp-badge ok">Matched</span>' : m.confidence === 'medium' ? '<span class="imp-badge">Best guess</span>' : m.confidence === 'ai' ? '<span class="imp-badge">AI</span>' : '') : '';
    return `
      <li class="imp-col">
        <div class="imp-col-head"><b>${escapeHtml(h)}</b>${badge}</div>
        <div class="imp-col-sample">${sample(i).map(v => `<span>${escapeHtml(v.length > 40 ? v.slice(0, 40) + '…' : v)}</span>`).join('') || '<span class="muted">empty</span>'}</div>
        <label class="imp-col-field"><span class="sr-only">Import "${escapeHtml(h)}" as</span><select data-imp-map="${i}">${fieldOptions(m.field)}</select></label>
      </li>`;
  }).join('');
  const valueBlock = (kind, title, options) => {
    const entries = Object.entries(st.valueMap[kind]);
    if (!entries.length) return '';
    return `
      <div class="imp-values">
        <h3>${title}</h3>
        <ul>${entries.map(([raw, key]) => `
          <li class="${key ? '' : 'unknown'}"><span>${escapeHtml(raw)}</span>
            <select data-imp-value="${kind}" data-raw="${escapeHtml(raw)}" aria-label="${escapeHtml(title)}: ${escapeHtml(raw)}">
              <option value="">${kind === 'platform' ? 'Other / skip' : 'Leave empty'}</option>
              ${options.map(([k, l]) => `<option value="${escapeHtml(k)}"${k === key ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('')}
            </select></li>`).join('')}
        </ul>
      </div>`;
  };
  const hasDates = st.mapping.some(m => m.field && FIELD_BY_KEY[m.field].kind === 'date');
  const unknown = ['status', 'condition', 'platform'].reduce((t, k) => t + Object.values(st.valueMap[k]).filter(v => !v).length, 0);
  return `
    <section class="panel imp-panel">
      <h2 class="panel-title">Match the columns</h2>
      <p class="imp-note">${escapeHtml(st.fileName)} · ${plural(st.rows.length, 'row')}. Each column is matched to an item field from its name; check the ones marked "Best guess" or "AI" and anything left as "Don't import".</p>
      ${aiNote()}
      <ul class="imp-cols">${cols}</ul>
    </section>
    ${hasDates ? `
    <section class="panel imp-panel">
      <h2 class="panel-title">Dates</h2>
      <label class="imp-inline">A date like 03/04/2026 means
        <select data-imp-dates>
          <option value="mdy"${st.dateOrder === 'mdy' ? ' selected' : ''}>March 4 (month first, US)</option>
          <option value="dmy"${st.dateOrder === 'dmy' ? ' selected' : ''}>3 April (day first)</option>
        </select></label>
    </section>` : ''}
    ${['status', 'condition', 'platform'].some(k => Object.keys(st.valueMap[k]).length) ? `
    <section class="panel imp-panel">
      <h2 class="panel-title">Values</h2>
      <p class="imp-note">How your sheet writes statuses, conditions and platforms.${unknown ? ` <b>${plural(unknown, 'value')} not recognized</b>: pick what each one means.` : ''}</p>
      ${valueBlock('status', 'Status', STATUS_OPTIONS)}
      ${valueBlock('condition', 'Condition', CONDITION_OPTIONS)}
      ${valueBlock('platform', 'Platforms', hooks.platforms().map(p => [p.key, p.label]))}
    </section>` : ''}
    <div class="imp-actions sticky">
      <button type="button" class="secondary-btn" data-imp-restart>Choose another file</button>
      <button type="button" class="primary-btn" data-imp-next ${st.mapping.some(m => m.field) ? '' : 'disabled'}>Preview</button>
    </div>`;
}
function wireMap(){
  view().querySelectorAll('[data-imp-map]').forEach(sel => sel.addEventListener('change', () => {
    const i = Number(sel.dataset.impMap), f = sel.value || null;
    // A field fills from one column only: the other column lets it go.
    if (f) st.mapping.forEach((m, k) => { if (k !== i && m.field === f) st.mapping[k] = { field: null, confidence: null }; });
    st.mapping[i] = { field: f, confidence: 'user' };
    refreshValues();
    renderImport();
  }));
  view().querySelectorAll('[data-imp-value]').forEach(sel => sel.addEventListener('change', () => {
    st.userValues[sel.dataset.impValue][sel.dataset.raw] = sel.value || null;
    st.valueMap[sel.dataset.impValue][sel.dataset.raw] = sel.value || null;
    sel.closest('li').classList.toggle('unknown', !sel.value);
  }));
  view().querySelector('[data-imp-dates]')?.addEventListener('change', (e) => { st.dateOrder = e.target.value; renderImport(); });
  view().querySelector('[data-imp-restart]').addEventListener('click', () => renderImport({ reset: true }));
  view().querySelector('[data-imp-next]').addEventListener('click', () => {
    st.built = buildImportRows(st.rows, {
      mapping: st.mapping, valueMap: st.valueMap, dateOrder: st.dateOrder, fee: hooks.fee,
      catalog: hooks.getItems(), categories: hooks.categories(), now: Date.now(),
    });
    st.skip = new Set();
    st.filter = 'all'; st.page = 0; st.error = '';
    st.step = 'preview';
    renderImport();
    window.scrollTo(0, 0);
  });
}

// ---------- 3. Preview ----------
const STATUS_WORD = { catalogado: 'In stock', anunciado: 'Listed', vendido: 'Sold' };
function previewHtml(){
  const t = importTotals(st.built, st.skip);
  const rows = st.built.filter(b => !b.empty).filter(b =>
    st.filter === 'problems' ? (b.errors.length || b.warnings.length) :
    st.filter === 'duplicates' ? b.duplicateOf : true);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  st.page = Math.min(st.page, pages - 1);
  const shown = rows.slice(st.page * PAGE, st.page * PAGE + PAGE);
  const rowHtml = (b) => {
    const i = b.items[0] || {};
    const price = i.status === 'vendido' ? `${money(i.soldPrice)} sold` : (i.listPrice ? money(parseFloat(i.listPrice)) : 'No price');
    return `
      <li class="imp-row${b.errors.length ? ' bad' : ''}${st.skip.has(b.row) ? ' skipped' : ''}">
        <div class="imp-row-top">
          <span class="imp-row-num">Row ${b.row}</span>
          <span class="imp-row-name">${escapeHtml(i.name || '')}${b.items.length > 1 ? ` <small>× ${b.items.length}</small>` : ''}</span>
          <span class="imp-row-price">${escapeHtml(price)}</span>
        </div>
        <div class="imp-row-meta">${[STATUS_WORD[i.status], i.brand, i.size, i.legacyCode ? `Code ${i.legacyCode}` : '', i.feesEstimated ? 'fees estimated' : ''].filter(Boolean).map(escapeHtml).join(' · ')}</div>
        ${b.errors.map(e => `<div class="imp-msg err">${escapeHtml(e)}. This row won't be imported.</div>`).join('')}
        ${b.warnings.map(w => `<div class="imp-msg">${escapeHtml(w)}</div>`).join('')}
        ${b.duplicateOf && !b.errors.length ? `
        <label class="imp-dup"><input type="checkbox" data-imp-skip="${b.row}" ${st.skip.has(b.row) ? 'checked' : ''}>
          Skip: may already be in the app as ${escapeHtml(b.duplicateOf.code ? b.duplicateOf.code + ' · ' : '')}${escapeHtml(b.duplicateOf.name)} (same ${b.duplicateOf.by === 'code' ? 'code' : 'name, size and price'})</label>` : ''}
      </li>`;
  };
  const cell = (label, value) => `<div class="summary-cell static"><span class="summary-label">${label}</span><span class="summary-value">${value}</span></div>`;
  return `
    <section class="summary-panel imp-totals" aria-label="Totals">
      ${cell('Items to import', t.items.toLocaleString('en-US'))}
      ${cell('In stock', `${t.inStock.toLocaleString('en-US')}<small>${money(t.stockValue)}</small>`)}
      ${cell('Sold', `${t.sold.toLocaleString('en-US')}<small>${money(t.salesRevenue)}</small>`)}
      ${cell('Rows with errors', t.errors.toLocaleString('en-US'))}
    </section>
    <p class="imp-note imp-totals-note">${[
      `${plural(t.rows, 'row')} read${t.empty ? `, ${plural(t.empty, 'empty row')} left out` : ''}`,
      t.listed ? `${t.listed} listed` : '',
      t.feesEstimated ? `${plural(t.feesEstimated, 'sale')} with fees estimated from your platform settings` : '',
      t.duplicates ? `${plural(t.duplicates, 'possible duplicate')}${t.skipped ? ` (${t.skipped} skipped)` : ''}` : '',
    ].filter(Boolean).join(' · ')}.</p>
    ${st.error ? `<p class="imp-error" role="alert">${escapeHtml(st.error)}</p>` : ''}
    <section class="panel imp-panel">
      <div class="imp-preview-head">
        <div class="seg" role="group" aria-label="Show">
          ${[['all', 'All'], ['problems', `Problems ${t.errors + t.warnings}`], ['duplicates', `Duplicates ${t.duplicates}`]].map(([k, l]) =>
            `<button type="button" class="seg-btn${st.filter === k ? ' active' : ''}" aria-pressed="${st.filter === k}" data-imp-filter="${k}">${l}</button>`).join('')}
        </div>
      </div>
      ${shown.length ? `<ul class="imp-rows">${shown.map(rowHtml).join('')}</ul>` : '<p class="imp-note">Nothing here.</p>'}
      ${pages > 1 ? `
      <div class="imp-pager">
        <button type="button" class="secondary-btn" data-imp-page="-1" ${st.page ? '' : 'disabled'}>Previous</button>
        <span>Page ${st.page + 1} of ${pages}</span>
        <button type="button" class="secondary-btn" data-imp-page="1" ${st.page < pages - 1 ? '' : 'disabled'}>Next</button>
      </div>` : ''}
    </section>
    <div class="imp-actions sticky">
      <button type="button" class="secondary-btn" data-imp-backstep>Back to columns</button>
      <button type="button" class="primary-btn" data-imp-save ${t.items ? '' : 'disabled'}>Import ${plural(t.items, 'item')}</button>
    </div>`;
}
function wirePreview(){
  view().querySelectorAll('[data-imp-filter]').forEach(b => b.addEventListener('click', () => { st.filter = b.dataset.impFilter; st.page = 0; renderImport(); }));
  view().querySelectorAll('[data-imp-page]').forEach(b => b.addEventListener('click', () => { st.page += Number(b.dataset.impPage); renderImport(); }));
  view().querySelectorAll('[data-imp-skip]').forEach(c => c.addEventListener('change', () => {
    const r = Number(c.dataset.impSkip);
    if (c.checked) st.skip.add(r); else st.skip.delete(r);
    renderImport();
  }));
  view().querySelector('[data-imp-backstep]').addEventListener('click', () => { st.step = 'map'; renderImport(); });
  view().querySelector('[data-imp-save]').addEventListener('click', startSaving);
}

// ---------- 4. Save ----------
async function startSaving(){
  const list = itemsToImport(st.built, st.skip);
  if (!list.length) return;
  st.step = 'saving'; st.error = ''; st.busy = 'Reserving product codes…'; st.progress = 0;
  renderImport();
  let codes;
  try{ codes = await reserveProductCodeBlock(list.length); }
  catch(e){
    st.busy = ''; st.step = 'preview';
    st.error = `Couldn't reserve product codes: ${e.message || String(e)}. Nothing was saved; try again.`;
    return renderImport();
  }
  st.importId = `imp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  st.docs = buildImportDocs(list, { codes, importId: st.importId, fileName: st.fileName, importedAt: Date.now(), newId: hooks.newId, prepFor: hooks.prepFor });
  st.saved = new Set();
  await saveRest();
}
async function saveRest(){
  st.busy = 'Saving…'; st.error = '';
  renderImport();
  const r = await saveImportBatches(st.docs, {
    alreadySaved: st.saved,
    onProgress: (done, total) => {
      st.progress = done;
      const bar = view().querySelector('.imp-progress');
      if (bar){ bar.querySelector('span').style.width = `${(done / total * 100).toFixed(1)}%`; bar.setAttribute('aria-valuenow', String(done)); }
      const txt = view().querySelector('[data-imp-progress-text]');
      if (txt) txt.textContent = `Saving ${done.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}`;
    },
  });
  const added = st.docs.filter(d => r.saved.includes(d.id));
  r.saved.forEach(id => st.saved.add(id));
  if (added.length) hooks.afterSave(added);
  st.busy = '';
  if (r.error){ st.error = r.error; renderImport(); return; }
  st.step = 'done';
  renderImport();
  window.scrollTo(0, 0);
}
function savingHtml(){
  const total = st.docs.length || 1;
  return `
    <section class="panel imp-panel">
      <h2 class="panel-title">${st.error ? 'The import stopped' : 'Importing'}</h2>
      <div class="imp-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${st.saved.size}"><span style="width:${(st.saved.size / total * 100).toFixed(1)}%"></span></div>
      <p class="imp-note" data-imp-progress-text role="status">${st.busy && !st.docs.length ? escapeHtml(st.busy) : `Saving ${st.saved.size.toLocaleString('en-US')} of ${st.docs.length.toLocaleString('en-US')}`}</p>
      ${st.error ? `
      <p class="imp-error" role="alert">${plural(st.saved.size, 'item')} of ${st.docs.length.toLocaleString('en-US')} saved, then: ${escapeHtml(st.error)}</p>
      <div class="imp-actions">
        <button type="button" class="danger-btn" data-imp-undo-current>Undo this import</button>
        <button type="button" class="primary-btn" data-imp-continue>Continue</button>
      </div>` : '<p class="imp-note">Keep this screen open until it finishes.</p>'}
    </section>`;
}
function wireSaving(){
  view().querySelector('[data-imp-continue]')?.addEventListener('click', saveRest);
  view().querySelector('[data-imp-undo-current]')?.addEventListener('click', undoCurrent);
}
async function undoCurrent(){
  const btn = view().querySelector('[data-imp-undo-current]');
  if (btn && !btn.dataset.armed){ btn.dataset.armed = '1'; btn.textContent = `Delete ${plural(st.saved.size, 'item')}?`; return; }
  if (btn){ btn.disabled = true; btn.textContent = 'Deleting…'; }
  const r = await undoImport(st.importId);
  if (r.deleted.length) hooks.afterUndo(r.deleted);
  const msg = r.error ? `Deleted ${plural(r.deleted.length, 'item')}, then it stopped: ${r.error}. Use Undo under "Past imports" to finish.` : `Import undone: ${plural(r.deleted.length, 'item')} deleted.`;
  st = fresh();
  st.undone = msg;
  renderImport();
}

// ---------- 5. Summary ----------
function doneHtml(){
  const d = st.docs;
  const sold = d.filter(i => i.status === 'vendido').length;
  const unsold = d.filter(i => i.status !== 'vendido');
  const missing = {
    photos: unsold.length,
    cost: unsold.filter(i => !i.cost).length,
    weight: unsold.filter(i => !i.weight).length,
    dimensions: unsold.filter(i => !i.length || !i.width).length,
  };
  const codes = d.length ? `${d[0].productCode} to ${d[d.length - 1].productCode}` : '';
  return `
    <section class="panel imp-panel">
      <h2 class="panel-title">${plural(d.length, 'item')} imported</h2>
      <p class="imp-note">${[`${unsold.length.toLocaleString('en-US')} in stock`, `${sold.toLocaleString('en-US')} sold`, codes ? `codes ${escapeHtml(codes)}` : ''].filter(Boolean).join(' · ')}.</p>
      <div class="imp-actions">
        <button type="button" class="primary-btn" data-imp-show>Show them in the catalog</button>
      </div>
    </section>
    ${unsold.length ? `
    <section class="panel imp-panel">
      <h2 class="panel-title">Missing on the items in stock</h2>
      <ul class="imp-missing">
        <li><b>${missing.photos.toLocaleString('en-US')}</b> without photos</li>
        <li><b>${missing.cost.toLocaleString('en-US')}</b> without cost</li>
        <li><b>${missing.weight.toLocaleString('en-US')}</b> without weight</li>
        <li><b>${missing.dimensions.toLocaleString('en-US')}</b> without dimensions</li>
      </ul>
      <p class="imp-note">Imported items have their own warning settings: by default a missing photo doesn't count as an issue for them, the rest does. Change it in Settings → Warnings → Imported items.</p>
      <button type="button" class="secondary-btn" data-imp-warnings>Warning settings</button>
    </section>` : ''}
    <section class="panel imp-panel">
      <h2 class="panel-title">Something wrong?</h2>
      <p class="imp-note">Undo deletes every item from this import. You can also do it later under "Past imports".</p>
      <div class="imp-actions">
        <button type="button" class="danger-btn" data-imp-undo-current>Undo this import</button>
        <button type="button" class="secondary-btn" data-imp-another>Import another file</button>
      </div>
    </section>`;
}
function wireDone(){
  view().querySelector('[data-imp-show]').addEventListener('click', () => hooks.openImported(st.importId));
  view().querySelector('[data-imp-warnings]')?.addEventListener('click', () => hooks.openWarnings());
  view().querySelector('[data-imp-undo-current]').addEventListener('click', undoCurrent);
  view().querySelector('[data-imp-another]').addEventListener('click', () => renderImport({ reset: true }));
}
