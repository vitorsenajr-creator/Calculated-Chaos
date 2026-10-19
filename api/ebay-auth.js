// /api/ebay-auth.js — eBay OAuth handler and the app's view of the
// server-held eBay connection (v3.16.0: the tokens live only on the server,
// see _ebayToken.js). Operations via ?action= query param:
//   ?action=url        → the eBay authorization URL to send the user to
//   ?action=callback   → eBay's redirect: exchanges the code for tokens
//   ?action=status     → { connected, sellerUsername, connected_at, ... }
//                        (never the tokens)
//   ?action=save_tokens → POST { tokens }: stores a connection pasted from
//                        the callback page (owners only)
//   ?action=username   → POST { markTested }: looks up the seller's
//                        username with the server's token; with markTested
//                        it's the Settings "Test connection" check
//   ?action=disconnect → removes the connection (owners only)
// The old ?action=refresh is gone: the server refreshes tokens itself.

import { requireApprovedUser } from './_requireApprovedUser.js';
import {
  getEbayAccessToken, getEbayConnectionStatus, saveEbayConnection,
  updateEbayConnection, deleteEbayConnection,
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


export default async function handler(req, res){
  // eBay's redirect only appends "?code=..." to whatever "Auth accepted URL"
  // was registered for the RuName — it does NOT preserve any extra query
  // params we might want (like ?action=callback). So if a "code" shows up
  // with no explicit action, treat it as the callback automatically.
  const action = req.query.action || (req.query.code ? 'callback' : undefined);

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
  if ((action === 'save_tokens' || action === 'disconnect') && authCheck.role === 'employee'){
    return res.status(403).json({ error: 'Only the account owner can connect or disconnect eBay.' });
  }

  // ---------- Connection status (no tokens) ----------
  if (action === 'status'){
    const status = await getEbayConnectionStatus();
    return res.status(status.ok ? 200 : status.status).json(status.ok ? status : { error: status.error });
  }

  // ---------- Store a connection pasted from the callback page ----------
  if (action === 'save_tokens'){
    const t = (req.body && req.body.tokens) || {};
    if (typeof t.access_token !== 'string' || typeof t.refresh_token !== 'string' || !t.access_token || !t.refresh_token){
      return res.status(400).json({ error: 'That doesn\'t look like the eBay connection data. Connect again and copy the whole text.' });
    }
    const saved = await saveEbayConnection({
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_in: Number(t.expires_in) || 7200,
      token_type: typeof t.token_type === 'string' ? t.token_type : 'User Access Token',
      connected_at: Number(t.connected_at) || Date.now(),
      sellerUsername: typeof t.sellerUsername === 'string' ? t.sellerUsername.slice(0, 100) : null,
      connectedBy: authCheck.email || authCheck.uid,
    });
    if (!saved.ok) return res.status(saved.status).json({ error: saved.error });
    return res.status(200).json(await getEbayConnectionStatus());
  }

  // ---------- Disconnect ----------
  if (action === 'disconnect'){
    const del = await deleteEbayConnection();
    if (!del.ok) return res.status(del.status).json({ error: del.error });
    return res.status(200).json({ ok: true, connected: false });
  }

  // ---------- Return the eBay authorization URL ----------
  if (action === 'url'){
    if (!EBAY_CLIENT_ID || !EBAY_REDIRECT_URI){
      return res.status(500).json({ error: 'eBay credentials not configured on server.' });
    }
    const params = new URLSearchParams({
      client_id: EBAY_CLIENT_ID,
      redirect_uri: EBAY_REDIRECT_URI,
      response_type: 'code',
      scope: SCOPES,
      prompt: 'login',
    });
    return res.status(200).json({ url: `${BASE_AUTH_URL}?${params.toString()}` });
  }

  // ---------- Exchange auth code for tokens ----------
  if (action === 'callback'){
    const code = req.query.code;
    if (!code){
      // Render a simple HTML error page — this endpoint is opened in a browser tab
      return res.status(400).send('<h2>Missing authorization code from eBay.</h2>');
    }
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
      const data = await response.json();
      if (!response.ok){
        console.error('eBay token exchange error:', data);
        return res.status(500).send(`<h2>Token exchange failed: ${data.error_description || JSON.stringify(data)}</h2>`);
      }
      // Return tokens to the browser — the frontend app will store them in Firestore
      // (never stored on the server, keeping the architecture stateless)
      const sellerUsername = await fetchSellerUsername(data.access_token);
      return res.status(200).send(`
        <!DOCTYPE html>
        <html>
        <head><title>eBay Connected!</title>
        <style>body{font-family:sans-serif;text-align:center;padding:40px;background:#FBF3E9;}
        h2{color:#3D2C32;} p{color:#6B5760;} .code{background:#fff;padding:20px;border-radius:10px;word-break:break-all;font-family:monospace;font-size:12px;}</style>
        </head>
        <body>
          <h2>✅ eBay authorization successful!</h2>
          ${sellerUsername ? `<p style="font-size:16px; font-weight:600; color:#C2705F;">Connected as: ${sellerUsername}</p>` : ''}
          <p>Copy the data below and paste it back into the Calculated Chaos app when prompted.</p>
          <div class="code" id="tokenData">${JSON.stringify({
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            expires_in: data.expires_in,
            token_type: data.token_type,
            connected_at: Date.now(),
            sellerUsername: sellerUsername || null,
          })}</div>
          <br>
          <button onclick="navigator.clipboard.writeText(document.getElementById('tokenData').textContent).then(()=>this.textContent='✓ Copied!')" 
            style="padding:12px 24px;background:#C2705F;color:white;border:none;border-radius:8px;font-size:15px;cursor:pointer;">
            Copy to clipboard
          </button>
          <p style="margin-top:20px;font-size:13px;">You can close this tab after copying.</p>
        </body>
        </html>
      `);
    }catch(err){
      console.error('eBay callback error:', err);
      return res.status(500).send('<h2>Server error during eBay authorization. Please try again.</h2>');
    }
  }

  // ---------- Look up the seller's username for an existing valid token ----------
  // Used to backfill the display name for accounts that connected before this
  // feature existed, without requiring a full disconnect/reconnect.
  if (action === 'username'){
    const ebayToken = await getEbayAccessToken();
    if (!ebayToken.ok) return res.status(ebayToken.status).json({ error: ebayToken.error });
    const sellerUsername = await fetchSellerUsername(ebayToken.token);
    const fields = {};
    if (sellerUsername) fields.sellerUsername = sellerUsername;
    if (req.body && req.body.markTested) fields.lastTestedAt = Date.now();
    if (Object.keys(fields).length) await updateEbayConnection(fields);
    return res.status(200).json({ sellerUsername });
  }

  // ---------- Removed: the server refreshes tokens itself ----------
  if (action === 'refresh'){
    return res.status(410).json({ error: 'This app version is out of date. Reload the app to get the latest version.' });
  }

  return res.status(400).json({ error: 'Unknown action.' });
}
