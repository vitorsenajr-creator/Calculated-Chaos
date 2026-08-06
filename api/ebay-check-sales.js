// /api/ebay-check-sales.js — checks recent eBay orders and returns a simple
// list the front-end can match against its own items (by SKU or legacy
// listing ID) to auto-detect sales, instead of requiring a manual mark.
//
// Uses the Fulfillment API's getOrders call:
//   GET /sell/fulfillment/v1/order?filter=creationdate:[since..]
//
// POST body: { access_token, since_iso }  (since_iso optional — defaults to
// last 14 days, which comfortably covers "checked every time the app opens"
// without pulling the full 90-day default every time)
// Returns: { success, sales: [{ sku, legacyItemId, orderId, total, creationDate }] }

const EBAY_SANDBOX = process.env.EBAY_SANDBOX === 'true';
const API_BASE = EBAY_SANDBOX
  ? 'https://api.sandbox.ebay.com'
  : 'https://api.ebay.com';

module.exports = async (req, res) => {
  if (req.method !== 'POST'){
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try{
    const { access_token, since_iso } = req.body || {};
    if (!access_token) return res.status(400).json({ error: 'Missing access_token' });

    const since = since_iso || new Date(Date.now() - 14 * 86400000).toISOString();
    const url = `${API_BASE}/sell/fulfillment/v1/order?filter=${encodeURIComponent(`creationdate:[${since}..]`)}&limit=200`;

    const r = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
    });
    const text = await r.text();
    let data;
    try{ data = JSON.parse(text); }catch(e){ data = { raw: text }; }

    if (!r.ok){
      return res.status(r.status).json({ error: 'Failed to fetch eBay orders', detail: data });
    }

    const sales = [];
    (data.orders || []).forEach(order => {
      (order.lineItems || []).forEach(li => {
        sales.push({
          sku: li.sku || null,
          legacyItemId: li.legacyItemId || null,
          orderId: order.orderId,
          total: li.total?.value ? parseFloat(li.total.value) : null,
          creationDate: order.creationDate,
        });
      });
    });

    return res.status(200).json({ success: true, sales });
  }catch(err){
    return res.status(500).json({ error: 'Server error', detail: String(err && err.message || err) });
  }
};
