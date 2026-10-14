// Prompt + JSON-schema builders for the single "✨ Analyze & write listing"
// AI call (v3.13.115) and its photo-free "rewrite listing text" sibling.
// Pure functions, no DOM — main.js gathers the form values and passes them
// in, then sends the prompt + schema to /api/analyze-photo.
//
// Why one call: photo analysis and listing writing used to be two separate
// requests that both sent the same photos, and images are ~75% of the
// input cost. Now one call reads the photos once and returns every field
// it can fill, plus the listing copy, plus the "visual facts" (fabric tag,
// construction details) it saw — saved on the item as `aiFacts`, so later
// rewrites of the text don't need to re-send any photo.

import { POSHMARK_STYLE_TAGS, PRESET_COLORS, PRESET_CLOTHING_TYPES } from './constants.js';

export const AI_GENDER_VALUES = ['', "Women's", "Men's", "Girls'", "Boys'", 'Unisex'];
export const AI_SIZE_TYPE_VALUES = ['', 'Regular', 'Plus', 'Petite', 'Tall', 'Big & Tall', 'Maternity', 'Juniors'];

// eBay item specifics the AI may fill — only ones that can be confirmed by
// looking at the garment or reading its tag. Deliberately left out:
// Occasion/Season/Theme/Vintage (would be a guess, not an observation) and
// Size/Brand/Color/Department (sent from the item's own fields, see
// EBAY_ASPECTS_AUTO_COVERED in main.js and v3.13.81).
export const AI_EBAY_ASPECT_NAMES = [
  'Material', 'Outer Shell Material', 'Lining Material', 'Country of Manufacture',
  'Pattern', 'Neckline', 'Sleeve Length', 'Sleeve Type', 'Closure', 'Collar Style',
  'Fabric Type', 'Fit', 'Rise', 'Leg Style', 'Dress Length', 'Skirt Length',
  'Jacket/Coat Length', 'Style', 'Type', 'Features',
];

const str = { type: 'string' };

// Everything the full call returns. Property order matters: the model
// fills them in this order, so it identifies the item and records what it
// saw BEFORE writing the title/description from those findings.
export function buildAnalyzeAndWriteSchema(){
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      brand: str,
      color: str,
      clothing_type: str,
      gender: { type: 'string', enum: AI_GENDER_VALUES },
      size: str,
      size_type: { type: 'string', enum: AI_SIZE_TYPE_VALUES },
      category: str,
      ebay_search_term: str,
      visible_flaws: str,
      material: str,
      construction_details: { type: 'array', items: str },
      ebay_aspects: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: { name: { type: 'string', enum: AI_EBAY_ASPECT_NAMES }, value: str },
          required: ['name', 'value'],
        },
      },
      price_low: { type: 'number' },
      price_high: { type: 'number' },
      reasoning: str,
      title: str,
      description: str,
      style_tags: { type: 'array', items: { type: 'string', enum: POSHMARK_STYLE_TAGS } },
    },
    required: [
      'brand', 'color', 'clothing_type', 'gender', 'size', 'size_type', 'category',
      'ebay_search_term', 'visible_flaws', 'material', 'construction_details',
      'ebay_aspects', 'price_low', 'price_high', 'reasoning', 'title', 'description', 'style_tags',
    ],
  };
}

export function buildRewriteSchema(){
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: str,
      description: str,
      style_tags: { type: 'array', items: { type: 'string', enum: POSHMARK_STYLE_TAGS } },
    },
    required: ['title', 'description', 'style_tags'],
  };
}

// Keeps only real Poshmark tags (exact spelling), max 3 — the schema already
// guarantees this, but the server falls back to a schema-less call if the
// model rejects structured outputs, so this is the safety net for that path.
export function normalizeStyleTags(raw){
  let list = raw;
  if (typeof list === 'string') list = list.split(',');
  if (!Array.isArray(list)) return [];
  const byLower = new Map(POSHMARK_STYLE_TAGS.map(t => [t.toLowerCase(), t]));
  const out = [];
  list.forEach(t => {
    const hit = byLower.get(String(t || '').trim().toLowerCase());
    if (hit && !out.includes(hit)) out.push(hit);
  });
  return out.slice(0, 3);
}

