// Catalog completeness/filter logic — pure functions, moved out of
// main.js's IIFE verbatim. filtersActiveCount/applyFilters take
// activeFilters (+ searchQuery) as explicit params instead of closing
// over them; main.js keeps thin wrappers with the original signatures.
// Since v3.22.4 the checks themselves live in domain/item-issues.js and
// follow the business's Warnings settings (`ctx.checks`).
import { isMissingPrice, isStaleListing, isIncomplete, missingFields, hasEbayError, hasDuplicateCode, hasIssues, DEFAULT_ISSUE_CHECKS } from '../domain/item-issues.js';
import { weekTagIndex } from '../domain/week-tags.js';

export { isIncomplete, missingFields };

export function filtersActiveCount(activeFilters){
  let n = 0;
  if (activeFilters.status) n++;
  if (activeFilters.category) n++;
  if (activeFilters.incomplete) n++;
  if (activeFilters.needsPhoto) n++;
  if (activeFilters.box) n++;
  if (activeFilters.notSold) n++;
  if (activeFilters.size) n++;
  if (activeFilters.noPrice) n++;
  if (activeFilters.stale) n++;
  if (activeFilters.issues) n++;
  if (activeFilters.ebayError) n++;
  if (activeFilters.duplicateCode) n++;
  if (activeFilters.imported) n++;
  if (Number.isInteger(activeFilters.weekTag)) n++;
  if (activeFilters.platformsInclude.length || activeFilters.platformsExclude.length) n++;
  return n;
}

// ctx: { checks, counts } — the Warnings settings and codeCounts() of the
// whole catalog (for duplicate codes).
export function applyFilters(list, activeFilters, searchQuery, ctx = {}){
  const checks = ctx.checks || DEFAULT_ISSUE_CHECKS;
  const counts = ctx.counts || new Map();
  const now = Date.now();
  return list.filter(item => {
    if (activeFilters.status && item.status !== activeFilters.status) return false;
    if (activeFilters.notSold && item.status === 'vendido') return false;
    if (activeFilters.category && item.category !== activeFilters.category) return false;
    if (activeFilters.incomplete && !isIncomplete(item, checks)) return false;
    if (activeFilters.needsPhoto && (item.photos && item.photos.length > 0)) return false;
    if (activeFilters.box && item.storageBox !== activeFilters.box) return false;
    if (activeFilters.size && item.size !== activeFilters.size) return false;
    // Set from the Home screen's "Needs attention" rows.
    if (activeFilters.noPrice && !isMissingPrice(item)) return false;
    if (activeFilters.stale && !isStaleListing(item, now, checks)) return false;
    // The Issues chip (v3.22.4) and Home's eBay errors / duplicate codes rows.
    if (activeFilters.issues && !hasIssues(item, { checks, now, counts })) return false;
    if (activeFilters.ebayError && !hasEbayError(item)) return false;
    if (activeFilters.duplicateCode && !hasDuplicateCode(item, counts)) return false;
    // Imported items (v3.23.1): true = any import, a string = that import.
    if (activeFilters.imported && !(activeFilters.imported === true ? item.importId : item.importId === activeFilters.imported)) return false;
    // Tag Week theme: the color-of-the-week dots above the catalog.
    if (Number.isInteger(activeFilters.weekTag) && weekTagIndex(item, now) !== activeFilters.weekTag) return false;
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
      const hay = [item.name, item.brand, item.category, item.clothingType, item.notes, item.productCode, item.storageBox, item.source, item.color, item.legacyCode].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
