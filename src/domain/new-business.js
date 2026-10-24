// Self-serve sign-up: "Create your store" (docs/multi-tenant.md step 5,
// v3.28.0). Pure logic shared by the app (form checks, the sign-in gate)
// and the server (api/_business.js builds the documents from it), so both
// sides agree on what a valid store is.

// Same cap as Settings → Appearance (ui/settings/forms.js saveStoreName).
export const STORE_NAME_MAX = 40;
// Same cap as the logo upload in Settings (ui/settings/settings-view.js).
export const MAX_LOGO_CHARS = 200000;
// Monthly ✨ analyses a new store gets until paid plans exist (Vitor,
// 2026-10-23). Saved on the business doc; the server enforces it from
// the next PR on.
export const NEW_BUSINESS_AI_LIMIT = 100;

// The Terms of Service and Privacy Policy a new store agrees to on the
// store screen (P0 PR4b). The date the current text took effect: change it
// with every change to /terms or /privacy, so a store screen loaded before
// the change is asked to reload instead of accepting a text it never showed.
export const TERMS_VERSION = '2026-10-24';
export const TERMS_REQUIRED_ERROR = 'Agree to the Terms and Privacy Policy to create your store.';
export const TERMS_STALE_ERROR = 'The Terms or Privacy Policy changed. Reload the page and review them.';

// { ok:true, termsVersion } or { ok:false, error }. `acceptTerms` must be
// exactly true and `termsVersion` the current one.
export function checkTermsAcceptance({ acceptTerms, termsVersion } = {}){
  if (acceptTerms !== true) return { ok: false, error: TERMS_REQUIRED_ERROR };
  if (termsVersion !== TERMS_VERSION) return { ok: false, error: TERMS_STALE_ERROR };
  return { ok: true, termsVersion: TERMS_VERSION };
}

// "Where do you sell?" on the store screen. Keys match the built-in
// platform keys (constants.js) plus 'other'.
export const SELL_ON_OPTIONS = [
  { key: 'ebay', label: 'eBay' },
  { key: 'poshmark', label: 'Poshmark' },
  { key: 'mercari', label: 'Mercari' },
  { key: 'depop', label: 'Depop' },
  { key: 'vinted', label: 'Vinted' },
  { key: 'other', label: 'Other' },
];
const SELL_ON_KEYS = SELL_ON_OPTIONS.map(o => o.key);

// Trims, folds runs of spaces and control characters into one space.
export function normalizeStoreName(raw){
  return String(raw == null ? '' : raw)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// { ok:true, name } or { ok:false, error } with a message for the form.
export function validateStoreName(raw){
  const name = normalizeStoreName(raw);
  if (!name) return { ok: false, error: 'Enter a name for your store.' };
  if (name.length < 2) return { ok: false, error: 'Use at least 2 characters.' };
  if (name.length > STORE_NAME_MAX) return { ok: false, error: `Keep it to ${STORE_NAME_MAX} characters or fewer.` };
  return { ok: true, name };
}

// Known keys only, each once, in the order of SELL_ON_OPTIONS.
export function normalizeSellsOn(list){
  const picked = new Set(Array.isArray(list) ? list.map(k => String(k)) : []);
  return SELL_ON_KEYS.filter(k => picked.has(k));
}

// A shrunk logo from platform/images.js: a data: image URL under the cap.
// Anything else is dropped (the logo is optional).
export function cleanLogo(value){
  if (typeof value !== 'string') return '';
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) return '';
  return value.length <= MAX_LOGO_CHARS ? value : '';
}

// The documents a new store starts with. The server writes them in one
// transaction (api/_business.js). `now` in ms. `acceptTerms` and
// `termsVersion` come from the store screen's checkbox; the acceptance is
// stamped on both the business and the user.
export function buildNewBusinessDocs({ uid, email, name, logo, sellsOn, acceptTerms, termsVersion, now }){
  const check = validateStoreName(name);
  if (!check.ok) throw new Error(check.error);
  if (!uid) throw new Error('Missing user.');
  const terms = checkTermsAcceptance({ acceptTerms, termsVersion });
  if (!terms.ok) throw new Error(terms.error);
  const accepted = { termsVersion: terms.termsVersion, termsAcceptedAt: now };
  const storeLogo = cleanLogo(logo);
  const business = {
    name: check.name,
    ownerUid: uid,
    createdAt: now,
    createdVia: 'self-serve',
    live: true,
    aiMonthlyLimit: NEW_BUSINESS_AI_LIMIT,
    ...accepted,
  };
  const member = { role: 'owner', email: email || null, addedAt: now };
  // Only what the store screen asks; loadSettings() fills every other
  // setting with its default.
  const settings = { storeName: check.name, sellsOn: normalizeSellsOn(sellsOn) };
  if (storeLogo) settings.storeLogo = storeLogo;
  const userPatch = { status: 'approved', role: 'owner', approvedVia: 'self-serve', approvedAt: now, ...accepted };
  return { business, member, settings, userPatch };
}

// Invitations (v3.28.12): a platform admin lists an email in the server-only
// `invites` collection (doc id = the normalized email); that account may
// create a store while self-serve is off. Used by api/_invites.js and
// api/_business.js.

// The doc id / key of an invite: trimmed, lowercase, one plain address.
// '' when it can't be an email (no "/" either: a Firestore doc id).
export function normalizeInviteEmail(raw){
  const email = String(raw == null ? '' : raw).trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(email)) return '';
  return email;
}

// 'none' (no invite), 'open' (not used yet) or 'used'.
export function inviteState(invite){
  if (!invite) return 'none';
  return invite.usedAt ? 'used' : 'open';
}

// May this account create a store now? `invite` is the invites doc data for
// its email (or null). A verified email is always required; then either the
// self-serve switch is on or the email has an open invite. A used invite
// never opens a second store.
export function canCreateStore({ selfServe, invite, emailVerified }){
  if (!emailVerified) return false;
  return selfServe === true || inviteState(invite) === 'open';
}

// What the sign-in gate shows next.
//   userDoc: the users/{uid} data (or null); emailVerified: the token's
//   email_verified; selfServe: the server's switch (false when unknown);
//   invited: the server says this email has an open invite (v3.28.12).
// Returns 'removed' | 'verify' | 'app' | 'create_store' | 'awaiting_approval'.
// With selfServe off the answers are exactly the v3.27 gate's.
export function signupNextStep({ userDoc, emailVerified, selfServe, invited }){
  const status = userDoc && userDoc.status;
  if (status === 'removed') return 'removed';
  if (status === 'approved') return emailVerified ? 'app' : 'verify';
  if (!selfServe && !invited) return 'awaiting_approval';
  // A pending account with self-serve on, or invited: verify first, then the store.
  if (userDoc && userDoc.activeBizId) return 'awaiting_approval';
  return emailVerified ? 'create_store' : 'verify';
}
