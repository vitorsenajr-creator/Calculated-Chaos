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

## Planned changes (backlog)

Not implemented yet — captured here so they survive between sessions.

### 1. "Mark as sold" confirmation flow (requested by Vitor's wife, 2026-08-09)

Today, marking an item Sold computes the financial fields (fee, net profit)
inline/automatically:
- **Item modal**: sold price/shipping cost/sold platform are just regular
  form fields next to the status pills — filled in as part of one big Save,
  no dedicated confirmation step.
- **Bulk "Set: Sold"**: fully automatic — sold price defaults to list price
  (or `suggestPrice`), sold platform defaults to a guess
  (`soldPlatform || listedPlatforms[0] || platform || 'ebay'`), fee is
  computed from that guess. No prompt at all.

Wanted instead: the moment an item is marked Sold (both the single-item
modal and the bulk action), show an explicit confirmation step that asks,
in order: (1) confirm/enter the actual sale price, (2) confirm whether a
platform fee applies and which platform, (3) confirm who paid shipping
(buyer or seller) — and only after those are answered, run the financial
calc (`feesTotal`, `netProfit`) from the confirmed values instead of
defaults/guesses. Goal: stop silently guessing financial numbers that feed
directly into profit reporting and tax exports.

Not yet scoped: whether this is a new modal/dialog, or reworking the
existing inline sold-fields section to require explicit confirmation
before the fields become editable/save-able. Needs a design pass before
implementation.

### 2. Revenue-by-platform breakdown (requested by Vitor, 2026-08-09)

Reports currently has category performance, projected pipeline, and best
earners — but nothing that breaks down realized revenue/units-sold per
selling platform (eBay vs. Poshmark vs. Mercari vs. …), which came up
after reviewing an external dashboard mockup that included one. Add a
report section (or dashboard stat) showing $ revenue and # sold per
platform, similar in spirit to `catRows` in `computeReportsData` but
grouped by `soldPlatform` instead of category.

## User-facing text: English only

All strings shown in the UI (alerts, buttons, status boxes, etc.) are in
English, regardless of what language the conversation with Claude happens
in. This repo's actual audience for the app is English-speaking eBay/
Poshmark buyers and the account owner works across both languages, so code
comments and chat can be Portuguese but anything the app renders to a user
must not be.
