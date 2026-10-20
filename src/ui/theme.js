// App themes (UI layer; v3.21.0). A theme is a set of CSS variables in
// style.css (:root for Parcel, :root[data-theme=...] for the others) plus
// its typeface, loaded only when that theme is in use. The business's
// choice lives in appSettings.theme; the last one applied is remembered on
// this device so the app doesn't flash Parcel before settings load.
export const THEMES = [
  { key: 'parcel', label: 'Parcel', note: 'Navy and white, like a shipping label.', swatches: ['#12285A', '#F4F6F9', '#C8102E'] },
  { key: 'tagweek', label: 'Tag Week', note: 'Black with thrift-store tag colors.', swatches: ['#17171B', '#F2F2EF', '#3D8BEA'], font: 'Bricolage+Grotesque:opsz,wght@12..96,400..800' },
  { key: 'concourse', label: 'Concourse', note: 'Black, white and signal yellow.', swatches: ['#111111', '#FFFFFF', '#FFC600'], font: 'Fira+Sans:wght@400;500;600;700;800&family=Fira+Sans+Condensed:wght@700;800' },
];
const LAST_KEY = 'cc.theme';

export function normalizeTheme(key){
  return THEMES.some(t => t.key === key) ? key : 'parcel';
}

// The theme in use right now; screens with a layout of their own per theme
// (Home, Catalog) read it while rendering.
export function currentTheme(){
  return normalizeTheme(document.documentElement.dataset.theme);
}

export function applyTheme(key){
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
  try{ localStorage.setItem(LAST_KEY, theme.key); }catch(e){ /* not remembered */ }
  // Screens that draw differently per theme listen for this and redraw.
  if (changed) document.dispatchEvent(new CustomEvent('themechange', { detail: theme.key }));
}

// Called once at startup, before settings arrive.
export function applyLastTheme(){
  let last = 'parcel';
  try{ last = localStorage.getItem(LAST_KEY) || 'parcel'; }catch(e){ /* default */ }
  applyTheme(last);
}
