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
import { escapeHtml, uid } from './format-utils.js';
import { nextProductCode } from './catalog-lookups.js';
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
  const { orphans, shippingMismatches, checkedCount, totalSkus, lookupErrors, invisibleListings, legacyScanError } = data;
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

  if (legacyScanError){
    html += `<div style="margin-top:10px; font-size:12px; color:var(--danger);">⚠️ Couldn't check for listings outside the Inventory API: ${escapeHtml(legacyScanError)}</div>`;
  } else if (invisibleListings && invisibleListings.length){
    html += `<div style="margin-top:12px; padding-top:10px; border-top:1px solid rgba(0,0,0,0.08);">
      <b style="color:var(--danger);">🕳️ ${invisibleListings.length} listing${invisibleListings.length===1?'':'s'} completely invisible to this audit</b>
      <div style="margin-top:4px; font-size:12px; opacity:0.85;">Live on eBay, but never registered through the Inventory API (created directly in Seller Hub, a bulk lister, or an older tool) — so the checks above can't see them at all, whether or not they have a SKU. Assign a SKU and import each one to bring it into the catalog and make it visible to future audits.</div>
      <label style="display:flex; align-items:center; gap:8px; margin-top:8px; font-size:12px; opacity:0.85; cursor:pointer;">
        <input type="checkbox" id="auditInvisibleSelectAll" checked>
        <span>Select all</span>
      </label>`;
    html += invisibleListings.map(l => `
      <div class="audit-invisible-row" data-item-id="${escapeHtml(l.itemId)}" style="display:flex; align-items:center; gap:8px; margin-top:8px; font-size:13px;">
        <input type="checkbox" class="audit-invisible-chk" checked style="flex-shrink:0;">
        <span style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(l.title || l.itemId)} · $${l.price || '?'}
          ${listingUrl(l.itemId) ? ` · <a href="${listingUrl(l.itemId)}" target="_blank">View ↗</a>` : ''}</span>
        <input type="text" class="audit-invisible-sku" value="${escapeHtml(l.suggestedSku)}" style="width:100px; flex-shrink:0; padding:5px 7px; border:1px solid var(--border-color, #ddd); border-radius:6px; font-size:12px;">
      </div>`).join('');
    html += `<button id="auditImportSelectedBtn" style="margin-top:10px; background:var(--danger); color:white; border:none; border-radius:8px; padding:9px 14px; font-size:13px; font-weight:600; cursor:pointer;">📥 Import selected into catalog</button>`;
    html += `<div id="auditImportProgress" style="margin-top:8px;"></div>`;
    html += `</div>`;
  } else if (invisibleListings){
    html += `<div style="margin-top:12px; padding-top:10px; border-top:1px solid rgba(0,0,0,0.08); color:var(--sage-deep); font-weight:600; font-size:13px;">✅ No listings outside the Inventory API found — everything active on eBay has a SKU record.</div>`;
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

      const SKIP_REASON_LABEL = {
        no_price: 'no list price set',
        no_description: 'no listing description generated',
        already_listed: 'already listed (unexpected — should have force-updated)',
      };
      const success = results.filter(r => r.result.success);
      const skipped = results.filter(r => r.result.skipped);
      const noDescSkipped = skipped.filter(r => r.result.reason === 'no_description');
      const failed = results.filter(r => !r.result.success && !r.result.skipped);
      if (progressEl){
        let summary = `<div style="font-size:13px; margin-top:4px;">`;
        if (success.length){
          summary += `<div style="color:var(--sage-deep); font-weight:600;">✅ ${success.length} fixed</div>`;
        }
        if (skipped.length){
          summary += `<div style="color:var(--amber-deep); font-weight:600; margin-top:4px;">⏸️ ${skipped.length} skipped</div>`;
          summary += skipped.map(r => `<div style="font-size:12px; margin-top:2px;">${escapeHtml(r.item.name || r.item.productCode || 'item')} — ${escapeHtml(SKIP_REASON_LABEL[r.result.reason] || r.result.reason || 'skipped')}</div>`).join('');
        }
        if (failed.length){
          summary += `<div style="color:var(--danger); font-weight:600; margin-top:4px;">❌ ${failed.length} failed</div>`;
          summary += failed.map(r => `<div style="font-size:12px; margin-top:2px;">${escapeHtml(r.item.name || r.item.productCode || 'item')} — ${escapeHtml(r.result.error || 'unknown error')}</div>`).join('');
        }
        if (noDescSkipped.length){
          summary += `<button id="auditGenDescBtn" style="margin-top:10px; background:var(--gold); color:white; border:none; border-radius:8px; padding:9px 14px; font-size:13px; font-weight:600; cursor:pointer;">🪄 Generate ${noDescSkipped.length} missing description${noDescSkipped.length===1?'':'s'} & retry publish</button>`;
          summary += `<div id="auditGenDescProgress" style="margin-top:8px;"></div>`;
        }
        summary += `<div style="margin-top:6px; opacity:0.8;">Rerun the audit to confirm.</div></div>`;
        progressEl.innerHTML = summary;
      }
      fixBtn.disabled = false;

      const genBtn = document.getElementById('auditGenDescBtn');
      if (genBtn){
        genBtn.addEventListener('click', async () => {
          genBtn.disabled = true;
          const genProgressEl = document.getElementById('auditGenDescProgress');
          const genResults = []; // { item, ok, message?, published? }
          for (let i = 0; i < noDescSkipped.length; i++){
            const item = noDescSkipped[i].item;
            if (genProgressEl){
              genProgressEl.innerHTML = `<div style="font-size:12px; opacity:0.8;">⏳ Writing description ${i+1} of ${noDescSkipped.length}: ${escapeHtml(item.name || item.productCode || 'item')}…</div>`;
            }
            const genResult = await window.generateListingDescriptionForItem(item);
            if (!genResult.ok){
              genResults.push({ item, ok: false, message: genResult.message });
              continue;
            }
            const publishResult = await publishItemToEbayCore(item, true);
            genResults.push({ item, ok: true, published: publishResult.success, publishError: publishResult.error });
          }

          const genOk = genResults.filter(r => r.ok && r.published);
          const genFailed = genResults.filter(r => !r.ok || !r.published);
          if (genProgressEl){
            let genSummary = `<div style="font-size:12px; margin-top:4px;">`;
            if (genOk.length){
              genSummary += `<div style="color:var(--sage-deep); font-weight:600;">✅ ${genOk.length} generated & republished</div>`;
            }
            if (genFailed.length){
              genSummary += `<div style="color:var(--danger); font-weight:600; margin-top:4px;">❌ ${genFailed.length} still not fixed</div>`;
              genSummary += genFailed.map(r => `<div style="margin-top:2px;">${escapeHtml(r.item.name || r.item.productCode || 'item')} — ${escapeHtml(r.message || r.publishError || 'unknown error')}</div>`).join('');
            }
            genSummary += `<div style="margin-top:6px; opacity:0.8;">Rerun the audit to confirm.</div></div>`;
            genProgressEl.innerHTML = genSummary;
          }
          genBtn.disabled = false;
        });
      }
    });
  }

  const selectAllChk = document.getElementById('auditInvisibleSelectAll');
  if (selectAllChk){
    selectAllChk.addEventListener('change', () => {
      document.querySelectorAll('.audit-invisible-chk').forEach(chk => { chk.checked = selectAllChk.checked; });
    });
  }

  const importBtn = document.getElementById('auditImportSelectedBtn');
  if (importBtn){
    importBtn.addEventListener('click', async () => {
      const rows = Array.from(document.querySelectorAll('.audit-invisible-row'));
      const selectedRows = rows.filter(r => r.querySelector('.audit-invisible-chk').checked);
      const progressEl = document.getElementById('auditImportProgress');
      if (selectedRows.length === 0){
        if (progressEl) progressEl.innerHTML = `<div style="font-size:12px; color:var(--danger);">Select at least one listing first.</div>`;
        return;
      }

      const selected = selectedRows.map(row => ({
        row,
        itemId: row.dataset.itemId,
        sku: row.querySelector('.audit-invisible-sku').value.trim(),
      }));
      // Dedupe/blank check across rows BEFORE calling eBay — importing two
      // rows under the same SKU would silently overwrite one item with the
      // other once both are written to Firestore.
      const skuCounts = {};
      selected.forEach(s => { skuCounts[s.sku] = (skuCounts[s.sku] || 0) + 1; });
      const badSkus = [...new Set(selected.filter(s => !s.sku || skuCounts[s.sku] > 1).map(s => s.sku || '(blank)'))];
      if (badSkus.length){
        if (progressEl) progressEl.innerHTML = `<div style="font-size:12px; color:var(--danger);">Fix duplicate or blank SKUs before importing: ${escapeHtml(badSkus.join(', '))}</div>`;
        return;
      }

      importBtn.disabled = true;
      const token = await getValidEbayToken();
      const results = [];
      for (let i = 0; i < selected.length; i++){
        const { row, itemId, sku } = selected[i];
        const listing = (data.invisibleListings || []).find(l => l.itemId === itemId);
        if (progressEl){
          progressEl.innerHTML = `<div style="font-size:13px; opacity:0.8;">⏳ Importing ${i+1} of ${selected.length}: ${escapeHtml(listing?.title || itemId)}…</div>`;
        }
        try{
          const migrateData = await postAuditAction(token, { action: 'migrate_listing', listingId: itemId, sku });
          if (!migrateData.success){
            results.push({ row, itemId, sku, ok: false, error: migrateData.error || 'eBay rejected the migration', detail: migrateData.detail });
            continue;
          }
          // Best-effort catalog entry — only the fields eBay actually gives
          // us (title/price/photos) are filled in; everything else (type,
          // brand, size, cost...) needs a manual pass in Catalog afterward,
          // same as any freshly-cataloged item. freeShipping is always
          // false (buyer pays) — Vitor's fixed default for these imports —
          // and the server (correctOfferShipping, api/ebay-listing-tools.js)
          // already corrected the live eBay offer to match this at
          // migration time if it came in different, so this isn't a guess
          // that needs manual review, unlike v3.13.23-25.
          // migrateData.photos is the FULL photo set (fetched via GetItem
          // at migration time); legacy_scan's ActiveList only ever had the
          // one gallery photo, kept here as a fallback if that fetch failed.
          const photos = (migrateData.photos && migrateData.photos.length)
            ? migrateData.photos
            : (listing?.pictureUrl ? [listing.pictureUrl] : []);
          // migrateData.description is the listing's ORIGINAL eBay
          // description (also from that GetItem call) — carrying it over
          // means publishItemToEbayCore never treats this item as
          // no_description later, so it's never routed through the AI
          // "generate description" flow unless she explicitly wants to
          // replace what was already there.
          const newItem = {
            id: uid(),
            productCode: sku,
            name: listing?.title || sku,
            listPrice: listing?.price || '',
            listingDescription: migrateData.description || '',
            photos,
            listedPlatforms: ['ebay'],
            ebayListingId: itemId,
            status: 'anunciado',
            freeShipping: false,
            createdAt: Date.now(),
          };
          const { doc, setDoc } = window.firestoreFns;
          await setDoc(doc(window.db, 'items', newItem.id), newItem);
          items.push(newItem);
          results.push({ row, itemId, sku, ok: true, shipping: migrateData.shipping, newItemId: newItem.id, name: newItem.name });
        }catch(e){
          results.push({ row, itemId, sku, ok: false, error: String(e && e.message || e) });
        }
      }
      importBtn.disabled = false;

      const ok = results.filter(r => r.ok);
      const failed = results.filter(r => !r.ok);
      if (progressEl){
        let summary = `<div style="font-size:13px; margin-top:4px;">`;
        if (ok.length){
          const shippingFixed = ok.filter(r => r.shipping?.corrected).length;
          const shippingFailed = ok.filter(r => r.shipping && !r.shipping.corrected && r.shipping.reason !== 'already_buyer_pays');
          summary += `<div style="color:var(--sage-deep); font-weight:600;">✅ ${ok.length} imported — SKU${ok.length===1?'':'s'} ${ok.map(r => escapeHtml(r.sku)).join(', ')}.</div>`;
          summary += `<div style="font-size:12px; margin-top:2px; opacity:0.85;">All set to "Buyer pays" (the fixed default)${shippingFixed ? ` — corrected on ${shippingFixed} live eBay listing${shippingFixed===1?'':'s'} that came in with something else` : ''}. Type/brand/size/cost still need a manual pass in Catalog.</div>`;
          if (shippingFailed.length){
            summary += `<div style="font-size:12px; margin-top:4px; color:var(--amber-deep);">⚠️ Couldn't confirm the live shipping policy is correct for ${shippingFailed.length} item${shippingFailed.length===1?'':'s'} — double-check these on eBay directly:</div>`;
            summary += shippingFailed.map(r => `<div style="font-size:11.5px; margin-top:2px; opacity:0.85;">${escapeHtml(r.sku)} — ${escapeHtml(r.shipping.reason || 'unknown reason')}</div>`).join('');
          }
          summary += ok.map(r => `
            <div style="display:flex; align-items:center; gap:8px; margin-top:8px; padding:8px; background:rgba(0,0,0,0.03); border-radius:8px;">
              <div style="flex:1; min-width:0;">
                <div style="font-size:12px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(r.sku)} — ${escapeHtml(r.name || '')}</div>
                <div style="font-size:11px; margin-top:2px; color:var(--amber-deep);">⚠️ Missing: weight/dimensions (shipping is using the $8 flat placeholder until measured), type, brand, size, cost.</div>
              </div>
              <button class="audit-open-item-btn" data-item-id="${escapeHtml(r.newItemId)}" style="flex-shrink:0; background:var(--terracotta); color:white; border:none; border-radius:8px; padding:7px 12px; font-size:12px; font-weight:600; cursor:pointer;">Open ↗</button>
            </div>`).join('');
        }
        if (failed.length){
          summary += `<div style="color:var(--danger); font-weight:600; margin-top:4px;">❌ ${failed.length} failed</div>`;
          summary += failed.map(r => `<div style="font-size:12px; margin-top:4px;">${escapeHtml(r.sku)} — ${escapeHtml(r.error)}
            ${r.detail ? `<div style="margin-top:2px; padding:6px; background:rgba(0,0,0,0.04); border-radius:6px; font-family:monospace; font-size:10.5px; white-space:pre-wrap;">${escapeHtml(JSON.stringify(r.detail, null, 2))}</div>` : ''}</div>`).join('');
        }
        summary += `<div style="margin-top:6px; opacity:0.8;">Rerun the audit to confirm.</div></div>`;
        progressEl.innerHTML = summary;
        progressEl.querySelectorAll('.audit-open-item-btn').forEach(btn => {
          btn.addEventListener('click', () => window.openItemModalById(btn.dataset.itemId));
        });
      }
      ok.forEach(r => r.row.remove());
    });
  }
}

