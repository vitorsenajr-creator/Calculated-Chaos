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

- `APP_VERSION` / `APP_VERSION_DATE` in `src/main.js`, format
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

- `src/main.js`: ~7,300 lines, one IIFE (`export const app = (function(){…})()`).
  Holds the catalog, item modal, settings, labels, measure tool, AI flows
  and reports UI. See `docs/modularization.md`.
- `src/ebay-api.js`: client side of eBay publish/bulk publish/error box.
- `src/live-catalog.js` + `live-catalog.html`: separate Vite entry (see
  `docs/live-catalog.md`).
- `src/modules/`: pure helpers and small controllers. Key ones:
  - `state.js`: shared `items`/`appSettings`.
  - `constants.js`, `pricing.js`, `settings.js`.
  - `ai-item.js`: ✨ analysis prompt + schema.
  - `narration-capture.js`, `live-narration.js`.
  - `ebay-audit.js`, `ebay-error-hints.js`/`-log.js`/`-ai.js`,
    `ebay-size.js`, `ebay-aspect-match.js`, `ebay-type-map.js`.
  - `product-code-bank.js`, `sold-confirm.js`, `dashboard.js`.
- `api/`: **11 route functions; the Vercel Hobby cap is 12**. Prefer
  adding an `action`/`mode` to an existing file over a new file.
  Underscore files (`_requireApprovedUser.js`) don't count.
  - `analyze-photo.js`: ✨ analysis, `mode: full | listing_only`, Sonnet 5.5
    at `effort: low`, with server-side refusal `fallbacks`.
  - `narration.js`: `transcribe` (Deepgram) / `extract` (Haiku 4.5).
  - `ebay-item-aspects.js`: category aspects, `suggest_fee`,
    `explain_error`.
  - `ebay-listing-tools.js`: audit, legacy scan/migrate, backfill,
    policies, offers.
  - `ebay-list.js`: publish, with the adapt-and-retry loop.
  - `ebay-setup.js`, `ebay-auth.js`, `ebay-category-search.js`,
    `ebay-check-sales.js`, `ebay-end-listing.js`.
  - `ebay-account-deletion.js` and `ebay-auth.js` have URLs registered in
    eBay's developer portal. **Never rename or merge them.**
- Vercel env vars: `ANTHROPIC_API_KEY`, `DEEPGRAM_API_KEY`, `EBAY_CLIENT_ID`,
  `EBAY_CLIENT_SECRET`, `EBAY_REDIRECT_URI`, `EBAY_SANDBOX`,
  `EBAY_FULFILLMENT_POLICY_ID`, `EBAY_FULFILLMENT_POLICY_ID_BUYER_PAYS`,
  `EBAY_PAYMENT_POLICY_ID`, `EBAY_RETURN_POLICY_ID`,
  `EBAY_MERCHANT_LOCATION_KEY`, `EBAY_DELETION_ENDPOINT_URL`,
  `EBAY_DELETION_VERIFICATION_TOKEN`.
- Firestore collections and docs:
  - Catalog and app data: `items`, `drafts`, `users` (role/status),
    `app_config/settings`, `app_settings/productCodeCounter`,
    `ebay_tokens/main`, `ebay_error_log`.
  - Live Catalog: `liveSessions`, `liveItems`, `live_catalog_options/*`.
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

- **Multi-business (paid, for new sellers)**: design accepted, no code yet.
  See `docs/multi-tenant.md` for the data model, AI credits and PR order.
- **General eBay review**: Vitor plans to review the whole eBay flow soon
  (2026-10-19). The shipping-policy bug is considered resolved; see
  `docs/ebay-shipping-policy.md`.
- **Employee accounts are UI-restricted only**. Firestore rules in the
  Console must enforce the role to make this real
  (`docs/employee-accounts.md`).
