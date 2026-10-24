// v3.28.9: no fallback to the shared 'main' eBay connection, no AI for an
// account without a store, Sync members leaves accounts with a store alone,
// and the admin-only retire of ebay_connections/main.
//
// The handlers run for real. Without FIREBASE_SERVICE_ACCOUNT the sign-in
// check takes its REST fallback, so a stubbed fetch plays Firestore; any
// other request (eBay, Anthropic) fails the test.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

delete process.env.FIREBASE_SERVICE_ACCOUNT;
process.env.ANTHROPIC_API_KEY = 'test-key';

const { NO_STORE_ERROR } = await import('../../api/_requireApprovedUser.js');
const { ebayConnectionId, getEbayAccessToken, getEbayConnectionStatus, createOAuthState } = await import('../../api/_ebayToken.js');
const { requireAiAllowance } = await import('../../api/_aiAllowance.js');
const { migrationCopy, migrationStatus, retireMainConnection } = await import('../../api/_migration.js');
const handlers = {
  ebayList: (await import('../../api/ebay-list.js')).default,
  ebayCheckSales: (await import('../../api/ebay-check-sales.js')).default,
  ebayEndListing: (await import('../../api/ebay-end-listing.js')).default,
  ebayCategorySearch: (await import('../../api/ebay-category-search.js')).default,
  ebaySetup: (await import('../../api/ebay-setup.js')).default,
  ebayListingTools: (await import('../../api/ebay-listing-tools.js')).default,
  ebayItemAspects: (await import('../../api/ebay-item-aspects.js')).default,
  ebayAuth: (await import('../../api/ebay-auth.js')).default,
  analyzePhoto: (await import('../../api/analyze-photo.js')).default,
  narration: (await import('../../api/narration.js')).default,
  platform: (await import('../../api/platform.js')).default,
};

const ADMIN_UID = 'TpE1hmofirMzGSPE6C8arBl9eGi2';

// ---------- the REST fallback's Firestore, through fetch ----------
let users = {};
let businesses = {};
let members = {};
let outside = [];
const str = (v) => ({ stringValue: v });
globalThis.fetch = async (url) => {
  const u = String(url);
  // businesses/{bizId}/members/{uid} (v3.28.8): the account's link to a store.
  const mm = u.match(/\/documents\/businesses\/([^/?]+)\/members\/([^/?]+)$/);
  if (mm){
    const doc = members[`${decodeURIComponent(mm[1])}/${decodeURIComponent(mm[2])}`];
    if (!doc) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ fields: { role: str(doc.role) } }) };
  }
  const m = u.match(/\/documents\/(users|businesses)\/([^/?]+)$/);
  if (m){
    const id = decodeURIComponent(m[2]);
    const doc = (m[1] === 'users' ? users : businesses)[id];
    if (!doc) return { ok: false, status: 404, json: async () => ({}) };
    const fields = {};
    for (const [k, v] of Object.entries(doc)) fields[k] = typeof v === 'boolean' ? { booleanValue: v } : str(v);
    return { ok: true, status: 200, json: async () => ({ fields }) };
  }
  outside.push(u);
  throw new Error(`Unexpected request in the test: ${u}`);
};

function token(uid){
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none' })}.${b64({ user_id: uid, email: `${uid}@example.com`, email_verified: true })}.sig`;
}
function call(handler, { uid, body = {}, url = '/api/x' }){
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(c){ this.statusCode = c; return this; },
      json(data){ resolve({ status: this.statusCode, data }); return this; },
      send(data){ resolve({ status: this.statusCode, data }); return this; },
      setHeader(){ return this; },
    };
    const req = { method: 'POST', url, headers: { authorization: `Bearer ${token(uid)}` }, body };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

