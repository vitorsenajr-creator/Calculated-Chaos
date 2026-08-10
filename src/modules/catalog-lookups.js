// Item-derived lookup lists (storage boxes, sizes, sources, categories,
// colors, clothing types actually used in the catalog) + next product
// code — pure functions over `items`, moved out of main.js's IIFE
// verbatim.
import { PRESET_CATEGORIES, PRESET_COLORS, PRESET_CLOTHING_TYPES, PRESET_SIZES_BY_TYPE } from './constants.js';

export function nextProductCode(items){
  let maxNum = 0;
  items.forEach(i => {
    // Quantity > 1 items are tagged "#4578-2" etc. — strip that duplicate
    // suffix before reading the base number, so a batch of duplicates
    // doesn't corrupt where the main sequence resumes.
    const base = (i.productCode || '').replace(/-\d+$/, '');
    const match = base.match(/(\d+)\s*$/);
    if (match){
      const n = parseInt(match[1], 10);
      if (n > maxNum) maxNum = n;
    }
  });
  return '#' + String(maxNum + 1).padStart(4, '0');
}

export function getAllStorageBoxes(items){
  const boxes = new Set();
  items.forEach(i => { if (i.storageBox && i.storageBox.trim()) boxes.add(i.storageBox.trim()); });
  return Array.from(boxes).sort((a,b)=> a.localeCompare(b, undefined, {numeric:true}));
}

export function getAllSizes(items, clothingType){
  const sizes = new Set();
  items.forEach(i => {
    if (!i.size || !i.size.trim()) return;
    if (clothingType && i.clothingType !== clothingType) return;
    sizes.add(i.size.trim());
  });
  return Array.from(sizes).sort((a,b)=> a.localeCompare(b, undefined, {numeric:true}));
}

// Presets first (in their natural size-run order), then any custom sizes
// she's actually used for this type that aren't already in that list —
// e.g. she types "Petite M" once and it's added to future suggestions
// for that same clothing type, same as colors.
export function getSizeSuggestionsForType(items, clothingType){
  const presets = PRESET_SIZES_BY_TYPE[clothingType] || [];
  const used = getAllSizes(items, clothingType).filter(s => !presets.includes(s));
  return [...presets, ...used];
}

export function getAllSources(items){
  const sources = new Set();
  items.forEach(i => { if (i.source && i.source.trim()) sources.add(i.source.trim()); });
  return Array.from(sources).sort((a,b)=> a.localeCompare(b, undefined, {numeric:true}));
}

export function getAllCategories(items){
  const cats = new Set();
  items.forEach(i => { if (i.category && i.category.trim() && !PRESET_CATEGORIES.includes(i.category.trim())) cats.add(i.category.trim()); });
  return Array.from(cats).sort((a,b)=> a.localeCompare(b, undefined, {numeric:true}));
}

export function getAllColors(items){
  const colors = new Set();
  items.forEach(i => { if (i.color && i.color.trim() && !PRESET_COLORS.includes(i.color.trim())) colors.add(i.color.trim()); });
  return Array.from(colors).sort((a,b)=> a.localeCompare(b, undefined, {numeric:true}));
}

export function getAllClothingTypes(items){
  const types = new Set();
  items.forEach(i => { if (i.clothingType && i.clothingType.trim() && !PRESET_CLOTHING_TYPES.includes(i.clothingType.trim())) types.add(i.clothingType.trim()); });
  return Array.from(types).sort((a,b)=> a.localeCompare(b, undefined, {numeric:true}));
}

// Brand has no preset list (too open-ended to guess) — just every distinct
// value actually typed on a real item. Added for the Live Catalog quick-add
// tool, which needed a brand suggestion list the same way the item form
// already has one for sizes/sources/etc.
export function getAllBrands(items){
  const brands = new Set();
  items.forEach(i => { if (i.brand && i.brand.trim()) brands.add(i.brand.trim()); });
  return Array.from(brands).sort((a,b)=> a.localeCompare(b, undefined, {numeric:true}));
}
