// api/_business.js businessCreate (P0 PR4b): the Terms acceptance, against a
// small in-memory stand-in for Firebase Admin's Firestore.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { businessCreate } from '../../api/_business.js';
import { TERMS_VERSION } from '../../src/domain/new-business.js';

// Paths are 'col/doc/col/doc'. Only what businessCreate uses.
function fakeAdmin(seed){
  const store = new Map(Object.entries(seed));
  let next = 0;
  const ref = (path) => ({
    path,
    id: path.split('/').pop(),
    collection: (name) => col(`${path}/${name}`),
    get: async () => snap(path),
  });
  const col = (path) => ({ doc: (id) => ref(`${path}/${id || `auto${++next}`}`) });
  const snap = (path) => ({ exists: store.has(path), data: () => store.get(path) });
  const db = {
    collection: col,
    runTransaction: async (fn) => {
      const writes = [];
      const tx = {
        get: async (r) => snap(r.path),
        set: (r, data, opts) => writes.push([r.path, data, opts]),
      };
      const out = await fn(tx);
      for (const [path, data, opts] of writes){
        store.set(path, opts && opts.merge ? { ...(store.get(path) || {}), ...data } : data);
      }
      return out;
    },
  };
  return { admin: { db }, store };
}

const seed = () => ({
  'platform/signup': { selfServe: true },
  'users/u1': { status: 'pending', email: 'a@b.co' },
});
const caller = { uid: 'u1', email: 'a@b.co', emailVerified: true };

test('without the Terms accepted: 400 and nothing written', async () => {
  for (const body of [
    { name: 'Second Spin' },
    { name: 'Second Spin', acceptTerms: false, termsVersion: TERMS_VERSION },
    { name: 'Second Spin', acceptTerms: 'yes', termsVersion: TERMS_VERSION },
    { name: 'Second Spin', acceptTerms: true, termsVersion: '2001-01-01' },
  ]){
    const { admin, store } = fakeAdmin(seed());
    const before = JSON.stringify([...store]);
    const r = await businessCreate(admin, caller, body);
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
    assert.match(r.error, /Terms/);
    assert.equal(JSON.stringify([...store]), before);
  }
});

test('with the Terms accepted: termsVersion and termsAcceptedAt on the store and the user', async () => {
  const { admin, store } = fakeAdmin(seed());
  const t0 = Date.now();
  const r = await businessCreate(admin, caller, { name: 'Second Spin', sellsOn: ['ebay'], acceptTerms: true, termsVersion: TERMS_VERSION });
  assert.equal(r.ok, true);
  assert.equal(r.existing, false);
  const biz = store.get(`businesses/${r.bizId}`);
  const user = store.get('users/u1');
  for (const doc of [biz, user]){
    assert.equal(doc.termsVersion, TERMS_VERSION);
    assert.ok(doc.termsAcceptedAt >= t0 && doc.termsAcceptedAt <= Date.now());
  }
  assert.equal(biz.termsAcceptedAt, user.termsAcceptedAt);
  assert.equal(user.activeBizId, r.bizId);
  assert.equal(user.status, 'approved');
  assert.equal(user.email, 'a@b.co');
  assert.equal(store.get(`businesses/${r.bizId}/members/u1`).role, 'owner');
  // The settings doc carries no acceptance.
  assert.equal(store.get(`businesses/${r.bizId}/config/settings`).termsVersion, undefined);
});
