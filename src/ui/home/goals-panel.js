// Goals panel on Home (UI layer; v3.22.3). The progress comes from
// domain/goals.js; this file draws the panel and the editor and saves the
// list to the business settings (`appSettings.goals`). Only the owner
// edits (Home is never shown to an employee, and canEdit says so too).
// One layout for all three themes; only the theme's tokens differ.
import { appSettings } from '../../modules/state.js';
import { escapeHtml } from '../../modules/format-utils.js';
import { saveSettingsFields } from '../../data/settings-store.js';
import { GOAL_METRICS, GOAL_PERIODS, MAX_GOALS, computeGoals, normalizeGoals } from '../../domain/goals.js';

const PERIOD_LABEL = { week: 'Week', month: 'Month', quarter: 'Quarter', year: 'Year' };

function fmt(unit, n){
  if (unit === 'money') return `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (unit === 'pct') return `${n.toFixed(0)}%`;
  return Math.round(n).toLocaleString('en-US');
}

function goalRow(g){
  const pct = Math.round(g.share * 100);
  const days = `${g.daysLeft} day${g.daysLeft === 1 ? '' : 's'} left`;
  const status = g.done ? `Goal reached · ${days}`
    : `${pct}% · ${g.ahead ? 'on pace' : `${fmt(g.unit, g.behindBy)} behind pace`} · ${days}`;
  const name = `${g.label} this ${g.period}`;
  return `
    <li class="goal-row${g.done ? ' done' : ''}">
      <div class="goal-top">
        <span class="goal-name">${escapeHtml(name)}</span>
        <span class="goal-nums"><b>${fmt(g.unit, g.current)}</b> of ${fmt(g.unit, g.target)}</span>
      </div>
      <div class="goal-track" role="progressbar" aria-label="${escapeHtml(name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100, Math.max(0, pct))}" aria-valuetext="${escapeHtml(status)}">
        <span class="goal-fill" style="width:${(Math.min(1, Math.max(0, g.share)) * 100).toFixed(2)}%;"></span>
        ${g.done ? '' : `<span class="goal-pace" style="left:${(g.elapsed * 100).toFixed(2)}%;" title="Where a steady pace would be today"></span>`}
      </div>
      <div class="goal-status${g.done ? ' done' : g.ahead ? '' : ' behind'}">${escapeHtml(status)}</div>
    </li>`;
}

// The panel's markup; '' when there's nothing to show this person.
export function goalsPanelHtml(items, { canEdit = false, now = Date.now() } = {}){
  const goals = computeGoals(items, appSettings.goals, now);
  if (!goals.length && !canEdit) return '';
  const body = goals.length
    ? `<ul class="goal-list">${goals.map(goalRow).join('')}</ul>`
    : `<div class="goal-empty">
        <p>Set a target for profit, revenue, sales, cataloging or sell-through, by week, month, quarter or year.</p>
        <button type="button" class="secondary-btn" data-goals-edit>Set a goal</button>
      </div>`;
  return `
    <section class="panel goals" aria-label="Goals">
      <div class="panel-head">
        <h2 class="panel-title">Goals</h2>
        ${canEdit && goals.length ? `<span class="panel-meta"><button type="button" class="link-btn" data-goals-edit>Edit</button></span>` : ''}
      </div>
      ${body}
    </section>`;
}

export function wireGoalsPanel(view, { onSaved = () => {} } = {}){
  view.querySelectorAll('[data-goals-edit]').forEach(btn => btn.addEventListener('click', () => openGoalsEditor(onSaved)));
}

// ---------- EDITOR ----------
let rowSeq = 0;
function newId(){
  return 'g_' + Date.now().toString(36) + '_' + (rowSeq++).toString(36);
}

function editorRow(g){
  const opts = (list, cur, label) => list.map(v => `<option value="${v}"${v === cur ? ' selected' : ''}>${label(v)}</option>`).join('');
  const unit = GOAL_METRICS[g.metric].unit;
  return `
    <fieldset class="goal-edit" data-goal-id="${escapeHtml(g.id)}">
      <legend class="sr-only">Goal</legend>
      <label class="goal-field"><span>Measure</span>
        <select data-k="metric">${opts(Object.keys(GOAL_METRICS), g.metric, k => GOAL_METRICS[k].short || GOAL_METRICS[k].label)}</select></label>
      <label class="goal-field"><span>Period</span>
        <select data-k="period">${opts(GOAL_PERIODS, g.period, p => PERIOD_LABEL[p])}</select></label>
      <label class="goal-field goal-target"><span>Target</span>
        <span class="goal-input"><span class="goal-affix" data-affix="pre">${unit === 'money' ? '$' : ''}</span><input type="number" data-k="target" inputmode="decimal" min="0" step="any" value="${g.target || ''}" placeholder="0"><span class="goal-affix" data-affix="post">${unit === 'pct' ? '%' : ''}</span></span></label>
      <button type="button" class="row-btn danger" data-goal-remove aria-label="Remove this goal">Remove</button>
    </fieldset>`;
}

export function openGoalsEditor(onSaved){
  const start = normalizeGoals(appSettings.goals);
  const dlg = document.createElement('dialog');
  dlg.className = 'goal-dialog';
  dlg.setAttribute('aria-labelledby', 'goalDialogTitle');
  dlg.innerHTML = `
    <form method="dialog" class="goal-form" novalidate>
      <h2 id="goalDialogTitle">Goals</h2>
      <p class="goal-hint">Up to ${MAX_GOALS}. Each one starts again from zero when its period begins.</p>
      <div class="goal-rows">${(start.length ? start : [{ id: newId(), metric: 'profit', period: 'month', target: '' }]).map(editorRow).join('')}</div>
      <button type="button" class="secondary-btn goal-add" data-goal-add>Add a goal</button>
      <p class="goal-error" role="alert" hidden></p>
      <div class="goal-actions">
        <button type="button" class="secondary-btn" data-goal-cancel>Cancel</button>
        <button type="submit" class="primary-btn" data-goal-save>Save</button>
      </div>
    </form>`;
  document.body.appendChild(dlg);

  const rows = dlg.querySelector('.goal-rows');
  const addBtn = dlg.querySelector('[data-goal-add]');
  const error = dlg.querySelector('.goal-error');
  const refreshAdd = () => { addBtn.disabled = rows.children.length >= MAX_GOALS; };
  const showError = (msg) => { error.textContent = msg; error.hidden = !msg; };
  refreshAdd();

  rows.addEventListener('change', (e) => {
    if (e.target.dataset.k !== 'metric') return;
    const unit = GOAL_METRICS[e.target.value].unit;
    const set = e.target.closest('.goal-edit');
    set.querySelector('[data-affix="pre"]').textContent = unit === 'money' ? '$' : '';
    set.querySelector('[data-affix="post"]').textContent = unit === 'pct' ? '%' : '';
  });
  rows.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-goal-remove]');
    if (!rm) return;
    rm.closest('.goal-edit').remove();
    refreshAdd();
  });
  addBtn.addEventListener('click', () => {
    if (rows.children.length >= MAX_GOALS) return;
    rows.insertAdjacentHTML('beforeend', editorRow({ id: newId(), metric: 'sold', period: 'month', target: '' }));
    refreshAdd();
    rows.lastElementChild.querySelector('select').focus();
  });
  dlg.querySelector('[data-goal-cancel]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => dlg.remove());

  dlg.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const goals = [];
    for (const set of rows.querySelectorAll('.goal-edit')){
      const metric = set.querySelector('[data-k="metric"]').value;
      const period = set.querySelector('[data-k="period"]').value;
      const raw = set.querySelector('[data-k="target"]').value.trim();
      const target = Math.round(parseFloat(raw) * 100) / 100;
      if (!raw){
        set.querySelector('[data-k="target"]').focus();
        return showError('Enter a target for every goal, or remove it.');
      }
      if (!(target > 0)) return showError('Targets must be more than zero.');
      if (metric === 'sellThrough' && target > 100) return showError('Sell-through can be 100% at most.');
      goals.push({ id: set.dataset.goalId, metric, period, target });
    }
    const saveBtn = dlg.querySelector('[data-goal-save]');
    saveBtn.disabled = true;
    showError('');
    const ok = await saveSettingsFields({ goals: normalizeGoals(goals) });
    saveBtn.disabled = false;
    if (!ok) return showError("Couldn't save. Check your connection and try again.");
    dlg.close();
    onSaved();
  });

  dlg.showModal();
}
