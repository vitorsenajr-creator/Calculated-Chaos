// /api/ebay-listing-tools.js — merges what were ebay-condition-policies.js
// and ebay-negotiation.js into one file, dispatched on `action`. Done to
// free up a serverless-function slot on Vercel's Hobby plan (12-function
// cap) for the new narration endpoints — see CLAUDE.md "Voice narration
// capture" section for the full story. Both endpoints were purely
// internal (only ever called by this app's own frontend, never an
// externally-registered webhook URL like ebay-account-deletion.js/
// ebay-auth.js are), so merging them is safe — unlike those two, which
// must never move.
//
// POST body: { access_token, action, ...action-specific fields }
//
//   action: 'condition_policies'  { category_id }
//     -> which condition values eBay allows for a category (getItemConditionPolicies).
//        eBay does NOT accept the same condition values in every category —
//        Clothing accepts USED_EXCELLENT/USED_VERY_GOOD/etc, but many
//        categories (Books, Electronics, Collectibles...) only accept a
//        different subset. Publishing with an unsupported value fails with
//        error 25021.
//     Returns: { success, conditions: [...], itemConditionRequired }
//
//   action: 'find_eligible'
//     -> which of the seller's active listings have interested buyers
//        (watchlisted, or added-to-cart and abandoned) via eBay's
//        Negotiation API (find_eligible_items).
//     Returns: { success, listingIds: [...] }
//
//   action: 'send_offer'  { listing_id, discount_percentage, message? }
//     -> sends a discount offer to interested buyers on one listing
//        (send_offer_to_interested_buyers).
//     Returns: { success, result }
//
//   action: 'audit'  { knownItems: [{ sku, freeShipping }] }
//     -> added 2026-08-10 after the shipping-policy bug (see CLAUDE.md "eBay
//        shipping policy bug"), to answer "are we sure everything is
//        correct now?" — fetches every offer on the eBay account
//        (paginated) and cross-references by SKU against knownItems (the
//        catalog items the frontend already has loaded). Flags two things:
//        offers with no matching catalog item ("orphaned" — live on eBay,
//        untracked in the app) and offers whose fulfillmentPolicyId
//        doesn't match what item.freeShipping says it should be (the exact
//        class of bug that started this). The knownItems freeShipping
//        values come from the client since env vars (the two real policy
//        IDs) are only known server-side — matching happens here so
//        neither side needs the other's secret/private data.
//     Returns: { success, orphans: [...], shippingMismatches: [...], checkedCount }

const EBAY_SANDBOX = process.env.EBAY_SANDBOX === 'true';
const API_BASE = EBAY_SANDBOX
  ? 'https://api.sandbox.ebay.com'
  : 'https://api.ebay.com';
const MARKETPLACE_ID = 'EBAY_US';
const CATEGORY_TREE_ID = '0'; // same shared tree used for category search

const CONDITION_ID_TO_ENUM = {
  '1000': 'NEW', '1500': 'NEW_OTHER', '1750': 'NEW_WITH_DEFECTS',
  '2000': 'MANUFACTURER_REFURBISHED', '2010': 'CERTIFIED_REFURBISHED',
  '2020': 'EXCELLENT_REFURBISHED', '2030': 'VERY_GOOD_REFURBISHED',
  '2500': 'SELLER_REFURBISHED', '2750': 'LIKE_NEW', '3000': 'USED_EXCELLENT',
  '4000': 'USED_VERY_GOOD', '5000': 'USED_GOOD', '6000': 'USED_ACCEPTABLE',
  '7000': 'FOR_PARTS_OR_NOT_WORKING',
};

