# Modularization and app readiness

> **Current state (2026-10-19, v3.17.3):** `main.js` is ~6,000 lines, one
> IIFE (`export const app = (function(){ ... })()`). Phases 1 and 2 below
> are done (phase 2 except moving the last three file downloads onto the
> file adapter); phases 3-4 are not started. The goal is a smaller `main.js` **and** a
> codebase that can ship as a phone app without a rewrite.

## The three layers (2026-10-19)

Every new module belongs to one layer, and the folder says which:

| Layer | Folder | What it may touch | Runs in |
|---|---|---|---|
| **Domain** | `src/domain/` | Nothing but its inputs: data in, result out. No DOM, no `window`, no Firebase, no app state (pass settings in as parameters). | Browser, native app, server, tests |
| **UI** | `src/ui/` | The DOM and the shared app state (`modules/state.js`). No direct device APIs. | Anywhere with an HTML screen (browser, Capacitor WebView) |
| **Platform** | `src/platform/` | Device and environment APIs: printing, file save/share, clipboard, camera/microphone, opening URLs, the API base URL. | Swapped per environment (web today, native app later) |

Why it matters for an app: the cheapest route to the App Store / Play
Store is **Capacitor**, which wraps this same web app in a native shell and
reuses almost all of it. What breaks in that shell is the platform layer
(see the inventory below), so those calls should live in a few files that
get a native implementation, instead of being spread across `main.js`. If
the app ever moves to a fully native UI (e.g. React Native), the domain
layer is what carries over unchanged, which is why pure logic is extracted
first and kept free of `appSettings` and the DOM.

The older `src/modules/` folder predates this and mixes layers (most of it
is domain-like: `pricing.js`, `constants.js`, `ai-item.js`; some is UI:
`sold-confirm.js`, `ebay-audit.js`). Modules move into the new folders
only when they're touched for another reason; no mass move.

### How a piece gets extracted (the method used in phase 1)

1. **Find the boundary.** List every name the piece uses from the rest of
   `main.js` (ESLint `no-undef` on the new file finds what's missing) and
   every name the rest of `main.js` uses from it. Fewer crossings = a
   better boundary. Phase 1's label rendering crossed only
   `appSettings` and `escapeHtml`; its print modal crossed dozens of
   names, so it waited for phase 2.
2. **Characterization test before moving.** Save the old code, run old and
   new side by side on the same inputs, and require identical output
   (byte for byte for text/HTML, pixel for pixel for canvas). This pins
   today's behavior, bugs included, so a refactor can't change it by
   accident. Phase 1: 79 cases, plus a behavior test of the lightbox.
   Phase 2: one scripted run of ~100 steps through every label flow in
   Chromium, on the real `index.html` markup, recording each screen state
   and every print, share, download, save and PDF call; old and new runs
   must match entry for entry.
   It caught one real slip: re-indenting the moved code also changed the
   whitespace inside multi-line template strings, which is part of the
   generated HTML.
3. **Move, don't improve.** The code moves as is; only the interface
   changes (exports, parameters instead of globals). Improvements are a
   separate change with their own test.
4. **Encapsulate state.** A module owns its variables and exposes
   functions. Before phase 1, the catalog grid wrote the lightbox's
   `lightboxPhotos`/`lightboxIndex` directly; now it calls
   `openLightbox(photos, index)`.
5. **Inject what lives inside the IIFE.** A module can't import
   `saveItem` or `renderSettings` from `main.js` (they're local to its
   IIFE, and importing back would make a cycle), so its `init…(deps)`
   takes them as parameters. The dependency list is then explicit in one
   call in `main.js`. Shared data (`items`, `appSettings`) still comes
   from `modules/state.js`.

## Phase 1 (done, v3.17.2)

- `src/domain/listing-copy.js`: `buildListingTitle`,
  `buildListingDescription(fields, { standardClosingText })`. The closing
  line used to be read from `appSettings`; it's now a parameter, so the
  module is pure. `main.js` keeps a one-line wrapper that passes
  `appSettings.listingStandardText`.
- `src/ui/lightbox.js`: `openLightbox(photos, index)`, `closeLightbox()`,
  `isLightboxOpen()`, `initLightbox()` (wires the listeners once).
- `src/ui/label-render.js`: label preview markup and canvas drawing
  (item, batch, storage box, calibration marker) plus `shrinkToFit`/
  `shrinkWrappedToFit` and `computeSharedBatchFonts`. Reads the label
  settings from `state.js`. The print modal, Quick Labels and storage
  boxes that use it stay in `main.js` for phase 2; every print still goes
  through `openBatchLabelModal` (one pipeline).

`main.js`: 7,303 → 6,726 lines.

## Phase 2 (done, v3.17.3)

- `src/ui/labels/print-modal.js`: `openBatchLabelModal(items, session)`
  (the one print pipeline), `openBoxLabelModal(box)`, the wall marker and
  calibration-instructions handlers, and the Print / Save image buttons.
  A caller that must know when the modal closes passes a `session`
  (`{ title, onClose(reason) }`, reason `'cancel'` or `'done'`); that
  replaced the modal reading Quick Labels' queue variables directly.
- `src/ui/labels/quick-labels.js`: reprint by code, the one-by-one queue
  (through the session above) and the multi-page PDF.
- `src/ui/labels/storage-boxes.js`: register + print, reprint, remove (the
  `window.*` handlers `renderSettings()` calls).
- `src/ui/labels/stock-transfer.js`: the transfer tool and
  `refreshStockTransferBoxListIfOpen()`.
- `src/domain/product-code-match.js`: `findItemByProductCodeDigits(items,
  code)`, shared by Quick Labels and Stock Transfer.
- `src/platform/print.js`: `printHtml(html, { widthIn, heightIn })` and
  `initPrint()` (the way back from the print-only view). It must stay
  synchronous (iOS drops `window.print()` after an await, v3.13.47).
- `src/platform/files.js`: `saveOrShareFile(blob, filename, type,
  { onShareError })` → `'shared' | 'downloaded' | 'cancelled'`. The share
  sheet when available, else a download link. `onShareError: 'throw'`
  keeps the PDF's old behavior (a failed share is an error, not a
  download).

