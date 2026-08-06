// /api/ebay-end-listing.js — ends (withdraws) an active eBay listing when the
// item sells somewhere else (Mercari, Poshmark, in person, etc.), so it stops
// being available for sale on eBay too. This is the "partial" anti-double-sell
// protection: eBay has a real API for this, Mercari/Poshmark don't, so this
// only covers the eBay side automatically.
//
// Uses the Inventory API's withdrawOffer call:
//   POST /sell/inventory/v1/offer/{offerId}/withdraw
// This ends the live listing but keeps the offer object around (unpublished),
// so it COULD be relisted later with publishOffer if ever needed — nothing
// is deleted.
//
// POST body: { access_token, offer_id }
// Returns: { success, listingId? }

const EBAY_SANDBOX = process.env.EBAY_SANDBOX === 'true';
const API_BASE = EBAY_SANDBOX
  ? 'https://api.sandbox.ebay.com'
  : 'https://api.ebay.com';

module.exports = async (req, res) => {
  if (req.method !== 'POST'){
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try{
    const { access_token, offer_id } = req.body || {};
    if (!access_token) return res.status(400).json({ error: 'Missing access_token' });
    if (!offer_id) return res.status(400).json({ error: 'Missing offer_id' });

    const r = await fetch(`${API_BASE}/sell/inventory/v1/offer/${encodeURIComponent(offer_id)}/withdraw`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
    });
    const text = await r.text();
    let data;
    try{ data = JSON.parse(text); }catch(e){ data = { raw: text }; }

    // 404 here commonly means the listing was already ended (manually, or
    // by a previous call) — treat that as success rather than an error,
    // since the end result the caller wants (nothing live on eBay) is
    // already true.
    if (!r.ok && r.status !== 404){
      return res.status(r.status).json({ error: 'Failed to end eBay listing', detail: data });
    }

    return res.status(200).json({ success: true, listingId: data.listingId || null });
  }catch(err){
    return res.status(500).json({ error: 'Server error', detail: String(err && err.message || err) });
  }
};
