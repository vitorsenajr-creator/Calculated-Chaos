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
//   action: 'audit_list_skus'
//     -> added 2026-08-10 after the shipping-policy bug (see CLAUDE.md
//        "eBay shipping policy bug"), to answer "are we sure everything is
//        correct now?" — first of two audit calls: lists every SKU that
//        exists on the eBay account (paginated, fast, no per-item calls).
//     Returns: { success, skus: [...], totalSkus }
//
//   action: 'audit_check_skus'  { knownItems: [{ sku, freeShipping }], skus: [...] }
//     -> second audit call, driven by the client in small chunks (not one
//        call for the whole account — a single-request version hit a real
//        504 gateway timeout on a 100+ SKU account even with maxDuration
//        raised to 60s). Fetches each given SKU's live offer and cross-
//        references against knownItems (the catalog items the frontend
//        already has loaded). Flags two things: offers with no matching
//        catalog item ("orphaned" — live on eBay, untracked in the app)
//        and offers whose fulfillmentPolicyId doesn't match what
//        item.freeShipping says it should be (the exact class of bug that
//        started this). The knownItems freeShipping values come from the
//        client since env vars (the two real policy IDs) are only known
//        server-side — matching happens here so neither side needs the
//        other's secret/private data.
//     Returns: { success, orphans: [...], shippingMismatches: [...], checkedCount, lookupErrors, checkedListingIds }
//
//   action: 'legacy_scan'
//     -> added 2026-08-10 after discovering audit_list_skus/audit_check_skus
//        (both Inventory-API-based) undercount active listings — anything
//        created outside the Inventory API (Seller Hub, a bulk lister, an
//        older tool) has no SKU/inventory_item record and is invisible to
//        them. Uses the legacy Trading API's GetMyeBaySelling (ActiveList)
//        instead, which lists every currently-active listing directly.
//        Cross-referencing against checkedListingIds (from audit_check_skus)
//        happens client-side.
//     Returns: { success, items: [{itemId, sku, title, price, quantity, pictureUrl}], totalItems }
//
//   action: 'migrate_listing'  { listingId, sku }
//     -> converts one legacy listing (found via legacy_scan) into an
//        Inventory API item+offer under the given SKU, via eBay's
//        bulk_migrate_listing. The listing itself is untouched on eBay
//        (same ItemID/URL) — it just becomes visible to the Inventory API
//        (and therefore to this app's tools and future audits) afterward.
//     Returns: { success, sku, listingId } | { success: false, error, detail }

import { XMLParser, XMLBuilder } from 'fast-xml-parser';

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

function ebayAuthHeaders(access_token){
  return {
    'Authorization': `Bearer ${access_token}`,
    'Content-Type': 'application/json',
    'Content-Language': 'en-US',
    'Accept-Language': 'en-US',
  };
}

// Split into two sub-actions (list_skus / check_skus) instead of one big
// audit call — a single-request version that walked every SKU on a large
// account (100+) hit a real 504 gateway timeout even with maxDuration
// raised to 60s (Hobby plan apparently doesn't honor that reliably). The
// client now drives a loop: one list_skus call, then repeated check_skus
// calls over small chunks — no single request can time out regardless of
// catalog size, and she gets live progress instead of a silent multi-
// second wait.

// eBay's getOffers (GET /sell/inventory/v1/offer) REQUIRES a sku filter —
// errorId 25707 if you try to call it without one, there's no "list every
// offer on the account" mode. So SKUs come from inventory_item instead
// (DOES paginate with no filter) — check_skus below fetches each one's
// offer individually to get its live status/price/fulfillmentPolicyId.
async function handleAuditListSkus(req, res, access_token){
  const headers = ebayAuthHeaders(access_token);
  const skus = [];
  let offset = 0;
  const pageSize = 100;
  for (let page = 0; page < 20; page++){
    const r = await fetch(
      `${API_BASE}/sell/inventory/v1/inventory_item?limit=${pageSize}&offset=${offset}`,
      { headers }
    );
    const text = await r.text();
    let data;
    try{ data = JSON.parse(text); }catch(e){ data = { raw: text }; }
    if (!r.ok) return res.status(r.status).json({ error: 'Failed to fetch eBay inventory items', detail: data });

    const batch = data.inventoryItems || [];
    batch.forEach(it => { if (it.sku) skus.push(it.sku); });
    if (batch.length < pageSize) break;
    offset += pageSize;
  }
  return res.status(200).json({ success: true, skus, totalSkus: skus.length });
}

