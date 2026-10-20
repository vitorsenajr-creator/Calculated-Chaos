// Catalog sort orders (v3.20.1) — pure, no DOM or app state.

export const CATALOG_SORTS = [
  { key: 'newest', label: 'Newest first' },
  { key: 'oldest', label: 'Oldest first' },
  { key: 'price-high', label: 'Price: high to low' },
  { key: 'price-low', label: 'Price: low to high' },
  { key: 'days-listed', label: 'Listed longest' },
];

function price(item){
  const p = parseFloat(item.listPrice);
  return p > 0 ? p : null;
}

// Returns a new array; the input is left as is. Items without a price sort
// after priced ones in both price orders, and items that aren't listed
// sort after listed ones in "Listed longest" (only eBay stamps a listing
// date, so other platforms fall back to when the item was cataloged).
export function sortCatalog(list, sort){
  const out = [...list];
  const byNewest = (a, b) => (b.createdAt || 0) - (a.createdAt || 0);
  if (sort === 'oldest') return out.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  if (sort === 'price-high' || sort === 'price-low'){
    const dir = sort === 'price-high' ? -1 : 1;
    return out.sort((a, b) => {
      const pa = price(a), pb = price(b);
      if (pa === null && pb === null) return byNewest(a, b);
      if (pa === null) return 1;
      if (pb === null) return -1;
      return (pa - pb) * dir || byNewest(a, b);
    });
  }
  if (sort === 'days-listed'){
    const listedSince = i => i.status === 'anunciado' ? (i.ebayListedAt || i.createdAt || 0) : null;
    return out.sort((a, b) => {
      const la = listedSince(a), lb = listedSince(b);
      if (la === null && lb === null) return byNewest(a, b);
      if (la === null) return 1;
      if (lb === null) return -1;
      return la - lb;
    });
  }
  return out.sort(byNewest);
}
