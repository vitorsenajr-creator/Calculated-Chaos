// Firebase App Check (v3.28.2, docs/multi-tenant.md step 4a): proves that a
// request comes from this app and not from a script, before self-serve
// sign-up opens. Provider: reCAPTCHA Enterprise (Vitor, 2026-10-23).
//
// The site key is public (it ships in every page). Create it in Google Cloud
// → reCAPTCHA (a website key with the production domains), register the web
// app with it in Firebase Console → App Check, then paste it here.
//
// Empty = App Check off: nothing is loaded and no token is sent, so the app
// works exactly as before the key exists.
export const APP_CHECK_SITE_KEY = '';
