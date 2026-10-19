// The eBay section of Settings (UI layer; v3.17.6,
// docs/modularization.md): connection status, Test connection, Disconnect,
// one-time setup and offers to watchers. Moved out of main.js unchanged.
// Importing it registers the window.* handlers its buttons call.
// Its fetch('/api/…') calls are the ones a future apiUrl() helper will wrap.
import { items } from '../../modules/state.js';
import { escapeHtml } from '../../modules/format-utils.js';
import { jsonAuthHeaders } from '../../modules/api-auth.js';
import {
  ebayConnection, clearEbayConnection, ensureEbayConnected, loadEbayConnection,
} from '../../ebay-api.js';

let lastConnectionTestResult = null; // { ok, message } — survives the re-render below

export function renderEbayConnectionStatus(){
  const el = document.getElementById('ebayConnectionStatus');
  if (!el) return;
  const testBox = lastConnectionTestResult
    ? `<div class="ebay-status-box ${lastConnectionTestResult.ok ? 'success' : 'error'}" style="margin-top:8px;">${lastConnectionTestResult.message}</div>`
    : '';
  // Status comes from the server (the tokens never reach the app since
  // v3.16.0); null = not loaded yet or the status call failed.
  if (ebayConnection === null){
    el.innerHTML = `<div style="font-size:12px; opacity:0.7;">Checking eBay connection…</div>`;
    loadEbayConnection().then(conn => {
      if (conn) renderEbayConnectionStatus();
      else el.innerHTML = `<div class="ebay-status-box error">❌ Couldn't check the eBay connection right now. Reload the app to try again.</div>`;
    });
    return;
  }
  if (ebayConnection.connected){
    const connectedDate = ebayConnection.connected_at ? new Date(ebayConnection.connected_at).toLocaleString('en-US') : 'unknown';
    const lastTestedDate = ebayConnection.lastTestedAt ? new Date(ebayConnection.lastTestedAt).toLocaleString('en-US') : null;
    el.innerHTML = `
        <div class="ebay-status-box success">
          ✅ Connected${ebayConnection.sellerUsername ? ` as <b>${escapeHtml(ebayConnection.sellerUsername)}</b>` : ' <span style="opacity:0.7;">(fetching username…)</span>'}
          <br><small>Since: ${connectedDate}${lastTestedDate ? ` · Last tested: ${lastTestedDate}` : ''}</small>
          <br><br>
          <button onclick="connectEbay()" style="background:var(--terracotta); color:white; border:none; border-radius:8px; padding:8px 14px; font-size:12px; cursor:pointer; margin-right:8px;">🔄 Connect / switch account</button>
          <button onclick="testEbayConnection()" style="background:var(--sage); color:white; border:none; border-radius:8px; padding:8px 14px; font-size:12px; cursor:pointer; margin-right:8px;">🧪 Test connection</button>
          <button onclick="disconnectEbay()" style="background:transparent; border:1px solid var(--danger); color:var(--danger); border-radius:8px; padding:8px 14px; font-size:12px; cursor:pointer;">Disconnect</button>
          <div id="ebayTestResult">${testBox}</div>
        </div>`;
    if (!ebayConnection.sellerUsername) backfillSellerUsername();
  } else {
    el.innerHTML = `
        <div class="ebay-status-box pending">
          🔗 Not connected.
          <br><button onclick="connectEbay()" style="margin-top:8px; background:#E53238; color:white; border:none; border-radius:8px; padding:9px 16px; font-size:13px; font-weight:600; cursor:pointer;">Connect my eBay account</button>
        </div>`;
  }
}

// Backfills the seller username for tokens obtained before this feature
// existed, without requiring a full disconnect/reconnect. Note: if the
// stored token was granted before the identity scope was added, eBay may
// reject the identity lookup — in that case a one-time reconnect is still
// needed to pick up the new scope, but this covers most cases silently.
let usernameBackfillInFlight = false;
async function backfillSellerUsername(){
  if (usernameBackfillInFlight) return;
  usernameBackfillInFlight = true;
  try{
    if (!(await ensureEbayConnected())) return;
    // The server looks the username up with its own token and saves it.
    const res = await fetch('/api/ebay-auth?action=username', {
      method: 'POST',
      headers: await jsonAuthHeaders(),
      body: JSON.stringify({})
    });
    const data = await res.json();
    if (data.sellerUsername){
      ebayConnection.sellerUsername = data.sellerUsername;
      renderEbayConnectionStatus();
    }
  }catch(e){ console.warn('Username backfill failed:', e); }
  finally{ usernameBackfillInFlight = false; }
}

