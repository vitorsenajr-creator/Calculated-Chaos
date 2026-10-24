// Store invitations on the server (api/_invites.js, api/_business.js, v3.28.8)
// against a small fake Firestore.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invitesList, inviteAdd, inviteRemove } from '../../api/_invites.js';
import { signupStatus, businessCreate } from '../../api/_business.js';

// Just enough of Firestore: collection().doc().get/set/delete, collection().get,
// runTransaction with tx.get/tx.set (merge supported), auto ids.
function fakeAdmin(initial = {}){
  const store = new Map(Object.entries(initial));
  let n = 0;
  const snap = (path) => ({ exists: store.has(path), id: path.split('/').pop(), data: () => store.get(path) });
  const put = (path, data, opts) => store.set(path, opts && opts.merge ? { ...(store.get(path) || {}), ...data } : data);
  const ref = (path) => ({
    path, id: path.split('/').pop(),
    get: async () => snap(path),
    set: async (data, opts) => put(path, data, opts),
    delete: async () => { store.delete(path); },
    collection: (name) => col(`${path}/${name}`),
  });
  const col = (path) => ({
    doc: (id) => ref(`${path}/${id || 'auto' + (++n)}`),
    get: async () => {
      const docs = [...store.keys()].filter(k => k.startsWith(path + '/') && !k.slice(path.length + 1).includes('/')).map(snap);
      return { forEach: (fn) => docs.forEach(fn) };
    },
  });
  const db = {
    collection: col,
    runTransaction: async (fn) => {
      const writes = [];
      const tx = {
        get: async (r) => snap(r.path),
        set: (r, data, opts) => writes.push([r.path, data, opts]),
      };
      const out = await fn(tx);
      if (!out || out.ok) writes.forEach(([p, d, o]) => put(p, d, o));
      return out;
    },
  };
  return { admin: { ok: true, db }, store };
}

const pending = { status: 'pending', email: 'maya@example.com' };
const caller = (over = {}) => ({ ok: true, uid: 'u1', email: 'Maya@Example.com', emailVerified: true, ...over });
const body = { name: 'Second Spin', sellsOn: ['ebay'] };

test('an admin adds, lists and removes invitations', async () => {
  const { admin, store } = fakeAdmin();
  const adder = { uid: 'admin1' };
  assert.equal((await inviteAdd(admin.db, adder, { email: 'nope' })).status, 400);
  const a = await inviteAdd(admin.db, adder, { email: ' Maya@Example.com ' });
  assert.equal(a.ok, true);
  assert.equal(a.existing, false);
  assert.equal(store.get('invites/maya@example.com').createdBy, 'admin1');
  assert.equal((await inviteAdd(admin.db, adder, { email: 'maya@example.com' })).existing, true);
  const list = await invitesList(admin.db);
  assert.deepEqual(list.invites.map(i => [i.email, i.state]), [['maya@example.com', 'open']]);
  assert.equal((await inviteRemove(admin.db, adder, { email: 'MAYA@example.com' })).ok, true);
  assert.equal(store.has('invites/maya@example.com'), false);
  assert.equal((await inviteRemove(admin.db, adder, {})).status, 400);
});

test('signup_status: invited sees the store flow, others do not', async () => {
  const { admin } = fakeAdmin({
    'platform/signup': { selfServe: false },
    'users/u1': pending,
    'users/u2': { status: 'pending' },
    'invites/maya@example.com': { email: 'maya@example.com', createdAt: 1 },
  });
  const invited = await signupStatus(admin, caller());
  assert.deepEqual([invited.selfServe, invited.invited, invited.canCreate], [false, true, true]);
  const unverified = await signupStatus(admin, caller({ emailVerified: false }));
  assert.deepEqual([unverified.invited, unverified.canCreate], [true, false]);
  const stranger = await signupStatus(admin, caller({ uid: 'u2', email: 'other@example.com' }));
  assert.deepEqual([stranger.invited, stranger.canCreate], [false, false]);
});

test('business_create: an invited, verified account creates a store and the invite is marked used', async () => {
  const { admin, store } = fakeAdmin({
    'platform/signup': { selfServe: false },
    'users/u1': pending,
    'invites/maya@example.com': { email: 'maya@example.com', createdAt: 1 },
  });
  const r = await businessCreate(admin, caller(), body);
  assert.equal(r.ok, true);
  assert.equal(r.existing, false);
  const invite = store.get('invites/maya@example.com');
  assert.equal(invite.bizId, r.bizId);
  assert.equal(invite.usedBy, 'u1');
  assert.equal(typeof invite.usedAt, 'number');
  assert.equal(invite.createdAt, 1);
  assert.equal(store.get('users/u1').activeBizId, r.bizId);
  assert.equal(store.get(`businesses/${r.bizId}`).ownerUid, 'u1');
  // Asking again returns the same store, no second one.
  const again = await businessCreate(admin, caller(), body);
  assert.deepEqual([again.ok, again.bizId, again.existing], [true, r.bizId, true]);
  assert.equal([...store.keys()].filter(k => /^businesses\/[^/]+$/.test(k)).length, 1);
});

test('business_create: not invited, not verified, or a used invite creates nothing', async () => {
  const base = { 'platform/signup': { selfServe: false }, 'users/u1': pending, 'users/u2': { status: 'pending' } };
  const none = fakeAdmin(base);
  const r1 = await businessCreate(none.admin, caller(), body);
  assert.equal(r1.status, 403);
  const unv = fakeAdmin({ ...base, 'invites/maya@example.com': { email: 'maya@example.com', createdAt: 1 } });
  assert.equal((await businessCreate(unv.admin, caller({ emailVerified: false }), body)).status, 403);
  assert.equal(unv.store.get('invites/maya@example.com').usedAt, undefined);
  // A used invite (an earlier store) does not open a second one for a fresh account with the same email.
  const used = fakeAdmin({ ...base, 'invites/maya@example.com': { email: 'maya@example.com', createdAt: 1, usedAt: 2, bizId: 'old', usedBy: 'u9' } });
  const r3 = await businessCreate(used.admin, caller(), body);
  assert.equal(r3.status, 403);
  for (const s of [none.store, unv.store, used.store]){
    assert.equal([...s.keys()].filter(k => k.startsWith('businesses/')).length, 0);
    assert.equal(s.get('users/u1').activeBizId, undefined);
  }
});

test('business_create with the switch on still works and uses no invite', async () => {
  const { admin, store } = fakeAdmin({ 'platform/signup': { selfServe: true }, 'users/u1': pending });
  const r = await businessCreate(admin, caller(), body);
  assert.equal(r.ok, true);
  assert.equal(store.has('invites/maya@example.com'), false);
  const off = fakeAdmin({ 'users/u1': pending });
  assert.equal((await businessCreate(off.admin, caller(), body)).status, 403);
});
