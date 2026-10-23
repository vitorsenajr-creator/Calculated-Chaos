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
// transaction (api/_business.js). `now` in ms.
export function buildNewBusinessDocs({ uid, email, name, logo, sellsOn, now }){
  const check = validateStoreName(name);
  if (!check.ok) throw new Error(check.error);
  if (!uid) throw new Error('Missing user.');
  const storeLogo = cleanLogo(logo);
  const business = {
    name: check.name,
    ownerUid: uid,
    createdAt: now,
    createdVia: 'self-serve',
    live: true,
    aiMonthlyLimit: NEW_BUSINESS_AI_LIMIT,
  };
  const member = { role: 'owner', email: email || null, addedAt: now };
  // Only what the store screen asks; loadSettings() fills every other
  // setting with its default.
  const settings = { storeName: check.name, sellsOn: normalizeSellsOn(sellsOn) };
  if (storeLogo) settings.storeLogo = storeLogo;
  const userPatch = { status: 'approved', role: 'owner', approvedVia: 'self-serve', approvedAt: now };
  return { business, member, settings, userPatch };
}

// What the sign-in gate shows next.
//   userDoc: the users/{uid} data (or null); emailVerified: the token's
//   email_verified; selfServe: the server's switch (false when unknown).
// Returns 'removed' | 'verify' | 'app' | 'create_store' | 'awaiting_approval'.
// With selfServe off the answers are exactly the v3.27 gate's.
export function signupNextStep({ userDoc, emailVerified, selfServe }){
  const status = userDoc && userDoc.status;
  if (status === 'removed') return 'removed';
  if (status === 'approved') return emailVerified ? 'app' : 'verify';
  if (!selfServe) return 'awaiting_approval';
  // A pending account with self-serve on: verify first, then the store.
  if (userDoc && userDoc.activeBizId) return 'awaiting_approval';
  return emailVerified ? 'create_store' : 'verify';
}
