# Project conventions — Calculated Chaos

Reseller catalog app (eBay/Poshmark/Mercari/Depop/Vinted): Vite SPA +
Firebase (Auth/Firestore/Storage) + Vercel serverless functions in `api/`.
Vitor gives the instructions in these sessions. Older notes call the
seller who uses the app day to day "she".

This file is loaded every session, so keep it short: rules, map, gotchas,
open items. Feature write-ups live in `docs/`, release history in
`CHANGELOG.md` (+ `docs/v3.13-patch-notes.md` for the detailed v3.13.x
notes).

## Rules

### Always confirm before changing anything (2026-10-14)

Vitor's standing rule: **before starting ANY change to this project,
describe what will be changed and wait for his explicit confirmation.**
This covers code, config, `CLAUDE.md` itself, version bumps, commits,
pushes, and PRs. There are no exceptions for "small" or "obvious" fixes.
Evaluation, reading code, diagnosing, and planning need no confirmation;
acting on the plan does. If he says a session is "evaluation/planning
only", make no changes at all in it.

This rule wins over any automated hook or reminder asking to commit/push
(e.g. a stop hook flagging uncommitted changes): say what's pending and
wait.

### Git workflow

- Work on the session's named branch and open a PR per change. Whether a
  session binds to `main` or a branch is set when the session is created,
  not by Claude. Vitor is fine with the branch+PR pattern (2026-08-10).
- **Merging ("always", 2026-08-11)**: merge each PR once it's open and
  green, without asking again. This applies only to changes he already
  confirmed under the rule above.
- If the branch's previous PR was already merged, restart the branch from
  `origin/main` before new work.

### Versioning

- `APP_VERSION` / `APP_VERSION_DATE` in `src/modules/version.js`, format
  `vMAJOR.MINOR.PATCH`. Bump with every meaningful change.
- `CHANGELOG.md` gets one entry per **minor** version, not per patch. Track patch changes in "Pending
  changelog entry" below. **Bump the minor every ~10-15 patches or when a
  theme wraps up**, fold the pending list into `CHANGELOG.md`, and clear it.
  v3.13 ran to .118 without this and the list grew to 2,000+ lines.

### Everything in US English (2026-10-19)

All code and production content is in American English, with no
exceptions:
- everything the app renders (buttons, alerts, status boxes, placeholders,
  AI-generated listing text);
- code comments;
- `CHANGELOG.md`, `CLAUDE.md` and everything in `docs/`;
- commit messages and PR descriptions.

Only the chat with Vitor may be in Portuguese. The one exception is
internal Firestore data keys (`vendido`, `catalogado`, `anunciado`,
`novo_etiqueta`, `excelente`, …): they're never shown to the user, and
renaming them needs a data migration of every saved item.

## Commands & verification

- `npm run dev` (Vite only, no `api/`), `npm run dev:vercel` (with
  functions), `npm run build` (same build Vercel runs). Deploys happen
  automatically on push to `main`.
- There are no automated tests. The standard check before a commit is
  `node --check` on every touched file plus a clean `npm run build`.
  Optionally, add a headless-Chromium load up to the login screen (no JS
  errors). Firebase, eBay and the AI APIs aren't reachable from the sandbox.
  **Say plainly when something was only build-verified** and add it to
  "Unverified in production" below.

## Code map

- `src/main.js`: ~5,000 lines, one IIFE (`export const app = (function(){…})()`).
  Holds the catalog, item modal, measure tool, AI flows and reports UI.
  See `docs/modularization.md`.
