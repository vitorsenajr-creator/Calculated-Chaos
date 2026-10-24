// Business Policies + Merchant Location setup on a seller's own eBay account
// (v3.28.11), the logic behind /api/ebay-setup.js. Not a route.
//
// Creates the required policies (fulfillment x2, payment, return) and the
// Merchant Location through the Account/Inventory APIs, bypassing the Seller
// Hub UI (which has known bugs in Sandbox). Safe to run many times: if a
// policy with the same name already exists, eBay's "duplicate" error carries
// the existing policy's ID (or we look it up by name), so it is reused.
//
// `ebayRequest` is a parameter only so tests can answer for eBay.
//
// Ship-from address (v3.28.19): the location is created with the seller's
// own city, state and ZIP (src/domain/ship-from.js), never a fixed sample
// address. When the location already exists, its address is updated with
// update_location_details (allowed any number of times for a warehouse).

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

export async function callEbay(method, path, accessToken, body){
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

const locationPath = (key) => `/sell/inventory/v1/location/${encodeURIComponent(key)}`;

// The address eBay holds for one location: { ok:true, location } (the raw
// getInventoryLocation answer) or { ok:false, status, data }.
export async function readLocation(access_token, key, request = callEbay){
  const r = await request('GET', locationPath(key), access_token);
  return r.ok ? { ok: true, location: r.data } : { ok: false, status: r.status, data: r.data };
}

// Replaces the location's address (city, state, ZIP, country). eBay answers
// 204 with no body.
export async function updateLocationAddress(access_token, key, address, request = callEbay){
  const r = await request('POST', `${locationPath(key)}/update_location_details`, access_token, { location: { address } });
  return (r.ok || r.status === 204) ? { ok: true } : { ok: false, status: r.status, data: r.data };
}

// Returns { results, errors, complete } for the connected account.
// `address` is a cleaned ship-from address (cleanShipFrom().address).
export async function setupEbayAccount(access_token, request = callEbay, { address } = {}){
  const ebayRequest = request;
  const results = {};
  const errors = {};

  // ---------- Opt-in to Business Policies program ----------
  // Required before any fulfillment/payment/return policy can be created, and
  // a brand-new seller account usually isn't in it yet. Ask eBay which
  // programs the account is in and opt in only when SELLING_POLICY_MANAGEMENT
  // is missing. If the list can't be read, opt in anyway (eBay may reject a
  // repeat opt-in, sometimes even with a legacy XML error; that's fine).
  // Never blocks setup: policy creation below is the real test.
  const programs = await ebayRequest('GET', '/sell/account/v1/program/get_opted_in_programs', access_token);
  const optedIn = programs.ok && (programs.data?.programs || []).some(p => p.programType === 'SELLING_POLICY_MANAGEMENT');
  if (!optedIn){
    const optIn = await ebayRequest('POST', '/sell/account/v1/program/opt_in', access_token, {
      programType: 'SELLING_POLICY_MANAGEMENT',
    });
    results.optInCalled = true;
    results.optedIn = optIn.ok;
  } else {
    results.optedIn = true;
  }

  // ---------- Merchant Location ----------
  if (!address){
    errors.location = { message: 'A ship-from address is needed.' };
  } else {
    const locationBody = {
      location: { address },
      name: 'Calculated Chaos Main Location',
      merchantLocationStatus: 'ENABLED',
      locationTypes: ['WAREHOUSE'],
    };
    const locResult = await ebayRequest('POST', locationPath(LOCATION_KEY), access_token, locationBody);
    // eBay signals "this location already exists" two different ways: a real
    // HTTP 409, OR an HTTP 400 with errorId 25803 buried in the body. Then
    // the address is brought up to date instead (an older setup created it
    // with a sample address).
    const locationAlreadyExists = locResult.status === 409 ||
      (locResult.data?.errors || []).some(e => e.errorId === 25803);
    if (locResult.ok || locResult.status === 204){
      results.merchantLocationKey = LOCATION_KEY;
    } else if (locationAlreadyExists){
      const upd = await updateLocationAddress(access_token, LOCATION_KEY, address, ebayRequest);
      if (upd.ok) results.merchantLocationKey = LOCATION_KEY;
      else errors.location = upd.data || { message: 'Could not update the ship-from address on eBay.' };
    } else {
      errors.location = locResult.data;
    }
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

  const complete = !!(results.fulfillmentPolicyId && results.fulfillmentPolicyIdBuyerPays &&
    results.paymentPolicyId && results.returnPolicyId && results.merchantLocationKey);
  return { results, errors, complete };
}
