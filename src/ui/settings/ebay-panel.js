// The eBay section of Settings (UI layer; v3.17.6,
// docs/modularization.md): connection status, Test connection, Disconnect,
// one-time setup and offers to watchers. Moved out of main.js unchanged.
// Importing it registers the window.* handlers its buttons call.
// Its fetch('/api/…') calls are the ones a future apiUrl() helper will wrap.
import { items } from '../../modules/state.js';
import { escapeHtml } from '../../modules/format-utils.js';
import { jsonAuthHeaders } from '../../modules/api-auth.js';
import { cleanShipFrom } from '../../domain/ship-from.js';
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
  shipFromCache = null; // another account may have another address
  renderEbayConnectionStatus();
  alert('Disconnected. To switch to a different eBay account, also sign out of ebay.com in your browser before reconnecting.');
};

// ---------- Ship-from address (v3.28.19) ----------
// City, state and ZIP, read from and saved on the store's eBay location by
// /api/ebay-setup (actions location / location_update). Nothing is kept in
// Firestore.
const SHIP_FROM_FIELDS = { city: 'shipFromCity', state: 'shipFromState', postalCode: 'shipFromZip' };
const SHIP_FROM_ERRORS = { city: 'shipFromCityError', state: 'shipFromStateError', postalCode: 'shipFromZipError' };

function readShipFromForm(){
  const v = (id) => document.getElementById(id)?.value || '';
  return { city: v(SHIP_FROM_FIELDS.city), stateOrProvince: v(SHIP_FROM_FIELDS.state), postalCode: v(SHIP_FROM_FIELDS.postalCode) };
}

function showShipFromErrors(errors = {}){
  for (const [k, id] of Object.entries(SHIP_FROM_ERRORS)){
    const hint = document.getElementById(id);
    const input = document.getElementById(SHIP_FROM_FIELDS[k]);
    if (hint){ hint.textContent = errors[k] || ''; hint.classList.toggle('is-error', !!errors[k]); }
    if (input){
      if (errors[k]) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
  }
  const first = Object.keys(SHIP_FROM_FIELDS).find(k => errors[k]);
  if (first) document.getElementById(SHIP_FROM_FIELDS[first])?.focus();
}

// The checked address, or null after showing what's wrong.
function shipFromFromForm(){
  const clean = cleanShipFrom(readShipFromForm());
  showShipFromErrors(clean.ok ? {} : clean.errors);
  return clean.ok ? clean.address : null;
}

function renderShipFromCurrent(data){
  const el = document.getElementById('shipFromCurrent');
  if (!el) return;
  if (!data){ el.innerHTML = ''; return; }
  if (!data.setUp){
    el.innerHTML = `<div class="ebay-status-box">Not set up yet. Enter your city, state and ZIP, then press Run eBay setup.</div>`;
    return;
  }
  if (!data.address){
    el.innerHTML = `<div class="ebay-status-box">eBay has no ship-from address for your location yet. Enter it below and press Save ship-from address.</div>`;
    return;
  }
  el.innerHTML = data.placeholder
    ? `<div class="ebay-status-box error">⚠️ eBay has the sample address <b>${escapeHtml(data.line)}</b> as your ship-from. Enter yours below and press Save ship-from address.</div>`
    : `<div class="ebay-status-box success">Ships from <b>${escapeHtml(data.line)}</b>${data.unconfirmed ? ' <small>(saved; eBay didn\'t confirm it yet)</small>' : ''}</div>`;
}

function fillShipFromForm(address){
  if (!address) return;
  const set = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
  set(SHIP_FROM_FIELDS.city, address.city);
  set(SHIP_FROM_FIELDS.state, address.stateOrProvince);
  set(SHIP_FROM_FIELDS.postalCode, address.postalCode);
}

async function postShipFrom(body){
  const res = await fetch('/api/ebay-setup', { method: 'POST', headers: await jsonAuthHeaders(), body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// What eBay last said, so a Settings redraw doesn't ask eBay again.
let shipFromCache = null;

function showShipFrom(data){
  renderShipFromCurrent(data);
  fillShipFromForm(data.placeholder ? null : data.address);
}

// Called when Settings is drawn: shows what eBay holds, prefilled in the form.
export async function loadShipFromAddress(){
  const el = document.getElementById('shipFromCurrent');
  if (!el) return;
  if (shipFromCache){ showShipFrom(shipFromCache); return; }
  const conn = ebayConnection === null ? await loadEbayConnection() : ebayConnection;
  if (!conn?.connected){ renderShipFromCurrent(null); return; }
  el.innerHTML = `<div style="font-size:12px; opacity:0.7;">Checking the ship-from address on eBay…</div>`;
  try{
    const { data } = await postShipFrom({ action: 'location' });
    if (!data.success){ el.innerHTML = `<div class="ebay-status-box error">${escapeHtml(data.error || "Couldn't read the ship-from address.")}</div>`; return; }
    shipFromCache = data;
    showShipFrom(data);
  }catch(e){
    el.innerHTML = `<div class="ebay-status-box error">Couldn't read the ship-from address right now.</div>`;
  }
}

window.saveShipFromAddress = async function(){
  const area = document.getElementById('ebaySetupResult');
  const address = shipFromFromForm();
  if (!address) return;
  area.innerHTML = `<div class="ebay-status-box pending">⏳ Saving the ship-from address on eBay…</div>`;
  try{
    const ebayReady = await ensureEbayConnected();
    if (!ebayReady){
      area.innerHTML = `<div class="ebay-status-box error">❌ Connect your eBay account first, then come back here.</div>`;
      return;
    }
    const { data } = await postShipFrom({ action: 'location_update', address });
    if (!data.success){
      if (data.fieldErrors) showShipFromErrors(data.fieldErrors);
      area.innerHTML = `<div class="ebay-status-box error">❌ ${escapeHtml(data.error || 'Could not save the ship-from address.')}</div>`;
      return;
    }
    shipFromCache = data;
    renderShipFromCurrent(data);
    area.innerHTML = `<div class="ebay-status-box success">✅ Ship-from address saved on eBay.</div>`;
  }catch(e){
    area.innerHTML = `<div class="ebay-status-box error">❌ Could not save: ${escapeHtml(e.message)}</div>`;
  }
};

// Save handlers
window.runEbaySetup = async function(){
  const area = document.getElementById('ebaySetupResult');
  const address = shipFromFromForm();
  if (!address){
    area.innerHTML = `<div class="ebay-status-box error">Enter your ship-from city, state and ZIP first.</div>`;
    return;
  }
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
      body: JSON.stringify({ address })
    });
    const data = await res.json();
    if (data.fieldErrors) showShipFromErrors(data.fieldErrors);
    if (data.success){
      shipFromCache = { success: true, setUp: true, address: data.shipFrom?.address, line: data.shipFrom?.line, placeholder: false };
      renderShipFromCurrent(shipFromCache);
      area.innerHTML = `
          <div class="ebay-status-box success">
            ✅ Done! Your shipping, payment and return policies and your ship-from location are set up on your eBay account and saved for your store.
          </div>`;
    } else if (res.status === 400 || res.status === 403){
      area.innerHTML = `<div class="ebay-status-box error">❌ ${escapeHtml(data.error || 'Setup was refused.')}</div>`;
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