async function handleConditionPolicies(req, res, access_token){
  const { category_id } = req.body || {};
  if (!category_id) return res.status(400).json({ error: 'Missing category_id' });

  const url = `${API_BASE}/commerce/taxonomy/v1/category_tree/${CATEGORY_TREE_ID}/get_item_condition_policies?category_id=${encodeURIComponent(category_id)}`;
  const r = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${access_token}`,
      'Content-Type': 'application/json',
      'X-EBAY-C-MARKETPLACE-ID': MARKETPLACE_ID,
    }
  });
  const text = await r.text();
  let data;
  try{ data = JSON.parse(text); }catch(e){ data = { raw: text }; }

  if (!r.ok){
    return res.status(r.status).json({ error: 'eBay condition policy lookup failed', detail: data });
  }

  // eBay returns itemConditionPolicies: [{ categoryId, itemConditions: [{conditionId, conditionDescription}] }]
  const policy = (data.itemConditionPolicies || [])[0] || {};
  const conditions = (policy.itemConditions || [])
    .map(c => CONDITION_ID_TO_ENUM[String(c.conditionId)])
    .filter(Boolean);

  return res.status(200).json({ success: true, conditions, itemConditionRequired: policy.itemConditionRequired !== false });
}

async function handleFindEligible(req, res, access_token){
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

async function handleSendOffer(req, res, access_token){
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

async function handleAudit(req, res, access_token){
  const { knownItems } = req.body || {};
  const known = new Map((Array.isArray(knownItems) ? knownItems : []).map(k => [String(k.sku), k]));

  // Paginate through every offer on the account (no sku filter = all of
  // them). 100/page, hard-capped at 20 pages (2000 offers) as a sanity
  // limit — comfortably above anything a resale operation this size would
  // have live at once.
  const offers = [];
  let offset = 0;
  const pageSize = 100;
  for (let page = 0; page < 20; page++){
    const r = await fetch(
      `${API_BASE}/sell/inventory/v1/offer?marketplace_id=${MARKETPLACE_ID}&limit=${pageSize}&offset=${offset}`,
      {
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Content-Type': 'application/json',
          'Content-Language': 'en-US',
          'Accept-Language': 'en-US',
        },
      }
    );
    const text = await r.text();
    let data;
    try{ data = JSON.parse(text); }catch(e){ data = { raw: text }; }
    if (!r.ok) return res.status(r.status).json({ error: 'Failed to fetch eBay offers', detail: data });

    const batch = data.offers || [];
    offers.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }

  const orphans = [];
  const shippingMismatches = [];
  const fulfillmentPolicyId = process.env.EBAY_FULFILLMENT_POLICY_ID || '';
  const fulfillmentPolicyIdBuyerPays = process.env.EBAY_FULFILLMENT_POLICY_ID_BUYER_PAYS || '';

  for (const offer of offers){
    if (offer.status !== 'PUBLISHED') continue; // only care about listings actually live
    const sku = offer.sku;
    const listingId = offer.listing?.listingId || null;
    const price = offer.pricingSummary?.price?.value || null;
    const actualPolicyId = offer.listingPolicies?.fulfillmentPolicyId || null;
    const entry = { sku, offerId: offer.offerId, listingId, price, actualPolicyId };

    const match = known.get(String(sku));
    if (!match){
      orphans.push(entry);
      continue;
    }
    const expectedPolicyId = match.freeShipping ? fulfillmentPolicyId : fulfillmentPolicyIdBuyerPays;
    if (expectedPolicyId && actualPolicyId !== expectedPolicyId){
      shippingMismatches.push({ ...entry, expectedFreeShipping: !!match.freeShipping, expectedPolicyId });
    }
  }

  return res.status(200).json({ success: true, orphans, shippingMismatches, checkedCount: offers.length });
}

export default async (req, res) => {
  if (req.method !== 'POST'){
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try{
    const { access_token, action } = req.body || {};
    if (!access_token) return res.status(400).json({ error: 'Missing access_token' });

    if (action === 'condition_policies') return await handleConditionPolicies(req, res, access_token);
    if (action === 'find_eligible') return await handleFindEligible(req, res, access_token);
    if (action === 'send_offer') return await handleSendOffer(req, res, access_token);
    if (action === 'audit') return await handleAudit(req, res, access_token);

    return res.status(400).json({ error: 'Unknown action' });
  }catch(err){
    return res.status(500).json({ error: 'Server error', detail: String(err && err.message || err) });
  }
};
