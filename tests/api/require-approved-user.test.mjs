// requireApprovedUser (v3.28.8): the business and the role come from
// businesses/{bizId}/members/{uid}, never from the users doc alone.
// Both paths: Firebase Admin (a fake one here) and the Firestore REST
// fallback (a mocked fetch).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { checkWithAdmin, checkWithRest } from '../../api/_requireApprovedUser.js';

// A tiny Firestore stand-in: docs by path ('users/u1', 'businesses/b1/members/u1').
function fakeAdmin(docs, decoded){
  const ref = (path) => ({
    get: async () => ({ exists: path in docs, data: () => docs[path] }),
    collection: (name) => col(`${path}/${name}`),
  });
  const col = (path) => ({ doc: (id) => ref(`${path}/${id}`) });
  return {
    auth: { verifyIdToken: async () => decoded },
    db: { collection: (name) => col(name) },
  };
}

const TOKEN_USER = { uid: 'u1', email: 'a@b.com', email_verified: true };

test('admin: a member gets the business and the role of the members doc', async () => {
  const admin = fakeAdmin({
    'users/u1': { status: 'approved', activeBizId: 'b1', role: 'owner' },
    'businesses/b1': { live: true },
    'businesses/b1/members/u1': { role: 'employee' },
  }, TOKEN_USER);
  const r = await checkWithAdmin(admin, 'tok');
  assert.deepEqual(r, { ok: true, uid: 'u1', email: 'a@b.com', role: 'employee', bizId: 'b1', via: 'admin' });
});

test('admin: an owner member stays owner when the users doc has no role', async () => {
  const admin = fakeAdmin({
    'users/u1': { status: 'approved', activeBizId: 'b1' },
    'businesses/b1': { live: true },
    'businesses/b1/members/u1': { role: 'owner' },
  }, TOKEN_USER);
  const r = await checkWithAdmin(admin, 'tok');
  assert.equal(r.role, 'owner');
  assert.equal(r.bizId, 'b1');
});

test('admin: the users doc can lower the role to employee, never raise it', async () => {
  const lowered = await checkWithAdmin(fakeAdmin({
    'users/u1': { status: 'approved', activeBizId: 'b1', role: 'employee' },
    'businesses/b1': { live: true },
    'businesses/b1/members/u1': { role: 'owner' },
  }, TOKEN_USER), 'tok');
  assert.equal(lowered.role, 'employee');
  const notRaised = await checkWithAdmin(fakeAdmin({
    'users/u1': { status: 'approved', activeBizId: 'b1', role: 'owner' },
    'businesses/b1': { live: true },
    'businesses/b1/members/u1': { role: 'employee' },
  }, TOKEN_USER), 'tok');
  assert.equal(notRaised.role, 'employee');
});

test('admin: an approved account with a forged activeBizId and no members doc gets no business', async () => {
  const admin = fakeAdmin({
    'users/u1': { status: 'approved', activeBizId: 'b1', role: 'owner' },
    'businesses/b1': { live: true },
  }, TOKEN_USER);
  const r = await checkWithAdmin(admin, 'tok');
  assert.equal(r.ok, true);
  assert.equal(r.bizId, null);
  assert.equal(r.role, null);
});

test('admin: a member of a business that is not live yet keeps the role, no bizId', async () => {
  const admin = fakeAdmin({
    'users/u1': { status: 'approved', activeBizId: 'b1' },
    'businesses/b1': { live: false },
    'businesses/b1/members/u1': { role: 'owner' },
  }, TOKEN_USER);
  const r = await checkWithAdmin(admin, 'tok');
  assert.equal(r.bizId, null);
  assert.equal(r.role, 'owner');
});

test('admin: no business at all, an employee users doc still reads as employee', async () => {
  const r = await checkWithAdmin(fakeAdmin({ 'users/u1': { status: 'approved', role: 'employee' } }, TOKEN_USER), 'tok');
  assert.equal(r.bizId, null);
  assert.equal(r.role, 'employee');
});

test('admin: pending, unverified and a bad activeBizId', async () => {
  const pending = await checkWithAdmin(fakeAdmin({ 'users/u1': { status: 'pending' } }, TOKEN_USER), 'tok');
  assert.equal(pending.status, 403);
  const unverified = await checkWithAdmin(fakeAdmin({ 'users/u1': { status: 'approved' } }, { ...TOKEN_USER, email_verified: false }), 'tok');
  assert.equal(unverified.status, 403);
  const slash = await checkWithAdmin(fakeAdmin({ 'users/u1': { status: 'approved', activeBizId: 'b1/members/x' } }, TOKEN_USER), 'tok');
  assert.equal(slash.bizId, null);
});

// REST: the token's payload is read locally; Firestore answers by URL.
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function restToken(payload){
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'RS256' })}.${b64(payload)}.sig`;
}
function mockFirestore(docs){
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(url);
    const path = decodeURIComponent(String(url).split('/documents/')[1] || '');
    if (!(path in docs)) return { ok: false, status: 403, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ fields: docs[path] }) };
  };
  return urls;
}
const s = (v) => ({ stringValue: v });
const REST_TOKEN = restToken({ user_id: 'u1', email: 'a@b.com', email_verified: true });

test('rest: a member gets the business and the role of the members doc', async () => {
  mockFirestore({
    'users/u1': { status: s('approved'), activeBizId: s('b1'), role: s('owner') },
    'businesses/b1': { live: { booleanValue: true } },
    'businesses/b1/members/u1': { role: s('employee') },
  });
  const r = await checkWithRest(REST_TOKEN);
  assert.deepEqual(r, { ok: true, uid: 'u1', email: 'a@b.com', role: 'employee', bizId: 'b1', via: 'rest' });
});

test('rest: a forged activeBizId with no members doc gets no business and no role', async () => {
  const urls = mockFirestore({
    'users/u1': { status: s('approved'), activeBizId: s('b1'), role: s('owner') },
    'businesses/b1': { live: { booleanValue: true } },
  });
  const r = await checkWithRest(REST_TOKEN);
  assert.equal(r.ok, true);
  assert.equal(r.bizId, null);
  assert.equal(r.role, null);
  assert.ok(urls.some(u => u.endsWith('/businesses/b1/members/u1')));
});

test('rest: the users doc lowers the role to employee; a failed members read is no membership', async () => {
  mockFirestore({
    'users/u1': { status: s('approved'), activeBizId: s('b1'), role: s('employee') },
    'businesses/b1': { live: { booleanValue: true } },
    'businesses/b1/members/u1': { role: s('owner') },
  });
  assert.equal((await checkWithRest(REST_TOKEN)).role, 'employee');
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/users/u1')) return { ok: true, json: async () => ({ fields: { status: s('approved'), activeBizId: s('b1') } }) };
    throw new Error('network');
  };
  const r = await checkWithRest(REST_TOKEN);
  assert.equal(r.ok, true);
  assert.equal(r.bizId, null);
  assert.equal(r.role, null);
});