- **Layers for new code (v3.17.2, `docs/modularization.md`)**:
  `src/domain/` = pure logic (no DOM, `window`, Firebase or app state;
  settings come in as parameters), `src/ui/` = DOM + shared state,
  `src/platform/` = device/environment APIs (print, files, clipboard,
  API base URL), so a Capacitor app only swaps the platform layer;
  `src/data/` = Firestore reads/writes through `bizCol()`/`bizDoc()`
  (v3.17.5).
  Extract with a characterization test (old vs new, identical output).
  - `domain/listing-copy.js`: listing title/description builders.
  - `domain/home-summary.js` + `ui/home/home-view.js`: the Home screen
    (v3.20.0): summary by period, pipeline, "Needs attention", revenue
    by platform. Period and dismissed rows are per-device (localStorage).
  - `ui/lightbox.js`: `openLightbox(photos, index)`; its state is private.
  - `ui/label-render.js`: label preview markup + canvas drawing.
  - `ui/labels/`: print modal (`openBatchLabelModal`), Quick Labels,
    storage boxes, Stock Transfer (v3.17.3).
  - `domain/product-code-match.js`: typed digits → item.
  - `data/settings-store.js`: `loadSettings`/`saveSettings` (the
    v3.13.96 guards: a failed read never saves, saves merge) and the AI
    usage counter.
  - `ui/settings/`: the Settings screen (`settings-view.js`), admin
    panels, eBay panel, platforms/fees, save handlers (`forms.js`);
    `index.js` registers their `window.*` handlers (v3.17.6).
  - `platform/print.js` (`printHtml`, keep it synchronous) and
    `platform/files.js` (`saveOrShareFile`, `downloadBlob`,
    `downloadUrl`). `main.js` saves no file by itself (v3.17.4).
- `src/ebay-api.js`: client side of eBay publish/bulk publish/error box.
- Live Catalog: **removed in v3.19.0** (last in commit `662ca33d68ec`,
  tag `live-catalog-last`,
  `docs/live-catalog.md`). Its data is frozen, readable only by admins.
- `src/admin.js` + `admin.html`: Developer Panel, a separate Vite entry
  for admins only (access requests, users, eBay status, eBay error
  library, backup, server health). New platform-admin features go here, not in Settings.
- `src/modules/`: pure helpers and small controllers. Key ones:
  - `state.js`: shared `items`/`appSettings`.
  - `biz.js`: `bizCol()`/`bizDoc()`. **All business data goes through
    them** (items, drafts, counters, settings, eBay error log) by logical name. `loadActiveBusiness()` at sign-in picks
    `businesses/{bizId}/…` when the user's business is live, else the
    pre-business root collections. Global data (`users`,
    `ebay_category_cache`) and the Developer Panel don't use them.
  - `constants.js`, `pricing.js`, `settings.js`.
  - `ai-item.js`: ✨ analysis prompt + schema (imported by the server).
  - `narration-prompts.js`: narration extract prompts (server-side).
  - `narration-capture.js`.
  - `ebay-audit.js`, `ebay-error-hints.js`/`-log.js`/`-ai.js`,
    `ebay-size.js`, `ebay-aspect-match.js`, `ebay-type-map.js`.
  - `product-code-bank.js`, `sold-confirm.js`.
- `api/`: **12 route functions = the Vercel Hobby cap (full since
  v3.15.4)**. Add an `action`/`mode` to an existing file; a new file
  needs Vercel Pro. Underscore files (`_requireApprovedUser.js`,
  `_firebaseAdmin.js`) don't count.
  - `platform.js`: platform-admin actions for the Developer Panel
    (`health`, `migrate_status`, `migrate_copy`). New platform operations
    (businesses, credits, admin claims) go here as new actions; put the
    logic in an underscore file like `_migration.js`.
  - `_ebayToken.js`: the server-only eBay connection (v3.16.0). Every eBay
    endpoint calls `getEbayAccessToken()`; never accept an eBay token from
    the browser again.
  - `_firebaseAdmin.js`: Firebase Admin from `FIREBASE_SERVICE_ACCOUNT`
    (never throws; returns `{ ok:false, error }`). `_requireApprovedUser.js`
    verifies tokens with it and falls back to the old Firestore-REST check
    if it's unavailable.
  - `analyze-photo.js`: ✨ analysis, `mode: full | listing_only`, Sonnet 5.5
    at `effort: low`, with server-side refusal `fallbacks`. Builds the
    prompt itself from item data (`buildItemAiRequest()`); never accept a
    prompt from the browser again.
  - `narration.js`: `transcribe` (Deepgram) / `extract` (Haiku 4.5,
    prompts in `src/modules/narration-prompts.js`).
  - `ebay-item-aspects.js`: category aspects, `suggest_fee`,
    `explain_error`.
  - `ebay-listing-tools.js`: audit, legacy scan/migrate, backfill,
    policies, offers.
  - `ebay-list.js`: publish, with the adapt-and-retry loop.
  - `ebay-auth.js`: OAuth (`url` + `callback`, linked by a one-time
    `state` code; the callback stores the tokens itself) plus `status`,
    `username`, `disconnect` on the server-held connection.
  - `ebay-setup.js`, `ebay-category-search.js`,
    `ebay-check-sales.js`, `ebay-end-listing.js`.
  - `ebay-account-deletion.js` and `ebay-auth.js` have URLs registered in
    eBay's developer portal. **Never rename or merge them.**
