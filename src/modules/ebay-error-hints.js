// The eBay error library: every eBay publish error the app knows how to
// explain, each with a plain-language problem and (when possible) an
// immediate fix. Pure data + functions, no DOM — ebay-api.js renders the
// result and wires the fix buttons; Settings → "eBay error library" lists
// EBAY_ERROR_LIBRARY next to the errors actually seen on this account
// (modules/ebay-error-log.js).
//
// To teach the app a new error: add one entry to EBAY_ERROR_LIBRARY.
//   key         stable id (also stored in the error log)
//   title       short name shown in Settings
//   codes       eBay errorIds this entry covers (informational + matching)
//   match(err, msg)       optional extra matcher on the message text
//   diagnose(err, ctx)    -> { text, fix? }  (ctx = { item, result })
//
// Fix shapes (hint.fix):
//   { type: 'setValue', target, value, label }
//       save `value` on the item and republish right away
//   { type: 'chooseValue', target, options, preselect, label }
//       dropdown of eBay's official values, then save + republish
//   { type: 'focusField', fieldId | aspect, label }
//       open the item and jump to the field
//   { type: 'retry', label }      nothing to change, just try again
//   { type: 'settings', label }   the fix lives in Settings
// `target` is { field: 'size' | 'brand' | 'color' } for the item's own
// fields, or { aspect: 'Pattern' } for a category item specific
// (item.ebayAspects).

import { normalizeSizeForEbay } from './ebay-size.js';
import { matchAllowedValue } from './ebay-aspect-match.js';

// Normalizes eBay's two error shapes (REST `{errors:[...]}` / a bare array,
// and the Trading API's `{Errors:[...]}`) into one plain array.
export function extractEbayErrors(detail){
  if (!detail) return [];
  if (Array.isArray(detail)) return detail;
  if (Array.isArray(detail.errors)) return detail.errors;
  if (Array.isArray(detail.Errors)) return detail.Errors;
  if (typeof detail === 'object' && (detail.message || detail.ShortMessage || detail.errorId)) return [detail];
  return [];
}

const isWarning = (e) => (e.SeverityCode || e.severity) === 'Warning';
export const ebayErrorCode = (e) => Number(e.errorId || e.ErrorCode) || null;
export const ebayErrorMessage = (e) => String(e.message || e.longMessage || e.ShortMessage || e.LongMessage || '');

// Error-severity messages only (skips informational Warnings, like the
// standing "seller has opted into business policies" notice eBay attaches
// to most Trading API responses), so the actual problem reads as a
// sentence, not a blob.
export function ebayErrorShortMessages(detail){
  const msgs = extractEbayErrors(detail)
    .filter(e => !isWarning(e))
    .map(e => e.ShortMessage || e.LongMessage || e.message)
    .filter(Boolean);
  return msgs.length ? msgs : null;
}

// Dedicated item-form inputs for the aspects eBay keeps asking about. Any
// other aspect lives in the item modal's "This eBay category also
// requires" section (#ebayAspectsContainer [data-aspect=...]).
const OWN_FIELDS = { size: 'fSize', brand: 'fBrand', color: 'fColor' };

export function targetForAspect(aspectName){
  const key = String(aspectName || '').toLowerCase();
  return OWN_FIELDS[key] ? { field: key } : { aspect: aspectName };
}

function focusAspectFix(aspectName){
  const key = String(aspectName).toLowerCase();
  return OWN_FIELDS[key]
    ? { type: 'focusField', fieldId: OWN_FIELDS[key], label: `Edit ${aspectName}` }
    : { type: 'focusField', aspect: aspectName, label: `Edit ${aspectName}` };
}

function currentAspectValue(item, aspectName){
  const t = targetForAspect(aspectName);
  if (t.field) return item[t.field] || '';
  const map = item.ebayAspects || {};
  const k = Object.keys(map).find(n => n.toLowerCase() === String(aspectName).toLowerCase());
  return k ? map[k] : '';
}

// 25129: "no longer support custom values for Size" — parameters carry
// the aspect name and the rejected value (index 3 and 4 in practice), but
// the aspect name is also in the message, so read both defensively.
function parseInvalidAspect(err){
  const params = (err.parameters || []).map(p => p && p.value).filter(Boolean);
  const msg = ebayErrorMessage(err);
  const fromMsg = msg.match(/custom values for ([^.]+?)\./i);
  const name = (fromMsg && fromMsg[1].trim()) || params[3] || null;
  const valueParam = params.find(v => / is not a valid value for /i.test(v));
  const value = valueParam ? valueParam.replace(/ is not a valid value for .*/i, '').trim() : (params[4] || null);
  return { name, value };
}

function allowedValuesFor(result, aspectName){
  const map = (result && result.aspectAllowedValues) || {};
  const k = Object.keys(map).find(n => n.toLowerCase() === String(aspectName).toLowerCase());
  return k ? map[k] : null;
}

