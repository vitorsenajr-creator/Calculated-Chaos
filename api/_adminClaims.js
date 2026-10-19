// Platform-admin custom claim (docs/multi-tenant.md step 4a, v3.18.0). Not
// a route: api/platform.js calls it for the Developer Panel's "Admin
// access" card.
//
// Why a claim: firestore.rules used to recognize admins by the email in
// the sign-in token. An email is a label anyone can type at sign-up (it
// isn't verified), so if an admin account were ever deleted, a stranger
// could register that address and be an admin. A custom claim is written
// only by the server (Firebase Admin) onto one specific account (uid), and
// Firebase puts it in that account's sign-in token, where the rules and
// the app can read it.
//
// The change is done in two halves ("expand, then contract"):
//  - v3.18.0 (this): the server sets `platformAdmin: true` on the accounts
//    that own PLATFORM_ADMIN_EMAILS today, and the rules accept the claim
//    OR the email list. Nothing can lock out yet.
//  - next: the rules, the app and the server keep only the claim, and the
//    admins are listed by uid (shown on the card) instead of by email.
//
// A signed-in browser only sees a new claim once its token is refreshed:
// the card forces that for the caller, other admins get it within an hour
// (Firebase refreshes tokens hourly) or on their next sign-in.

import { PLATFORM_ADMIN_EMAILS } from './_firebaseAdmin.js';

export const ADMIN_CLAIM = 'platformAdmin';

// Every account that has the claim today (whatever its email).
async function accountsWithClaim(auth){
  const found = [];
  let pageToken;
  do{
    const page = await auth.listUsers(1000, pageToken);
    for (const u of page.users){
      if (u.customClaims && u.customClaims[ADMIN_CLAIM] === true){
        found.push(u);
      }
    }
    pageToken = page.pageToken;
  }while (pageToken);
  return found;
}

// The accounts that should be admins: the ones that own the listed emails.
// These accounts already exist (created in 2026-07), so an email can't be
// claimed by a new sign-up while they do.
async function listedAccounts(auth){
  return Promise.all(PLATFORM_ADMIN_EMAILS.map(async (email) => {
    try{
      return { email, user: await auth.getUserByEmail(email) };
    }catch(e){
      if (e && e.code === 'auth/user-not-found') return { email, user: null };
      throw e;
    }
  }));
}

function describe(listed, extra){
  return {
    ok: true,
    claim: ADMIN_CLAIM,
    admins: listed.map(({ email, user }) => user ? {
      email,
      uid: user.uid,
      hasClaim: user.customClaims?.[ADMIN_CLAIM] === true,
      emailVerified: user.emailVerified === true,
      disabled: user.disabled === true,
    } : { email, uid: null, hasClaim: false, missing: true }),
    // Accounts that have the claim but aren't listed (should be none).
    extra: extra.map(u => ({ uid: u.uid, email: u.email || null })),
  };
}

// Read-only: who should be an admin, and who has the claim.
export async function adminClaimsStatus(auth){
  const listed = await listedAccounts(auth);
  const listedUids = new Set(listed.filter(l => l.user).map(l => l.user.uid));
  const extra = (await accountsWithClaim(auth)).filter(u => !listedUids.has(u.uid));
  return describe(listed, extra);
}

// Gives the claim to every listed account and takes it from anyone else.
// Other custom claims on an account are kept (setCustomUserClaims replaces
// the whole set, so the current one is merged first).
export async function adminClaimsSync(auth){
  const listed = await listedAccounts(auth);
  const listedUids = new Set();
  for (const { user } of listed){
    if (!user) continue;
    listedUids.add(user.uid);
    if (user.customClaims?.[ADMIN_CLAIM] !== true){
      await auth.setCustomUserClaims(user.uid, { ...(user.customClaims || {}), [ADMIN_CLAIM]: true });
    }
  }
  for (const u of await accountsWithClaim(auth)){
    if (listedUids.has(u.uid)) continue;
    const { [ADMIN_CLAIM]: _removed, ...rest } = u.customClaims || {};
    await auth.setCustomUserClaims(u.uid, Object.keys(rest).length ? rest : null);
  }
  return adminClaimsStatus(auth);
}