async function handleAuditCheckSkus(req, res, access_token){
  const { knownItems, skus } = req.body || {};
  const known = new Map((Array.isArray(knownItems) ? knownItems : []).map(k => [String(k.sku), k]));
  const chunk = Array.isArray(skus) ? skus : [];
  const headers = ebayAuthHeaders(access_token);

  const orphans = [];
  const shippingMismatches = [];
  const lookupErrors = [];
  // Every listingId seen here has an Inventory API record (that's how we
  // found it — via a SKU's offer), regardless of whether it matched a
  // catalog item. Returned so the client can diff it against the Trading
  // API's full active-listing list (handleLegacyScan below) and isolate
  // listings that have NO Inventory API record at all — see "eBay SKU
  // discovery gap" in CLAUDE.md.
  const checkedListingIds = [];
  const fulfillmentPolicyId = process.env.EBAY_FULFILLMENT_POLICY_ID || '';
  const fulfillmentPolicyIdBuyerPays = process.env.EBAY_FULFILLMENT_POLICY_ID_BUYER_PAYS || '';
  let checkedCount = 0;

  // Fetches one SKU's offer, with one retry after a short backoff — eBay
  // occasionally rate-limits a handful of the 10-concurrent requests below,
  // and silently dropping those undercounts the audit without any sign
  // anything went wrong, which is worse than a slower but complete result.
  async function fetchOfferForSku(sku, isRetry){
    try{
      const r = await fetch(`${API_BASE}/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}`, { headers });
      if (!r.ok){
        if (!isRetry){
          await new Promise(resolve => setTimeout(resolve, 300));
          return fetchOfferForSku(sku, true);
        }
        return { sku, error: `HTTP ${r.status}` };
      }
      const data = await r.json().catch(() => null);
      const offer = (data?.offers || []).find(o => o.status === 'PUBLISHED');
      return offer ? { sku, offer } : { sku, offer: null };
    }catch(e){
      if (!isRetry){
        await new Promise(resolve => setTimeout(resolve, 300));
        return fetchOfferForSku(sku, true);
      }
      return { sku, error: String(e && e.message || e) };
    }
  }

  // One request per SKU is a lot of round-trips — batch them concurrently
  // (10 at a time) within this already-small chunk.
  const BATCH_SIZE = 10;
  for (let i = 0; i < chunk.length; i += BATCH_SIZE){
    const batch = chunk.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(sku => fetchOfferForSku(sku, false)));

    for (const result of results){
      if (result.error){
        lookupErrors.push({ sku: result.sku, error: result.error });
        continue;
      }
      if (!result.offer) continue; // not actually live right now
      const { sku, offer } = result;
      checkedCount++;
      const listingId = offer.listing?.listingId || null;
      const price = offer.pricingSummary?.price?.value || null;
      const actualPolicyId = offer.listingPolicies?.fulfillmentPolicyId || null;
      const entry = { sku, offerId: offer.offerId, listingId, price, actualPolicyId };
      if (listingId) checkedListingIds.push(listingId);

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
  }

  return res.status(200).json({ success: true, orphans, shippingMismatches, checkedCount, lookupErrors, checkedListingIds });
}

// ---------- Legacy/outside-Inventory-API listing discovery ----------
// Added 2026-08-10: the audit above only ever sees listings that have an
// Inventory API record (it starts from GET inventory_item, which requires a
// SKU assigned through that API). A listing created any other way — Seller
// Hub, a bulk lister, an older third-party tool — never gets one, so it's
// completely invisible to handleAuditListSkus/handleAuditCheckSkus, whether
// or not it happens to have a SKU string set on it. Confirmed real: eBay's
// own "Active" count (104) didn't match totalSkus from the Inventory API
// audit (98) on the account this was built for.
//
// GetMyeBaySelling's ActiveList (Trading API, XML) is used instead of
// GetSellerList because it returns every currently-active listing directly
// with no EndTime-range guessing required (GetSellerList filters by a
// listing's end time, and Good-Til-Cancelled listings' per-cycle end time
// isn't a reliable proxy for "still active" across implementations).
//
// Trading API auth: same OAuth user token as everywhere else in this app,
// just passed as the X-EBAY-API-IAF-TOKEN header instead of a Bearer token
// (Trading API predates OAuth Bearer auth; this is eBay's documented bridge
// for using a modern token with it) — no RequesterCredentials/eBayAuthToken
// needed in the XML body when authenticating this way.
//
// UNVERIFIED against eBay's live API (no sandbox/production credentials in
// this environment) — the XML shape below matches eBay's Trading API
// documentation but has not been exercised against a real account. Watch
// the first real run closely; if it 500s, the response body's raw XML
// (surfaced via `detail`) is the place to start.
const TRADING_API_BASE = EBAY_SANDBOX
  ? 'https://api.sandbox.ebay.com/ws/api.dll'
  : 'https://api.ebay.com/ws/api.dll';
const TRADING_API_SITEID = '0'; // EBAY_US
const TRADING_API_COMPATIBILITY_LEVEL = '1193';

function tradingApiHeaders(access_token, callName){
  return {
    'X-EBAY-API-IAF-TOKEN': access_token,
    'X-EBAY-API-SITEID': TRADING_API_SITEID,
    'X-EBAY-API-COMPATIBILITY-LEVEL': TRADING_API_COMPATIBILITY_LEVEL,
    'X-EBAY-API-CALL-NAME': callName,
    'Content-Type': 'text/xml',
  };
}

