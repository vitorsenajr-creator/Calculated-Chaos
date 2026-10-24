// Per-store eBay policies (v3.28.11): setup on a seller's own account with a
// fake eBay, saving on the store's connection doc, and the one-time env copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupEbayAccount } from '../../api/_ebaySetup.js';
import { getEbayPolicies, saveEbayPolicies, copyEnvPolicies, cleanPolicies } from '../../api/_ebayPolicies.js';

// A fake eBay account: remembers programs, policies (by name) and locations.
function fakeEbay({ opted = false, existing = {}, listFails = false } = {}){
  const state = { opted, calls: [], policies: { ...existing }, locations: new Set(), addresses: {}, nextId: 1000 };
  const kinds = {
    '/sell/account/v1/fulfillment_policy': ['fulfillmentPolicyId', 'fulfillmentPolicies'],
    '/sell/account/v1/payment_policy': ['paymentPolicyId', 'paymentPolicies'],
    '/sell/account/v1/return_policy': ['returnPolicyId', 'returnPolicies'],
  };
  const request = async (method, path, token, body) => {
    state.calls.push(`${method} ${path}`);
    assert.equal(token, 'tok');
    if (path === '/sell/account/v1/program/get_opted_in_programs'){
      if (listFails) return { ok: false, status: 500, data: {} };
      return { ok: true, status: 200, data: { programs: state.opted ? [{ programType: 'SELLING_POLICY_MANAGEMENT' }] : [] } };
    }
    if (path === '/sell/account/v1/program/opt_in'){
      assert.equal(body.programType, 'SELLING_POLICY_MANAGEMENT');
      state.opted = true;
      return { ok: true, status: 200, data: {} };
    }
    if (path.startsWith('/sell/inventory/v1/location/')){
      // v3.28.19: locations keep their address; an existing one is updated.
      const [key, sub] = path.replace('/sell/inventory/v1/location/', '').split('/');
      if (sub === 'update_location_details'){
        if (!state.locations.has(key)) return { ok: false, status: 404, data: {} };
        state.addresses[key] = body.location.address;
        return { ok: true, status: 204, data: {} };
      }
      if (method === 'GET'){
        return state.locations.has(key)
          ? { ok: true, status: 200, data: { merchantLocationKey: key, location: { address: state.addresses[key] } } }
          : { ok: false, status: 404, data: {} };
      }
      if (state.locations.has(key)) return { ok: false, status: 409, data: {} };
      state.locations.add(key);
      state.addresses[key] = body.location.address;
      return { ok: true, status: 204, data: {} };
    }
    const base = path.split('?')[0];
    const [idField, listKey] = kinds[base] || [];
    if (!idField) throw new Error(`unexpected ${method} ${path}`);
    if (!state.opted) return { ok: false, status: 403, data: { errors: [{ message: 'not opted in' }] } };
    if (method === 'GET'){
      return { ok: true, status: 200, data: { [listKey]: Object.entries(state.policies).filter(([k]) => k.startsWith(idField + ':')).map(([k, id]) => ({ name: k.split(':')[1], [idField]: id })) } };
    }
    const key = `${idField}:${body.name}`;
    if (state.policies[key]){
      return { ok: false, status: 400, data: { errors: [{ longMessage: 'A policy with this name already exists.', parameters: [{ name: 'DuplicateProfileId', value: state.policies[key] }] }] } };
    }
    state.policies[key] = String(state.nextId++);
    return { ok: true, status: 201, data: { [idField]: state.policies[key] } };
  };
  return { state, request };
}

const ADDRESS = { city: 'Austin', stateOrProvince: 'TX', postalCode: '78701', country: 'US' };

// A fake Firestore with just collection().doc().get()/set(merge).
function fakeDb(initial = {}){
  const docs = new Map(Object.entries(initial));
  const writes = [];
  const db = {
    docs, writes,
    collection: (c) => ({
      doc: (id) => ({
        get: async () => ({ exists: docs.has(`${c}/${id}`), data: () => docs.get(`${c}/${id}`) }),
        set: async (data, opts) => {
          writes.push(`${c}/${id}`);
          docs.set(`${c}/${id}`, opts && opts.merge ? { ...(docs.get(`${c}/${id}`) || {}), ...data } : data);
        },
      }),
    }),
  };
  return db;
}