beforeEach(() => {
  users = {
    nostore: { status: 'approved', role: 'owner' },
    notlive: { status: 'approved', role: 'owner', activeBizId: 'bizOff' },
    member: { status: 'approved', role: 'owner', activeBizId: 'bizA' },
    [ADMIN_UID]: { status: 'approved', role: 'owner', activeBizId: 'bizA' },
  };
  businesses = { bizA: { live: true }, bizOff: { live: false } };
  members = { 'bizOff/notlive': { role: 'owner' }, 'bizA/member': { role: 'owner' }, [`bizA/${ADMIN_UID}`]: { role: 'owner' } };
  outside = [];
});

test('ebayConnectionId: the store id, or a 403 error without one', async () => {
  assert.equal(ebayConnectionId({ bizId: 'bizA' }), 'bizA');
  for (const auth of [null, {}, { bizId: null }, { bizId: '' }]){
    assert.throws(() => ebayConnectionId(auth), (e) => e.status === 403 && e.message === NO_STORE_ERROR);
  }
  // The connection helpers no longer default to 'main'.
  for (const r of [await getEbayAccessToken(), await getEbayConnectionStatus(), await createOAuthState({ uid: 'x' })]){
    assert.deepEqual(r, { ok: false, status: 403, error: NO_STORE_ERROR });
  }
});

const EBAY_CALLS = [
  ['ebay-list', 'ebayList', { item: { listPrice: 10 } }],
  ['ebay-check-sales', 'ebayCheckSales', {}],
  ['ebay-end-listing', 'ebayEndListing', { offer_id: '1' }],
  ['ebay-category-search', 'ebayCategorySearch', { query: 'dress' }],
  ['ebay-setup', 'ebaySetup', {}],
  ['ebay-listing-tools', 'ebayListingTools', { action: 'audit_list_skus' }],
  ['ebay-item-aspects', 'ebayItemAspects', { category_id: '63861' }],
];

test('every eBay endpoint answers 403 for an account without a live store', async () => {
  for (const uid of ['nostore', 'notlive']){
    for (const [name, key, body] of EBAY_CALLS){
      const r = await call(handlers[key], { uid, body });
      assert.equal(r.status, 403, `${name} for ${uid}`);
      assert.equal(r.data.error, NO_STORE_ERROR, `${name} for ${uid}`);
    }
    for (const action of ['status', 'disconnect', 'url', 'username']){
      const r = await call(handlers.ebayAuth, { uid, url: `/api/ebay-auth?action=${action}` });
      assert.equal(r.status, 403, `ebay-auth ${action} for ${uid}`);
      assert.equal(r.data.error, NO_STORE_ERROR);
    }
  }
  assert.deepEqual(outside, [], 'no eBay request was made');
});

test('a store member gets past the store check (to its own connection)', async () => {
  // No Firebase Admin in the test, so reading the connection is a 503, not
  // the store refusal.
  const r = await call(handlers.ebayCheckSales, { uid: 'member' });
  assert.equal(r.status, 503);
  assert.notEqual(r.data.error, NO_STORE_ERROR);
  const s = await call(handlers.ebayAuth, { uid: 'member', url: '/api/ebay-auth?action=status' });
  assert.equal(s.status, 503);
});

test('AI calls answer 403 without a store, before any Anthropic call', async () => {
  const sent = [];
  const res = { status(c){ sent.push(c); return this; }, json(d){ sent.push(d); return this; } };
  assert.equal(await requireAiAllowance({ uid: 'x', bizId: null }, res), false);
  assert.deepEqual(sent, [403, { error: NO_STORE_ERROR }]);

  const aiCalls = [
    ['analyze-photo', handlers.analyzePhoto, { mode: 'listing_only', input: { name: 'Dress' } }],
    ['narration extract', handlers.narration, { action: 'extract', kind: 'item', transcript: 'a blue dress' }],
    ['suggest_fee', handlers.ebayItemAspects, { mode: 'suggest_fee', platform: 'Poshmark' }],
    ['explain_error', handlers.ebayItemAspects, { mode: 'explain_error', error: {} }],
  ];
  for (const uid of ['nostore', 'notlive']){
    for (const [name, handler, body] of aiCalls){
      const r = await call(handler, { uid, body });
      assert.equal(r.status, 403, `${name} for ${uid}`);
      assert.equal(r.data.error, NO_STORE_ERROR, `${name} for ${uid}`);
    }
  }
  assert.deepEqual(outside, [], 'no Anthropic request was made');
});

