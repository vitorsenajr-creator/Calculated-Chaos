// "Create your store" (src/domain/new-business.js, v3.28.0).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateStoreName, normalizeStoreName, normalizeSellsOn, cleanLogo,
  buildNewBusinessDocs, signupNextStep, checkTermsAcceptance, STORE_NAME_MAX, MAX_LOGO_CHARS, NEW_BUSINESS_AI_LIMIT,
  TERMS_VERSION, TERMS_REQUIRED_ERROR, TERMS_STALE_ERROR,
} from '../../src/domain/new-business.js';

test('store names are trimmed, folded and bounded', () => {
  assert.equal(normalizeStoreName('  Second   Spin\tVintage \n'), 'Second Spin Vintage');
  assert.deepEqual(validateStoreName(' Second Spin '), { ok: true, name: 'Second Spin' });
  assert.equal(validateStoreName('').ok, false);
  assert.equal(validateStoreName('   ').ok, false);
  assert.equal(validateStoreName(null).ok, false);
  assert.equal(validateStoreName('A').ok, false);
  assert.equal(validateStoreName('x'.repeat(STORE_NAME_MAX)).ok, true);
  assert.equal(validateStoreName('x'.repeat(STORE_NAME_MAX + 1)).ok, false);
});

test('sells-on keeps known keys once, in a fixed order', () => {
  assert.deepEqual(normalizeSellsOn(['vinted', 'ebay', 'ebay', 'myspace', 'other']), ['ebay', 'vinted', 'other']);
  assert.deepEqual(normalizeSellsOn('ebay'), []);
  assert.deepEqual(normalizeSellsOn(undefined), []);
});

test('only a small base64 png, jpeg or webp logo is kept', () => {
  const webp = 'data:image/webp;base64,UklGRhIAAABXRUJQVlA4';
  assert.equal(cleanLogo(webp), webp);
  assert.equal(cleanLogo('data:image/svg+xml;base64,PHN2Zz4='), '');
  assert.equal(cleanLogo('https://example.com/logo.png'), '');
  assert.equal(cleanLogo('data:image/png;base64,AAAA"><script>'), '');
  assert.equal(cleanLogo('data:image/png;base64,' + 'A'.repeat(MAX_LOGO_CHARS)), '');
  assert.equal(cleanLogo(42), '');
});

const AGREED = { acceptTerms: true, termsVersion: TERMS_VERSION };

test('the new store documents', () => {
  const d = buildNewBusinessDocs({ uid: 'u1', email: 'a@b.co', name: '  Second Spin ', logo: 'nope', sellsOn: ['poshmark', 'ebay'], ...AGREED, now: 1000 });
  assert.deepEqual(d.business, { name: 'Second Spin', ownerUid: 'u1', createdAt: 1000, createdVia: 'self-serve', live: true, aiMonthlyLimit: NEW_BUSINESS_AI_LIMIT, termsVersion: TERMS_VERSION, termsAcceptedAt: 1000 });
  assert.deepEqual(d.member, { role: 'owner', email: 'a@b.co', addedAt: 1000 });
  assert.deepEqual(d.settings, { storeName: 'Second Spin', sellsOn: ['ebay', 'poshmark'] });
  assert.deepEqual(d.userPatch, { status: 'approved', role: 'owner', approvedVia: 'self-serve', approvedAt: 1000, termsVersion: TERMS_VERSION, termsAcceptedAt: 1000 });
  const withLogo = buildNewBusinessDocs({ uid: 'u1', name: 'Shop', logo: 'data:image/png;base64,AAAA', ...AGREED, now: 1 });
  assert.equal(withLogo.settings.storeLogo, 'data:image/png;base64,AAAA');
  assert.equal(withLogo.member.email, null);
  assert.throws(() => buildNewBusinessDocs({ uid: 'u1', name: ' ', ...AGREED, now: 1 }), /Enter a name/);
  assert.throws(() => buildNewBusinessDocs({ name: 'Shop', ...AGREED, now: 1 }), /Missing user/);
  assert.throws(() => buildNewBusinessDocs({ uid: 'u1', name: 'Shop', now: 1 }), { message: TERMS_REQUIRED_ERROR });
});

