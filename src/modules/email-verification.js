// Email verification (docs/multi-tenant.md step 4a, v3.18.3). Nothing is
// ever sent automatically (Vitor, 2026-10-19): the email goes out only when
// the signed-in person clicks "Send verification email", to their own
// address. Firebase sends it from its default sender, with the template in
// Firebase Console → Authentication → Templates.
//
// Requiring a verified email comes later (step 4a, PR 5), once the
// Developer Panel shows every account as verified.

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