async function postAuditAction(token, body){
  const res = await fetch('/api/ebay-listing-tools', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: token, ...body }),
  });
  return res.json();
}

// Drives the audit as a client-side loop over small chunks rather than one
// big server call — a single-request version hit a real 504 gateway
// timeout on a 100+ SKU account even with the function's maxDuration
// raised to 60s (Hobby plan doesn't reliably honor that). No individual
// request here can time out regardless of catalog size, and she gets live
// progress instead of a silent multi-second wait.
const CHUNK_SIZE = 20;

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

    area.innerHTML = `<div class="ebay-status-box pending">⏳ Listing every SKU on your eBay account…</div>`;
    const listData = await postAuditAction(token, { action: 'audit_list_skus' });
    if (!listData.success){
      area.innerHTML = `
        <div class="ebay-status-box error">
          ❌ Audit failed: ${escapeHtml(listData.error || 'unknown error')}
          ${listData.detail ? `<div style="margin-top:8px; padding:8px; background:rgba(0,0,0,0.04); border-radius:6px; font-family:monospace; font-size:11px; white-space:pre-wrap;">${escapeHtml(JSON.stringify(listData.detail, null, 2))}</div>` : ''}
        </div>`;
      return;
    }

    const { skus, totalSkus } = listData;
    const knownItems = items.map(i => ({ sku: i.productCode || i.id, freeShipping: i.freeShipping === true }));

    const merged = { orphans: [], shippingMismatches: [], lookupErrors: [], checkedCount: 0, totalSkus, checkedListingIds: [] };
    for (let i = 0; i < skus.length; i += CHUNK_SIZE){
      const chunk = skus.slice(i, i + CHUNK_SIZE);
      area.innerHTML = `<div class="ebay-status-box pending">⏳ Checking listings — ${Math.min(i + CHUNK_SIZE, skus.length)} of ${skus.length} SKUs…</div>`;
      const chunkData = await postAuditAction(token, { action: 'audit_check_skus', knownItems, skus: chunk });
      if (!chunkData.success){
        area.innerHTML = `
          <div class="ebay-status-box error">
            ❌ Audit failed partway through (checked ${merged.checkedCount} of ${totalSkus}): ${escapeHtml(chunkData.error || 'unknown error')}
            ${chunkData.detail ? `<div style="margin-top:8px; padding:8px; background:rgba(0,0,0,0.04); border-radius:6px; font-family:monospace; font-size:11px; white-space:pre-wrap;">${escapeHtml(JSON.stringify(chunkData.detail, null, 2))}</div>` : ''}
          </div>`;
        return;
      }
      merged.orphans.push(...chunkData.orphans);
      merged.shippingMismatches.push(...chunkData.shippingMismatches);
      merged.lookupErrors.push(...chunkData.lookupErrors);
      merged.checkedCount += chunkData.checkedCount;
      merged.checkedListingIds.push(...(chunkData.checkedListingIds || []));
    }

    // Second pass: find listings live on eBay that never went through the
    // Inventory API at all (no SKU record, so invisible to everything
    // above) — via the legacy Trading API's GetMyeBaySelling. See
    // handleLegacyScan in api/ebay-listing-tools.js for why this needs a
    // separate API entirely.
    area.innerHTML = `<div class="ebay-status-box pending">⏳ Checking for listings outside the Inventory API…</div>`;
    const knownListingIds = new Set(merged.checkedListingIds.map(String));
    let invisibleListings = [];
    let legacyScanError = null;
    try{
      const legacyData = await postAuditAction(token, { action: 'legacy_scan' });
      if (!legacyData.success){
        legacyScanError = legacyData.error || 'unknown error';
      }else{
        const orphaned = (legacyData.items || []).filter(l => l.itemId && !knownListingIds.has(String(l.itemId)));
        // Suggest SKUs up front (nextProductCode() reads the current catalog
        // sequence) — assigned sequentially here, not per-row on render, so
        // two suggested rows never collide with each other.
        let nextCode = nextProductCode(items);
        invisibleListings = orphaned.map(l => {
          const suggestedSku = nextCode;
          nextCode = nextProductCode([...items, { productCode: suggestedSku }]);
          return { ...l, suggestedSku };
        });
      }
    }catch(e){
      legacyScanError = String(e && e.message || e);
    }

    renderAuditReport({ success: true, ...merged, invisibleListings, legacyScanError });
  }catch(e){
    area.innerHTML = `<div class="ebay-status-box error">❌ ${escapeHtml(String(e.message || e))}</div>`;
  }
}

