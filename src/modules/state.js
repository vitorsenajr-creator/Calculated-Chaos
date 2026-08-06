// Shared app state — the catalog (`items`) and `appSettings` — imported
// directly by both main.js and ebay-api.js, instead of ebay-api.js only
// ever reaching them through main.js's one-directional `app` bridge
// object. ES module imports are live bindings (re-exported reads always
// see the current value), but they're read-only from the importing side —
// so a *whole-value* replacement (a fresh array from Firestore, a fresh
// settings object) has to go through setItems/setAppSettings here. Mutating
// an existing array element or object property in place (`items[i] = x`,
// `appSettings.foo = x`) needs no setter — that's a write to the object
// itself, not a reassignment of the binding, and works from any importer.
export let items = [];
export function setItems(newItems){ items = newItems; }

export let appSettings = {};
export function setAppSettings(newSettings){ appSettings = newSettings; }