- Vercel env vars: `ANTHROPIC_API_KEY`, `DEEPGRAM_API_KEY`, `EBAY_CLIENT_ID`,
  `EBAY_CLIENT_SECRET`, `EBAY_REDIRECT_URI`, `EBAY_SANDBOX`,
  `EBAY_FULFILLMENT_POLICY_ID`, `EBAY_FULFILLMENT_POLICY_ID_BUYER_PAYS`,
  `EBAY_PAYMENT_POLICY_ID`, `EBAY_RETURN_POLICY_ID`,
  `EBAY_MERCHANT_LOCATION_KEY`, `EBAY_DELETION_ENDPOINT_URL`,
  `EBAY_DELETION_VERIFICATION_TOKEN`, `FIREBASE_SERVICE_ACCOUNT` (the
  whole service-account .json; secret, never paste it in chat or the repo).
  Optional: `FIREBASE_PROJECT_ID` (defaults to `calculated-chaos-4027a`).
- Platform admins (v3.18.1): Vitor and Jasmine, listed by uid in
  `PLATFORM_ADMIN_UIDS` (`api/_firebaseAdmin.js`), the only list.
  Developer Panel → App → "Sync admin access" copies it onto the accounts
  as the `platformAdmin` custom claim (`api/_adminClaims.js`); the rules
  (`isAdmin()`) and the app (`src/modules/admin-claim.js`) read only the
  claim. After changing the list, run the sync.
- Firestore collections and docs:
  - Catalog and app data: `items`, `drafts`, `users` (role/status),
    `app_config/settings`, `app_settings/productCodeCounter`,
    `ebay_error_log`.
  - `ebay_connections/main`: eBay tokens, server only (no client rule).
    The pre-v3.16.0 `ebay_tokens/main` copy and its rule were removed in
    v3.16.1. `ebay_oauth_states/*`: one-time connect codes (v3.16.2),
    server only too.
  - Multi-business (v3.17.0): `businesses/{bizId}` (`live` = the switch;
    server-written) with `items`, `drafts`, `ebay_error_log`,
    `counters/*`, `config/settings` (members read/write), `members/*`
    (server-written) and the frozen `liveSessions`, `liveItems`,
    `options/main` (admins read only, v3.19.0);
    `ebay_connections/{bizId}`; `users.activeBizId`; `platform/migration`
    (fixed bizId, `lastCopiedAt`, `switchedAt`; server only). Once live,
    the root business collections are read-only for that business's
    members (`rootWritable()` in the rules).
  - Frozen Live Catalog data at the root: `liveSessions`, `liveItems`,
    `live_catalog_options/*` (admins read only, v3.19.0). Nothing deleted.
  - Security rules: the live copy is in the Firebase Console; `firestore.rules`
    is a versioned copy (no deploy step). Change both together.

## Gotchas (each one caused a real bug)

- **`api/` files must use `export default`**, never `module.exports`.
  `package.json` is `"type": "module"`, so CJS crashes at import with
  Vercel's non-JSON "A server error has occurred" page (v3.13.14).