window.findEligibleOffers = async function(){
  const resultEl = document.getElementById('ebayOffersResult');
  if (resultEl) resultEl.innerHTML = `<span style="opacity:0.7;">Checking for interested buyers…</span>`;
  try{
    const ebayReady = await ensureEbayConnected();
    if (!ebayReady){
      if (resultEl) resultEl.innerHTML = `<div class="ebay-status-box error">❌ Connect your eBay account first.</div>`;
      return;
    }
    const res = await fetch('/api/ebay-listing-tools', {
      method: 'POST',
      headers: await jsonAuthHeaders(),
      body: JSON.stringify({ action: 'find_eligible' })
    });
    const data = await res.json();
    if (!data.success){
      if (resultEl) resultEl.innerHTML = `<div class="ebay-status-box error">❌ Couldn't check right now.</div>`;
      return;
    }
    const eligibleIds = new Set((data.listingIds || []).map(String));
    const matches = items.filter(i => i.ebayListingId && eligibleIds.has(String(i.ebayListingId)));
    if (matches.length === 0){
      if (resultEl) resultEl.innerHTML = `<div class="ebay-status-box success">✓ No interested buyers on any active listing right now.</div>`;
      return;
    }
    if (resultEl){
      resultEl.innerHTML = matches.map(item => `
          <div class="settings-row" data-offer-item="${item.id}">
            <div><div class="sr-label">${escapeHtml(item.name || 'Item')}</div><div class="sr-sub">Listed at $${(parseFloat(item.listPrice)||0).toFixed(2)}</div></div>
            <div style="display:flex; gap:6px; align-items:center;">
              <input type="number" min="1" max="90" placeholder="%" value="10" style="width:55px; padding:6px 8px; border-radius:8px; border:1px solid var(--line);" id="offerPct_${item.id}">
              <button onclick="sendWatcherOffer('${item.id}', '${item.ebayListingId}')" style="background:var(--sage); color:white; border:none; border-radius:8px; padding:8px 12px; font-size:12px; cursor:pointer;">Send</button>
            </div>
          </div>
        `).join('');
    }
  }catch(e){
    if (resultEl) resultEl.innerHTML = `<div class="ebay-status-box error">❌ ${escapeHtml(String(e.message || e))}</div>`;
  }
};

window.sendWatcherOffer = async function(itemId, listingId){
  const pctInput = document.getElementById('offerPct_' + itemId);
  const pct = parseFloat(pctInput?.value) || 10;
  const row = document.querySelector(`[data-offer-item="${itemId}"]`);
  try{
    const res = await fetch('/api/ebay-listing-tools', {
      method: 'POST',
      headers: await jsonAuthHeaders(),
      body: JSON.stringify({ action: 'send_offer', listing_id: listingId, discount_percentage: pct })
    });
    const data = await res.json();
    if (data.success){
      if (row) row.innerHTML = `<div style="font-size:12px; color:var(--sage-deep);">✅ ${pct}% offer sent to interested buyers.</div>`;
    } else {
      if (row) row.innerHTML += `<div style="font-size:12px; color:var(--danger);">❌ Failed to send offer.</div>`;
    }
  }catch(e){
    if (row) row.innerHTML += `<div style="font-size:12px; color:var(--danger);">❌ ${escapeHtml(String(e.message || e))}</div>`;
  }
};

