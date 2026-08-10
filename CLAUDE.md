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
- **v3.13.4** — Sale price and platform are now genuinely required in the
  sold-confirmation flow (price `> 0`, platform starts blank unless
  confidently guessable), and confirming the single-item modal now
  autosaves immediately.
- **v3.13.5** — Made the sold-confirmation platform fee an editable field
  (was a read-only computed preview) and added an "Other costs" field
  (packaging, extra postage, anything else) — both persist to the item as
  `feesTotal`/`otherCosts` and factor into `netProfit`. Extracted the
  whole sold-confirmation flow (single-item modal + bulk review list) into
  `modules/sold-confirm.js`, and `getAllPlatforms`/`getPlatformLabel`/
  `getPlatformColor` into `modules/platforms.js` — done immediately since
  the code was brand new, cheaper to modularize now than after more piles
  on top. See "Modularization progress" below.
- **v3.13.6** — Added the "Live Catalog" tool (`live-catalog.html` +
  `src/live-catalog.js`, its own Vite entry point) for fast numbered item
  capture while presenting a live sale — see its own section below.
  Added a "🔴 Live" link to the desktop sidebar (`#sidebarNav`) pointing
  to it. Live sessions now capture a Platform (dropdown, defaults to
  Poshmark) and Date (defaults to today) at creation. Each live item row
  also got a "Sold?" toggle that reveals sale price / buyer / notes
  fields, editable at any time afterward, not just when first marked.
- **v3.13.7** — Fixed "Start live" failing silently on a Firestore
  permission error (no try/catch around the write — now surfaces the
  real error via `alert()`). Added a "Fabric" field to the Live Catalog
  quick-add form and table (`item.fabric`), same free-text
  datalist-with-memory pattern as Tipo/Brand/Size — no preset list since
  the main catalog has no structured fabric field either.
- **v3.13.8** — Added voice narration capture to the standard Add Item
  modal: a "🎙️ Narrate item" button records a spoken description
  (tap-to-start/tap-to-stop, English only), transcribes it server-side
  with Deepgram Nova-3 (`api/transcribe-narration.js`), then extracts
  catalog fields from the transcript with Claude Haiku 4.5
  (`api/extract-narration-fields.js`). See its own section below for the
  full design rationale.
