// Platform admin in the browser (v3.18.1, docs/multi-tenant.md step 4a):
// the platformAdmin custom claim in the signed-in user's token, set only by
// the server (api/_adminClaims.js). Read once at sign-in, so the UI checks
// stay synchronous. This only decides what the UI shows; firestore.rules
// and api/platform.js check the same claim/uid themselves.

let platformAdmin = false;

// forceRefresh asks Firebase for a new token, which is when a claim set
// since the last refresh shows up.
export async function loadAdminClaim(user, forceRefresh = false){
  platformAdmin = false;
  if (!user) return false;
  try{
    const token = await user.getIdTokenResult(forceRefresh);
    platformAdmin = token.claims.platformAdmin === true;
  }catch(e){
    console.error('Could not read the admin claim:', e);
  }
  return platformAdmin;
}

export function isPlatformAdmin(){
  return platformAdmin;
}
