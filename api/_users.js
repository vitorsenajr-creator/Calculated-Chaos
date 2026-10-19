// User management that needs Firebase Admin (docs/multi-tenant.md step 4a,
// v3.18.2). Not a route: api/platform.js calls these for the Developer
// Panel (Remove, Restore, Deny, sign-in details) and for Settings (create
// an employee login).
//
// Why on the server: the browser can only change Firestore docs, not the
// Firebase Auth accounts behind them. Removing a user used to delete their
// users/{uid} doc while their login kept working, and the next sign-in
// recreated the doc as a fresh access request. Firebase Admin can disable
// the login itself, sign it out everywhere and delete it.
//
// Firebase Admin ignores the security rules, so every function here trusts
// its caller: api/platform.js only calls them for a platform admin.

import { isPlatformAdminUid } from './_firebaseAdmin.js';

const err = (status, error) => ({ ok: false, status, error });

// Auth errors that mean "this login doesn't exist (any more)".
const isNotFound = (e) => e && e.code === 'auth/user-not-found';

// Shared checks before changing someone else's access.
function guardTarget(caller, uid){
  if (!uid || typeof uid !== 'string') return err(400, 'Missing uid.');
  if (uid === caller.uid) return err(400, "You can't do this to your own account.");
  if (isPlatformAdminUid(uid)) return err(400, 'Platform admins can only be changed in the code (PLATFORM_ADMIN_UIDS).');
  return null;
}

// Sign-in details the browser can't read for other people: email verified,
// login disabled, last sign-in, sign-in methods. Keyed by uid; a users doc
// whose login no longer exists comes back with `missing: true`.
export async function usersAuthInfo(admin){
  const snap = await admin.db.collection('users').get();
  const uids = snap.docs.map(d => d.id);
  const info = {};
  for (let i = 0; i < uids.length; i += 100){
    const chunk = uids.slice(i, i + 100);
    const res = await admin.auth.getUsers(chunk.map(uid => ({ uid })));
    for (const u of res.users){
      info[u.uid] = {
        emailVerified: u.emailVerified === true,
        disabled: u.disabled === true,
        lastSignIn: u.metadata?.lastSignInTime || null,
        providers: (u.providerData || []).map(p => p.providerId),
      };
    }
    for (const nf of res.notFound) info[nf.uid] = { missing: true };
  }
  return { ok: true, users: info };
}

// Remove: the user loses access right away and can't sign in again, but
// nothing is deleted, so Restore can undo it. Order matters: the users doc
// changes first, because the rules check status on every read, which cuts
// access immediately; revoking only stops new sign-in tokens, and the
// current one stays valid for up to an hour.
export async function userRemove(admin, caller, body){
  const uid = body.uid;
  const bad = guardTarget(caller, uid);
  if (bad) return bad;
  const ref = admin.db.collection('users').doc(uid);
  const snap = await ref.get();
  if (!snap.exists) return err(404, 'User not found.');
  const data = snap.data();
  await ref.set({
    status: 'removed',
    statusBeforeRemoval: data.status === 'removed' ? (data.statusBeforeRemoval || 'pending') : (data.status || 'pending'),
    removedAt: Date.now(),
    removedBy: caller.uid,
  }, { merge: true });
  try{
    await admin.auth.updateUser(uid, { disabled: true });
    await admin.auth.revokeRefreshTokens(uid);
  }catch(e){
    if (!isNotFound(e)) throw e;
  }
  if (data.activeBizId){
    await admin.db.collection('businesses').doc(data.activeBizId).collection('members').doc(uid).delete();
  }
  return { ok: true };
}

// Restore: undoes Remove. The login works again and the user gets back the
// status they had (an approved user is a member of their business again,
// with their old role).
export async function userRestore(admin, caller, body){
  const uid = body.uid;
  const bad = guardTarget(caller, uid);
  if (bad) return bad;
  const ref = admin.db.collection('users').doc(uid);
  const snap = await ref.get();
  if (!snap.exists) return err(404, 'User not found.');
  const data = snap.data();
  if (data.status !== 'removed') return err(400, 'This user is not removed.');
  try{
    await admin.auth.updateUser(uid, { disabled: false });
  }catch(e){
    if (isNotFound(e)) return err(409, 'Their login no longer exists; they need to sign up again.');
    throw e;
  }
  const status = data.statusBeforeRemoval === 'approved' ? 'approved' : 'pending';
  await ref.set({ status, removedAt: null, removedBy: null, statusBeforeRemoval: null, restoredAt: Date.now() }, { merge: true });
  if (status === 'approved' && data.activeBizId){
    const biz = admin.db.collection('businesses').doc(data.activeBizId);
    if ((await biz.get()).exists){
      await biz.collection('members').doc(uid).set({
        role: data.role === 'employee' ? 'employee' : 'owner',
        email: data.email || null,
        addedAt: Date.now(),
      }, { merge: true });
    }
  }
  return { ok: true, status };
}

// Deny an access request: deletes the login and the request, so the email
// is free to sign up again later. Only for people who never got access.
export async function userDeny(admin, caller, body){
  const uid = body.uid;
  const bad = guardTarget(caller, uid);
  if (bad) return bad;
  const ref = admin.db.collection('users').doc(uid);
  const snap = await ref.get();
  if (snap.exists && snap.data().status !== 'pending'){
    return err(400, 'Only pending requests can be denied. Use Remove for anyone else.');
  }
  try{
    await admin.auth.deleteUser(uid);
  }catch(e){
    if (!isNotFound(e)) throw e;
  }
  if (snap.exists) await ref.delete();
  return { ok: true };
}

// Creates a Catalog-only employee login, approved right away. The login,
// the users doc and (for a live business) the membership are written
// together here; the browser used to create the login itself and then
// failed to write the doc, since the rules only let a user create their
// own doc.
export async function employeeCreate(admin, caller, body){
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!email || !password) return err(400, 'Enter both an email and a password.');
  if (password.length < 6) return err(400, "Password needs to be at least 6 characters (Firebase's minimum).");
  let user;
  try{
    user = await admin.auth.createUser({ email, password });
  }catch(e){
    if (e && e.code === 'auth/email-already-exists') return err(409, 'An account with this email already exists.');
    if (e && (e.code === 'auth/invalid-email' || e.code === 'auth/invalid-password')) return err(400, e.message);
    throw e;
  }
  const doc = { email, status: 'approved', role: 'employee', createdAt: Date.now(), createdBy: caller.uid };
  if (caller.bizId) doc.activeBizId = caller.bizId;
  try{
    await admin.db.collection('users').doc(user.uid).set(doc);
    if (caller.bizId){
      await admin.db.collection('businesses').doc(caller.bizId).collection('members').doc(user.uid).set({
        role: 'employee',
        email,
        addedAt: Date.now(),
      });
    }
  }catch(e){
    // Don't leave a login with no access record behind.
    await admin.auth.deleteUser(user.uid).catch(() => {});
    throw e;
  }
  return { ok: true, uid: user.uid };
}
