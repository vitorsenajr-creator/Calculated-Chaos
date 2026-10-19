# Changelog

Version history for Calculated Chaos. The current version is also shown in
the badge at the top of the app (`APP_VERSION` in `src/modules/version.js`).

## v3.15.0 — 2026-10-19

Rolls up v3.14.1 – v3.14.2 and starts the work toward offering the app to
other businesses (see `docs/multi-tenant.md`).

- **Developer Panel** (`/admin.html`, admins only): access requests,
  users (approve, revoke, switch employee/full access, remove), the eBay
  connection status (never the tokens) and the eBay error library ranked
  by frequency. Settings now shows only the pending-request count and a
  link to the panel.
- **Firestore rules versioned** in `firestore.rules`, with the missing
  `app_settings` (product-code counter) and `ebay_error_log` collections
  added. Before this, every product-code reservation was denied and the
  app silently fell back to a per-device guess, and the eBay error library
  never saved.
- **✨ analysis on Claude Sonnet 5.5** at low effort, with a server-side
  refusal fallback and a clear message when the request is declined.
- `APP_VERSION` moved to `src/modules/version.js`.

## v3.14.0 — 2026-10-19

Rolls up the v3.13.1 – v3.13.118 series (August to October). Detailed
per-version notes, including each bug's root cause, are in
`docs/v3.13-patch-notes.md`.

- **One AI call per item.** "✨ Analyze & write listing" reads up to 5
  photos and fills in brand, color, type, gender, size, category,
  suggested price, eBay item specifics, title, description and style tags.
  It applies and saves everything on its own, with "🔄 Redo analysis" to
  run it again. "🪄 Rewrite listing text" rewrites only the text without
  re-sending the photos (cheaper). A "🏷️ New with tags" checkbox can be set
  before analyzing. Descriptions were restructured (70-80 character
  titles, short bullets, no repetition). Descriptions can also be
  generated in bulk.
- **Voice narration** ("🎙️ Narrate item"): records, transcribes (Deepgram)
  and fills in the fields. Narrating again appends to Notes instead of
  replacing them. Also available in Live Catalog.
- **Much more robust eBay publishing.**
  - Fixed the serious shipping bug where every listing went out with free
    shipping. There's now a "buyer pays" policy.
  - Automatic adjust-and-retry for eBay's most common errors (missing item
    specific, package type, condition, weight).
  - Sizes are converted to eBay's standard values ("EUR XS / USA XS" →
    "XS").
  - Required fields are checked before publishing.
  - An error library with one-tap fixes, AI explanations for unknown
    errors, and an error log in Settings.
  - The listing link is no longer lost when the item is saved.
- **eBay listing audit** (Settings): checks every listing's shipping policy
  and fixes them in bulk. Finds listings created outside the app and
  imports them into the catalog with their original photos and
  description. Lists shipping policies with their IDs.
- **Labels.**
  - New layout (large SKU, full name and color, box).
  - A single print pipeline for one item and for bulk printing.
  - Print button inside the item.
  - An "extra inspection" flag that shows up on thermal prints.
  - "🔁 Labels" tool: up to 4 codes, prints them one by one or as a PDF
    with one page per label, and can move the items to a box.
  - Register and reprint storage box labels.
- **Inventory.** "📦 Transfer" tool to move items between boxes by typing
  their code, with undo and a list of recent moves. Registration numbers
  now come from a server-side counter, so two devices can't hand out the
  same number; there's a tool to fix old duplicates.
- **Live Catalog** (`/live-catalog.html`), fast numbered capture during
  live sales:
  - sessions by platform and date;
  - narration, color, fabric and photos;
  - its own `LV-0001` SKU;
  - sold tracking;
  - printing on Avery 5260 sheets or a thermal roll, with preview;
  - mobile layout.
- **Sales and fees.** Confirmation when marking an item sold (price,
  platform, who paid shipping, editable fee, other costs), in bulk too.
  Tiered fees for eBay/Poshmark/Depop; Vinted corrected to 0%.
- **Look and usability.** New color palette across the whole app.
  - Dashboard: revenue by platform and stat cards with icons.
  - Catalog:
    - "⚠ Missing info" shows what's missing;
    - "no price set" stands out;
    - the iPhone numeric keyboard no longer flips back to letters in
      search.
  - Employee accounts with Catalog-only access.
  - No more login-screen flash.
  - The interface is 100% English.
- **Data-loss fix.** A failed settings read could overwrite the saved
  settings with defaults. That can no longer happen.