// ---------- an in-memory Firestore for _migration.js ----------
function fakeDb(initial){
  const docs = new Map(Object.entries(initial).map(([k, v]) => [k, structuredClone(v)]));
  const snap = (path) => ({ id: path.split('/').pop(), exists: docs.has(path), data: () => structuredClone(docs.get(path)), ref: ref(path) });
  const ref = (path) => ({
    id: path.split('/').pop(),
    path,
    get: async () => snap(path),
    set: async (data, opts) => write(path, data, opts),
    delete: async () => { docs.delete(path); },
    collection: (name) => col(`${path}/${name}`),
  });
  const write = (path, data, opts) => {
    docs.set(path, opts && opts.merge ? { ...(docs.get(path) || {}), ...structuredClone(data) } : structuredClone(data));
  };
  let auto = 0;
  const col = (path) => ({
    doc: (id) => ref(`${path}/${id || `auto${++auto}`}`),
    get: async () => {
      const depth = path.split('/').length + 1;
      const list = [...docs.keys()].filter(k => k.startsWith(`${path}/`) && k.split('/').length === depth).sort();
      return { docs: list.map(snap), size: list.length, empty: !list.length };
    },
    count: () => ({ get: async () => ({ data: () => ({ count: [...docs.keys()].filter(k => k.startsWith(`${path}/`) && k.split('/').length === path.split('/').length + 1).length }) }) }),
  });
  const db = {
    docs,
    collection: (name) => col(name),
    batch(){
      const ops = [];
      return {
        set: (r, data, opts) => ops.push(() => write(r.path, data, opts)),
        delete: (r) => ops.push(() => docs.delete(r.path)),
        commit: async () => ops.forEach(op => op()),
      };
    },
    async runTransaction(fn){
      const ops = [];
      const out = await fn({
        get: (r) => r.get(),
        set: (r, data, opts) => ops.push(() => write(r.path, data, opts)),
        update: (r, data) => ops.push(() => write(r.path, data, { merge: true })),
        delete: (r) => ops.push(() => docs.delete(r.path)),
      });
      ops.forEach(op => op());
      return out;
    },
  };
  return db;
}

test('Sync members skips accounts that already have a store', async () => {
  const db = fakeDb({
    'platform/migration': { bizId: 'bizA', switchedAt: 1, lastCopiedAt: 1 },
    'businesses/bizA': { name: 'Calculated Chaos', live: true },
    'businesses/bizA/members/old': { role: 'owner', email: 'old@x.com' },
    'users/old': { status: 'approved', role: 'owner', activeBizId: 'bizA', email: 'old@x.com' },
    'users/ownStore': { status: 'approved', role: 'owner', activeBizId: 'bizNew', email: 'own@x.com' },
    'users/fresh': { status: 'approved', role: 'employee', email: 'fresh@x.com' },
    'users/pending': { status: 'pending', email: 'p@x.com' },
  });
  const before = structuredClone(Object.fromEntries(db.docs));
  const r = await migrationCopy(db, { uid: ADMIN_UID, email: 'admin@x.com' }, { step: 0 });
  assert.equal(r.ok, true);
  assert.equal(r.step, 'setup');
  assert.equal(r.copied, 1);
  assert.equal(r.skipped, 2);
  assert.equal(r.next, null, 'after the switch only the members step runs');
  // The new account joins this business…
  assert.equal(db.docs.get('users/fresh').activeBizId, 'bizA');
  assert.equal(db.docs.get('businesses/bizA/members/fresh').role, 'employee');
  // …and nothing about the others changed.
  for (const path of ['users/old', 'users/ownStore', 'users/pending', 'businesses/bizA/members/old']){
    assert.deepEqual(db.docs.get(path), before[path], path);
  }
  assert.equal(db.docs.has('businesses/bizA/members/ownStore'), false);
  assert.equal(db.docs.has('businesses/bizA/members/pending'), false);

  // The status counts only this business's accounts and those without a store.
  const s = await migrationStatus(db);
  assert.deepEqual(s.members, { source: 2, target: 2 });
});

