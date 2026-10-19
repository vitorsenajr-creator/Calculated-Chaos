# "Mark as sold" confirmation flow (done v3.13.3, 2026-08-09)


Built as a dedicated modal (`#soldConfirmOverlay`), not a rework of the
inline sold-fields section:
- **Item modal**: clicking the "Sold" status pill (only on the
  catalogado/anunciado → vendido transition, not re-clicking an
  already-sold item) opens the modal instead of flipping status directly.
  Asks, in order: sale price, sold-on platform (fee applies from this),
  who paid shipping — with a live fee/shipping/net-profit preview that
  updates as she edits any field. Canceling leaves status untouched.
  Confirming sets `currentStatus='vendido'` and writes the confirmed
  values into the (still-existing) `#fSoldPrice`/`#fShippingCost`/
  `#fSoldPlatform` fields, which the normal Save flow already reads —
  no duplicate financial-calc logic, just gating what populates those
  fields.
- **Bulk "Set: Sold"**: a review list in `#bulkActionStatus`
  (`showBulkSoldConfirm`), same visual pattern as the eBay bulk-publish
  preflight — one row per selected item, each with editable price/
  platform/shipping-payer prefilled with the same best-guesses the old
  silent auto-apply used. Nothing computes until "Confirm & mark N as
  sold" is clicked.
- Both paths still run `endEbayListingIfSold` + the platform-mismatch
  warnings from v3.12.3/v3.12.4 afterward, unchanged.
- (v3.13.5) Platform fee is a real editable field, not just a computed
  preview — pre-filled from `platformFee()` but she can override it (a
  promo, a dispute credit, whatever doesn't match the standard rate); the
  single-item modal only re-autocalculates on price/platform change until
  she's touched the fee field herself (`scFeeManuallyEdited`/
  `feeManuallyEdited` flag). Also added "Other costs" (packaging, extra
  postage, anything else) in both flows — persists as `item.otherCosts`,
  factored into `netProfit` alongside `feesTotal`/`shippingCost`.
- Now lives in `modules/sold-confirm.js` (`initSoldConfirmModal` for the
  single-item modal, `showBulkSoldConfirm` for the bulk list,
  `computeNetProfit` as the one shared formula) — see "Modularization
  progress" below.
- **v3.13.4** — Sale price and platform are now genuinely required, not
  just usually-filled: price must be `> 0` (was `>= 0`), and the
  single-item modal's platform `<select>` only pre-selects when there's
  an actually confident signal (`item.soldPlatform` already set, or
  exactly one entry in `listedPlatforms`) — otherwise it starts on a
  blank "— Select platform —" option so the required-field check means
  something, instead of blindly defaulting to eBay. Confirming the
  single-item modal now also autosaves immediately (`#saveItemBtn`
  .click()) instead of leaving her to remember to hit Save separately.
