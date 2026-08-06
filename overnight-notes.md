# Overnight refactor notes — Calculated Chaos

Session goal: break `src/main.js` (5536 lines, one giant IIFE) into real ES
modules by domain, with **zero behavior changes**. Small commits, each one
pushed, each one `node --check`-clean. No deploys. Real bugs found along the
way go in the "Bugs found (not fixed)" section below, not into a code fix.

## Map of `src/main.js` as of session start (line numbers, pre-refactor)

Everything below lives inside a single `export const app = (function(){ ... })()`
IIFE (line 8 to ~5535). Line numbers will shift as extraction happens — treat
this as the "before" snapshot.

| Lines | Section | Contents |
|---|---|---|
| 1-7 | imports | imports from `./config/firebase.js` and `./ebay-api.js` |
| 15-37 | state | mutable closure vars: `items`, `draftItems`, `currentEditId`, filters, current photo/measurement/status/prep state, etc. |
| 40-166 | constants | `PLATFORM_FEES/LABEL/NAME/COLOR/FAVICON`, `CONDITION_FACTOR/LABEL`, `LISTING_CONDITION_LABEL`, `POSHMARK_STYLE_TAGS`, `PREP_LABEL`, `BASE_CATEGORY_VALUE`, `DAILY_QUOTES` — pure data |
| 75-98 | platform management | `getAllPlatforms/getPlatformLabel/getPlatformColor` — reads `appSettings` (custom platforms + fee overrides) |
| 201-272 | daily quote / insights | `getDailyQuote`, `computePerformanceInsights` (reads `items`), `getTodaysHeaderMessage`, `renderDailyQuote` (touches DOM) |
| 274-333 | Firestore storage | `loadItems`, `saveItem`, `deleteItemFromDb` — read/write `items` collection |
| 335 | `uid()` — pure id generator |
| 337-369 | photo session drafts | `loadDrafts`, `saveDraftToDb`, `deleteDraftFromDb` — own Firestore collection |
| 370-413 | photo hosting at save time | `ensurePhotosHostedForSave`, `setSaveProgress` — Storage upload + progress UI |
| 416-427 | currency input formatting | `attachCurrencyFormatting` — DOM |
| 429-467 | product code / storage box helpers | `nextProductCode`, `fillNextProductCode`, `getAllStorageBoxes` |
| 474-639 | field autocomplete/lookup helpers | sizes, sources, categories, colors, clothing types, autocomplete wiring, shipping defaults |
| 642-669 | image compression | `compressImage` — canvas-based, pure-ish (takes a File) |
| 670-799 | **pricing engine** | `getCategoryPriceHistory`, `estimateMintValue`, `recencyWeight`, `weightedMedianMintValue`, `getPriceReference`, `suggestPrice`, `estimateShipping`, `platformFee` — all read `items`/`appSettings` via closure |
| 800-833 | projected profit / completeness | `projectedProfit`, `isIncomplete`, `missingFields`, `daysSince` |
| 834-1027 | render: stats + filter panel | `renderStats`, `renderFilterPanel`, `filtersActiveCount`, `applyFilters` |
| 1027-1400 | render: catalog | `statusLabel`, `renderCatalog` (huge), `wireCatalogControls` (huge), `escapeHtml`, `toTitleCase` |
| 1401-1446 | render: finance | `renderFinance` |
| 1447-1637 | render: reports + CSV export | `renderReports`, `daysToSell`, `csvEscape`, `downloadCsv` |
| 1637-1840 | report buttons + version badge + renderAll | `wireReportButtons` (huge — wires CSV export buttons), `renderVersionBadge`, `renderAll` |
| 1841-1855 | tabs | `switchToTab` |
| 1856-2070 | eBay category search (curated cache + live) | `slugifyEbayQuery`, `setChosenEbayCategory`, `loadEbayAspectsForCategory`, `renderEbayAspectsFields`, `fetchEbayValidConditions`, `searchEbayCategory`, `renderEbayCategoryResults`, `pickEbayCategoryResult` |
| 2070-2263 | item modal | `openModal` (huge), `closeModal`, `showSavedToast` |
| 2264-2607 | thermal label printing | label/marker canvas drawing, print modal, calibration modal (`window.openMarkerPrintModal`, `window.openCalibInstructionsModal` are global) |
| 2608-2817 | photo session | grid render, reset, commit group, open draft for cataloging |
| 2817-3371 | measure tool | huge — pinch/zoom canvas measuring tool, calibration flow |
| 3372-3446 | status/prep/listed-platform pill UI | `setStatusUI`, `setPrepUI`, `setListedPlatformsUI`, `renderSoldFields` |
| 3447-3644 | photos + lightbox | `renderPhotoPreviews`, lightbox open/close/render/download |
| 3644-3975 | AI photo analysis | Claude vision call + response parsing/rendering |
| 3975-4301 | listing generator | title/description builders, AI listing generator, output rendering |
| 4301-4517 | save / delete | main item-modal save+delete flow (huge, references almost everything above) |
| 4517-5384 | **settings** | huge domain: load/save settings, AI usage counters, `renderSettings` (huge), eBay connection panel, platform settings, all the `window.save*Settings` / `window.add*` handlers |
| 5384-5397 | init | `waitForFirebaseThenLoad` |
| 5397-5520 | auth gate | show/hide auth screens, sign-in/sign-up form wiring, `onAuthStateChanged` |
| 5520-5535 | bridge to ebay-api.js | `return { get items(), get currentEditId(), saveItem, renderAll, escapeHtml, CONDITION_LABEL, bulkSelectedIds, suggestPrice, platformFee, showSavedToast, openModal, renderEbayConnectionStatus, openModalFromBulkReview }` — this is the `app` object `ebay-api.js` imports |

