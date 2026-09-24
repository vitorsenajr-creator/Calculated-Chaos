// Matches an item's own value for an eBay item specific (Size, Color, …)
// against the category's official allowed-values list (eBay Taxonomy API,
// get_item_aspects_for_category). Shared by api/ebay-list.js (conforms
// what gets sent before publishing) and the app (pre-publish check + the
// "pick a standard value" dropdown), so both sides always agree.
//
// Only ever returns a value that is literally in eBay's list, and only
// when the match is unambiguous — no fuzzy guessing that could put the
// wrong size on a live listing. No match => null, and the caller asks her.

import { normalizeSizeForEbay } from './ebay-size.js';

const flat = (v) => String(v || '').toLowerCase().replace(/[\s.\-_'’]/g, '');

// Letter-size spellings eBay categories use interchangeably.
const SIZE_KEYS = {
  xxs: 'xxs', xxsmall: 'xxs', '2xs': 'xxs', extraextrasmall: 'xxs',
  xs: 'xs', xsmall: 'xs', extrasmall: 'xs',
  s: 's', sm: 's', small: 's',
  m: 'm', md: 'm', med: 'm', medium: 'm',
  l: 'l', lg: 'l', large: 'l',
  xl: 'xl', xlarge: 'xl', extralarge: 'xl',
  xxl: 'xxl', '2xl': 'xxl', xxlarge: 'xxl', extraextralarge: 'xxl',
  xxxl: '3xl', '3xl': '3xl', xxxlarge: '3xl',
  '4xl': '4xl', '5xl': '5xl',
  os: 'os', onesize: 'os', onesizefitsall: 'os', osfa: 'os',
};
const sizeKey = (v) => SIZE_KEYS[flat(v)] || null;

export const isSizeAspect = (name) => /^size$/i.test(String(name || '').trim());

// Returns the exact allowed value to send, or null if there's no
// confident match. `aspectName` switches on the size-specific rules.
export function matchAllowedValue(aspectName, value, allowedValues){
  const raw = String(value || '').trim();
  if (!raw || !Array.isArray(allowedValues) || !allowedValues.length) return null;

  const exact = allowedValues.find(a => a.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;

  const loose = allowedValues.filter(a => flat(a) === flat(raw));
  if (loose.length === 1) return loose[0];

  if (!isSizeAspect(aspectName)) return null;

  const normalized = normalizeSizeForEbay(raw);
  if (normalized !== raw){
    const n = matchAllowedValue('', normalized, allowedValues);
    if (n) return n;
  }
  const key = sizeKey(normalized);
  if (key){
    const byKey = allowedValues.filter(a => sizeKey(a) === key);
    if (byKey.length === 1) return byKey[0];
  }
  return null;
}

// Whether the value is fine as-is for eBay: either already one of the
// allowed values, or the aspect has no fixed list at all.
export function isAllowedAsIs(value, allowedValues){
  if (!Array.isArray(allowedValues) || !allowedValues.length) return true;
  const raw = String(value || '').trim().toLowerCase();
  return allowedValues.some(a => a.toLowerCase() === raw);
}

// Server-side: rewrites any sent aspect whose value isn't in the
// category's list to its confident match. Returns what changed so the app
// can tell her ("Size sent as XS"). Leaves unmatched values untouched —
// eBay may still accept them (not every list is exhaustive), and if it
// doesn't, the error box offers the dropdown.
export function conformAspectsToAllowedValues(aspects, categoryAspects){
  const adjustments = [];
  if (!Array.isArray(categoryAspects)) return adjustments;
  for (const [name, values] of Object.entries(aspects)){
    const spec = categoryAspects.find(a => String(a.name).toLowerCase() === name.toLowerCase());
    if (!spec || !spec.allowedValues || !spec.allowedValues.length) continue;
    const current = values && values[0];
    if (!current || spec.allowedValues.includes(current)) continue;
    const match = matchAllowedValue(name, current, spec.allowedValues);
    if (match){
      aspects[name] = [match];
      adjustments.push({ aspect: name, from: current, to: match });
    }
  }
  return adjustments;
}
