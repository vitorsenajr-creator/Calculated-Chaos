// Server-only eBay connection (v3.16.0). Not a route: the leading underscore
// keeps Vercel from deploying it as a function.
//
// The eBay OAuth tokens live in Firestore at ebay_connections/{bizId},
// which the browser can't read (no rule allows it; only Firebase Admin on
// the server can). Every eBay endpoint gets its access token from here
// instead of from the request body, and this module refreshes it when it
// expires. Until businesses exist (docs/multi-tenant.md) there is one
// connection, 'main'; the migration renames it to the business's id.
//
// Before v3.16.0 the tokens sat in ebay_tokens/main, readable by the
// browser. v3.16.0 copied them here on first use; v3.16.1 dropped that
// copy step and the doc's Firestore rule once production was confirmed.
import { getFirebaseAdmin } from './_firebaseAdmin.js';

const EBAY_SANDBOX = process.env.EBAY_SANDBOX === 'true';
export const EBAY_TOKEN_URL = EBAY_SANDBOX
  ? 'https://api.sandbox.ebay.com/identity/v1/oauth2/token'
  : 'https://api.ebay.com/identity/v1/oauth2/token';

// Scopes requested at connect time and on refresh. sell.fulfillment* were
// added for auto-detecting eBay sales (getOrders) and watcher offers; an
// account connected before that needs one reconnect to pick them up.
export const EBAY_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.inventory.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.marketing',
  'https://api.ebay.com/oauth/api_scope/sell.account',
  'https://api.ebay.com/oauth/api_scope/commerce.identity.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
].join(' ');

const CONNECTIONS = 'ebay_connections';
export const DEFAULT_CONNECTION_ID = 'main';

// Refresh a minute early so a token can't expire mid-request.
const EXPIRY_MARGIN_MS = 60 * 1000;

export function ebayBasicAuthHeader(){
  return 'Basic ' + Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString('base64');
}

function adminOrError(){
  const admin = getFirebaseAdmin();
  if (!admin.ok){
    return { error: { ok: false, status: 503, error: `The server can't reach its eBay connection: ${admin.error}` } };
  }
  return { admin };
}

// Reads the connection doc. Returns the data or null when eBay isn't
// connected.
async function readConnection(admin, connectionId){
  const snap = await admin.db.collection(CONNECTIONS).doc(connectionId).get();
  return snap.exists ? snap.data() : null;
}

async function refreshAccessToken(refreshToken){
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, scope: EBAY_SCOPES });
  const response = await fetch(EBAY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': ebayBasicAuthHeader() },
    body: body.toString(),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token){
    return { ok: false, detail: data };
  }
  return { ok: true, access_token: data.access_token, expires_in: data.expires_in };
}

// The access token every eBay endpoint uses. Returns { ok:true, token } or
// { ok:false, status, error } ready to send back to the browser.
async function getEbayAccessTokenUnsafe(connectionId = DEFAULT_CONNECTION_ID){
  const { admin, error } = adminOrError();
  if (error) return error;
  const conn = await readConnection(admin, connectionId);
  if (!conn || !conn.refresh_token){
    return { ok: false, status: 409, error: 'eBay is not connected. Connect it in Settings → eBay.' };
  }
  const expiresAt = (conn.connected_at || 0) + (conn.expires_in || 7200) * 1000;
  if (conn.access_token && Date.now() < expiresAt - EXPIRY_MARGIN_MS){
    return { ok: true, token: conn.access_token };
  }
  const refreshed = await refreshAccessToken(conn.refresh_token);
  if (!refreshed.ok){
    console.error('eBay token refresh failed:', JSON.stringify(refreshed.detail));
    return { ok: false, status: 401, error: 'The eBay connection expired or was revoked. Reconnect eBay in Settings → eBay.' };
  }
  await admin.db.collection(CONNECTIONS).doc(connectionId).set({
    access_token: refreshed.access_token,
    expires_in: refreshed.expires_in,
    connected_at: Date.now(),
  }, { merge: true });
  return { ok: true, token: refreshed.access_token };
}

// What the app may see: never the tokens.
async function getEbayConnectionStatusUnsafe(connectionId = DEFAULT_CONNECTION_ID){
  const { admin, error } = adminOrError();
  if (error) return error;
  const conn = await readConnection(admin, connectionId);
  if (!conn || !conn.refresh_token) return { ok: true, connected: false };
  return {
    ok: true,
    connected: true,
    sellerUsername: conn.sellerUsername || null,
    connected_at: conn.connected_at || null,
    expires_in: conn.expires_in || null,
    lastTestedAt: conn.lastTestedAt || null,
    connectedBy: conn.connectedBy || null,
  };
}

// Saves a brand-new connection (replaces whatever was there).
async function saveEbayConnectionUnsafe(tokens, connectionId = DEFAULT_CONNECTION_ID){
  const { admin, error } = adminOrError();
  if (error) return error;
  await admin.db.collection(CONNECTIONS).doc(connectionId).set(tokens);
  return { ok: true };
}

// Merges non-secret fields (sellerUsername, lastTestedAt).
async function updateEbayConnectionUnsafe(fields, connectionId = DEFAULT_CONNECTION_ID){
  const { admin, error } = adminOrError();
  if (error) return error;
  await admin.db.collection(CONNECTIONS).doc(connectionId).set(fields, { merge: true });
  return { ok: true };
}

// Disconnect: removes the connection.
async function deleteEbayConnectionUnsafe(connectionId = DEFAULT_CONNECTION_ID){
  const { admin, error } = adminOrError();
  if (error) return error;
  await admin.db.collection(CONNECTIONS).doc(connectionId).delete();
  return { ok: true };
}

// Every export returns { ok:false, status, error } instead of throwing
// (e.g. Firestore unreachable), so an endpoint can pass it straight back
// rather than crash into Vercel's generic error page.
function neverThrows(fn, what){
  return async (...args) => {
    try{
      return await fn(...args);
    }catch(e){
      console.error(`eBay connection: ${what} failed:`, e);
      return { ok: false, status: 500, error: `Could not ${what} the eBay connection right now. Try again in a moment.` };
    }
  };
}

export const getEbayAccessToken = neverThrows(getEbayAccessTokenUnsafe, 'read');
export const getEbayConnectionStatus = neverThrows(getEbayConnectionStatusUnsafe, 'read');
export const saveEbayConnection = neverThrows(saveEbayConnectionUnsafe, 'save');
export const updateEbayConnection = neverThrows(updateEbayConnectionUnsafe, 'update');
export const deleteEbayConnection = neverThrows(deleteEbayConnectionUnsafe, 'remove');
