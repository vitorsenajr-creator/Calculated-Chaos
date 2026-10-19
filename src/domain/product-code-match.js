// Product code lookup by typed digits (domain layer; v3.17.3,
// docs/modularization.md). Moved out of main.js unchanged, except that the
// catalog now comes in as a parameter.

// Product codes are stored like "#0086" (leading '#', zero-padded to 4
// digits, duplicates suffixed "-2"). Typed input from a numeric-only
// field is plain digits with no way to type '#', and may be un-padded
// (e.g. "86" or "136" for "#0086"/"#0136") — compare on digits-only,
// padded to 4, against the item's own digits (suffix stripped) instead
// of a raw string match. Shared by Quick Labels and Stock Transfer so a
// future fix to this matching logic (like v3.13.79's) only has one place
// to happen.
export function findItemByProductCodeDigits(items, code){
  const digits = code.replace(/\D/g, '');
  const norm = digits.padStart(4, '0');
  return items.find(i => {
    const base = (i.productCode || '').replace(/-\d+$/, '');
    return base.replace(/\D/g, '') === norm;
  });
}