- **Never write a literal `</style>` or `</script>` inside a style/script
  block**, not even in a comment. The HTML parser closes the block there
  (v3.13.48).
- **`saveItem()` uses `setDoc()` = full replace.** Any field with no form
  input must be carried forward explicitly in `saveItemFlow()`, or a plain
  save wipes it (the eBay listing ID was lost this way, v3.13.94). Settings
  saves use `{ merge: true }`, and a failed settings read must never
  trigger a save (data loss, v3.13.96).
- **eBay errors: never guess a replacement value.** Omit the field or walk
  eBay's own allowed list. A "suggested" value echoed in an error once
  turned out not to be a valid enum (v3.13.37/38). eBay may validate only
  at publish, not at the inventory PUT (v3.13.51). Taxonomy "required"
  lists and the real Inventory API rules disagree; that's expected.
- **Don't recreate an input element on every keystroke**. iOS resets the
  keyboard (123 → ABC). Re-render only the results list (v3.13.73). Don't
  re-attempt the custom numeric bar for search without a new ask from
  Vitor (v3.13.75).
- **iOS Safari: `window.print()` must run synchronously in the click
  handler.** It's dropped after a `confirm()` (v3.13.47).
- **Vercel request body limit ~4.5 MB**: shrink local `data:` photos
  before sending them to the AI (`buildAiImageBlocks()`, v3.13.61). Hobby
  plan `maxDuration` isn't reliable for long chatty calls, so chunk them
  client-side instead (v3.13.21).
- **Thermal printer is monochrome**: yellow (like the ⚠️ emoji) prints as
  white. Draw label icons in solid black (v3.13.114).
- **Label printing has one pipeline**: every print goes through
  `openBatchLabelModal([...])`. Don't add a second implementation
  (v3.13.99).

## Open items

- **Multi-business (paid, for new sellers)**: the app runs on business
  data since 2026-10-19 (v3.17.0 switch confirmed in production).
  The `main.js` split's planned phases are done (1-3, v3.17.2-6; phase
  4 is "when next touched"). Next, in order: auth hardening
  (`docs/multi-tenant.md` step 4a, decided 2026-10-19: Vitor and Jasmine
  stay platform admins; Remove disables the account; only verified
  emails get access). PRs: (1) claim, first half (v3.18.0, synced in
  production); (2) only the claim, admins by UID (v3.18.1); (3)
  Remove/Deny/employee creation through the server (v3.18.2);
  (4) verification on request (v3.18.3; **never send verification
  emails automatically**, Vitor 2026-10-19: only the person's own click
  sends one); (5) verified email required (v3.18.4, after both accounts
  verified). Then
  Google sign-in, App Check, admin 2FA, then onboarding/invites (step 5). The root collections stay, read-only for the business's
  members, until Vitor confirms removing them.
- **General eBay review**: Vitor plans to review the whole eBay flow soon
  (2026-10-19). The shipping-policy bug is considered resolved; see
  `docs/ebay-shipping-policy.md`.
- **Employee accounts are mostly UI-restricted**. Since v3.16.0 the server
  blocks employees from connecting/disconnecting eBay, but Firestore rules
  still let them read/write the catalog and settings
  (`docs/employee-accounts.md`).
- **`public/sw.js` caches every same-origin GET, `/api/` included**, and
  answers `index.html` offline. All API calls are POST today, so nothing
  breaks, but it should skip `/api/` (separate change).
- **Model update**: `analyze-photo.js` moved to `claude-sonnet-5-5` at
  `effort: low` (v3.14.1). `suggest_fee` still uses `claude-sonnet-4-6`
  and `narration.js` extract uses `claude-haiku-4-5`; those switches are
  left for a separate change. Check the `claude-api` skill for current IDs
  before doing them.
- **Watch the Vercel logs** for `ai-usage` lines with `"structured":false`
  (the structured-output fallback ran on `analyze-photo.js`).
