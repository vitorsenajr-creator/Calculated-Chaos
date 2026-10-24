// v3.28.18: publish, audit and migrate use the store's own eBay policies
// (ebay_connections/{bizId}.policies), never the Vercel env ids.
//
// The real handlers run on a fake Firebase Admin (setFirebaseAdminForTests)
// and a fake eBay (globalThis.fetch). The env ids are set to other values on
// purpose: any of them reaching eBay fails the test.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.EBAY_FULFILLMENT_POLICY_ID = 'ENV-FREE';
process.env.EBAY_FULFILLMENT_POLICY_ID_BUYER_PAYS = 'ENV-BUYER';
process.env.EBAY_PAYMENT_POLICY_ID = 'ENV-PAY';
process.env.EBAY_RETURN_POLICY_ID = 'ENV-RET';
process.env.EBAY_MERCHANT_LOCATION_KEY = 'ENV-LOC';

const { setFirebaseAdminForTests } = await import('../../api/_firebaseAdmin.js');
const { EBAY_SETUP_NEEDED } = await import('../../api/_ebayPolicies.js');
const ebayList = (await import('../../api/ebay-list.js')).default;
const ebayListingTools = (await import('../../api/ebay-listing-tools.js')).default;

const STORE = {
  fulfillmentPolicyId: 'STORE-FREE',
  fulfillmentPolicyIdBuyerPays: 'STORE-BUYER',
  paymentPolicyId: 'STORE-PAY',
  returnPolicyId: 'STORE-RET',
  merchantLocationKey: 'STORE-LOC',
};

// ---------- fake Firebase Admin: docs by path ----------
let docs;
function fakeAdmin(){
  const ref = (path) => ({
    get: async () => ({ exists: path in docs, data: () => docs[path] }),
    set: async (data, opts) => { docs[path] = opts?.merge ? { ...(docs[path] || {}), ...data } : data; },
    collection: (name) => col(`${path}/${name}`),
  });
  const col = (path) => ({ doc: (id) => ref(`${path}/${id}`) });
  return {
    ok: true,
    auth: { verifyIdToken: async () => ({ uid: 'u1', email: 'u1@example.com', email_verified: true }) },
    db: { collection: (name) => col(name) },
  };
}

function storeDocs(policies){
  return {
    'users/u1': { status: 'approved', activeBizId: 'b1' },
    'businesses/b1': { live: true },
    'businesses/b1/members/u1': { role: 'owner' },
    // A fresh access token: no refresh call to eBay.
    'ebay_connections/b1': {
      refresh_token: 'r', access_token: 'tok', connected_at: Date.now(), expires_in: 7200,
      ...(policies ? { policies } : {}),
    },
  };
}

// ---------- fake eBay ----------
let calls;
let offerOnEbay; // what GET /offer?sku= returns for the audit
function reply(status, data, raw){
  const text = raw ?? (data === undefined ? '' : JSON.stringify(data));
  return { ok: status < 300, status, text: async () => text, json: async () => JSON.parse(text || 'null') };
}
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  const body = opts.body && typeof opts.body === 'string' && opts.body.startsWith('{') ? JSON.parse(opts.body) : opts.body;
  calls.push({ method, url: u, body });
  if (u.includes('/ws/api.dll')){
    const call = opts.headers['X-EBAY-API-CALL-NAME'];
    return reply(200, undefined, `<?xml version="1.0"?><${call}Response><Ack>Success</Ack></${call}Response>`);
  }
  if (u.includes('get_item_aspects_for_category')) return reply(200, { aspects: [] });
  if (u.includes('get_item_condition_policies')) return reply(200, { itemConditionPolicies: [] });
  if (u.includes('/inventory_item/')) return reply(204);
  if (u.includes('/bulk_migrate_listing')) return reply(200, { responses: [{ statusCode: 200, sku: 'A1', offerId: 'O9' }] });
  if (u.includes('/offer?sku=')) return reply(200, { offers: offerOnEbay ? [offerOnEbay] : [] });
  if (method === 'POST' && u.endsWith('/sell/inventory/v1/offer')) return reply(201, { offerId: 'O1' });
  if (u.endsWith('/publish')) return reply(200, { listingId: 'L1' });
  if (u.endsWith('/offer/O9') && method === 'GET'){
    return reply(200, { offerId: 'O9', listingPolicies: { fulfillmentPolicyId: 'LEGACY', paymentPolicyId: 'P' } });
  }
  if (u.endsWith('/offer/O9') && method === 'PUT') return reply(204);
  throw new Error(`Unexpected request in the test: ${method} ${u}`);
};

function call(handler, body){
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(c){ this.statusCode = c; return this; },
      json(data){ resolve({ status: this.statusCode, data }); return this; },
      setHeader(){ return this; },
    };
    const req = { method: 'POST', url: '/api/x', headers: { authorization: 'Bearer tok' }, body };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

const ITEM = { id: 'i1', productCode: 'A1', name: 'Dress', listPrice: '25', ebayCategoryId: '63861', condition: 'excelente' };
const envIdsSent = () => calls.some(c => JSON.stringify(c.body || '').includes('ENV-'));

