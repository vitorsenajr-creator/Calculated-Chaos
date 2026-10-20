# Changelog

Version history for Calculated Chaos. The current version is also shown in
the badge at the top of the app (`APP_VERSION` in `src/modules/version.js`).

## v3.21.0 — 2026-10-20

Continues the redesign. Rolls up v3.20.1 – v3.20.2.

- **Three themes.** Settings → Appearance switches the whole app, for
  everyone in the business, between Parcel (navy and white), Tag Week
  (black with thrift-store tag colors, Bricolage Grotesque) and
  Concourse (black, white and signal yellow, Fira Sans). Each theme's
  typeface loads only when it's in use, and the phone's status bar takes
  the theme's color. Each theme's extra features (color tags by week,
  the next-task strip) come later.
- **Catalog redesigned** (v3.20.1). All / Drafts tabs (photo drafts moved
  out of the banner), status shortcuts with counts, a sort menu (newest,
  oldest, price both ways, listed longest), a new item card (product
  code, box, days, pipeline dots, platforms; sold items show the profit
  and a gray photo), two columns on a computer, and a regrouped bulk bar
  with "More actions" and Delete set apart.
- **Stock screen** (v3.20.1). Labels, Transfer, Boxes and Wall markers
  tabs. Boxes shows how many items each box holds and opens the catalog
  filtered by it; Boxes and Wall markers moved out of Settings.
- **"A new version is available"** (v3.20.2). The app and the Developer
  Panel notice when the server has a newer version and offer an Update
  button. The offline cache no longer stores server calls.

## v3.20.0 — 2026-10-20

The redesign starts (CLAUDE.md, "Redesign"): a new app shell and Home
screen in the first of three planned themes, "Parcel". Rolls up v3.19.1.

- **New navigation.** Five places, the same on every device: Home,
  Catalog, Stock, Finances, Settings. A bottom bar on the phone and a
  sidebar on the computer replace the scrolling top tabs. Labels and
  Transfer moved into Stock; Months and Reports are now tabs inside
  Finances.
- **Home is the start screen.** It shows In stock, Sold, Profit and
  Projected for this month, this year or all time; the item pipeline
  (Cataloged, Listed, Sold); a "Needs attention" list (no price, missing
  info, listed 30+ days, photo drafts), each with one button that opens
  the right items; and revenue by platform, now on the phone too. The
  daily quote moved here. The desktop-only Dashboard is gone.
- **One "+" button** opens New item, Quick catalog and Photo session, on
  Home and Catalog only.
- **Slim header.** The title, subtitle, platform list and the stats strip
  are gone from the top of every screen. The version number, "Check for
  updates" (the old refresh button) and Sign out are in Settings →
  Account. Employees, who only see Catalog, keep a Sign out button in
  the header.
- **The Parcel look across the app:** navy, cool white, red only for
  urgent things, and the Archivo typeface. Every color now comes from a
  theme variable, ready for the other two themes. Label printing keeps
  its own fonts.
- **Catalog filters "No price" and "Listed 30+ days"** (used by Home).
- **Finances profit matches the rest of the app** (v3.19.1): it now
  includes Other costs, shown as its own box per month.

## v3.19.0 — 2026-10-19

Rolls up v3.18.1 – v3.18.4, which finish the admin and email part of the
sign-in hardening (`docs/multi-tenant.md` step 4a), and starts a cleanup
that keeps the app focused on inventory, logistics, listings and finances.

- **Live Catalog removed.** The 🔴 Live tool, its page and its voice
  narration are gone (the last version is tagged `live-catalog-last`).
  Its sessions, items and options are kept, frozen: only platform admins
  can read them, and the Developer Panel backup still includes them.
- **Admins by account, not by email** (v3.18.1). Platform admins are
  listed by account ID on the server, and the app and the security rules
  trust only the server-set admin claim. A new account always starts as
  pending, even with an admin's email.
- **User management on the server** (v3.18.2). Remove disables the login,
  signs the person out and takes them off the business; Restore undoes
  it. Deny deletes a pending request and its login. Creating an employee
  in Settings works again (it had been failing since the rules allow only
  self-created user records). The Developer Panel shows each account's
  email status, disabled login and last sign-in.
