// Firebase App Check on our own functions (v3.28.2). Not a route.
//
// The app sends its App Check token as X-Firebase-AppCheck on every /api call
// (src/modules/api-auth.js). Firestore, Auth and Storage check it themselves
// once "Enforce" is on in the Firebase Console; our functions check it here,
// called from requireApprovedUser() and from the sign-up token check, so every
// signed-in endpoint is covered. eBay's own redirect (the OAuth callback) and
// webhook carry no token and never come through here.
//
// The mode is platform/appcheck.apiMode, set in Developer Panel → App:
//   'off'     → no check (the default, and the answer when it can't be read);
//   'monitor' → the call goes on; a missing or bad token is logged
//               (`app-check-monitor`), to see how many real calls lack one;
//   'enforce' → a missing or bad token answers 401.
// The mode is read at most once a minute per function instance.

const MODES = ['off', 'monitor', 'enforce'];
const DOC = ['platform', 'appcheck'];
const TTL_MS = 60 * 1000;
let cached = { mode: 'off', at: 0 };

export const APP_CHECK_REFUSED = "This app couldn't be verified. Reload the app and try again.";

export function normalizeMode(v){
  return MODES.includes(v) ? v : 'off';
}

export async function readAppCheckMode(db, { now = Date.now(), fresh = false } = {}){
  if (!fresh && now - cached.at < TTL_MS) return cached.mode;
  try{
    const snap = await db.collection(DOC[0]).doc(DOC[1]).get();
    cached = { mode: normalizeMode(snap.exists ? snap.data().apiMode : 'off'), at: now };
  }catch(e){
    console.error('app-check-mode-error', String(e && e.message || e));
    cached = { mode: cached.mode, at: now };
  }
  return cached.mode;
}

// Developer Panel: set the mode (platform admins only; the caller checks).
export async function setAppCheckMode(db, caller, body){
  const mode = body && body.mode;
  if (!MODES.includes(mode)) return { ok: false, status: 400, error: 'Mode must be off, monitor or enforce.' };
  await db.collection(DOC[0]).doc(DOC[1]).set({ apiMode: mode, updatedAt: Date.now(), updatedBy: caller.uid }, { merge: true });
  cached = { mode, at: Date.now() };
  return { ok: true, mode };
}

// admin: getFirebaseAdmin() result (needs .appCheck). Returns
// { ok:true } or { ok:false, status:401, error }.
export async function checkAppCheck(admin, req, { uid = null } = {}){
  if (!admin || !admin.ok) return { ok: true };
  const mode = await readAppCheckMode(admin.db);
  if (mode === 'off') return { ok: true };
  const token = req.headers['x-firebase-appcheck'] || '';
  let problem = null;
  if (!token) problem = 'missing';
  else{
    try{
      await admin.appCheck.verifyToken(token);
    }catch(e){
      problem = 'invalid';
    }
  }
  if (!problem) return { ok: true };
  console.log(mode === 'enforce' ? 'app-check-refused' : 'app-check-monitor', JSON.stringify({ problem, uid, path: req.url || null }));
  if (mode === 'enforce') return { ok: false, status: 401, error: APP_CHECK_REFUSED };
  return { ok: true };
}

// For tests: forget the cached mode.
export function _resetAppCheckCache(){ cached = { mode: 'off', at: 0 }; }
