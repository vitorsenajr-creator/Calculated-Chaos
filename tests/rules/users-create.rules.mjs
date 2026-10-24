// Security-rules tests for users/{uid} create (v3.28.8), run on the
// Firestore emulator. Not part of `npm test`: they need firebase-tools,
// @firebase/rules-unit-testing and Java, which the project doesn't install.
// Install them in a scratch directory and point RULES_DEPS at it:
//   mkdir /tmp/rules && cd /tmp/rules && npm init -y &&
//     npm i firebase-tools@14 @firebase/rules-unit-testing@4 firebase@11
//   echo '{"emulators":{"firestore":{"host":"127.0.0.1","port":8080},"ui":{"enabled":false}}}' > firebase.json
//   RULES=<repo>/firestore.rules RULES_DEPS=/tmp/rules npx firebase emulators:exec \
//     --only firestore --project demo-cc "node --test <repo>/tests/rules/users-create.rules.mjs"
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(`${process.env.RULES_DEPS}/package.json`);
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, updateDoc } = require('firebase/firestore');

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-cc',
    firestore: { rules: fs.readFileSync(process.env.RULES, 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
after(async () => { await env?.cleanup(); });

const user = (uid, extra = {}) => env.authenticatedContext(uid, { email: `${uid}@x.com`, email_verified: true, ...extra }).firestore();

test('pending create with only status, email, createdAt is allowed', async () => {
  await assertSucceeds(setDoc(doc(user('p1'), 'users/p1'), { email: 'p1@x.com', status: 'pending', createdAt: 1 }));
});
test('pending create with email null (first sign-in path) is allowed', async () => {
  await assertSucceeds(setDoc(doc(user('p1b'), 'users/p1b'), { email: null, status: 'pending', createdAt: 1 }));
});
test('pending create with only status is allowed', async () => {
  await assertSucceeds(setDoc(doc(user('p1c'), 'users/p1c'), { status: 'pending' }));
});
test('pending create with activeBizId is denied', async () => {
  await assertFails(setDoc(doc(user('p2'), 'users/p2'), { email: 'p2@x.com', status: 'pending', createdAt: 1, activeBizId: 'b1' }));
});
test('pending create with role is denied', async () => {
  await assertFails(setDoc(doc(user('p3'), 'users/p3'), { email: 'p3@x.com', status: 'pending', createdAt: 1, role: 'owner' }));
});
test('self-approved create is denied', async () => {
  await assertFails(setDoc(doc(user('p4'), 'users/p4'), { email: 'p4@x.com', status: 'approved', createdAt: 1 }));
});
test('another uid is denied', async () => {
  await assertFails(setDoc(doc(user('p5'), 'users/other'), { email: 'p5@x.com', status: 'pending', createdAt: 1 }));
});
test('admin creating an approved doc with role and activeBizId (own uid path) is allowed', async () => {
  await assertSucceeds(setDoc(doc(user('adm', { platformAdmin: true }), 'users/adm'), { email: 'adm@x.com', status: 'approved', role: 'owner', activeBizId: 'b1', createdAt: 1 }));
});
test('a user cannot update their own doc afterwards', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), 'users/p6'), { status: 'pending', email: 'p6@x.com' }));
  await assertFails(updateDoc(doc(user('p6'), 'users/p6'), { activeBizId: 'b1' }));
  await assertSucceeds(getDoc(doc(user('p6'), 'users/p6')));
});
