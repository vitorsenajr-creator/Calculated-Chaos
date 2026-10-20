// A business's accent color (v3.22.1, CLAUDE.md backlog item 6): pure
// color math, no DOM. ui/theme.js reads the theme's own colors from the
// page and passes them in; this returns the two tokens the accent drives,
// adjusted so text and icons on them stay readable.
//  - --brand-2: buttons (white text on it), links, the active tab and
//    selections. Needs 4.5:1 against the page's surfaces.
//  - --nav-active: the navigation marker. What sits next to or on it
//    differs per theme (see NAV_RULES).
// Red for urgent and green for profit are separate tokens and never change.

export const ACCENT_PRESETS = [
  { hex: '#1E3A7B', name: 'Navy' },
  { hex: '#1A5FB4', name: 'Blue' },
  { hex: '#0F766E', name: 'Teal' },
  { hex: '#2F7A52', name: 'Green' },
  { hex: '#8A6416', name: 'Gold' },
  { hex: '#C2410C', name: 'Orange' },
  { hex: '#BE185D', name: 'Pink' },
  { hex: '#6D28D9', name: 'Purple' },
];

// Parcel: a bar beside the label on the dark shell (3:1, non-text).
// Tag Week: a pill behind white icons and text (4.5:1 with white).
// Concourse: a block behind black text, like the yellow sign (4.5:1).
const NAV_RULES = {
  parcel: { against: 'shell', min: 3 },
  tagweek: { against: 'onBrand', min: 4.5 },
  concourse: { against: 'ink', min: 4.5 },
};

export function isHexColor(s){
  return typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s);
}

function toRgb(hex){
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function toHex(rgb){
  return '#' + rgb.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
}

// WCAG relative luminance and contrast ratio.
export function luminance(hex){
  const [r, g, b] = toRgb(hex).map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b){
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Moves `color` toward black or white, in small steps, until it has at
// least `min` contrast with every color in `against`. Darkens when the
// colors it must stand out from are light, lightens when they're dark.
export function adjustForContrast(color, against, min){
  const ok = c => against.every(a => contrast(c, a) >= min);
  if (ok(color)) return { color: color.toUpperCase(), adjusted: false };
  const avg = against.reduce((t, a) => t + luminance(a), 0) / against.length;
  const target = avg > 0.18 ? [0, 0, 0] : [255, 255, 255];
  const from = toRgb(color);
  for (let step = 1; step <= 50; step++){
    const t = step / 50;
    const c = toHex(from.map((v, i) => v + (target[i] - v) * t));
    if (ok(c)) return { color: c, adjusted: true };
  }
  return { color: toHex(target), adjusted: true };
}

// The theme's own colors come in as hex: surface, bg, shell (--brand),
// ink and onBrand. Returns null for anything that isn't a #RRGGBB color,
// which means "use the theme's default".
export function accentTokens(accent, theme, colors){
  if (!isHexColor(accent)) return null;
  const brand2 = adjustForContrast(accent, [colors.surface, colors.bg], 4.5);
  const rule = NAV_RULES[theme] || NAV_RULES.parcel;
  const nav = adjustForContrast(accent, [colors[rule.against]], rule.min);
  return {
    brand2: brand2.color,
    navActive: nav.color,
    adjusted: brand2.adjusted || nav.adjusted,
  };
}