function sellerLine(label, value, notEntered){
  return `${label}: ${value ? value : notEntered}`;
}

// `f` = gatherListingFormFields()-shaped object (blank string = not entered).
function buildSellerDataBlock(f, conditionLabel, { forRewrite }){
  const notEntered = forRewrite ? '(unknown — leave it out)' : '(not entered — read it from the photos/tag if you can, else leave empty)';
  return [
    sellerLine('Brand', f.brand, notEntered),
    sellerLine('Clothing type', f.clothingType, notEntered),
    sellerLine('Gender', f.gender, notEntered),
    sellerLine('Size', f.size, notEntered),
    sellerLine('Color', f.color, notEntered),
    `Category field: ${f.category || '(empty)'}${forRewrite ? '' : ' (may just be a default — change it if the photos clearly show something else)'}`,
    `Condition (use this EXACT wording in the description; never judge condition yourself): ${conditionLabel}`,
    `Measurements: ${f.measurements || '(none provided — never estimate measurements from photos)'}`,
    `Seller notes / flaws: ${f.notes || '(none)'}`,
  ].join('\n');
}

// The listing-copy rules, shared by the full call and the rewrite call.
// Wording kept from the v3.13.111-113 iterations of the old AI writer.
// `source`: 'photos' (the model sees the photos) or 'facts' (it only has
// the visual facts recorded by an earlier analysis).
function buildListingRules({ descLimit, closingLineInstruction, source }){
  const fromPhotos = source === 'photos';
  const seen = fromPhotos ? 'visible in the photos' : 'listed in the recorded visual facts';
  const materialRule = fromPhotos
    ? `the fiber content EXACTLY as printed on a legible tag (e.g. '60% cotton, 40% acrylic'), plus care instructions if legible. OMIT this bullet entirely if no tag is legible — never guess fiber content`
    : `the recorded Material fact, exactly as given. OMIT this bullet entirely if no material was recorded — never guess fiber content`;
  const finalBullet = fromPhotos
    ? `one final bullet noting which angles the photos show and confirming there's no visible flaw beyond what's noted in seller notes (e.g. 'Front and back views shown — no visible wear or pilling'). Only state 'no visible flaws' if that's consistent with the seller notes and what you see; if there's a flaw, reflect that honestly instead.`
    : `one final bullet about visible wear, based ONLY on the recorded visible flaws and the seller notes (e.g. 'No visible wear or pilling'). If either mentions a flaw, reflect that honestly instead.`;

  return `TITLE: HARD LIMIT 80 characters — aim to use 70-80 of them, since every unused character is a lost search keyword. Formula, in this order: Brand + Gender (e.g. Women's) + Material or texture (e.g. Boucle, Linen, Denim, Cashmere) + Key style detail (e.g. Lace Trim, Button Front, Wrap) + Item Type + Color + Size. Never omit Brand or Item Type when known. Use the words real buyers type into search (e.g. 'Boucle', 'Cardigan Vest', 'Longline', 'Midi'), not vague descriptors nobody searches for (e.g. 'Mixed Knit', 'Unique', 'Beautiful'). No filler words, no ALL CAPS, no repeated words.

DESCRIPTION: HARD LIMIT ${descLimit} characters, formatted in EXACTLY this structure:
(1) A short, direct opening — ONE sentence. Keep it SHORT and keyword-only: color + material/texture + item type, then 'by' + brand, plus at most ONE standout trait (e.g. 'Black boucle and lace trim sweater vest by Coco + Carmen.'). Do NOT mention construction details here — closures/buttons, collar/neckline, pockets, sleeves, hem, fit — those belong ONLY in the bullets below, so nothing gets said twice. Plain, factual language. NO marketing filler, NO phrases like 'the kind of piece that earns its keep', 'reach for this on...', 'effortlessly', 'elevate your wardrobe', or similar generic copywriting.
(2) A blank line, then the word 'Details:' alone on its own line.
(3) A bullet list where every single line starts with '* ' (asterisk + space). Keep EVERY bullet to one short line — a phrase, not a sentence; buyers skim on a phone. Never repeat in a bullet what the opening sentence or another bullet already said. In this order:
  * Brand: <the brand>
  * Style: <a specific, descriptive style phrase for this exact item — e.g. 'Oversized color block pullover sweater', not just the raw item type. If the item is commonly searched under other names, add up to 2 genuine synonyms separated by ' / ' (e.g. 'Sweater vest / cardigan vest'). Only real synonyms for THIS item — never unrelated terms or other brands>
  * Size: <the size>
  * Color: <the color, described richly if it's multi-color or patterned>
  * Condition: <the EXACT condition wording given, never altered>
  * Material: <${materialRule}>
  * Measurements: <the measurements given, formatted compactly (e.g. 'Pit to pit 21" · Length 30"'). OMIT this bullet entirely if none were provided — never estimate measurements>
  followed by AT MOST 4 more '* Label: detail' lines (2 is fine; 5 or more is NOT allowed) covering whichever garment-construction attributes are actually ${seen} AND relevant to this specific item type (a sweater and a dress need different attributes) — choose from things like Neckline, Sleeve length, Hem & cuffs, Texture, Closures, Pockets, Lining, Silhouette/fit. Skip any attribute the opening sentence already states; if a bullet would only partly repeat the opening, keep only the NEW information in it. Pick the 4 most useful to a buyer if more are available. Do NOT include country of origin, RN/style numbers, or a 'Label reads...' line — they don't help a buyer.
  then ${finalBullet}
(4) A blank line, then ${closingLineInstruction}.
Do not add anything after that — no styling/pairing suggestion, no keywords line, no hashtags, nothing else. Omit any bullet whose value is unknown rather than writing 'unknown'.

STYLE_TAGS: up to 3 tags ONLY from this exact list (copy the spelling exactly, never invent or alter): ${POSHMARK_STYLE_TAGS.join(', ')}. Pick the 1-3 that best match this item's era/material/silhouette/aesthetic. For clothing, shoes and accessories always pick at least 1.

Be accurate and honest — never invent brand, material, or condition details. Do not use words like "rare", "vintage", or "authentic" unless explicitly supported.`;
}

