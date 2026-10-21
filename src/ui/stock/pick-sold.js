// Stock → Pick: "Mark sold" (UI layer; v3.24.4). A sheet listing the
// pieces the screenshots matched that aren't sold yet, prefilled with the
// screenshot's price and platform and the order's fee split by price.
// Pieces matched by name with doubt, or with two sales on them, start
// unticked. Saving writes only the sale fields (data/pick-sale-store.js),
// one piece at a time, then ends an app-made eBay listing for a piece
// that sold elsewhere, like the item modal's Sold does.
import { escapeHtml } from '../../modules/format-utils.js';
import { orderFeeShares, pickSaleFields } from '../../domain/pick-sale.js';
import { showToast } from '../toast.js';

const money2 = (n) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;
const v2 = (n) => (n === null || n === undefined || n === '' ? '' : Number(n).toFixed(2));

// Rows the sheet offers: matched, not sold in the app, not recorded yet.
export function sellableRows(pl){
  return pl.boxes.flatMap(b => b.rows).filter(r => r.item && !r.alreadySold && !r.recorded);
}

// Ticked by default only when the match is sure.
function sure(r){
  if (r.soldTwice) return false;
  return ['sku', 'legacy', 'manual'].includes(r.match.how) || (r.match.how === 'name' && r.match.confidence === 'high');
}

