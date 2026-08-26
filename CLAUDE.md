# Project conventions — Calculated Chaos

## Git workflow: feature branch + PR (added 2026-08-10)

Vitor asked (2026-08-10) why a Claude Code session's changes landed on a
separate branch + PR (`claude/audit-sku-discovery-gap-dx0uw5` → PR #2)
instead of going straight to `main` like some earlier sessions apparently
did. Clarifying so it doesn't come up as a surprise again:

- Whether a given Claude Code session commits straight to `main` or works
  on a branch + opens a PR is a **per-session/task setup choice** (set
  when the session is created — e.g. via claude.ai/code, a GitHub Action,
  or however it was invoked), not something Claude decides mid-session.
  It's plausible earlier sessions were configured to bind directly to
  `main`; this one was explicitly told to develop on a named branch and
  never push elsewhere without permission.
- Vitor confirmed (2026-08-10) he's fine keeping this branch+PR pattern —
  no change requested. Documenting it here just so the answer isn't a
  mystery again if it recurs. Nothing to actually configure in this repo
  itself (no branch-protection rules or required-reviews setting live
  here) — it's controlled by whatever spins up the session, outside this
  codebase.
- **Merging (2026-08-11)**: Vitor said "sempre" (always) when asked
  whether to merge each PR from this session — standing instruction to
  merge PRs in this repo without asking each time, rather than confirming
  per PR. Still open a PR per change (branch+PR pattern above stays), just
  don't block on a merge confirmation once it's open and green.

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
- **v3.13.20** — The bulk-fix button's "35 failed / unknown error" report
  was misleading: `publishItemToEbayCore` returns `{skipped:true,
  reason:'no_price'|'no_description'|'already_listed'}` for those cases,
  not `{success:false, error:...}` — my result-bucketing lumped skips in
  with real failures and showed "unknown error" since skipped results
  have no `.error` field. Fixed to bucket skipped separately with a
  human-readable reason per item — most of the 35 are almost certainly
  `no_description` (never had a listing description generated, likely
  because they were published before that became a hard requirement),
  fixable via Catalog's "🪄 Generate descriptions" bulk action first,
  then rerunning the audit fix.
- **v3.13.21** — The audit hit a real `504 Gateway Timeout` on the full
  ~127-SKU account, even with `maxDuration:60` already set — confirms
  the Hobby plan doesn't reliably honor that config for a call this
  chatty (list SKUs + one offer lookup per SKU). Split `action:'audit'`
  into `action:'audit_list_skus'` (fast, no per-item calls) and
  `action:'audit_check_skus'` (takes a `skus` chunk), and rewrote
  `runEbayAudit()` in `modules/ebay-audit.js` to drive the check in
  20-SKU chunks client-side, merging results as it goes and showing
  live "Checking listings — X of Y SKUs…" progress. No single request
  can time out regardless of catalog size now, since each one only
  covers a small, bounded chunk of work.
- **v3.13.22** — Vitor asked to skip the manual detour through Catalog
  for the 35 `no_description` skips from v3.13.20 — wanted to generate
  those descriptions using the selection already made in the audit
  screen. Extracted the per-item core of `runBulkGenerateDescriptions`
  into `generateListingDescriptionForItem(item)` (main.js), exposed as
  `window.generateListingDescriptionForItem` for cross-module reuse —
  `runBulkGenerateDescriptions` now calls it too instead of duplicating
  the AI-request/usage-tracking logic. The audit's "Fix selected now"
  report now shows a "🪄 Generate N missing descriptions & retry
  publish" button whenever some fixes were skipped for `no_description`
  specifically — one click writes each missing description then
  immediately retries `publishItemToEbayCore`, chaining both steps that
  previously required leaving the audit screen.
- **v3.13.23** — Found the actual cause of the eBay listing audit
  undercount (104 Active on eBay vs 98 SKUs total found): the audit only
  ever sees listings with an Inventory API record (`GET inventory_item`
  requires a SKU assigned through that specific API) — a listing created
  any other way (Seller Hub, a bulk lister, an older tool) is completely
  invisible to it, whether or not it happens to have a SKU string set.
  Added a second discovery pass to the eBay listing audit using the legacy
  Trading API's `GetMyeBaySelling` (ActiveList) — new `action:
  'legacy_scan'` in `api/ebay-listing-tools.js`, authenticated with the
  same OAuth token via the `X-EBAY-API-IAF-TOKEN` header (Trading API's
  documented bridge for OAuth tokens) instead of a Bearer header, parsed
  with the new `fast-xml-parser` dependency. Results are diffed
  client-side against every `listingId` the Inventory-API-based audit
  already saw (`checkedListingIds`, new field on `audit_check_skus`'s
  response) to isolate listings with zero Inventory API record. Each is
  shown with a pre-filled suggested SKU (from the same `nextProductCode()`
  sequence used everywhere else) and an "Import selected into catalog"
  action: calls eBay's `bulk_migrate_listing` (new `action:
  'migrate_listing'`) to give the listing a real Inventory API item+offer
  under that SKU — the live eBay listing itself is untouched (same
  ItemID/URL) — then writes a new catalog item in Firestore (title/price/
  one photo from ActiveList; `freeShipping` defaults to a guessed `true`
  since ActiveList doesn't expose the real shipping policy, flagged in
  the result summary for manual review). Type, brand, size, cost, and the
  rest still need a manual pass in Catalog afterward, same as any
  freshly-cataloged item. **Unverified against eBay's live API** (no
  sandbox/production credentials in this environment) — the XML request
  shape and `bulk_migrate_listing` response shape follow eBay's
  documentation but haven't been exercised against a real account; watch
  the first real run closely, and if `legacy_scan` fails, the raw XML is
  surfaced via the error's `detail` field to diagnose from.
- **v3.13.24** — Vitor asked whether the eBay listing audit's "import
  invisible listing" flow (v3.13.23) pulls all of a listing's photos, not
  just one — it didn't: `GetMyeBaySelling`'s `ActiveList` (used to find
  the invisible listings) only ever returns one gallery/primary photo per
  item. Added a second Trading API call, `GetItem` (new
  `fetchListingPhotos()` in `api/ebay-listing-tools.js`), fired once per
  listing right at import time (inside `action:'migrate_listing'`, after
  the migration itself succeeds) to fetch the listing's full
  `PictureDetails.PictureURL` set. Best-effort: if this call fails, the
  import still succeeds — it just falls back to the single photo already
  known from `legacy_scan`, same as before this change, rather than
  failing the whole import over a missing extra photo.
- **v3.13.25** — First real-account test of the v3.13.23 "import invisible
  listing" flow: all 21 imports attempted failed with a plain HTTP 400 and
  no readable reason (`ebay-audit.js`'s failure summary only ever showed
  the generic "Failed to migrate listing" text, never eBay's actual error
  body). Two fixes: (1) the result summary now shows `detail` — eBay's
  real error JSON — under each failed row, not just a canned message,
  matching the pattern the top-level audit error box already used; (2)
  root-caused the 400 itself by reading eBay's `bulk_migrate_listing`
  docs properly: that endpoint does **not** accept a `sku` to assign in
  its own request — it requires the listing to already have a
  seller-defined SKU set via the Trading API before migration can
  succeed, which is exactly why every one of these listings failed (they
  had no SKU at all — that's why they were invisible in the first place).
  `handleMigrateListing` now does two steps: `ReviseItem` (Trading API,
  new `reviseItemSku()`) assigns the SKU on the legacy listing first,
  then `bulk_migrate_listing` (now called with only `listingId`, no `sku`
  field) brings the now-SKU'd listing into the Inventory API. **Still not
  confirmed against a real account** — this fixes the specific 400 seen,
  but the two-step flow itself hasn't been exercised live yet. Next
  import attempt is the real test; if it still fails, the `detail` box
  added in this same version is the place to read the actual eBay error
  from.
- **v3.13.26** — The v3.13.25 ReviseItem fix worked — first real import
  (1 listing) succeeded. Added a "Select all" checkbox above the eBay
  listing audit's invisible-listings list (`#auditInvisibleSelectAll` in
  `modules/ebay-audit.js`), toggling every `.audit-invisible-chk` at
  once — with a batch of 21+ found on the real account, checking each
  row individually before "Import selected" wasn't practical.
