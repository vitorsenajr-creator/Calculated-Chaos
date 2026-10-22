// Stock → Pick → Activity log (v3.27.7): who did what in Pick, a month at a
// time, for the owner. Read-only.
import { escapeHtml } from '../../modules/format-utils.js';
import { loadPickLog } from '../../data/pick-log-store.js';
import { describeEntry, filterLog, logUsers, monthOf } from '../../domain/pick-log.js';

const TYPE_LABEL = { screenshot: 'Screenshot', sold: 'Sold', clear: 'Cleared', checklist: 'Checklist' };

export function openPickLog(){
  const dlg = document.createElement('dialog');
  dlg.className = 'goal-dialog sale-sheet ps-sheet';
  dlg.setAttribute('aria-labelledby', 'plTitle');
  dlg.innerHTML = `
    <form method="dialog" class="goal-form" novalidate>
      <h2 id="plTitle">Pick activity log</h2>
      <p class="ps-desc">Every screenshot read, sale recorded, list cleared and checklist shared in Pick, by person. Entries can't be edited or removed.</p>
      <div class="stock-form-row">
        <label class="goal-field"><span>Month</span><input type="month" data-pl-month></label>
        <label class="goal-field"><span>Person</span><select data-pl-user><option value="">Everyone</option></select></label>
      </div>
      <div data-pl-body role="status" aria-live="polite"></div>
      <div class="goal-actions exp-dialog-actions"><button type="button" class="secondary-btn" data-pl-close>Close</button></div>
    </form>`;
  document.body.appendChild(dlg);
  const monthEl = dlg.querySelector('[data-pl-month]');
  const userEl = dlg.querySelector('[data-pl-user]');
  const body = dlg.querySelector('[data-pl-body]');
  monthEl.value = monthOf(Date.now());
  let entries = [];
  let token = 0;

  const draw = () => {
    const list = filterLog(entries, userEl.value);
    body.innerHTML = list.length ? `<ul class="pl-list">${list.map(e => `
      <li class="pl-row">
        <div class="pl-meta"><span class="pick-badge">${escapeHtml(TYPE_LABEL[e.type] || e.type)}</span>
          <span>${escapeHtml(new Date(e.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</span>
          <span>${escapeHtml(e.email || e.uid)}</span></div>
        <div>${escapeHtml(describeEntry(e))}</div>
      </li>`).join('')}</ul>` : '<p class="ps-desc">Nothing logged in this month.</p>';
  };
  const load = async () => {
    const mine = ++token;
    body.textContent = 'Loading…';
    try{
      const got = await loadPickLog(monthEl.value);
      if (mine !== token) return;
      entries = got;
      const keep = userEl.value;
      userEl.innerHTML = '<option value="">Everyone</option>' + logUsers(entries).map(u => `<option value="${escapeHtml(u.uid)}">${escapeHtml(u.email)}</option>`).join('');
      userEl.value = logUsers(entries).some(u => u.uid === keep) ? keep : '';
      draw();
    }catch(e){
      if (mine !== token) return;
      console.warn('Could not load the Pick log:', e);
      body.innerHTML = '<p class="goal-error" role="alert">Couldn’t load the log. Check your connection, and that the pick_log rule is published in the Firebase Console.</p>';
    }
  };
  monthEl.addEventListener('change', load);
  userEl.addEventListener('change', draw);
  dlg.querySelector('[data-pl-close]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
  load();
}
