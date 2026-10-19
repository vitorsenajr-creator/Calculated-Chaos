# Voice narration capture (added v3.13.8, 2026-08-10)

> **Current state (2026-10-19):** `DEEPGRAM_API_KEY` is set and narration works (v3.13.41). Notes now
> append instead of overwriting. Live Catalog has its own narration since
> v3.13.44 (`modules/live-narration.js`). The "🔮 Analyze with AI" button
> mentioned below is now "✨ Analyze & write listing", and
> `api/generate-listing.js` was removed in v3.13.115. `api/` holds **11**
> route functions now, one slot free under the Hobby cap of 12.


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
  (`requireApprovedUser` guard, API keys server-side only), but as a single
  `action`-dispatched file rather than two separate ones — see the Vercel
  function-limit note below for why. Since v3.15.3 the extract prompt is
  built on the server (`src/modules/narration-prompts.js`); the browser
  sends only `{ kind: 'item' | 'live', transcript }`.
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