test('setup on a new account opts in, creates all five values and saves them on the store only', async () => {
  const ebay = fakeEbay({ opted: false });
  const { results, errors, complete } = await setupEbayAccount('tok', ebay.request, { address: ADDRESS });
  assert.equal(complete, true);
  assert.deepEqual(errors, {});
  assert.equal(results.optInCalled, true);
  assert.ok(ebay.state.calls.includes('POST /sell/account/v1/program/opt_in'));
  assert.ok(ebay.state.calls.indexOf('POST /sell/account/v1/program/opt_in') < ebay.state.calls.indexOf('POST /sell/account/v1/payment_policy'));
  const db = fakeDb({ 'ebay_connections/biz1': { refresh_token: 'r', sellerUsername: 'a' }, 'ebay_connections/biz2': { refresh_token: 'r2' } });
  const saved = await saveEbayPolicies('biz1', results, { db });
  assert.equal(saved.ok, true);
  assert.deepEqual(db.writes, ['ebay_connections/biz1']);
  const doc = db.docs.get('ebay_connections/biz1');
  assert.equal(doc.refresh_token, 'r');
  assert.deepEqual(Object.keys(doc.policies).sort(), ['fulfillmentPolicyId', 'fulfillmentPolicyIdBuyerPays', 'merchantLocationKey', 'paymentPolicyId', 'returnPolicyId']);
  assert.equal(doc.policies.merchantLocationKey, 'cc_main_location');
  assert.equal(doc.policies.optedIn, undefined);
  assert.equal(db.docs.get('ebay_connections/biz2').policies, undefined);
  const read = await getEbayPolicies({ bizId: 'biz1' }, db);
  assert.deepEqual(read.policies, doc.policies);
  assert.equal((await getEbayPolicies({ bizId: 'biz2' }, db)).policies, null);
});

test('an account already in the program is not opted in again', async () => {
  const ebay = fakeEbay({ opted: true });
  const { results, complete } = await setupEbayAccount('tok', ebay.request, { address: ADDRESS });
  assert.equal(complete, true);
  assert.equal(results.optedIn, true);
  assert.equal(results.optInCalled, undefined);
  assert.ok(!ebay.state.calls.includes('POST /sell/account/v1/program/opt_in'));
});

test('when the program list cannot be read, opt-in is still tried', async () => {
  const ebay = fakeEbay({ opted: false, listFails: true });
  const { complete } = await setupEbayAccount('tok', ebay.request, { address: ADDRESS });
  assert.ok(ebay.state.calls.includes('POST /sell/account/v1/program/opt_in'));
  assert.equal(complete, true);
});

test('a second run finds the same policies and location instead of creating new ones', async () => {
  const ebay = fakeEbay({ opted: false });
  const first = await setupEbayAccount('tok', ebay.request, { address: ADDRESS });
  const second = await setupEbayAccount('tok', ebay.request, { address: ADDRESS });
  assert.equal(second.complete, true);
  for (const f of ['fulfillmentPolicyId', 'fulfillmentPolicyIdBuyerPays', 'paymentPolicyId', 'returnPolicyId', 'merchantLocationKey']){
    assert.equal(second.results[f], first.results[f]);
  }
  assert.equal(Object.keys(ebay.state.policies).length, 4);
});

test('an incomplete setup reports the error and nothing is saved', async () => {
  const ebay = fakeEbay({ opted: true });
  const base = ebay.request;
  const request = (m, p, t, b) => p.endsWith('/return_policy') ? Promise.resolve({ ok: false, status: 400, data: { errors: [{ message: 'nope' }] } }) : base(m, p, t, b);
  const { complete, errors } = await setupEbayAccount('tok', request, { address: ADDRESS });
  assert.equal(complete, false);
  assert.ok(errors.return);
  const db = fakeDb({ 'ebay_connections/biz1': { refresh_token: 'r' } });
  const saved = await saveEbayPolicies('biz1', { fulfillmentPolicyId: '1', paymentPolicyId: '2' }, { db });
  assert.equal(saved.ok, false);
  assert.deepEqual(db.writes, []);
});

const ENV = {
  EBAY_FULFILLMENT_POLICY_ID: 'F1', EBAY_FULFILLMENT_POLICY_ID_BUYER_PAYS: 'F2',
  EBAY_PAYMENT_POLICY_ID: 'P1', EBAY_RETURN_POLICY_ID: 'R1', EBAY_MERCHANT_LOCATION_KEY: 'loc1',
};