// The single "✨ Analyze & write listing" call — the model sees up to 5
// photos and returns identification fields, eBay item specifics, a price
// guess, the visual facts it saw, and the listing copy.
export function buildAnalyzeAndWritePrompt({ f, conditionLabel, descLimit, closingLineInstruction, categoryOptions, priceHistory }){
  return `You are an expert secondhand reseller (eBay/Poshmark/Mercari). You have up to 5 photos of ONE item — look at ALL of them, not just the first. Sellers usually include a close-up of the tag/label (brand, size, fabric content, care instructions); if one is legible, read it and use that real information. Never guess anything you can't actually see or read.

In ONE response you will (A) identify the item and record what you can see, then (B) write its listing from those findings.

SELLER-ENTERED DATA (ground truth — never contradict it; if a field below has a value, return that exact value in the matching field):
${buildSellerDataBlock(f, conditionLabel, { forRewrite: false })}

PART A — identification (empty string for anything you can't confirm):
- brand: from the seller data, else from a visible logo/tag.
- color: the single most dominant color — one of ${PRESET_COLORS.join(', ')}, or a more specific color name if none fits.
- clothing_type: for clothing/shoes/bags/accessories, one of ${PRESET_CLOTHING_TYPES.join(', ')}, or a more specific type if none fits. Empty if not clothing/footwear/accessories.
- gender: inferred from cut/styling/tag when confident. Empty if not applicable or not confident.
- size: exactly as shown on a legible tag (e.g. 'M', '32x30', '8.5'). Never guess a size that isn't visible.
- size_type: for clothing, eBay's Size Type — 'Regular' unless the tag or the visible cut clearly says otherwise (Plus, Petite, Tall, Big & Tall, Maternity, Juniors). Empty if not clothing.
- category: a short, specific category. Reuse one of these if it genuinely fits: ${categoryOptions.join(', ')} — otherwise a new concise name (e.g. 'Appliances', 'Board Games').
- ebay_search_term: a short, specific eBay category search term for this exact item (e.g. "women's skirt", 'hardcover book', 'antique table lamp') — not a broad bucket like 'Clothing'.
- visible_flaws: short description of visible wear, stains or damage; empty if none seen.
- material: fiber content EXACTLY as printed on a legible tag (plus care instructions if legible); empty if no tag is legible.
- construction_details: short phrases for every construction detail you can actually see (e.g. 'V-neck', 'Long balloon sleeves', 'Button front', 'Two front patch pockets', 'Ribbed hem and cuffs', 'Fully lined'). Up to 8, never invented. These are saved and reused later to rewrite the listing WITHOUT the photos, so be complete and factual.
- ebay_aspects: eBay item specifics you can CONFIRM from the photos or tag, as {name, value} pairs, using only these names: ${AI_EBAY_ASPECT_NAMES.join(', ')}. Use eBay's usual short wording (e.g. Pattern 'Solid'/'Striped'/'Floral'/'Plaid'; Sleeve Length 'Long Sleeve'/'Short Sleeve'/'Sleeveless'/'3/4 Sleeve'; Neckline 'V-Neck'/'Crew Neck'/'Scoop Neck'/'Turtleneck'/'Collared'; Closure 'Button'/'Zip'/'Pullover'; Fit 'Regular'/'Slim'/'Relaxed'/'Oversized'; Rise 'High'/'Mid'/'Low'; Fabric Type 'Knit'/'Woven'). Material, Outer Shell Material, Lining Material and Country of Manufacture ONLY from a legible tag. Leave out anything you can't confirm and anything that doesn't apply to this item type — an empty list is fine.
- price_low / price_high: a realistic, conservative resale price range in USD for this item in this condition. Past sale averages by category on this account (light context only): ${JSON.stringify(priceHistory)}
- reasoning: 1-2 sentences explaining the price, mentioning the visual cues used.

PART B — the listing (Poshmark-optimized; the same description is also used on eBay). Use the seller data where given, otherwise your Part A findings — the title and description must agree with Part A. Every construction detail must come ONLY from what you can see in the photos.
${buildListingRules({ descLimit, closingLineInstruction, source: 'photos' })}

Return a single JSON object with exactly these keys: brand, color, clothing_type, gender, size, size_type, category, ebay_search_term, visible_flaws, material, construction_details (array of strings), ebay_aspects (array of {name, value}), price_low (number), price_high (number), reasoning, title, description, style_tags (array). No text before or after it.`;
}

