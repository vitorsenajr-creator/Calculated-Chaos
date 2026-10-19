// Listing title and description builders (domain layer; v3.17.2,
// docs/modularization.md). Pure functions: data in, text out. No DOM, no
// Firebase, no app state; the seller's standard closing line is passed in
// (main.js passes appSettings.listingStandardText), so this runs the same
// in the browser, a native app wrapper or on the server.
import { LISTING_CONDITION_LABEL } from '../modules/constants.js';
import { LISTING_DESC_LIMIT } from '../modules/ai-item.js';

// Builds a Poshmark title within the platform's 80-char hard limit,
// adding optional parts (in priority order) only while they still fit —
// brand + clothing type are never dropped, since Poshmark's own guidance
// and every seller-SEO source agree those two are the most important.
// Poshmark's title limit (80 chars) is confirmed in their own support docs.
// Their description limit is NOT clearly documented anywhere reliable —
// Jasmine confirmed the app shows no visible counter and has never
// truncated her longer GPT-written descriptions in practice, so this is a
// generous working limit rather than a confirmed platform maximum. Bump
// this single number if a longer description ever gets rejected.

export function buildListingTitle({ brand, clothingType, category, gender, size, color, condition }){
  // Search-term order (same formula the AI title prompt uses): Brand +
  // Gender + Type + Color + Size. Brand + type are never dropped; gender
  // sits right after the brand because "Women's ..." is one of the most
  // searched qualifiers on both Poshmark and eBay.
  const type = clothingType || category;
  let title = [brand, type].filter(Boolean).join(' ').trim();
  if (gender && type){
    const withGender = [brand, gender, type].filter(Boolean).join(' ').trim();
    if (withGender.length <= 80) title = withGender;
  }
  const optional = [];
  if (color) optional.push(color);
  if (size) optional.push(`Size ${size}`);
  if (condition === 'novo_etiqueta') optional.push('NWT');
  optional.forEach(part => {
    const candidate = (title + ' ' + part).trim();
    if (candidate.length <= 80) title = candidate;
  });
  return title.slice(0, 80);
}

// Builds a Poshmark description within LISTING_DESC_LIMIT, using the
// same section order the AI writer is asked for (opening → "Details:"
// bullets → standard closing line), so both generators produce the same
// shape. Lines are added in priority order and lower-priority ones are
// dropped first if space runs out. No "Keywords:" line — keyword lists
// read as keyword stuffing, which Poshmark's policy prohibits.
export function buildListingDescription({ name, brand, clothingType, size, color, condition, notes, measurements, useStandardClosing }, { standardClosingText } = {}){
  const intro = `${name}${brand && !name.includes(brand) ? ' by ' + brand : ''}`;

  const detailLines = [];
  if (brand) detailLines.push(`* Brand: ${brand}`);
  if (clothingType) detailLines.push(`* Style: ${clothingType}`);
  if (size) detailLines.push(`* Size: ${size}`);
  if (color) detailLines.push(`* Color: ${color}`);
  detailLines.push(`* Condition: ${LISTING_CONDITION_LABEL[condition] || condition}`);
  if (measurements) detailLines.push(`* Measurements: ${measurements}`);
  if (notes) detailLines.push(`* Notes: ${notes}`);

  const sections = [
    intro,
    `Details:\n${detailLines.join('\n')}`,
  ];
  // The closet/bundle blurb only makes sense for clothing — she can
  // uncheck "Include my standard closing line" for anything else
  // (e.g. a pencil got "check my closet!" tacked on before this).
  if (useStandardClosing !== false){
    const closing = (standardClosingText || '').trim() || `Bundle discount available — check my closet! 📦`;
    sections.push(closing);
  }

  let text = '';
  for (const section of sections){
    const candidate = text ? text + '\n\n' + section : section;
    if (candidate.length <= LISTING_DESC_LIMIT) text = candidate;
  }
  return text;
}
