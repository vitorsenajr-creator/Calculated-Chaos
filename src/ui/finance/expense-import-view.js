// Finances → Expenses → Import (UI layer; v3.23.7). A step-by-step dialog:
// file → columns → category words → preview → save (in batches, with
// Continue after a failure and Undo from the Expenses tab). The rules are
// in domain/expense-import.js; the writes in data/expense-store.js; the
// file reader is platform/sheetjs.js (the spreadsheet import's). Owner
// only (the caller checks). Tokens only.
import { escapeHtml } from '../../modules/format-utils.js';
import { readSpreadsheet } from '../../platform/sheetjs.js';
import { findHeaderRow, normalizeText } from '../../domain/import-sheet.js';
import { EXPENSE_CATEGORIES, categoryLabel } from '../../domain/expenses.js';
import {
  MAX_EXPENSE_ROWS, EXPENSE_COLUMNS, COLUMN_LABEL, SKIP, suggestExpenseMapping, categoryWords,
  buildExpenseRows, defaultIncluded, rowsToSave, previewTotals, buildExpenseDocs, expenseDateOrder, templateRows,
} from '../../domain/expense-import.js';
import { cachedExpenses, saveExpenseBatches, newExpenseId } from '../../data/expense-store.js';
import { showToast } from '../toast.js';

const STEPS = ['file', 'columns', 'categories', 'preview', 'save'];
const STEP_LABEL = { file: 'File', columns: 'Columns', categories: 'Categories', preview: 'Preview', save: 'Save' };
// Our own CSV exports end with this line; it isn't a row.
const FOOTER_RE = /^Exported from Calculated Chaos/i;