- **Docs.** `CLAUDE.md` trimmed from 2,600 to ~230 lines; each feature's
  write-up moved to `docs/`. The changelog is now in English.

## v3.13.0 — 2026-08-09

- **New desktop Dashboard.** On wide screens (PC), the app now opens on a
  Dashboard home screen with a fixed sidebar (Dashboard, Catalog,
  Finances, Reports, Settings). On a phone it works exactly as before
  (tabs, Catalog first). The Dashboard has:
  - cards for active inventory, items waiting to be listed, profit this
    year and average margin;
  - quick actions (Add item, Photo haul);
  - a profit chart for the last 7 days;
  - revenue by platform (eBay/Poshmark/Mercari/…);
  - recent activity (items cataloged/listed/sold);
  - a "Needs attention" panel (items that are incomplete or listed 30+
    days without selling);
  - a streak counter for consecutive days of cataloging.
- **v3.12.5** — Fixed `ebayPostSoldMessageLines()` firing the "check other
  platforms manually" warning on every item save, not only when the item
  was actually marked sold. Translated the eBay post-sale messages into
  English (they had been written in Portuguese by mistake). New
  validation: an item can't be saved as "Listed" without at least one
  platform checked under "Listed on" (same rule applied to the bulk
  "Set: Listed" action).

## v3.12.4 — 2026-08-07

- After automatically ending an eBay listing successfully, the app now
  shows a confirmation message (it used to stay silent even on success).
- When a sold item is also marked "Listed on" Mercari/Poshmark/Vinted/
  Depop, the app warns to check and remove it manually on those platforms.
  eBay is the only platform the app can end listings on automatically (the
  only one with an API for it).

## v3.12.3 — 2026-08-07

- **Fixed a double-sale risk.** When an item is marked sold, the app tries
  to end its eBay listing automatically, but that could fail completely
  silently (expired token, network error, eBay API error, or an item never
  published by the app). That silent failure is exactly what let the same
  item sell on both Poshmark and eBay. Now, whenever the automatic ending
  fails, a blocking alert asks for the listing to be ended manually on
  eBay.

## v3.12.2 — 2026-08-07

- **Fixed the eBay account connection bug.** Switching app tabs (e.g.
  going back to Settings after authorizing on eBay) rebuilt the whole
  Settings screen and wiped the field where the connection token is pasted
  before it was saved, so connecting seemed to simply stop working. Fixed:
  Settings is no longer rebuilt while that paste is pending.

## v3.12.1 — 2026-08-06

- Removed the legacy "Platform" field from the item form (redundant with
  "Listed on" / "Sold on"). Fee estimates and defaults now come from
  `listedPlatforms`.
- Continued modularizing `src/main.js`: `reports.js`, `settings.js`,
  `state.js`, `catalog-filters.js`, `catalog-lookups.js` and
  `image-compression.js` extracted into their own modules.
- Fixed: the bulk action bar grew without limit on long reports (e.g. 31
  items published), pushing the "Close" button off screen.

## v3.12.0 — 2026-08-06

- Bulk eBay publishing:
  - larger text and "Edit" button in the list of items that are blocked or
    need review;
  - an explicit summary of how many items will publish now vs. how many
    won't this round (and why).
- AI description generation now saves automatically as soon as the
  response arrives, with no separate Save click.
- New tool to generate AI descriptions in bulk for the selected items.
- A saved listing description now stays visible in the item panel after
  saving (it used to disappear from the screen even though it was saved).
- Fixed: the item modal's close button and back-to-top button weren't
  fixed in place on iOS Safari.
- New "back to top" button on the Catalog/Reports/Finances/Settings
  screens.

## v3.11.2 — 2026-08-06

- Started modularizing `src/main.js` (a single ~5,500-line file):
  `constants.js`, `format-utils.js` and `pricing.js` extracted as the first
  modules, with no behavior change.
- Fixed: the "eBay" chip under "Listed on" didn't update live in the item
  modal right after a successful publish (it only showed after reopening
  the item).

## v3.11.1 — 2026-08-06

- Renamed "Generate Poshmark listing" to "Generate listing description"
  throughout the app (the generated text is reused on every platform, not
  just Poshmark).
- Added PWA support: manifest, icons and a service worker for basic
  offline use.

## v3.11.0 — 2026-08-05

- The eBay listing description is now formatted as real HTML instead of
  plain text.
- Updated the eBay condition text; the platform the item actually sold on
  is now recorded.
- Fixed: the listing generator always uses the structured (Poshmark-style)
  generator, regardless of platform.

---

_This file is maintained by hand at every minor version bump. For the full
commit-by-commit history, see `git log --oneline`._
