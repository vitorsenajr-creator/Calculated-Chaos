// Size normalization for eBay's Size aspect. Shared by api/ebay-list.js
// (what actually gets sent) and the app (pre-publish notice + the "fix it"
// button on a 25129 error), so both sides always agree on the result.
//
// Why: garment tags often print every regional conversion at once, and she
// copies the tag verbatim into Size — e.g. "EUR XS / USA XS / MEX 34". Many
// eBay apparel categories only accept their own standard Size values (XS,
// S, M, …) and reject that whole string with errorId 25129. The US value is
// what eBay US expects, so we pull that out.

const LETTER_SIZE_RE = /^(?:XXS|XS|S|M|L|XL|XXL|XXXL|[2-6]XL|[2-6]X|OS|ONE SIZE)$/i;
const US_PREFIX_RE = /^(?:USA|US|U\.S\.)(?![A-Z])\s*[:\-]?\s*/i;
const OTHER_REGION_PREFIX_RE = /^(?:EUR|EU|UK|MEX|MX|IT|FR|DE|JP|AU|BR|CN|INT|ASIA)(?![A-Z])\s*[:\-]?\s*/i;

// Returns the normalized size string (or the original, trimmed, when
// there's nothing confident to change). Never invents a value.
export function normalizeSizeForEbay(raw){
  const size = String(raw || '').trim();
  if (!size) return size;

  const parts = size.split(/\s*[\/|,;]\s*/).map(p => p.trim()).filter(Boolean);

  // 1. Explicit US/USA part wins ("EUR XS / USA XS / MEX 34" -> "XS").
  const usPart = parts.find(p => US_PREFIX_RE.test(p));
  if (usPart){
    const v = usPart.replace(US_PREFIX_RE, '').trim();
    if (v) return v;
  }

  // 2. Multi-region string with no US part: take the first plain letter
  //    size, since letter sizes are the same across regions.
  if (parts.length > 1 && parts.some(p => OTHER_REGION_PREFIX_RE.test(p))){
    const letter = parts.map(p => p.replace(OTHER_REGION_PREFIX_RE, '').trim()).find(p => LETTER_SIZE_RE.test(p));
    if (letter) return letter.toUpperCase();
  }

  // 3. A single value with just a "US " prefix ("US 8" -> "8").
  if (parts.length === 1 && US_PREFIX_RE.test(size)){
    const v = size.replace(US_PREFIX_RE, '').trim();
    if (v) return v;
  }

  return size;
}
