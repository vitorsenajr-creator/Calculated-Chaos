// Shared guard for endpoints that spend money (Anthropic API calls) — makes
// sure the caller is a signed-in Firebase user whose Firestore user doc says
// status:'approved', before the function does anything expensive.
//
// No firebase-admin / service account needed: we forward the caller's own
// Firebase ID token to the Firestore REST API to read their own user doc.
// Firestore independently verifies the token's signature and derives
// request.auth.uid from it server-side — a forged or expired token simply
// gets rejected by Firestore, so we don't need to verify the JWT ourselves.
const FIREBASE_PROJECT_ID = 'calculated-chaos-4027a';

export async function requireApprovedUser(req){
  const authHeader = req.headers['authorization'] || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken){
    return { ok: false, status: 401, error: 'Missing Authorization header.' };
  }

  let uid;
  try{
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString('utf8'));
    uid = payload.user_id || payload.sub;
  }catch(e){
    return { ok: false, status: 401, error: 'Malformed token.' };
  }
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
    return { ok: true, uid };
  }catch(e){
    console.error('requireApprovedUser Firestore check failed:', e);
    return { ok: false, status: 500, error: 'Could not verify account.' };
  }
}
