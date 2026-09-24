// Fills eBay's "Type" item specific from the item's own Clothing Type, so
// she doesn't have to type the same thing twice (e.g. Clothing Type
// "T-Shirt" -> eBay Type "T-Shirt"). Shared by the item modal (pre-fills
// the field) and api/ebay-list.js (fills it for bulk/background publishes
// where the modal was never opened).
//
// The authoritative list is eBay's own Taxonomy API
// (get_item_aspects_for_category), which the app already fetches per
// category — there's no public static list, and it differs per category.
// So each Clothing Type maps to an ordered list of candidates:
//   - category HAS an official list  -> first candidate that is literally
//     in it (eBay's exact spelling); none in it -> null (she picks)
//   - category has NO list (free text, e.g. Kids > Girls > Tops) -> the
//     first candidate, which is eBay's most common wording for it
// Jacket/Coat is left out on purpose: main.js's
// CONDITIONAL_ASPECT_SUGGESTIONS already has a finer-grained jacket "Type"
// list (Overshirt/Shacket, Blazer, Bomber…). Shoes/Bag/Accessory/Activewear
// are left out too — "Type" means something category-specific there.

const TYPE_CANDIDATES = {
  't-shirt':   ['T-Shirt', 'Tee', 'Top'],
  'tank top':  ['Tank Top', 'Tank', 'Camisole', 'Cami', 'Top'],
  'blouse':    ['Blouse', 'Top', 'Shirt'],
  'sweater':   ['Sweater', 'Pullover', 'Cardigan'],
  'hoodie':    ['Hoodie', 'Sweatshirt'],
  'jeans':     ['Jeans'],
  'pants':     ['Pants', 'Trousers'],
  'shorts':    ['Shorts'],
  'skirt':     ['Skirt'],
  'dress':     ['Dress'],
  'blazer':    ['Blazer', 'Suit Jacket', 'Jacket'],
  'swimwear':  ['Swimsuit', 'One-Piece Swimsuit', 'Bikini Set'],
};

export const isTypeAspect = (name) => /^type$/i.test(String(name || '').trim());

// Returns the value to use for eBay's "Type", or null when there's no
// confident answer.
export function suggestEbayTypeValue(clothingType, allowedValues){
  const candidates = TYPE_CANDIDATES[String(clothingType || '').trim().toLowerCase()];
  if (!candidates) return null;
  if (Array.isArray(allowedValues) && allowedValues.length){
    for (const c of candidates){
      const hit = allowedValues.find(v => v.toLowerCase() === c.toLowerCase());
      if (hit) return hit;
    }
    return null;
  }
  return candidates[0];
}