test('the env copy writes the five values on the named store only', async () => {
  const db = fakeDb({
    'ebay_connections/vitorBiz': { refresh_token: 'rv', sellerUsername: 'v' },
    'ebay_connections/other': { refresh_token: 'ro' },
  });
  const r = await copyEnvPolicies(db, { uid: 'admin1' }, { bizId: 'vitorBiz' }, ENV);
  assert.equal(r.ok, true);
  assert.deepEqual(db.writes, ['ebay_connections/vitorBiz']);
  const doc = db.docs.get('ebay_connections/vitorBiz');
  assert.equal(doc.refresh_token, 'rv');
  assert.deepEqual(doc.policies, {
    fulfillmentPolicyId: 'F1', fulfillmentPolicyIdBuyerPays: 'F2', paymentPolicyId: 'P1', returnPolicyId: 'R1', merchantLocationKey: 'loc1',
  });
  assert.equal(doc.policiesSource, 'env');
  assert.equal(db.docs.get('ebay_connections/other').policies, undefined);
});

test('the env copy refuses a missing store id, a store with no connection and missing env values', async () => {
  const db = fakeDb({ 'ebay_connections/vitorBiz': { refresh_token: 'rv' } });
  assert.equal((await copyEnvPolicies(db, { uid: 'a' }, {}, ENV)).status, 400);
  assert.equal((await copyEnvPolicies(db, { uid: 'a' }, { bizId: '../x/y' }, ENV)).status, 400);
  assert.equal((await copyEnvPolicies(db, { uid: 'a' }, { bizId: 'ghost' }, ENV)).status, 404);
  const partial = { ...ENV, EBAY_RETURN_POLICY_ID: '' };
  const r = await copyEnvPolicies(db, { uid: 'a' }, { bizId: 'vitorBiz' }, partial);
  assert.equal(r.status, 400);
  assert.match(r.error, /EBAY_RETURN_POLICY_ID/);
  assert.deepEqual(db.writes, []);
});

test('cleanPolicies needs all five non-empty strings', () => {
  assert.equal(cleanPolicies(null), null);
  assert.equal(cleanPolicies({ fulfillmentPolicyId: 'a' }), null);
  assert.deepEqual(cleanPolicies({ fulfillmentPolicyId: ' a ', fulfillmentPolicyIdBuyerPays: 'b', paymentPolicyId: 'c', returnPolicyId: 'd', merchantLocationKey: 'e', extra: 1 }),
    { fulfillmentPolicyId: 'a', fulfillmentPolicyIdBuyerPays: 'b', paymentPolicyId: 'c', returnPolicyId: 'd', merchantLocationKey: 'e' });
});

// ---------- ship-from address (v3.28.19) ----------

test('a new location is created with the seller address, no street and no sample address', async () => {
  const ebay = fakeEbay({ opted: true });
  const { complete } = await setupEbayAccount('tok', ebay.request, { address: ADDRESS });
  assert.equal(complete, true);
  assert.deepEqual(ebay.state.addresses.cc_main_location, ADDRESS);
  assert.equal(ebay.state.calls.some(c => c.includes('update_location_details')), false);
});

test('an existing location (the old sample address) gets the new address', async () => {
  const ebay = fakeEbay({ opted: true });
  ebay.state.locations.add('cc_main_location');
  ebay.state.addresses.cc_main_location = { addressLine1: '123 Main St', city: 'Orlando', stateOrProvince: 'FL', postalCode: '32801', country: 'US' };
  const { complete, results } = await setupEbayAccount('tok', ebay.request, { address: ADDRESS });
  assert.equal(complete, true);
  assert.equal(results.merchantLocationKey, 'cc_main_location');
  assert.ok(ebay.state.calls.includes('POST /sell/inventory/v1/location/cc_main_location/update_location_details'));
  assert.deepEqual(ebay.state.addresses.cc_main_location, ADDRESS);
});

test('without an address the location is not touched and the setup is incomplete', async () => {
  const ebay = fakeEbay({ opted: true });
  const { complete, errors } = await setupEbayAccount('tok', ebay.request);
  assert.equal(complete, false);
  assert.ok(errors.location);
  assert.equal(ebay.state.calls.some(c => c.includes('/location/')), false);
});

test('a refused address update leaves the setup incomplete', async () => {
  const ebay = fakeEbay({ opted: true });
  ebay.state.locations.add('cc_main_location');
  const base = ebay.request;
  const request = (m, p, t, b) => p.endsWith('/update_location_details') ? Promise.resolve({ ok: false, status: 400, data: { errors: [{ message: 'bad' }] } }) : base(m, p, t, b);
  const { complete, errors } = await setupEbayAccount('tok', request, { address: ADDRESS });
  assert.equal(complete, false);
  assert.ok(errors.location);
});
