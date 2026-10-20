# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary: the solo reseller on a phone.** One person who sources,
  photographs, catalogs, labels, lists, sells and ships secondhand clothing,
  almost everything from a phone, often one-handed and between other tasks
  (at the thrift store, at the photo spot, while packing). Jasmine, the
  first business, works this way.
- **Secondary: small reseller teams.** An owner who also uses a computer
  (finances, listings, eBay tools) and one or two employees on phones
  (photos, labels, stock). The structure is designed for the phone first
  and has to scale to a small team without changing.
- **Platform admins** (Vitor and Jasmine) use a separate Developer Panel;
  it is not part of the reseller's product surface.

## Product Purpose

Run a secondhand-clothing resale business end to end in one place: know
every piece, where it physically is, where it is listed, what it sold
for and what it really earned. Success means the seller spends less time
on admin, never loses a piece, and knows her true profit.

## Positioning

Crosslisting tools (Nifty, Vendoo, List Perfectly) center on listings.
Calculated Chaos centers on the piece, from shelf to profit:

1. **Physical stock**: a product code per piece, thermal labels, storage
   boxes, wall markers and stock transfers, so the seller always knows
   where a piece is.
2. **AI cataloging**: photos → ✨ analysis → a ready listing; measurements
   from a photo; voice narration of an item.
3. **True profit**: net profit per piece (cost, platform fees, shipping,
   other costs), month-by-month finances, and the projected profit of
   what is still in stock.

## Operating Context

- Marketplaces: eBay (connected by API: publish, offers, audit, sale
  sync), Poshmark, Mercari, Depop, Vinted (tracked by hand today).
- Daily rituals: photo sessions (shoot a batch first, catalog later),
  quick cataloging, printing labels on a monochrome thermal printer,
  boxing and moving stock, marking items sold, checking finances.
- Main device: iPhone Safari (installed as a PWA); the computer is
  secondary.
- Businesses bring their existing inventory from Excel/CSV (planned
  import), and later platform sales reports.

## Capabilities and Constraints

- Multi-business: each customer business has its own catalog, settings,
  members and eBay connection; it is a paid product for new sellers.
- Roles: owner/admin and employee accounts; verified email required.
- Terminology: item, piece, product code, box, wall marker, drafts, photo
  session, quick catalog, listed / sold / cataloged, NWT, net profit,
  projected profit, platform fees.
- Constraints: thermal labels print in black only; iOS Safari quirks
  (synchronous print, 16px inputs, keyboard resets); Vercel request size
  limits; US English everywhere in the product.
- Open decisions: the product's paid plans and credits; Google sign-in;
  onboarding/invites.

## Brand Commitments

- Each business sees **its own store name** (and, later, its own logo and
  basic colors) as the main identity inside the app.
- **"by Calculated Chaos"** stays present but discreet: Calculated Chaos
  is the product name, not the store's.
- Copy must work for any business: no references to one specific seller.

## Evidence on Hand

- A real production catalog (Jasmine's business) in Firestore; not
  reachable from development sandboxes. Test data for imports will be an
  exported, varied copy of it.
- No testimonials, customer counts, benchmarks or pricing exist yet; do
  not invent them.

## Product Principles

1. **The phone is the workplace.** Every daily task must be doable
   one-handed on a phone; the computer adds depth, not exclusive features.
2. **Show today's work first.** Open on what needs attention, each problem
   with one clear action, not on branding.
3. **Every piece is traceable.** Code, location, listings and money for a
   piece are always one tap away.
4. **The numbers must agree.** One definition of profit across every
   screen and export.
5. **The seller's store comes first.** The product supports her brand;
   it does not compete with it.
