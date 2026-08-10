// /api/ebay-list.js — eBay listing publisher
// Creates or updates a listing on eBay using the Inventory + Offer APIs (modern approach)
// POST body: { access_token, item, refresh_token }

import { estimateShipping } from '../src/modules/pricing.js';

const EBAY_SANDBOX = process.env.EBAY_SANDBOX === 'true';

const API_BASE = EBAY_SANDBOX
  ? 'https://api.sandbox.ebay.com'
  : 'https://api.ebay.com';

// eBay condition ENUM values (the modern Inventory API expects strings like
// "NEW_WITH_TAGS", not the old numeric condition IDs from the Trading API).
// IMPORTANT: PRE_OWNED_EXCELLENT / PRE_OWNED_GOOD / PRE_OWNED_FAIR are
// apparel-category-ONLY enum values — eBay rejects them with a generic
// "Could not serialize field [condition]" error in any non-apparel category
// (e.g. Shoes, Accessories can sometimes resolve outside the apparel branch).
// USED_EXCELLENT / USED_VERY_GOOD / USED_ACCEPTABLE are the universal
// equivalents that work across every category, so we use those instead.
const CONDITION_ID_MAP = {
  novo_etiqueta:    'NEW',        // Condition ID 1000 — universal "brand new"
  novo_sem_etiqueta:'NEW_OTHER',  // Condition ID 1500 — universal "new, no tags/packaging"
  excelente:        'USED_EXCELLENT',   // Condition ID 3000
  bom:              'USED_VERY_GOOD',   // Condition ID 4000
  aceitavel:        'USED_ACCEPTABLE',  // Condition ID 5000
  defeito:          'FOR_PARTS_OR_NOT_WORKING', // Condition ID 7000
};

// eBay marketplace/country config
const MARKETPLACE_ID = 'EBAY_US';
const CURRENCY = 'USD';

// Maps our app categories to eBay category IDs (top-level, works for most items)
// These are eBay US category IDs — she can override per item
const CATEGORY_ID_MAP = {
  'Clothing':       '11450',  // Clothing, Shoes & Accessories
  'Shoes':          '63889',  // Women's Shoes (default; adjust per item)
  'Accessories':    '4250',   // Clothing, Shoes > Accessories
  'Electronics':    '293',    // Consumer Electronics
  'Home & Decor':   '11700',  // Home & Garden
  'Collectibles':   '1',      // Collectibles & Art
  'Toys':           '220',    // Toys & Hobbies
  'Books':          '267',    // Books & Magazines (fallback only — always prefer item.ebayCategoryId from the category search)
  'Other':          '99',     // Everything Else
};

