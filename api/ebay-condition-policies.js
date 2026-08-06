// /api/ebay-condition-policies.js — fetches which condition values eBay
// allows for a specific category.
//
// WHY THIS EXISTS: eBay does NOT accept the same condition values in every
// category. Clothing accepts USED_EXCELLENT/USED_VERY_GOOD/etc, but many
// categories (Books, Electronics, Collectibles...) only accept a different
// subset (e.g. LIKE_NEW, VERY_GOOD, GOOD, ACCEPTABLE). Publishing with a
// condition value that category doesn't support fails with error 25021
// ("provided condition id is invalid for the selected primary category id").
//
// This endpoint calls eBay's Taxonomy API (getItemConditionPolicies) for the
// category the user picked, and returns the list of condition enums that
// ARE valid there — so the app can pick the closest valid match instead of
// guessing with one hardcoded map for all categories.
//
// POST body: { access_token, category_id }
// Returns: { success, conditions: ["NEW","LIKE_NEW","USED_EXCELLENT",...] }

const EBAY_SANDBOX = process.env.EBAY_SANDBOX === 'true';
const API_BASE = EBAY_SANDBOX
  ? 'https://api.sandbox.ebay.com'
  : 'https://api.ebay.com';
const CATEGORY_TREE_ID = '0'; // same shared tree used for category search

const CONDITION_ID_TO_ENUM = {
  '1000': 'NEW', '1500': 'NEW_OTHER', '1750': 'NEW_WITH_DEFECTS',
  '2000': 'MANUFACTURER_REFURBISHED', '2010': 'CERTIFIED_REFURBISHED',
  '2020': 'EXCELLENT_REFURBISHED', '2030': 'VERY_GOOD_REFURBISHED',
  '2500': 'SELLER_REFURBISHED', '2750': 'LIKE_NEW', '3000': 'USED_EXCELLENT',
  '4000': 'USED_VERY_GOOD', '5000': 'USED_GOOD', '6000': 'USED_ACCEPTABLE',
  '7000': 'FOR_PARTS_OR_NOT_WORKING',
};

module.exports = async (req, res) => {
  if (req.method !== 'POST'){
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try{
    const { access_token, category_id } = req.body || {};
    if (!access_token) return res.status(400).json({ error: 'Missing access_token' });
    if (!category_id) return res.status(400).json({ error: 'Missing category_id' });

    const url = `${API_BASE}/commerce/taxonomy/v1/category_tree/${CATEGORY_TREE_ID}/get_item_condition_policies?category_id=${encodeURIComponent(category_id)}`;
    const r = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
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
  }catch(err){
    return res.status(500).json({ error: 'Server error', detail: String(err && err.message || err) });
  }
};
