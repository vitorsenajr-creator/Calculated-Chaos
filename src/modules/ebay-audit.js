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
import { getValidEbayToken, publishItemToEbayCore } from '../ebay-api.js';

function itemForSku(sku){
  return items.find(i => (i.productCode || i.id) === sku) || null;
}

function itemNameForSku(sku){
  const match = itemForSku(sku);
  return match ? (match.name || sku) : sku;
}

function renderAuditReport(data){
  const area = document.getElementById('ebayAuditResult');
  if (!area) return;
  const { orphans, shippingMismatches, checkedCount, totalSkus, lookupErrors } = data;
  const listingUrl = (id) => id ? `https://www.ebay.com/itm/${id}` : null;

  let html = `<div class="ebay-connect-box"><div class="ec-title">Audit finished — ${checkedCount} live listing${checkedCount===1?'':'s'} checked</div><div class="ec-sub">`;

  if (typeof totalSkus === 'number'){
    html += `<div style="font-size:12px; opacity:0.75; margin-bottom:6px;">${totalSkus} SKU${totalSkus===1?'':'s'} found on the eBay account total (includes ended/unpublished, not just live).</div>`;
  }

  if (lookupErrors && lookupErrors.length){
    html += `<div style="margin-bottom:10px;"><b style="color:var(--amber-deep);">⚠️ ${lookupErrors.length} SKU${lookupErrors.length===1?'':'s'} couldn't be checked</b> (eBay didn't respond after a retry — rerun the audit to pick these back up):`;
    html += lookupErrors.map(e => `<div style="margin-top:4px; font-size:12px; opacity:0.85;">SKU ${escapeHtml(e.sku)} — ${escapeHtml(e.error)}</div>`).join('');
    html += `</div>`;
  }

  if (orphans.length === 0 && shippingMismatches.length === 0){
    html += `<div style="color:var(--sage-deep); font-weight:600;">✅ Everything matches — no orphaned listings, no shipping policy mismatches.</div>`;
  }

  if (shippingMismatches.length){
    html += `<div style="margin-top:8px; margin-bottom:10px;"><b style="color:var(--danger);">🚚 ${shippingMismatches.length} listing${shippingMismatches.length===1?'':'s'} with the WRONG shipping policy live</b>`;
    html += shippingMismatches.map(m => `
      <label style="display:flex; align-items:flex-start; gap:8px; margin-top:6px; font-size:13px; line-height:1.4; cursor:pointer;">
        <input type="checkbox" class="audit-fix-chk" data-sku="${escapeHtml(m.sku)}" checked style="margin-top:3px;">
        <span>${escapeHtml(itemNameForSku(m.sku))} (SKU ${escapeHtml(m.sku)}) — should be ${m.expectedFreeShipping ? 'free/seller-paid' : 'buyer pays'}, currently isn't
        ${listingUrl(m.listingId) ? ` · <a href="${listingUrl(m.listingId)}" target="_blank" onclick="event.stopPropagation()">View ↗</a>` : ''}</span>
      </label>`).join('');
    html += `<button id="auditFixSelectedBtn" style="margin-top:10px; background:var(--terracotta); color:white; border:none; border-radius:8px; padding:9px 14px; font-size:13px; font-weight:600; cursor:pointer;">🔧 Fix selected now (republishes with the correct policy)</button>`;
    html += `<div id="auditFixProgress" style="margin-top:8px;"></div>`;
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

  const fixBtn = document.getElementById('auditFixSelectedBtn');
  if (fixBtn){
    fixBtn.addEventListener('click', async () => {
      const checkedSkus = Array.from(document.querySelectorAll('.audit-fix-chk:checked')).map(el => el.dataset.sku);
      const toFix = checkedSkus.map(itemForSku).filter(Boolean);
      const progressEl = document.getElementById('auditFixProgress');
      if (toFix.length === 0){
        if (progressEl) progressEl.innerHTML = `<div style="font-size:12px; color:var(--danger);">Select at least one listing first.</div>`;
        return;
      }

      fixBtn.disabled = true;
      const results = [];
      for (let i = 0; i < toFix.length; i++){
        const item = toFix[i];
        if (progressEl){
          progressEl.innerHTML = `<div style="font-size:13px; opacity:0.8;">⏳ Fixing ${i+1} of ${toFix.length}: ${escapeHtml(item.name || item.productCode || 'item')}…</div>`;
        }
        const result = await publishItemToEbayCore(item, true);
        results.push({ item, result });
      }

      const success = results.filter(r => r.result.success);
      const failed = results.filter(r => !r.result.success);
      if (progressEl){
        let summary = `<div style="font-size:13px; margin-top:4px;">`;
        if (success.length){
          summary += `<div style="color:var(--sage-deep); font-weight:600;">✅ ${success.length} fixed</div>`;
        }
        if (failed.length){
          summary += `<div style="color:var(--danger); font-weight:600; margin-top:4px;">❌ ${failed.length} failed</div>`;
          summary += failed.map(r => `<div style="font-size:12px; margin-top:2px;">${escapeHtml(r.item.name || r.item.productCode || 'item')} — ${escapeHtml(r.result.error || 'unknown error')}</div>`).join('');
        }
        summary += `<div style="margin-top:6px; opacity:0.8;">Rerun the audit to confirm.</div></div>`;
        progressEl.innerHTML = summary;
      }
      fixBtn.disabled = false;
    });
  }
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
      area.innerHTML = `
        <div class="ebay-status-box error">
          ❌ Audit failed: ${escapeHtml(data.error || 'unknown error')}
          ${data.detail ? `<div style="margin-top:8px; padding:8px; background:rgba(0,0,0,0.04); border-radius:6px; font-family:monospace; font-size:11px; white-space:pre-wrap;">${escapeHtml(JSON.stringify(data.detail, null, 2))}</div>` : ''}
        </div>`;
      return;
    }

    renderAuditReport(data);
  }catch(e){
    area.innerHTML = `<div class="ebay-status-box error">❌ ${escapeHtml(String(e.message || e))}</div>`;
  }
}