`main.js`: 6,726 → 5,998 lines.

## Next phases (safest first)

2b. **The remaining file downloads onto `platform/files.js`**: the measure
   tool's "save labeled photo" (same share-or-download code), the item
   photo download and the CSV export (download only). Small, separate PR.
3. **Settings** (~950 lines: `renderSettings()` and the
   `window.save*Settings` handlers) into `src/ui/settings/…`. Do this
   before the onboarding work (docs/multi-tenant.md step 5), which adds
   business settings and sign-in screens.
4. **Leave for last / maybe never:** the item modal open/save/delete and
   eBay category search (~650 lines), the most state-coupled section.
   Also the measure tool (~550 lines, self-contained) and the ✨ AI flows
   can move whenever they're next changed.

## App-readiness inventory (2026-10-19)

The calls a native app shell would need to replace, by file. Each one
should end up behind `src/platform/`:

| What | Where today | In a Capacitor app |
|---|---|---|
| API calls as relative `/api/...` (25) | `main.js` 11, `ebay-api.js` 5, `admin.js` 3, `live-narration.js` 2, `narration-capture.js` 2, `ebay-audit.js` 1, `ebay-error-ai.js` 1 | Relative URLs point at the app bundle, not the server: needs one `apiUrl(path)` helper with the production origin |
| `window.print()` (3), `a.download` (6), `navigator.share` (3), `window.open` (6), clipboard (3) | mostly `main.js` (12), `live-catalog.js` (3), `admin.js`, `ebay-api.js` | Printing and downloads need plugins (Printer, Filesystem + Share); `window.open` needs the Browser plugin |
| Microphone / camera (`getUserMedia`, `MediaRecorder`) (6) | `narration-capture.js`, `live-narration.js` | Works in the WebView with the right permission strings in the native project |
| Firebase Auth sign-in | `src/config/firebase.js` | Email/password works as is; Google sign-in needs the native plugin (see docs/multi-tenant.md step 4a) |
| Service worker | `public/sw.js` | Not used inside the app shell; the web/PWA keeps it |

## History

Earlier extractions (v3.13.x) into `src/modules/`, all as pure functions
parameterized on `items`/`appSettings` with thin wrappers left in
`main.js`: `constants.js`, `format-utils.js`, `pricing.js`, `reports.js`,
`settings.js`, `state.js`, `catalog-filters.js`, `catalog-lookups.js`,
`image-compression.js`, `dashboard.js`, `platforms.js`; then
`sold-confirm.js` and `narration-capture.js` (extracted right after being
written, which is much cheaper than extracting battle-tested code later),
`ai-item.js`, `live-narration.js`, `ebay-audit.js`, `ebay-error-*.js`,
`ebay-size.js`, `ebay-aspect-match.js`, `ebay-type-map.js`,
`product-code-bank.js` and `biz.js`. The 2026-08-09 plan's phases are
folded into the list above (its `ai-photo-analysis.js` became
`ai-item.js`).