// Rewrites only the title/description/tags. With `aiFacts` (saved by an
// earlier ✨ analysis) no photos are sent at all; without them the caller
// sends photos instead and the rules switch to reading them.
export function buildRewritePrompt({ f, conditionLabel, descLimit, closingLineInstruction, aiFacts }){
  const source = aiFacts ? 'facts' : 'photos';
  const factsBlock = aiFacts ? `
VISUAL FACTS recorded from the item's photos by an earlier analysis (you do NOT have the photos — these facts are your only source for construction details):
Material: ${aiFacts.material || '(none recorded — no legible tag)'}
Construction details: ${(aiFacts.construction_details || []).length ? aiFacts.construction_details.join('; ') : '(none recorded)'}
Visible flaws: ${aiFacts.visible_flaws || '(none seen)'}
` : `
You have up to 5 photos of the item — look at ALL of them. If a tag/label is legible, use its real information. Every construction detail must come ONLY from what you can see; never invent one.
`;
  return `You are an expert Poshmark reseller writing an SEO-optimized listing for this item, following Poshmark's own best practices (the same description is also used on eBay).

ITEM DATA (ground truth — never contradict or change it):
${buildSellerDataBlock(f, conditionLabel, { forRewrite: true })}
${factsBlock}
${buildListingRules({ descLimit, closingLineInstruction, source })}

Return a single JSON object with exactly these keys: title, description, style_tags (array). No text before or after it.`;
}
