// /api/ebay-auth.js — eBay OAuth handler and the app's view of the
// server-held eBay connection (v3.16.0: the tokens live only on the server,
// see _ebayToken.js). Operations via ?action= query param:
//   ?action=url        → the eBay authorization URL to send the user to,
//                        with a one-time ?state= code (owners only)
//   ?action=callback   → eBay's redirect: checks the state code, exchanges
//                        the code for tokens and stores them (v3.16.2; the
//                        tokens are never shown or copy-pasted any more)
//   ?action=status     → { connected, sellerUsername, connected_at, ... }
//                        (never the tokens)
//   ?action=username   → POST { markTested }: looks up the seller's
//                        username with the server's token; with markTested
//                        it's the Settings "Test connection" check
//   ?action=disconnect → removes the connection (owners only)
// The old ?action=refresh is gone: the server refreshes tokens itself.

import { requireApprovedUser } from './_requireApprovedUser.js';
import {
  getEbayAccessToken, getEbayConnectionStatus, saveEbayConnection,
  updateEbayConnection, deleteEbayConnection, createOAuthState, consumeOAuthState, ebayConnectionOr403,
  finishOAuthState, waitOAuthStateResult,
  EBAY_TOKEN_URL as TOKEN_URL, EBAY_SCOPES as SCOPES, ebayBasicAuthHeader as basicAuthHeader,
} from './_ebayToken.js';

const EBAY_CLIENT_ID     = process.env.EBAY_CLIENT_ID;
const EBAY_REDIRECT_URI  = process.env.EBAY_REDIRECT_URI; // e.g. https://calculated-chaos-deploy1-1.vercel.app/api/ebay-auth?action=callback
const EBAY_SANDBOX       = process.env.EBAY_SANDBOX === 'true'; // set to 'true' while testing

const BASE_AUTH_URL = EBAY_SANDBOX
  ? 'https://auth.sandbox.ebay.com/oauth2/authorize'
  : 'https://auth.ebay.com/oauth2/authorize';

const IDENTITY_BASE = EBAY_SANDBOX
  ? 'https://apiz.sandbox.ebay.com'
  : 'https://apiz.ebay.com';

// Fetches the connected seller's eBay username, so the app can display it
// in Settings and let her confirm she's on the right account BEFORE
// publishing anything — this is what would have caught the wrong-account
// mixup immediately instead of after a live listing went out.
async function fetchSellerUsername(accessToken){
  try{
    const r = await fetch(`${IDENTITY_BASE}/commerce/identity/v1/user/`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data.username || null;
  }catch(e){
    console.error('Failed to fetch eBay username:', e);
    return null;
  }
}


function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// The page the eBay tab lands on after the callback. On success `detail`
// is the seller's username (or null); on failure it's the message to show.
function sendCallbackPage(res, status, ok, detail){
  const message = ok
    ? `<h2>✅ eBay connected${detail ? ` as <span style="color:#C2705F;">${escapeHtml(detail)}</span>` : ''}</h2>
       <p>You can close this tab and go back to the Calculated Chaos app.</p>`
    : `<h2>❌ eBay wasn't connected</h2><p>${escapeHtml(detail || 'Unknown error.')}</p>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).send(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>eBay connection</title>
<style>body{font-family:sans-serif;text-align:center;padding:40px 16px;background:#FBF3E9;} h2{color:#3D2C32;} p{color:#6B5760;}</style>
</head>
<body>${message}</body>
</html>`);
}

// Reads the URL's query string with the WHATWG URL API. Vercel's req.query
// getter builds its object with the legacy url.parse(), which logs a DEP0169
// deprecation warning (v3.26.6). Missing params come back as undefined, as
// they did with req.query.
function readQuery(req){
  const params = new URL(req.url || '/', 'http://localhost').searchParams;
  return (name) => params.get(name) ?? undefined;
}

