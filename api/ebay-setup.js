// /api/ebay-setup.js — ONE-TIME setup helper
// Creates the required Business Policies (fulfillment, payment, return) and
// Merchant Location on the connected eBay seller account, via the Account API,
// bypassing the Seller Hub UI (which has known bugs in Sandbox).
//
// Safe to call multiple times: if a policy with the same name already exists
// (e.g. from a prior partial run), eBay's "duplicate" error already includes
// the existing policy's ID, so we just reuse it instead of failing.
//
// POST body: { access_token }
// Response: { fulfillmentPolicyId, paymentPolicyId, returnPolicyId, merchantLocationKey }
// After calling, copy these 4 values into the matching Vercel environment
// variables: EBAY_FULFILLMENT_POLICY_ID, EBAY_PAYMENT_POLICY_ID,
// EBAY_RETURN_POLICY_ID, EBAY_MERCHANT_LOCATION_KEY — then redeploy.

const EBAY_SANDBOX = process.env.EBAY_SANDBOX === 'true';
const API_BASE = EBAY_SANDBOX ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';
const MARKETPLACE_ID = 'EBAY_US';

// Fixed names (no timestamp) so re-running this endpoint always targets the
// SAME policies/location instead of piling up duplicates every time.
const FULFILLMENT_NAME = 'CC Standard Shipping';
// Second policy, added when we found every listing was silently using the
// FULFILLMENT_NAME policy above (hardcoded free shipping) regardless of the
// per-item "Buyer pays / I pay" choice in the app — that toggle only ever
// fed her own profit math, never the real eBay listing. This policy starts
// as NOT free (a placeholder cost that ebay-list.js always overrides per
// listing via listingPolicies.shippingCostOverrides with the item's actual
// estimated shipping cost) so buyer-pays items really charge the buyer.
const FULFILLMENT_NAME_BUYER_PAYS = 'CC Buyer Pays Shipping';
const PAYMENT_NAME = 'CC Standard Payment';
const RETURN_NAME = 'CC 30 Day Returns';
const LOCATION_KEY = 'cc_main_location';

