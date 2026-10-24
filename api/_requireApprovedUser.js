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
// Since v3.18.4 the account's email must be verified too (email_verified in
// the token, the same check as the security rules).
// Returns { ok:true, uid, email, role, bizId, via:'admin'|'rest' } or
// { ok:false, status, error }. bizId is the user's business only once that
// business is live (v3.17.0, docs/multi-tenant.md); before the switch, or
// for a user without one, it's null, and eBay and AI calls answer 403
// (NO_STORE_ERROR, v3.28.9).
//
// Since v3.28.8 the users doc's activeBizId is only a pointer: the account
// belongs to that business only if businesses/{bizId}/members/{uid} exists
// (written by the server alone), and the role comes from that members doc.
// The users doc's role can only lower it to 'employee'. No members doc →
// bizId null and no role from the business.
import { getFirebaseAdmin, FIREBASE_PROJECT_ID } from './_firebaseAdmin.js';
import { checkAppCheck } from './_appCheck.js';

let warnedNoAdmin = false;

// The answer when an endpoint needs the caller's store and bizId is null
// (v3.28.9): eBay (_ebayToken.js) and AI (_aiAllowance.js) refuse with it
// instead of falling back to shared, pre-business data.
export const NO_STORE_ERROR = 'This account isn\'t linked to a store yet.';

const UNVERIFIED = { ok: false, status: 403, error: 'Verify your email first (in the app: Settings → Account).' };

// A business id the way it's stored on users/{uid}: a plain doc id, else none.
function cleanBizId(v){
  return typeof v === 'string' && v && !v.includes('/') ? v : null;
}

// The role is the members doc's; the users doc can only lower it to
// 'employee' (Vitor, 2026-10-24).
function pickRole(memberRole, userRole){
  if (userRole === 'employee') return 'employee';
  return memberRole || null;
}

// checkWithAdmin and checkWithRest are exported for the tests
// (tests/api/require-approved-user.test.mjs).
export async function checkWithAdmin(admin, idToken){
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
  if (decoded.email_verified !== true) return UNVERIFIED;
  let bizId = null;
  let memberRole = null;
  const activeBizId = cleanBizId(data.activeBizId);
  if (activeBizId){
    const bizRef = admin.db.collection('businesses').doc(activeBizId);
    const [member, biz] = await Promise.all([bizRef.collection('members').doc(decoded.uid).get(), bizRef.get()]);
    if (member.exists){
      memberRole = member.data().role || null;
      if (biz.exists && biz.data().live === true) bizId = activeBizId;
    }
  }
  return { ok: true, uid: decoded.uid, email: decoded.email || null, role: pickRole(memberRole, data.role), bizId, via: 'admin' };
}

export async function checkWithRest(idToken){
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
    // Firestore accepted this token (the read above), so its payload is genuine.
    if (payload.email_verified !== true) return UNVERIFIED;
    // The members doc and the business doc are readable by the member
    // themself (firestore.rules); a failed read means "not a member" or
    // "not live" for this request.
    let bizId = null;
    let memberRole = null;
    const activeBizId = cleanBizId(doc.fields?.activeBizId?.stringValue);
    if (activeBizId){
      const base = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/businesses/${encodeURIComponent(activeBizId)}`;
      const read = (url) => fetch(url, { headers: { 'Authorization': `Bearer ${idToken}` } })
        .then(r => r && r.ok ? r.json() : null)
        .catch(() => null);
      const [memberDoc, bizDoc] = await Promise.all([read(`${base}/members/${encodeURIComponent(uid)}`), read(base)]);
      if (memberDoc && memberDoc.fields){
        memberRole = memberDoc.fields.role?.stringValue || null;
        if (bizDoc?.fields?.live?.booleanValue === true) bizId = activeBizId;
      }
    }
    // Firestore accepted the token, so its payload (email included) is genuine.
    return { ok: true, uid, email: payload.email || null, role: pickRole(memberRole, doc.fields?.role?.stringValue), bizId, via: 'rest' };
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
  // App Check (v3.28.2, _appCheck.js): off, monitor or enforce, before
  // anything else is read. Without Firebase Admin it can't be checked.
  const appCheck = await checkAppCheck(admin, req);
  if (!appCheck.ok) return appCheck;
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
