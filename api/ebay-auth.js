// /api/ebay-auth.js — eBay OAuth handler
// Handles three operations via ?action= query param:
//   ?action=url      → returns the eBay authorization URL to redirect the user to
//   ?action=callback → exchanges the authorization code for access + refresh tokens
//   ?action=refresh  → uses the refresh token to get a new access token

const EBAY_CLIENT_ID     = process.env.EBAY_CLIENT_ID;
const EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;
const EBAY_REDIRECT_URI  = process.env.EBAY_REDIRECT_URI; // e.g. https://calculated-chaos-deploy1-1.vercel.app/api/ebay-auth?action=callback
const EBAY_SANDBOX       = process.env.EBAY_SANDBOX === 'true'; // set to 'true' while testing

const BASE_AUTH_URL = EBAY_SANDBOX
  ? 'https://auth.sandbox.ebay.com/oauth2/authorize'
  : 'https://auth.ebay.com/oauth2/authorize';

const TOKEN_URL = EBAY_SANDBOX
  ? 'https://api.sandbox.ebay.com/identity/v1/oauth2/token'
  : 'https://api.ebay.com/identity/v1/oauth2/token';

const SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.inventory.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.marketing',
  'https://api.ebay.com/oauth/api_scope/sell.account',
  'https://api.ebay.com/oauth/api_scope/commerce.identity.readonly',
  // Added for auto-detecting eBay sales (getOrders) and sending discount
  // offers to watchers (Negotiation API) — existing connected accounts
  // need to reconnect once to pick up these new scopes.
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
].join(' ');

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

function basicAuthHeader(){
  return 'Basic ' + Buffer.from(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`).toString('base64');
}

export default async function handler(req, res){
  // eBay's redirect only appends "?code=..." to whatever "Auth accepted URL"
  // was registered for the RuName — it does NOT preserve any extra query
  // params we might want (like ?action=callback). So if a "code" shows up
  // with no explicit action, treat it as the callback automatically.
  const action = req.query.action || (req.query.code ? 'callback' : undefined);

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
    const { access_token } = req.body || {};
    if (!access_token) return res.status(400).json({ error: 'Missing access_token.' });
    const sellerUsername = await fetchSellerUsername(access_token);
    return res.status(200).json({ sellerUsername });
  }

  // ---------- Refresh access token ----------
  if (action === 'refresh'){
    const { refresh_token } = req.body || {};
    if (!refresh_token){
      return res.status(400).json({ error: 'Missing refresh_token.' });
    }
    try{
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token,
        scope: SCOPES,
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
        return res.status(500).json({ error: 'Token refresh failed', detail: data });
      }
      return res.status(200).json({
        access_token: data.access_token,
        expires_in: data.expires_in,
        refreshed_at: Date.now(),
      });
    }catch(err){
      console.error('eBay refresh error:', err);
      return res.status(500).json({ error: 'Server error during token refresh.' });
    }
  }

  return res.status(400).json({ error: 'Unknown action. Use ?action=url, ?action=callback, or ?action=refresh' });
}