- **Model update**: `analyze-photo.js` moved to `claude-sonnet-5-5` at
  `effort: low` (v3.14.1). `suggest_fee` still uses `claude-sonnet-4-6`
  and `narration.js` extract uses `claude-haiku-4-5`; those switches are
  left for a separate change. Check the `claude-api` skill for current IDs
  before doing them.
- **Watch the Vercel logs** for `ai-usage` lines with `"structured":false`
  (the structured-output fallback ran on `analyze-photo.js`).
- **Firestore rules v3.14.2 must be pasted into the Console** (adds
  `app_settings` and `ebay_error_log`). Until then the product-code counter
  and the eBay error library keep failing silently. `email_verified` was
  deliberately not added to `isAdmin()`: the app never sends verification
  emails, so the admin accounts are likely unverified and would lock out.

### Unverified in production (build-verified only)

Last known status per the v3.13 notes. Confirm with Vitor before relying
on any of these:
- ✨ analysis on Sonnet 5.5 / low effort, refusal fallback and the new
  "declined" message (v3.14.1).
- ✨ analyze + auto-apply + Redo (v3.13.115-117), NWT checkbox (v3.13.116).
- eBay error library, AI explanation, aspect matching, Type auto-fill
  (v3.13.108-110), publish-step retry loop (v3.13.51).
- Quick Labels one-by-one queue and PDF export (v3.13.106/107), label font
  sizing (v3.13.102-105), inspection flag icon (v3.13.114).
- Live Catalog label printing on a real Avery sheet / phone (v3.13.45/47).

## Pending changelog entry (since v3.14.0)

- **v3.14.1**: `api/analyze-photo.js` switched from `claude-sonnet-4-6` to
  `claude-sonnet-5-5` at `effort: low` (Vitor's choice after an Opus 5.5
  vs Sonnet 5.5 evaluation; photo error rate was already near zero, so
  cost/latency won). Thinking is always on for this model (adaptive), so
  `max_tokens` went from 3000/1800 to 16000/8000 to leave room for it.
  Added `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`) so
  a classifier refusal re-runs on Anthropic's fallback model, and a
  client message when `stop_reason` is `refusal`. `ai-usage` logs now
  include `effort` and `stop_details`. Expected cost ~$0.03-0.04/item
  (estimate; confirm from `ai-usage` logs).
- **v3.14.2**: Firestore rules now versioned in `firestore.rules`. Added
  the missing `app_settings` (product-code counter; every reservation had
  been denied, and the app fell back to a per-device guess, so duplicate
  numbers across devices were possible) and `ebay_error_log` (the eBay
  error library never saved). No app code changes besides the version.

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

### 2. Move fixed AI rules into a server-side `system` prompt

`api/analyze-photo.js` and `api/narration.js` (`extract`) accept a
browser-built `promptText` as the only user message, with no `system`.
- **Security**: any approved user can send any prompt from DevTools and
  use the server's Anthropic key as a general Claude proxy, or override
  the listing rules.
- **Caching**: the fixed rules are most of the ~2,600-token prompt but
  come after the photos, so nothing caches. Put them in `system` with
  `cache_control`. Savings are modest, since images dominate cost. Check
  the minimum cacheable length first.

Shape: the client sends structured fields (`f`, conditionLabel, `aiFacts`,
mode); the server imports the pure builders from `src/modules/ai-item.js`
(same pattern as `pricing.js`). Do this together with item 1.

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

## Docs index

- `docs/v3.13-patch-notes.md`: detailed notes for every v3.13.x patch
  (root causes, decisions). Historical; names reflect that version.
- `docs/ebay-shipping-policy.md`: the v3.13.9 buyer-pays shipping bug
  (resolved).
- `docs/multi-tenant.md`: ADR for offering the app to other businesses.
- `docs/live-catalog.md`, `docs/narration.md`, `docs/dashboard.md`,
  `docs/employee-accounts.md`, `docs/platform-fees.md`,
  `docs/sold-confirmation.md`, `docs/modularization.md`.
