// /api/ebay-setup.js — ONE-TIME setup helper (per store)
// Creates (or finds) the required Business Policies (fulfillment x2, payment,
// return) and the Merchant Location on the CONNECTED eBay account of the
// caller's store, opting the account in to the Business Policies program when
// it isn't yet. The logic is in _ebaySetup.js.
//
// Since v3.28.11 the five values are saved on the store's own connection
// (ebay_connections/{bizId}.policies, server only, _ebayPolicies.js) instead
// of being copied by hand into Vercel env vars.
//
// Ship-from address (v3.28.19): city, state and ZIP, checked by
// src/domain/ship-from.js before anything goes to eBay, kept only on the
// seller's eBay account (never in Firestore). Changing it is for the store
// owner, not employee logins; reading it is for any member.
//
// POST body:
//   { address }                       -> setup (owner). Response: { success,
//     results: { fulfillmentPolicyId, …, merchantLocationKey }, errors?, saved,
//     nextSteps, shipFrom }
//   { action:'location' }             -> the address eBay holds for the
//     store's location: { success, setUp, address, line, placeholder }
//   { action:'location_update', address } -> replace it (owner): same answer
// (the eBay token comes from the server, _ebayToken.js)

import { requireApprovedUser } from './_requireApprovedUser.js';
import { getEbayAccessToken, ebayConnectionOr403 } from './_ebayToken.js';
import { setupEbayAccount, readLocation, updateLocationAddress } from './_ebaySetup.js';
import { saveEbayPolicies, getEbayPolicies, EBAY_SETUP_NEEDED } from './_ebayPolicies.js';
import { cleanShipFrom, shipFromOfLocation, shipFromLine, isPlaceholderShipFrom } from '../src/domain/ship-from.js';

const OWNER_ONLY = 'Only the store owner can change the eBay setup and the ship-from address.';

function addressAnswer(location){
  const address = shipFromOfLocation(location);
  return { address, line: shipFromLine(address), placeholder: isPlaceholderShipFrom(address) };
}

export default async function handler(req, res){
  if (req.method !== 'POST'){
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authCheck = await requireApprovedUser(req);
  if (!authCheck.ok){
    return res.status(authCheck.status).json({ error: authCheck.error });
  }
  // eBay calls use the caller's store connection, never a shared one (v3.28.9).
  const connectionId = ebayConnectionOr403(authCheck, res);
  if (!connectionId) return;

  const { action, address: rawAddress } = req.body || {};
  const changes = action !== 'location';
  if (action && action !== 'location' && action !== 'location_update'){
    return res.status(400).json({ error: 'Unknown action' });
  }
  if (changes && authCheck.role === 'employee'){
    return res.status(403).json({ error: OWNER_ONLY });
  }

  // The address is checked before any eBay call.
  let address = null;
  if (changes){
    const clean = cleanShipFrom(rawAddress);
    if (!clean.ok) return res.status(400).json({ error: 'Check the ship-from address.', fieldErrors: clean.errors });
    address = clean.address;
  }

  // Reading or changing the address works on the location saved for the store.
  let policies = null;
  if (action){
    const p = await getEbayPolicies(authCheck);
    if (!p.ok) return res.status(p.status).json({ error: p.error });
    policies = p.policies;
    if (!policies){
      if (action === 'location') return res.status(200).json({ success: true, setUp: false, address: null, line: '', placeholder: false });
      return res.status(409).json({ error: EBAY_SETUP_NEEDED, code: 'EBAY_SETUP_NEEDED' });
    }
  }

  const ebayToken = await getEbayAccessToken(connectionId);
  if (!ebayToken.ok) return res.status(ebayToken.status).json({ error: ebayToken.error });
  const token = ebayToken.token;

  if (action){
    const key = policies.merchantLocationKey;
    if (action === 'location_update'){
      const upd = await updateLocationAddress(token, key, address);
      if (!upd.ok){
        console.error('eBay ship-from update failed:', JSON.stringify(upd.data));
        return res.status(502).json({ error: "eBay didn't accept the ship-from address. Check the city, state and ZIP and try again." });
      }
    }
    const loc = await readLocation(token, key);
    if (!loc.ok){
      if (action === 'location_update'){
        return res.status(200).json({ success: true, setUp: true, address, line: shipFromLine(address), placeholder: false, unconfirmed: true });
      }
      return res.status(502).json({ error: "Couldn't read the ship-from address from eBay right now. Try again in a moment." });
    }
    return res.status(200).json({ success: true, setUp: true, ...addressAnswer(loc.location) });
  }

  const { results, errors, complete } = await setupEbayAccount(token, undefined, { address });

  // Save only a complete set: a half-saved one would fail at publish.
  let saved = false;
  let saveError = null;
  if (complete){
    const s = await saveEbayPolicies(connectionId, results, { source: 'setup' });
    saved = s.ok;
    if (!s.ok) saveError = s.error;
  }

  const ok = complete && saved;
  return res.status(ok ? 200 : 207).json({
    success: ok,
    saved,
    results,
    shipFrom: results.merchantLocationKey ? { address, line: shipFromLine(address) } : null,
    errors: Object.keys(errors).length ? errors : undefined,
    nextSteps: ok
      ? 'The policies and location were saved for your store.'
      : complete
        ? `Created on eBay, but they could not be saved: ${saveError}`
        : 'One or more policies failed to create — check the errors field for details.',
  });
}