// Lists every fulfillment (shipping) policy on the connected eBay account
// with its real policy ID — added 2026-08-10 so a custom policy created
// directly on eBay (e.g. "USPS Ground + Priority (Buyer Pays)") can be
// found and copied into EBAY_FULFILLMENT_POLICY_ID_BUYER_PAYS on Vercel
// without digging through Seller Hub. Read-only — doesn't change anything,
// on eBay or in this app; switching which policy this app treats as the
// buyer-pays default is a server env var change, done outside the app.
export async function runListFulfillmentPolicies(){
  const area = document.getElementById('ebayPoliciesResult');
  if (!area) return;
  area.innerHTML = `<div class="ebay-status-box pending">⏳ Checking eBay connection…</div>`;
  try{
    const token = await getValidEbayToken();
    if (!token){
      area.innerHTML = `<div class="ebay-status-box error">❌ Connect your eBay account first.</div>`;
      return;
    }
    const data = await postAuditAction(token, { action: 'list_fulfillment_policies' });
    if (!data.success){
      area.innerHTML = `
        <div class="ebay-status-box error">
          ❌ Couldn't list shipping policies: ${escapeHtml(data.error || 'unknown error')}
          ${data.detail ? `<div style="margin-top:8px; padding:8px; background:rgba(0,0,0,0.04); border-radius:6px; font-family:monospace; font-size:11px; white-space:pre-wrap;">${escapeHtml(JSON.stringify(data.detail, null, 2))}</div>` : ''}
        </div>`;
      return;
    }
    if (!data.policies.length){
      area.innerHTML = `<div class="ebay-status-box">No shipping policies found on this account.</div>`;
      return;
    }
    area.innerHTML = `<div class="ebay-connect-box"><div class="ec-title">${data.policies.length} shipping polic${data.policies.length===1?'y':'ies'} on this account</div><div class="ec-sub">` +
      data.policies.map(p => `
        <div style="display:flex; align-items:center; gap:8px; margin-top:6px; font-size:13px;">
          <span style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(p.name)}</span>
          <code style="flex-shrink:0; background:rgba(0,0,0,0.06); padding:3px 6px; border-radius:4px; font-size:11.5px; user-select:all;">${escapeHtml(p.id)}</code>
        </div>`).join('') +
      `<div style="margin-top:8px; font-size:12px; opacity:0.8;">To make one of these the default for "buyer pays" imports/publishing, copy its ID above into the <code>EBAY_FULFILLMENT_POLICY_ID_BUYER_PAYS</code> environment variable in Vercel, then redeploy.</div></div></div>`;
  }catch(e){
    area.innerHTML = `<div class="ebay-status-box error">❌ ${escapeHtml(String(e.message || e))}</div>`;
  }
}