function money2(n){
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function openExpenseImport({ uid = null, downloadCsv = () => {}, onDone = () => {} } = {}){
  const st = {
    step: 'file', fileName: '', sheets: [], sheetIdx: 0, headers: [], rows: [], firstRow: 2,
    mapping: null, dateOrder: 'mdy', words: [], categoryMap: {}, built: [], included: new Set(),
    docs: null, saved: new Set(), error: '', saving: false, done: false,
  };
  const dlg = document.createElement('dialog');
  dlg.className = 'goal-dialog exp-dialog imp-dialog';
  dlg.setAttribute('aria-labelledby', 'expImpTitle');
  document.body.appendChild(dlg);

  const stepper = () => `
    <ol class="imp-steps" aria-label="Steps">${STEPS.map((s, i) => `
      <li class="${s === st.step ? 'on' : STEPS.indexOf(st.step) > i ? 'done' : ''}"${s === st.step ? ' aria-current="step"' : ''}>${STEP_LABEL[s]}</li>`).join('')}</ol>`;
  const errorBox = () => `<p class="goal-error" role="alert"${st.error ? '' : ' hidden'}>${escapeHtml(st.error)}</p>`;
  const catOptions = (sel) => EXPENSE_CATEGORIES.map(c => `<option value="${c.key}"${c.key === sel ? ' selected' : ''}>${escapeHtml(c.label)}</option>`).join('')
    + `<option value="${SKIP}"${sel === SKIP ? ' selected' : ''}>Skip (personal)</option>`;

  function render(){
    let body = '', actions = '';
    if (st.step === 'file'){
      body = `
        <p class="goal-hint">A CSV or Excel file with one expense per row. Columns: <b>Date</b>, <b>Category</b>, <b>Amount</b>, and optionally <b>Description</b> and <b>Distance</b> (miles). A negative amount is a refund; a row with miles and no amount is a trip at the IRS rate of its date.</p>
        <label class="imp-file"><input type="file" data-imp-file accept=".csv,.tsv,.txt,.xlsx,.xls,.ods,text/csv"><span class="primary-btn">Choose a file</span></label>
        ${st.sheets.length > 1 ? `<label class="goal-field"><span>Sheet</span><select data-imp-sheet>${st.sheets.map((s, i) => `<option value="${i}"${i === st.sheetIdx ? ' selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}</select></label>` : ''}
        <p class="imp-template"><button type="button" class="link-btn" data-imp-template>Download a template</button> with an example expense, refund and trip.</p>
        ${errorBox()}`;
      actions = `<button type="button" class="secondary-btn" data-imp-cancel>Cancel</button>`;
    }
    if (st.step === 'columns'){
      const sample = (i) => {
        const v = st.rows.find(r => String(r[i] ?? '').trim() !== '');
        return v ? String(v[i]).slice(0, 24) : '';
      };
      const opts = (k) => `<option value="-1">— Not in the file —</option>` + st.headers.map((h, i) => `<option value="${i}"${st.mapping[k] === i ? ' selected' : ''}>${escapeHtml(h || `Column ${i + 1}`)}${sample(i) ? ` (e.g. ${escapeHtml(sample(i))})` : ''}</option>`).join('');
      body = `
        <p class="goal-hint">${escapeHtml(st.fileName)} · ${st.rows.length} row${st.rows.length === 1 ? '' : 's'}. Check which column holds each value.</p>
        <div class="imp-cols">${EXPENSE_COLUMNS.map(k => `
          <label class="goal-field"><span>${COLUMN_LABEL[k]}${k === 'description' || k === 'distance' ? ' <small>(optional)</small>' : ''}</span>
            <select data-imp-col="${k}">${opts(k)}</select></label>`).join('')}
          <label class="goal-field"><span>Dates are written</span>
            <select data-imp-order><option value="mdy"${st.dateOrder === 'mdy' ? ' selected' : ''}>Month first (10/03/2026 = Oct 3)</option><option value="dmy"${st.dateOrder === 'dmy' ? ' selected' : ''}>Day first (10/03/2026 = Mar 10)</option></select></label>
        </div>
        ${errorBox()}`;
      actions = `<button type="button" class="secondary-btn" data-imp-back>Back</button><button type="button" class="primary-btn" data-imp-next>Next</button>`;
    }
    if (st.step === 'categories'){
      const unknown = st.words.filter(w => !w.known);
      const known = st.words.filter(w => w.known);
      const row = (w) => `
        <label class="imp-word"><span class="imp-word-name">${escapeHtml(w.word)} <small>${w.count} row${w.count === 1 ? '' : 's'}</small></span>
          <select data-imp-word="${escapeHtml(normalizeText(w.word))}">${catOptions(st.categoryMap[normalizeText(w.word)])}</select></label>`;
      body = st.mapping.category < 0
        ? `<p class="goal-hint">The file has no category column, so every row comes in as <b>Other</b>. You can change categories after the import.</p>`
        : `
        <p class="goal-hint">${unknown.length ? `Pick a category for the words the app didn’t recognize. Choose <b>Skip (personal)</b> for rows that aren’t business expenses.` : 'Every category word was recognized. Check them below if you like.'}</p>
        ${unknown.length ? `<div class="imp-words">${unknown.map(row).join('')}</div>` : ''}
        ${known.length ? `<details class="imp-known"${unknown.length ? '' : ' open'}><summary>${known.length} word${known.length === 1 ? '' : 's'} matched automatically</summary><div class="imp-words">${known.map(row).join('')}</div></details>` : ''}`;
      actions = `<button type="button" class="secondary-btn" data-imp-back>Back</button><button type="button" class="primary-btn" data-imp-next>Preview</button>`;
    }
    if (st.step === 'preview'){
      const list = rowsToSave(st.built, st.included);
      const t = previewTotals(list);
      const errors = st.built.filter(b => b.status === 'error');
      const skipped = st.built.filter(b => b.status === 'skip').length;
      const oks = st.built.map((b, i) => ({ b, i })).filter(x => x.b.status === 'ok');
      const dups = oks.filter(x => x.b.duplicate).length;
      const line = (x) => {
        const e = x.b.expense;
        return `
          <label class="imp-row${x.b.duplicate ? ' dup' : ''}">
            <input type="checkbox" data-imp-inc="${x.i}"${st.included.has(x.i) ? ' checked' : ''}>
            <span class="imp-row-text"><span>${escapeHtml(categoryLabel(e.category))}${e.kind === 'refund' ? ' <span class="exp-tag">Refund</span>' : ''}${x.b.duplicate ? ' <span class="missing-tag">Possible duplicate</span>' : ''}</span>
              <small>Row ${x.b.row} · ${e.date}${e.miles > 0 ? ` · ${e.miles} mi` : ''}${e.description ? ' · ' + escapeHtml(e.description) : ''}</small></span>
            <span class="imp-row-amt">${money2(e.kind === 'refund' ? -e.amount : e.amount)}</span>
          </label>`;
      };
      body = `
        <div class="imp-summary" aria-live="polite">
          <div class="fin-big" data-imp-total>${money2(t.total)}<small> · ${t.count} to import${t.refunds ? ` · ${t.refunds} refund${t.refunds === 1 ? '' : 's'}` : ''}${t.trips ? ` · ${t.trips} trip${t.trips === 1 ? '' : 's'}` : ''}</small></div>
          <p class="goal-hint">${skipped ? `${skipped} skipped as personal. ` : ''}${dups ? `${dups} possible duplicate${dups === 1 ? '' : 's'} left unticked. ` : ''}${errors.length ? `${errors.length} row${errors.length === 1 ? '' : 's'} can’t be read and won’t be imported.` : ''}</p>
          ${t.byCategory.length ? `<div class="imp-cats">${t.byCategory.map(c => `<span class="cost-chip">${escapeHtml(categoryLabel(c.key))} ${money2(c.amount)}</span>`).join('')}</div>` : ''}
        </div>
        ${errors.length ? `<details class="imp-errors"><summary>${errors.length} row${errors.length === 1 ? '' : 's'} with problems</summary><ul>${errors.slice(0, 100).map(b => `<li>Row ${b.row}: ${escapeHtml(b.error)}</li>`).join('')}${errors.length > 100 ? `<li>…and ${errors.length - 100} more</li>` : ''}</ul></details>` : ''}
        <div class="imp-rows">${oks.slice(0, 300).map(line).join('')}${oks.length > 300 ? `<p class="goal-hint">…and ${oks.length - 300} more rows, included.</p>` : ''}</div>
        ${errorBox()}`;
      actions = `<button type="button" class="secondary-btn" data-imp-back>Back</button><button type="button" class="primary-btn" data-imp-save${t.count ? '' : ' disabled'}>Import ${t.count} expense${t.count === 1 ? '' : 's'}</button>`;
    }
    if (st.step === 'save'){
      const total = st.docs ? st.docs.length : 0;
      body = st.done
        ? `<p class="exp-saved">Imported ${total} expense${total === 1 ? '' : 's'} from ${escapeHtml(st.fileName)}.</p><p class="goal-hint">You can undo it from the Expenses tab for a week.</p>`
        : `<p class="goal-hint" aria-live="polite">${st.saving ? `Saving… ${st.saved.size} of ${total}` : `Saved ${st.saved.size} of ${total}.`}</p>
           <progress max="${total}" value="${st.saved.size}"></progress>${errorBox()}`;
      actions = st.done ? `<button type="button" class="primary-btn" data-imp-close>Done</button>`
        : st.saving ? '' : `<button type="button" class="secondary-btn" data-imp-close>Close</button><button type="button" class="primary-btn" data-imp-continue>Continue</button>`;
    }
    dlg.innerHTML = `
      <form method="dialog" class="goal-form" novalidate>
        <h2 id="expImpTitle">Import expenses</h2>
        ${stepper()}
        <div class="imp-body">${body}</div>
        <div class="goal-actions exp-dialog-actions">${actions}</div>
      </form>`;
    wire();
  }

  async function loadFile(file){
    st.error = '';
    try{
      const sheets = (await readSpreadsheet(file)).filter(s => s.aoa.some(r => r.some(c => String(c ?? '').trim() !== '')));
      if (!sheets.length){ st.error = 'That file has no rows.'; return render(); }
      st.fileName = file.name;
      st.sheets = sheets;
      st.sheetIdx = 0;
      useSheet();
    }catch(e){
      st.error = (e && e.message) || 'Couldn’t read that file.';
      render();
    }
  }

  function useSheet(){
    const aoa = st.sheets[st.sheetIdx].aoa;
    const h = findHeaderRow(aoa);
    st.headers = (aoa[h] || []).map(c => String(c ?? '').trim());
    st.firstRow = h + 2;
    st.rows = aoa.slice(h + 1)
      .filter(r => r.some(c => String(c ?? '').trim() !== ''))
      .filter(r => !FOOTER_RE.test(String(r[0] ?? '')));
    if (!st.rows.length){ st.error = 'That sheet has headers but no rows.'; st.step = 'file'; return render(); }
    if (st.rows.length > MAX_EXPENSE_ROWS){ st.error = `That file has ${st.rows.length.toLocaleString('en-US')} rows; the limit is ${MAX_EXPENSE_ROWS.toLocaleString('en-US')}. Split it and import each part.`; st.step = 'file'; return render(); }
    st.mapping = suggestExpenseMapping(st.headers);
    st.dateOrder = expenseDateOrder(st.rows, st.mapping);
    st.step = 'columns';
    render();
  }

  function toCategories(){
    if (st.mapping.date < 0){ st.error = 'Pick the column with the date.'; return render(); }
    if (st.mapping.amount < 0 && st.mapping.distance < 0){ st.error = 'Pick the column with the amount (or the distance, for trips).'; return render(); }
    st.error = '';
    st.words = st.mapping.category >= 0 ? categoryWords(st.rows, st.mapping.category) : [];
    st.words.forEach(w => {
      const k = normalizeText(w.word);
      if (!(k in st.categoryMap)) st.categoryMap[k] = w.suggested || 'other';
    });
    st.step = 'categories';
    render();
  }

  function toPreview(){
    st.built = buildExpenseRows(st.rows, { mapping: st.mapping, categoryMap: st.categoryMap, dateOrder: st.dateOrder, existing: cachedExpenses(), firstRow: st.firstRow });
    st.included = defaultIncluded(st.built);
    st.error = '';
    st.step = 'preview';
    render();
  }

  async function save(){
    if (!st.docs){
      const importId = 'imp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      st.docs = buildExpenseDocs(rowsToSave(st.built, st.included), { importId, fileName: st.fileName, uid, newId: newExpenseId });
    }
    st.step = 'save';
    st.saving = true;
    st.error = '';
    render();
    const r = await saveExpenseBatches(st.docs, {
      alreadySaved: st.saved,
      onProgress: (done, total) => {
        const p = dlg.querySelector('progress');
        if (p) p.value = done;
        const h = dlg.querySelector('.imp-body .goal-hint');
        if (h) h.textContent = `Saving\u2026 ${done} of ${total}`;
      },
    });
    r.saved.forEach(id => st.saved.add(id));
    st.saving = false;
    if (r.saved.length) onDone();
    if (r.error){
      st.error = `The connection dropped after ${st.saved.size} of ${st.docs.length}. Continue saves the rest without duplicates.`;
    } else {
      st.done = true;
      showToast(`Imported ${st.docs.length} expense${st.docs.length === 1 ? '' : 's'}`);
    }
    render();
  }

  function wire(){
    const q = (s) => dlg.querySelector(s);
    const file = q('[data-imp-file]');
    if (file) file.addEventListener('change', () => { if (file.files[0]) loadFile(file.files[0]); });
    const sheet = q('[data-imp-sheet]');
    if (sheet) sheet.addEventListener('change', () => { st.sheetIdx = Number(sheet.value); useSheet(); });
    const tpl = q('[data-imp-template]');
    if (tpl) tpl.addEventListener('click', () => downloadCsv('calculated-chaos-expenses-template.csv', templateRows()));
    dlg.querySelectorAll('[data-imp-col]').forEach(s => s.addEventListener('change', () => { st.mapping[s.dataset.impCol] = Number(s.value); }));
    const order = q('[data-imp-order]');
    if (order) order.addEventListener('change', () => { st.dateOrder = order.value; });
    dlg.querySelectorAll('[data-imp-word]').forEach(s => s.addEventListener('change', () => { st.categoryMap[s.dataset.impWord] = s.value; }));
    dlg.querySelectorAll('[data-imp-inc]').forEach(c => c.addEventListener('change', () => {
      const i = Number(c.dataset.impInc);
      if (c.checked) st.included.add(i); else st.included.delete(i);
      // Only the totals change (no re-render, so the list keeps its scroll).
      const t = previewTotals(rowsToSave(st.built, st.included));
      q('[data-imp-total]').innerHTML = `${money2(t.total)}<small> · ${t.count} to import${t.refunds ? ` · ${t.refunds} refund${t.refunds === 1 ? '' : 's'}` : ''}${t.trips ? ` · ${t.trips} trip${t.trips === 1 ? '' : 's'}` : ''}</small>`;
      const btn = q('[data-imp-save]');
      btn.textContent = `Import ${t.count} expense${t.count === 1 ? '' : 's'}`;
      btn.disabled = !t.count;
    }));
    const back = q('[data-imp-back]');
    if (back) back.addEventListener('click', () => {
      st.error = '';
      st.step = STEPS[Math.max(0, STEPS.indexOf(st.step) - 1)];
      render();
    });
    const next = q('[data-imp-next]');
    if (next) next.addEventListener('click', () => (st.step === 'columns' ? toCategories() : toPreview()));
    const sv = q('[data-imp-save]');
    if (sv) sv.addEventListener('click', save);
    const cont = q('[data-imp-continue]');
    if (cont) cont.addEventListener('click', save);
    dlg.querySelectorAll('[data-imp-cancel], [data-imp-close]').forEach(b => b.addEventListener('click', () => dlg.close()));
  }

  dlg.addEventListener('cancel', (e) => { if (st.saving) e.preventDefault(); });
  dlg.addEventListener('close', () => dlg.remove());
  render();
  dlg.showModal();
}