test('retireMainConnection moves ebay_connections/main aside in one go', async () => {
  const conn = { refresh_token: 'r', access_token: 'a', sellerUsername: 'shop' };
  const db = fakeDb({
    'platform/migration': { bizId: 'bizA', switchedAt: 1 },
    'ebay_connections/main': conn,
    'ebay_connections/bizA': { refresh_token: 'store' },
  });
  const now = new Date('2026-10-24T15:00:00Z');
  const r = await retireMainConnection(db, { uid: ADMIN_UID, email: 'admin@x.com' }, { now });
  assert.deepEqual(r, { ok: true, retiredTo: '_retired_main_2026-10-24' });
  assert.equal(db.docs.has('ebay_connections/main'), false);
  assert.deepEqual(db.docs.get('ebay_connections/_retired_main_2026-10-24'), { ...conn, retiredFrom: 'main', retiredAt: now.getTime(), retiredBy: 'admin@x.com' });
  assert.deepEqual(db.docs.get('ebay_connections/bizA'), { refresh_token: 'store' }, "the store's connection is untouched");
  assert.equal(db.docs.get('platform/migration').mainRetiredTo, '_retired_main_2026-10-24');

  // Nothing left to retire.
  const again = await retireMainConnection(db, { uid: ADMIN_UID }, { now });
  assert.equal(again.ok, false);
  assert.equal(again.status, 409);

  // A second 'main' on the same day doesn't overwrite the first copy.
  db.docs.set('ebay_connections/main', { refresh_token: 'second' });
  const third = await retireMainConnection(db, { uid: ADMIN_UID }, { now });
  assert.equal(third.retiredTo, '_retired_main_2026-10-24_2');
  assert.equal(db.docs.get('ebay_connections/_retired_main_2026-10-24').refresh_token, 'r');
});

test('retireMainConnection is refused while the store has no connection of its own', async () => {
  const conn = { refresh_token: 'r' };
  const db = fakeDb({
    'platform/migration': { bizId: 'bizA', switchedAt: 1 },
    'ebay_connections/main': conn,
  });
  const r = await retireMainConnection(db, { uid: ADMIN_UID }, { now: new Date('2026-10-24T15:00:00Z') });
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.match(r.error, /no eBay connection of its own/);
  assert.deepEqual(db.docs.get('ebay_connections/main'), conn, "'main' stays where it is");
  assert.equal(db.docs.has('ebay_connections/_retired_main_2026-10-24'), false);
  assert.equal(db.docs.get('platform/migration').mainRetiredAt, undefined);

  // A store doc without a refresh token doesn't count either.
  db.docs.set('ebay_connections/bizA', { sellerUsername: 'shop' });
  const r2 = await retireMainConnection(db, { uid: ADMIN_UID }, { now: new Date('2026-10-24T15:00:00Z') });
  assert.equal(r2.ok, false);
  assert.deepEqual(db.docs.get('ebay_connections/main'), conn);
});

test('ebay_retire_main is for platform admins only', async () => {
  const refused = await call(handlers.platform, { uid: 'member', body: { action: 'ebay_retire_main' } });
  assert.equal(refused.status, 403);
  assert.equal(refused.data.error, 'Platform admins only.');
  // An admin gets past the check; without Firebase Admin in the test it stops at 503.
  const admin = await call(handlers.platform, { uid: ADMIN_UID, body: { action: 'ebay_retire_main' } });
  assert.equal(admin.status, 503);
});