- **Verified email required (v3.18.4)**: `isVerified()` in the rules
  (inside `isApproved()` and `isAdmin()`), `requireApprovedUser()` on the
  server, and the sign-in gates of the app and Developer Panel (`tokenEmailVerified()`, which reads the token the rules see).
  New employees must have a real email: they verify on first sign-in.

### Unverified in production (build-verified only)

Last known status per the v3.13 notes. Confirm with Vitor before relying
on any of these:
- New shell and Home (v3.20.0): Node test of `computeHomeSummary` (periods,
  pipeline, every attention row, platform revenue), Chromium screenshots
  of the dev build with sample data injected (phone and desktop: Home,
  "+" menu, the "Set prices" link opening the filtered catalog, Stock,
  Finances and Reports tabs, a dismissed row), no page errors, no
  horizontal scroll at 390px, clean build. Unconfirmed on a real phone:
  everything with real data, the safe-area spacing on iPhone, Settings →
  Account (Check for updates, Sign out), an employee's view.
- Finances profit from saved `netProfit` + "Other costs" box (v3.19.1):
  Node test running the real `renderFinance()` on sample sales (before:
  Finances $89.20 vs stats strip $83.70; after: both $83.70). Unconfirmed
  in production: the Finances screen with real data.
- Live Catalog removed (v3.19.0): rules pasted in the Console, tag
  `live-catalog-last` on GitHub; Vitor confirmed the app and catalog load
  and item narration works (2026-10-19). Still unconfirmed: the Developer
  Panel backup still including the Live collections.
- Verified email required (v3.18.4): 19 emulator rules tests, server
  test of both `requireApprovedUser` paths, `tokenEmailVerified()` unit
  test, a screenshot of the "Verify your email" screen, clean build and
  page loads. Unconfirmed in production: both admins still opening the
  app and Developer Panel after the rules paste; eBay/AI
  calls still working; a new employee going through the verify screen.
- Email verification on request (v3.18.3): helper unit test with a fake
  user, a Chromium screenshot of the pending screen, clean build and page
  loads. Unconfirmed in production: the email arriving, the link, "I've
  verified it" and the Developer Panel column turning to verified.
- User management on the server (v3.18.2): handler test with a fake
  Firestore and Auth (10 cases: remove/restore order and round trip,
  guards, deny, employee create with rollback, sign-in details).
  Unconfirmed in production: Remove/Restore/Deny in the Developer Panel,
  creating an employee in Settings, the sign-in details column.
- Admin claim only (v3.18.1): 18 emulator rules tests (an admin email
  without the claim is denied), handler test with a fake Firebase Auth,
  clean build and page loads. Unconfirmed in production: the Developer
  Panel opening, the Developer Panel button and pending count in
  Settings, approving a user, for both admins. (v3.18.0's sync itself
  was confirmed: both accounts show the claim.)
- ✨ analysis on Sonnet 5.5 / low effort, refusal fallback and the new
  "declined" message (v3.14.1).
- eBay tokens on the server (v3.16.0): Vitor confirmed Test connection,
  publish, offers and audit in production (2026-10-19). Still unconfirmed:
  mark as sold → end listing, check sales, setup.
