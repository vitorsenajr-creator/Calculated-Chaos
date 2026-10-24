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
// POST body: {}  (the eBay token comes from the server, _ebayToken.js)
// Response: { success, results: { fulfillmentPolicyId, fulfillmentPolicyIdBuyerPays,
//   paymentPolicyId, returnPolicyId, merchantLocationKey, ... }, errors?, saved, nextSteps }

import { requireApprovedUser } from './_requireApprovedUser.js';
import { getEbayAccessToken, ebayConnectionOr403 } from './_ebayToken.js';
import { setupEbayAccount } from './_ebaySetup.js';
import { saveEbayPolicies } from './_ebayPolicies.js';

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
  const ebayToken = await getEbayAccessToken(connectionId);
  if (!ebayToken.ok) return res.status(ebayToken.status).json({ error: ebayToken.error });

  const { results, errors, complete } = await setupEbayAccount(ebayToken.token);

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
    errors: Object.keys(errors).length ? errors : undefined,
    nextSteps: ok
      ? 'The policies and location were saved for your store.'
      : complete
        ? `Created on eBay, but they could not be saved: ${saveError}`
        : 'One or more policies failed to create — check the errors field for details.',
  });
}
