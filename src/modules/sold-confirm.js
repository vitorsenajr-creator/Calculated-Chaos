// "Mark as sold" confirmation — added v3.13.3/3.13.5, extracted straight
// into its own module rather than letting it accumulate in main.js's IIFE
// (it's brand new code, cheapest to modularize before anything else grows
// on top of it). Two entry points:
//   - initSoldConfirmModal(deps) — wires the single-item #soldConfirmOverlay
//     once; main.js calls the returned openSoldConfirmModal() from its
//     status-pill click handler on the catalogado/anunciado -> vendido
//     transition.
//   - showBulkSoldConfirm(ids, deps) — renders the bulk "Set: Sold" review
//     list into #bulkActionStatus.
// Both stop short of owning the actual Firestore save / eBay-listing-end
// side effects — those stay as injected callbacks, since they're really
// main.js/ebay-api.js's job, not this module's.
import { items, appSettings } from './state.js';
import { getAllPlatforms } from './platforms.js';
import { platformFee, suggestPrice } from './pricing.js';
import { PLATFORM_NAME } from './constants.js';
import { endEbayListingIfSold, ebayPostSoldMessageLines } from '../ebay-api.js';

export function computeNetProfit({ price, cost, fee, shippingCost, otherCosts }){
  return price - (cost || 0) - (fee || 0) - (shippingCost || 0) - (otherCosts || 0);
}

// ---------- Single-item confirmation modal ----------
// `deps`: { getItem(): item|null, getListedPlatforms(): string[],
//           escapeHtml(str), onConfirm({price, platform, fee, shippingCost, otherCosts}) }
export function initSoldConfirmModal(deps){
  const { getItem, getListedPlatforms, escapeHtml, onConfirm } = deps;
  // True once she's typed directly into the fee field herself — after
  // that, changing price/platform no longer silently overwrites her
  // override (a promo, a dispute credit, whatever doesn't match the
  // standard rate). Reset every time the modal opens fresh.
  let feeManuallyEdited = false;

  function updatePreview(recomputeFee){
    const price = parseFloat(document.getElementById('scPrice').value) || 0;
    const platform = document.getElementById('scPlatform').value;
    const who = document.querySelector('#scShippingWhoRow .status-pill.selected')?.dataset.who || 'buyer';
    const shipField = document.getElementById('scShippingCostField');
    shipField.style.display = who === 'seller' ? 'block' : 'none';
    const shippingCost = who === 'seller' ? (parseFloat(document.getElementById('scShippingCost').value) || 0) : 0;
    const otherCosts = parseFloat(document.getElementById('scOtherCosts').value) || 0;
    if (recomputeFee && !feeManuallyEdited){
      document.getElementById('scFee').value = platformFee(appSettings, platform, price).toFixed(2);
    }
    const fee = parseFloat(document.getElementById('scFee').value) || 0;
    const cost = parseFloat(document.getElementById('fCost').value) || 0;
    const netProfit = computeNetProfit({ price, cost, fee, shippingCost, otherCosts });
    document.getElementById('scShipPreview').textContent = `$${shippingCost.toFixed(2)}`;
    document.getElementById('scOtherPreview').textContent = `$${otherCosts.toFixed(2)}`;
    document.getElementById('scNetPreview').textContent = `Net profit: $${netProfit.toFixed(2)}`;
  }

  function openSoldConfirmModal(){
    const item = getItem();
    feeManuallyEdited = false;
    const platformSelect = document.getElementById('scPlatform');
    // Only pre-select when there's an actually confident signal (already
    // recorded as sold there, or exactly one platform it was ever listed
    // on) — blindly defaulting to 'ebay' otherwise would make the
    // "required" validation below meaningless, since a <select> is never
    // really empty unless we leave it that way on purpose.
    const listedPlatforms = getListedPlatforms();
    const confidentGuess = item?.soldPlatform || (listedPlatforms.length === 1 ? listedPlatforms[0] : null);
    platformSelect.innerHTML = `<option value="">— Select platform —</option>` +
      getAllPlatforms(appSettings).map(p => `<option value="${p.key}">${escapeHtml(PLATFORM_NAME[p.key] || p.label)}</option>`).join('');
    platformSelect.value = confidentGuess || '';
    const listPriceVal = document.getElementById('fListPrice').value;
    document.getElementById('scPrice').value = (item?.soldPrice || listPriceVal || '') !== '' ? parseFloat(item?.soldPrice || listPriceVal).toFixed(2) : '';
    document.getElementById('scFee').value = confidentGuess ? platformFee(appSettings, confidentGuess, parseFloat(document.getElementById('scPrice').value) || 0).toFixed(2) : '0.00';
    const listingSaysSellerPays = document.getElementById('fFreeShipping')?.value === 'seller';
    const guessedWho = item?.shippingCost ? 'seller' : (listingSaysSellerPays ? 'seller' : 'buyer');
    document.querySelectorAll('#scShippingWhoRow .status-pill').forEach(p => p.classList.toggle('selected', p.dataset.who === guessedWho));
    document.getElementById('scShippingCost').value = item?.shippingCost ? parseFloat(item.shippingCost).toFixed(2) : '';
    document.getElementById('scOtherCosts').value = item?.otherCosts ? parseFloat(item.otherCosts).toFixed(2) : '';
    updatePreview(false);
    document.getElementById('soldConfirmOverlay').classList.remove('hidden');
  }

  document.getElementById('scPrice').addEventListener('input', () => updatePreview(true));
  document.getElementById('scPlatform').addEventListener('change', () => updatePreview(true));
  document.getElementById('scFee').addEventListener('input', () => { feeManuallyEdited = true; updatePreview(false); });
  document.getElementById('scShippingCost').addEventListener('input', () => updatePreview(false));
  document.getElementById('scOtherCosts').addEventListener('input', () => updatePreview(false));
  document.getElementById('scShippingWhoRow').addEventListener('click', (e) => {
    const pill = e.target.closest('.status-pill');
    if (!pill) return;
    document.querySelectorAll('#scShippingWhoRow .status-pill').forEach(p => p.classList.toggle('selected', p === pill));
    updatePreview(false);
  });
  document.getElementById('scCancelBtn').addEventListener('click', () => {
    document.getElementById('soldConfirmOverlay').classList.add('hidden');
    // Deliberately does NOT touch status — canceling leaves the item
    // exactly as it was before she tapped "Sold".
  });
  document.getElementById('scConfirmBtn').addEventListener('click', () => {
    const price = document.getElementById('scPrice').value;
    if (!price || parseFloat(price) <= 0){ alert('Enter the sale price — this is required to record the sale.'); return; }
    const platform = document.getElementById('scPlatform').value;
    if (!platform){ alert('Select which platform this sold on — this is required to calculate the right fee.'); return; }
    const fee = parseFloat(document.getElementById('scFee').value) || 0;
    const otherCosts = parseFloat(document.getElementById('scOtherCosts').value) || 0;
    const who = document.querySelector('#scShippingWhoRow .status-pill.selected')?.dataset.who || 'buyer';
    const shippingCost = who === 'seller' ? (parseFloat(document.getElementById('scShippingCost').value) || 0) : 0;
    document.getElementById('soldConfirmOverlay').classList.add('hidden');
    onConfirm({ price: parseFloat(price), platform, fee, shippingCost, otherCosts });
  });

  return openSoldConfirmModal;
}