- **v3.13.9** — **Fixed a real financial bug**: every eBay listing was
  silently published with free/seller-paid shipping regardless of the
  per-item "Buyer pays / I pay" choice made at cataloging time, because
  `api/ebay-setup.js` only ever created ONE fulfillment policy
  (hardcoded `freeShipping: true`) and `api/ebay-list.js` used it for
  every listing unconditionally — the item-level toggle only ever fed
  her own internal profit math, never actually reached eBay. Found after
  a sale went through at a loss because of it (2026-08-10). Fixed by
  adding a second fulfillment policy (buyer pays, see
  `FULFILLMENT_NAME_BUYER_PAYS`) and having `ebay-list.js` pick between
  the two based on `item.freeShipping`, overriding the buyer-pays
  policy's shipping cost per listing via `listingPolicies.
  shippingCostOverrides` with that item's `estimateShipping()` estimate
  (USPS Priority Mail figure, same formula already used for her profit
  numbers). **Requires action — see "eBay shipping policy bug" section
  below**: rerun eBay setup, add a new env var, and manually fix listings
  that already published before this fix (it does not retroactively
  correct live listings).
- **v3.13.10** — Found while testing the v3.13.9 fix: `runEbaySetup()`'s
  result screen in Settings never displayed the new
  `fulfillmentPolicyIdBuyerPays` value (still showed the old hardcoded
  4-value template), so there was no way to actually copy the 5th env
  var. Fixed. Also fixed a real eBay publish failure hit during that same
  test — `errorId 25002` ("item specific Type is missing") on a Dresses
  listing, even though eBay's own Taxonomy API never flagged "Type" as
  required for that category (a known Taxonomy/Inventory API
  inconsistency, not specific to this app). Added
  `extractMissingAspectName()` + a retry loop (up to 3 attempts) in
  `api/ebay-list.js`: on this exact error shape, parse the missing field
  name out of eBay's own message and retry with `'Does not apply'`
  filled in, instead of hardcoding "Type" (or any other field) for one
  category — the same fix now protects against any other category
  eBay is similarly inconsistent about.
- **v3.13.11** — Found publishing the very next item after the v3.13.10
  fix: `errorId 25020` — eBay flat-out rejects the inventory item without
  a `packageWeightAndSize`, which `buildInventoryItem()` in
  `api/ebay-list.js` never sent at all. Added it, using the same
  weight/length/width/height fallback defaults (0.5lb / 10×8×2in)
  `estimateShipping()` already uses for her profit math, so an
  un-measured item still gets a valid non-zero value instead of failing
  to publish.
- **v3.13.12** — Added an "eBay listing audit" tool (Settings, below
  "eBay one-time setup") — Vitor asked for a way to be sure the shipping
  bug is actually fully fixed rather than just trusting it. Fetches every
  live eBay listing (paginated `getOffers`) and cross-references by SKU
  against the catalog, flagging: listings with no matching item
  ("orphaned" — never auto-imported, review-only per his explicit
  choice) and listings whose live `fulfillmentPolicyId` doesn't match
  what `item.freeShipping` says it should be — the exact class of bug
  that started this whole thread. The policy-ID comparison happens
  server-side (`api/ebay-listing-tools.js`, new `action:'audit'`) since
  the real IDs are Vercel env vars; the client only sends `{sku,
  freeShipping}` pairs. Added as a new action on the already-consolidated
  `ebay-listing-tools.js` rather than a new file, to stay at exactly 12
  functions (see the Hobby-plan cap note above — still no slack for a
  genuinely new endpoint). New module `modules/ebay-audit.js`, exported
  as a plain function (`window.runEbayAudit`) rather than an
  init-with-listener controller, since its button/result area live
  inside `renderSettings()`'s HTML, rebuilt on every render — same
  pattern as `runEbaySetup`/`checkEbaySalesNow` already use.
- **v3.13.13** — **Likely fixes the recurring "A server error has
  occurred" / "Unexpected token 'A'..." crashes** seen throughout this
  session on `/api/narration`, `/api/ebay-check-sales`, and the new
  audit endpoint — three otherwise-unrelated routes all timing out past
  Vercel's default 10-second function limit on the Hobby plan (narration
  does two sequential external calls — Deepgram then Claude; the audit
  endpoint paginates through every eBay offer; `ebay-check-sales` calls
  eBay's order API, which can be slow). When a function times out,
  Vercel returns its own generic error page instead of JSON, which is
  exactly the "Unexpected token 'A', 'A server e'... is not valid JSON"
  shape reported. Added `vercel.json` with `functions.*.maxDuration`
  raised to 30-60s for `narration.js`, `ebay-check-sales.js`,
  `ebay-listing-tools.js` (audit lives here), and `ebay-list.js`.
  **Unverified**: not confirmed whether the Hobby plan actually honors a
  60s `maxDuration` (some Vercel tiers cap this lower regardless of
  config) — watch the next deploy for a build-time rejection of this
  file, and if the timeouts persist even after this, that's the next
  thing to check.
- **v3.13.14** — **Found the actual root cause of v3.13.13's crashes**
  (the 60s timeout bump didn't fix it — same error came back in under
  2 seconds, too fast to be a timeout): `package.json` has `"type":
  "module"`, which makes Node treat every `.js` file as an ES module by
  default, but `ebay-category-search.js`, `ebay-check-sales.js`,
  `ebay-end-listing.js`, and the new `ebay-listing-tools.js` still used
  `module.exports = ...` (CommonJS) — invalid syntax under ESM, which
  crashes the function at import time, before any of its own try/catch
  ever runs. That's exactly the symptom reported all session: fast,
  every time, a non-JSON "A server error has occurred" body with a
  500 status (Vercel's own crash page, not this app's JSON error
  responses). The first three predate this session entirely — meaning
  eBay category search, sale-sync, and "End listing" were likely broken
  in production for a while before today, not something this session
  broke. `ebay-listing-tools.js` inherited the same broken pattern
  because it was written by merging two of those already-broken files
  (`ebay-condition-policies.js`/`ebay-negotiation.js`) — copying their
  `module.exports` style without noticing it never actually worked.
  Fixed all four to `export default`, matching every other file in
  `api/`. **Lesson for future `api/` files**: always use `export
  default`, never `module.exports` — this repo's `package.json` is ESM.
- **v3.13.15** — The eBay listing audit's failure message only ever
  showed `data.error` ("Failed to fetch eBay offers"), never the actual
  eBay error behind it — added `data.detail` to the error box so the
  next failure is diagnosable without needing DevTools.
- **v3.13.16** — That improved error message immediately paid off:
  errorId 25709 "Invalid value for header Accept-Language" — the
  audit's `getOffers` call omitted `Content-Language`/`Accept-Language`
  entirely, unlike `ebay-setup.js`'s `ebayRequest()` helper, which
  always sends both. Added both headers (`en-US`) to the audit's fetch.
- **v3.13.17** — Next audit attempt hit errorId 25707 ("invalid value
  for a SKU") — turns out `GET /sell/inventory/v1/offer` (`getOffers`)
  has no "list every offer on the account" mode at all, it REQUIRES a
  `sku` filter. Rebuilt the audit as two passes: list every SKU on the
  account via `GET /sell/inventory/v1/inventory_item` (which does
  paginate with no filter), then fetch each SKU's offer individually
  (batched 10-at-a-time via `Promise.all`, not fully sequential, to
  stay well inside `ebay-listing-tools.js`'s 60s `maxDuration` even for
  a larger catalog) to get its live status/price/`fulfillmentPolicyId`.
  More requests than the original single-paginated-call design, but
  it's the only way this API actually supports it.
- **v3.13.18** — Vitor reported 102 active eBay listings but the audit
  only checked 82 — a real undercount, not a display issue. Root cause:
  the batched (10-at-a-time) per-SKU `getOffers` calls silently dropped
  any SKU whose request failed (rate-limited or errored), with no sign
  anything was skipped. Added a one-retry-with-backoff wrapper per SKU
  lookup, and now surfaces `lookupErrors` (which SKUs still couldn't be
  checked after the retry) and `totalSkus` (how many SKUs exist on the
  account at all, live or not) in the report — so a future gap between
  "active listings" and "checked" is visible and explainable instead of
  silently swallowed. **If the count still doesn't reach 102 after
  this**, the next suspect is listings that exist outside the Inventory
  API entirely (e.g. created directly in eBay's Seller Hub rather than
  through this app or the modern API) — `inventory_item`/`getOffers`
  can't see those at all; would need eBay's legacy Trading API
  (`GetSellerList`) to find them, which is a bigger change not started.
- **v3.13.19** — Added inline bulk-fix to the eBay listing audit: each
  shipping-mismatch row now has a checkbox (checked by default), and a
  "🔧 Fix selected now" button that republishes exactly those listings
  (`publishItemToEbayCore(item, true)`, same function
  `runBulkEbayPublish` in `ebay-api.js` already uses for the Catalog's
  bulk "Update existing listing" flow) — so fixing what the audit found
  no longer means leaving the audit screen to filter the Catalog by
  "Listed on eBay" and reselecting everything by hand. Doesn't
  auto-rerun the audit after fixing — she reruns it manually to confirm.

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
- (v3.13.5) Platform fee is a real editable field, not just a computed
  preview — pre-filled from `platformFee()` but she can override it (a
  promo, a dispute credit, whatever doesn't match the standard rate); the
  single-item modal only re-autocalculates on price/platform change until
  she's touched the fee field herself (`scFeeManuallyEdited`/
  `feeManuallyEdited` flag). Also added "Other costs" (packaging, extra
  postage, anything else) in both flows — persists as `item.otherCosts`,
  factored into `netProfit` alongside `feesTotal`/`shippingCost`.
- Now lives in `modules/sold-confirm.js` (`initSoldConfirmModal` for the
  single-item modal, `showBulkSoldConfirm` for the bulk list,
  `computeNetProfit` as the one shared formula) — see "Modularization
  progress" below.
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

## Modularization progress

`main.js` is still one big IIFE (`export const app = (function(){ ... })()`)
and has grown back to 5,541 lines as of v3.13.5 (was down to ~5,083 after
an earlier extraction session, then +600 from this session's features
before some of that got pulled back out — see below). Extracted so far
into `src/modules/` (pure functions parameterized on `items`/`appSettings`
instead of closing over them; main.js keeps thin wrapper functions with
the original names so call sites don't change): `constants.js`,
`format-utils.js`, `pricing.js`, `reports.js`, `settings.js`, `state.js`
(shared `items`/`appSettings`, imported directly by both `main.js` and
`ebay-api.js`), `catalog-filters.js`, `catalog-lookups.js`,
`image-compression.js`, `dashboard.js`, `platforms.js` (v3.13.5).
`sold-confirm.js` (v3.13.5) is the first module that's a DOM-touching
controller rather than pure calculations — extracted immediately after
being written rather than left to accumulate in `main.js`, since that's
much cheaper than extracting battle-tested legacy code later.
`narration-capture.js` (v3.13.8) follows the same immediate-extraction
approach for the voice-narration feature — see its own section below.

**Proposed next phases** (discussed 2026-08-09, not started), ordered
safest-first same as always:
1. **Low risk, mechanical**: `modules/listing-copy.js` (pure
   `buildListingTitle`/`buildListingDescription` string builders),
   `modules/label-printing.js` (thermal label/marker canvas drawing +
   print modal, ~360 lines, only depends on `appSettings` + one item),
   `modules/lightbox.js` (photo gallery, ~100 lines, fully self-contained).
2. **Medium risk, self-contained but stateful subsystems**:
   `modules/measure-tool.js` (the photo measurement tool, ~550 lines —
   the single largest remaining self-contained chunk, has its own
   pan/zoom/calibration state), `modules/photo-session.js` (~210 lines),
   `modules/ai-photo-analysis.js` (~330 lines).
3. **Bigger win, more tedious**: Settings — `renderSettings()` alone is
   ~330 lines, plus the eBay/employee-accounts/authorize-access panels
   and ~15 individual `window.save*Settings` handlers, all reading/
   writing `appSettings` (~950 lines total). More feasible now than in
   the original modularization session since `appSettings` already lives
   centrally in `state.js`.
4. **Leave for last / maybe never**: item modal open/save/delete + eBay
   category search wiring (~650 lines) — the most state-coupled section,
   touching nearly every piece of mutable closure state (photos, status,
   listed platforms, chosen eBay category...). Every feature added this
   session (sold confirmation, tiered fees) runs through here. High risk
   of breaking working functionality for comparatively little clarity
   gain without a broader state-management redesign.

Phases 1-3 would realistically bring `main.js` down to roughly
3,200-3,300 lines; phase 4 is the honest floor without redesigning how
state is shared beyond what `state.js` already does.

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

## Live Catalog (added v3.13.6, 2026-08-10)

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
  requirement that this info be "disponível e editável a qualquer
  momento no card." Toggling "Sold?" off again hides (but does not
  delete) whatever was entered.
- **Deliberately out of scope**: no link back into the real catalog (e.g.
  "convert this live item into a real inventory item") — she asked for a
  capture tool for use *during* the live, not an import pipeline. Revisit
  if she wants captured items promoted into the real `items` collection
  afterward.

## eBay shipping policy bug (fixed v3.13.9, 2026-08-10) — ACTION NEEDED

**What was wrong**: `api/ebay-setup.js` created exactly one eBay
fulfillment (shipping) policy, hardcoded to free/seller-paid shipping.
`api/ebay-list.js` used that same policy for every single listing,
completely ignoring the item's own "Buyer pays / I pay" field
(`item.freeShipping`, set via the `#fFreeShipping` dropdown at cataloging
time). That field only ever fed the app's own internal profit-margin
math — it never reached the real eBay listing. Every listing published
through this app before v3.13.9 has free/seller-paid shipping on eBay
regardless of what was chosen per item. Confirmed causing real losses on
at least one completed sale.

