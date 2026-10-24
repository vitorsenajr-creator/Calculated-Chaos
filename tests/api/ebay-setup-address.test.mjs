// v3.28.19: the ship-from address through the real /api/ebay-setup handler,
// on a fake Firebase Admin (setFirebaseAdminForTests) and a fake eBay.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

const { setFirebaseAdminForTests } = await import('../../api/_firebaseAdmin.js');
const { EBAY_SETUP_NEEDED } = await import('../../api/_ebayPolicies.js');
const ebaySetup = (await import('../../api/ebay-setup.js')).default;

const POLICIES = {
  fulfillmentPolicyId: 'F', fulfillmentPolicyIdBuyerPays: 'FB', paymentPolicyId: 'P', returnPolicyId: 'R',
  merchantLocationKey: 'vitor_loc',
};
const GOOD = { city: 'Austin', stateOrProvince: 'TX', postalCode: '78701' };

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
function storeDocs({ policies = POLICIES, role = 'owner' } = {}){
  return {
    'users/u1': { status: 'approved', activeBizId: 'b1' },
    'businesses/b1': { live: true },
    'businesses/b1/members/u1': { role },
    'ebay_connections/b1': {
      refresh_token: 'r', access_token: 'tok', connected_at: Date.now(), expires_in: 7200,
      ...(policies ? { policies } : {}),
    },
  };
}

// The fake eBay: one existing location per key, with its address.
let calls, locations, failUpdate;
function reply(status, data){
  const text = data === undefined ? '' : JSON.stringify(data);
  return { ok: status < 300, status, text: async () => text, json: async () => JSON.parse(text || 'null') };
}
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  const body = opts.body ? JSON.parse(opts.body) : undefined;
  calls.push({ method, url: u, body });
  const m = u.match(/\/sell\/inventory\/v1\/location\/([^/?]+)(\/update_location_details)?$/);
  if (m){
    const key = decodeURIComponent(m[1]);
    if (m[2]){
      if (failUpdate) return reply(400, { errors: [{ message: 'nope' }] });
      locations[key] = { ...body.location.address };
      return reply(204);
    }
    if (method === 'GET') return key in locations ? reply(200, { merchantLocationKey: key, location: { address: locations[key] } }) : reply(404, {});
  }
  throw new Error(`Unexpected request in the test: ${method} ${u}`);
};

function call(body){
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(c){ this.statusCode = c; return this; },
      json(data){ resolve({ status: this.statusCode, data }); return this; },
      setHeader(){ return this; },
    };
    Promise.resolve(ebaySetup({ method: 'POST', url: '/api/ebay-setup', headers: { authorization: 'Bearer tok' }, body }, res)).catch(reject);
  });
}

beforeEach(() => {
  calls = [];
  failUpdate = false;
  locations = { vitor_loc: { addressLine1: '123 Main St', city: 'Orlando', stateOrProvince: 'FL', postalCode: '32801', country: 'US' } };
  docs = storeDocs();
  setFirebaseAdminForTests(fakeAdmin());
});
after(() => setFirebaseAdminForTests(null));

test('location: the address eBay holds for the store location, the sample one flagged, no street', async () => {
  const r = await call({ action: 'location' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { success: true, setUp: true, address: { city: 'Orlando', stateOrProvince: 'FL', postalCode: '32801' }, line: 'Orlando, FL 32801', placeholder: true });
  assert.equal(JSON.stringify(r.data).includes('Main St'), false);
  assert.deepEqual(calls.map(c => c.method + ' ' + c.url.replace(/^https:\/\/[^/]+/, '')), ['GET /sell/inventory/v1/location/vitor_loc']);
});

test('location: a store without setup is told so, with no eBay request', async () => {
  docs = storeDocs({ policies: null });
  const r = await call({ action: 'location' });
  assert.deepEqual(r.data, { success: true, setUp: false, address: null, line: '', placeholder: false });
  assert.equal(calls.length, 0);
});

test('location_update: the store location gets the new address and is read back', async () => {
  const r = await call({ action: 'location_update', address: { city: ' austin', stateOrProvince: 'tx', postalCode: '78701' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.line, 'Austin, TX 78701');
  assert.equal(r.data.placeholder, false);
  const upd = calls.find(c => c.url.endsWith('/vitor_loc/update_location_details'));
  assert.deepEqual(upd.body, { location: { address: { city: 'Austin', stateOrProvince: 'TX', postalCode: '78701', country: 'US' } } });
  assert.deepEqual(locations.vitor_loc, { city: 'Austin', stateOrProvince: 'TX', postalCode: '78701', country: 'US' });
});

test('location_update: a bad address answers 400 with the field messages, before any eBay request', async () => {
  const r = await call({ action: 'location_update', address: { city: 'Austin', stateOrProvince: 'ZZ', postalCode: '7870' } });
  assert.equal(r.status, 400);
  assert.deepEqual(Object.keys(r.data.fieldErrors).sort(), ['postalCode', 'state']);
  assert.equal(calls.length, 0);
});

test('location_update and setup are for the owner: an employee gets 403, no eBay request', async () => {
  docs = storeDocs({ role: 'employee' });
  for (const body of [{ action: 'location_update', address: GOOD }, { address: GOOD }]){
    const r = await call(body);
    assert.equal(r.status, 403);
  }
  const read = await call({ action: 'location' });
  assert.equal(read.status, 200, 'an employee can still read it');
  assert.equal(calls.filter(c => c.method !== 'GET').length, 0);
});

test('location_update before setup: 409 with the setup sentence', async () => {
  docs = storeDocs({ policies: null });
  const r = await call({ action: 'location_update', address: GOOD });
  assert.equal(r.status, 409);
  assert.equal(r.data.error, EBAY_SETUP_NEEDED);
  assert.equal(calls.length, 0);
});

test('location_update refused by eBay: 502 with a plain sentence, the address unchanged', async () => {
  failUpdate = true;
  const r = await call({ action: 'location_update', address: GOOD });
  assert.equal(r.status, 502);
  assert.match(r.data.error, /didn't accept/);
  assert.equal(locations.vitor_loc.city, 'Orlando');
});

test('setup without an address: 400 before any eBay request', async () => {
  const r = await call({});
  assert.equal(r.status, 400);
  assert.ok(r.data.fieldErrors.city);
  assert.equal(calls.length, 0);
});

test('an unknown action is refused', async () => {
  const r = await call({ action: 'delete_location' });
  assert.equal(r.status, 400);
  assert.equal(calls.length, 0);
});
