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

### Change order: discuss, plan, confirm (2026-10-21)

Vitor's standing order for every change to this project, in this order:

1. **Discuss** the topic of the change.
2. **Plan**: describe what will be changed (code, config, `CLAUDE.md`
   itself, version bumps) and the steps to verify it.
3. **Confirmation of the plan**: wait for his explicit confirmation.

Only after step 3 does any file change. There are no exceptions for
"small" or "obvious" fixes. Discussing, reading code, diagnosing and
planning need no confirmation. If he says a session is
"evaluation/planning only", make no changes at all in it.

Confirming the plan also authorizes the PR and the merge (2026-10-21).
No further confirmation is needed for them.

Commits and pushes are free (Vitor, 2026-10-20): commit and push to the
session's branch without asking again, both for changes he already
confirmed and to realign the branch when a stop hook flags unpushed
commits. A force push or anything that rewrites history still needs his
explicit order.

After every merge, the next reply reports the current app version
(`APP_VERSION` from `src/modules/version.js`, as merged on `main`).

### Git workflow

- Work on the session's named branch and open a PR per change. Whether a
  session binds to `main` or a branch is set when the session is created,
  not by Claude. Vitor is fine with the branch+PR pattern (2026-08-10).
- **Merging ("always", 2026-08-11)**: merge each PR once it's open and
  green, without asking again, for changes whose plan he confirmed (see
  *Change order* above).
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
- `npm test` runs the unit tests of `src/domain/` (`tests/domain/`, Node's
  built-in runner, no extra packages): money and dates in US formats, the
  P&L, the IRS mileage rates, the sale matching and the goals. There are no
  UI or API tests. The standard check before a commit is
  `node --check` on every touched file plus a clean `npm run build`.
  Optionally, add a headless-Chromium load up to the login screen (no JS
  errors). Firebase, eBay and the AI APIs aren't reachable from the sandbox.
  **Say plainly when something was only build-verified** and add it to
  "Unverified in production" below.

### Deploy checklist (push to `main` = production)

Before the push:
- [ ] `npm test` and `npm run build` pass; `node --check` on every touched `api/` file.
- [ ] `APP_VERSION` bumped, and a pending entry added below.
- [ ] `firestore.rules` changed? Paste the same text into the Console (Firestore → Rules) and publish. The repo does not deploy rules.
- [ ] An `api/` file reads a new env var? Check it is set in Vercel first.

After the push:
- [ ] Open the app as the owner: the catalog loads and a save works.
- [ ] Changed AI call? One real use, and its `ai-usage` line in the Vercel logs.

