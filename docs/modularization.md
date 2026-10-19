# Modularization progress

> **Current state (2026-10-19):** `main.js` is ~7,300 lines (2026-10-19), not the 5,541 quoted below. Modules
> added since include `ai-item.js` (replaces the planned
> `ai-photo-analysis.js`), `narration-capture.js`, `live-narration.js`,
> `ebay-audit.js`, `ebay-error-*.js`, `ebay-size.js`, `ebay-aspect-match.js`,
> `ebay-type-map.js` and `product-code-bank.js`. None of the phases below
> have been started.


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