// ---------- Bulk "Set: Sold" review list ----------
// `deps`: { escapeHtml(str), saveItem(item): Promise, onDone() }
export function showBulkSoldConfirm(ids, deps){
  const { escapeHtml, saveItem, onDone } = deps;
  const statusEl = document.getElementById('bulkActionStatus');
  if (!statusEl) return;
  const rows = ids.map(id => items.find(i => i.id === id)).filter(Boolean);
  const platformOptions = getAllPlatforms(appSettings);
  statusEl.innerHTML = `
    <div class="ebay-connect-box">
      <div class="ec-title">Confirm sale details for ${rows.length} item${rows.length===1?'':'s'}</div>
      <div class="ec-sub">Price, platform fee, and who paid shipping — review before this feeds into profit reporting.</div>
      ${rows.map(item => {
        const guessedPrice = item.soldPrice || item.listPrice || suggestPrice(items, item);
        const guessedPlatform = item.soldPlatform || item.listedPlatforms?.[0] || item.platform || 'ebay';
        const guessedFee = platformFee(appSettings, guessedPlatform, parseFloat(guessedPrice) || 0);
        const listingSaysSellerPays = item.freeShipping === true;
        const guessedWho = item.shippingCost ? 'seller' : (listingSaysSellerPays ? 'seller' : 'buyer');
        return `
        <div data-bulk-sold-row="${item.id}" style="border-top:1px dashed var(--line); padding-top:10px; margin-top:10px;">
          <div style="font-size:13px; font-weight:600; color:var(--plum); margin-bottom:6px;">${escapeHtml(item.name || item.productCode || 'Item')}</div>
          <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
            <span style="font-size:11px; color:var(--plum-soft);">Price $</span>
            <input type="number" class="mono" data-bs-price step="0.01" value="${parseFloat(guessedPrice||0).toFixed(2)}" style="width:70px; padding:5px 6px; border:1px solid var(--line); border-radius:6px; font-size:12px;">
            <select data-bs-platform style="padding:5px 6px; border:1px solid var(--line); border-radius:6px; font-size:12px;">
              ${platformOptions.map(p => `<option value="${p.key}" ${p.key===guessedPlatform?'selected':''}>${escapeHtml(PLATFORM_NAME[p.key] || p.label)}</option>`).join('')}
            </select>
            <span style="font-size:11px; color:var(--plum-soft);">Fee $</span>
            <input type="number" class="mono" data-bs-fee step="0.01" value="${guessedFee.toFixed(2)}" style="width:60px; padding:5px 6px; border:1px solid var(--line); border-radius:6px; font-size:12px;">
            <select data-bs-who style="padding:5px 6px; border:1px solid var(--line); border-radius:6px; font-size:12px;">
              <option value="buyer" ${guessedWho==='buyer'?'selected':''}>Buyer paid shipping</option>
              <option value="seller" ${guessedWho==='seller'?'selected':''}>I paid shipping</option>
            </select>
            <input type="number" class="mono" data-bs-shipping step="0.01" placeholder="ship $" value="${item.shippingCost ? parseFloat(item.shippingCost).toFixed(2) : ''}" style="width:60px; padding:5px 6px; border:1px solid var(--line); border-radius:6px; font-size:12px; ${guessedWho==='seller'?'':'display:none;'}">
            <span style="font-size:11px; color:var(--plum-soft);">Other $</span>
            <input type="number" class="mono" data-bs-other step="0.01" placeholder="0.00" value="${item.otherCosts ? parseFloat(item.otherCosts).toFixed(2) : ''}" style="width:60px; padding:5px 6px; border:1px solid var(--line); border-radius:6px; font-size:12px;">
          </div>
        </div>`;
      }).join('')}
      <button id="bulkSoldConfirmBtn" style="background:var(--terracotta); color:white; border:none; border-radius:8px; padding:11px; font-size:13px; font-weight:600; cursor:pointer; width:100%; margin-top:14px;">
        ✓ Confirm & mark ${rows.length} as sold
      </button>
      <button id="bulkSoldCancelBtn" style="background:transparent; border:1px solid var(--line); border-radius:8px; padding:9px; font-size:13px; cursor:pointer; width:100%; margin-top:6px;">
        Cancel
      </button>
    </div>`;

  statusEl.querySelectorAll('[data-bs-who]').forEach(sel => {
    sel.addEventListener('change', () => {
      const row = sel.closest('[data-bulk-sold-row]');
      row.querySelector('[data-bs-shipping]').style.display = sel.value === 'seller' ? 'block' : 'none';
    });
  });
  document.getElementById('bulkSoldCancelBtn').addEventListener('click', () => { statusEl.innerHTML = ''; });
  document.getElementById('bulkSoldConfirmBtn').addEventListener('click', async () => {
    // Same "required" rule as the single-item confirm modal: a sale price
    // and a specific platform aren't optional, since both feed straight
    // into the fee calc and profit reporting.
    const invalid = [];
    for (const item of rows){
      const row = statusEl.querySelector(`[data-bulk-sold-row="${item.id}"]`);
      if (!row) continue;
      const price = parseFloat(row.querySelector('[data-bs-price]').value);
      const platform = row.querySelector('[data-bs-platform]').value;
      if (!(price > 0) || !platform) invalid.push(item.name || item.productCode || 'Item');
    }
    if (invalid.length){
      alert(`⚠️ These items need a sale price and a platform before they can be marked sold: ${invalid.join(', ')}`);
      return;
    }
    const confirmBtn = document.getElementById('bulkSoldConfirmBtn');
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Saving…';
    const ebayPostSoldMessages = [];
    for (const item of rows){
      const row = statusEl.querySelector(`[data-bulk-sold-row="${item.id}"]`);
      if (!row) continue;
      const soldPrice = parseFloat(row.querySelector('[data-bs-price]').value) || 0;
      const soldPlatform = row.querySelector('[data-bs-platform]').value;
      const feesTotal = parseFloat(row.querySelector('[data-bs-fee]').value) || 0;
      const who = row.querySelector('[data-bs-who]').value;
      const shippingCost = who === 'seller' ? (parseFloat(row.querySelector('[data-bs-shipping]').value) || 0) : 0;
      const otherCosts = parseFloat(row.querySelector('[data-bs-other]').value) || 0;
      const updated = {
        ...item,
        status: 'vendido',
        soldPrice,
        soldPlatform,
        shippingCost,
        feesTotal,
        otherCosts,
        soldAt: item.soldAt || Date.now(),
        netProfit: computeNetProfit({ price: soldPrice, cost: parseFloat(item.cost)||0, fee: feesTotal, shippingCost, otherCosts }),
      };
      const idx = items.findIndex(i => i.id === item.id);
      if (idx >= 0) items[idx] = updated;
      try{
        await saveItem(updated);
        const ebayEndResult = await endEbayListingIfSold(updated);
        ebayPostSoldMessages.push(...ebayPostSoldMessageLines(updated, ebayEndResult));
      }catch(e){ /* saveItem already alerts */ }
    }
    onDone(ebayPostSoldMessages);
  });
}
