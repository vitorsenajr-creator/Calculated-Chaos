# Project conventions — Calculated Chaos

## Versioning & CHANGELOG.md

`APP_VERSION` in `src/main.js` follows `vMAJOR.MINOR.PATCH` (e.g. `v3.12.5`).

- Bump the version (and `APP_VERSION_DATE`) with every meaningful change,
  same as always.
- **Only update `CHANGELOG.md` when MINOR changes** (e.g. `v3.12.x` →
  `v3.13.0`) — not on every patch bump inside the same minor series
  (`v3.12.2`, `v3.12.3`, `v3.12.4`, `v3.12.5`, …).
- Patch-level changes within the current minor series are tracked below,
  in "Pending changelog entry", and folded into `CHANGELOG.md` as one
  consolidated entry the moment the minor version bumps. Clear this list
  right after writing that entry.

### Pending changelog entry (not yet in CHANGELOG.md)

Changes since the last CHANGELOG.md entry (v3.12.4), to fold into the
v3.13.0 entry whenever that minor bump happens:

- **v3.12.5** — Fixed `ebayPostSoldMessageLines()` firing its "check other
  platforms manually" reminder on every item save, not only when the item
  was actually being marked sold. Translated the eBay post-sold messages
  to English (they'd been written in Portuguese by mistake). Added
  validation: an item can't be saved with status "Listed" unless at least
  one platform is checked under "Listed on" (same rule applied to the bulk
  "Set: Listed" action).

## User-facing text: English only

All strings shown in the UI (alerts, buttons, status boxes, etc.) are in
English, regardless of what language the conversation with Claude happens
in. This repo's actual audience for the app is English-speaking eBay/
Poshmark buyers and the account owner works across both languages, so code
comments and chat can be Portuguese but anything the app renders to a user
must not be.
