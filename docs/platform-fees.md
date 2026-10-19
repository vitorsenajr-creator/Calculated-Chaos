# Tiered platform fees (added v3.13.3, 2026-08-09)


Some platforms don't charge one flat %, so `appSettings.platformFeeRules`
(shape defined by `DEFAULT_PLATFORM_FEE_RULES` in `modules/constants.js`)
lets a platform have an ordered list of `{ upTo, pct, flat }` tiers
instead — `fee = price*(pct/100) + flat`, using the first tier where
`price <= upTo` (a `null` upTo never fails to match, so it must be last).
`pricing.js`'s `platformFee()` checks this first and only falls back to
the old flat-rate `platformFeeOverrides`/`feePct` system when a platform
has no rules — fully backward compatible, nothing breaks for platforms
that keep a flat %.

Pre-filled for eBay/Poshmark/Depop (researched 2026-08-09, cross-checked
across multiple current sources — see the git commit for links):
- **eBay**: 13.6% + a flat per-order fee that steps up at $10 ($0.30 →
  $0.40). Not modeling eBay's separate $7,500 high-value breakpoint
  (2.35% above that) — not a realistic sale price for a thrift item here.
- **Poshmark**: flat $2.95 under $15, 20% at $15 and up. `upTo` is 14.99,
  not 15, since tiers are inclusive (`price <= upTo`) and the real rule
  is "under $15" — $15.00 itself belongs in the 20% tier.
- **Depop**: no % commission anymore, just ~3.3% + $0.45 payment
  processing — modeled as a single tier so the flat part isn't lost to a
  pure-% approximation (which would misprice cheap items badly).

Also corrected while researching: **Vinted's seller fee changed from 5%
to $0** — sellers keep the full listed price now, the buyer absorbs a
separate "Buyer Protection" fee instead. `PLATFORM_FEES.vinted` in
`constants.js` updated from `0.05` to `0`.

Settings → Platforms: each platform row shows a "🎚️ Tiered fees" toggle
that expands an editor (up-to threshold / % / flat $ per tier, add/remove
tiers, "Use flat % instead" to clear back to the simple system). Custom
platforms she adds herself still work exactly as before — flat % only, no
tiered option (not asked for, and most her own added platforms are likely
simple flat-fee ones anyway).