Rollback: revert the merge commit on `main` (Vercel redeploys). Rules: paste
the text from the previous commit (`git show <sha>^:firestore.rules`).

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
  - `domain/catalog-sort.js` (catalog sort orders), `domain/stock-boxes.js`
    (box list with in-stock counts) and `ui/stock/stock-view.js` (the
    Stock tabs; Boxes and Wall markers live here since v3.20.1).
  - `domain/home-summary.js` + `ui/home/home-view.js`: the Home screen
    (v3.20.0): summary by period, pipeline, "Needs attention", revenue
    by platform. Period and dismissed rows are per-device (localStorage).
  - `domain/item-issues.js`: item issues (v3.22.4), one definition for
    the catalog's Issues strip and filters, the card warning (+ popover)
    and Home's "Needs attention". Always on: no price, eBay publish error
    (`item.ebayPublishError`, stamped by `ebay-api.js` on a failed
    publish, cleared by a successful one), duplicate product code (all
    items, sold included). Optional, per business in Settings → Warnings
    (`ui/settings/warnings-panel.js`, `appSettings.issueChecks`): photos,
    cost, weight, dimensions, listed 30/45/60/90 days or off. A change
    fires `issuecheckschange`. `catalog-filters.js` and `home-summary.js`
    re-export the checks.
  - Spreadsheet import (v3.23.1, backlog item 4): `domain/import-sheet.js`
    (header synonyms EN/PT/ES → `suggestMapping`, value words →
    `suggestValueMap`, money/date parsing with day/month order detection,
    rows → items incl. quantity, sold fields, fees estimated when missing,
    duplicates by code or name+size+price, `buildImportDocs`),
    `data/import-store.js` (batches of 400 with `writeBatch`, continue
    after a failure without duplicates, undo by `importId`),
    `platform/sheetjs.js` (loads SheetJS 0.18.5, reads CSV as text),
    `ui/import/import-view.js` (the `import` tab, from Settings → Data;
    owner only). Codes come from `reserveProductCodeBlock(n)` (one
    transaction). Every item keeps `importId`, `importFile`,
    `importedAt` and its sheet code as `legacyCode` (searchable). Limit
    10,000 rows per file. Imported items have their own missing-info
    checks (`issueChecks.imported`, photos off by default) and an
    "Imported" filter chip. AI column analysis (v3.23.2):
    `modules/ai-import.js` (prompt + schema built on the server by
    `api/analyze-photo.js` mode `import_map` from the headers, ≤10 sample
    rows and the distinct value words, all clipped; `mergeAiMapping` /
    `mergeAiValues` on the browser: the AI only replaces a less sure match,
    never the person's pick). One call per file when the Columns step
    opens, counted by the AI usage counter, skipped when it's used up.
  - `domain/ebay-sales.js` + `data/ebay-sales-store.js` +
    `ui/settings/ebay-sales-panel.js`: the eBay sale tracker (v3.22.5).
    `checkEbaySalesNow()` still marks a matching unsold item Sold on its
    own; every detected order line is also logged once (transaction, key
    `saleKey()`) in the business's `ebay_sales` with its outcome
    (marked sold, already sold, no matching item, couldn't save) and the
    other platforms the item was still listed on. Settings → eBay → Sale
    tracker shows 60 days; Home's "eBay sales to confirm" counts the ones
    to delist elsewhere or handle by hand until "Done". Business-only
    collection (no root path).
  - `domain/goals.js` + `ui/home/goals-panel.js`: Goals on Home
    (v3.22.3), saved in `appSettings.goals` ({ id, metric, period,
    target }, max 4) through `saveSettingsFields()` (writes only the
    given fields). Metrics: profit, revenue, items sold, items cataloged
    (no per-platform listing date exists), sell-through; periods: week
    (Mon-Sun), month, quarter, year. Progress is always computed, with a
    linear "pace by today" marker. Only the owner edits (`canEditGoals`).
  - `domain/finance-summary.js` + `ui/finance/finance-view.js`: the
    Finances screen (v3.21.3): Overview (own period, `cc.finance.period`,
    separate from Home's), Months, Reports. The export buttons are still
    wired by `wireReportButtons()` in `main.js`. Insights (v3.22.2):
    changes vs the same days of the previous month / same point of last
    year (`previousWindow()`), sell-through = sold ÷ available in the
    period (`sellThroughOf()`, never over 100%), By platform with average
    profit and days to sell (`createdAt` → `soldAt`), top brands and
    categories by units sold.
  - `domain/expenses.js` + `data/expense-store.js` +
    `ui/finance/expenses-view.js`: Finances → Expenses (v3.23.3, P2
    item 1, first part). Business costs not tied to one sale, in the
    business's `expenses` collection (business-only, like `ebay_sales`):
    `{ date 'YYYY-MM-DD', category, amount, description, kind
    'expense'|'refund', createdAt, createdBy, updatedAt }`, written whole
    with `setDoc`. 22 Schedule C-style categories with hints; no
    inventory purchases (accrual only). Period Month/Year/All
    (`cc.expenses.period`), by category, list by month, CSV export (also
    in Reports → Export). Owner only. The `expenses` rule is in the
    Console (Vitor, 2026-10-20).
  - `domain/profit-loss.js` + `ui/finance/pnl-view.js`: the Profit &
    Loss statement at the top of Reports (v3.23.4). Accrual: Revenue by
    platform − Cost of goods sold (item cost) = Gross profit − Selling
    costs (fees, shipping paid, other sale costs) − Operating expenses
    by category = Net profit. Sales profit is the saved `netProfit`;
    "Sale adjustments" carries any difference from the lines, so Net
    profit = Overview's profit − expenses. Periods This/Last month,
    This/Last year, All (`cc.pnl.period`, default This year), CSV
    export (Section, Line, Amount).
  - **Two profits, two names (v3.23.5, Vitor 2026-10-20)**: "Sales
    profit" = the saved `netProfit` of the sales (Home, Goals' metric,
    Overview, Months, the 12-month chart); "Net profit" = sales profit −
    expenses, only in the P&L and in Overview's sixth summary cell, which
    appears once the business has any expense (with "Net profit = sales
    profit − $X expenses · See P&L", `expensesForPeriod()`). Never label
    the sales-only number "Net profit". "See P&L" carries Overview's
    period (`setPnlPeriodFromOverview`); the Expenses list exports the
    period on screen, Reports exports all expenses.
  - `domain/sales-ledger.js` + `data/sale-costs-store.js` +
    `ui/finance/sales-list.js`: Finances → Sales (v3.23.6; the old Months
    tab, still `data-tab="months"`). An open month shows its summary and
    its sales: a table on desktop (totals footer = the month summary),
    cards on a phone. Item cost, shipping and other costs are edited in
    place on desktop (Enter saves and jumps to the next sale without a
    cost, Esc cancels) or in a bottom sheet on a phone ("Save & next
    missing"); the profit is recomputed with the item modal's formula and
    **only `cost`, `shippingCost`, `otherCosts`, `netProfit` are written,
    with `updateDoc`** (never `saveItem`'s full replace). Price and fees
    stay in the item modal ("Edit in item"). Missing cost = an empty
    `cost`; a typed 0 is a known cost (free or gifted). A month with
    missing costs shows "N missing cost" and a Missing cost filter. After
    a save `onDataChange` redraws everything. `ui/toast.js` is the shared
    `showToast()` (Expenses and Sales).
  - The trash (v3.26.0, `docs/trash.md`): `domain/trash.js` (what a
    deleted item keeps, the 30 days, what a restore puts back),
    `data/trash-store.js` (move, restore, list, delete forever; one batch
    per 200 items), `ui/items/delete-dialog.js` (the eBay question before a
    delete: "Remove from eBay and delete" is the default), and
    `ui/settings/trash-panel.js` (Settings → Data → Trash). The item delete
    in `main.js` (`trashItem()`) and bulk delete go through it; undo import
    (`data/import-store.js`) moves to the trash too. `removeEbayListingForDelete()`
    in `ebay-api.js` ends a listing without requiring a sale.
  - `domain/mileage.js`: trips at the IRS standard business rate
    (v3.23.7). `MILEAGE_RATES` is a fixed, dated table (decided with
    Vitor 2026-10-20: no per-business override): 2023 65.5¢, 2024 67¢,
    2025 70¢, 2026 72.5¢ through June 30 and 76¢ from July 1
    (Announcement 2026-11). **Add each new IRS rate when it's
    announced**; a date past the table uses the last rate and says so.
    Only Sourcing Transportation and Vehicle Expense take miles; a trip
    saves `miles`, `rate` and `amount`, so a later table change never
    moves it. A year with Vehicle Expense in both miles and dollars
    shows a soft IRS warning.
  - `domain/expense-import.js` + `ui/finance/expense-import-view.js`:
    the expense CSV/Excel import (v3.23.7), from the Expenses tab only.
    Steps file → columns → category words → preview → save. Reuses the
    spreadsheet import's readers (`parseMoney`, `parseDate` with
    day/month order, `findHeaderRow`, `platform/sheetjs.js`). Category
    words match labels, keys, Nifty's codes and everyday words; unknown
    words are mapped by the person (or "Skip (personal)", default
    Other); inventory words suggest Skip (accrual). A negative amount is
    a refund; a distance with no amount is a trip at the rate of its
    date. Possible duplicates (same date, category, kind and amount as a
    saved expense or an earlier row) start unticked. Saved in batches of
    400 (`saveExpenseBatches`, Continue without duplicates), each doc
    with `importId`, `importFile`, `importedAt`; the Expenses tab shows
    the last import for a week with Undo (`undoExpenseImport`). Limit
    5,000 rows. The list export has Miles and Rate per mile columns.
  - `domain/sale-match.js` + `modules/ai-sale-screenshot.js` +
    `ui/stock/pick-view.js`: Stock → Pick (v3.24.2), sale screenshots →
    the pieces to pick, box by box. One `analyze-photo.js` call per
    screenshot, mode `sale_screenshot` on **Haiku 5.5** (no refusal
    fallback; prompt and schema built on the server), counted by the AI
    usage counter. `platform/images.js` `prepareScreenshot()` crops the
    plain bands and keeps the long side ≤1,568 px so text stays legible.
    Matching: SKU = product code without "#" (Poshmark shows "SKU: 0897"
    for #0897; copies "-1"/"-2" share the base, two sales take two
    copies), then `legacyCode`, then title words + size + price (unsold
    only, with a confidence and alternatives). Flags: already sold, still
    listed elsewhere, two sales on one item, SKU not in the catalog. Same
    order line in two screenshots counts once; the skipped lines are
    listed with their item and both screenshots (v3.24.3). An order whose
    platform the AI can't tell gets a "Sold on" select under its
    screenshot, and its delist note never names a platform as "delist it
    there" until set. **Read-only**: answers, the person's picks, platforms
    and ticks stay on the device (`cc.pick.session`). Print checklist
    (v3.24.3, `ui/stock/pick-print.js`): 100 × 210 mm labels through
    `printHtml()`, black only, fixed row heights in mm so the page breaks
    are computed before the (synchronous) print, "(cont.)" headings, a
    "Picked by / Date" line. Package numbers (v3.27.2): every order gets a
    number in the order its first line appears (`buildPickList()` →
    `pl.packages`, `row.pack`; a typed code is its own order; adding
    screenshots later keeps the numbers already printed). The sheet draws
    it as a black ring beside the tick box on every row, and ends with a
    "Packages" list (number, buyer, piece count); the Pick screen shows the
    same ring. Mark sold (v3.24.4, `domain/pick-sale.js`,
    `data/pick-sale-store.js`, `ui/stock/pick-sold.js`): a sheet of the
    matched, unsold pieces (unsure name matches and double sales start
    unticked) prefilled with the screenshot's price and platform. Real
    money (v3.27.1): the AI also reads the order's pricing section when it
    is open (`total` = "Price" or "Offer Price", `fee`, `netEarnings`,
    `salesTax`); `saleLines()` gives every line its share
    (`allocateOrder()` in `domain/pick-sale.js`): the real total is spread
    over a bundle's pieces in proportion to their listed prices (28.57% off
    $112 → every piece loses 28.57%), the fee and the tax follow, the last
    piece takes the rounding cents. A closed section = the old behavior
    (listed price, platform fee rule); a cut-off line or a total above the
    listed prices is not split and says so. The sales tax is kept apart as
    `saleTax`, never in price or fee. An item with no cost gets a cost field
    on the sheet (left empty = sold with no profit yet, shown as missing in
    Finances → Sales).
    **Writes only the sale fields (plus `manualSale` for typed pieces) with `updateDoc`** (`status`,
    `soldPrice`, `soldPlatform`, `feesTotal`, `shippingCost`,
    `otherCosts`, `netProfit`, `soldAt` = order date at noon or now,
    `saleOrderNumber`, `saleBuyer`, `saleLineKey`, and `saleTax` when read,
    `cost` when it was empty and typed), then ends an
    app-made eBay listing when it sold elsewhere (`endEbayListingIfSold`,
    which full-saves the merged item). `saleLineKey` = the screenshot
    line's key: a recorded line stays on its item and can't be recorded
    again.
  - `ui/lazy-screen.js` (v3.26.9): Stock, Finances, Import, Settings and the
    trash load on first use. Wrap a new heavy screen the same way: `main.js`
    builds the hooks and calls `use()`; never import a screen statically
    from `main.js`.
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
    `index.js` registers their `window.*` handlers (v3.17.6). Since
    v3.22.0 it's grouped (index → one group; `cc.settings.group` on the
    device), but every group is still rendered and only the open one is
    visible, so all ids stay in the page (ebay-api.js looks up
    `#ebayConnectionStatus`). New Settings sections go in a group.
  - `ui/theme.js`: themes (v3.21.0). `THEMES`, `applyTheme()` (sets
    `data-theme` on `<html>`, loads the theme's font, remembers it on the
    device), Settings → Appearance saves `appSettings.theme`. The token
    sets are in `style.css` (`:root` = Parcel, `:root[data-theme=...]`).
    `applyAccent()` (v3.22.1) overrides `--brand-2` and `--nav-active`
    with the business's `appSettings.accentColor`, adjusted for contrast
    by `domain/accent.js` (per-theme rules); call it after `applyTheme()`.
  - Store identity (v3.22.1): `appSettings.storeName` and `storeLogo` (a
    ≤256 px data: URL made by `platform/images.js`, kept in the settings
    doc, not Storage) drive `renderBrand()` in `main.js`; Settings saves
    fire `brandchange` to redraw it.
  - `platform/app-update.js` + `ui/update-banner.js`: the new-version
    strip (v3.20.2). `vite.config.js` writes `dist/version.json` from
    `version.js` on every build; nothing to bump by hand.
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
    Since v3.24.1 the seller's own "AI writing instructions" (Settings →
    Listings, `appSettings.aiInstructions`, ≤1,500 chars, owner edits via
    `saveSettingsFields`) arrive as `input.customInstructions` and go in
    a tagged `<seller_instructions>` block after the listing rules
    (`buildSellerInstructionsBlock`): title and description style only,
    never Part A, the price, the limits or the JSON. Empty → the prompt
    is byte-for-byte the v3.24.0 one. The closing text
    (`listingStandardText`) is the description footer.
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
  - `analyze-photo.js`: ✨ analysis, `mode: full | listing_only` (and
    `import_map` for the spreadsheet import, v3.23.2), Sonnet 5.5
    at `effort: low`, with server-side refusal `fallbacks`;
    `sale_screenshot` (Stock → Pick, v3.24.2) runs on Haiku 5.5, one image. Builds the
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
    `ebay_sales` (v3.22.5), `expenses` (v3.23.3), `trash` (v3.26.0),
    `counters/*`, `config/settings` (members read/write), `members/*`
    (server-written) and the frozen `liveSessions`, `liveItems`,
    `options/main` (admins read only, v3.19.0);
    `ebay_connections/{bizId}`; `users.activeBizId`; `platform/migration`
    (fixed bizId, `lastCopiedAt`, `switchedAt`; server only). Once live,
    the root business collections are read-only for that business's
    members (`rootWritable()` in the rules).
  - `ai_usage/{month__uid__call__model}` (v3.24.5): AI usage counts, server
    only (Firebase Admin; the rule denies clients). Written by
    `api/_aiUsage.js`, read by `api/platform.js` action `ai_usage`.
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
  save wipes it (the eBay listing ID was lost this way, v3.13.94;
  `ebayPublishError` is carried the same way since v3.22.4). Settings
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

- **Deleting an item never ends its eBay listing by itself** (before
  v3.26.0 the delete just removed the document, leaving the listing live
  and the sale tracker with no item to match). The delete now asks first;
  do not add a delete path that skips the question.
- **The Catalog draws its cards in batches of 300 (v3.26.12,
  `CATALOG_BATCH` in `main.js`).** An item can have no card in the page.
  Work from the data (`applyFilters(items)`, `bulkSelectedIds`), never from
  `document.querySelectorAll('.item-card')`. Card clicks are one delegated
  handler on `#catalogListArea`, so cards drawn later need no wiring. The
  count goes back to one batch only when the search, the filters or the sort
  change (`catalogListKey`); a redraw of the same list keeps it.
- **Stay on `firebase-admin` 13.x (v3.26.4).** Version 14 pulls in
  `jwks-rsa` 4, which `require`s `jose` 6 (ESM only); Vercel's function
  loader rejects that with `ERR_REQUIRE_ESM` on the first `verifyIdToken()`,
  so every token-checked function (`platform`, `ebay-auth`,
  `ebay-check-sales`) returned 500. Plain Node loads it fine, so offline
  checks miss it: retry 14.x only on a Vercel preview with a real sign-in.
- **Never use `req.query` in `api/` code (v3.26.6).** Vercel builds that
  getter with the deprecated `url.parse()` (`DEP0169`). Read the query with
  `new URL(req.url, 'http://localhost').searchParams`, as `api/ebay-auth.js`
  and `api/ebay-account-deletion.js` do.
- **The browser Firebase SDK is bundled from npm and pinned to
  `firebase@10.13.0` (v3.26.10).** Don't raise the pin without checking
  sign-in on a Vercel preview: the API key only accepts the production
  origins, so `localhost` answers "requests-from-referer … are blocked"
  whatever the code does.

## Open items

- **Paste `firestore.rules` into the Console** for v3.26.0 (Vitor): `trash`
  is added to the member collections. Until then the trash can't be read or
  written. Optional: a TTL policy on `trash.expiresAt` in the Console.
- **Production, selling soon (Vitor, 2026-10-20)**: the app is in
  production mode and will be offered to other sellers soon. Treat every
  change as going to paying customers: no half-finished features on
  `main`, and billing-related data (AI credits, plans) must be
  server-enforced, never trusted from the browser.
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
- **Tab-switch delay (Vitor, 2026-10-22)**: after v3.26.14 loading is much
  faster, but some delay remains when switching tabs. Home, Stock and
  Settings redraw on every switch (Settings rebuilds its whole screen), and
  the first Finances visit draws (about 0.7 s at 4x CPU with 1,500 items).
  Not measured per tab on a phone: ask which pair of tabs feels slow before
  changing anything.
- **Performance work left on purpose (2026-10-22)**: loading `ebay-api.js`
  (62 kB) and the label screens on demand (the gain is small and printing
  needs `window.print()` synchronous on iOS), real thumbnail files (needs a
  migration of old items) and paging the Firestore read of `items` (it only
  matters at several thousand items; the whole collection loads at sign-in).
  Revisit if the catalog grows.

### Unverified in production (build-verified only)

- Faster start and the Catalog (v3.26.8 – v3.26.14): Chromium test of the
  built app with the Firebase SDK stubbed (a signed-in owner, 1,500 sample
  items, CPU slowed 4x): no page errors; every tab, Import and the trash
  show the same text as v3.26.8, with and without the idle prefetch; the
  first 300 cards and all 1,500 once drawn are byte-for-byte the same HTML
  as before the batches; scrolling draws 300, 600 … 1,500 with no missing
  or repeated ids; a card from a later batch opens its own item; search,
  sort, bulk mode and "Select all N" work; Finances draws once, then only
  on a data change; the search box redraws once per pause; card boxes on
  screen are identical with `content-visibility`. Vitor confirmed on
  2026-10-22 that sign-in and the app work on v3.26.14 and loading is
  clearly faster. Unconfirmed: real timings on a phone (the numbers in
  `CHANGELOG.md` are from the throttled test), `content-visibility` only
  acts on iOS 18 and newer, real photos, the Firebase SDK bundled from npm
  for Firestore writes and Storage uploads (sign-in and reads worked), and
  a screen load right after a deploy (an old tab asks for a file name that
  no longer exists; the message and retry cover it).
- Trash and eBay question before a delete (v3.26.0): Node test (14 checks:
  the eBay step per item, the trash record and its 30-day expiry, restore
  with and without an eBay removal, the expiry rules, batches of 200, a
  failed batch stopping after the last commit, undo import counting items
  still on eBay), Chromium test with a stubbed Firestore and eBay (the
  question's buttons, focus on "Keep item", Escape, the error line and the
  manual-listing variant; the trash list: restore, a failed restore keeping
  its row, the duplicate-code warning, the empty state), screenshot on a
  phone, clean build. Not run: the real eBay withdraw call on a listing that
  was already ended on eBay, the real Firestore rules and batches, the item
  modal and bulk delete in the app, Delete forever in the browser. Confirm:
  delete one listed item with "Remove from eBay and delete" and see it in
  Settings → Data → Trash with its eBay listing ended.

Last known status per the v3.13 notes. Confirm with Vitor before relying
on any of these:
- AI usage meter (v3.24.5): domain test (usage ids and increments, tool
  names, totals and per-user sums on a small sample) and a clean build.
  Not run: the server write and report against the real Firestore (the
  `ai_usage` rule must be pasted in the Console first), the Developer
  Panel tab with real calls. Confirm one ✨ call shows up for the right
  user and month.
- Mark sold from Pick (v3.24.4): Node test (5 cases: a bundle's fee on
  the order total split by price with cents adding up, the sold date,
  the 11 fields and the profit formula, validation, a recorded line
  staying on its copy with its delist list incl. an ended eBay listing),
  Chromium test with a stubbed Firebase and eBay (9 checks: 5 offered,
  nothing saved while a platform is missing, one platform per order and
  the fee split, a failed write keeping its row while the others write
  only the 11 fields with updateDoc and keep the rest, the retry, the
  recorded notes, a reload, the bundle's last piece prefilled), every
  earlier suite rerun, clean build. Unconfirmed: the real Firestore
  rules for the update, the real eBay end-listing call, the fee rule
  for Poshmark in the business's settings (flat % vs tiered), an
  iPhone keyboard over the sheet.
- Pick checklist (v3.24.3): Node tests (15 matching cases incl. box
  titles and the platform override, pagination of 41 rows on 4 labels
  with no overflow, flags, the 100 × 210 mm size), Chromium test rerun
  (13 checks incl. one black-only 100 × 210 mm sheet for 7 items, ticks
  printed, skipped details, the Sold on select). Unconfirmed: a real
  print on the thermal printer (the 100 × 210 mm page in iOS and the
  printer driver, the font sizes on paper).
- Stock → Pick (v3.24.2): Vitor tried it with real screenshots
  (2026-10-20): SKUs matched, Love Tree found by name; the 6-item
  Poshmark order came back with no platform (prompt hint added in
  v3.24.3). Node test (13 cases, built from Vitor's three
  Poshmark screenshots: code normalization, the server prompt and schema,
  a repeated order counted once, SKU with a leading zero, a sold item, a
  no-SKU item by name over a similar one, legacy code, copies, an exact
  "-3" SKU, an unknown SKU, box order and delist notes, a person's own
  pick), handler test with a mocked fetch (Haiku without fallback, one
  image, server prompt, other modes unchanged), Chromium test of the
  built app with a stubbed Firebase and AI endpoint uploading the real
  screenshots (11 checks: one call each, 7 items from 2 orders, badges
  and notes, counter +3 and no item written, ticks and choices kept
  after a reload with no new call, Try again, Search catalog, a used-up
  limit), the black-banded screenshot cropped legibly, screenshots in
  the three themes, no page errors, clean build. Unconfirmed: the real
  Haiku 5.5 reading real screenshots (SKUs with leading zeros, eBay and
  Mercari layouts), its cost (`ai-usage` lines with
  `"mode":"sale_screenshot"`), paste and upload on an iPhone.
- AI writing instructions (v3.24.1): Node test (5 cases: every prompt
  byte-for-byte identical to v3.24.0 without instructions, the block's
  place and wording in both modes, the rest of the prompt and the
  schema unchanged with it, clipping at 1,500, tags inside the text
  stripped, a non-string ignored, a browser prompt still ignored),
  Chromium test (4 checks: the field, chips without repeats, counter,
  only `aiInstructions` saved with merge, a failed save message, the
  Rewrite request carrying `input.customInstructions`), every earlier
  suite rerun, screenshots in the three themes, clean build.
  Unconfirmed: how the real model follows the instructions (test on
  3-5 real items), the ✨ analysis call with photos.
- Mileage and expense import (v3.23.7): Node test (11 cases: the IRS
  rate by date incl. July 1, 2026 and dates outside the table, amounts
  and the rate line, miles validation, the mixed-method warning, CSV
  miles columns, header matching incl. bank-style and Portuguese, the
  category words, rows → expenses with refund, trip, errors, skip,
  unknown → Other and duplicates, day-first files, docs with the import
  id, the template reading back), Chromium test with a stubbed Firebase
  and a CSV-only SheetJS stand-in (9 checks: miles only for the two
  categories, round trip, the rate following the date, saved fields,
  editing a trip and switching to dollars, the warning, template
  download, the footer line ignored, column matching, category mapping,
  preview counts, 4 docs saved with import fields, banner, Undo, a
  failed second batch continued with no duplicates), every earlier
  suite rerun, detector unchanged, screenshots in the three themes,
  clean build. Unconfirmed: real bank exports and .xlsx files (the
  real SheetJS), writeBatch and the `importId` query against the real
  Firestore and rules.
- Sales list and cost editing (v3.23.6): Node test (7 cases: missing =
  empty only, counts per month, month order incl. an old sale without
  `soldAt`, row shape, footer totals = `monthlyTotals`, the recompute =
  the item modal's formula and its errors), Chromium test (9 checks: the
  Sales tab and its "2 missing cost" tag, cards with an Add cost chip,
  the filter, the bottom sheet with error, live preview and Save & next
  missing writing only the four fields with `updateDoc` and keeping the
  item's other fields, a typed 0 clearing the tag, Overview/P&L/Home
  agreeing after the edits, a failed save, Edit in item, the desktop
  table footer, Esc and Enter inline), the earlier suites rerun
  (Expenses 18, P&L 8, fixes 8, Node 9 + 8), detector unchanged,
  screenshots in the three themes, clean build. Unconfirmed: real data
  (items whose `cost` is a number 0 from older code count as known here
  but as missing in `item-issues.js`'s optional cost check), an iPhone
  keyboard over the sheet.
- Finances critique fixes (v3.23.5, after an Impeccable critique at
  26/40): Chromium tests (fixes 8 checks: Sales profit on Home, Goals,
  Overview chart and Months, Item cost in Months; no page overflow at
  320px with the tab bar scrolling; the P&L equation stacked on the
  phone with role=group and h3 sections; 44px targets; the dialog at
  390x500 keeping its error and "Saved" in view; a future date's note
  and save; the closing toast. Expenses 18 checks incl. the export
  following the period on screen; P&L 8 checks incl. the Net profit
  cell and See P&L carrying the period), Node tests rerun (9 + 8),
  detector unchanged (the 9 old-modal findings), screenshots in the
  three themes, clean build. Unconfirmed: an iPhone with the real
  keyboard, real data in the six-cell summary.
- Profit & Loss (v3.23.4): Node test (8 cases: windows across a year
  change, each line by hand, expenses net of refunds, an old sale
  without `soldAt`, Sale adjustments only when the saved profit
  differs, sales profit and revenue identical to Overview for month,
  year and all, Overview's expense line bounded to the period, CSV
  totals reconciling), Chromium test of the real app with a stubbed
  Firebase (8 checks: P&L first in Reports with This year, every line
  and the net, no Overview line without expenses, Overview summary
  unchanged, the line for Month and All time, See P&L, Last year,
  period remembered, the same CSV from the panel and from Export,
  saving an expense redrawing both, a failed expenses load flagged),
  the Expenses test rerun (17 checks), screenshots in the three themes
  (phone and desktop), no page errors, no horizontal scroll, clean
  build. Unconfirmed in production: real sales (how often Sale
  adjustments shows up, and how big), the CSV opened in a spreadsheet.
- Expenses (v3.23.3): Node test (9 cases: categories, validation and
  its error fields, refunds, periods by local date, totals in exact
  cents over 1,000 entries, months, CSV), Chromium test of the real app
  with a stubbed Firebase (17 checks: the four Finances tabs, empty
  state, validation focus, Save and add another, only full `expenses`
  docs written, refund, edit keeping `createdAt`, delete with confirm
  and cancel, a failed save keeping the dialog, Month vs All time, CSV
  from the list and from Reports, Overview identical before and after,
  a failed load with Try again, an employee never reaching it),
  screenshots in the three themes (phone and desktop), no page errors,
  no horizontal scroll, clean build. The `expenses` rule was pasted in
  the Console (Vitor, 2026-10-20). Unconfirmed in production: saving and loading with the real Firestore
  and rules, the date picker and Save and add another on an iPhone.
- Import AI column analysis (v3.23.2): Node test (9 cases: input
  clipping and limits, prompt and schema, merge rules for columns and
  values, the handler with a mocked fetch: no photos, schema sent, a
  browser-sent prompt ignored, other modes unchanged), Chromium test with
  a stubbed endpoint (a Portuguese sheet the rules half-read: the AI fills
  the rest, a pick made while it runs stays, one call per file, the
  counter goes up; a failed call leaves the rules; a used-up limit makes
  no call), screenshots, clean build. Unconfirmed in production: the real
  model's answers on real sheets, and its cost per import (watch the
  `ai-usage` lines with `"mode":"import_map"`).
- Spreadsheet import (v3.23.1): Node test (16 cases: our own export
  headers, Portuguese and Spanish headers, money in US and Brazilian
  formats, dates incl. Excel serials and day-first detection, value
  words, rows → items with quantity, sold items with fees from the sheet
  or estimated, errors, duplicates, totals); Issues test (17, imported
  items' own checks); Chromium test of the real app with a stubbed
  Firebase and SheetJS (an .xlsx with two sheets: columns, an unknown
  value, preview totals, a skipped duplicate, a bad row, saved fields,
  codes #0051-#0057 from one counter reservation, the catalog filtered to
  the import, the Imported chip, search by legacy code, Warnings →
  Imported items, Undo from Past imports; a 1,000-row CSV with day-first
  dates stopping after the first batch and finishing with Continue, no
  duplicates; 10,001 rows refused; an employee never reaches the screen),
  screenshots in the three themes, no page errors, clean build.
  Unconfirmed in production: real sellers' spreadsheets, an .xls/.ods
  file, writeBatch against the real Firestore and its rules.
- eBay sale tracker (v3.22.5): Node test (9 cases: sale key, matching
  by SKU/listing ID with an unsold match first, the plan per sale, the
  log entry, what needs attention, 60 days, Home's row text; Home
  identical to v3.22.4 without sales), Chromium test of the real app
  with a stubbed Firebase and eBay (startup check marks the unsold
  matches sold and logs all four outcomes; a second check logs and
  saves nothing; Home row → Settings → eBay tracker; Done writes only
  `doneAt` with merge and lowers Home's count; the item link opens the
  item; no eBay connection = no log), screenshots in the three themes,
  no page errors, clean build. The `ebay_sales` rule was pasted in
  the Console (Vitor, 2026-10-20). Unconfirmed in production: real eBay
  orders, the first check after the deploy logging the last 14 days.
- Item issues (v3.22.4): Node test (16 cases: with the default checks,
  `isIncomplete`/`missingFields`/`isStaleListing`, the Home summary and
  every old catalog filter identical to v3.22.3 on 400 items; each check
  on and off; duplicate codes ignoring "#", case and spaces, "-1"/"-2"
  copies distinct; issue order; Issues filter = union of its parts and
  Home row counts = their filters, under three check settings), Chromium
  test of the real app with a stubbed Firebase (Home rows and their
  links, the Issues strip count and list, card labels, the popover, a
  plain item save keeping `ebayPublishError`, Settings → Warnings saving
  only `issueChecks` with merge and redrawing catalog and Home, a failed
  save message), screenshots in the three themes, no page errors, clean
  build. Unconfirmed in production: a real failed eBay publish stamping
  the item (and a later success clearing it), real duplicate codes,
  the settings saving for the business.
- Goals on Home (v3.22.3): Node test (19 cases: week/month/quarter/
  year windows incl. a week across the new year, saved-list cleanup,
  each metric by hand, pace at the first and last minute, reached goal,
  month and year values identical to Finances), Chromium test of the
  panel and editor with a stubbed Firestore (empty state, validation,
  sell-through unit and 100% cap, 4-goal limit, edit/add/remove keeping
  ids, remove all, a failed save keeping the dialog open, only `goals`
  written with merge, no Edit for an employee), screenshots in the three
  themes (phone and desktop), no page errors, no horizontal scroll,
  clean build. Unconfirmed in production: saving and loading the goals
  for the business, the `<dialog>` editor on an iPhone.
- Finances insights (v3.22.2): Node test (31 cases: every field the
  old overview returned identical on 400 sample items in the three
  periods; previous window incl. Mar 31, year change and Feb 29;
  sell-through by hand and never over 100%; platform sums and averages;
  top brands/categories), Chromium screenshots of Overview in the three
  themes (phone and desktop, every period, empty catalog), no page
  errors, no horizontal scroll, clean build. Unconfirmed: real data
  (brand/category spellings, old sales without `soldAt`, which count
  in sell-through but not in days to sell).
- Store identity (v3.22.1): Node test of `domain/accent.js` (51 color ×
  theme cases keep 4.5:1 for buttons/links and each theme's marker rule;
  every preset used as is for buttons), Chromium test (name, logo
  shrunk to ≤256 px, accent preset, theme default and logo removal all
  saved and shown), screenshots of the header, sidebar and Appearance in
  the three themes (phone and desktop) with a dark and a light accent,
  no page errors, no horizontal scroll, clean build. Unconfirmed in
  production: the settings saving and loading for the business, a real
  logo on an iPhone home-screen app, the accent on the old modals.
- Grouped Settings (v3.22.0): Chromium characterization test on the real
  markup, old vs new template (every old id present, the 35 fields'
  starting values identical, every inline handler kept, the settings
  written by each save button and by add/remove carrier identical),
  the new AI Save button, the phone returning to the index and the
  desktop remembering the group; screenshots of the index and groups in
  the three themes (phone and desktop), no page errors, no horizontal
  scroll, clean build. Unconfirmed in production: every save with real
  settings, the eBay buttons, employee creation (Team), the Developer
  Panel link.
- Finances screen (v3.21.3): Node test (monthly totals identical to the
  old `renderFinance()` math on 338 sample sales; period totals, last 12
  months, revenue split), Chromium screenshots of Overview, Months and
  Reports in the three themes (phone and desktop) on a harness page with
  sample data, no page errors, no horizontal scroll, clean build.
  Unconfirmed: real data, the exports from the new Export panel, opening a
  stale listing from Reports, a bar opening its month on a real phone.
- Re-critique fixes (v3.21.2): Node tests (`pinkTagStock`, week tags,
  Home summary, catalog sort), Chromium screenshots of Home and Catalog
  in the three themes (phone and desktop), no page errors, clean build.
  Unconfirmed on a real phone: the focus ring with a keyboard, the
  dismissed Next band coming back when its count changes, real data.
- Theme layouts (v3.21.1): Node test of `week-tags.js` (week edges, no
  date, future date, shelf counts equal the color filter), Chromium
  screenshots of Home and Catalog in all three themes, phone and desktop,
  no page errors, clean build. Unconfirmed on a real phone: real photos
  in the Tag Week grid, the color filter, Concourse's sticky scope band.
- Themes (v3.21.0): Chromium screenshots of Home, Catalog, Stock and
  Settings → Appearance in all three themes (phone) and Home on desktop,
  no page errors, clean build. Unconfirmed: the choice saving and loading
  for the business in production, the fonts on iPhone, and the old
  modals (item, labels, sale, eBay) under Tag Week and Concourse, which
  still have some fixed colors.
- New-version strip (v3.20.2): Chromium test on the built app with a newer
  `version.json` (strip shows in the app and Developer Panel, X closes it)
  and with the same version (one check, no strip). Unconfirmed: an iPhone
  home-screen app picking up the next release through the strip.
- Catalog and Stock redesign (v3.20.1): Node tests of `sortCatalog` (every
  order, input untouched) and `summarizeBoxes` (each box count equals its
  catalog filter), Chromium screenshots of the dev build with sample data
  (cards, sort, Sold, bulk bar with More actions, Drafts, the four Stock
  tabs, a box opening the catalog, desktop 2 columns), no page errors, no
  horizontal scroll at 390px, clean build. Unconfirmed on a real phone:
  real photos and data, bulk actions end to end, registering/printing a
  box and a wall marker from Stock, Quick labels and Transfer opened from
  Stock.
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

## Pending changelog entry (since v3.27.0)

- v3.27.2: package numbers on the Pick checklist. Each order gets a number
  (in the order its first line appears in the screenshots), drawn as a black
  ring next to the tick box of each of its pieces, so the pieces of one
  bundle can be matched across boxes. The sheet ends with a "Packages"
  list (number, buyer, piece count); the Pick screen shows the same ring.
  Still organized by box. `tests/domain/pick-packages.test.mjs` (4 tests).
  Unverified in production: a real print of the new rows on the thermal
  printer (the ring and the narrower text at 100 × 210 mm).

- v3.27.1: Pick reads the real money of an order. With "Pricing & Earning
  Info" open in the screenshot, the AI reads the order's total ("Price" or
  "Offer Price"), fee, net earnings and sales tax. A bundle's listed prices
  are before its discount ($112 listed, $80 offer): the total is spread over
  the pieces in proportion to their listed prices, and the real fee and tax
  follow, so Mark sold records the real price, fee and profit. The sales tax
  goes in `saleTax`, apart from price and fee. A closed section keeps the
  old behavior (listed price, fee by the platform's rule) and the sheet says
  how to get exact numbers. An item with no cost gets a cost field on the
  Mark sold sheet. A plain item save now keeps `saleOrderNumber`,
  `saleBuyer`, `saleLineKey` and `saleTax` (it used to drop the first
  three, which freed a recorded screenshot line to be recorded again).
  `tests/domain/pick-bundle.test.mjs` (10 tests). Unverified in production:
  the real Haiku reading the open pricing section on real screenshots
  (Poshmark's "Price" / "Offer Price" rows, other marketplaces), whether a
  paid shipping label shows as its own row or inside Net Earnings (the sheet
  flags a net lower than price − fee), the sheet on an iPhone.

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

### 4. Import an existing spreadsheet (CSV or Excel) — done in v3.23.1 (import) and v3.23.2 (AI column check)

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

Started as Stock → Pick (v3.24.2-4, Vitor 2026-10-20): sale
screenshots → pick list, printed checklist, and Mark sold with the
order number kept on the item (v3.24.4). Still open from this item:
known CSV report parsers, payouts, a sale with no catalog item.

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

### 6. Business customization — done in v3.22.1

Store name, logo and accent color in Settings → Appearance (decisions,
Vitor 2026-10-20: the logo lives in the settings doc as a small image,
the accent covers buttons, links, active tab and nav marker but not the
shell, presets plus a custom picker). Left for later: a per-business app
icon and home-screen name (the manifest is static), the store on printed
labels, the sign-in screen and Developer Panel (stay Calculated Chaos).

### 7. AI credits counter (paid plans) — wanted

Asked by Vitor 2026-10-20, after the Nifty review (its "Smart Credits":
500 or 1,000 a month by plan, extra packs of 200 for $5). Each business
gets a monthly allotment of AI credits by plan; each AI action spends a
fixed number (✨ analysis, listing-only rewrite, narration extract, the
Import column analysis), and extra packs can be bought. Notes for when
it starts:
- Today's counter (`aiUsageCount`/`aiUsageLimit` in `appSettings`) is
  written by the browser, and members can write settings, so it can't
  be the billing source. Credits must be counted and checked on the
  server (`analyze-photo.js`, `narration.js` already log `ai-usage`), in
  a server-written doc under `businesses/{bizId}` that members can only
  read.
- At zero, the server refuses the call with a clear message; the app
  shows the balance in Settings → AI usage and near the ✨ buttons.
- Platform admins set plans and grant credits from the Developer Panel
  (`api/platform.js` actions). Payment provider and prices: not decided.
- Nifty's model, seen in the app (`docs/nifty-review.md`, Settings →
  Subscription): balance "[n] remaining of 500" renewing monthly, a
  usage bar by activity, a ledger Date | Activity | Credits ("Monthly
  credits +500", "AI listing generation −1"), packs of 200 for $5 that
  expire after 90 days; costs 1 per listing or background removal, 5
  per advanced photo edit.

### 8. Ideas from the Nifty review — after item 6

`docs/nifty-review.md` (2026-10-20). Order decided with Vitor: item 6
first, then P1, one PR each: (1) Finances insights (done in v3.22.2) (sell-through,
average profit and days listed per platform, top brands/categories,
previous-period comparison); (2) Goals on Home (done in v3.22.3); (3) an Issues filter in
the catalog with optional warnings in Settings (done in v3.22.4); (4) an eBay sale tracker
(log of detected sales and what the app did; gives Home its "eBay sales
to confirm" row; done in v3.22.5). P1 is complete (rolled up in
v3.23.0).

P2, reordered after the in-app map of Nifty (Vitor, 2026-10-20; details
in `docs/nifty-review.md`):
1. **Expenses and P&L, accrual only** (decided: the app already counts
   an item's cost when it sells; no cash method). 2-3 PRs: expenses
   (done in v3.23.3: a fourth Finances sub-tab, owner only, Vitor
   2026-10-20); the P&L (done in v3.23.4: top of Reports, Overview keeps
   sales profit plus an after-expenses line, Vitor 2026-10-20); the Sales
   list with cost editing (done in v3.23.6: Months renamed Sales, bottom
   sheet on phones, typed 0 = known cost, the missing tag per month
   only, Vitor 2026-10-20); mileage and expense import (done in
   v3.23.7: miles for Sourcing Transportation and Vehicle Expense, a
   fixed IRS table, the import from the Expenses tab only with a
   category-word step, Vitor 2026-10-20). Item 1 is complete.
2. AI custom instructions and a description footer for ✨ (done in
   v3.24.1: the footer already existed as the closing text; the
   instructions are in Settings → Listings, title and description only,
   owner only, with example chips, Vitor 2026-10-20).
3. Pricing rules per platform (needs a price per platform everywhere;
   its own plan).
4. Shipping presets; then Home's What's new card and a Dismissed tab.

The Getting started checklist moves to onboarding (multi-tenant step
5): we design our own. Nifty showed none on an account in use; Vitor
may check a new free-trial account. Not to copy: marketplace automation
with the user's password; for now also market-comps pricing, AI photo
studio, bank import and an assistant (each needs a paid outside
service or data).

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
  · Wall markers (Pick added first in v3.24.2, Vitor 2026-10-20). Finances: Overview · Months · Reports (Expenses added
  before Reports in v3.23.3; Months renamed Sales in v3.23.6, Vitor
  2026-10-20).
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
- Signature features: since v3.21.1 (Vitor, 2026-10-20) each theme has
  its own layout, as presented in the mockup, and the features belong to
  their theme rather than being options: Parcel keeps the tracking line,
  Tag Week has the weekly tag colors (`domain/week-tags.js`; week 0 =
  last 7 days … 4 = 4+ weeks, from `createdAt`), Concourse has the
  "Next" band. Home (`ui/home/home-view.js`) and the catalog cards
  (`renderCatalogList` in `main.js`) branch on `currentTheme()`; a theme
  change fires `themechange` and redraws. Stock, Finances and Settings
  share one layout and only take the theme's tokens.
- Card contract (v3.21.2, Vitor 2026-10-20): every theme shows the same
  item info on a catalog card (code, box, tracking line + stage, price,
  "N days listed" / "N days in catalog", the warning, print and Edit);
  a theme only arranges it. Tag Week's aged-stock row is "Pink tags (4+
  weeks)", on the shelf's clock (`pinkTagStock()`), replacing "Listed
  30+ days" in that theme. Concourse's Next band can be dismissed like
  any row.
- Rule for all new UI code: no hard-coded colors, fonts or radii, only
  the theme's CSS variables, so a theme is one token set.
- Order: D1 the new shell + Home in Parcel → the other screens in
  Parcel → Appearance (the other two themes, logo, accent).
- The Appearance switch (theme only) was pulled forward in v3.21.0 so
  Vitor could try the three themes (2026-10-20); store name, logo and
  accent followed in v3.22.1. Theme features stay with their theme
  (v3.21.1 decision), not options.
- D2 shipped in v3.20.1 (Catalog + Stock), Finances in v3.21.3 and the
  grouped Settings in v3.22.0, which ends "the other screens". Next:
  backlog item 6 (done in v3.22.1), then the Nifty P1 items (backlog
  item 8). Still
  in the old style for the polish phase: the inside of the Platforms,
  eBay and admin panels in Settings (emojis, inline styles, the fee box
  too narrow for "10.00") and the old modals.
- D1 shipped in v3.20.0. Not in it, for lack of data: a "Shipped" stop in
  the pipeline (no shipped status yet; needs "Mark shipped"), the "eBay
  publish errors" row (added in v3.22.4, when errors started being saved
  per item) and "eBay sales to confirm" (added in v3.22.5 with the sale tracker). The Stock tab is a
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
- `docs/trash.md`: the trash for deleted items and the eBay question before a
  delete (v3.26.0).
- `docs/nifty-review.md`: Nifty's structure and tools (2026-10-20, from
  the docs and a read-only map of the app) and what to bring in
  (backlog items 7 and 8).