- eBay connect without copy-paste (v3.16.2): a real reconnect worked
  (`authorizedAt` saved, Test connection OK, 2026-10-19), but the tab
  showed "already used" because the callback loaded twice. The v3.16.3
  fix (a repeat load shows the first load's result) is tested only with a
  stubbed Firestore and eBay (18 handler tests, including a simultaneous
  double load).
- main.js split phase 1 (v3.17.2): characterization test (79 cases,
  old vs new identical: listing text, label HTML byte for byte, label
  canvas pixel for pixel) and a lightbox behavior test in Chromium; the
  real app (photo viewer, label printing, listing generator) is
  unconfirmed.
- main.js split phase 2 (v3.17.3): characterization test in Chromium on
  the real `index.html` markup (195 recorded entries, old vs new
  identical: screens, print, share, download, saves, PDF calls), plus a
  clean load of the built app. Unconfirmed on real devices: printing and
  saving item/batch/box labels and the wall marker, Quick Labels (queue
  and PDF), storage boxes in Settings, Stock Transfer.
- File saving on the platform adapter (v3.17.4): old vs new test (19
  entries identical); unconfirmed on a phone: measure tool "save labeled
  photo", photo download (one and "save all"), the three CSV exports.
- Settings store in `src/data/` (v3.17.5): Node test with a stubbed
  Firestore (49 entries identical); unconfirmed in production: settings
  load at sign-in, saves from Settings, AI counter increments/reset.
- Settings screen in `ui/settings/` (v3.17.6): Chromium test on the real
  markup (204 entries identical); unconfirmed in production: every
  Settings section, its save buttons, platform fees/tiers, Suggest %, the
  eBay buttons (test, disconnect, setup, offers), employee creation.
- Server-built AI prompts (v3.15.3): golden test (prompt text identical)
  and handler tests with a mocked fetch; ✨ analyze, rewrite and both
  narration flows are unconfirmed against the real API.
- eBay endpoint auth (v3.15.1): publish works in production (see
  v3.16.0); connect, check sales and end listing are unconfirmed.
- ✨ analyze + auto-apply + Redo (v3.13.115-117), NWT checkbox (v3.13.116).
- eBay error library, AI explanation, aspect matching, Type auto-fill
  (v3.13.108-110), publish-step retry loop (v3.13.51).
- Quick Labels one-by-one queue and PDF export (v3.13.106/107), label font
  sizing (v3.13.102-105), inspection flag icon (v3.13.114).

## Pending changelog entry (since v3.20.0)

(none yet)

## Backlog (not started)

### 1. Structure the "✨ Analyze & write listing" prompt with tags

From an external review (2026-10-19). `buildAnalyzeAndWritePrompt()` in
`src/modules/ai-item.js` mixes the task, the JSON output format, the
option lists (`PRESET_COLORS`, `PRESET_CLOTHING_TYPES`, `categoryOptions`,
pasted inline mid-sentence) and the sale history (`priceHistory`, raw JSON
inside the price bullet) in one string. The proposal is to split it into
tagged blocks (`<instructions>`, `<valid_options>`, `<sales_history>`)
that the rules refer to by name. The gain is modest: seller data and Part
A/B are already separated, the JSON shape is enforced by structured
output, and cost barely changes. It's mainly clarity. Scope: reorganize
the text only, with no rule or field changes. Test on 3-5 real items.

### 2. Move fixed AI rules into a `system` prompt with caching

The security half is done (v3.15.3: prompts are built on the server). What
remains is caching: the fixed rules are most of the ~2,600-token prompt
but come after the photos in one user message, so nothing caches. Put
them in `system` with `cache_control`. Savings are modest, since images
dominate cost. Check the minimum cacheable length first. Do this together
with item 1 (planned as PR "5b"); it changes the prompt text, so test on
3-5 real items.

### 3. Give "🔍 Suggest %" (platform fee) web search

`handleSuggestFee()` in `api/ebay-item-aspects.js` answers from training
memory, and its prompt says "never refuse", which invites a confident
guess. Fees change often (Vinted 5% → $0, Depop dropped commission).
Proposal:
- Add the server-side `web_search` tool (`max_uses` 1-2).
- Return the source URL(s) and show them in Settings next to the
  suggestion.
- Drop the "never refuse" line.

It costs a few cents per click, and it's a rare action. It still returns
one flat %, so the `note` should say when a fee is tiered; tiered
platforms keep using the tiered editor.

### 4. Import an existing spreadsheet (CSV or Excel) — next

Decided with Vitor 2026-10-19. Goal: a new seller/business brings the
Excel sheet they use today as their inventory and sales control, through
a guided page, with AI analysis of the columns. It's a standalone
"Import" screen (reachable from Settings now; onboarding, step 5, will
link to it later).

The guided page, five steps:
1. **Upload** CSV or Excel, parsed in the browser with SheetJS (already
   loaded for the Excel export), so it needs no `api/` slot. Pick which
   sheets to import when there are several.
2. **AI analysis**: send only the headers and ~10 sample rows. The AI
   maps each column to an item field (with a confidence, or "ignore")
   **and maps values too** ("Sold"/"Vendido"/"Y" → `vendido`,
   "NWT" → `novo_etiqueta`); column mapping alone leaves half the data
   wrong. A new `mode` in `api/analyze-photo.js` (the Hobby cap is
   full), prompt built on the server, counted by the AI usage counter.
3. **Review the mapping**: one dropdown per column, prefilled with the
   suggestion; the AI only suggests.
4. **Preview**: the items as they'll be saved, with errors (bad price,
   empty row), possible duplicates (a warning, never a block; the person
   ticks which to skip) and totals (in stock, sold, total value).