- **v3.13.27** — Vitor set a fixed rule: "buyer pays shipping" is ALWAYS
  the correct default for eBay listing audit imports — not a guess to
  leave for manual review like v3.13.23-25 did. Imported items now get
  `freeShipping: false` unconditionally, and the migration itself
  actively corrects it on the live eBay listing: new
  `correctOfferShipping()` in `api/ebay-listing-tools.js` (called from
  `action:'migrate_listing'`, after `bulk_migrate_listing` succeeds)
  fetches the offer eBay just auto-created from the legacy listing's
  existing policy, and if its `fulfillmentPolicyId` isn't already
  `EBAY_FULFILLMENT_POLICY_ID_BUYER_PAYS`, overwrites just that field
  (leaving category/description/price/aspects exactly as eBay
  auto-populated them) and republishes the offer so the change goes
  live. No per-item `shippingCostOverride` is set here (a freshly
  imported item has no weight/dimensions yet to estimate a real number
  from) — it uses the buyer-pays policy's own placeholder cost until a
  manual pass in Catalog refines it. The import result summary reports
  how many listings were actually corrected vs. already matched, and
  flags anything the correction call itself failed on for manual
  double-checking on eBay directly. **Not yet verified against a real
  account** — same caveat as v3.13.23-26, watch the next real import.