async function ebayRequest(method, path, accessToken, body){
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Content-Language': 'en-US',
      'Accept-Language': 'en-US',
      'X-EBAY-C-MARKETPLACE-ID': MARKETPLACE_ID,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try{ data = JSON.parse(text); }catch(e){ data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

// eBay requires a "leaf" category (one with no subcategories) for publishing —
// the IDs in CATEGORY_ID_MAP above are broad parent categories, which eBay
// rejects at publish time with "not a leaf category". Rather than guess at
// specific leaf IDs (which vary by gender/type and change over time), we walk
// the real category tree at request time and pick the first available leaf
// under our chosen parent. Note: eBay's getCategorySuggestions endpoint is
// NOT reliable in Sandbox (returns placeholder data), so we deliberately use
// getCategorySubtree instead, which reflects the real tree in both environments.
const CATEGORY_TREE_ID = '0'; // eBay's default/shared tree ID for EBAY_US
const leafCategoryCache = {};

function findFirstLeaf(node){
  if (!node) return null;
  const children = node.childCategoryTreeNodes || [];
  if (children.length === 0){
    return node.category?.categoryId || null;
  }
  for (const child of children){
    const leaf = findFirstLeaf(child);
    if (leaf) return leaf;
  }
  return null;
}

// Collects every leaf category under a subtree node, along with its full
// ancestor path (e.g. "Clothing, Shoes & Accessories > Women's Clothing >
// Tops"). The path matters because gender/type info (like "Women's") usually
// lives on a PARENT node, not the leaf itself — matching only the leaf name
// would miss that context entirely.
function collectAllLeaves(node, pathSoFar, acc){
  if (!node) return acc;
  const name = node.category?.categoryName || '';
  const path = pathSoFar ? `${pathSoFar} > ${name}` : name;
  const children = node.childCategoryTreeNodes || [];
  if (children.length === 0){
    if (node.category?.categoryId){
      acc.push({ id: node.category.categoryId, name, path });
    }
    return acc;
  }
  for (const child of children) collectAllLeaves(child, path, acc);
  return acc;
}

// Picks the leaf category whose full ancestor path best matches the item's
// gender + name + category keywords (simple word-overlap scoring against the
// WHOLE path, not just the leaf's own name). Falls back to the first leaf if
// nothing scores above zero, so we always return something valid.
function pickBestLeaf(leaves, keywords){
  if (!leaves.length) return null;
  const kwSet = keywords
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  let best = leaves[0];
  let bestScore = -1;
  for (const leaf of leaves){
    const pathWords = leaf.path.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    let score = 0;
    for (const kw of kwSet){
      if (pathWords.includes(kw)) score += 1;
    }
    if (score > bestScore){
      bestScore = score;
      best = leaf;
    }
  }
  return best;
}

// The app's broad categories (Clothing/Shoes/Accessories) all live under the
// SAME giant eBay parent (11450 = "Clothing, Shoes & Accessories"), which
// means a naive keyword search across that whole subtree can easily match a
// shoe or jewelry leaf for a top/blouse. These include/exclude filters keep
// scoring within the right branch before we even start comparing keywords.
const CATEGORY_BRANCH_FILTERS = {
  'Clothing':    { include: [], exclude: ['shoes', 'boots', 'sandals', 'sneakers', 'footwear', 'heels', 'slippers', 'jewelry', 'watches', 'handbags', 'accessories'] },
  'Shoes':       { include: ['shoes'],    exclude: [] },
  'Accessories': { include: [],           exclude: ['clothing', 'shoes'] },
};

function filterLeavesByBranch(leaves, appCategory){
  const filter = CATEGORY_BRANCH_FILTERS[appCategory];
  if (!filter) return leaves;
  // IMPORTANT: every leaf's path starts with the same root node
  // ("Clothing, Shoes & Accessories"), which literally contains BOTH the
  // words "clothing" and "shoes". Matching against the whole path string
  // made include/exclude both true for every single leaf, silently
  // defeating the filter entirely. We now split the path into its segments
  // and drop the root segment before checking, so only the real branch
  // names (e.g. "Women", "Women's Shoes", "Blouses") are considered.
  const segmentsOf = (path) => path.split('>').map(s => s.trim().toLowerCase()).slice(1);
  const hasWord = (segments, word) => segments.some(seg => seg.includes(word));
  const filtered = leaves.filter(leaf => {
    const segments = segmentsOf(leaf.path);
    if (filter.include.length && !filter.include.some(w => hasWord(segments, w))) return false;
    if (filter.exclude.some(w => hasWord(segments, w))) return false;
    return true;
  });
  // If filtering wiped out everything (e.g. branch names didn't match what we
  // expected), fall back to the unfiltered list rather than returning nothing.
  return filtered.length ? filtered : leaves;
}

async function resolveLeafCategoryId(parentCategoryId, accessToken, matchKeywords, appCategory){
  const cacheKey = `${parentCategoryId}::${matchKeywords}::${appCategory}`;
  if (leafCategoryCache[cacheKey]) return leafCategoryCache[cacheKey];
  try{
    const result = await ebayRequest(
      'GET',
      `/commerce/taxonomy/v1/category_tree/${CATEGORY_TREE_ID}/get_category_subtree?category_id=${parentCategoryId}`,
      accessToken
    );
    if (result.ok && result.data?.categorySubtreeNode){
      const allLeaves = collectAllLeaves(result.data.categorySubtreeNode, '', []);
      const leaves = filterLeavesByBranch(allLeaves, appCategory);
      const chosenLeaf = pickBestLeaf(leaves, matchKeywords || '');
      const chosen = chosenLeaf
        ? { id: chosenLeaf.id, path: chosenLeaf.path }
        : { id: findFirstLeaf(result.data.categorySubtreeNode), path: '(fallback: first leaf found, no path tracked)' };
      if (chosen.id){
        leafCategoryCache[cacheKey] = chosen;
        return chosen;
      }
    }
  }catch(e){
    console.error('Category tree lookup failed, falling back to parent ID:', e);
  }
  // Fallback: if the lookup fails for any reason, use the parent ID as-is —
  // it may still fail at publish time, but at least inventory/offer steps proceed.
  return { id: parentCategoryId, path: '(fallback: category tree lookup failed entirely)' };
}

const requiredAspectsCache = {};

// Asks eBay directly which item specifics (aspects) are REQUIRED for a given
// leaf category — instead of discovering them one-by-one through trial and
// error. Note: eBay's aspectUsage field always shows "RECOMMENDED" even for
// hard-required aspects, so aspectConstraint.aspectRequired is the field that
// actually tells the truth (per eBay's own documentation).
async function getRequiredAspects(leafCategoryId, accessToken){
  if (requiredAspectsCache[leafCategoryId]) return requiredAspectsCache[leafCategoryId];
  try{
    const result = await ebayRequest(
      'GET',
      `/commerce/taxonomy/v1/category_tree/${CATEGORY_TREE_ID}/get_item_aspects_for_category?category_id=${leafCategoryId}`,
      accessToken
    );
    if (result.ok && Array.isArray(result.data?.aspects)){
      const required = result.data.aspects
        .filter(a => a.aspectConstraint?.aspectRequired)
        .map(a => ({
          name: a.localizedAspectName,
          // First allowed value, if eBay restricts this aspect to a fixed list —
          // used as a safe default when we have no better data for it.
          firstAllowedValue: a.aspectValues?.[0]?.localizedValue || null,
          selectionOnly: a.aspectConstraint?.aspectMode === 'SELECTION_ONLY',
        }));
      requiredAspectsCache[leafCategoryId] = required;
      return required;
    }
  }catch(e){
    console.error('Required aspects lookup failed:', e);
  }
  return [];
}

const validConditionsCache = {};

// eBay's condition IDs are numeric and mean the same thing in every
// category (this mapping is fixed/global); what differs PER CATEGORY is
// only which of these IDs are allowed. The earlier version of this file
// tried to derive the enum name from the human-readable description text
// (e.g. "New with tags" -> "NEW_WITH_TAGS"), but that string never matches
// a real enum name, so it silently always fell through to the wrong
// fallback. Using the actual numeric conditionId fixes that for good.
const CONDITION_ID_TO_ENUM = {
  '1000': 'NEW',
  '1500': 'NEW_OTHER',
  '1750': 'NEW_WITH_DEFECTS',
  '2000': 'MANUFACTURER_REFURBISHED',
  '2010': 'CERTIFIED_REFURBISHED',
  '2020': 'EXCELLENT_REFURBISHED',
  '2030': 'VERY_GOOD_REFURBISHED',
  '2500': 'SELLER_REFURBISHED',
  '2750': 'LIKE_NEW',
  '3000': 'USED_EXCELLENT',
  '4000': 'USED_VERY_GOOD',
  '5000': 'USED_GOOD',
  '6000': 'USED_ACCEPTABLE',
  '7000': 'FOR_PARTS_OR_NOT_WORKING',
};

// Asks eBay directly which condition IDs are accepted for a given leaf
// category. This is what error 25021 is about: the Inventory API rejects a
// condition value that isn't in this category-specific list, and clothing's
// list (USED_EXCELLENT, etc.) is NOT the same list every other category
// accepts (books, electronics, collectibles all differ).
//
// IMPORTANT: this lives in the Metadata API, NOT the Taxonomy API — an
// earlier version of this code called
// /commerce/taxonomy/v1/category_tree/.../get_item_condition_policies,
// which is the wrong path entirely (getItemConditionPolicies is a
// Metadata API method: /sell/metadata/v1/marketplace/{id}/...). That wrong
// path silently failed every time, which is why the fix never actually ran.
async function getValidConditionsForCategory(leafCategoryId, accessToken){
  if (validConditionsCache[leafCategoryId]) return validConditionsCache[leafCategoryId];
  try{
    const result = await ebayRequest(
      'GET',
      `/sell/metadata/v1/marketplace/${MARKETPLACE_ID}/get_item_condition_policies?filter=categoryIds:{${leafCategoryId}}`,
      accessToken
    );
    if (result.ok){
      const policy = (result.data?.itemConditionPolicies || [])[0] || {};
      const rawConditions = policy.itemConditions || [];
      const conditions = rawConditions
        .map(c => CONDITION_ID_TO_ENUM[String(c.conditionId)])
        .filter(Boolean);
      if (conditions.length){
        validConditionsCache[leafCategoryId] = conditions;
        return conditions;
      }
      // Couldn't map any of them — log the raw shape so next time we don't
      // have to guess again.
      console.error('Unmapped condition policy response for category', leafCategoryId, JSON.stringify(rawConditions));
    } else {
      console.error('Condition policy request not ok:', result.status, JSON.stringify(result.data));
    }
  }catch(e){
    console.error('Condition policy lookup failed:', e);
  }
  return null; // null = unknown, buildInventoryItem falls back to the universal map
}

// eBay's Taxonomy API (get_item_aspects_for_category, used by
// getRequiredAspects above) doesn't always agree with what the Inventory
// API actually enforces at publish time — a category can reject a listing
// for a missing item specific that the Taxonomy API never flagged as
// required (seen for "Type" on a Dresses listing even though
// aspectConstraint.aspectRequired was false for it). Rather than special-
// case every category/aspect combination eBay is inconsistent about, this
// parses that exact error shape ("The item specific X is missing.") and
// hands back just the field name X, so the caller can fill it and retry.
function extractMissingAspectName(errorData){
  const err = Array.isArray(errorData) ? errorData[0] : errorData?.errors?.[0];
  if (!err) return null;
  const msg = err.message || err.longMessage || '';
  const m = msg.match(/item specific ["“]?([^"”.]+?)["”]?\s+is missing/i);
  return m ? m[1].trim() : null;
}

// Fills in any required aspect that our own data doesn't already cover, using
// eBay's own suggested first value as a safe, always-valid placeholder. This
// means we ask eBay upfront what's needed instead of reacting to errors one
// field at a time.
function fillMissingRequiredAspects(aspects, requiredAspects){
  for (const req of requiredAspects){
    if (aspects[req.name]) continue; // already set by our own mapping
    if (req.selectionOnly && req.firstAllowedValue){
      aspects[req.name] = [req.firstAllowedValue];
    } else {
      // Free-text required field with nothing to go on — eBay generally
      // accepts this exact phrase for "we don't know" on identifier-style fields.
      aspects[req.name] = ['Does not apply'];
    }
  }
  return aspects;
}

// Maps our app's Gender field to eBay's "Department" item specific, which is
// required by eBay for most Clothing/Shoes/Accessories categories. Falls back
// to "Unisex Adult" when no gender is set, since eBay rejects a missing value
// entirely but is fine with a generic one.
const DEPARTMENT_MAP = {
  "Women's": 'Women',
  "Men's": 'Men',
  "Girls'": 'Girls',
  "Boys'": 'Boys',
  'Unisex': 'Unisex Adult',
};

// Ranked preference of eBay condition enums per app condition, best match
// first. Used when we know (via ebay-condition-policies) which enums the
// item's specific category actually accepts, so we never send one it
// doesn't — that mismatch is what error 25021 comes from.
const CONDITION_PREFERENCE = {
  novo_etiqueta:     ['NEW', 'NEW_WITH_TAGS', 'NEW_OTHER', 'LIKE_NEW'],
  novo_sem_etiqueta: ['NEW_OTHER', 'NEW_WITHOUT_TAGS', 'LIKE_NEW', 'NEW'],
  excelente:         ['USED_EXCELLENT', 'LIKE_NEW', 'VERY_GOOD', 'USED_VERY_GOOD', 'GOOD'],
  bom:               ['USED_VERY_GOOD', 'VERY_GOOD', 'GOOD', 'USED_GOOD', 'USED_EXCELLENT'],
  aceitavel:         ['USED_ACCEPTABLE', 'ACCEPTABLE', 'GOOD', 'USED_GOOD'],
  defeito:           ['FOR_PARTS_OR_NOT_WORKING', 'FOR_PARTS', 'ACCEPTABLE', 'USED_ACCEPTABLE'],
};

// Picks the best condition enum for THIS item's category. If we have the
// category's real valid-conditions list (fetched when the category was
// chosen), pick the closest match from that list. Otherwise fall back to
// the old universal map (works for clothing, may fail elsewhere — but
// that's no worse than before).
function resolveCondition(item){
  const validList = Array.isArray(item.ebayValidConditions) ? item.ebayValidConditions : null;
  if (validList && validList.length){
    const preferred = CONDITION_PREFERENCE[item.condition] || [];
    for (const candidate of preferred){
      if (validList.includes(candidate)) return candidate;
    }
    // None of our preferred names matched exactly — better to use whatever
    // this category DOES accept than to fail the publish entirely.
    return validList[0];
  }
  return CONDITION_ID_MAP[item.condition] || 'USED_VERY_GOOD';
}

function buildInventoryItem(item, extraRequiredAspects, imageUrls){
  // Compress photos: eBay accepts up to 12 image URLs, but we're using base64 data URLs
  // eBay requires hosted URLs — we send a placeholder note about this in the description
  // (In production, photos should be hosted; for now we include all available from item.photos)
  const condition = resolveCondition(item);
  const conditionDescription = {
    novo_etiqueta:     'New with tags. Never worn or used.',
    novo_sem_etiqueta: 'New without tags. Never worn or used.',
    excelente:         'Excellent pre-owned condition. No rips/stains/major flaws.',
    bom:               'Good pre-owned condition. Normal signs of wear.',
    aceitavel:         'Fair condition. Priced accordingly. See photos for details.',
    defeito:           'Sold as-is. For parts or repair. See photos for full details.',
  }[item.condition] || 'Pre-owned. See photos for condition details.';

  const aspects = {};
  if (['Clothing', 'Shoes', 'Accessories'].includes(item.category)){
    aspects.Department = [DEPARTMENT_MAP[item.gender] || 'Unisex Adult'];
  }
  if (item.brand) aspects.Brand = [item.brand];
  if (item.color) aspects.Color = [item.color];
  if (item.size) aspects.Size = [item.size];

  // Real answers she filled in at cataloging time for whatever this category
  // requires beyond the above (Pattern, Material, "Vintage?", etc. — see
  // /api/ebay-item-aspects.js and the "eBay Item Specifics" form section).
  if (item.ebayAspects){
    for (const [name, value] of Object.entries(item.ebayAspects)){
      if (value) aspects[name] = [value];
    }
  }

  // Last-resort safety net: fill in anything eBay still says is required for
  // this exact leaf category that neither the mapping above nor her own
  // answers covered — better than a failed publish, but should rarely fire
  // now that the cataloging form asks for these directly.
  if (extraRequiredAspects) fillMissingRequiredAspects(aspects, extraRequiredAspects);

  // eBay rejects the inventory item outright (errorId 25020) without a
  // valid package weight — same fallback defaults already used by
  // estimateShipping() (modules/pricing.js) for her own shipping-cost math,
  // so a never-measured item still gets a sane, non-zero value instead of
  // failing to publish at all.
  const weight = parseFloat(item.weight) || 0.5;
  const length = parseFloat(item.length) || 10;
  const width = parseFloat(item.width) || 8;
  const height = parseFloat(item.height) || 2;

  return {
    availability: {
      shipToLocationAvailability: {
        quantity: 1,
      },
    },
    condition: condition,
    conditionDescription,
    packageWeightAndSize: {
      weight: { value: weight, unit: 'POUND' },
      dimensions: { length, width, height, unit: 'INCH' },
    },
    product: {
      title: buildTitle(item),
      description: buildDescription(item),
      aspects,
      // Now that photos are hosted (Firebase Storage — see index.html
      // ensureHostedPhotoUrls), we can pass real https:// URLs here. eBay
      // accepts up to 12 images per listing.
      ...(imageUrls && imageUrls.length ? { imageUrls: imageUrls.slice(0, 12) } : {}),
    },
  };
}

function buildTitle(item){
  // eBay title max: 80 chars
  const name = item.name || 'Item';
  // Only prepend the brand if it isn't already part of the name (she now
  // catalogs items with the brand already typed in) — mirrors the same
  // fix in buildEbayTitle (src/ebay-api.js), which only controls the
  // pre-publish preview text, not what's actually sent here.
  const brand = item.brand || '';
  const brandAlreadyInName = brand && name.toLowerCase().includes(brand.toLowerCase());
  const parts = [
    brandAlreadyInName ? '' : brand,
    name,
    item.condition === 'novo_etiqueta' ? 'NWT' : '',
  ].filter(Boolean).join(' ');
  return parts.slice(0, 80);
}

function escapeHtmlServer(s){
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// eBay renders the description as real HTML — plain text with \n line
// breaks just collapses into one run-on paragraph on the actual listing
// page (this is what she saw). The Poshmark generator's output (both the
// instant-template and AI versions) is structured as blocks separated by
// blank lines, where a block is either a plain sentence/paragraph, a
// single short label line (e.g. "Details:"), or a run of "* " bullet
// lines — this turns that structure into actual <p>/<ul><li> HTML instead
// of sending the raw text as-is.
function formatDescriptionHtml(text){
  const blocks = text.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  return blocks.map(block => {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    const isBulletList = lines.length > 0 && lines.every(l => l.startsWith('* '));
    if (isBulletList){
      return `<ul>${lines.map(l => `<li>${escapeHtmlServer(l.slice(2))}</li>`).join('')}</ul>`;
    }
    if (lines.length === 1 && lines[0].endsWith(':')){
      // Short section label on its own (e.g. "Details:", "Keywords:")
      return `<p><b>${escapeHtmlServer(lines[0])}</b></p>`;
    }
    return `<p>${lines.map(l => escapeHtmlServer(l)).join('<br>')}</p>`;
  }).join('\n');
}

// Reuses the same description she already generated/reviewed for Poshmark
// (saved on the item — see src/main.js's save handler) instead of building
// a separate one here. The old version of this function pulled
// item.length/width/height/weight into the text, which are SHIPPING
// PACKAGE dimensions, not garment measurements — that bug is why past
// listings read as disconnected nonsense. The frontend already blocks
// publishing an item with no saved Poshmark description (see
// publishItemToEbayCore in src/ebay-api.js), so this should never actually
// hit the fallback below in normal use.
function buildDescription(item){
  if (item.listingDescription) return formatDescriptionHtml(item.listingDescription);
  return `<p>${escapeHtmlServer(item.name || 'Item for sale')}</p>`;
}

export default async function handler(req, res){
  if (req.method !== 'POST'){
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { access_token, item, imageUrls } = req.body || {};

  if (!access_token){ return res.status(400).json({ error: 'Missing access_token' }); }
  if (!item){ return res.status(400).json({ error: 'Missing item data' }); }
  if (!item.listPrice){ return res.status(400).json({ error: 'Item must have a listing price before publishing to eBay.' }); }

  const sku = item.productCode || item.id;
  const encodedSku = encodeURIComponent(sku);

  try{
    // Step 0: Resolve the real leaf category and its required aspects UPFRONT,
    // so we can send a complete, correct inventory item on the first try
    // instead of discovering missing fields one publish-attempt at a time.
    //
    // If the item already has a category explicitly chosen and confirmed at
    // cataloging time (item.ebayCategoryId, set via the category search UI),
    // ALWAYS use that directly and skip the keyword-matching guesswork
    // entirely. This is the authoritative source once it exists — the
    // fuzzy matcher below is only a fallback for older items that were
    // catalogued before this field existed.
    let leafCategoryId;
    let leafCategory;
    if (item.ebayCategoryId){
      leafCategoryId = item.ebayCategoryId;
      leafCategory = { id: item.ebayCategoryId, path: item.ebayCategoryPath || '(chosen manually, no path stored)' };
    } else {
      const parentCategoryId = CATEGORY_ID_MAP[item.category] || '99';
      const matchKeywords = [item.gender, item.name, item.category].filter(Boolean).join(' ');
      leafCategory = await resolveLeafCategoryId(parentCategoryId, access_token, matchKeywords, item.category);
      leafCategoryId = leafCategory.id;
    }
    const requiredAspects = await getRequiredAspects(leafCategoryId, access_token);

    // Fetch the REAL valid condition values for this exact category, fresh,
    // straight from eBay — every time. We don't rely on whatever the client
    // cached on the item (that cache can be stale or simply missing for
    // items catalogued/edited before this existed), so this always reflects
    // the truth for the category we're about to publish to.
    const validConditions = await getValidConditionsForCategory(leafCategoryId, access_token);
    const itemForBuild = { ...item, ebayValidConditions: validConditions };

    // Step 1: Create or update inventory item
    let inventoryBody = buildInventoryItem(itemForBuild, requiredAspects, imageUrls);
    let invResult = await ebayRequest('PUT', `/sell/inventory/v1/inventory_item/${encodedSku}`, access_token, inventoryBody);

    // Retry with whatever specific item-specific eBay says is missing, up to
    // a few times — see extractMissingAspectName's comment for why this is
    // needed instead of a fixed per-category field list.
    let missingAspectRetries = 0;
    while (!invResult.ok && invResult.status !== 204 && missingAspectRetries < 3){
      const missingName = extractMissingAspectName(invResult.data);
      if (!missingName) break;
      itemForBuild.ebayAspects = { ...(itemForBuild.ebayAspects || {}), [missingName]: 'Does not apply' };
      inventoryBody = buildInventoryItem(itemForBuild, requiredAspects, imageUrls);
      invResult = await ebayRequest('PUT', `/sell/inventory/v1/inventory_item/${encodedSku}`, access_token, inventoryBody);
      missingAspectRetries++;
    }

    if (!invResult.ok && invResult.status !== 204){
      console.error('Inventory item error:', invResult.data);
      return res.status(500).json({
        error: 'Failed to create eBay inventory item',
        detail: invResult.data,
        step: 'inventory',
        debugConditionSent: inventoryBody.condition,
        debugItemConditionRaw: item.condition,
        debugValidConditionsForCategory: validConditions,
        debugFullInventoryBody: inventoryBody,
        debugCategoryChosen: { id: leafCategoryId, path: leafCategory.path },
      });
    }

    // Step 2: Create or update offer
    // Check if offer already exists for this SKU
    const existingOffers = await ebayRequest('GET', `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&marketplace_id=${MARKETPLACE_ID}`, access_token);

    let offerId = null;
    if (existingOffers.ok && existingOffers.data.offers && existingOffers.data.offers.length > 0){
      offerId = existingOffers.data.offers[0].offerId;
    }

    // Which of the two fulfillment policies (see api/ebay-setup.js) this
    // listing uses depends on the per-item "Buyer pays / I pay" choice made
    // at cataloging time (item.freeShipping) — previously EVERY listing
    // silently used the free-shipping policy regardless of this field, since
    // only one policy existed. When the buyer pays, we also override the
    // policy's placeholder shipping cost with this item's real estimate
    // (same estimateShipping() formula used for her own profit math), so the
    // number a buyer actually sees matches what she's accounting for.
    const sellerPaysShipping = item.freeShipping === true;
    const fulfillmentPolicyId = sellerPaysShipping
      ? (process.env.EBAY_FULFILLMENT_POLICY_ID || '')
      : (process.env.EBAY_FULFILLMENT_POLICY_ID_BUYER_PAYS || '');

    const listingPolicies = {
      // These policy IDs must be set up in her eBay seller account
      // They'll be configured when we do the production setup
      // For Sandbox testing, eBay provides default policy IDs
      fulfillmentPolicyId,
      paymentPolicyId: process.env.EBAY_PAYMENT_POLICY_ID || '',
      returnPolicyId: process.env.EBAY_RETURN_POLICY_ID || '',
    };
    if (!sellerPaysShipping){
      const { options } = estimateShipping({}, item);
      const shipCost = (options.find(o => o.carrier === 'USPS Priority Mail') || options[0] || { price: 8 }).price;
      listingPolicies.shippingCostOverrides = [{
        priority: 1,
        shippingCost: { value: shipCost.toFixed(2), currency: CURRENCY },
        shippingServiceType: 'DOMESTIC',
      }];
    }

    const offerBody = {
      sku,
      marketplaceId: MARKETPLACE_ID,
      format: 'FIXED_PRICE',
      availableQuantity: 1,
      categoryId: leafCategoryId,
      listingDescription: buildDescription(item),
      pricingSummary: {
        price: {
          value: parseFloat(item.listPrice).toFixed(2),
          currency: CURRENCY,
        },
      },
      listingPolicies,
      merchantLocationKey: process.env.EBAY_MERCHANT_LOCATION_KEY || 'default',
    };

    let offerResult;
    if (offerId){
      // Update existing offer
      offerResult = await ebayRequest('PUT', `/sell/inventory/v1/offer/${offerId}`, access_token, offerBody);
    }else{
      // Create new offer
      offerResult = await ebayRequest('POST', '/sell/inventory/v1/offer', access_token, offerBody);
      if (offerResult.ok) offerId = offerResult.data.offerId;
    }

    if (!offerResult.ok){
      console.error('Offer error:', offerResult.data);
      return res.status(500).json({
        error: 'Failed to create eBay offer',
        detail: offerResult.data,
        step: 'offer',
        debugPolicyIdsSent: {
          fulfillmentPolicyId: fulfillmentPolicyId || '(empty)',
          sellerPaysShipping,
          paymentPolicyId: process.env.EBAY_PAYMENT_POLICY_ID || '(empty)',
          returnPolicyId: process.env.EBAY_RETURN_POLICY_ID || '(empty)',
          merchantLocationKey: process.env.EBAY_MERCHANT_LOCATION_KEY || '(empty)',
          sandboxMode: EBAY_SANDBOX,
        },
      });
    }

    // Step 3: Publish the offer (makes it live on eBay)
    const publishResult = await ebayRequest('POST', `/sell/inventory/v1/offer/${offerId}/publish`, access_token);

    if (!publishResult.ok){
      console.error('Publish error:', publishResult.data);
      return res.status(500).json({
        error: 'Failed to publish eBay listing',
        detail: publishResult.data,
        step: 'publish',
      });
    }

    const listingId = publishResult.data.listingId;
    const listingUrl = EBAY_SANDBOX
      ? `https://www.sandbox.ebay.com/itm/${listingId}`
      : `https://www.ebay.com/itm/${listingId}`;

    return res.status(200).json({
      success: true,
      listingId,
      listingUrl,
      offerId,
      sku,
      categoryIdUsed: leafCategoryId,
      categoryPathUsed: leafCategory.path,
      aspectsUsed: inventoryBody.product.aspects,
    });

  }catch(err){
    console.error('eBay listing error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
}
