# Desktop Dashboard (added v3.13.0, 2026-08-09)

> **Historical (v3.20.0, 2026-10-20):** the Dashboard was replaced by the
> Home screen, the start screen on every device (`src/domain/home-summary.js`,
> `src/ui/home/home-view.js`). Revenue by platform moved there;
> `modules/dashboard.js` was removed.

> **Current state (2026-10-19):** Revenue-by-platform (former backlog item 2) shipped here, not in the Reports
> tab or its CSV export. Revisit if it's wanted there too.


Responsive breakpoint at **900px** (`@media (min-width: 900px)` in
`style.css`) switches between two layouts of the *same* app — nothing is
duplicated:
- **Under 900px (mobile/tablet)**: unchanged from before — top `.tabs`
  bar, Catalog as the starting tab, no sidebar. This is the primary,
  heavily-used surface (one-handed, mid-sourcing-trip), so it was
  deliberately left untouched rather than redesigned.
- **900px and up (desktop)**: `.sidebar` (`#sidebarNav`) replaces the top
  tabs, and the app opens on the new `dashboard` tab instead of `catalog`
  (see `waitForFirebaseThenLoad` in `main.js`). The existing `<header>`
  (title, daily quote, stats strip, refresh/logout buttons) still renders
  above the content on desktop too — it wasn't folded into the sidebar,
  to avoid relocating the sign-out button as part of this change.

Deliberate scope decisions, worth knowing before extending this:
- **Color palette**: shipped in v3.13.0 still using the OLD tokens
  (coral-red terracotta, plum-purple text) — deliberately not adopting
  the mockup's warm-neutral palette yet, since nobody had explicitly
  asked for a full rebrand. That changed in v3.13.1 (2026-08-09, same
  day): Vitor explicitly asked for the mockup's color scheme applied to
  the WHOLE app (mobile included), not just the Dashboard. Done by
  changing the `:root` token *values* in `style.css` only — same token
  names throughout, so every component re-themed without being touched
  individually. `--danger` (red) was kept as-is on purpose: semantic
  status color, not brand identity, shouldn't shift with a rebrand.
- **Quick actions**: only "Add item" and "Photo haul" are wired up (both
  just trigger the existing `#fabAdd`/`#fabPhotoSession` buttons) — the
  mockup's other two tiles ("Generate Listing", "Price Item") need an
  item already selected and have no standalone entry point today, so
  they were left out rather than wired to something fake.
- **Data logic lives in `modules/dashboard.js`** (`computeDashboardData`),
  pure functions over `items`, same pattern as `modules/reports.js` — no
  DOM in there, `renderDashboard()` in `main.js` builds the HTML.
- **"Needs attention"** = items either blocked from listing
  (`isIncomplete`, status `catalogado`) or stale (status `anunciado`,
  30+ days since `ebayListedAt`/`createdAt`) — reuses existing helpers,
  no new business rules invented.
- **"Sourcing streak"** = consecutive calendar days (through today) with
  at least one item's `createdAt` on that day. New concept, not used
  anywhere else in the app.
- Not verified in a real browser against live Firebase data (this
  sandbox can't reach it) — verified via `node --check`, a clean
  `vite build`, a headless-Chromium load up to the login screen (zero
  thrown JS errors, auth-lock hiding confirmed working after the HTML
  restructure), and `computeDashboardData` exercised directly with
  synthetic item data. **Click through the real Dashboard on desktop
  once before trusting it further.**
