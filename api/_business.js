// Self-serve sign-up: "Create your store" (docs/multi-tenant.md step 5,
// v3.28.0). Not a route: api/platform.js calls these.
//
// A new seller signs up, verifies the email, then creates the store here.
// The business doc and its member list are written only by the server
// (firestore.rules: `allow write: if false`), so this is the only way a
// store comes to exist besides the migration (_migration.js).
//
// The whole thing sits behind one switch, platform/signup.selfServe, that a
// platform admin turns on in the Developer Panel. While it is off, nothing
// here creates anything and the app keeps the "Awaiting approval" flow.
//
// Firebase Admin ignores the security rules, so every check is done here.

import { buildNewBusinessDocs } from '../src/domain/new-business.js';
import { checkAppCheck } from './_appCheck.js';

const SWITCH = ['platform', 'signup'];
const err = (status, error) => ({ ok: false, status, error });

// The caller of a sign-up action: any signed-in account, approved or not
// (requireApprovedUser would refuse a pending one). Firebase Admin only:
// with no Admin key there is no store creation at all.
// Returns { ok:true, uid, email, emailVerified } or { ok:false, status, error }.
export async function verifySignedInUser(admin, req){
  const header = req.headers['authorization'] || '';
  const idToken = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!idToken) return err(401, 'Missing Authorization header.');
  // App Check (v3.28.2): sign-up is where bots would aim first.
  const appCheck = await checkAppCheck(admin, req);
  if (!appCheck.ok) return appCheck;
  try{
    const decoded = await admin.auth.verifyIdToken(idToken);
    return { ok: true, uid: decoded.uid, email: decoded.email || null, emailVerified: decoded.email_verified === true };
  }catch(e){
    return err(401, 'Sign-in expired or invalid. Sign in again.');
  }
}

export async function readSelfServe(db){
  const snap = await db.collection(SWITCH[0]).doc(SWITCH[1]).get();
  return snap.exists && snap.data().selfServe === true;
}

// What the sign-in gate needs to know about the switch.
export async function signupStatus(admin, caller){
  const [selfServe, userSnap] = await Promise.all([
    readSelfServe(admin.db),
    admin.db.collection('users').doc(caller.uid).get(),
  ]);
  const user = userSnap.exists ? userSnap.data() : null;
  return { ok: true, selfServe, hasBusiness: !!(user && user.activeBizId) };
}

// body: { name, logo?, sellsOn?, acceptTerms, termsVersion }. Creates
// businesses/{bizId}, its owner member, its config/settings, and approves
// the account with activeBizId, all in one transaction. Asking again after
// it worked returns the same store instead of a second one. Without the
// Terms checkbox (or with an old termsVersion) nothing is written and the
// answer is 400; with it, termsVersion and termsAcceptedAt go on the
// business doc and on users/{uid}.
export async function businessCreate(admin, caller, body){
  if (!caller.emailVerified) return err(403, 'Verify your email first.');
  if (!(await readSelfServe(admin.db))) return err(403, 'New stores are not open yet. Your account is waiting for approval.');

  const db = admin.db;
  let docs;
  try{
    docs = buildNewBusinessDocs({
      uid: caller.uid,
      email: caller.email,
      name: body && body.name,
      logo: body && body.logo,
      sellsOn: body && body.sellsOn,
      acceptTerms: body && body.acceptTerms,
      termsVersion: body && body.termsVersion,
      now: Date.now(),
    });
  }catch(e){
    return err(400, e.message);
  }

  const userRef = db.collection('users').doc(caller.uid);
  return db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) return err(403, 'Your account was not found. Sign out and sign in again.');
    const user = userSnap.data();
    if (user.activeBizId) return { ok: true, bizId: user.activeBizId, existing: true };
    if (user.status !== 'pending') return err(403, 'This account cannot create a store.');

    const bizRef = db.collection('businesses').doc();
    tx.set(bizRef, docs.business);
    tx.set(bizRef.collection('members').doc(caller.uid), docs.member);
    tx.set(bizRef.collection('config').doc('settings'), docs.settings);
    tx.set(userRef, { ...docs.userPatch, activeBizId: bizRef.id }, { merge: true });
    return { ok: true, bizId: bizRef.id, existing: false };
  });
}

// Developer Panel: read or set the switch (platform admins only; the
// caller checks).
export async function selfServeSet(db, caller, body){
  if (typeof (body && body.on) !== 'boolean') return err(400, 'Missing on: true or false.');
  await db.collection(SWITCH[0]).doc(SWITCH[1]).set({ selfServe: body.on, updatedAt: Date.now(), updatedBy: caller.uid }, { merge: true });
  return { ok: true, selfServe: body.on };
}
