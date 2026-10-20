// Storage boxes for the Stock screen (v3.20.1) — pure, no DOM or app state.

// Every box name in use: the registered boxes (Settings has always kept
// them in appSettings.storageBoxes) plus any name only ever typed into an
// item's Storage box field. Each row counts the unsold items in it; sold
// items left the shelf.
export function summarizeBoxes(items, registeredBoxes = []){
  const rows = new Map();
  registeredBoxes.forEach((b, index) => {
    rows.set(b.name, { name: b.name, registeredIndex: index, createdAt: b.createdAt || null, inStock: 0 });
  });
  items.forEach(i => {
    // The exact stored name, so the count matches the catalog's box filter.
    const name = i.storageBox;
    if (!name || !String(name).trim()) return;
    if (!rows.has(name)) rows.set(name, { name, registeredIndex: null, createdAt: null, inStock: 0 });
    if (i.status !== 'vendido') rows.get(name).inStock += 1;
  });
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}
