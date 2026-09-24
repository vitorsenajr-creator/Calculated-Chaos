// Turns a failed eBay publish result into plain-language problems, each
// with an immediate fix when one is known. Pure functions only (no DOM):
// ebay-api.js renders the result and wires the fix buttons.
//
// Before this, every publish failure showed the same generic "check your
// Seller Hub policies" line above a raw JSON dump, even when the real cause
// was something like a tag-copied Size ("EUR XS / USA XS / MEX 34", errorId
// 25129) that one tap could fix.
//
// Fix shapes returned in hint.fix:
//   { type: 'setField', field, value, label } — write a new value to the
//       item, save, and retry the publish right away
//   { type: 'focusField', fieldId, aspect?, label } — open the item and
//       jump to the field she needs to change
//   { type: 'retry', label } — nothing to change on her side, just retry
//   { type: 'settings', label } — the fix lives in Settings (eBay setup /
//       reconnect), not on this item

import { normalizeSizeForEbay } from './ebay-size.js';

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

// Error-severity messages only (skips informational Warnings, like the
// standing "seller has opted into business policies" notice eBay attaches
// to most Trading API responses), so the actual problem reads as a
// sentence, not a blob.
export function ebayErrorShortMessages(detail){
  const msgs = extractEbayErrors(detail)
    .filter(e => (e.SeverityCode || e.severity) !== 'Warning')
    .map(e => e.ShortMessage || e.LongMessage || e.message)
    .filter(Boolean);
  return msgs.length ? msgs : null;
}

// Dedicated item-form inputs for the aspects eBay keeps asking about. Any
// other aspect lives in the item modal's "This eBay category also
// requires" section (#ebayAspectsContainer [data-aspect=...]).
const ASPECT_FIELD_IDS = { size: 'fSize', brand: 'fBrand', color: 'fColor' };

function focusAspectFix(aspectName){
  const fieldId = ASPECT_FIELD_IDS[String(aspectName).toLowerCase()];
  return fieldId
    ? { type: 'focusField', fieldId, label: `Edit ${aspectName}` }
    : { type: 'focusField', aspect: aspectName, label: `Edit ${aspectName}` };
}

// 25129: "no longer support custom values for Size" — parameters carry
// the aspect name and the rejected value (index 3 and 4 in practice), but
// the aspect name is also in the message, so read both defensively.
function parseInvalidAspect(err){
  const params = (err.parameters || []).map(p => p && p.value).filter(Boolean);
  const msg = err.message || err.longMessage || '';
  const fromMsg = msg.match(/custom values for ([^.]+?)\./i);
  const name = (fromMsg && fromMsg[1].trim()) || params[3] || null;
  const valueParam = params.find(v => / is not a valid value for /i.test(v));
  const value = valueParam ? valueParam.replace(/ is not a valid value for .*/i, '').trim() : (params[4] || null);
  return { name, value };
}

function diagnoseOne(err, item){
  const id = Number(err.errorId || err.ErrorCode);
  const msg = String(err.message || err.longMessage || err.ShortMessage || err.LongMessage || '');

  if (id === 25129 || /no longer support custom values/i.test(msg)){
    const { name, value } = parseInvalidAspect(err);
    const aspect = name || 'an item specific';
    if (String(aspect).toLowerCase() === 'size'){
      const current = item.size || value || '';
      const normalized = normalizeSizeForEbay(current);
      if (normalized && normalized !== current){
        return {
          text: `eBay only accepts its standard sizes in this category. "${current}" looks copied from a multi-country tag — the US size is "${normalized}".`,
          fix: { type: 'setField', field: 'size', value: normalized, label: `Change Size to "${normalized}" & retry` },
        };
      }
      return {
        text: `eBay doesn't accept "${current || value}" as a Size in this category — use a standard value (XS, S, M, L, XL, or a plain number like 8).`,
        fix: focusAspectFix('Size'),
      };
    }
    return {
      text: `eBay doesn't accept "${value || 'this value'}" for ${aspect} in this category — pick one of eBay's standard values.`,
      fix: focusAspectFix(aspect),
    };
  }

  const missingAspect = msg.match(/item specific ["“]?([^"”.]+?)["”]?\s+is missing/i);
  if (id === 25002 || missingAspect){
    const aspect = missingAspect ? missingAspect[1].trim() : 'a required item specific';
    return { text: `This eBay category requires "${aspect}" and it's blank.`, fix: focusAspectFix(aspect) };
  }

  if (id === 25021 || /condition id is invalid/i.test(msg)){
    return {
      text: `The item's Condition isn't allowed in this eBay category.`,
      fix: { type: 'focusField', fieldId: 'fCondition', label: 'Edit Condition' },
    };
  }

  if (id === 25020 || (/package weight|packageWeightAndSize/i.test(msg) && /invalid|missing|required/i.test(msg))){
    return {
      text: `eBay needs a valid package weight/size for this listing.`,
      fix: { type: 'focusField', fieldId: 'fWeight', label: 'Edit weight' },
    };
  }

  if (id === 25101 || /ShippingPackage|packageType/i.test(msg)){
    return {
      text: `eBay rejected the shipping package type. The app already retries without it — usually a second try goes through.`,
      fix: { type: 'retry', label: 'Try again' },
    };
  }

  if (/categor(y|ies)/i.test(msg) && /invalid|not valid|leaf|not supported/i.test(msg)){
    return {
      text: `eBay rejected the chosen category — pick a more specific (leaf) category.`,
      fix: { type: 'focusField', fieldId: 'fEbayCategoryQuery', label: 'Change eBay category' },
    };
  }

  if (/fulfillment|payment policy|return policy|business polic/i.test(msg)){
    return {
      text: `eBay couldn't use the shipping/payment/return policies on file. Re-run "eBay one-time setup" in Settings and check the policy IDs on Vercel.`,
      fix: { type: 'settings', label: 'Open Settings' },
    };
  }

  if (/token|unauthori[sz]ed|access denied|expired/i.test(msg) || id === 1001){
    return {
      text: `The eBay connection expired or was rejected — reconnect eBay in Settings.`,
      fix: { type: 'settings', label: 'Open Settings' },
    };
  }

  return null;
}

// Main entry point. Returns:
//   messages — eBay's own short messages (readable one-liners)
//   hints    — [{ text, fix? }] known problems with a suggested fix
export function diagnoseEbayFailure(result, item){
  const errors = extractEbayErrors(result && result.detail)
    .filter(e => (e.SeverityCode || e.severity) !== 'Warning');
  const hints = [];
  const seen = new Set();
  for (const err of errors){
    const hint = diagnoseOne(err, item || {});
    if (hint && !seen.has(hint.text)){ seen.add(hint.text); hints.push(hint); }
  }
  if (!hints.length && result && result.step === 'auth'){
    hints.push({ text: `eBay account not connected.`, fix: { type: 'settings', label: 'Open Settings' } });
  }
  return { messages: ebayErrorShortMessages(result && result.detail) || [], hints };
}