**The fix**: `ebay-setup.js` now creates a SECOND fulfillment policy
(`CC Buyer Pays Shipping`, not free) alongside the original
(`CC Standard Shipping`, still free — used when she genuinely wants to
absorb shipping). `ebay-list.js` picks between the two per listing based
on `item.freeShipping`, and when the buyer pays, overrides that policy's
placeholder cost with the item's real `estimateShipping()` figure via
`listingPolicies.shippingCostOverrides` — so the dollar amount the buyer
sees matches what the app's own profit numbers assume.

**Vitor still needs to, in order**:
1. Settings → eBay one-time setup → **"Run eBay setup"** again (safe to
   re-run — existing policies are detected and reused, only the new
   buyer-pays policy gets created)
2. Copy the returned `fulfillmentPolicyIdBuyerPays` value into a NEW
   Vercel env var: `EBAY_FULFILLMENT_POLICY_ID_BUYER_PAYS`
3. Redeploy (a push does this automatically, or trigger one manually)
4. **This does NOT retroactively fix listings already live on eBay** —
   for each currently-published item where "Buyer pays" was intended,
   open it in the app and use "Update existing listing" (in the item's
   eBay panel) to republish it with the corrected policy. There is no
   bulk version of this yet — revisit if the number of affected listings
   makes that worth building.