- **v3.13.28** — Vitor asked (1) how the $8 buyer-pays placeholder from
  v3.13.27 actually works — documented here since it wasn't written down
  anywhere: `api/ebay-setup.js` creates `CC Buyer Pays Shipping` with a
  flat `$8.00` base cost; normal cataloging overrides that per-listing
  with a real `estimateShipping()` figure once weight/dimensions are on
  file, but imported items skip that (no weight data yet), so buyers see
  the raw $8 until she measures the item and re-saves it. (2) Added a
  "jump to this item" link to the import result summary — each
  successfully imported item now shows an "Open ↗" button plus an
  explicit warning listing what's still missing (weight/dimensions —
  and therefore the $8 placeholder — type, brand, size, cost), instead
  of a generic one-line disclaimer she'd have to go find each item for
  herself. New `window.openItemModalById(id)` in `main.js` (switches to
  the Catalog tab and opens that item's modal) — exposed on `window`
  the same way `generateListingDescriptionForItem` already is, so
  `modules/ebay-audit.js` (a separate module, no access to main.js's
  closure state) can trigger it without a new dependency between them.
- **v3.13.29** — First real batch of the v3.13.27/28 import flow: 17 of 17
  migrated successfully (SKU assignment works!) but shipping correction
  failed on all 17 with `no_offer_id` — `bulk_migrate_listing`'s real
  response didn't carry the `offerId` field the way eBay's docs implied.
  Fixed `handleMigrateListing` to fall back to looking the offer up by
  SKU (`GET /sell/inventory/v1/offer?sku=...`, the same reliable approach
  `handleAuditCheckSkus` already uses) whenever the migration response
  doesn't include one directly. Also, Vitor wants a specific existing eBay
  policy ("USPS Ground + Priority (Buyer Pays)") to become the actual
  buyer-pays default instead of the app-created `CC Buyer Pays Shipping`
  placeholder — that's a Vercel env var change
  (`EBAY_FULFILLMENT_POLICY_ID_BUYER_PAYS`), not something this app can
  set for itself, so added a read-only "📋 List my eBay shipping
  policies" button in Settings (new `action:'list_fulfillment_policies'`
  in `api/ebay-listing-tools.js`, `runListFulfillmentPolicies()` in
  `modules/ebay-audit.js`) that shows every policy's name next to its
  real ID, so the right one can be copied straight into Vercel without
  digging through Seller Hub. **Not yet confirmed against a real
  account** — same caveat as v3.13.23-28, watch the next real import for
  whether `shipping.corrected` finally comes back `true` instead of
  `no_offer_id`.
- **v3.13.30** — Vitor asked to skip AI-generated descriptions for eBay
  listing audit imports entirely when the listing already has one — the
  17-item batch from v3.13.29 all failed the "Generate missing
  descriptions & retry publish" flow, and AI regeneration had already
  mischaracterized at least one new item as used elsewhere. Root cause:
  `migrate_listing` never captured the listing's existing description, so
  every imported item started with a blank `listingDescription`, which is
  exactly what routes `publishItemToEbayCore` into `reason:'no_description'`
  and from there into the AI flow. Renamed `fetchListingPhotos()` to
  `fetchListingDetails()` in `api/ebay-listing-tools.js` — same GetItem
  call already used for the full photo set now also requests
  `IncludeDescription: true` and returns the listing's original
  `Description` field, which `modules/ebay-audit.js` now saves as
  `item.listingDescription` on import. A freshly imported item is never
  routed through AI generation anymore unless she explicitly replaces the
  description herself. **Doesn't retroactively fix the 17 items from the
  v3.13.29 batch** — those already exist with a blank description; she'll
  need to paste each one's description in manually via Catalog, or ask for
  a one-off backfill tool if that's worth building for this batch size.
- **v3.13.31** — Built the backfill tool from v3.13.30's note: new "🩹
  Backfill missing eBay descriptions" button in Settings
  (`runBackfillDescriptions()` in `modules/ebay-audit.js`) finds every
  catalog item with an `ebayListingId` but no `listingDescription`
  (exactly the 17 items from the v3.13.29 batch, plus any future case of
  the same gap), fetches each one's real description from eBay in chunks
  of 10 (new `action:'backfill_descriptions'` in
  `api/ebay-listing-tools.js`, reusing `fetchListingDetails()` —
  migrate_listing's own description-capture call, just run retroactively
  here) and writes it straight to Firestore. Reports how many were
  backfilled, which items eBay had no description for at all, and which
  lookups failed (safe to rerun — it only re-targets items still missing
  a description). No new serverless function file — stays inside the
  already action-dispatched `ebay-listing-tools.js`, same as everything
  else added this session, so the Hobby-plan 12-function cap isn't
  touched.
- **v3.13.32** — Added a "Select all" checkbox above the eBay listing
  audit's shipping-mismatch list too (`#auditFixSelectAll` in
  `modules/ebay-audit.js`), same pattern as the invisible-listings one
  from v3.13.26 — a real run surfaced 102 shipping mismatches at once
  (the "USPS Ground + Priority (Buyer Pays)" policy switch from v3.13.29
  needed republishing every existing buyer-pays listing), so checking
  each row individually wasn't practical there either.
