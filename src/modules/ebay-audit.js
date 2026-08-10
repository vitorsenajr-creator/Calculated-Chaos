// eBay listing audit — added 2026-08-10 after the shipping-policy bug (see
// CLAUDE.md "eBay shipping policy bug") to answer "are we sure everything
// is correct now?" without checking each listing by hand. Read-only: never
// creates, edits, or republishes anything itself — it just reports.
//
// Two things it flags, per Vitor's explicit choice (not auto-import,
// review-only):
//   - Orphans: live on eBay, no matching item in the catalog (by SKU).
//   - Shipping mismatches: a known item whose live fulfillmentPolicyId
//     doesn't match what item.freeShipping says it should be — the exact
//     class of bug that started this, so this is the direct check for it.
//
// The actual cross-referencing happens server-side (api/ebay-listing-tools.js,
// action:'audit') since the real policy IDs are Vercel env vars, private to
// the server — this module just sends {sku, freeShipping} for every known
// item and renders whatever comes back.
//
// Exported as a plain function (not an init-with-addEventListener
// controller like sold-confirm.js) because its button/result area live
// inside Settings' renderSettings() innerHTML, which gets torn down and
// rebuilt on every render — same reason every other Settings action here
// (runEbaySetup, checkEbaySalesNow, findEligibleOffers) is a window.*
// function wired via inline onclick instead.
import { items } from './state.js';
import { escapeHtml } from './format-utils.js';
import { getValidEbayToken } from '../ebay-api.js';

function itemNameForSku(sku){
  const match = items.find(i => (i.productCode || i.id) === sku);
  return match ? (match.name || sku) : sku;
}

function renderAuditReport(data){
  const area = document.getElementById('ebayAuditResult');
  if (!area) return;
  const { orphans, shippingMismatches, checkedCount } = data;
  const listingUrl = (id) => id ? `https://www.ebay.com/itm/${id}` : null;

  let html = `<div class="ebay-connect-box"><div class="ec-title">Audit finished — ${checkedCount} live listing${checkedCount===1?'':'s'} checked</div><div class="ec-sub">`;

  if (orphans.length === 0 && shippingMismatches.length === 0){
    html += `<div style="color:var(--sage-deep); font-weight:600;">✅ Everything matches — no orphaned listings, no shipping policy mismatches.</div>`;
  }

  if (shippingMismatches.length){
    html += `<div style="margin-top:8px; margin-bottom:10px;"><b style="color:var(--danger);">🚚 ${shippingMismatches.length} listing${shippingMismatches.length===1?'':'s'} with the WRONG shipping policy live</b>`;
    html += shippingMismatches.map(m => `
      <div style="margin-top:6px; font-size:13px; line-height:1.4;">
        ${escapeHtml(itemNameForSku(m.sku))} (SKU ${escapeHtml(m.sku)}) — should be ${m.expectedFreeShipping ? 'free/seller-paid' : 'buyer pays'}, currently isn't
        ${listingUrl(m.listingId) ? ` · <a href="${listingUrl(m.listingId)}" target="_blank">View ↗</a>` : ''}
      </div>`).join('');
    html += `<div style="margin-top:6px; font-size:12px; opacity:0.8;">Fix: open each item in the app and click "Update existing listing" in its eBay panel.</div>`;
    html += `</div>`;
  }

  if (orphans.length){
    html += `<div style="margin-top:8px;"><b style="color:var(--amber-deep);">👻 ${orphans.length} orphaned listing${orphans.length===1?'':'s'} — live on eBay, no matching item in the catalog</b>`;
    html += orphans.map(o => `
      <div style="margin-top:6px; font-size:13px; line-height:1.4;">
        SKU ${escapeHtml(o.sku || '(none)')} · $${o.price || '?'}
        ${listingUrl(o.listingId) ? ` · <a href="${listingUrl(o.listingId)}" target="_blank">View ↗</a>` : ''}
      </div>`).join('');
    html += `<div style="margin-top:6px; font-size:12px; opacity:0.8;">These aren't auto-imported — review each on eBay and decide whether to add it to the catalog manually, or if it's something stale that should be ended.</div>`;
    html += `</div>`;
  }

  html += `</div></div>`;
  area.innerHTML = html;
}

export async function runEbayAudit(){
  const area = document.getElementById('ebayAuditResult');
  if (!area) return;
  area.innerHTML = `<div class="ebay-status-box pending">⏳ Checking eBay connection…</div>`;

  try{
    const token = await getValidEbayToken();
    if (!token){
      area.innerHTML = `<div class="ebay-status-box error">❌ Connect your eBay account first.</div>`;
      return;
    }

    area.innerHTML = `<div class="ebay-status-box pending">⏳ Fetching live eBay listings and comparing against your catalog — this can take a moment if you have a lot listed…</div>`;

    const knownItems = items.map(i => ({ sku: i.productCode || i.id, freeShipping: i.freeShipping === true }));
    const res = await fetch('/api/ebay-listing-tools', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: token, action: 'audit', knownItems }),
    });
    const data = await res.json();
    if (!data.success){
      area.innerHTML = `<div class="ebay-status-box error">❌ Audit failed: ${escapeHtml(data.error || 'unknown error')}</div>`;
      return;
    }

    renderAuditReport(data);
  }catch(e){
    area.innerHTML = `<div class="ebay-status-box error">❌ ${escapeHtml(String(e.message || e))}</div>`;
  }
}