5. Spot-check one republished listing on eBay itself to confirm the
   shipping cost shown to buyers is no longer $0/free before assuming
   the fix is fully live.

Not yet tested against eBay's live API (no sandbox/production
credentials in this environment) — verified via `node --check` and a
clean `vite build` only. The `shippingCostOverrides` field/shape is from
documentation, not confirmed against a real eBay response — **watch the
first few publishes closely**.

## Voice narration capture (added v3.13.8, 2026-08-10)

A "🎙️ Narrate item" button in the standard Add Item modal (`index.html`,
next to the existing "🔮 Analyze with AI" photo button) records a spoken
item description and auto-fills catalog fields from it — for cataloging
outside a live sale, where narrating while holding the item is faster than
typing. Discussed at length with Vitor before building; decisions below
reflect that conversation, not defaults picked unilaterally.

- **Recording UX**: tap-to-start/tap-to-stop (not push-to-talk, not
  silence-detection auto-stop — his explicit choice). 2-minute safety
  auto-stop in case the button tap to stop is missed.
  `modules/narration-capture.js`'s `pickSupportedMimeType()` tries
  `audio/mp4` first specifically for Safari (the primary target platform
  per Vitor — he's on Safari now, native app later), falling back through
  `audio/webm`/`audio/ogg` for other browsers.
- **Pipeline**: record → `POST /api/narration` (`action:'transcribe'`,
  Deepgram Nova-3, `language=en` — English only, no auto-detect, since the
  narrator doesn't speak Portuguese) → `POST /api/narration`
  (`action:'extract'`, Claude Haiku 4.5 — plain structured extraction from
  a short transcript doesn't need Sonnet's cost/latency) → review card →
  "Apply to form". `api/narration.js` follows the existing
  `api/analyze-photo.js`/`api/generate-listing.js` pattern
  (`requireApprovedUser` guard, API keys server-side only, prompt built
  client-side and passed as `promptText`), but as a single
  `action`-dispatched file rather than two separate ones — see the Vercel
  function-limit note below for why.
- **Audio is never persisted** — not in Firestore, not in Storage, not by
  the serverless function. It's base64-encoded client-side, POSTed, and
  discarded the moment the transcript comes back.
- **Vercel Hobby plan's 12-serverless-function cap**: the project was
  already at exactly 12 route handlers in `api/` before this feature (11
  eBay endpoints + `analyze-photo.js`/`generate-listing.js`), so shipping
  transcription and extraction as two separate files (the original plan)
  broke the production build (`Build Failed: No more than 12 Serverless
  Functions...`). Fixed two ways, both discussed with Vitor rather than
  picked unilaterally — he chose consolidation over upgrading to Vercel
  Pro: (1) the two narration endpoints became one `action`-dispatched
  `api/narration.js`, and (2) `ebay-condition-policies.js` +
  `ebay-negotiation.js` — both purely internal (only ever called by this
  app's own frontend, unlike `ebay-account-deletion.js`/`ebay-auth.js`,
  which have URLs registered in eBay's Developer Portal and must never
  move) — merged into `ebay-listing-tools.js`, also `action`-dispatched.
  Net: 12 files before, 12 after. `_requireApprovedUser.js` doesn't count
  toward the cap — Vercel excludes underscore-prefixed files from being
  treated as routes. **If a future feature needs another new endpoint,
  this cap is already exhausted again** — either consolidate further or
  revisit the Pro-plan question.
- **Review card only shows fields the extraction actually found** (empty
  string / null fields are omitted entirely) — deliberately different from
  the photo-analysis card, which always shows its four fixed fields
  regardless of confidence. Each shown field is still editable before
  applying.
- **Overwrite protection**: "Apply to form" always runs a `confirm()`
  (same browser-dialog pattern used everywhere else in this app for
  destructive actions — see the delete-item/delete-photo confirms) before
  overwriting any field that already holds a different value. Mainly
  matters if photo analysis was already run on the same item — in
  practice a rare collision today since items are usually cataloged
  before photos are added, and the in-browser photo-session feature isn't
  functional yet.
- **New env var required**: `DEEPGRAM_API_KEY`, alongside the existing
  `ANTHROPIC_API_KEY` on Vercel. Not yet confirmed set — the feature will
  500 on the transcription step until it's added.
- **Not yet wired into Live Catalog** — Vitor asked to start with the
  standard Add Item modal first; Live Catalog's quick-add form was
  discussed as a likely follow-up but is explicitly out of scope for this
  pass.
- **Not yet tested against real audio/a real device** — built and verified
  via `node --check` + a clean `vite build` only, same caveat as the
  original Dashboard ship. Needs a real pass on Safari/iOS before trusting
  it in the field.

## User-facing text: English only

All strings shown in the UI (alerts, buttons, status boxes, etc.) are in
English, regardless of what language the conversation with Claude happens
in. This repo's actual audience for the app is English-speaking eBay/
Poshmark buyers and the account owner works across both languages, so code
comments and chat can be Portuguese but anything the app renders to a user
must not be.
