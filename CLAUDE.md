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
- **v3.13.2** — Fixed `checkEbaySalesNow()` never stamping `soldPlatform`
  on auto-detected eBay sales, which piled them all into an uninformative
  "Other" bucket on the Dashboard's revenue-by-platform panel. Added a
  best-effort `inferSoldPlatform()` fallback in `modules/dashboard.js` for
  already-saved items that predate the fix. Fixed a real horizontal-scroll
  bug on the Dashboard (`.dash-lower-grid`'s grid items needed
  `min-width:0` — without it, the SVG chart / mono-font numbers forced the
  grid wider than `main`, adding a page-wide scrollbar at 100% zoom).
  Added icon squares to the stat cards and a header "+ Add Item" button to
  more closely match the reference mockup. Added employee accounts (see
  new section below).
- **v3.13.3** — Added the "mark as sold" confirmation flow and tiered
  platform fees (both requested 2026-08-09) — see their own sections
  below for the full detail.

## Planned changes (backlog)

Not implemented yet — captured here so they survive between sessions.

### 1. "Mark as sold" confirmation flow — ✅ done (v3.13.3, 2026-08-09)

Built as a dedicated modal (`#soldConfirmOverlay`), not a rework of the
inline sold-fields section:
- **Item modal**: clicking the "Sold" status pill (only on the
  catalogado/anunciado → vendido transition, not re-clicking an
  already-sold item) opens the modal instead of flipping status directly.
  Asks, in order: sale price, sold-on platform (fee applies from this),
  who paid shipping — with a live fee/shipping/net-profit preview that
  updates as she edits any field. Canceling leaves status untouched.
  Confirming sets `currentStatus='vendido'` and writes the confirmed
  values into the (still-existing) `#fSoldPrice`/`#fShippingCost`/
  `#fSoldPlatform` fields, which the normal Save flow already reads —
  no duplicate financial-calc logic, just gating what populates those
  fields.
- **Bulk "Set: Sold"**: a review list in `#bulkActionStatus`
  (`showBulkSoldConfirm`), same visual pattern as the eBay bulk-publish
  preflight — one row per selected item, each with editable price/
  platform/shipping-payer prefilled with the same best-guesses the old
  silent auto-apply used. Nothing computes until "Confirm & mark N as
  sold" is clicked.
- Both paths still run `endEbayListingIfSold` + the platform-mismatch
  warnings from v3.12.3/v3.12.4 afterward, unchanged.
- **v3.13.4** — Sale price and platform are now genuinely required, not
  just usually-filled: price must be `> 0` (was `>= 0`), and the
  single-item modal's platform `<select>` only pre-selects when there's
  an actually confident signal (`item.soldPlatform` already set, or
  exactly one entry in `listedPlatforms`) — otherwise it starts on a
  blank "— Select platform —" option so the required-field check means
  something, instead of blindly defaulting to eBay. Confirming the
  single-item modal now also autosaves immediately (`#saveItemBtn`
  .click()) instead of leaving her to remember to hit Save separately.

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

## Employee accounts (added v3.13.2, 2026-08-09)

An admin (`window.ADMIN_EMAILS` in `config/firebase.js`) can create a
Catalog-only login from Settings → "Employee accounts" — enter an email +
temporary password, `window.createEmployeeAccount()` creates the Firebase
Auth user and writes `role: 'employee'` on their Firestore `users/{uid}`
doc, `status: 'approved'` immediately (no pending-approval step, since the
admin is creating it directly).

**How the restriction works**: `applyRoleRestrictions()` in `main.js` runs
right after login, reads that `role`, and if it's `'employee'`: hides
every sidebar/tab entry except Catalog, hides the header's stats strip and
daily quote (both can show profit/margin numbers), and `switchToTab()`
itself force-redirects to `'catalog'` regardless of what's requested, as a
second layer.

**⚠️ This is a UI-level restriction only.** It stops an employee from
casually navigating to financial data — it does NOT stop someone who opens
the browser devtools and calls `getDocs(collection(db, 'items'))` (or
similar) directly; nothing server-side currently distinguishes an
`'employee'` role from an `'owner'` one. This repo has no `firestore.rules`
file — the real rules live only in the Firebase Console (Firestore
Database → Rules), which this environment has no credentials to reach or
edit. **To actually close this gap**, add a rule there that checks the
signed-in user's own `users/{uid}.role` field and denies employee reads on
anything beyond what Catalog needs (the `items` collection, read-only, is
probably still required for cataloging — the sensitive surfaces are
whatever collections back Finance/Reports, if those differ from `items`).
Flagging this explicitly rather than implying the current state is secure
enough for genuinely sensitive data.

**Technical note**: `createEmployeeAccount()` creates the new user via a
throwaway secondary Firebase App instance (`initializeApp(firebaseConfig,
'secondary-<timestamp>')`), not the primary `window.auth` — calling
`createUserWithEmailAndPassword` on the primary app would sign the admin's
own browser session in as the new employee instead of the admin. The
secondary instance is torn down (`signOut` + `deleteApp`) right after.

## Tiered platform fees (added v3.13.3, 2026-08-09)

Some platforms don't charge one flat %, so `appSettings.platformFeeRules`
(shape defined by `DEFAULT_PLATFORM_FEE_RULES` in `modules/constants.js`)
lets a platform have an ordered list of `{ upTo, pct, flat }` tiers
instead — `fee = price*(pct/100) + flat`, using the first tier where
`price <= upTo` (a `null` upTo never fails to match, so it must be last).
`pricing.js`'s `platformFee()` checks this first and only falls back to
the old flat-rate `platformFeeOverrides`/`feePct` system when a platform
has no rules — fully backward compatible, nothing breaks for platforms
that keep a flat %.

Pre-filled for eBay/Poshmark/Depop (researched 2026-08-09, cross-checked
across multiple current sources — see the git commit for links):
- **eBay**: 13.6% + a flat per-order fee that steps up at $10 ($0.30 →
  $0.40). Not modeling eBay's separate $7,500 high-value breakpoint
  (2.35% above that) — not a realistic sale price for a thrift item here.
- **Poshmark**: flat $2.95 under $15, 20% at $15 and up. `upTo` is 14.99,
  not 15, since tiers are inclusive (`price <= upTo`) and the real rule
  is "under $15" — $15.00 itself belongs in the 20% tier.
- **Depop**: no % commission anymore, just ~3.3% + $0.45 payment
  processing — modeled as a single tier so the flat part isn't lost to a
  pure-% approximation (which would misprice cheap items badly).

Also corrected while researching: **Vinted's seller fee changed from 5%
to $0** — sellers keep the full listed price now, the buyer absorbs a
separate "Buyer Protection" fee instead. `PLATFORM_FEES.vinted` in
`constants.js` updated from `0.05` to `0`.

Settings → Platforms: each platform row shows a "🎚️ Tiered fees" toggle
that expands an editor (up-to threshold / % / flat $ per tier, add/remove
tiers, "Use flat % instead" to clear back to the simple system). Custom
platforms she adds herself still work exactly as before — flat % only, no
tiered option (not asked for, and most her own added platforms are likely
simple flat-fee ones anyway).

## User-facing text: English only

All strings shown in the UI (alerts, buttons, status boxes, etc.) are in
English, regardless of what language the conversation with Claude happens
in. This repo's actual audience for the app is English-speaking eBay/
Poshmark buyers and the account owner works across both languages, so code
comments and chat can be Portuguese but anything the app renders to a user
must not be.