async function ebayRequest(method, path, accessToken, body){
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Content-Language': 'en-US',
      'Accept-Language': 'en-US',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try{ data = JSON.parse(text); }catch(e){ data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

// Looks through an eBay error response for a "duplicate policy" style error
// and extracts the existing policy's ID from whichever parameter name eBay
// happened to use for it (this has varied across policy types/versions).
function extractDuplicateId(errorData){
  const err = errorData?.errors?.[0];
  if (!err) return null;
  const isDuplicate = /already exists|duplicate/i.test(err.longMessage || err.message || '');
  if (!isDuplicate) return null;
  const idParam = (err.parameters || []).find(p =>
    ['DuplicateProfileId', 'Shipping Profile Id', 'duplicatePolicyId', 'policyId'].includes(p.name)
  );
  return idParam ? idParam.value : null;
}

// Given a getXPolicies response, finds a policy by exact name and returns its ID field value.
function findPolicyByName(listData, listKey, idField, name){
  const list = listData?.[listKey] || [];
  const match = list.find(p => p.name === name);
  return match ? match[idField] : null;
}

export default async function handler(req, res){
  if (req.method !== 'POST'){
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { access_token } = req.body || {};
  if (!access_token){ return res.status(400).json({ error: 'Missing access_token' }); }

  const results = {};
  const errors = {};

  // ---------- Opt-in to Business Policies program ----------
  // Required before any fulfillment/payment/return policy can be created. If
  // the account is already opted in, eBay may reject a repeat opt-in call
  // (sometimes even with a legacy XML error) — that's fine, we just move on.
  await ebayRequest('POST', '/sell/account/v1/program/opt_in', access_token, {
    programType: 'SELLING_POLICY_MANAGEMENT',
  });
  results.optedIn = true; // never block setup on this — policy creation below is the real test

  // ---------- Merchant Location ----------
  const locationBody = {
    location: {
      address: {
        addressLine1: '123 Main St',
        city: 'Orlando',
        stateOrProvince: 'FL',
        postalCode: '32801',
        country: 'US',
      },
    },
    name: 'Calculated Chaos Main Location',
    merchantLocationStatus: 'ENABLED',
    locationTypes: ['WAREHOUSE'],
  };
  const locResult = await ebayRequest('POST', `/sell/inventory/v1/location/${LOCATION_KEY}`, access_token, locationBody);
  // eBay signals "this location already exists" two different ways: a real
  // HTTP 409, OR an HTTP 400 with errorId 25803 buried in the body. Either
  // one means the location is already there and set up correctly — that's
  // a success for us, not a failure, since the location doesn't need to be
  // recreated on every setup run.
  const locationAlreadyExists = locResult.status === 409 ||
    (locResult.data?.errors || []).some(e => e.errorId === 25803);
  if (locResult.ok || locResult.status === 204 || locationAlreadyExists){
    results.merchantLocationKey = LOCATION_KEY;
  } else {
    errors.location = locResult.data;
  }

  // ---------- Fulfillment Policy ----------
  const fulfillmentBody = {
    name: FULFILLMENT_NAME,
    marketplaceId: MARKETPLACE_ID,
    categoryTypes: [{ name: 'ALL_EXCLUDING_MOTORS_VEHICLES' }],
    handlingTime: { value: 2, unit: 'DAY' },
    shippingOptions: [
      {
        optionType: 'DOMESTIC',
        costType: 'FLAT_RATE',
        shippingServices: [
          {
            sortOrder: 1,
            shippingCarrierCode: 'USPS',
            shippingServiceCode: 'USPSPriority',
            shippingCost: { value: '0.00', currency: 'USD' },
            freeShipping: true,
          },
        ],
      },
    ],
  };
  const fulfillResult = await ebayRequest('POST', '/sell/account/v1/fulfillment_policy', access_token, fulfillmentBody);
  if (fulfillResult.ok && fulfillResult.data.fulfillmentPolicyId){
    results.fulfillmentPolicyId = fulfillResult.data.fulfillmentPolicyId;
  } else {
    const dupId = extractDuplicateId(fulfillResult.data);
    if (dupId){
      results.fulfillmentPolicyId = dupId;
    } else {
      errors.fulfillment = fulfillResult.data;
    }
  }

  // ---------- Fulfillment Policy (buyer pays) ----------
  const fulfillmentBodyBuyerPays = {
    name: FULFILLMENT_NAME_BUYER_PAYS,
    marketplaceId: MARKETPLACE_ID,
    categoryTypes: [{ name: 'ALL_EXCLUDING_MOTORS_VEHICLES' }],
    handlingTime: { value: 2, unit: 'DAY' },
    shippingOptions: [
      {
        optionType: 'DOMESTIC',
        costType: 'FLAT_RATE',
        shippingServices: [
          {
            sortOrder: 1,
            shippingCarrierCode: 'USPS',
            shippingServiceCode: 'USPSPriority',
            // Placeholder — ebay-list.js always sends a real per-item
            // shippingCostOverrides value, this base cost is never what a
            // buyer actually sees, it just can't be $0/freeShipping:true.
            shippingCost: { value: '8.00', currency: 'USD' },
            freeShipping: false,
          },
        ],
      },
    ],
  };
  const fulfillResultBuyerPays = await ebayRequest('POST', '/sell/account/v1/fulfillment_policy', access_token, fulfillmentBodyBuyerPays);
  if (fulfillResultBuyerPays.ok && fulfillResultBuyerPays.data.fulfillmentPolicyId){
    results.fulfillmentPolicyIdBuyerPays = fulfillResultBuyerPays.data.fulfillmentPolicyId;
  } else {
    const dupId = extractDuplicateId(fulfillResultBuyerPays.data);
    if (dupId){
      results.fulfillmentPolicyIdBuyerPays = dupId;
    } else {
      errors.fulfillmentBuyerPays = fulfillResultBuyerPays.data;
    }
  }

  // ---------- Payment Policy ----------
  // Note: for EBAY_US, eBay's managed payments system handles payment methods
  // automatically — no paymentMethods array is required or accepted here.
  const paymentBody = {
    name: PAYMENT_NAME,
    marketplaceId: MARKETPLACE_ID,
    categoryTypes: [{ name: 'ALL_EXCLUDING_MOTORS_VEHICLES' }],
  };
  const paymentResult = await ebayRequest('POST', '/sell/account/v1/payment_policy', access_token, paymentBody);
  if (paymentResult.ok && paymentResult.data.paymentPolicyId){
    results.paymentPolicyId = paymentResult.data.paymentPolicyId;
  } else {
    const dupId = extractDuplicateId(paymentResult.data);
    if (dupId){
      results.paymentPolicyId = dupId;
    } else {
      errors.payment = paymentResult.data;
    }
  }

  // ---------- Return Policy ----------
  const returnBody = {
    name: RETURN_NAME,
    marketplaceId: MARKETPLACE_ID,
    returnsAccepted: true,
    returnPeriod: { value: 30, unit: 'DAY' },
    returnShippingCostPayer: 'BUYER',
    refundMethod: 'MONEY_BACK',
  };
  const returnResult = await ebayRequest('POST', '/sell/account/v1/return_policy', access_token, returnBody);
  if (returnResult.ok && returnResult.data.returnPolicyId){
    results.returnPolicyId = returnResult.data.returnPolicyId;
  } else {
    const dupId = extractDuplicateId(returnResult.data);
    if (dupId){
      results.returnPolicyId = dupId;
    } else {
      errors.return = returnResult.data;
    }
  }

  // ---------- Fallback: look up existing policies by name if we still don't have IDs ----------
  // (covers the rare case where the duplicate error didn't include a usable ID)
  if (!results.fulfillmentPolicyId){
    const list = await ebayRequest('GET', `/sell/account/v1/fulfillment_policy?marketplace_id=${MARKETPLACE_ID}`, access_token);
    const found = findPolicyByName(list.data, 'fulfillmentPolicies', 'fulfillmentPolicyId', FULFILLMENT_NAME);
    if (found){ results.fulfillmentPolicyId = found; delete errors.fulfillment; }
  }
  if (!results.fulfillmentPolicyIdBuyerPays){
    const list = await ebayRequest('GET', `/sell/account/v1/fulfillment_policy?marketplace_id=${MARKETPLACE_ID}`, access_token);
    const found = findPolicyByName(list.data, 'fulfillmentPolicies', 'fulfillmentPolicyId', FULFILLMENT_NAME_BUYER_PAYS);
    if (found){ results.fulfillmentPolicyIdBuyerPays = found; delete errors.fulfillmentBuyerPays; }
  }
  if (!results.paymentPolicyId){
    const list = await ebayRequest('GET', `/sell/account/v1/payment_policy?marketplace_id=${MARKETPLACE_ID}`, access_token);
    const found = findPolicyByName(list.data, 'paymentPolicies', 'paymentPolicyId', PAYMENT_NAME);
    if (found){ results.paymentPolicyId = found; delete errors.payment; }
  }
  if (!results.returnPolicyId){
    const list = await ebayRequest('GET', `/sell/account/v1/return_policy?marketplace_id=${MARKETPLACE_ID}`, access_token);
    const found = findPolicyByName(list.data, 'returnPolicies', 'returnPolicyId', RETURN_NAME);
    if (found){ results.returnPolicyId = found; delete errors.return; }
  }

  const hasAllPolicies = results.fulfillmentPolicyId && results.fulfillmentPolicyIdBuyerPays &&
    results.paymentPolicyId && results.returnPolicyId && results.merchantLocationKey;

  return res.status(hasAllPolicies ? 200 : 207).json({
    success: hasAllPolicies,
    results,
    errors: Object.keys(errors).length ? errors : undefined,
    nextSteps: hasAllPolicies
      ? 'Copy these 5 values into your Vercel Environment Variables (EBAY_FULFILLMENT_POLICY_ID, EBAY_FULFILLMENT_POLICY_ID_BUYER_PAYS, EBAY_PAYMENT_POLICY_ID, EBAY_RETURN_POLICY_ID, EBAY_MERCHANT_LOCATION_KEY), then redeploy.'
      : 'One or more policies failed to create — check the errors field for details.',
  });
}
