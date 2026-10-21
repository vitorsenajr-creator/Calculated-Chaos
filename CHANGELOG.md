# Changelog

Version history for Calculated Chaos. The current version is also shown in
the badge at the top of the app (`APP_VERSION` in `src/modules/version.js`).

## v3.25.0 — 2026-10-21

Stock → Pick, AI writing instructions, the AI usage meter and the Home,
Developer Panel and item form polish. Rolls up v3.24.1 – v3.24.12.

- **Stock → Pick** (v3.24.2 – v3.24.4). Add screenshots of your sales
  (Poshmark, eBay, Mercari…) and the app lists the sold pieces box by box:
  found by SKU, by an imported item's old code or by name, with a tick per
  piece. It warns about pieces already marked sold, pieces still listed
  elsewhere and two sales pointing to one piece. Each screenshot uses one
  AI analysis. A printed checklist (100 × 210 mm labels, black only) lists
  the pieces to pick, with a "Picked by / Date" line. "Mark sold" records
  the sales on their items in one go: price and platform from the
  screenshot, the fee per order (a bundle's fee on the order total, split
  by price), shipping paid and the sales profit. The eBay listing is ended
  when the piece sold elsewhere, and the order number is kept so the same
  sale can't be recorded twice.
- **AI writing instructions** (v3.24.1). Settings → Listings: tell the AI
  how you like your listings written (up to 1,500 characters, with example
  chips). ✨ analysis and Rewrite follow them for the title and description
  only; the item's details, the price and the closing text stay as before.
- **AI usage meter** (v3.24.5, v3.24.6). Every successful AI call is
  counted on the server per user, month, feature and model. The Developer
  Panel's "AI usage" tab shows the totals, per user and per feature. It
  only measures for now; nothing is charged.
- **Item form quantity** (v3.24.12). The Quantity field stays visible after
  a save. On an item being edited it reads "Add copies" and makes that
  many unsold copies with the same details, numbered after the base code;
  the original keeps its code. Storage box moves next to Source.
- **Home** (v3.24.9). The + button no longer covers the row buttons on a
  phone. The stock insight no longer repeats the summary's numbers, and
  Goals with no goal set is one compact row. Tag Week's shelf hides empty
  weeks; Concourse's sidebar icons are legible.
- **Developer Panel** (v3.24.8, v3.24.10, v3.24.11). Follows the business
  Appearance, with a header in the theme's main color, flat sections and
  a tab line that no longer shows a scrollbar.