5. **Confirm and save**: product codes reserved as one block (a new
   counter function reserving N codes in one transaction, instead of
   one transaction per item), batched writes, then a result summary.

Decisions (Vitor, 2026-10-19):
- Sales history is imported too (sold items with price, date, platform,
  fees), with net profit from `computeNetProfit`, so the finances are
  complete from day one.
- The sheet's own codes are kept in a "legacy code" field, so an item
  can still be found by its old tag. Every item gets a new app code.
- A row with a quantity becomes that many items, each with its own code
  (each piece has its own label).
- Each item records its import ID, and the screen offers "Undo this
  import" (removes that import's items).
- Photos are not imported.
- Test data: our own catalog (exported, then varied: renamed headers,
  other languages, other value spellings) has enough fields to stand in
  for other sellers' sheets.

Layers: parsing and value conversion in `src/domain/` (testable without a
browser), the screen in `src/ui/import/`, the writes in `src/data/`.

### 5. Import platform reports (sales and payouts) — after item 4

Ideas from the 2026-10-19 discussion, to be decided when it starts:
- Input: a file or screenshot from any platform (eBay, Poshmark,
  Mercari, …). Known CSV formats get a fixed parser per platform (no AI,
  predictable); screenshots, PDFs and unknown formats go through AI
  extraction (spends AI credits).
- One common sale record: platform, date, title, order ID, price, fees,
  shipping, net.
- Matching to catalog items: exact link when there is one (SKU / eBay
  listing ID); otherwise a suggested match with a confidence (title +
  price + date) that the person confirms.
- A review screen with before → after per item; nothing applied without
  confirmation. Store the order ID on the item so a report can't be
  applied twice.
- Open questions: start with sales and leave payouts (bank deposits
  that bundle sales, for reconciliation) for later? A sale with no
  catalog item: create a sold item, skip, or leave it to resolve? An
  item already marked sold by hand with different values: overwrite, or
  show the difference and keep the manual values by default? Which
  platforms she actually uses and what each lets her download (get one
  real, anonymized sample of each before designing parsers).
- eBay: the app already reads orders (`ebay-check-sales.js`, Fulfillment
  API, order totals). Whether to add the `sell.finances` scope (needs a
  reconnect, and eBay may not grant it without approval) or treat eBay
  like the other platforms, by report, is open.

### 6. Business customization (after the redesign)

Asked by Vitor 2026-10-19; not a priority yet, but the redesign must
prepare for it. Each business sets its store name, uploads a logo and
picks basic colors (at least the accent); more options can come later.
The store's name and logo are the main identity in the app, with a
discreet but always-present "by Calculated Chaos". Preparation now: every
color in the new design is a CSS variable in one place, and the header
has a slot for the logo.

## Redesign (decisions, 2026-10-19)

Product context for design work is in `PRODUCT.md` (the Impeccable
skill reads it). Critique of the old UI: 19/40, main issues the phone
header (54% of the screen before the first item), navigation mixing
places and actions, and a flat 20-section Settings. Reference: Nifty
(organization only). Visual direction: a new look from scratch; 2-3
directions to be shown in a mockup before any code.

Navigation, approved:
- N1/N2: bottom bar on the phone and a sidebar on desktop with the same
  5 places: Home · Catalog · Stock · Finances · Settings (Settings pinned
  at the bottom on desktop). The desktop-only Dashboard becomes Home.
