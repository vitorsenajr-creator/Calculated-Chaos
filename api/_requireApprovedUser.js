// Shared guard for every endpoint that spends money or touches eBay — makes
// sure the caller is a signed-in Firebase user whose Firestore user doc says
// status:'approved', before the function does anything else.
//
// Two ways to check, tried in this order:
//  1. Firebase Admin (v3.15.4, needs FIREBASE_SERVICE_ACCOUNT): verifies the
//     ID token's signature here and reads the user doc with admin rights.
//  2. Fallback, used when the Admin key is missing or broken, or Firestore
//     can't be reached through it: forward the caller's own ID token to the
//     Firestore REST API to read their own user doc. Firestore verifies the
//     token itself, so a forged or expired token is still rejected.
// Returns { ok:true, uid, email, role, via:'admin'|'rest' } or
// { ok:false, status, error }.
import { getFirebaseAdmin, FIREBASE_PROJECT_ID } from './_firebaseAdmin.js';

let warnedNoAdmin = false;

async function checkWithAdmin(admin, idToken){
  let decoded;
  try{
    decoded = await admin.auth.verifyIdToken(idToken);
  }catch(e){
    // A bad/expired token is the caller's problem (401); anything else
    // (e.g. Google's public keys couldn't be fetched) goes to the fallback.
    const code = String(e && e.code || '');
    if (code.startsWith('auth/') && code !== 'auth/internal-error') {
      return { ok: false, status: 401, error: 'Sign-in expired or invalid. Sign in again.' };
    }
    throw e;
  }
  const snap = await admin.db.collection('users').doc(decoded.uid).get();
  const data = snap.exists ? snap.data() : null;
  if (!data){
    return { ok: false, status: 403, error: 'Not authorized.' };
  }
  if (data.status !== 'approved'){
    return { ok: false, status: 403, error: 'Account pending approval.' };
  }
  return { ok: true, uid: decoded.uid, email: decoded.email || null, role: data.role || null, via: 'admin' };
}

async function checkWithRest(idToken){
  let payload;
  try{
    payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString('utf8'));
  }catch(e){
    return { ok: false, status: 401, error: 'Malformed token.' };
  }
  const uid = payload.user_id || payload.sub;
  if (!uid) return { ok: false, status: 401, error: 'Malformed token.' };

  try{
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${uid}`;
    const r = await fetch(url, { headers: { 'Authorization': `Bearer ${idToken}` } });
    if (!r.ok){
      return { ok: false, status: 403, error: 'Not authorized.' };
    }
    const doc = await r.json();
    const status = doc.fields?.status?.stringValue;
    if (status !== 'approved'){
      return { ok: false, status: 403, error: 'Account pending approval.' };
    }
    // Firestore accepted the token, so its payload (email included) is genuine.
    return { ok: true, uid, email: payload.email || null, role: doc.fields?.role?.stringValue || null, via: 'rest' };
  }catch(e){
    console.error('requireApprovedUser Firestore check failed:', e);
    return { ok: false, status: 500, error: 'Could not verify account.' };
  }
}

export async function requireApprovedUser(req){
  const authHeader = req.headers['authorization'] || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken){
    return { ok: false, status: 401, error: 'Missing Authorization header.' };
  }

  const admin = getFirebaseAdmin();
  if (admin.ok){
    try{
      return await checkWithAdmin(admin, idToken);
    }catch(e){
      // Firestore through the Admin SDK failed (not a bad token): fall back.
      console.error('requireApprovedUser admin check failed, using REST fallback:', e);
    }
  }else if (!warnedNoAdmin){
    warnedNoAdmin = true;
    console.warn(`requireApprovedUser: Firebase Admin unavailable (${admin.error}), using REST fallback.`);
  }
  return checkWithRest(idToken);
}
