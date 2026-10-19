# Live Catalog (added v3.13.6, 2026-08-10)

> **Current state (2026-10-19):** Since this was written the tool also got voice narration, Color, photos
> (with edit), the `LV-0001` stock SKU and a mobile layout (v3.13.44), label
> printing on Avery 5260 sheets or a thermal roll (v3.13.45/47), and photo
> editing (v3.13.49/50). See `v3.13-patch-notes.md`. It's no longer
> desktop-only. Still no "promote to the real catalog" flow.


A separate, standalone tool for fast numbered item capture while
presenting a live sale (Poshmark, initially) — deliberately **not** a tab
inside the main SPA and **not** the real `items` collection, per her
explicit spec. Desktop/PC only, still behind the same Firebase login.

- **New Vite entry point**: `live-catalog.html` + `src/live-catalog.js`,
  wired via `vite.config.js`'s `build.rollupOptions.input` (Vite only
  bundles `index.html` by default — this makes `vite build` emit both
  pages). Reached from the main app via a "🔴 Live" link in the desktop
  sidebar (`#sidebarNav` in `index.html`), and a "← Back to Calculated
  Chaos" link the other way.
- **Firestore collections** (separate from the real catalog):
  `liveSessions` (one doc per named/dated live batch — `name`, `platform`,
  `date`, `startNum`, `nextNum`, `itemCount`), `liveItems` (one doc per
  captured item, `sessionId`-scoped — `num`, `tipo`, `brand`, `size`,
  `measurements[]`, `sold`, `soldPrice`, `buyer`, `notes`), and
  `live_catalog_options/main` (persisted custom Tipo/Brand/Size/
  measurement-label values she's typed before, so "add a new option"
  sticks for next time — same idea as the real catalog's autocomplete
  lists, kept fully separate so neither list pollutes the other).
- **Multiple sessions, not one running list**: the picker screen
  (`#sessionPickerView`) lists every past live as a card (name, platform,
  date, item count) plus a "Start a new live" box. Each session has its
  own independent numbering — the picker only sets the *starting* number;
  from then on `nextNum` auto-increments, but editing the # field on an
  item bumps the sequence to continue from that new number (e.g. picking
  up where a previous live's list left off).
- **Session creation fields**: Name, Platform (dropdown, built-in
  platforms from `PLATFORM_LABEL` in `constants.js`, defaults to
  Poshmark — no custom-platform option here since this dropdown doesn't
  load `appSettings`, and it's just a label on the session, not tied to
  fee calculation like the real catalog), Date (`<input type="date">`,
  pre-filled to today via `valueAsDate = new Date()`), Starting #.
- **Quick-add form**: Tipo/Brand/Size are `<input list=...>` +
  `<datalist>` combos (typed text becomes a real suggestion for next
  time via `rememberIfNew()`, persisted to `live_catalog_options/main`)
  rather than `<select>` + prompt(), since a live moves too fast for
  modal dialogs. Tipo/Size suggestions blend the real catalog's existing
  values (via `getAllClothingTypes`/`getSizeSuggestionsForType` from
  `catalog-lookups.js`) with Live-only custom additions; Brand has no
  preset list in the main app at all, so `getAllBrands()` (new export,
  `catalog-lookups.js`) was added purely for this. Measurements are a
  flat label+value row list (simple dropdown-selectable label via one
  shared `DEFAULT_MEASURE_LABELS` list, not the real Measure Tool's
  per-garment-category logic — deliberately simpler, per her spec), with
  5 rows available by default and an "+ Add measurement" button for more.
  **Nothing is required to save** — even a blank row still reserves its
  number, editable later directly in the table.
- **Live items table**: every field (#, Tipo, Brand, Size) is inline-
  editable directly in its row (`<input>` on `change`, immediate
  `updateDoc`) — no separate edit mode, per her spec.
- **Sold tracking** (same 2026-08-10 request that added Platform/Date):
  each row has a "Sold?" toggle button (`item.sold`, `data-toggle-sold`).
  Once toggled on, the row's "Sale info" cell shows Sale price / Buyer /
  Notes fields — plain `[data-field]` inputs, so they're picked up by the
  same generic inline-edit listener as Tipo/Brand/Size, no separate save
  logic needed. These fields stay visible and editable indefinitely once
  sold is on (not just at the moment of toggling), per her explicit
  requirement that this info be "available and editable at any time on the card." Toggling "Sold?" off again hides (but does not
  delete) whatever was entered.
- **Deliberately out of scope**: no link back into the real catalog (e.g.
  "convert this live item into a real inventory item") — she asked for a
  capture tool for use *during* the live, not an import pipeline. Revisit
  if she wants captured items promoted into the real `items` collection
  afterward.