// hooks: { platformKeys(), platformLabel(k), fee(platform, price),
//          markSold(item, fields) → { ok, ebay: 'ended'|'failed'|null }, onChange() }
export function openMarkSold(pl, allLines, hooks){
  const rows = sellableRows(pl);
  if (!rows.length) return;
  const keys = hooks.platformKeys();
  // An order the AI couldn't place takes the platform its pieces were
  // already recorded with.
  const recordedOn = new Map();
  pl.boxes.flatMap(b => b.rows).filter(r => r.recorded && r.item.soldPlatform)
    .forEach(r => recordedOn.set(r.line.orderRef, r.item.soldPlatform));
  const platformOf = (l) => l.platform || recordedOn.get(l.orderRef) || '';
  const dlg = document.createElement('dialog');
  dlg.className = 'goal-dialog sale-sheet ps-sheet';
  dlg.setAttribute('aria-labelledby', 'psTitle');
  const rowHtml = (r) => {
    const l = r.line;
    const why = r.soldTwice ? 'Two sales point to this item. Check both orders first.'
      : r.match.how === 'name' && r.match.confidence !== 'high' ? 'Matched by name. Check it’s the right piece.' : '';
    return `
      <fieldset class="ps-row" data-ps-row="${escapeHtml(l.key)}">
        <legend class="visually-hidden">${escapeHtml(r.item.productCode || r.item.name || '')}</legend>
        <label class="ps-head">
          <input type="checkbox" data-ps-on ${sure(r) ? 'checked' : ''}>
          <span><b class="pick-code">${escapeHtml(r.item.productCode || '')}</b> ${escapeHtml(r.item.name || l.title)}</span>
        </label>
        ${why ? `<p class="pick-note">${why}</p>` : ''}
        <div class="ps-fields">
          <label class="goal-field"><span>Price</span>
            <span class="goal-input"><span class="goal-affix">$</span><input type="text" data-k="price" inputmode="decimal" autocomplete="off" value="${v2(l.price)}"></span></label>
          <label class="goal-field"><span>Sold on</span>
            <select data-k="platform">
              <option value="">Pick one</option>
              ${keys.map(k => `<option value="${escapeHtml(k)}" ${platformOf(l) === k ? 'selected' : ''}>${escapeHtml(hooks.platformLabel(k))}</option>`).join('')}
            </select></label>
          <label class="goal-field"><span>Fee</span>
            <span class="goal-input"><span class="goal-affix">$</span><input type="text" data-k="fee" inputmode="decimal" autocomplete="off"></span></label>
          <label class="goal-field"><span>Shipping paid</span>
            <span class="goal-input"><span class="goal-affix">$</span><input type="text" data-k="shippingCost" inputmode="decimal" autocomplete="off" value="0.00"></span></label>
        </div>
        <p class="ps-profit">Sales profit <b data-ps-profit aria-live="polite"></b></p>
        <p class="goal-error" data-ps-error role="alert" hidden></p>
      </fieldset>`;
  };
  dlg.innerHTML = `
    <form method="dialog" class="goal-form" novalidate>
      <h2 id="psTitle">Mark sold</h2>
      <p class="ps-desc">Records each ticked sale on its item: price, platform, fee and profit, plus the order number so it can't be recorded twice. A bundle's fee is worked out on the order total and split by price.</p>
      <div class="ps-list">${rows.map(rowHtml).join('')}</div>
      <div class="goal-actions exp-dialog-actions">
        <p class="goal-error" data-ps-all-error role="alert" hidden></p>
        <button type="button" class="secondary-btn" data-ps-cancel>Cancel</button>
        <button type="submit" class="primary-btn" data-ps-save></button>
      </div>
    </form>`;
  document.body.appendChild(dlg);

  const byKey = new Map(rows.map(r => [r.line.key, r]));
  const rowEl = (key) => dlg.querySelector(`[data-ps-row="${CSS.escape(key)}"]`);
  const field = (key, k) => rowEl(key).querySelector(`[data-k="${k}"]`);
  const manualFee = new Set();
  const input = (key) => ({ price: field(key, 'price').value, platform: field(key, 'platform').value, fee: field(key, 'fee').value, shippingCost: field(key, 'shippingCost').value });

  // Every line of the same order counts toward its fee, even one not
  // offered here (sold already, or not found).
  function refreshFees(orderRef){
    const keysOfOrder = allLines.filter(l => l.orderRef === orderRef).map(l => l.key);
    const groupLines = allLines.filter(l => l.orderRef === orderRef).map(l => {
      const el = byKey.has(l.key) ? rowEl(l.key) : null;
      const p = el ? parseFloat(field(l.key, 'price').value) : l.price;
      return { key: l.key, price: Number.isFinite(p) ? p : null };
    });
    // One platform per order: the first row's choice.
    const first = keysOfOrder.find(k => byKey.has(k));
    const platform = first ? field(first, 'platform').value : null;
    const shares = orderFeeShares(groupLines, platform, hooks.fee);
    keysOfOrder.filter(k => byKey.has(k) && !manualFee.has(k)).forEach(k => {
      // A saved row keeps no inputs; its price still counts above.
      field(k, 'fee').value = shares.has(k) ? shares.get(k).toFixed(2) : '';
      refreshProfit(k);
    });
  }
  function refreshProfit(key){
    const r = byKey.get(key);
    const c = pickSaleFields(r.item, input(key), r.line, Date.now());
    rowEl(key).querySelector('[data-ps-profit]').textContent = c.ok && c.fields.netProfit !== null ? money2(c.fields.netProfit) : '—';
  }
  function refreshCount(){
    const n = dlg.querySelectorAll('[data-ps-on]:checked').length;
    const btn = dlg.querySelector('[data-ps-save]');
    btn.textContent = `Mark ${n} sold`;
    btn.disabled = !n;
    dlg.querySelectorAll('[data-ps-row]').forEach(el => el.classList.toggle('off', !el.querySelector('[data-ps-on]').checked));
  }

  rows.forEach(r => {
    const key = r.line.key;
    const el = rowEl(key);
    el.querySelector('[data-ps-on]').addEventListener('change', refreshCount);
    field(key, 'price').addEventListener('input', () => refreshFees(r.line.orderRef));
    field(key, 'platform').addEventListener('change', () => {
      // The platform is the order's: set it on the order's other rows too.
      const val = field(key, 'platform').value;
      rows.filter(o => o.line.orderRef === r.line.orderRef).forEach(o => { field(o.line.key, 'platform').value = val; });
      refreshFees(r.line.orderRef);
    });
    field(key, 'fee').addEventListener('input', () => { manualFee.add(key); refreshProfit(key); });
    field(key, 'shippingCost').addEventListener('input', () => refreshProfit(key));
  });
  [...new Set(rows.map(r => r.line.orderRef))].forEach(refreshFees);
  refreshCount();

  const allError = dlg.querySelector('[data-ps-all-error]');
  dlg.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    allError.hidden = true;
    // Rows saved earlier have left the sheet (and byKey).
    const live = rows.filter(r => byKey.has(r.line.key));
    live.forEach(r => { rowEl(r.line.key).querySelector('[data-ps-error]').hidden = true; });
    const ticked = live.filter(r => rowEl(r.line.key).querySelector('[data-ps-on]').checked);
    // Check every ticked row before writing anything; flag them all and
    // focus the first problem.
    const plans = [];
    let firstBad = null;
    for (const r of ticked){
      const err = rowEl(r.line.key).querySelector('[data-ps-error]');
      const c = pickSaleFields(r.item, input(r.line.key), r.line, Date.now());
      err.hidden = c.ok;
      if (c.ok){ plans.push({ r, fields: c.fields }); continue; }
      err.textContent = c.error;
      if (!firstBad) firstBad = field(r.line.key, c.field);
    }
    if (firstBad || plans.length !== ticked.length){
      if (firstBad) firstBad.focus();
      return;
    }
    const buttons = dlg.querySelectorAll('.exp-dialog-actions button');
    buttons.forEach(b => { b.disabled = true; });
    dlg.querySelector('[data-ps-save]').textContent = 'Saving…';
    const done = [], failed = [], ebayEnded = [], ebayFailed = [];
    for (const { r, fields } of plans){
      const res = await hooks.markSold(r.item, fields);
      const code = r.item.productCode || r.item.name || 'item';
      if (!res || !res.ok){ failed.push(r); continue; }
      done.push(r);
      if (res.ebay === 'ended') ebayEnded.push(code);
      if (res.ebay === 'failed') ebayFailed.push(code);
      rowEl(r.line.key).remove();
      byKey.delete(r.line.key);
    }
    if (done.length) hooks.onChange();
    if (!failed.length){
      dlg.close();
      const extra = ebayFailed.length ? ` Couldn't end the eBay listing of ${ebayFailed.join(', ')}: end it on eBay.` : ebayEnded.length ? ` Ended on eBay: ${ebayEnded.join(', ')}.` : '';
      showToast(`${done.length} sale${done.length === 1 ? '' : 's'} recorded.${extra}`);
      return;
    }
    buttons.forEach(b => { b.disabled = false; });
    refreshCount();
    allError.textContent = `${done.length ? `${done.length} recorded. ` : ''}Couldn't save ${failed.map(r => r.item.productCode || r.item.name).join(', ')}. Check your connection and try again.`;
    allError.hidden = false;
  });
  dlg.querySelector('[data-ps-cancel]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
}
