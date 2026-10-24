// A store's eBay business policies and ship-from location (v3.28.11). Not a
// route: the leading underscore keeps Vercel from deploying it as a function.
//
// The five values used to come from Vercel env vars (Vitor's own policy ids,
// which only fit his eBay account). They now live per store, server only, in
// the store's connection doc: ebay_connections/{bizId}.policies. The browser
// can't read that collection (no rule), same as the tokens.
//
//   policies: {
//     fulfillmentPolicyId, fulfillmentPolicyIdBuyerPays,
//     paymentPolicyId, returnPolicyId, merchantLocationKey
//   }
//
// api/ebay-setup.js saves them for the caller's store; the platform action
// `ebay_policies_copy` copies the env values onto one store, once (Vitor's).
// Reading them in ebay-list.js / ebay-listing-tools.js comes in the next PR.
import { getFirebaseAdmin } from './_firebaseAdmin.js';
import { ebayConnectionId } from './_ebayToken.js';

const CONNECTIONS = 'ebay_connections';

// policies field -> env var it replaces.
export const POLICY_ENV = {
  fulfillmentPolicyId: 'EBAY_FULFILLMENT_POLICY_ID',
  fulfillmentPolicyIdBuyerPays: 'EBAY_FULFILLMENT_POLICY_ID_BUYER_PAYS',
  paymentPolicyId: 'EBAY_PAYMENT_POLICY_ID',
  returnPolicyId: 'EBAY_RETURN_POLICY_ID',
  merchantLocationKey: 'EBAY_MERCHANT_LOCATION_KEY',
};
export const POLICY_FIELDS = Object.keys(POLICY_ENV);

// Keeps only the five known fields, each a non-empty string; null unless all
// five are there (a half-saved set would fail at publish, so none is saved).
export function cleanPolicies(raw){
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const f of POLICY_FIELDS){
    const v = typeof raw[f] === 'string' ? raw[f].trim() : '';
    if (!v) return null;
    out[f] = v;
  }
  return out;
}

function dbOrError(db){
  if (db) return { db };
  const admin = getFirebaseAdmin();
  if (!admin.ok) return { error: { ok: false, status: 503, error: `The server can't reach its eBay connection: ${admin.error}` } };
  return { db: admin.db };
}

// The caller's store policies: { ok:true, policies } (policies is null when
// setup hasn't been run for this store) or { ok:false, status, error }.
// No fallback to the env vars: they are one seller's ids, wrong for any
// other store. `db` is only for tests.
export async function getEbayPolicies(auth, db){
  const { db: d, error } = dbOrError(db);
  if (error) return error;
  let connectionId;
  try{
    connectionId = ebayConnectionId(auth);
  }catch(e){
    return { ok: false, status: e.status || 403, error: e.message };
  }
  try{
    const snap = await d.collection(CONNECTIONS).doc(connectionId).get();
    const policies = snap.exists ? cleanPolicies(snap.data().policies) : null;
    return { ok: true, policies };
  }catch(e){
    console.error('eBay policies: read failed:', e);
    return { ok: false, status: 500, error: 'Could not read the eBay policies right now. Try again in a moment.' };
  }
}

// Saves a complete set on a store's connection (merge: the tokens stay).
export async function saveEbayPolicies(connectionId, rawPolicies, { source = 'setup', db } = {}){
  const policies = cleanPolicies(rawPolicies);
  if (!policies) return { ok: false, status: 400, error: 'All five eBay policy values are needed.' };
  const { db: d, error } = dbOrError(db);
  if (error) return error;
  try{
    await d.collection(CONNECTIONS).doc(connectionId).set({
      policies,
      policiesSavedAt: Date.now(),
      policiesSource: source,
    }, { merge: true });
    return { ok: true, policies };
  }catch(e){
    console.error('eBay policies: save failed:', e);
    return { ok: false, status: 500, error: 'Could not save the eBay policies right now. Try again in a moment.' };
  }
}

// Platform action `ebay_policies_copy` (admin only, checked by platform.js):
// copies the five env values onto ONE store's connection, the store named in
// body.bizId. Refuses when any env var is missing, when the store has no
// eBay connection (so no stray doc is created), and never touches another
// store. Re-running just writes the same values again.
export async function copyEnvPolicies(db, auth, body, env = process.env){
  const bizId = body && typeof body.bizId === 'string' ? body.bizId.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(bizId)){
    return { ok: false, status: 400, error: 'Pick the store to copy the eBay policies to (bizId).' };
  }
  const values = {};
  const missing = [];
  for (const f of POLICY_FIELDS){
    const v = typeof env[POLICY_ENV[f]] === 'string' ? env[POLICY_ENV[f]].trim() : '';
    if (v) values[f] = v; else missing.push(POLICY_ENV[f]);
  }
  if (missing.length){
    return { ok: false, status: 400, error: `Nothing copied. Not set in Vercel: ${missing.join(', ')}.` };
  }
  const ref = db.collection(CONNECTIONS).doc(bizId);
  const snap = await ref.get();
  if (!snap.exists){
    return { ok: false, status: 404, error: `Store "${bizId}" has no eBay connection. Connect eBay for it first.` };
  }
  await ref.set({ policies: values, policiesSavedAt: Date.now(), policiesSource: 'env', policiesCopiedBy: auth.uid }, { merge: true });
  return { ok: true, bizId, policies: values };
}
