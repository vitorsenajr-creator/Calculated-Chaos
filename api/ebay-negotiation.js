// /api/ebay-negotiation.js — lets the seller send a discount offer to buyers
// who showed interest in a listing (watchlisted it, or added-to-cart and
// abandoned) without needing to do it manually in Seller Hub.
//
// Uses eBay's Negotiation API, which is available to all sellers with no
// special approval:
//   GET  /sell/negotiation/v1/find_eligible_items          (which listings have interested buyers)
//   POST /sell/negotiation/v1/send_offer_to_interested_buyers  (send the discount)
//
// POST body:
//   { access_token, action: 'find_eligible' }
//   { access_token, action: 'send_offer', listing_id, discount_percentage, message }
// Returns varies by action — see below.

const EBAY_SANDBOX = process.env.EBAY_SANDBOX === 'true';
const API_BASE = EBAY_SANDBOX
  ? 'https://api.sandbox.ebay.com'
  : 'https://api.ebay.com';
const MARKETPLACE_ID = 'EBAY_US';

module.exports = async (req, res) => {
  if (req.method !== 'POST'){
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try{
    const { access_token, action } = req.body || {};
    if (!access_token) return res.status(400).json({ error: 'Missing access_token' });

    if (action === 'find_eligible'){
      const r = await fetch(`${API_BASE}/sell/negotiation/v1/find_eligible_items`, {
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'X-EBAY-C-MARKETPLACE-ID': MARKETPLACE_ID,
        },
      });
      const text = await r.text();
      let data;
      try{ data = JSON.parse(text); }catch(e){ data = { raw: text }; }
      if (!r.ok) return res.status(r.status).json({ error: 'Failed to find eligible items', detail: data });
      const listingIds = (data.eligibleItems || []).map(i => i.listingId).filter(Boolean);
      return res.status(200).json({ success: true, listingIds });
    }

    if (action === 'send_offer'){
      const { listing_id, discount_percentage, message } = req.body || {};
      if (!listing_id) return res.status(400).json({ error: 'Missing listing_id' });
      if (!discount_percentage) return res.status(400).json({ error: 'Missing discount_percentage' });

      const body = {
        offers: [{
          listingId: String(listing_id),
          allowCounterOffer: true,
          message: message || `Thanks for your interest! Here's ${discount_percentage}% off if you buy now.`,
          offerDuration: { unit: 'DAY', value: 3 },
          quantity: 1,
          discountPercentage: String(discount_percentage),
        }],
      };

      const r = await fetch(`${API_BASE}/sell/negotiation/v1/send_offer_to_interested_buyers`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Content-Type': 'application/json',
          'X-EBAY-C-MARKETPLACE-ID': MARKETPLACE_ID,
        },
        body: JSON.stringify(body),
      });
      const text = await r.text();
      let data;
      try{ data = JSON.parse(text); }catch(e){ data = { raw: text }; }
      if (!r.ok) return res.status(r.status).json({ error: 'Failed to send offer', detail: data });
      return res.status(200).json({ success: true, result: data });
    }

    return res.status(400).json({ error: 'Unknown action' });
  }catch(err){
    return res.status(500).json({ error: 'Server error', detail: String(err && err.message || err) });
  }
};
