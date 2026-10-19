// Headers for calls to our own /api functions. Every eBay and AI endpoint
// checks the caller's Firebase ID token (api/_requireApprovedUser.js), so
// each request carries it as a Bearer token. getIdToken() refreshes the
// token on its own when it's close to expiring.
export async function jsonAuthHeaders(){
  const user = window.auth && window.auth.currentUser;
  const idToken = user ? await user.getIdToken() : null;
  return idToken
    ? { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` }
    : { 'Content-Type': 'application/json' };
}
