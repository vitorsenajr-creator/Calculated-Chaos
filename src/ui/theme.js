// App themes (UI layer; v3.21.0). A theme is a set of CSS variables in
// style.css (:root for Parcel, :root[data-theme=...] for the others) plus
// its typeface, loaded only when that theme is in use. The business's
// choice lives in appSettings.theme; the last one applied is remembered on
// this device so the app doesn't flash Parcel before settings load.
import { accentTokens, isHexColor } from '../domain/accent.js';

export const THEMES = [
  { key: 'parcel', label: 'Parcel', note: 'Navy and white, like a shipping label.', swatches: ['#12285A', '#F4F6F9', '#C8102E'] },
  { key: 'tagweek', label: 'Tag Week', note: 'Black with thrift-store tag colors.', swatches: ['#17171B', '#F2F2EF', '#3D8BEA'], font: 'Bricolage+Grotesque:opsz,wght@12..96,400..800' },
  { key: 'concourse', label: 'Concourse', note: 'Black, white and signal yellow.', swatches: ['#111111', '#FFFFFF', '#FFC600'], font: 'Fira+Sans:wght@400;500;600;700;800&family=Fira+Sans+Condensed:wght@700;800' },
];
const LAST_KEY = 'cc.theme';
const ACCENT_KEY = 'cc.accent';
const ACCENT_PROPS = ['--brand-2', '--nav-active'];

export function normalizeTheme(key){
  return THEMES.some(t => t.key === key) ? key : 'parcel';
}

// The theme in use right now; screens with a layout of their own per theme
// (Home, Catalog) read it while rendering.
export function currentTheme(){
  return normalizeTheme(document.documentElement.dataset.theme);
}

// remember: false keeps the choice off this device's "last theme" (the
// Developer Panel applies its admin's theme without changing the app's).
export function applyTheme(key, { remember = true } = {}){
  const theme = THEMES.find(t => t.key === normalizeTheme(key));
  const root = document.documentElement;
  const changed = currentTheme() !== theme.key;
  if (theme.key === 'parcel') delete root.dataset.theme;
  else root.dataset.theme = theme.key;
  if (theme.font && !document.getElementById(`themeFont-${theme.key}`)){
    const link = document.createElement('link');
    link.id = `themeFont-${theme.key}`;
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${theme.font}&display=swap`;
    document.head.appendChild(link);
  }
  // The browser/status bar color follows the theme's shell color.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', getComputedStyle(root).getPropertyValue('--brand').trim() || '#12285A');
  if (remember) {
    try{ localStorage.setItem(LAST_KEY, theme.key); }catch(e){ /* not remembered */ }
  }
  // Screens that draw differently per theme listen for this and redraw.
  if (changed) document.dispatchEvent(new CustomEvent('themechange', { detail: theme.key }));
}

// Called once at startup, before settings arrive.
export function applyLastTheme(){
  let last = 'parcel';
  let accent = '';
  try{
    last = localStorage.getItem(LAST_KEY) || 'parcel';
    accent = localStorage.getItem(ACCENT_KEY) || '';
  }catch(e){ /* default */ }
  applyTheme(last);
  applyAccent(accent);
}

// The business's accent color (v3.22.1), over the theme's own tokens.
// Apply it after applyTheme(): the adjustment depends on the theme's
// colors. An empty or invalid value goes back to the theme default.
// Returns the tokens applied (or null), for Settings to show.
export function applyAccent(hex){
  const root = document.documentElement;
  ACCENT_PROPS.forEach(p => root.style.removeProperty(p));
  delete root.dataset.accent;
  try{
    if (isHexColor(hex)) localStorage.setItem(ACCENT_KEY, hex);
    else localStorage.removeItem(ACCENT_KEY);
  }catch(e){ /* not remembered */ }
  if (!isHexColor(hex)) return null;
  const cs = getComputedStyle(root);
  const read = (name, fallback) => {
    const v = cs.getPropertyValue(name).trim();
    return isHexColor(v) ? v : fallback;
  };
  const tokens = accentTokens(hex, currentTheme(), {
    surface: read('--surface', '#FFFFFF'),
    bg: read('--bg', '#FFFFFF'),
    shell: read('--brand', '#12285A'),
    ink: read('--ink', '#111111'),
    onBrand: read('--on-brand', '#FFFFFF'),
  });
  root.style.setProperty('--brand-2', tokens.brand2);
  root.style.setProperty('--nav-active', tokens.navActive);
  root.dataset.accent = 'custom';
  return tokens;
}