- N3: sub-tabs. Catalog: All · Drafts. Stock: Labels · Transfer · Boxes
  · Wall markers. Finances: Overview · Months · Reports.
- N4: the header loses the title, subtitle and platform eyebrow; a slim
  bar with the store name (logo later, item 6).
- N5: the daily quote stays (Vitor, 2026-10-20), on Home under "Today",
  still alternating with a computed stock insight.
- N6/N7: version, sign out and refresh ("Check for updates") move to
  Settings → Account.
- N8: Home "Today's summary" with 4 numbers (In stock, Sold, Profit,
  Projected) and a Month / Year / All time selector. "Incomplete" moves
  to Needs attention.
- N9: Home is the phone's start screen, with "Needs attention" grouped
  by problem, one action each: no price → Set prices; missing info →
  Fix; eBay publish errors → Review; listed 30+ days → Drop price /
  Offer; photo-session drafts → Finish; eBay sales to confirm → Confirm.
  Each row can be dismissed.
- N10: one "+" button (New item, Quick catalog, Photo session), on Home
  and Catalog only, never covering card actions.
- N11: Labels and Transfer leave the nav bar (they become Stock sub-tabs).
- Later phases: eBay tools out of Settings, a grouped Settings index, the
  Data section (Import/Export), Ctrl K search and catalog sorting.

Visual directions (mockup canvas "Calculated Chaos redesign directions",
a private claude.ai artifact; Impeccable seed `seed:007b6ac6cba56f1a`):
- **Three themes, chosen per business** in Settings → Appearance (with
  the logo, store name and accent color of backlog item 6):
  - **Parcel** (default, built first): shipping-label world. Navy shell,
    cool white ground, red only for urgent; Archivo with condensed
    numerals; the product code in a label box next to its box.
  - **Tag Week**: thrift-store weekly color tags. Black shell, light
    neutral ground, five tag colors; Bricolage Grotesque.
  - **Concourse**: airport wayfinding. White ground, black, signal
    yellow only for "go here"; Fira Sans; monumental product codes.
- Signature features (recommended 2026-10-19, Vitor had no preference):
  the item tracking line (Cataloged → Listed → Sold → Shipped) in every
  theme; "Color tags by week" as an Appearance option (on by default in
  Tag Week); "Highlight next task" as a Home option (on by default in
  Concourse).
- Rule for all new UI code: no hard-coded colors, fonts or radii, only
  the theme's CSS variables, so a theme is one token set.
- Order: D1 the new shell + Home in Parcel → the other screens in
  Parcel → Appearance (the other two themes, logo, accent).
- D1 shipped in v3.20.0. Not in it, for lack of data: a "Shipped" stop in
  the pipeline (no shipped status yet; needs "Mark shipped"), the "eBay
  publish errors" row (errors aren't stored per item) and "eBay sales to
  confirm" (detected sales are marked sold directly). The Stock tab is a
  stopgap (Labels, Transfer, a link to the boxes in Settings); Finances
  holds the old Months and Reports screens as sub-tabs. `appSettings.storeName`
  is read for the header (none is saved yet; backlog item 6 adds it).
  Detector leftovers in the old modals (eBay red 4.3:1, 11px text, the
  9.5px label "Preview", the lightbox's empty img) wait for the polish phase.

## Docs index

- `docs/v3.13-patch-notes.md`: detailed notes for every v3.13.x patch
  (root causes, decisions). Historical; names reflect that version.
- `docs/ebay-shipping-policy.md`: the v3.13.9 buyer-pays shipping bug
  (resolved).
- `docs/multi-tenant.md`: ADR for offering the app to other businesses.
- `docs/live-catalog.md` (historical, removed in v3.19.0),
  `docs/narration.md`, `docs/dashboard.md` (historical, replaced by
  Home in v3.20.0),
  `docs/employee-accounts.md`, `docs/platform-fees.md`,
  `docs/sold-confirmation.md`, `docs/modularization.md`.