test('the Terms must be accepted, in their current version', () => {
  assert.deepEqual(checkTermsAcceptance(AGREED), { ok: true, termsVersion: TERMS_VERSION });
  assert.deepEqual(checkTermsAcceptance({}), { ok: false, error: TERMS_REQUIRED_ERROR });
  assert.deepEqual(checkTermsAcceptance(), { ok: false, error: TERMS_REQUIRED_ERROR });
  assert.equal(checkTermsAcceptance({ acceptTerms: 'true', termsVersion: TERMS_VERSION }).ok, false);
  assert.equal(checkTermsAcceptance({ acceptTerms: false, termsVersion: TERMS_VERSION }).ok, false);
  assert.deepEqual(checkTermsAcceptance({ acceptTerms: true, termsVersion: '2020-01-01' }), { ok: false, error: TERMS_STALE_ERROR });
  assert.deepEqual(checkTermsAcceptance({ acceptTerms: true }), { ok: false, error: TERMS_STALE_ERROR });
});

test('with self-serve off the gate is the v3.27 gate', () => {
  const off = (userDoc, emailVerified) => signupNextStep({ userDoc, emailVerified, selfServe: false });
  assert.equal(off({ status: 'pending' }, false), 'awaiting_approval');
  assert.equal(off({ status: 'pending' }, true), 'awaiting_approval');
  assert.equal(off({ status: 'approved' }, false), 'verify');
  assert.equal(off({ status: 'approved' }, true), 'app');
  assert.equal(off({ status: 'removed' }, true), 'removed');
  assert.equal(off(null, true), 'awaiting_approval');
});

test('with self-serve on a pending account verifies, then creates its store', () => {
  const on = (userDoc, emailVerified) => signupNextStep({ userDoc, emailVerified, selfServe: true });
  assert.equal(on({ status: 'pending' }, false), 'verify');
  assert.equal(on({ status: 'pending' }, true), 'create_store');
  assert.equal(on({ status: 'approved' }, true), 'app');
  assert.equal(on({ status: 'approved' }, false), 'verify');
  assert.equal(on({ status: 'removed' }, true), 'removed');
  // A pending account already tied to a business waits for its admin.
  assert.equal(on({ status: 'pending', activeBizId: 'b1' }, true), 'awaiting_approval');
});

test('invite emails are normalized to a plain lowercase address', async () => {
  const { normalizeInviteEmail } = await import('../../src/domain/new-business.js');
  assert.equal(normalizeInviteEmail('  Maya.K@Example.COM '), 'maya.k@example.com');
  for (const bad of ['', null, undefined, 'maya', 'a@b', 'a b@c.co', 'a/b@c.co', '@c.co', 'a@@c.co', 'x'.repeat(250) + '@c.co']){
    assert.equal(normalizeInviteEmail(bad), '', String(bad));
  }
});

test('who may create a store: verified, and the switch or an open invite', async () => {
  const { canCreateStore, inviteState } = await import('../../src/domain/new-business.js');
  const open = { email: 'a@b.co', createdAt: 1 };
  const used = { ...open, usedAt: 2, bizId: 'b1' };
  assert.equal(inviteState(null), 'none');
  assert.equal(inviteState(open), 'open');
  assert.equal(inviteState(used), 'used');
  // An invited, verified account: yes, with the switch off.
  assert.equal(canCreateStore({ selfServe: false, invite: open, emailVerified: true }), true);
  // Not invited: no.
  assert.equal(canCreateStore({ selfServe: false, invite: null, emailVerified: true }), false);
  // Invited but not verified: no.
  assert.equal(canCreateStore({ selfServe: false, invite: open, emailVerified: false }), false);
  // A used invite never opens a second store.
  assert.equal(canCreateStore({ selfServe: false, invite: used, emailVerified: true }), false);
  // The switch on still needs a verified email, and an invite is not needed.
  assert.equal(canCreateStore({ selfServe: true, invite: null, emailVerified: true }), true);
  assert.equal(canCreateStore({ selfServe: true, invite: null, emailVerified: false }), false);
});

test('the gate sends an invited pending account to verify, then the store screen', () => {
  const gate = (emailVerified, invited) => signupNextStep({ userDoc: { status: 'pending' }, emailVerified, selfServe: false, invited });
  assert.equal(gate(false, true), 'verify');
  assert.equal(gate(true, true), 'create_store');
  assert.equal(gate(true, false), 'awaiting_approval');
  assert.equal(gate(false, false), 'awaiting_approval');
});
