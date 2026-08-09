# Project conventions — Calculated Chaos

## Versioning & CHANGELOG.md

`APP_VERSION` in `src/main.js` follows `vMAJOR.MINOR.PATCH` (e.g. `v3.12.5`).

- Bump the version (and `APP_VERSION_DATE`) with every meaningful change,
  same as always.
- **Only update `CHANGELOG.md` when MINOR changes** (e.g. `v3.12.x` →
  `v3.13.0`) — not on every patch bump inside the same minor series
  (`v3.12.2`, `v3.12.3`, `v3.12.4`, `v3.12.5`, …).
- Patch-level changes within the current minor series are tracked below,
  in "Pending changelog entry", and folded into `CHANGELOG.md` as one
  consolidated entry the moment the minor version bumps. Clear this list
  right after writing that entry.

### Pending changelog entry (not yet in CHANGELOG.md)

Changes since the last CHANGELOG.md entry (v3.13.0), to fold into the
next minor bump:

- **v3.13.1** — Full color rebrand: `--terracotta`/`-deep` went from
  coral-red to warm taupe-brown, `--plum`/`-soft` from plum-purple to
  near-black warm brown, `--cream`/`-soft`/`--blush`/`--gold`/`--amber`
  all warmed to match — applied everywhere (mobile included), not just
  the Dashboard, since all of `style.css` keys off these CSS custom
  properties. `--danger` (red) deliberately left unchanged — semantic
  status color, not brand. See "Desktop Dashboard" section below for
  the full rationale.

## Planned changes (backlog)

Not implemented yet — captured here so they survive between sessions.

### 1. "Mark as sold" confirmation flow (requested by Vitor's wife, 2026-08-09)

Today, marking an item Sold computes the financial fields (fee, net profit)
inline/automatically:
- **Item modal**: sold price/shipping cost/sold platform are just regular
  form fields next to the status pills — filled in as part of one big Save,
  no dedicated confirmation step.
- **Bulk "Set: Sold"**: fully automatic — sold price defaults to list price
  (or `suggestPrice`), sold platform defaults to a guess
  (`soldPlatform || listedPlatforms[0] || platform || 'ebay'`), fee is
  computed from that guess. No prompt at all.

Wanted instead: the moment an item is marked Sold (both the single-item
modal and the bulk action), show an explicit confirmation step that asks,
in order: (1) confirm/enter the actual sale price, (2) confirm whether a
platform fee applies and which platform, (3) confirm who paid shipping
(buyer or seller) — and only after those are answered, run the financial
calc (`feesTotal`, `netProfit`) from the confirmed values instead of
defaults/guesses. Goal: stop silently guessing financial numbers that feed
directly into profit reporting and tax exports.

Not yet scoped: whether this is a new modal/dialog, or reworking the
existing inline sold-fields section to require explicit confirmation
before the fields become editable/save-able. Needs a design pass before
implementation.

### 2. Revenue-by-platform breakdown — ✅ done (v3.13.0, 2026-08-09)

Shipped as part of the new desktop Dashboard (`modules/dashboard.js`'s
`revenueByPlatform`, grouped by `soldPlatform`) rather than in Reports.
Still not in the Reports tab itself — revisit if that's wanted there too
(e.g. in a CSV export).

## Desktop Dashboard (added v3.13.0, 2026-08-09)

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

## User-facing text: English only

All strings shown in the UI (alerts, buttons, status boxes, etc.) are in
English, regardless of what language the conversation with Claude happens
in. This repo's actual audience for the app is English-speaking eBay/
Poshmark buyers and the account owner works across both languages, so code
comments and chat can be Portuguese but anything the app renders to a user
must not be.