export default async function handler(req, res){
  const query = readQuery(req);
  // eBay's redirect only appends "?code=..." to whatever "Auth accepted URL"
  // was registered for the RuName — it does NOT preserve any extra query
  // params we might want (like ?action=callback). So if a "code" shows up
  // with no explicit action, treat it as the callback automatically.
  const action = query('action') || (query('code') ? 'callback' : undefined);

  // Every action except the callback needs a signed-in, approved user. The
  // callback is eBay's own browser redirect, so it carries no Firebase token.
  let authCheck = null;
  if (action !== 'callback'){
    authCheck = await requireApprovedUser(req);
    if (!authCheck.ok){
      return res.status(authCheck.status).json({ error: authCheck.error });
    }
  }
  // Connecting or disconnecting eBay is for owners, not employee logins.
  if ((action === 'url' || action === 'disconnect') && authCheck.role === 'employee'){
    return res.status(403).json({ error: 'Only the account owner can connect or disconnect eBay.' });
  }
  // Every signed-in action works on the caller's store connection; an
  // account without a store gets a 403, never the old shared one (v3.28.9).
  let connectionId = null;
  if (authCheck){
    connectionId = ebayConnectionOr403(authCheck, res);
    if (!connectionId) return;
  }

  // ---------- Connection status (no tokens) ----------
  if (action === 'status'){
    const status = await getEbayConnectionStatus(connectionId);
    return res.status(status.ok ? 200 : status.status).json(status.ok ? status : { error: status.error });
  }

  // ---------- Disconnect ----------
  if (action === 'disconnect'){
    const del = await deleteEbayConnection(connectionId);
    if (!del.ok) return res.status(del.status).json({ error: del.error });
    return res.status(200).json({ ok: true, connected: false });
  }

  // ---------- Return the eBay authorization URL ----------
  if (action === 'url'){
    if (!EBAY_CLIENT_ID || !EBAY_REDIRECT_URI){
      return res.status(500).json({ error: 'eBay credentials not configured on server.' });
    }
    const started = await createOAuthState(authCheck, connectionId);
    if (!started.ok) return res.status(started.status).json({ error: started.error });
    const params = new URLSearchParams({
      client_id: EBAY_CLIENT_ID,
      redirect_uri: EBAY_REDIRECT_URI,
      response_type: 'code',
      scope: SCOPES,
      prompt: 'login',
      state: started.state,
    });
    return res.status(200).json({ url: `${BASE_AUTH_URL}?${params.toString()}` });
  }

  // ---------- Exchange auth code for tokens ----------
  // Opened by eBay in the browser tab, so it answers with a small HTML page.
  // The one-time state code proves the flow was started from the app by an
  // owner; the tokens go straight to the server-held connection.
  if (action === 'callback'){
    const code = query('code');
    if (!code){
      return sendCallbackPage(res, 400, false, 'eBay didn\'t send an authorization code. Start again from Settings → eBay.');
    }
    const state = query('state');
    const started = await consumeOAuthState(state);
    if (!started.ok) return sendCallbackPage(res, started.status, false, started.error);
    if (started.repeat){
      // The same callback loaded twice: show what the first load did.
      const first = await waitOAuthStateResult(state);
      const result = first.ok && first.result;
      if (result && result.ok) return sendCallbackPage(res, 200, true, result.sellerUsername || null);
      if (result) return sendCallbackPage(res, 400, false, result.error);
      return sendCallbackPage(res, 409, false, 'Still finishing the eBay sign-in. Go back to the app; it updates by itself in a few seconds.');
    }
    // Every path below records its outcome for a possible repeat load.
    const fail = async (status, message) => {
      await finishOAuthState(state, { ok: false, error: message });
      return sendCallbackPage(res, status, false, message);
    };
    try{
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: EBAY_REDIRECT_URI,
      });
      const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': basicAuthHeader(),
        },
        body: body.toString(),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.access_token || !data.refresh_token){
        console.error('eBay token exchange error:', JSON.stringify(data));
        return fail(502, `eBay didn't accept the sign-in (${data.error_description || data.error || `HTTP ${response.status}`}). Start again from Settings → eBay.`);
      }
      const sellerUsername = await fetchSellerUsername(data.access_token);
      const saved = await saveEbayConnection({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: Number(data.expires_in) || 7200,
        token_type: data.token_type || 'User Access Token',
        connected_at: Date.now(),
        // Unlike connected_at, refreshes don't touch it: the app compares it
        // to tell that a new connect flow went through.
        authorizedAt: Date.now(),
        sellerUsername: sellerUsername || null,
        connectedBy: started.email || started.uid,
      }, started.connectionId);
      if (!saved.ok) return fail(saved.status, saved.error);
      await finishOAuthState(state, { ok: true, sellerUsername: sellerUsername || null });
      return sendCallbackPage(res, 200, true, sellerUsername);
    }catch(err){
      console.error('eBay callback error:', err);
      return fail(500, 'Server error during eBay authorization. Start again from Settings → eBay.');
    }
  }

  // ---------- Look up the seller's username for an existing valid token ----------
  // Used to backfill the display name for accounts that connected before this
  // feature existed, without requiring a full disconnect/reconnect.
  if (action === 'username'){
    const ebayToken = await getEbayAccessToken(connectionId);
    if (!ebayToken.ok) return res.status(ebayToken.status).json({ error: ebayToken.error });
    const sellerUsername = await fetchSellerUsername(ebayToken.token);
    const fields = {};
    if (sellerUsername) fields.sellerUsername = sellerUsername;
    if (req.body && req.body.markTested) fields.lastTestedAt = Date.now();
    if (Object.keys(fields).length) await updateEbayConnection(fields, connectionId);
    return res.status(200).json({ sellerUsername });
  }

  // ---------- Removed: the server refreshes tokens itself ----------
  if (action === 'refresh'){
    return res.status(410).json({ error: 'This app version is out of date. Reload the app to get the latest version.' });
  }

  return res.status(400).json({ error: 'Unknown action.' });
}