- **v3.13.33** — A real import hit a ReviseItem failure with a raw Trading
  API error array dumped as unreadable JSON ("Package girth is too
  large" / "Package dimensions exceeded maximum limit" for SKU #0643 —
  a genuine pre-existing shipping-service/package-size conflict on that
  specific legacy eBay listing, surfaced because ReviseItem revalidates
  the whole listing even for a SKU-only partial update; not a bug in
  this app, needs fixing directly on that eBay listing). Added
  `ebayErrorShortMessages()` in `modules/ebay-audit.js` to pull the
  Error-severity `ShortMessage`s out of a Trading API error array
  (skipping informational Warnings, like the standing "seller has opted
  into business policies" notice eBay attaches to most responses) and
  show them as a readable line above the raw JSON, which now collapses
  into a `<details>` toggle instead of always being shown expanded.
- **v3.13.34** — The eBay listing audit's invisible-listings row truncated
  title + price + "View ↗" link onto one `white-space:nowrap` line, so a
  long title clipped the link off entirely and made it unclickable (seen
  on a real $17-something wrench-set title). Split each row into two
  lines — title on its own truncated line, price + link always visible
  on the line below — so the link is never cut off regardless of title
  length.
- **v3.13.35** — The shipping-mismatch "Fix selected now" flow's failure
  summary only ever showed the generic top-level message ("Failed to
  create eBay inventory item") with no way to see why — unlike the
  invisible-listings import summary, which already got readable eBay
  error detail in v3.13.33. Applied the same `ebayErrorShortMessages()` +
  collapsed "Full eBay response" `<details>` treatment here too, reading
  off `result.detail` (the REST Inventory API's `{errors: [...]}` shape,
  which the same helper already handles via its `.message` fallback
  alongside the Trading API's `ShortMessage` shape).
- **v3.13.36** — The v3.13.35 error-detail fix immediately paid off:
  republishing "Express - Blouse" via "Fix selected now" failed with "A
  user error has occurred. Please provide a valid Shipping Package
  type." `buildInventoryItem()` in `api/ebay-list.js` never sent a
  `packageType` on `packageWeightAndSize` — apparel categories seem to
  trigger this requirement more than others, since a garment could
  plausibly ship as either an envelope or a box and eBay won't guess.
  Discussed with Vitor: rather than adding a real per-item package-type
  field (bigger scope — new form field, new stored value, a default for
  every already-cataloged item), defaulted `packageType` to
  `'MAILING_BOX'` unconditionally, same fallback-over-failure philosophy
  as the weight/dimensions defaults already sitting right above it in
  the same function.
- **v3.13.37** — `'MAILING_BOX'` (v3.13.36's fix) wasn't actually
  accepted everywhere either: republishing "Superdown Blazer Dress" hit
  errorId 25101 ("Invalid `<ShippingPackage>`.") — same class of
  category/marketplace-dependent inconsistency `extractMissingAspectName`
  already works around for item aspects, just for `packageType` instead.
  eBay's own error handed back what it actually wants in its
  `parameters` (format `"err:<code>|<value>"`, e.g.
  `"err:216305|MailingBoxes"`) — added `extractSuggestedPackageType()`
  in `api/ebay-list.js` to read that value and retry with it instead of
  the hardcoded default, folded into the same retry loop that already
  handles missing aspects (now checks both error shapes per attempt, up
  to 3 retries).
- **v3.13.38** — v3.13.37's "retry with eBay's suggested value" theory
  was wrong: retrying "Superdown Blazer Dress" with `"MailingBoxes"`
  (the value pulled from errorId 25101's parameters) hit a completely
  different error — `errorId 2004`, "Could not serialize field
  [packageWeightAndSize.packageType]" — meaning that string was never a
  valid REST enum literal at all, just some internal/legacy label eBay
  happened to echo back, not a usable replacement. There's no reliable
  way to derive a correct package type from this error, so
  `extractSuggestedPackageType()` was replaced with
  `isInvalidPackageTypeError()`, and the retry now just **omits**
  `packageType` entirely on errorId 25101 instead of guessing a second
  value — safe since the field wasn't sent at all before v3.13.36
  either, and the one confirmed case that genuinely requires it
  ("Express - Blouse") is still covered by the unconditional default on
  the first attempt.
- **v3.13.39** — Next item after the v3.13.38 fix hit a third distinct
  publish-retry class: errorId 25021 ("the provided condition id is
  invalid for the selected primary category id") on "Disney Pixar
  Monsters University 4 Pencils" (Toys/Collectibles) — despite
  `getValidConditionsForCategory` + `resolveCondition` already existing
  specifically to prevent this, meaning either that Metadata API lookup
  didn't return the category's true accepted list, or `resolveCondition`'s
  first pick from it (`validList[0]` when no `CONDITION_PREFERENCE` entry
  matched) wasn't actually valid — same Metadata/Taxonomy-vs-Inventory
  disagreement `extractMissingAspectName` already documents for aspects.
  Learned from v3.13.38's mistake not to guess a single replacement value —
  added `isInvalidConditionError()` + a retry that walks forward through
  the category's own valid-conditions list (or a small universal fallback
  list — NEW/NEW_OTHER/LIKE_NEW/USED_EXCELLENT/USED_VERY_GOOD/
  USED_ACCEPTABLE — if that list came back empty) one untried candidate at
  a time via a new `conditionOverride` param on `buildInventoryItem`,
  folded into the same retry loop as the aspect/packageType fixes (now
  handles all three error shapes per attempt, bumped to 4 retries to give
  the added condition search room).
- **v3.13.40** — Vitor came back to test voice narration (unrelated to
  the eBay work above — he wants it working for tomorrow) and hit
  "Couldn't reach the transcription service" with no way to see why: the
  narration UI's error paths (`!transcribeRes.ok`/`!extractRes.ok` in
  `modules/narration-capture.js`) only ever showed a fixed generic
  string, never the actual `error`/`detail` the server returned — same
  gap the eBay audit tool already had fixed for itself. Both now surface
  the real message and detail from `/api/narration`'s response, so the
  next failure is diagnosable without DevTools. Root cause of this
  particular failure not yet identified — waiting on the improved error
  text from a retry.
- **v3.13.41** — Root cause of v3.13.40's failure was simply a missing
  `DEEPGRAM_API_KEY` in Vercel (never got set, or a redeploy was
  needed) — confirmed once the real error message could actually be
  seen. Narration works now. Vitor then asked for a real behavior
  change: narrating a second time (e.g. adding measurements after an
  earlier pass already set brand/size/etc.) was overwriting `Notes`
  entirely instead of adding to it. `notes` now appends onto whatever
  is already in the field (`existing + '\n' + new`) instead of
  replacing it, and is excluded from the overwrite-confirmation check
  entirely — appending is never destructive, so there's nothing to
  confirm. Every other field keeps the existing confirm-before-
  overwrite behavior unchanged.
- **v3.13.42** — Vitor asked whether narration-dictated details with no
  dedicated field (fabric composition, shoulder-to-shoulder, length,
  etc. — everything that lands in Notes) actually reach the AI listing
  description generator. Confirmed yes: `requestAiListingDescription()`
  in `main.js` already sends `item.notes` verbatim as "Seller notes /
  flaws" in its prompt — nothing further needed there. Separately fixed
  the loading text on "Generate listing description with AI"
  (`generateListingDescriptionAI()`), which said "Writing a
  Poshmark-optimized listing…" with no indication this same description
  also becomes the eBay listing description — now says "…this same
  description is reused on eBay too" so that's not a surprise.
- **v3.13.43** — Two follow-ups from Vitor testing bulk eBay edits: (1)
  simplified the "Generate listing description with AI" loading text
  further, to just "Creating a special listing…" — the longer
  eBay-reuse explanation from v3.13.42 was more than he wanted there.
  (2) Real bug: a pencil (non-clothing item) got a generated description
  ending in "check my closet!" from a bulk description-generation run —
  the standard closing blurb (her configured `listingStandardText`, or
  the hardcoded closet fallback) was always appended regardless of
  category. Added a "Include my standard closing line" checkbox (checked
  by default, so clothing behavior is unchanged) next to both listing
  generator buttons in the item modal — unchecking it makes both
  `buildListingDescription()` (instant template) and
  `requestAiListingDescription()` (AI) skip the closet/bundle blurb
  entirely (the AI path asks for a neutral, item-appropriate closing
  line instead). For the bulk/automated generation path
  (`generateListingDescriptionForItem()`, no live checkbox to read),
  this is decided automatically from `item.category === 'Clothing'`
  instead — the exact fix for what actually happened to the pencil.

- **v3.13.44** — Started building out the Live Catalog ("Live Show") per
  Vitor's spec (2026-08-11): narration, color, photos, and a dedicated stock
  SKU. Design decisions confirmed with him first (prep-before-live
  narration, extended extraction fields, multi-photo, SKU format), then:
  (1) **Fixed a real pre-existing bug found along the way**: `live-catalog.js`
  already called `updateDoc`/`query`/`where` (toggling "Sold?", editing table
  fields, loading a session's item list) but `config/firebase.js` never
  imported or exported them — those calls were `undefined()`, meaning
  opening any live session with saved items, or editing/toggling anything
  in the table, threw immediately. Likely never caught because the feature
  hadn't been used with a populated session yet. Added `updateDoc`, `query`,
  `where`, `runTransaction` to `window.firestoreFns`. (2) Added voice
  narration to the Live Catalog quick-add form — new `modules/
  live-narration.js`, same record/transcribe/extract pipeline as the main
  modal's narration (`modules/narration-capture.js`, reuses `/api/
  narration.js` untouched), but its own extraction prompt/field set (tipo,
  brand, size, color, fabric, an array of measurements, and a new "Prep
  notes" field — kept separate from the existing per-item SALE notes field
  to avoid a naming collision). Fills existing blank measurement rows
  before adding new ones. (3) Added a Color field (form + table, same
  datalist-with-memory pattern as Tipo/Brand/Size/Fabric, seeded from the
  main catalog's `PRESET_COLORS`). (4) Added optional multi-photo capture —
  `compressImage()` (already used by the main catalog) client-side, then
  uploaded to Firebase Storage at `live-item-photos/{itemId}/...` on save
  (own path, fully separate from the real catalog's `item-photos/`), same
  "never store raw base64 in the Firestore doc" reasoning as
  `ensurePhotosHostedForSave` in `main.js`. Table shows a read-only
  thumbnail (click to open full-size) — not yet editable/removable after
  save, unlike every other field in the table; revisit if that gap matters
  in practice. (5) Added a Live-specific stock SKU, confirmed format
  `LV-0001-K`: `LV-` prefix + its own global counter (`live_catalog_options/
  skuCounter`, incremented via a Firestore transaction so concurrent adds
  during a live never collide) + a check letter computed from the number
  (weighted digit sum mod 26 → A-Z). Deliberately always ends in a LETTER,
  never a digit — the main catalog's `nextProductCode()` resumes its own
  sequence by matching a TRAILING digit run on `productCode` (see
  `catalog-lookups.js`), so a Live SKU ending in a raw number would risk
  being misread as a main-catalog code if the two systems ever cross paths
  (e.g. a future "promote to real catalog" flow) — ending in a letter
  structurally rules that out. (6) Added a mobile breakpoint (`@media
  (max-width: 720px)`) to `live-catalog.html` — Vitor confirmed narration
  will mainly happen from his phone during prep, and the form was desktop-
  grid-only before this. The items table still scrolls horizontally on
  mobile rather than reflowing into cards — revisit if that's the actual
  bottleneck once used for real. **Not yet tested against a real live
  session or real audio** — verified via `node --check` and a clean `vite
  build` only, same caveat as every other narration/Dashboard feature
  shipped this way. **Label printing (25-per-sheet inkjet sheet labels,
  he has a PDF/Word template to share) is a separate next step, not started
  yet** — waiting on that template file before designing the print layout.

- **v3.13.45** — Added label printing to the Live Catalog, per the Avery
  5260 template Vitor shared (1" x 2-5/8", 3 columns x 10 rows = 30 labels
  per sheet, standard letter-size inkjet sheet — he'd said "25 per sheet"
  going in, but the actual template is 30). Grid coordinates
  (`LABEL_LEFT_IN`/`LABEL_TOP_IN`/`LABEL_PITCH_X_IN`/`LABEL_PITCH_Y_IN` in
  `live-catalog.js`) match Avery's own published spec for this template:
  0.1875in left margin, 0.5in top margin, 2.75in horizontal pitch (label
  width + gutter), 1in vertical pitch (no row gap). Each row in the items
  table got a "Print?" checkbox (+ a "Select all" toggle) and a toolbar
  above the table with a "Start at label #" field (1-30, so a sheet with
  some labels already used elsewhere can be resumed instead of always
  starting top-left) and a "🖨️ Print labels" button. Printing builds a
  `#lcPrintOverlay` sheet (one `.lc-label-sheet` div per 30 labels, using
  `@media print` to hide the rest of the page and blank `.lc-label` cells
  to pad up to the chosen start position) and calls `window.print()` —
  each browser's native print dialog handles the actual paper-size/margin
  confirmation. Each label shows SKU (large, monospace), Tipo · Size,
  Brand, and the live "#" — no price (not tracked pre-sale in this tool)
  and no photo/measurements (label is physically too small; those stay in
  the app). **Not yet tested against a real printer/real Avery 5260
  sheet** — verified via `node --check` and a clean `vite build` only; the
  coordinate math follows Avery's published spec but print margins vary
  slightly by printer/browser, so the first real sheet should be checked
  against actual peel-off label alignment before printing a full batch.

- **v3.13.46** — Found the actual reason Vitor couldn't find the Live
  Catalog link on mobile: the "🔴 Live" link only ever existed in
  `#sidebarNav` (`index.html`), which is hidden below the 900px desktop
  breakpoint — mobile uses the separate `.tabs` bar instead, which never
  got the same link when Live Catalog shipped (v3.13.6). Added a matching
  `<a class="tab-btn" href="/live-catalog.html">🔴 Live</a>` to `.tabs`.
  Needed one CSS fix to look right there: `.tab-btn` never set
  `text-decoration:none` (only `.sidebar-link` did), so as a bare `<a>`
  it would've rendered underlined unlike its sibling `<button>` tabs —
  added `text-decoration:none; display:inline-block;` to `.tab-btn`.

- **v3.13.47** — Feedback from the first real test pass on Live Catalog
  (2026-08-11): (1) **Likely fixed** the "print labels does nothing on
  phone, works fine on PC" report — the print button's handler called
  `confirm()` when no rows were checked, then `window.print()` afterward;
  iOS Safari can silently drop a `window.print()` call if it happens after
  a blocking dialog or any gap since the click, because that breaks the
  "direct user activation" requirement (desktop browsers are looser about
  this, which is why it worked there). Replaced the confirm() with plain
  modal text ("No rows checked — this will print all N items") so
  `window.print()` now fires synchronously inside the click handler with
  nothing in between. **Not yet confirmed on a real phone** — the
  mechanism matches the symptom exactly, but should be tested for real
  before assuming it's fully resolved. (2) Replaced the old
  straight-to-print flow with a "⚙️ Label settings & print" modal
  (`#lcLabelConfigOverlay`) — lets her choose which fields print (SKU,
  Live #, Tipo, Brand, Size, Color — all optional now, previously
  hardcoded) with a live on-screen preview of up to 6 real labels before
  committing paper, addressing "não tem como saber como vai ficar antes
  de imprimir." Last-used field/mode choices persist to
  `live_catalog_options/main` (`labelConfig`) so she doesn't reconfigure
  every time. (3) Added a second label type alongside the existing Avery
  5260 sheet: "Thermal / continuous roll" — a vertical strip of labels
  (one per item) sized to a chosen dimension (dropdown presets: 4"×6"
  shipping label — the default, per her request — 4"×3", or the existing
  2.25"×1.25" small-thermal size already used by the main catalog's own
  label printer; "Custom size…" reveals width/height inputs), with a
  dashed "✂ cut here" guide line between each label and `@page{size:Win
  auto}` (via an injected `<style>` tag, later in source order than the
  sheet mode's default `@page` rule so it wins when active) so a
  continuous-feed printer isn't forced into a fixed page height. (4)
  Capped optional item photos at 6 (`MAX_LIVE_PHOTOS`) — the "+" button
  hides once the limit is hit; adding was already on-demand per photo
  before this, just uncapped. (5) Fixed the login screen flashing on
  every navigation to/from Live Catalog (and on every hard reload of the
  main app too — same root cause, both fixed together): `#authOverlay`
  was visible with the actual login FORM shown by default in the HTML,
  so even an already-signed-in user saw it flash for the ~1 frame+ it
  takes Firebase's async `onAuthStateChanged` to confirm they're logged
  in. Added a neutral "Checking your session…" placeholder
  (`#authCheckingState`) shown by default instead — the real login form
  only appears if the check actually determines she's logged out.

- **v3.13.48** — First real regression from this whole Live Catalog thread:
  the entire page broke right after v3.13.47 shipped — raw CSS text
  dumped visibly onto the page instead of being applied as styles. Cause:
  a CSS comment in `live-catalog.html` explaining the thermal-mode
  `@page` override literally contained the string `</style>` (documenting
  that thermal mode injects its own `<style>@page{...}</style>` tag) —
  the HTML parser closes a `<style>` element on the first `</style>`
  byte-sequence it sees, with **zero regard for CSS comment syntax**,
  since `<style>` content is parsed as raw text, not CSS. That closed the
  real stylesheet block early, and every rule after it (the rest of the
  file's CSS) became literal visible page text instead of being parsed as
  CSS. Fixed by rewording the comment to avoid the literal sequence.
  **Lesson**: never write a literal `</style>` (or `</script>`) inside a
  `<style>`/`<script>` block for ANY reason, including comments and
  documentation — the HTML tokenizer doesn't parse CSS/JS comment syntax
  before scanning for the closing tag sequence.

- **v3.13.49** — Vitor pointed out a real gap: every other field in the
  Live Catalog items table is inline-editable after save (tipo, brand,
  size, color, fabric, prep notes), but photos were view-only —
  documented as a known limitation when photos shipped (v3.13.44) and now
  actually fixed. Photo cell got a "✎ Edit" button opening a small modal
  (`#lcPhotoEditOverlay`) that shows the item's current photos with
  remove (✕) buttons and an "add photo" tile — same compress/upload
  pipeline as the quick-add form (`compressImage()` → Firebase Storage
  under `live-item-photos/{itemId}/...`), capped at the same
  `MAX_LIVE_PHOTOS` (6), each add/remove written straight to Firestore
  immediately (same pattern the rest of the table already uses, no
  separate "save" step).

- **v3.13.50** — Vitor found the SKU's check-letter suffix (`LV-0001-K`)
  confusing on a printed label — asked to keep only the `LV-` prefix as
  the differentiator from the main catalog. Simplified `formatLiveSku()`
  to just `LV-0001` (dropped `skuCheckLetter()` entirely). Live items live
  in their own `liveItems` Firestore collection, never inside the main
  catalog's `items` array, so there's no actual collision risk with
  `nextProductCode()` today regardless of whether the SKU ends in a
  letter or a digit — that concern only mattered for a hypothetical future
  "promote to real catalog" flow, which doesn't exist yet.

- **v3.13.51** — Real "List on eBay" failure on a Universal Thread Goods
  Co. skirt: errorId 25101 ("Invalid `<ShippingPackage>`.") at the
  **publish** step, not the inventory-item step — the adapt-and-retry
  loop that v3.13.36-39 built for exactly this error (drop `packageType`,
  walk conditions, fill missing aspects) only ever wrapped the step 1
  inventory-item `PUT`, because every prior failure of this class had
  surfaced there. Turns out eBay doesn't fully validate `packageType`/
  aspects/condition until the offer is actually published — a bad value
  can sail through step 1 with no error and only fail at step 3. Wrapped
  the publish call in the identical retry loop (same three detectors,
  same override variables): on a fixable publish error, adjust the
  override, re-PUT the inventory item with it, then retry publish, up to
  4 attempts. **Not yet re-tested against a real account** — same
  unverified caveat as the rest of this eBay-retry thread; watch the next
  publish attempt on a similar category to confirm this closes the gap.

- **v3.13.52** — AI photo analysis (the "🔮 Analyze with AI" card in the
  item modal) now persists on the item the same way the generated listing
  description already did — previously it only ever lived in the DOM for
  that modal session, so closing and reopening an item wiped it and made
  her regenerate it just to see it again (and burn another AI-usage credit
  in the process). New `item.aiAnalysis` field, kept in sync via a
  `currentAiAnalysis` variable set whenever a new analysis is generated,
  restored (`renderAiAnalysis`) when reopening an item that has one, and
  cleared when she taps "Dismiss" on the card. Saved alongside
  `listingDescription` in the same item-save payload.

- **v3.13.53** — Fixed style tags sometimes coming back empty on "Generate
  listing description with AI." Root cause: the JSON template in the
  prompt showed `title`/`description` as string fields with the
  instructions embedded directly as their value (fine for strings), but
  `style_tags` is an array and its "example" was a single giant
  instruction string as the one array element instead of an actual array
  example — an ambiguous shape that sometimes led the model to return
  `style_tags` as a plain string or omit it, which `Array.isArray(...)`
  then silently turned into `[]` with no error shown. Moved the
  instruction out of the JSON template into its own paragraph (now shows
  a clean `["tag1", "tag2", "tag3"]` example) and made parsing tolerant
  of a comma-separated string as a fallback shape, in
  `requestAiListingDescription()` (`src/main.js`).

- **v3.13.54** — Fixed Gender and Size never getting filled in by "Apply
  to form" after an AI photo analysis, even when the field is available
  from voice narration (`narration-capture.js` already extracts and
  applies both). Root cause: the photo-analysis JSON schema in
  `analyzeItemPhoto()` (`src/main.js`) never asked for `likely_gender`/
  `likely_size` at all — the fields simply weren't part of what the AI
  was asked to return, not a bug in applying an existing value. Added
  both fields to the prompt (size from a legible tag/label only, never
  guessed; gender inferred from cut/styling/tag when confident), added
  matching Gender (dropdown, same options as the form) and Size (text)
  inputs to the review card, and wired them into "Apply to form" the
  same way Brand/Color/Clothing type already work.

- **v3.13.55** — eBay's "Size Type" item aspect (Regular/Plus/Petite/Tall/
  Big & Tall/...) now defaults to "Regular" for Clothing, per Vitor's
  request — it's the overwhelming common case, so she shouldn't have to
  set it by hand on every single garment. New `applyDefaultSizeTypeIfEmpty()`
  in `src/main.js`, hooked into the same trigger points
  `applyDefaultClothingShippingIfEmpty()` already uses (Category dropdown
  change, typing "Clothing" into the custom-category field, and opening
  the modal for a new/duplicated item) — never overwrites a value already
  set, same "only fill if empty" rule as the shipping default. Also added
  `likely_size_type` to the AI photo-analysis prompt (`analyzeItemPhoto()`)
  so if the tag/label or the garment's visible cut clearly indicates
  something other than Regular (Plus, Petite, Tall, Big & Tall, Maternity,
  Juniors), "Apply to form" overrides the Regular default with the AI's
  finding instead of leaving it wrong.

- **v3.13.56** — Two autosave requests from Vitor: (1) Clicking "Generate
  listing description" (either the instant template or the AI writer) on
  a never-saved item used to trigger the normal Save button's validation
  once the description came back, which alerts "Choose an eBay category
  before saving" and blocks the autosave — jarring right after watching
  the AI write something. Extracted the manual Save button's click
  handler into a named `saveItemFlow({ skipValidation, suppressReopen })`
  function: `skipValidation` skips the name-required (defaults to "Item",
  same fallback the listing generators already use) and eBay-category-
  required checks — the eBay category only actually matters once she
  tries to list on eBay, which already checks for it independently, so
  gating a listing-description save behind it was never load-bearing, just
  in the way. `autosaveGeneratedListingText()` (already called after both
  generators) now calls `saveItemFlow({ skipValidation: true })` instead
  of `.click()`-ing the button, and the instant-template generator
  (`generateListingDescription()`) now calls it too — previously it never
  autosaved at all, unlike the AI version. (2) Closing the item modal (✕
  or Cancel) with more than 4 photos already added now autosaves first
  instead of silently discarding them — new
  `closeModalWithAutosaveIfNeeded()`, calls `saveItemFlow({
  skipValidation: true, suppressReopen: true })` (the new `suppressReopen`
  flag skips the normal post-save reopen-the-modal step, since the whole
  point here is that the modal is about to close) before actually closing.
  4 photos or fewer closes exactly as before — cheap to redo, not worth a
  silent save.

- **v3.13.57** — The Catalog's "⚠ Missing info" pill now shows exactly
  what's missing on click, instead of requiring a trip into the item
  modal to find out. New `showMissingInfoPopover()` in `src/main.js`
  renders a small floating popover (positioned under the tapped chip,
  dismissed on outside click or Escape) listing whichever of
  Photos/Cost/Weight/Dimensions `missingFields()` (already in
  `catalog-filters.js`, unchanged) flags — no new completeness logic,
  just surfacing what already existed. Wired into the same card-click
  handler that already special-cases the print-label button and photo
  gallery, so tapping the chip shows the popover instead of opening the
  item.

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
