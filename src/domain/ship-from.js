// The store's eBay ship-from address (v3.28.19). Pure: no DOM, no Firebase.
// Used by Settings → eBay (the form) and by api/ebay-setup.js (the check
// before anything is sent to eBay).
//
// Only city, state and ZIP (Vitor, 2026-10-24): eBay needs no street for a
// warehouse location, buyers only see "City, ST", and the seller's street is
// never asked for or stored. The address lives on the seller's own eBay
// account, not in Firestore.

export const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
  'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM',
  'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA',
  'WV', 'WI', 'WY',
];

const ZIP = /^\d{5}(-\d{4})?$/;
const CITY = /^[A-Za-z][A-Za-z .'-]{0,59}$/;

// The address the setup used before v3.28.19 on every account.
const PLACEHOLDER = { city: 'Orlando', stateOrProvince: 'FL', postalCode: '32801' };

// { ok:true, address:{ city, stateOrProvince, postalCode, country:'US' } }
// or { ok:false, errors:{ city?, state?, postalCode? } } with one sentence each.
export function cleanShipFrom(raw){
  const r = raw && typeof raw === 'object' ? raw : {};
  let city = String(r.city ?? '').trim().replace(/\s+/g, ' ');
  // "austin" → "Austin"; a city typed with capitals (McAllen, DeKalb) stays.
  if (city && city === city.toLowerCase()) city = city.replace(/(^|[\s-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
  const state = String(r.stateOrProvince ?? r.state ?? '').trim().toUpperCase();
  const postalCode = String(r.postalCode ?? r.zip ?? '').trim();
  const errors = {};
  if (!city) errors.city = 'Enter the city you ship from.';
  else if (!CITY.test(city)) errors.city = 'Use letters, spaces, periods, apostrophes or hyphens only.';
  if (!US_STATES.includes(state)) errors.state = 'Pick the state you ship from.';
  if (!ZIP.test(postalCode)) errors.postalCode = 'Enter a 5-digit ZIP code (or ZIP+4).';
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, address: { city, stateOrProvince: state, postalCode, country: 'US' } };
}

// The address part of an eBay location (getInventoryLocation answer), or null.
export function shipFromOfLocation(location){
  const a = location?.location?.address;
  if (!a || typeof a !== 'object') return null;
  const out = {
    city: typeof a.city === 'string' ? a.city : '',
    stateOrProvince: typeof a.stateOrProvince === 'string' ? a.stateOrProvince : '',
    postalCode: typeof a.postalCode === 'string' ? a.postalCode : '',
  };
  return out.city || out.stateOrProvince || out.postalCode ? out : null;
}

// "Austin, TX 78701" (the parts that are there).
export function shipFromLine(address){
  if (!address) return '';
  const place = [address.city, address.stateOrProvince].filter(Boolean).join(', ');
  return [place, address.postalCode].filter(Boolean).join(' ');
}

// True for the sample address the old setup put on every account.
export function isPlaceholderShipFrom(address){
  if (!address) return false;
  return String(address.city || '').toLowerCase() === PLACEHOLDER.city.toLowerCase()
    && String(address.stateOrProvince || '').toUpperCase() === PLACEHOLDER.stateOrProvince
    && String(address.postalCode || '').slice(0, 5) === PLACEHOLDER.postalCode;
}
