// Catalog completeness/filter logic — pure functions, moved out of
// main.js's IIFE verbatim. filtersActiveCount/applyFilters take
// activeFilters (+ searchQuery) as explicit params instead of closing
// over them; main.js keeps thin wrappers with the original signatures.

export function isIncomplete(item){
  return !(item.photos && item.photos.length > 0) || !item.cost || !item.weight || !item.length || !item.width;
}

export function missingFields(item){
  const missing = [];
  if (!(item.photos && item.photos.length > 0)) missing.push('photos');
  if (!item.cost) missing.push('cost');
  if (!item.weight) missing.push('weight');
  if (!item.length || !item.width) missing.push('dimensions');
  return missing;
}

export function filtersActiveCount(activeFilters){
  let n = 0;
  if (activeFilters.status) n++;
  if (activeFilters.category) n++;
  if (activeFilters.incomplete) n++;
  if (activeFilters.needsPhoto) n++;
  if (activeFilters.box) n++;
  if (activeFilters.notSold) n++;
  if (activeFilters.size) n++;
  if (activeFilters.platformsInclude.length || activeFilters.platformsExclude.length) n++;
  return n;
}

export function applyFilters(list, activeFilters, searchQuery){
  return list.filter(item => {
    if (activeFilters.status && item.status !== activeFilters.status) return false;
    if (activeFilters.notSold && item.status === 'vendido') return false;
    if (activeFilters.category && item.category !== activeFilters.category) return false;
    if (activeFilters.incomplete && !isIncomplete(item)) return false;
    if (activeFilters.needsPhoto && (item.photos && item.photos.length > 0)) return false;
    if (activeFilters.box && item.storageBox !== activeFilters.box) return false;
    if (activeFilters.size && item.size !== activeFilters.size) return false;
    if (activeFilters.platformsInclude.length){
      const onAny = activeFilters.platformsInclude.some(p => (item.listedPlatforms || []).includes(p));
      if (!onAny) return false;
    }
    if (activeFilters.platformsExclude.length){
      const onAnyExcluded = activeFilters.platformsExclude.some(p => (item.listedPlatforms || []).includes(p));
      if (onAnyExcluded) return false;
    }
    if (searchQuery){
      const q = searchQuery.toLowerCase();
      const hay = [item.name, item.brand, item.category, item.clothingType, item.notes, item.productCode, item.storageBox, item.source, item.color].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