- **Email verification on request** (v3.18.3). "Send verification email"
  and "I've verified it" on the "Awaiting approval" screen and in
  Settings → Account. Nothing is ever sent automatically; only the
  person's own click sends one.
- **Verified email required** (v3.18.4). The security rules, the server
  and the sign-in screens require a verified email; an approved but
  unverified account sees a "Verify your email" screen. Pending accounts
  are unaffected.

## v3.18.0 — 2026-10-19

Rolls up v3.17.1 – v3.17.6 (the `main.js` split) and starts the sign-in
hardening that comes before onboarding new sellers
(`docs/multi-tenant.md` step 4a).

- **Admin access as a server-set claim.** Developer Panel → App → "Admin
  access" lists the admin accounts (UID, claim, email verified) and "Sync
  admin access" has the server mark them with the `platformAdmin` claim.
  The security rules accept the claim or the old email list for now; the
  next update drops the email list.
- **`main.js` split into layers** (v3.17.2 – v3.17.6,
  `docs/modularization.md`): `src/domain/` (pure logic: listing copy,
  product-code matching), `src/ui/` (lightbox, label rendering and
  printing, Quick Labels, storage boxes, Stock Transfer, the Settings
  screen), `src/platform/` (printing and file saving, so a phone app only
  swaps this layer) and `src/data/` (the settings store). `main.js` went
  from 7,303 to 4,956 lines. Each move was checked by running the old and
  new code side by side; there is no behavior change, except that a CSV
  export's temporary link is released 2 s after the click instead of
  immediately.
- **Developer Panel reads the business** (v3.17.1): the eBay errors and
  Backup tabs use the admin's live business (the backup includes its
  members and `users`); the frozen pre-business collections have their
  own backup button. Platform admins may read, not write, any business's
  data.

## v3.17.0 — 2026-10-19

Rolls up v3.16.1 – v3.16.5 and moves the app's data into a business
(`docs/multi-tenant.md`), switchable from the Developer Panel.

- **Business data, behind a switch.** The catalog, drafts, Live Catalog,
  counters, settings, eBay error library and eBay connection are copied
  into `businesses/{bizId}/…` (Developer Panel → App → "Business
  migration": counts, copy, switch, switch back, sync members). The copy
  never deletes the original data, can be re-run, and removes from the
  business anything deleted since an earlier copy. After the switch the
  app, the server (eBay endpoints use the business's connection) and the
  Firestore rules all follow one field, `businesses/{bizId}.live`.
- **Old data locked after the switch.** The rules keep the pre-business
  collections readable but block writes for a live business's members, so
  a device still running an old page can't save to the old place.
- **All business data goes through `bizCol()`/`bizDoc()`**
  (`src/modules/biz.js`, v3.16.4), which pick the business or the
  pre-business paths at sign-in.
- **Connect eBay without copy-paste** (v3.16.2–v3.16.3): the eBay sign-in
  tab finishes the connection itself using a one-time `state` code; the
  tokens are never shown or pasted. A sign-in page loaded twice shows the
  first result instead of an error.
- **Legacy eBay token removed** (v3.16.1): `ebay_tokens/main` and its rule
  are gone.

## v3.16.0 — 2026-10-19

Rolls up v3.15.1 – v3.15.5 and moves the eBay connection to the server.

- **eBay tokens live only on the server** (`ebay_connections/main`,
  readable only through Firebase Admin). Every eBay endpoint uses the
  server's token and refreshes it itself; the app only sees the
  connection's status. The existing connection is copied over on first
  use, so no reconnect is needed. Connecting and disconnecting are for
  owners only; employees can still end listings when marking items sold.
- **Server-side security** (v3.15.1–v3.15.4): every eBay endpoint requires
  a signed-in, approved user; the ✨ analysis and narration prompts are
  built on the server (text unchanged, verified byte for byte); Firebase
  Admin verifies sign-in tokens, with a health check in the Developer
  Panel.
- **Developer Panel**: a button next to "Sign out" for admins (v3.15.2)
  and a Backup tab that downloads every collection as JSON, plus steps
  for a Google Cloud export (v3.15.5).

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
