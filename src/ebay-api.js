// ---------- EBAY INTEGRATION ----------

  // Bridge to main.js's shared state/helpers. main.js's internals are still
  // wrapped in its original IIFE (untouched, to avoid re-testing 5000+ lines
  // of working logic) — `app` is what that IIFE now returns instead of
  // nothing, exposing exactly the pieces this module needs.
  //
  // main.js imports THIS file, and this file imports `app` FROM main.js —
  // that's a circular import. main.js can't finish building `app` until
  // this module finishes loading, so `app` is not yet initialized while
  // this file's own top-level code runs (reading it here would throw
  // "Cannot access 'app' before initialization"). Every use of `app.X`
  // below is therefore inside a function body, never at the top level —
  // by the time any of these functions actually run (a user clicking
  // something), both modules have long since finished loading and `app`
  // is fully populated. Do not destructure `app` at the top of this file.
  import { app } from './main.js';

  // eBay tokens are stored in Firestore under 'ebay_tokens/main' so both users share the same connection
  export let ebayTokens = null; // { access_token, refresh_token, connected_at, expires_in }

  // main.js's disconnectEbay needs to clear this — a plain `ebayTokens = null`
  // there won't work since imported bindings are read-only from the
  // importer's side; this is the one legal way to do it from outside.
  export function clearEbayTokens(){ ebayTokens = null; }

 export async function loadEbayTokens(){
    try{
      const { doc, getDoc } = window.firestoreFns;
      const snap = await getDoc(doc(window.db, 'ebay_tokens', 'main'));
      if (snap.exists()) ebayTokens = snap.data();
    }catch(e){ ebayTokens = null; }
  }

  export async function saveEbayTokens(tokens){
    try{
      const { doc, setDoc } = window.firestoreFns;
      await setDoc(doc(window.db, 'ebay_tokens', 'main'), tokens);
      ebayTokens = tokens;
      return { ok: true };
    }catch(e){
      console.error('Failed to save eBay tokens', e);
      return { ok: false, error: (e && e.message) || String(e) };
    }
  }

  export function ebayTokenIsValid(){
    if (!ebayTokens || !ebayTokens.access_token) return false;
    const ageMs = Date.now() - (ebayTokens.connected_at || 0);
    const expiresMs = (ebayTokens.expires_in || 7200) * 1000;
    return ageMs < expiresMs - 60000; // 1 min buffer
  }

  export async function getValidEbayToken(){
    if (ebayTokenIsValid()) return ebayTokens.access_token;
    if (!ebayTokens || !ebayTokens.refresh_token) return null;
    // Try to refresh
    try{
      const res = await fetch('/api/ebay-auth?action=refresh', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ refresh_token: ebayTokens.refresh_token })
      });
      const data = await res.json();
      if (data.access_token){
        const updated = { ...ebayTokens, ...data };
        await saveEbayTokens(updated);
        return data.access_token;
      }
    }catch(e){ console.error('Token refresh failed', e); }
    return null;
  }

  // Checks recent eBay orders and auto-marks matching items as Sold — this
  // is what closes the gap where the app previously had ZERO automatic sync
  // and required marking every eBay sale by hand. Runs on app open, and can
  // also be triggered manually (Settings has a "Check now" button). Silent
  // unless it actually finds something or hits a real error — this should
  // never interrupt normal use of the app.
  export async function checkEbaySalesNow(showUi){
    if (!ebayTokens || !ebayTokens.access_token) return { checked: false };
    const statusEl = showUi ? document.getElementById('ebaySalesCheckResult') : null;
    if (statusEl) statusEl.innerHTML = `<span style="opacity:0.7;">Checking recent eBay orders…</span>`;
    try{
      const token = await getValidEbayToken();
      if (!token) return { checked: false };
      const res = await fetch('/api/ebay-check-sales', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ access_token: token })
      });
      const data = await res.json();
      if (!data.success){
        if (statusEl) statusEl.innerHTML = `<div class="ebay-status-box error">❌ Couldn't check eBay orders right now.</div>`;
        return { checked: false };
      }
      let matchedCount = 0;
      for (const sale of (data.sales || [])){
        const item = app.items.find(i =>
          i.status !== 'vendido' &&
          ((sale.sku && i.ebaySku === sale.sku) || (sale.legacyItemId && i.ebayListingId === String(sale.legacyItemId)))
        );
        if (!item) continue;
        const soldPrice = sale.total || parseFloat(item.listPrice) || app.suggestPrice(item);
        const feesTotal = app.platformFee('ebay', soldPrice);
        const updated = {
          ...item,
          status: 'vendido',
          soldPrice,
          shippingCost: item.shippingCost || 0,
          feesTotal,
          soldAt: sale.creationDate ? new Date(sale.creationDate).getTime() : Date.now(),
          netProfit: soldPrice - (parseFloat(item.cost)||0) - feesTotal - (item.shippingCost||0),
          ebayAutoDetectedSale: true,
        };
        const idx = app.items.findIndex(i => i.id === item.id);
        if (idx >= 0) app.items[idx] = updated;
        try{ await app.saveItem(updated); matchedCount++; }catch(e){ /* app.saveItem already alerts */ }
      }
      if (matchedCount > 0){
        app.renderAll();
        if (statusEl){
          statusEl.innerHTML = `<div class="ebay-status-box success">✅ ${matchedCount} item${matchedCount===1?'':'s'} auto-marked as Sold from eBay orders.</div>`;
        } else {
          app.showSavedToast();
        }
      } else if (statusEl){
        statusEl.innerHTML = `<div class="ebay-status-box success">✓ Checked — no new eBay sales found.</div>`;
      }
      return { checked: true, matchedCount };
    }catch(e){
      console.warn('eBay sale check failed:', e);
      if (statusEl) statusEl.innerHTML = `<div class="ebay-status-box error">❌ Check failed: ${app.escapeHtml(String(e.message || e))}</div>`;
      return { checked: false };
    }
  }

  // Partial anti-double-sell protection: eBay has a real API to end a
  // listing, Mercari/Poshmark don't — so this only covers the eBay side.
  // When an item is marked Sold and it has a live eBay listing (an
  // ebayOfferId from a prior publish), automatically withdraw that listing
  // so it can't sell twice. Best-effort: failures here are logged but never
  // block the actual item save, since the sale itself is already recorded
  // either way.
  export async function endEbayListingIfSold(itemData){
    if (itemData.status !== 'vendido') return;
    if (!itemData.ebayOfferId || itemData.ebayEndedAt) return;
    try{
      const token = await getValidEbayToken();
      if (!token) return;
      const res = await fetch('/api/ebay-end-listing', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ access_token: token, offer_id: itemData.ebayOfferId })
      });
      const data = await res.json();
      if (data.success){
        itemData.ebayEndedAt = Date.now();
        const idx = app.items.findIndex(i => i.id === itemData.id);
        if (idx >= 0) app.items[idx].ebayEndedAt = itemData.ebayEndedAt;
        await app.saveItem(itemData);
      } else {
        console.warn('Could not end eBay listing automatically:', data);
      }
    }catch(e){
      console.warn('Could not end eBay listing automatically:', e);
    }
  }

  // Works whether called from the item modal (ebayStatusArea) or from
  // Settings (ebayConnectionStatus) — whichever is present in the DOM.
  function ebayTargetArea(){
    return document.getElementById('ebayStatusArea') || document.getElementById('ebayConnectionStatus');
  }

  window.connectEbay = async function connectEbay(){
    const area = ebayTargetArea();
    area.innerHTML = `<div class="ebay-status-box pending">⏳ Opening eBay authorization page…</div>`;
    // Open the tab IMMEDIATELY (synchronously, inside the click handler) so the
    // browser still counts this as a direct result of the user's tap/click.
    // If we wait for the fetch below to finish first, mobile and desktop
    // browsers silently block the popup — which is why nothing seemed to happen.
    const authTab = window.open('about:blank', '_blank');
    try{
      const res = await fetch('/api/ebay-auth?action=url');
      const data = await res.json();
      if (!data.url) throw new Error('No auth URL returned');
      if (authTab && !authTab.closed){
        authTab.location.href = data.url;
      } else {
        // Popup was blocked despite opening it synchronously (rare, but some
        // mobile browsers/settings still block). Fall back to a manual link.
        area.innerHTML = `
          <div class="ebay-status-box error">
            ⚠️ Your browser blocked the popup. Tap the link below to continue:
            <br><a href="${data.url}" target="_blank" style="color:var(--terracotta); font-weight:600;">Open eBay authorization</a>
          </div>`;
        return;
      }
      area.innerHTML = `
        <div class="ebay-connect-box">
          <div class="ec-title">Authorize in the new tab, then paste here</div>
          <div class="ec-sub">After authorizing, the eBay page will show a "Copy to clipboard" button. Click it, then paste the result below:</div>
          <textarea id="ebayTokenPaste" style="width:100%; height:80px; border:1px solid var(--line); border-radius:8px; padding:10px; font-size:12px; font-family:'JetBrains Mono',monospace;" placeholder='Paste the token JSON here…'></textarea>
          <button onclick="applyEbayTokenPaste()" style="margin-top:8px; background:var(--terracotta); color:white; border:none; border-radius:8px; padding:10px 18px; font-size:13px; font-weight:600; cursor:pointer; width:100%;">
            ✓ Connect my eBay account
          </button>
        </div>`;
    }catch(err){
      if (authTab && !authTab.closed) authTab.close();
      area.innerHTML = `<div class="ebay-status-box error">❌ Could not start eBay authorization. Make sure the app is deployed and configured correctly.</div>`;
    }
  }

  window.applyEbayTokenPaste = async function(){
    const raw = document.getElementById('ebayTokenPaste')?.value?.trim();
    if (!raw){ alert('Please paste the token data first.'); return; }
    const area = ebayTargetArea();
    try{
      const tokens = JSON.parse(raw);
      if (!tokens.access_token || !tokens.refresh_token) throw new Error('Invalid token format');
      const result = await saveEbayTokens(tokens);
      if (result.ok){
        area.innerHTML = `
          <div class="ebay-status-box success">✅ eBay account connected successfully${tokens.sellerUsername ? ` as <b>${app.escapeHtml(tokens.sellerUsername)}</b>` : ''}!</div>`;
        // If this happened from Settings, refresh the fuller status box after a beat.
        setTimeout(() => { if (document.getElementById('ebayConnectionStatus')) app.renderEbayConnectionStatus(); }, 1500);
      } else {
        area.innerHTML = `
          <div class="ebay-status-box error">❌ Token was valid but could not be saved to the database.<br>Error: ${app.escapeHtml(result.error || 'unknown')}<br>This is likely a Firestore permissions issue — the "ebay_tokens" collection may need to be allowed in your security rules.</div>`;
      }
    }catch(e){
      alert('Could not read the token data. Please try connecting again and make sure you copied the full text.');
    }
  };

  // ---------- PHOTO HOSTING (for eBay, which requires public image URLs) ----------
  // Item photos are stored as base64 data URLs in Firestore (fine for our own
  // app), but eBay's Inventory API requires real https:// image URLs. This
  // uploads any photos that aren't hosted yet to Firebase Storage and returns
  // their public download URLs. Already-hosted URLs (from a previous listing
  // attempt) are cached on the item as `hostedPhotoUrls` and reused, so we
  // don't re-upload the same images every time.
  export async function ensureHostedPhotoUrls(item){
    if (item.hostedPhotoUrls && item.hostedPhotoUrls.length === (item.photos || []).length){
      return item.hostedPhotoUrls;
    }
    const { ref, uploadString, getDownloadURL } = window.storageFns;
    const urls = [];
    for (let i = 0; i < (item.photos || []).length; i++){
      const p = item.photos[i];
      // Photos are already hosted on Firebase Storage as https:// links
      // since the base64→Storage migration — nothing to upload, just reuse.
      if (typeof p === 'string' && p.startsWith('http')){
        urls.push(p);
        continue;
      }
      // Fallback for any leftover base64 data URL (shouldn't normally happen
      // anymore, but kept so very old un-migrated items don't hard-fail).
      const path = `ebay-listing-photos/${item.id}/${i}.jpg`;
      const fileRef = ref(window.storage, path);
      await uploadString(fileRef, p, 'data_url');
      const url = await getDownloadURL(fileRef);
      urls.push(url);
    }
    return urls;
  }

  // ---------- CORE EBAY PUBLISH (headless — no DOM) ----------
  // Does the actual work of publishing one item to eBay: uploads photos if
  // needed, calls /api/ebay-list, and persists the result on the item
  // (listing id/url, status, and tagging 'ebay' onto listedPlatforms without
  // touching any other platform already marked there). Shared by the
  // single-item "List on eBay" modal flow and the bulk "Publish selected on
  // eBay" flow — neither one duplicates this logic, and this function never
  // touches modal-specific DOM, so it's safe to call in a loop.
  //
  // Returns one of:
  //   { skipped: true, reason: 'already_listed' | 'no_price' }
  //   { success: true, listingId, listingUrl, categoryIdUsed, categoryPathUsed, categoryWasGuessed }
  //   { success: false, step, error, detail, debug* }
  export async function publishItemToEbayCore(item, forceRelist){
    if (item.ebayListingId && !forceRelist){
      return { skipped: true, reason: 'already_listed' };
    }
    if (!item.listPrice){
      return { skipped: true, reason: 'no_price' };
    }
    if (!item.listingDescription){
      return { skipped: true, reason: 'no_description' };
    }
    const token = await getValidEbayToken();
    if (!token){
      return { success: false, step: 'auth', error: 'eBay account not connected' };
    }
    try{
      let hostedPhotoUrls = [];
      if (item.photos && item.photos.length){
        hostedPhotoUrls = await ensureHostedPhotoUrls(item);
        // Cache the hosted URLs on the item so we don't re-upload next time.
        item.hostedPhotoUrls = hostedPhotoUrls;
        const idxPhoto = app.items.findIndex(i => i.id === item.id);
        if (idxPhoto >= 0) app.items[idxPhoto].hostedPhotoUrls = hostedPhotoUrls;
        await app.saveItem({ ...item, hostedPhotoUrls });
      }

      const freshToken = await getValidEbayToken();
      const res = await fetch('/api/ebay-list', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ access_token: freshToken, item, imageUrls: hostedPhotoUrls })
      });
      const data = await res.json();
      if (!data.success){
        const err = new Error(data.error || 'Unknown error');
        err.detail = data.detail;
        err.step = data.step;
        err.debugConditionSent = data.debugConditionSent;
        err.debugItemConditionRaw = data.debugItemConditionRaw;
        err.debugFullInventoryBody = data.debugFullInventoryBody;
        err.debugCategoryChosen = data.debugCategoryChosen;
        err.debugPolicyIdsSent = data.debugPolicyIdsSent;
        throw err;
      }
      // Tag 'ebay' onto listedPlatforms without disturbing any other
      // platform already marked there (e.g. she may have already marked
      // Poshmark) — this was previously only reflected via `status`.
      const listedPlatforms = Array.from(new Set([...(item.listedPlatforms || []), 'ebay']));
      const updated = { ...item, ebayListingId: data.listingId, ebayListingUrl: data.listingUrl, ebayOfferId: data.offerId || null, ebaySku: data.sku || null, ebayListedAt: Date.now(), status: 'anunciado', listedPlatforms };
      const idx = app.items.findIndex(i => i.id === item.id);
      if (idx >= 0) app.items[idx] = updated;
      await app.saveItem(updated);
      return {
        success: true,
        listingId: data.listingId,
        listingUrl: data.listingUrl,
        categoryIdUsed: data.categoryIdUsed,
        categoryPathUsed: data.categoryPathUsed,
        aspectsUsed: data.aspectsUsed,
        categoryWasGuessed: !item.ebayCategoryId,
      };
    }catch(err){
      console.error('eBay listing failed:', err);
      return {
        success: false,
        step: err.step || 'unknown',
        error: err.message,
        detail: err.detail,
        debugConditionSent: err.debugConditionSent,
        debugItemConditionRaw: err.debugItemConditionRaw,
        debugFullInventoryBody: err.debugFullInventoryBody,
        debugCategoryChosen: err.debugCategoryChosen,
        debugPolicyIdsSent: err.debugPolicyIdsSent,
      };
    }
  }

  // Renders the rich error box (with the debug detail eBay's API errors
  // usually need to be diagnosed) shared by the single-item and bulk flows.
  export function renderEbayErrorBoxHtml(result){
    let detailHtml = '';
    if (result.detail){
      const errorsList = result.detail.errors || (Array.isArray(result.detail) ? result.detail : [result.detail]);
      detailHtml = `<div style="margin-top:8px; padding:8px; background:rgba(0,0,0,0.04); border-radius:6px; font-family:monospace; font-size:11px; white-space:pre-wrap;">${app.escapeHtml(JSON.stringify(errorsList, null, 2))}</div>`;
    }
    let debugHtml = '';
    if (result.debugConditionSent !== undefined){
      debugHtml = `<div style="margin-top:8px; padding:8px; background:rgba(194,112,95,0.08); border-radius:6px; font-family:monospace; font-size:11px; white-space:pre-wrap;">DEBUG — condition sent to eBay: ${app.escapeHtml(String(result.debugConditionSent))}
DEBUG — item.condition (raw form value): ${app.escapeHtml(String(result.debugItemConditionRaw))}
DEBUG — category chosen: ${result.debugCategoryChosen ? app.escapeHtml(result.debugCategoryChosen.id + ' — ' + result.debugCategoryChosen.path) : 'n/a'}
DEBUG — full inventory body sent:
${app.escapeHtml(JSON.stringify(result.debugFullInventoryBody, null, 2))}</div>`;
    }
    if (result.debugPolicyIdsSent){
      debugHtml += `<div style="margin-top:8px; padding:8px; background:rgba(194,112,95,0.08); border-radius:6px; font-family:monospace; font-size:11px; white-space:pre-wrap;">DEBUG — policy IDs actually sent by the server (compare with Vercel dashboard values):
${app.escapeHtml(JSON.stringify(result.debugPolicyIdsSent, null, 2))}</div>`;
    }
    return `<div class="ebay-status-box error">
      ❌ Listing failed at step "${app.escapeHtml(result.step || 'unknown')}": ${app.escapeHtml(result.error)}<br>
      <small>Check that your eBay account policies (fulfillment, payment, return) are configured in Seller Hub.</small>
      ${detailHtml}
      ${debugHtml}
    </div>`;
  }

  export async function listItemOnEbay(item, forceRelist){
    const area = document.getElementById('ebayStatusArea');

    // Check if already listed
    if (item.ebayListingId && !forceRelist){
      const alreadyUrl = item.ebayListingUrl || `https://www.ebay.com/itm/${item.ebayListingId}`;
      area.innerHTML = `<div class="ebay-status-box success">
        ✅ Already listed on eBay · <a href="${alreadyUrl}" target="_blank">View listing ↗</a>
        <br><br><button id="relistOnEbayBtn" style="background:var(--terracotta);color:white;border:none;border-radius:8px;padding:8px 14px;font-size:12px;cursor:pointer;margin-top:4px;">Update existing listing</button>
      </div>`;
      document.getElementById('relistOnEbayBtn').addEventListener('click', () => listItemOnEbay(item, true));
      return;
    }

    // Check listing price
    if (!item.listPrice){
      area.innerHTML = `<div class="ebay-status-box error">❌ Set a listing price first before publishing to eBay.</div>`;
      return;
    }

    // Check listing description — the eBay description reuses whatever was
    // generated/saved in the listing generator (Poshmark tab) rather than
    // eBay building its own from scratch.
    if (!item.listingDescription){
      area.innerHTML = `<div class="ebay-status-box error">❌ Generate a listing description first (scroll up to "Generate listing copy") — eBay reuses that same text.</div>`;
      return;
    }

    // Check eBay connection
    const token = await getValidEbayToken();
    if (!token){
      area.innerHTML = `<div class="ebay-status-box pending">
        🔗 eBay account not connected yet.
        <br><button onclick="connectEbay()" style="margin-top:8px; background:#E53238; color:white; border:none; border-radius:8px; padding:9px 16px; font-size:13px; font-weight:600; cursor:pointer; width:100%;">Connect my eBay account</button>
      </div>`;
      return;
    }

    // Show confirmation before publishing
    area.innerHTML = `
      <div class="ebay-connect-box">
        <div class="ec-title">${forceRelist ? 'Ready to update your eBay listing?' : 'Ready to publish on eBay?'}</div>
        <div class="ec-sub">
          <b>Title:</b> ${app.escapeHtml(buildEbayTitle(item))}<br>
          <b>Price:</b> $${parseFloat(item.listPrice).toFixed(2)}<br>
          <b>eBay Category:</b> ${item.ebayCategoryPath
            ? app.escapeHtml(item.ebayCategoryPath)
            : `<span style="color:var(--amber);">⚠️ Not set — will guess automatically, may be wrong. Edit the item first to search &amp; pick the exact category.</span>`}<br>
          <b>Condition:</b> ${app.escapeHtml(app.CONDITION_LABEL[item.condition] || item.condition || '')}<br>
          ${item.photos && item.photos.length > 0
            ? `<b>Photos:</b> ${item.photos.length} attached (will be uploaded automatically before publishing)`
            : `<span style="color:var(--danger)">⚠️ No photos — strongly recommended before listing</span>`}
        </div>
        <button id="confirmEbayListBtn" style="background:#E53238; color:white; border:none; border-radius:8px; padding:11px; font-size:13px; font-weight:600; cursor:pointer; width:100%;">
          ${forceRelist ? '🔄 Update listing now' : '🛒 Publish on eBay now'}
        </button>
        <button onclick="document.getElementById('ebayStatusArea').innerHTML=''" style="background:transparent; border:1px solid var(--line); border-radius:8px; padding:9px; font-size:13px; cursor:pointer; width:100%; margin-top:6px;">
          Cancel
        </button>
      </div>`;

    document.getElementById('confirmEbayListBtn').addEventListener('click', async () => {
      const confirmBtn = document.getElementById('confirmEbayListBtn');
      confirmBtn.disabled = true;
      confirmBtn.textContent = item.photos && item.photos.length ? '⏳ Uploading photos…' : '⏳ Publishing…';
      area.querySelector('button:last-child').disabled = true;

      const result = await publishItemToEbayCore(item, forceRelist);

      if (result.success){
        app.renderAll();
        area.innerHTML = `<div class="ebay-status-box success">
          🎉 Listed on eBay! · <a href="${result.listingUrl}" target="_blank">View listing ↗</a>
          ${result.categoryIdUsed ? `<br><small>Category used: ${app.escapeHtml(String(result.categoryIdUsed))}${result.categoryPathUsed ? ' — ' + app.escapeHtml(result.categoryPathUsed) : ''}</small>` : ''}
          ${result.aspectsUsed ? `<br><small>Item specifics sent: ${app.escapeHtml(JSON.stringify(result.aspectsUsed))}</small>` : ''}
        </div>`;
      }else{
        area.innerHTML = renderEbayErrorBoxHtml(result);
      }
    });
  }

  export function buildEbayTitle(item){
    const name = item.name || 'Item';
    // Only prepend the brand if it isn't already part of the name — she now
    // catalogs items with the brand already typed in (e.g. "Levi's 501
    // Jacket"), so blindly prepending it duplicated it ("Levi's Levi's...").
    const brand = item.brand || '';
    const brandAlreadyInName = brand && name.toLowerCase().includes(brand.toLowerCase());
    const parts = [brandAlreadyInName ? '' : brand, name, item.condition === 'novo_etiqueta' ? 'NWT' : ''].filter(Boolean).join(' ');
    return parts.slice(0, 80);
  }

  // ---------- BULK EBAY PUBLISH ----------
  // Sorts the current bulk selection into 3 groups instead of just
  // publish/skip:
  //  - blocked: can't publish at all (no price, no photos, or no
  //    description) — same hard requirements as the single-item flow.
  //  - needsReview: everything required IS there except a manually-chosen
  //    eBay category — held back rather than auto-guessing it, since a
  //    wrong guess is what caused a wave of listings needing manual fixes.
  //  - ready: actually gets published when she confirms.
  function computeBulkEbayGroups(updateAlready){
    const ids = Array.from(app.bulkSelectedIds);
    const selected = ids.map(id => app.items.find(i => i.id === id)).filter(Boolean);
    const alreadyListed = selected.filter(i => i.ebayListingId);
    const eligible = selected.filter(i => !i.ebayListingId || updateAlready);
    const blockedNoPrice = eligible.filter(i => !i.listPrice);
    const blockedNoPhotos = eligible.filter(i => i.listPrice && !(i.photos && i.photos.length));
    const blockedNoDescription = eligible.filter(i => i.listPrice && (i.photos && i.photos.length) && !i.listingDescription);
    const publishable = eligible.filter(i => i.listPrice && (i.photos && i.photos.length) && i.listingDescription);
    const needsReview = publishable.filter(i => !i.ebayCategoryId);
    const ready = publishable.filter(i => i.ebayCategoryId);
    return { selected, alreadyListed, blockedNoPrice, blockedNoPhotos, blockedNoDescription, needsReview, ready };
  }

  export async function showBulkEbayPreflight(updateAlready){
    const statusEl = document.getElementById('bulkActionStatus');
    if (!statusEl) return;
    updateAlready = !!updateAlready;

    statusEl.innerHTML = `<div style="opacity:0.7;">Checking eBay connection…</div>`;
    const token = await getValidEbayToken();
    if (!token){
      statusEl.innerHTML = `<div class="ebay-status-box pending">
        🔗 eBay account not connected yet.
        <br><button onclick="connectEbay()" style="margin-top:8px; background:#E53238; color:white; border:none; border-radius:8px; padding:9px 16px; font-size:13px; font-weight:600; cursor:pointer;">Connect my eBay account</button>
      </div>`;
      return;
    }

    const g = computeBulkEbayGroups(updateAlready);
    const itemLabel = (item) => app.escapeHtml(item.name || item.productCode || 'Item');
    const editBtn = (item) => `<button class="bulk-ebay-edit-btn" data-edit-id="${item.id}" style="background:transparent; border:1px solid var(--line); border-radius:6px; padding:2px 8px; font-size:11px; cursor:pointer; margin-left:6px;">Edit</button>`;

    statusEl.innerHTML = `
      <div class="ebay-connect-box">
        <div class="ec-title">Publish ${g.ready.length} item${g.ready.length===1?'':'s'} on eBay?</div>
        <div class="ec-sub">
          ${g.alreadyListed.length ? `<div>${updateAlready ? '🔄' : '⏭️'} ${g.alreadyListed.length} already listed on eBay ${updateAlready ? '(will be updated)' : '(skipped)'}</div>` : ''}
          ${g.alreadyListed.length ? `<label style="display:flex; align-items:center; gap:6px; margin-top:8px; margin-bottom:8px; font-size:12px; cursor:pointer;">
            <input type="checkbox" id="bulkUpdateAlreadyListedChk" ${updateAlready ? 'checked' : ''}>
            Also update the ${g.alreadyListed.length} already-listed item${g.alreadyListed.length===1?'':'s'} instead of skipping ${g.alreadyListed.length===1?'it':'them'}
          </label>` : ''}
          ${(g.blockedNoPrice.length || g.blockedNoPhotos.length || g.blockedNoDescription.length) ? `
            <div style="margin-top:8px;"><b style="color:var(--danger);">🚫 ${g.blockedNoPrice.length + g.blockedNoPhotos.length + g.blockedNoDescription.length} can't publish</b>
              ${g.blockedNoPrice.map(i => `<div style="margin-top:2px;">${itemLabel(i)} — no list price${editBtn(i)}</div>`).join('')}
              ${g.blockedNoPhotos.map(i => `<div style="margin-top:2px;">${itemLabel(i)} — no photos${editBtn(i)}</div>`).join('')}
              ${g.blockedNoDescription.map(i => `<div style="margin-top:2px;">${itemLabel(i)} — no listing description generated${editBtn(i)}</div>`).join('')}
            </div>` : ''}
          ${g.needsReview.length ? `
            <div style="margin-top:8px;"><b style="color:var(--amber-deep);">⚠️ ${g.needsReview.length} need${g.needsReview.length===1?'s':''} review — no eBay category chosen</b>
              ${g.needsReview.map(i => `<div style="margin-top:2px;">${itemLabel(i)} ${editBtn(i)}</div>`).join('')}
            </div>` : ''}
        </div>
        <button id="bulkConfirmEbayBtn" style="background:#E53238; color:white; border:none; border-radius:8px; padding:11px; font-size:13px; font-weight:600; cursor:pointer; width:100%; margin-top:10px;" ${g.ready.length===0?'disabled':''}>
          🛒 Publish ${g.ready.length} item${g.ready.length===1?'':'s'} now
        </button>
        <button id="bulkCancelEbayBtn" style="background:transparent; border:1px solid var(--line); border-radius:8px; padding:9px; font-size:13px; cursor:pointer; width:100%; margin-top:6px;">
          Cancel
        </button>
      </div>`;

    const chk = document.getElementById('bulkUpdateAlreadyListedChk');
    if (chk) chk.addEventListener('change', (e) => showBulkEbayPreflight(e.target.checked));
    document.getElementById('bulkCancelEbayBtn').addEventListener('click', () => { statusEl.innerHTML = ''; });
    statusEl.querySelectorAll('[data-edit-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const item = app.items.find(i => i.id === btn.dataset.editId);
        // Remembers this was opened from the bulk-review flow so the item
        // modal's save handler can offer "list it now?" immediately after
        // she fixes and saves it, instead of making her redo the whole
        // bulk-select flow just to publish one item.
        if (item) app.openModalFromBulkReview(item);
      });
    });
    const confirmBtn = document.getElementById('bulkConfirmEbayBtn');
    if (confirmBtn && g.ready.length){
      confirmBtn.addEventListener('click', () => runBulkEbayPublish(g.ready, updateAlready));
    }
  }

  export async function runBulkEbayPublish(toPublish, updateAlready){
    const results = []; // { item, result }
    for (let i = 0; i < toPublish.length; i++){
      const item = toPublish[i];
      const statusEl = document.getElementById('bulkActionStatus');
      if (statusEl){
        statusEl.innerHTML = `<div style="opacity:0.8;">⏳ Publishing ${i+1} of ${toPublish.length}: ${app.escapeHtml(item.name || item.productCode || 'item')}…</div>`;
      }
      const result = await publishItemToEbayCore(item, updateAlready && !!item.ebayListingId);
      results.push({ item, result });
    }
    app.renderAll();
    renderBulkEbayReport(results);
  }

  function renderBulkEbayReport(results){
    // app.renderAll() rebuilds the bulk bar from scratch, so #bulkActionStatus
    // from before the loop is stale — always re-query it here.
    const statusEl = document.getElementById('bulkActionStatus');
    if (!statusEl) return; // bulk mode got closed some other way mid-loop

    const success = results.filter(r => r.result.success);
    const skipped = results.filter(r => r.result.skipped);
    const failed = results.filter(r => !r.result.success && !r.result.skipped);
    const itemLabel = (item) => app.escapeHtml(item.name || item.productCode || 'Item');
    const editBtn = (item) => `<button class="bulk-ebay-edit-btn" data-edit-id="${item.id}" style="background:transparent; border:1px solid var(--line); border-radius:6px; padding:2px 8px; font-size:11px; cursor:pointer; margin-left:6px;">Edit</button>`;

    let html = `<div class="ebay-connect-box"><div class="ec-title">Bulk publish finished</div><div class="ec-sub">`;
    if (success.length){
      html += `<div style="margin-bottom:8px;"><b style="color:var(--sage-deep);">✅ ${success.length} published</b>`;
      html += success.map(r => `<div style="margin-top:2px;">${itemLabel(r.item)} · <a href="${r.result.listingUrl}" target="_blank">View ↗</a>${r.result.categoryWasGuessed ? ' <small style="color:var(--amber);">(category guessed)</small>' : ''}</div>`).join('');
      html += `</div>`;
    }
    if (failed.length){
      html += `<div style="margin-bottom:8px;"><b style="color:var(--danger);">❌ ${failed.length} failed</b>`;
      html += failed.map(r => `<div style="margin-top:2px;">${itemLabel(r.item)} — ${app.escapeHtml(r.result.error || 'unknown error')}${editBtn(r.item)}</div>`).join('');
      html += `</div>`;
    }
    if (skipped.length){
      const noPriceSkipped = skipped.filter(r => r.result.reason === 'no_price');
      const noDescSkipped = skipped.filter(r => r.result.reason === 'no_description');
      const alreadySkipped = skipped.filter(r => r.result.reason === 'already_listed');
      html += `<div><b style="color:var(--plum-soft);">⏭️ ${skipped.length} skipped</b>`;
      html += noPriceSkipped.map(r => `<div style="margin-top:2px;">${itemLabel(r.item)} — no list price${editBtn(r.item)}</div>`).join('');
      html += noDescSkipped.map(r => `<div style="margin-top:2px;">${itemLabel(r.item)} — no listing description generated yet${editBtn(r.item)}</div>`).join('');
      html += alreadySkipped.map(r => `<div style="margin-top:2px;">${itemLabel(r.item)} — already listed</div>`).join('');
      html += `</div>`;
    }
    html += `</div>
      <button id="bulkEbayReportCloseBtn" style="background:transparent; border:1px solid var(--line); border-radius:8px; padding:9px; font-size:13px; cursor:pointer; width:100%; margin-top:8px;">Close</button>
    </div>`;

    statusEl.innerHTML = html;
    statusEl.querySelectorAll('[data-edit-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const item = app.items.find(i => i.id === btn.dataset.editId);
        if (item) app.openModal(item);
      });
    });
    const closeBtn = document.getElementById('bulkEbayReportCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', () => { statusEl.innerHTML = ''; });
  }

  document.getElementById('ebayListBtn').addEventListener('click', () => {
    const item = app.items.find(i => i.id === app.currentEditId);
    if (item) listItemOnEbay(item);
    else document.getElementById('ebayStatusArea').innerHTML = `<div class="ebay-status-box error">Save the item first before listing on eBay.</div>`;
  });

  // These specific functions are also called from inline onclick="…" HTML
  // strings built elsewhere (checkEbaySalesNow, connectEbay,
  // applyEbayTokenPaste, disconnectEbay) — inline handlers resolve against
  // `window`, not module scope, so they have to live there regardless of
  // being real module exports too. No mocking, no fetch interception —
  // real functions only.
  window.checkEbaySalesNow = checkEbaySalesNow;