beforeEach(() => {
  calls = [];
  offerOnEbay = null;
  setFirebaseAdminForTests(fakeAdmin());
});
after(() => setFirebaseAdminForTests(null));

test('publish: the offer carries the store policies, buyer pays', async () => {
  docs = storeDocs(STORE);
  const r = await call(ebayList, { item: { ...ITEM, freeShipping: false }, imageUrls: [] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const offer = calls.find(c => c.method === 'POST' && c.url.endsWith('/sell/inventory/v1/offer')).body;
  assert.equal(offer.listingPolicies.fulfillmentPolicyId, 'STORE-BUYER');
  assert.equal(offer.listingPolicies.paymentPolicyId, 'STORE-PAY');
  assert.equal(offer.listingPolicies.returnPolicyId, 'STORE-RET');
  assert.equal(offer.merchantLocationKey, 'STORE-LOC');
  assert.ok(offer.listingPolicies.shippingCostOverrides, 'buyer pays keeps the per-item shipping cost');
  assert.equal(envIdsSent(), false);
});

test('publish: free shipping uses the store free-shipping policy', async () => {
  docs = storeDocs(STORE);
  const r = await call(ebayList, { item: { ...ITEM, freeShipping: true }, imageUrls: [] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const offer = calls.find(c => c.method === 'POST' && c.url.endsWith('/sell/inventory/v1/offer')).body;
  assert.equal(offer.listingPolicies.fulfillmentPolicyId, 'STORE-FREE');
  assert.equal(offer.listingPolicies.shippingCostOverrides, undefined);
  assert.equal(envIdsSent(), false);
});

test('publish: a store without eBay setup gets 409 and no eBay request', async () => {
  docs = storeDocs(null);
  const r = await call(ebayList, { item: ITEM, imageUrls: [] });
  assert.equal(r.status, 409);
  assert.equal(r.data.error, EBAY_SETUP_NEEDED);
  assert.equal(r.data.code, 'EBAY_SETUP_NEEDED');
  assert.equal(calls.length, 0);
});

test('publish: a half-saved set counts as no setup', async () => {
  docs = storeDocs({ ...STORE, returnPolicyId: '' });
  const r = await call(ebayList, { item: ITEM, imageUrls: [] });
  assert.equal(r.status, 409);
  assert.equal(calls.length, 0);
});

test('audit: shipping is compared with the store buyer-pays policy', async () => {
  docs = storeDocs(STORE);
  offerOnEbay = { status: 'PUBLISHED', offerId: 'O2', listing: { listingId: 'L2' }, listingPolicies: { fulfillmentPolicyId: 'ENV-BUYER' } };
  const r = await call(ebayListingTools, { action: 'audit_check_skus', knownItems: [{ sku: 'A1', freeShipping: false }], skus: ['A1'] });
  assert.equal(r.status, 200);
  assert.equal(r.data.shippingChecked, true);
  assert.equal(r.data.shippingNote, undefined);
  assert.equal(r.data.shippingMismatches.length, 1);
  assert.equal(r.data.shippingMismatches[0].expectedPolicyId, 'STORE-BUYER');

  offerOnEbay.listingPolicies.fulfillmentPolicyId = 'STORE-BUYER';
  const again = await call(ebayListingTools, { action: 'audit_check_skus', knownItems: [{ sku: 'A1', freeShipping: false }], skus: ['A1'] });
  assert.equal(again.data.shippingMismatches.length, 0);
});

test('audit: without eBay setup the rest runs and shipping is reported as not checked', async () => {
  docs = storeDocs(null);
  offerOnEbay = { status: 'PUBLISHED', offerId: 'O2', listing: { listingId: 'L2' }, listingPolicies: { fulfillmentPolicyId: 'X' } };
  const r = await call(ebayListingTools, { action: 'audit_check_skus', knownItems: [], skus: ['A1'] });
  assert.equal(r.status, 200);
  assert.equal(r.data.shippingChecked, false);
  assert.equal(r.data.shippingNote, EBAY_SETUP_NEEDED);
  assert.equal(r.data.shippingMismatches.length, 0);
  assert.equal(r.data.orphans.length, 1, 'the orphan check still runs');
});

test('migrate: the shipping is corrected to the store buyer-pays policy', async () => {
  docs = storeDocs(STORE);
  const r = await call(ebayListingTools, { action: 'migrate_listing', listingId: '123', sku: 'A1' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.shipping, { corrected: true });
  const put = calls.find(c => c.method === 'PUT' && c.url.endsWith('/offer/O9'));
  assert.equal(put.body.listingPolicies.fulfillmentPolicyId, 'STORE-BUYER');
  assert.equal(put.body.listingPolicies.paymentPolicyId, 'P', 'the rest of the offer is kept');
});

test('migrate: without eBay setup the import still finishes and says shipping was not corrected', async () => {
  docs = storeDocs(null);
  const r = await call(ebayListingTools, { action: 'migrate_listing', listingId: '123', sku: 'A1' });
  assert.equal(r.status, 200);
  assert.equal(r.data.success, true);
  assert.equal(r.data.shipping.corrected, false);
  assert.match(r.data.shipping.reason, /Run eBay setup/);
  assert.equal(calls.some(c => c.method === 'PUT' && c.url.endsWith('/offer/O9')), false);
});