export const EBAY_ERROR_LIBRARY = [
  {
    key: 'aspect_not_standard_value',
    title: 'Item specific not one of eBay\'s standard values',
    codes: [25129],
    match: (err, msg) => /no longer support custom values/i.test(msg),
    diagnose(err, { item, result }){
      const { name, value } = parseInvalidAspect(err);
      const aspect = name || 'an item specific';
      const current = currentAspectValue(item, aspect) || value || '';
      const options = allowedValuesFor(result, aspect);
      const isSize = String(aspect).toLowerCase() === 'size';
      const guess = options
        ? matchAllowedValue(aspect, current, options)
        : (isSize ? normalizeSizeForEbay(current) : null);

      if (guess && guess !== current && !options){
        return {
          text: `eBay only accepts its standard values for ${aspect} in this category. "${current}" looks copied from a multi-country tag — the US value is "${guess}".`,
          fix: { type: 'setValue', target: targetForAspect(aspect), value: guess, label: `Change ${aspect} to "${guess}" & retry` },
        };
      }
      if (options){
        return {
          text: guess
            ? `eBay doesn't accept "${current}" for ${aspect} in this category. Its closest standard value is "${guess}".`
            : `eBay doesn't accept "${current}" for ${aspect} in this category — pick one of eBay's standard values.`,
          fix: { type: 'chooseValue', target: targetForAspect(aspect), options, preselect: guess || '', label: 'Apply & retry' },
        };
      }
      return {
        text: isSize
          ? `eBay doesn't accept "${current}" as a Size in this category — use a standard value (XS, S, M, L, XL, or a plain number like 8).`
          : `eBay doesn't accept "${current || 'this value'}" for ${aspect} in this category — pick one of eBay's standard values.`,
        fix: focusAspectFix(aspect),
      };
    },
  },
  {
    key: 'aspect_missing',
    title: 'Required item specific is blank',
    codes: [25002],
    match: (err, msg) => /item specific ["“]?[^"”.]+?["”]?\s+is missing/i.test(msg),
    diagnose(err){
      const m = ebayErrorMessage(err).match(/item specific ["“]?([^"”.]+?)["”]?\s+is missing/i);
      const aspect = m ? m[1].trim() : 'a required item specific';
      return { text: `This eBay category requires "${aspect}" and it's blank.`, fix: focusAspectFix(aspect) };
    },
  },
  {
    key: 'condition_not_allowed',
    title: 'Condition not allowed in this category',
    codes: [25021],
    match: (err, msg) => /condition id is invalid/i.test(msg),
    diagnose: () => ({
      text: `The item's Condition isn't allowed in this eBay category.`,
      fix: { type: 'focusField', fieldId: 'fCondition', label: 'Edit Condition' },
    }),
  },
  {
    key: 'package_weight',
    title: 'Package weight/size missing or invalid',
    codes: [25020],
    match: (err, msg) => /package weight|packageWeightAndSize/i.test(msg) && /invalid|missing|required/i.test(msg),
    diagnose: () => ({
      text: `eBay needs a valid package weight/size for this listing.`,
      fix: { type: 'focusField', fieldId: 'fWeight', label: 'Edit weight' },
    }),
  },
  {
    key: 'package_type',
    title: 'Shipping package type rejected',
    codes: [25101],
    match: (err, msg) => /ShippingPackage|packageType/i.test(msg),
    diagnose: () => ({
      text: `eBay rejected the shipping package type. The app already retries without it — usually a second try goes through.`,
      fix: { type: 'retry', label: 'Try again' },
    }),
  },
  {
    key: 'category_invalid',
    title: 'eBay category rejected',
    codes: [25005],
    match: (err, msg) => /categor(y|ies)/i.test(msg) && /invalid|not valid|leaf|not supported/i.test(msg),
    diagnose: () => ({
      text: `eBay rejected the chosen category — pick a more specific (leaf) category.`,
      fix: { type: 'focusField', fieldId: 'fEbayCategoryQuery', label: 'Change eBay category' },
    }),
  },
  {
    key: 'business_policies',
    title: 'Shipping/payment/return policy problem',
    codes: [25007, 25009],
    match: (err, msg) => /fulfillment|payment policy|return policy|business polic/i.test(msg),
    diagnose: () => ({
      text: `eBay couldn't use the shipping/payment/return policies on file. Re-run "eBay one-time setup" in Settings and check the policy IDs on Vercel.`,
      fix: { type: 'settings', label: 'Open Settings' },
    }),
  },
  {
    key: 'auth',
    title: 'eBay connection expired or rejected',
    codes: [1001],
    match: (err, msg) => /invalid access token|token.*(expired|invalid)|unauthori[sz]ed|access denied/i.test(msg),
    diagnose: () => ({
      text: `The eBay connection expired or was rejected — reconnect eBay in Settings.`,
      fix: { type: 'settings', label: 'Open Settings' },
    }),
  },
];

function findEntry(err){
  const code = ebayErrorCode(err);
  const msg = ebayErrorMessage(err);
  return EBAY_ERROR_LIBRARY.find(e => (code && e.codes.includes(code)) || (e.match && e.match(err, msg))) || null;
}

// Main entry point. Returns:
//   messages   — eBay's own short messages (readable one-liners)
//   hints      — [{ text, fix? }] known problems with a suggested fix
//   errors     — [{ code, message, key|null }] each Error-severity entry,
//                with the library entry that recognized it (for the log)
//   recognized — true when every error matched a library entry
export function diagnoseEbayFailure(result, item){
  const ctx = { item: item || {}, result: result || {} };
  const raw = extractEbayErrors(result && result.detail).filter(e => !isWarning(e));
  const hints = [];
  const seen = new Set();
  const errors = raw.map(err => {
    const entry = findEntry(err);
    if (entry){
      const hint = entry.diagnose(err, ctx);
      if (hint && !seen.has(hint.text)){ seen.add(hint.text); hints.push(hint); }
    }
    return { code: ebayErrorCode(err), message: ebayErrorMessage(err), key: entry ? entry.key : null };
  });
  if (!hints.length && result && result.step === 'auth'){
    hints.push({ text: `eBay account not connected.`, fix: { type: 'settings', label: 'Open Settings' } });
  }
  return {
    messages: ebayErrorShortMessages(result && result.detail) || [],
    hints,
    errors,
    recognized: errors.length > 0 && errors.every(e => e.key),
  };
}