## Why this is high-risk to fully modularize in one night

Almost everything after line ~800 is a closure over the same dozen mutable
`let` variables (`items`, `currentEditId`, `currentPhotos`, `activeFilters`,
etc.) plus heavy, order-dependent DOM wiring (`wireCatalogControls`,
`wireReportButtons`, the measure tool, the modal) that all assume they run
inside the same closure at page load, in the exact order they run today.
Splitting those into separate files means either:
- passing a big shared mutable-state object between every module (a real
  redesign, more the "shared state module" idea from the request), or
- accepting several rounds of careful, one-function-at-a-time extraction
  with manual re-verification of every call site.

Given "no real-time supervision" + "must not break behavior," I'm
prioritizing **safe, mechanical extractions first**: modules that are pure
functions/data with no dependency on the mutable closure state, or whose
only dependency is passed in as a parameter. These carry near-zero risk and
still meaningfully shrink `main.js` and give real domain boundaries. The
deeper "DOM-wiring" sections (catalog rendering, settings, measure tool,
modal save/delete) are much higher risk to split blind overnight — see
"Left for later" below for the reasoning per section.

## Approach taken

1. Extract pure/leaf modules one at a time, each its own commit:
   - `src/modules/constants.js` — platform/condition/style-tag/quote data
   - `src/modules/format-utils.js` — escapeHtml, toTitleCase, daysSince,
     daysToSell, uid, csvEscape, downloadCsv
   - `src/modules/pricing.js` — pricing/profit engine (parameterized on
     `items`/`appSettings` rather than closing over main.js's private vars)
2. After each extraction: `node --check` on every touched file, re-read the
   diff to confirm every call site still resolves, commit, push.
3. Do **not** touch the ebay-api.js↔main.js `app` bridge in this session —
   redesigning that shared-state bridge safely requires the same state
   consolidation as the bigger main.js split, and I'd rather leave one clean
   working bridge than two half-migrated ones with no one awake to catch a
   regression. Noted as a follow-up for daytime work.

(Continued in the "Progress" and "Left for later" sections below as work
happens.)
