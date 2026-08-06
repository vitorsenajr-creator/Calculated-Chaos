// Settings — default shape + pure calculations, moved out of main.js's
// IIFE verbatim. `appSettings` itself stays a mutable variable owned by
// main.js (loadSettings/saveSettings/resetAiCounter reassign/mutate it and
// persist to Firestore) — only the parts that just *read* it move here,
// parameterized like pricing.js/reports.js.

export const DEFAULT_SETTINGS = {
  // 1. Price markup rule
  targetMarginPct: 40,          // minimum net margin % she wants
  minMarkupMultiplier: 1.8,     // cost × this = minimum list price floor

  // 2. Default shipping profile
  defaultCarrier: 'usps_ground', // usps_ground | usps_priority | ups_ground
  sellerPaysShipping: false,     // true = she absorbs shipping, false = buyer pays
  defaultWeightLb: 0.5,         // fallback weight when item has none
  customCarriers: [],           // [{name, basePrice, perLbPrice}] — user-added carriers with their own pricing

  // 3. Auto-prep by category
  autoPrepRules: {
    'Clothing':     'needs_wash',
    'Shoes':        'needs_photo',
    'Accessories':  'needs_photo',
    'Electronics':  'needs_photo',
    'Home & Decor': 'needs_photo',
    'Collectibles': 'needs_photo',
    'Toys':         'needs_photo',
    'Other':        'needs_photo',
  },

  // AI usage counter
  aiUsageCount: 0,
  aiUsageLimit: 500,
  aiUsagePeriodStart: null,   // ISO string of when current period started
  aiResetDayOfMonth: 1,       // day of month to auto-reset (1 = first of month)
  aiScheduledReset: true,     // true = auto-reset monthly, false = manual only

  // Listing description generator — her own standard closing line
  // (shipping policy, bundle offer, thank-you note, whatever she wants)
  // so she never has to type it by hand every time she generates a
  // listing. Shared across platforms (renamed from poshmarkStandardText
  // — see loadSettings() migration).
  listingStandardText: '',

  // Platform management (Settings → Platforms). The 5 built-in platforms
  // (ebay/mercari/poshmark/vinted/depop) keep their fixed keys — eBay
  // especially has real integration logic keyed to that exact string —
  // but their fee % can be overridden here. customPlatforms are entirely
  // her own (key/label/emoji/feePct), addable and removable.
  platformFeeOverrides: {}, // { ebay: 0.15, ... } — overrides PLATFORM_FEES per key
  customPlatforms: [],      // [{ key, label, emoji, feePct }]

  // 4. Thermal label printing (per-item)
  labelWidthIn: 2.25,
  labelHeightIn: 1.25,
  labelFields: {
    box: true,
    name: true,
    category: false,
    brand: false,
  },

  // 5. Wall measurement markers — real-world center-to-center spacing of
  // the 4 printed crosshair targets mounted on the wall, used to calibrate
  // the measurement tool instead of a tape measure in every photo.
  wallMarkerSpacingHIn: 24,
  wallMarkerSpacingVIn: 24,
};

export function aiUsageRemaining(appSettings){
  return Math.max(0, (appSettings.aiUsageLimit || 500) - (appSettings.aiUsageCount || 0));
}

export function aiUsagePct(appSettings){
  return Math.min(100, Math.round(((appSettings.aiUsageCount || 0) / (appSettings.aiUsageLimit || 500)) * 100));
}

// Pure predicate — the caller (main.js's checkScheduledReset) still owns
// actually calling resetAiCounter() and persisting, since that mutates
// the live appSettings object and writes to Firestore.
export function isScheduledResetDue(appSettings){
  if (!appSettings.aiScheduledReset || !appSettings.aiUsagePeriodStart) return false;
  const periodStart = new Date(appSettings.aiUsagePeriodStart);
  const now = new Date();
  const dayOfMonth = appSettings.aiResetDayOfMonth || 1;
  // Check if we've passed a reset day since period started
  const resetDate = new Date(now.getFullYear(), now.getMonth(), dayOfMonth);
  if (resetDate <= periodStart){
    // Reset day hasn't come this month yet, check last month
    return false;
  }
  return resetDate <= now && periodStart < resetDate;
}
