// Email verification (docs/multi-tenant.md step 4a, v3.18.3). Nothing is
// ever sent automatically (Vitor, 2026-10-19): the email goes out only when
// the signed-in person clicks "Send verification email", to their own
// address. Firebase sends it from its default sender, with the template in
// Firebase Console → Authentication → Templates.
//
// Since v3.18.4 a verified email is required: the rules (isVerified()),
// the server (requireApprovedUser) and the app's sign-in gates check it.

function errorText(e){
  const code = String(e && e.code || '');
  if (code === 'auth/too-many-requests') return 'Too many emails were sent recently. Wait a few minutes and try again.';
  if (code === 'auth/network-request-failed') return 'No connection. Check your internet and try again.';
  return (e && e.message) || 'Something went wrong.';
}

// Sends the verification email to the signed-in user's own address.
// Returns { ok:true } or { ok:false, error }.
export async function sendVerificationEmail(user){
  if (!user) return { ok: false, error: 'Not signed in.' };
  try{
    await window.authFns.sendEmailVerification(user);
    return { ok: true };
  }catch(e){
    return { ok: false, error: errorText(e) };
  }
}

// After the person clicks the link in the email: reloads the account so
// user.emailVerified updates, and gets a new sign-in token so the server
// and the security rules see email_verified too. Returns the new value, or
// null if the check failed.
export async function refreshEmailVerified(user){
  if (!user) return null;
  try{
    await user.reload();
    if (user.emailVerified) await user.getIdToken(true);
    return user.emailVerified === true;
  }catch(e){
    console.error('Could not refresh email verification:', e);
    return null;
  }
}

// What the security rules and the server will see: email_verified in the
// sign-in token (required since v3.18.4). The token can be older than the
// account (verified on another device, or in another tab), so when the
// account says verified but the token doesn't, get a fresh token.
export async function tokenEmailVerified(user){
  if (!user) return false;
  try{
    if ((await user.getIdTokenResult()).claims.email_verified === true) return true;
    if (!user.emailVerified) await user.reload();
    if (!user.emailVerified) return false;
    return (await user.getIdTokenResult(true)).claims.email_verified === true;
  }catch(e){
    console.error('Could not check email verification:', e);
    return false;
  }
}