- **Colors** (v3.24.12). ✨ Analyze and Narrate use the theme's main color
  (Concourse's Analyze is its signal yellow).

## v3.24.0 — 2026-10-20

The spreadsheet import and the money side of the Nifty P2 ideas
(`docs/nifty-review.md`): expenses, Profit & Loss, the Sales list and
mileage. Rolls up v3.23.1 – v3.23.7.

- **Import a spreadsheet** (v3.23.1). Settings → Data → Import: choose an
  Excel or CSV file (and its sheets), check how each column and value
  was matched, preview the items with errors and possible duplicates,
  then save in batches with progress, Continue after a dropped
  connection and Undo (also later, from Past imports). Each row gets a
  new app code, the sheet's own code is kept and searchable, a quantity
  becomes that many items, and sold rows come in as sales with their
  profit. Imported items have their own warning settings and an
  "Imported" filter chip.
- **AI column check for the import** (v3.23.2). When the Columns step
  opens, the AI reads the headers, ten sample rows and the status,
  condition and platform words, and fills in what the column names
  didn't settle (marked "AI"). It never changes a column the person set
  and counts as one AI use; without it the name-based matches stand.
- **Expenses** (v3.23.3). A new Expenses tab in Finances for what the
  business spends outside a sale: 22 tax-style categories, each
  explained in one line, plus refunds; totals and the split by category
  for the month, year or all time; edit, delete, "Save and add another";
  CSV export. Buying stock isn't an expense: an item's cost counts when
  it sells.
- **Profit & Loss** (v3.23.4). Reports opens with a statement for this
  or last month, this or last year, or all time: revenue by platform,
  the cost of the items sold, gross profit, selling costs, operating
  expenses by category and net profit, with a CSV export. It ends on the
  same sales profit as Overview ("Sale adjustments" shows any
  difference).
- **Sales profit and Net profit** (v3.23.5, after a design review). The
  profit of the sales is "Sales profit" everywhere (Home, Goals,
  Overview, Months); "Net profit" means after expenses and gets its own
  Overview cell once there are expenses. "See P&L" keeps the period, the
  Expenses list exports the period on screen, the expense form keeps its
  messages in view with the keyboard open, the P&L reads as a small
  ledger on a phone, the Finances tabs fit small phones, and buttons are
  44px.
- **Sales list** (v3.23.6). Finances → Months is now Sales: open a month
  to see each sale with its price, fees, item cost, shipping, other
  costs and profit (a table on a computer, cards on a phone) and fix
  costs right there; the profit updates everywhere. Months with sales
  missing an item cost are tagged and can be filtered; "Save & next
  missing" goes through them. Typing 0 marks a free or gifted piece.
- **Mileage and expense import** (v3.23.7). Sourcing trips and vehicle
  use can be entered in miles at the IRS rate for the date (72.5¢
  through June 30, 2026, 76¢ from July 1), with a round-trip button.
  Expenses can be imported from a CSV or Excel file (a bank export,
  Nifty's format or the app's template): columns and category words are
  matched, unknown words are asked about or skipped as personal,
  possible duplicates are flagged, and the import saves with progress,
  Continue and Undo.

## v3.23.0 — 2026-10-20

Store identity and the Nifty P1 ideas (`docs/nifty-review.md`). Rolls up
v3.22.1 – v3.22.5.

- **Store identity** (v3.22.1). Settings → Appearance gets the store
  name and logo (shrunk to 256 px) and an accent color (eight presets,
  a custom picker, or the theme's own). The header and sidebar show the
  logo, the store name and "by Calculated Chaos". The accent drives
  buttons, links, the active tab and the navigation marker in every
  theme, adjusted where needed so text stays readable.
- **Finances insights** (v3.22.2). Overview's numbers show the change
  against the same days of last month (or the same point of last year).
  A fifth number, Sell-through: items sold ÷ items in stock or cataloged
  in the period. "By platform" adds units, average profit and average
  days to sell. New Top brands and Top categories panels.
- **Goals on Home** (v3.22.3). Up to 4 goals for profit, revenue, items
  sold, items cataloged or sell-through, by week, month, quarter or
  year, set by the owner. Each has a progress bar with a "steady pace by
  today" marker and the days left. Every period starts again on its own.
- **Issues in the catalog** (v3.22.4). A strip shows how many items have
  issues and filters to them: no price, the last eBay publish failed
  (now saved on the item), a product code used twice, missing info, or
  listed too long. The card warning names the most urgent issue, and a
  tap lists them all. Home gains "eBay publish errors" and "Duplicate
  codes". Settings → Warnings turns each missing-info check on or off
  and sets the listing age (30, 45, 60, 90 days or off).
- **eBay sale tracker** (v3.22.5). Each eBay sale the app detects is
  logged with what it did and where the item was still listed.
  Settings → eBay → Sale tracker shows the last 60 days. Home's "eBay
  sales to confirm" counts the sales to delist on another platform or
  handle by hand, until marked Done. Sales are still marked Sold
  automatically.

## v3.22.0 — 2026-10-20

Finishes the "other screens" phase of the redesign. Rolls up v3.21.1 –
v3.21.3.

- **Grouped Settings.** Settings opens on an index (Account, Appearance,
  Pricing & platforms, Shipping, Listings, Labels, AI usage, Team, eBay,
  Data), each row with a one-line summary. On the phone a group opens on
  its own page with a Back link; on a computer the index stays on the
  left and the last group opened comes back. The eBay group is split
  into Connection, Sales and offers, and Tools. Sections use the new
  panels, buttons lost their emojis, and every color comes from the
  theme. AI usage has its own Save button. Saves are unchanged.
- **Finances redesigned** (v3.21.3). A new Overview tab: Month / Year /
  All time (remembered on the device, separate from Home), revenue, net
  profit, margin and items sold, where each dollar of revenue went,
  profit for the last 12 months (tap a month to open it), revenue by
  platform and the in-stock projection. Months lists one row per month
  that opens the same breakdown as before. Reports keeps its content in
  the new panels, with the exports in an Export panel at the end.
- **Each theme has its own layout** (v3.21.1). Tag Week: "Shelf by tag"
  on Home (in-stock items by the week they came in, tap a color to
  filter), a photo-grid catalog with a hanging tag in the week's color.
  Concourse: a yellow "Next" band with the most urgent task, monumental
  numbers, a "Then" list, and a catalog led by big product codes.
  Parcel is unchanged.
- **Design re-critique fixes** (v3.21.2). The same item info on the
  cards of every theme, a visible focus ring on the dark bars, Tag Week
  "Pink tags (4+ weeks)", a dismissible Concourse Next band, 44px tap
  targets, the + button no longer covering the last item, and contrast
  fixes.

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