const xmlBuilder = new XMLBuilder({ ignoreAttributes: false });
const xmlParser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });

async function handleLegacyScan(req, res, access_token){
  const items = [];
  const pageSize = 200;
  let pageNumber = 1;
  let totalPages = 1;

  do {
    const body = xmlBuilder.build({
      '?xml': { '@_version': '1.0', '@_encoding': 'utf-8' },
      GetMyeBaySellingRequest: {
        '@_xmlns': 'urn:ebay:apis:eBLBaseComponents',
        ErrorLanguage: 'en_US',
        WarningLevel: 'High',
        ActiveList: {
          Sort: 'TimeLeft',
          Pagination: { EntriesPerPage: pageSize, PageNumber: pageNumber },
        },
      },
    });

    const r = await fetch(TRADING_API_BASE, {
      method: 'POST',
      headers: tradingApiHeaders(access_token, 'GetMyeBaySelling'),
      body,
    });
    const text = await r.text();
    let parsed;
    try{ parsed = xmlParser.parse(text); }catch(e){
      return res.status(502).json({ error: 'Failed to parse eBay Trading API response', detail: text.slice(0, 2000) });
    }
    const response = parsed?.GetMyeBaySellingResponse;
    if (!response){
      return res.status(502).json({ error: 'Unexpected eBay Trading API response', detail: text.slice(0, 2000) });
    }
    if (response.Ack === 'Failure'){
      return res.status(502).json({ error: 'eBay Trading API GetMyeBaySelling failed', detail: response.Errors || text.slice(0, 2000) });
    }

    const activeList = response.ActiveList;
    const rawItems = activeList?.ItemArray?.Item;
    const batch = rawItems ? (Array.isArray(rawItems) ? rawItems : [rawItems]) : [];
    batch.forEach(it => {
      items.push({
        itemId: it.ItemID != null ? String(it.ItemID) : null,
        sku: it.SKU || null,
        title: it.Title || null,
        price: it.SellingStatus?.CurrentPrice?.['#text'] ?? it.SellingStatus?.CurrentPrice ?? null,
        quantity: it.Quantity != null ? Number(it.Quantity) : null,
        pictureUrl: it.PictureDetails?.PictureURL
          ? (Array.isArray(it.PictureDetails.PictureURL) ? it.PictureDetails.PictureURL[0] : it.PictureDetails.PictureURL)
          : (it.PictureDetails?.GalleryURL || null),
      });
    });

    totalPages = Number(activeList?.PaginationResult?.TotalNumberOfPages) || 1;
    pageNumber++;
  } while (pageNumber <= totalPages && pageNumber <= 20); // hard cap, mirrors handleAuditListSkus

  return res.status(200).json({ success: true, items, totalItems: items.length });
}

// ---------- Migrate a legacy (non-Inventory-API) listing ----------
// Converts an already-live listing found by handleLegacyScan into an
// Inventory API item + offer under a chosen SKU, via eBay's
// bulk_migrate_listing endpoint — the listing itself keeps running on eBay
// (same ItemID, same URL), it just gains an Inventory API record, which is
// what closes the gap for future audits AND for this app's own tools (all
// of which read/write by SKU). The caller assigns the SKU (the app's own
// nextProductCode() sequence) rather than letting eBay generate one, so it
// lines up with this catalog's numbering.
async function handleMigrateListing(req, res, access_token){
  const { listingId, sku } = req.body || {};
  if (!listingId) return res.status(400).json({ error: 'Missing listingId' });
  if (!sku) return res.status(400).json({ error: 'Missing sku' });

  const r = await fetch(`${API_BASE}/sell/inventory/v1/bulk_migrate_listing`, {
    method: 'POST',
    headers: ebayAuthHeaders(access_token),
    body: JSON.stringify({ requests: [{ listingId: String(listingId), sku: String(sku) }] }),
  });
  const text = await r.text();
  let data;
  try{ data = JSON.parse(text); }catch(e){ data = { raw: text }; }
  if (!r.ok) return res.status(r.status).json({ error: 'Failed to migrate listing', detail: data });

  const result = (data.responses || [])[0];
  if (!result || result.statusCode >= 300){
    return res.status(200).json({ success: false, error: 'eBay rejected the migration', detail: result || data });
  }
  return res.status(200).json({ success: true, sku: result.sku || sku, listingId });
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
    if (action === 'audit_list_skus') return await handleAuditListSkus(req, res, access_token);
    if (action === 'audit_check_skus') return await handleAuditCheckSkus(req, res, access_token);
    if (action === 'legacy_scan') return await handleLegacyScan(req, res, access_token);
    if (action === 'migrate_listing') return await handleMigrateListing(req, res, access_token);

    return res.status(400).json({ error: 'Unknown action' });
  }catch(err){
    return res.status(500).json({ error: 'Server error', detail: String(err && err.message || err) });
  }
};
