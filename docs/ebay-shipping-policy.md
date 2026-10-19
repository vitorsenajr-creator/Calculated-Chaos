# eBay shipping policy bug (fixed v3.13.9, 2026-08-10)

> **Current state (2026-10-19):** **Resolved.** The buyer-pays policy is in use: Vitor switched
> `EBAY_FULFILLMENT_POLICY_ID_BUYER_PAYS` to his own "USPS Ground + Priority
> (Buyer Pays)" policy (v3.13.29), and the eBay listing audit's bulk fix
> republished the existing listings (v3.13.32). He confirmed (2026-10-19) no
> shipping problems since. The "still needs to" steps below are historical.
> A general eBay review is planned; see `CLAUDE.md` open items.


**What was wrong**: `api/ebay-setup.js` created exactly one eBay
fulfillment (shipping) policy, hardcoded to free/seller-paid shipping.
`api/ebay-list.js` used that same policy for every single listing,
completely ignoring the item's own "Buyer pays / I pay" field
(`item.freeShipping`, set via the `#fFreeShipping` dropdown at cataloging
time). That field only ever fed the app's own internal profit-margin
math — it never reached the real eBay listing. Every listing published
through this app before v3.13.9 has free/seller-paid shipping on eBay
regardless of what was chosen per item. Confirmed causing real losses on
at least one completed sale.

**The fix**: `ebay-setup.js` now creates a SECOND fulfillment policy
(`CC Buyer Pays Shipping`, not free) alongside the original
(`CC Standard Shipping`, still free — used when she genuinely wants to
absorb shipping). `ebay-list.js` picks between the two per listing based
on `item.freeShipping`, and when the buyer pays, overrides that policy's
placeholder cost with the item's real `estimateShipping()` figure via
`listingPolicies.shippingCostOverrides` — so the dollar amount the buyer
sees matches what the app's own profit numbers assume.

**Vitor still needs to, in order**:
1. Settings → eBay one-time setup → **"Run eBay setup"** again (safe to
   re-run — existing policies are detected and reused, only the new
   buyer-pays policy gets created)
2. Copy the returned `fulfillmentPolicyIdBuyerPays` value into a NEW
   Vercel env var: `EBAY_FULFILLMENT_POLICY_ID_BUYER_PAYS`
3. Redeploy (a push does this automatically, or trigger one manually)
4. **This does NOT retroactively fix listings already live on eBay** —
   for each currently-published item where "Buyer pays" was intended,
   open it in the app and use "Update existing listing" (in the item's
   eBay panel) to republish it with the corrected policy. There is no
   bulk version of this yet — revisit if the number of affected listings
   makes that worth building.
5. Spot-check one republished listing on eBay itself to confirm the
   shipping cost shown to buyers is no longer $0/free before assuming
   the fix is fully live.

Not yet tested against eBay's live API (no sandbox/production
credentials in this environment) — verified via `node --check` and a
clean `vite build` only. The `shippingCostOverrides` field/shape is from
documentation, not confirmed against a real eBay response — **watch the
first few publishes closely**.