// Manually re-checks whether the stored eBay token still works, right now
// — without needing to attempt a full publish to find out it's dead.
// Calls the same identity lookup used to display the username, but always
// re-runs it (ignoring any cached username) and shows a clear pass/fail.
window.testEbayConnection = async function(){
  lastConnectionTestResult = { ok: true, message: '<span style="opacity:0.7;">Testing…</span>' };
  renderEbayConnectionStatus();
  try{
    if (!(await ensureEbayConnected())){
      lastConnectionTestResult = { ok: false, message: '❌ eBay is not connected — connect it first.' };
      renderEbayConnectionStatus();
      return;
    }
    // The server tests its own token (refreshing it if needed) and
    // records lastTestedAt.
    const res = await fetch('/api/ebay-auth?action=username', {
      method: 'POST',
      headers: await jsonAuthHeaders(),
      body: JSON.stringify({ markTested: true })
    });
    const data = await res.json().catch(() => ({}));
    await loadEbayConnection();
    if (res.ok && data.sellerUsername){
      lastConnectionTestResult = { ok: true, message: `✅ Connection OK — logged in as <b>${escapeHtml(data.sellerUsername)}</b>` };
    } else {
      lastConnectionTestResult = { ok: false, message: `❌ ${data.error ? escapeHtml(data.error) : 'The connection didn\'t work.'} Try "Connect / switch account" to reconnect.` };
    }
  }catch(e){
    lastConnectionTestResult = { ok: false, message: `❌ Test failed: ${escapeHtml(String(e.message || e))}` };
  }
  renderEbayConnectionStatus();
};

// Fully disconnects the eBay account: the server deletes the stored
// connection, then the in-memory status is cleared.
window.disconnectEbay = async function(){
  if (!confirm('Disconnect this eBay account? You\'ll need to log in again before publishing.')) return;
  try{
    const res = await fetch('/api/ebay-auth?action=disconnect', { method: 'POST', headers: await jsonAuthHeaders(), body: '{}' });
    if (!res.ok){
      const data = await res.json().catch(() => ({}));
      alert(`Could not disconnect eBay: ${data.error || `HTTP ${res.status}`}`);
      return;
    }
  }catch(e){
    alert(`Could not disconnect eBay: ${e.message || e}`);
    return;
  }
  clearEbayConnection();
  renderEbayConnectionStatus();
  alert('Disconnected. To switch to a different eBay account, also sign out of ebay.com in your browser before reconnecting.');
};

// Save handlers
window.runEbaySetup = async function(){
  const area = document.getElementById('ebaySetupResult');
  area.innerHTML = `<div class="ebay-status-box pending">⏳ Creating business policies and location on eBay…</div>`;
  try{
    const ebayReady = await ensureEbayConnected();
    if (!ebayReady){
      area.innerHTML = `<div class="ebay-status-box error">❌ Connect your eBay account first (in an item's "List on eBay" panel), then come back here.</div>`;
      return;
    }
    const res = await fetch('/api/ebay-setup', {
      method: 'POST',
      headers: await jsonAuthHeaders(),
      body: JSON.stringify({})
    });
    const data = await res.json();
    if (data.success){
      area.innerHTML = `
          <div class="ebay-status-box success">
            ✅ Created successfully! Copy these 5 values into your Vercel Environment Variables, then redeploy:
            <div style="margin-top:8px; padding:8px; background:rgba(0,0,0,0.04); border-radius:6px; font-family:monospace; font-size:11px; white-space:pre-wrap;">EBAY_FULFILLMENT_POLICY_ID=${escapeHtml(data.results.fulfillmentPolicyId)}
EBAY_FULFILLMENT_POLICY_ID_BUYER_PAYS=${escapeHtml(data.results.fulfillmentPolicyIdBuyerPays)}
EBAY_PAYMENT_POLICY_ID=${escapeHtml(data.results.paymentPolicyId)}
EBAY_RETURN_POLICY_ID=${escapeHtml(data.results.returnPolicyId)}
EBAY_MERCHANT_LOCATION_KEY=${escapeHtml(data.results.merchantLocationKey)}</div>
          </div>`;
    } else {
      area.innerHTML = `
          <div class="ebay-status-box error">
            ⚠️ Partially created — some steps failed. Details below:
            <div style="margin-top:8px; padding:8px; background:rgba(0,0,0,0.04); border-radius:6px; font-family:monospace; font-size:11px; white-space:pre-wrap;">${escapeHtml(JSON.stringify(data, null, 2))}</div>
          </div>`;
    }
  }catch(e){
    area.innerHTML = `<div class="ebay-status-box error">❌ Setup failed: ${escapeHtml(e.message)}</div>`;
  }
};