const BACKFILL_CHUNK_SIZE = 10;

// One-off catch-up for items imported via the audit's "invisible listings"
// flow BEFORE v3.13.30 added description capture to migrate_listing — those
// sit in the catalog today with a blank listingDescription, which is
// exactly what routes publishItemToEbayCore into the AI "generate
// description" flow (unnecessary, and not always accurate) whenever she
// tries to republish/fix one of them. Finds every catalog item with an
// ebayListingId but no listingDescription, fetches each one's real
// description from eBay (action:'backfill_descriptions'), and writes it
// straight to Firestore — same fetchListingDetails() call migrate_listing
// itself now uses going forward, just run retroactively here.
export async function runBackfillDescriptions(){
  const area = document.getElementById('ebayBackfillResult');
  if (!area) return;

  const targets = items.filter(i => i.ebayListingId && !(i.listingDescription && i.listingDescription.trim()));
  if (targets.length === 0){
    area.innerHTML = `<div class="ebay-status-box">✅ Every item with an eBay listing already has a description saved — nothing to backfill.</div>`;
    return;
  }

  area.innerHTML = `<div class="ebay-status-box pending">⏳ Checking eBay connection…</div>`;
  try{
    const token = await getValidEbayToken();
    if (!token){
      area.innerHTML = `<div class="ebay-status-box error">❌ Connect your eBay account first.</div>`;
      return;
    }

    const byListingId = new Map(targets.map(i => [String(i.ebayListingId), i]));
    const listingIds = [...byListingId.keys()];
    const fetched = [];
    const errors = [];

    for (let i = 0; i < listingIds.length; i += BACKFILL_CHUNK_SIZE){
      const chunk = listingIds.slice(i, i + BACKFILL_CHUNK_SIZE);
      area.innerHTML = `<div class="ebay-status-box pending">⏳ Fetching descriptions — ${Math.min(i + BACKFILL_CHUNK_SIZE, listingIds.length)} of ${listingIds.length}…</div>`;
      const data = await postAuditAction(token, { action: 'backfill_descriptions', listingIds: chunk });
      if (!data.success){
        area.innerHTML = `
          <div class="ebay-status-box error">
            ❌ Backfill failed partway through (${fetched.length} of ${listingIds.length} done): ${escapeHtml(data.error || 'unknown error')}
            ${data.detail ? `<div style="margin-top:8px; padding:8px; background:rgba(0,0,0,0.04); border-radius:6px; font-family:monospace; font-size:11px; white-space:pre-wrap;">${escapeHtml(JSON.stringify(data.detail, null, 2))}</div>` : ''}
          </div>`;
        return;
      }
      fetched.push(...data.results);
      errors.push(...data.errors);
    }

    const { doc, setDoc } = window.firestoreFns;
    let saved = 0;
    const stillEmpty = [];
    for (const { listingId, description } of fetched){
      const item = byListingId.get(String(listingId));
      if (!item) continue;
      if (!description){
        stillEmpty.push(item);
        continue;
      }
      item.listingDescription = description;
      await setDoc(doc(window.db, 'items', item.id), item);
      saved++;
    }

    let summary = `<div style="font-size:13px;">`;
    if (saved){
      summary += `<div style="color:var(--sage-deep); font-weight:600;">✅ ${saved} description${saved===1?'':'s'} backfilled from eBay.</div>`;
    }
    if (stillEmpty.length){
      summary += `<div style="margin-top:4px; color:var(--amber-deep);">⚠️ ${stillEmpty.length} item${stillEmpty.length===1?'':'s'} — eBay didn't return a description (listing may have none set): ${stillEmpty.map(i => escapeHtml(i.productCode || i.name || i.id)).join(', ')}</div>`;
    }
    if (errors.length){
      summary += `<div style="margin-top:4px; color:var(--danger); font-weight:600;">❌ ${errors.length} lookup${errors.length===1?'':'s'} failed — rerun to retry: ${errors.map(e => escapeHtml(e.listingId)).join(', ')}</div>`;
    }
    summary += `</div>`;
    area.innerHTML = summary;
  }catch(e){
    area.innerHTML = `<div class="ebay-status-box error">❌ ${escapeHtml(String(e.message || e))}</div>`;
  }
}
