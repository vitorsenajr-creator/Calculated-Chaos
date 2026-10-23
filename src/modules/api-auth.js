// Headers for calls to our own /api functions. Every eBay and AI endpoint
// checks the caller's Firebase ID token (api/_requireApprovedUser.js), so
// each request carries it as a Bearer token. getIdToken() refreshes the
// token on its own when it's close to expiring.
//
// Since v3.28.2 it also carries the App Check token (X-Firebase-AppCheck)
// when App Check is on (src/config/app-check.js); the server checks it in
// api/_appCheck.js. Every call to our /api goes through here.
export async function jsonAuthHeaders(){
  const user = window.auth && window.auth.currentUser;
  const [idToken, appCheck] = await Promise.all([
    user ? user.getIdToken() : null,
    typeof window.appCheckToken === 'function' ? window.appCheckToken() : null,
  ]);
  const headers = { 'Content-Type': 'application/json' };
  if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
  if (appCheck) headers['X-Firebase-AppCheck'] = appCheck;
  return headers;
}
