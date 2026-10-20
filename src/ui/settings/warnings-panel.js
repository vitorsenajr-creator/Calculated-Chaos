// Settings → Warnings (v3.22.4): which optional checks count as an item
// issue (domain/item-issues.js) for the whole business. The same checks
// drive the catalog's Issues chip, the card warning and Home's "Needs
// attention". Saved as they change (only `issueChecks`), then
// `issuecheckschange` tells main.js to redraw.
import { appSettings } from '../../modules/state.js';
import { saveSettingsFields } from '../../data/settings-store.js';
import { normalizeIssueChecks, MISSING_PARTS, STALE_DAY_OPTIONS } from '../../domain/item-issues.js';

const PART_LABEL = {
  photos: ['Photos', 'At least one photo'],
  cost: ['Cost', 'What you paid for the item'],
  weight: ['Weight', 'Needed for shipping estimates'],
  dimensions: ['Dimensions', 'Length and width'],
};

export function warningsSummary(){
  const c = normalizeIssueChecks(appSettings.issueChecks);
  const parts = MISSING_PARTS.filter(k => c[k]).length;
  return `${parts} of ${MISSING_PARTS.length} info checks · ${c.staleDays ? `${c.staleDays}+ days listed` : 'listing age off'}`;
}

export function warningsPageHtml(){
  const c = normalizeIssueChecks(appSettings.issueChecks);
  return `
      <div class="settings-section">
        <h3>Always checked</h3>
        <div class="ss-desc">An item with any of these shows in the catalog's Issues filter, with a warning on its card, and in Home's "Needs attention".</div>
        <ul class="warn-always">
          <li>No price</li>
          <li>The last eBay publish failed</li>
          <li>The same product code on more than one item</li>
        </ul>
      </div>
      <div class="settings-section">
        <h3>Missing info</h3>
        <div class="ss-desc">Turn off what you don't record, so it doesn't count as missing.</div>
        ${MISSING_PARTS.map(k => `
        <div class="settings-row">
          <div><div class="sr-label">${PART_LABEL[k][0]}</div><div class="sr-sub">${PART_LABEL[k][1]}</div></div>
          <input type="checkbox" data-issue-check="${k}" aria-label="Check ${PART_LABEL[k][0].toLowerCase()}" ${c[k] ? 'checked' : ''}>
        </div>`).join('')}
      </div>
      <div class="settings-section" id="warningsImported">
        <h3>Imported items</h3>
        <div class="ss-desc">The same checks for items that came from a spreadsheet import, which usually have no photos. A check that's off here doesn't count as missing on those items; items cataloged in the app keep the checks above.</div>
        ${MISSING_PARTS.map(k => `
        <div class="settings-row">
          <div><div class="sr-label">${PART_LABEL[k][0]}</div></div>
          <input type="checkbox" data-issue-check-imported="${k}" aria-label="Check ${PART_LABEL[k][0].toLowerCase()} on imported items" ${c.imported[k] ? 'checked' : ''}>
        </div>`).join('')}
      </div>
      <div class="settings-section">
        <h3>Listed a long time</h3>
        <div class="ss-desc">Flags unsold items listed this long (since the eBay listing date, or since cataloging for other platforms).</div>
        <div class="settings-row">
          <div><div class="sr-label">Flag after</div></div>
          <select id="sStaleDays" aria-label="Flag listings after">
            ${STALE_DAY_OPTIONS.map(d => `<option value="${d}"${c.staleDays === d ? ' selected' : ''}>${d} days</option>`).join('')}
            <option value="0"${c.staleDays === 0 ? ' selected' : ''}>Off</option>
          </select>
        </div>
        <div class="settings-success" id="warningsSaveMsg" role="status">Saved</div>
      </div>`;
}

export function wireWarningsPanel(){
  const msg = document.getElementById('warningsSaveMsg');
  const inputs = document.querySelectorAll('[data-issue-check], [data-issue-check-imported], #sStaleDays');
  const save = async () => {
    const next = normalizeIssueChecks({
      ...Object.fromEntries([...document.querySelectorAll('[data-issue-check]')].map(el => [el.dataset.issueCheck, el.checked])),
      staleDays: Number(document.getElementById('sStaleDays').value),
      imported: Object.fromEntries([...document.querySelectorAll('[data-issue-check-imported]')].map(el => [el.dataset.issueCheckImported, el.checked])),
    });
    const ok = await saveSettingsFields({ issueChecks: next });
    if (msg){
      msg.textContent = ok ? 'Saved' : "Couldn't save. Check your connection and try again.";
      msg.classList.toggle('error', !ok);
      msg.style.display = 'block';
      clearTimeout(msg._t);
      if (ok) msg._t = setTimeout(() => { msg.style.display = 'none'; }, 1800);
    }
    if (ok) document.dispatchEvent(new CustomEvent('issuecheckschange'));
  };
  inputs.forEach(el => el.addEventListener('change', save));
}
