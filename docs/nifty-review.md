# Nifty review: design, tools and structure (2026-10-20)

Nifty (nifty.ai, formerly AutoPosher until February 2026) is the
reference the redesign was organized against (CLAUDE.md, "Redesign").
This review first mapped its structure and tools from its public
documentation (docs.nifty.ai) and third-party reviews. The same day, the
app itself was mapped read-only, screen by screen, from a signed-in
Crosslisting Plus account ("Findings from the app" below; nothing was
saved or sent). The full map, with screenshots, is private (Vitor's
Notion and computer) because it shows a real account; this file keeps
only the findings, with no account data.

## The product in short

- A browser app (no native mobile app) for resellers: crosslisting to
  Poshmark, eBay, Mercari, Depop, Etsy and Whatnot (Facebook through a
  CSV upload), cloud automation (shares, relists, offers, follows),
  auto-delisting, analytics and an AI assistant.
- Plans from $25 to $89.99 a month. Crosslisting Plus allows up to 1,500
  active items; over it, Nifty emails, gives 7 days, then locks the
  Inventory Manager until the account upgrades.
- AI runs on **Smart Credits**: 500 a month on Plus, 1,000 on Pro, extra
  packs of 200 for $5. Listing generation and background removal spend
  them.
- Navigation: a left sidebar on desktop and a bottom bar on the phone,
  the same pattern as our N1/N2.

## Structure

| Area | What it has | Calculated Chaos today |
|---|---|---|
| Home | Getting started checklist; Today's summary (units listed, units sold, revenue, profit); **Goals** (profit, sales, listings or sell-through rate, weekly/monthly/quarterly/yearly, reset each period); **Needs attention**, prioritized, each row linking to its fix, some dismissible (a Dismissed tab; rows come back after 7 days if unresolved), some also emailed; What's new by month | Summary, pipeline and Needs attention (dismissed rows return when their count changes). No goals, checklist or what's new. |
| Inventory | A grid: one row per item, one column per marketplace, a photo where the item was ever listed. Item vs listing; duplicate vs match; AI-matched items start **unverified** and only verified items auto-delist. An **Issues** filter. Icons for "relisted in the last 7 days" and "not relisted in 60+ days". 25 items per page | Catalog by item, with status shortcuts and sort. No single Issues filter. |
| Warnings | Always on: partially delisted, mismatched quantities, publishing error. Optional (Settings → Warnings): price inconsistency (>10% off the pricing rule), missing SKU (makes SKU required) | eBay errors show in the item modal and the error library; nothing per item in the catalog. |
| Item form | Sections: marketplaces, photos (24 + 1 video), overview, details, "Nifty details" (private notes, labels, shipping preset), photos per marketplace, per-marketplace fields prefilled by AI. A **price range from recent comparable sales**, with their photos. Each marketplace publishes separately, so one failure doesn't block the others | Similar sections; our price suggestion comes from cost, margin and our own sale history, not market comps. |
| Shortcuts | "Similar listings" (suggests an item from the inventory and copies its specifics and shipping); Copy item, with a star for frequent ones; shipping presets | Duplicate exists; one default shipping profile. |
| Pricing rules | One primary marketplace priced directly; every other one matches it or adds/subtracts a % or $, with an optional .99 ending; default is fee-based | Fee % per platform for profit math; one list price for all platforms. |
| Auto-delisting | **Sale Detection Tracker** (60 days): each detected sale, where it sold, when it was detected, quantity, and per-marketplace outcome (delisted, not enabled, failed: connection expired / unexpected, ineligible with the reason); failures are also emailed | eBay sales are detected and marked sold directly; no visible log (the "eBay sales to confirm" Home row is missing for this reason). |
| Analytics | Orders (fees parsed automatically, import a sold item missing from inventory); **Expenses** (date, description, category, amount; spreadsheet import; bank connection; mileage at US/Canada rates; a "Sourcing transportation" category); **Insights** (units listed and sold, sell-through rate, revenue vs profit over time, totals and averages per marketplace including average days listed, top brands and categories, each compared with the previous rolling period); **Profit & Loss** CSV exports (P&L statement, orders, expenses, active inventory), cash or accrual | Revenue, profit, margin, where each dollar went, 12 months, platform revenue, projection, category reports, CSV/Excel exports. No expenses, P&L, sell-through, averages per platform or top brands. |
| Otto (assistant) | Answers questions, reads the account, and on paid plans edits listings, crosslists and builds reports; it **proposes actions and runs them only after approval** | None. |
| MCP server (beta) | 29 tools (17 read, 12 write) over OAuth for Claude, ChatGPT and Gemini; can edit items and publish drafts, can't create/delete items or touch settings; enabled under Settings → Experimental | None (the Vercel Hobby route cap is full). |
| Settings | Connections, Sale Detection, Warnings, Shipping Presets, Experimental, **Danger Zone** (clear a marketplace's data) | Grouped since v3.22.0; no separate danger zone. |
| Onboarding | Connect marketplaces → sync listings → **verify the AI's groupings** page by page → enable auto-delisting → turn on automations | Planned: Import (backlog item 4) uses the same "AI suggests, the person confirms" pattern. |

## Findings from the app (2026-10-20)

What the in-app map confirmed or corrected, area by area. Where it
contradicts the tables above, this section wins.

### Shell and visuals

- Next.js with Material UI, Inter, body 14 px. A ~100 px icon-over-label
  rail (Home, Inventory, Analytics, Automation, Ask Otto; Settings and
  the account avatar pinned at the bottom). No global top bar; each page
  has its own header. Quiet look: white cards (16 px radius) on a pale
  mint gradient, hairline borders, slate active state, zero values in
  light gray. Phone width couldn't be checked.

### Home

- **No Getting started checklist** on an account in use (none found on
  Home or in the account menu). Whether new accounts get one is unknown;
  Vitor may check with a free-trial account.
- Today's summary: Listed, Sold, Revenue, Profit, **fixed to today** (no
  period, no comparison, not clickable).
- Goals: four fixed metrics, each with an on/off toggle, a number and a
  period (week, month, quarter, year): Total Profit, Number of Sales,
  Number of Listings, Sell-through rate. Edited inline, Cancel/Save.
- Needs attention: tabs Active (n) / Dismissed (n); a row names the first
  affected item "and N others" and has one action (Verify, Fix, Merge)
  that opens a filtered Inventory. Dismissed rows are kept 7 days ("Nothing
  dismissed in the last 7 days.").
- **What's new in Nifty**: This Month / Last Month tabs, entries with a
  title, one paragraph and a tag (New feature, Improvement, Announcement,
  Bug fix). Not clickable.

### Inventory and item form

- The grid is one row per item and one column per marketplace (price,
  cover, status Listed / Sold / Delisted / Drafted, "+ List on X" in an
  empty cell). 25 rows per page, select-all covers the page only.
- Filters: status (Listed, Sold, Drafts, More: Delisted, Favorites,
  Duplicates, Unverified, All), search scope (all fields, name, SKU,
  private notes, link), 7 sorts, "listed on / not listed on" per
  marketplace, and an Issues filter (publishing error, partially
  delisted, mismatched quantities, price inconsistency, missing SKU).
- Bulk bar: Edit, Refresh, Crosslist, Offer, Update price, Relist, Add
  labels, Delist.
- Item form: marketplace chips, 24 photos + 1 video, "Generate listing"
  (1 credit), overview (title 80, description 1,500, a 6-step condition
  scale from "New with tags" to "Fair"), quantity, price, cost of goods,
  SKU, color, style tags, internal labels, shipping preset, private notes
  (2,500, searchable), then auto-populated per-marketplace blocks.
  Copy item opens the form prefilled; favorites are a star on the row.
- **No "Similar listings" panel.** What exists is "Suggested prices from
  similar sold items" (Likely to sell / Sweet spot / Less likely, with a
  carousel of sold comps). It needs market sales data we don't have.
- Photo editor: free tools, plus an AI Studio by Photoroom (background
  removal 1 credit; ghost mannequin, flat lay, shadow, virtual model 5
  credits per photo).
- Bulk crosslist wizard: marketplaces → pricing (the pricing rules) →
  shipping preset and "save as drafts" or "publish now"; titles kept,
  shortened by AI or rewritten by AI.
- Sale detection: a feed every ~10 minutes, each sale with its
  auto-delist outcome per marketplace or the reason it was skipped (not
  imported, not verified, not listed elsewhere).
- **No Vinted** anywhere (Poshmark, eBay, Mercari, Depop, Etsy, Whatnot).

### Analytics

- Tabs Orders · Expenses · Insights · Profit & Loss, and one Export
  dialog (report type + date range, CSV).
- **Orders**: one row per sale. Columns in three colored groups:
  "Top-level amounts" (sale price, collected shipping, refund), "Fees
  paid to marketplace" (standard, shipping, promoted), "Costs outside of
  marketplace" (COGS, shipping expenses, other expenses), then total
  profit, with SKU, days listed and status (Pending Data, Completed,
  Partially Refunded, Cancelled). Edit turns the table into inline edit
  for SKU, listed date, COGS, shipping expenses and other expenses (sale
  price, fees and refund are read-only). 50 rows per page. A notice
  "Some of your sales are missing data" filters to Pending Data (sales
  whose marketplace numbers aren't final yet). No "show breakdown". Sales
  can't be entered by hand (offline sales go to a separate spreadsheet).
- **Expenses**: empty state "No expenses found" with Add manually /
  Import from CSV. Form "Create new [expense | refund]": Date (today),
  Category, Amount, Description; Save, Save and add another, Cancel. No
  recurring expenses, one category per expense. Categories, each with a
  one-line hint in the menu (they follow the Schedule C lines):
  Advertising & Promotion, Bank Service Charges, Business Insurance,
  Commercial Rent, Commercial Utilities, Contract Labor, Dues &
  Subscriptions, Education & Training, Electronics & Devices, Equipment &
  Vehicle Rental, Internet, Inventory Purchases ("cash accounting" only),
  Legal & Professional Fees, Meals & Entertainment, Office Furniture &
  Equipment, Office Supplies, Phone, Sourcing Transportation, Shipping &
  Supplies, Software & Online Services, Travel Expense, Vehicle Expense,
  Other.
- **Mileage** lives inside Vehicle Expense: "Track expenses" (dollars) or
  "Track distance" (miles at the standard IRS rate, which replaces
  Amount). Docs: once a vehicle uses actual expenses, it must keep them.
- Expense CSV import: columns Date, Description, Category (fixed codes
  such as SOURCING_TRANSPORTATION), Amount, Distance (optional; when
  given, the amount is computed from the mileage rate). Three steps:
  requirements with sample rows and a template, upload, match columns.
- **Insights**: period presets in tabs (Recent: last 7 days, last 4
  weeks, last 3 months, custom; Year; Quarter; Month) plus start/end
  dates. Units listed, units sold, sell-through (sold ÷ listed in the
  period), each against the previous window of the same length, with a
  sparkline; Revenue vs Profit by day; totals by marketplace as stacked
  bars (profit, fees, COGS, shipping, other); top brands (bars), top
  categories (treemap); averages by marketplace (sale price, profit,
  days listed) as a dot plot.
- **Profit & Loss**: the equation Revenue − Cost of Goods Sold − Operating
  Expenses = Net Profit, then Revenue by marketplace; Cost of Goods Sold
  = COGS, standard fees, shipping fees, shipping expenses; Operating
  Expenses = promoted fees, other expenses, and the expense categories.
- **Accounting method** (Settings): Accrual (default; cost counted when
  the item sells, "Inventory Purchases" expenses ignored) or Cash
  (purchases counted when paid; cost of goods only tracks margins).
- Exports (CSV, structure only):
  - P&L: columns Section, Group, Amount, rows as in the statement.
  - Orders: Marketplace, Item Name, SKU, Days Listed, Order Status, Sold
    At, Buyer State, Buyer Country, Sale Price, Collected Shipping,
    Amount Refunded to Buyer, Standard Fees, Shipping Fees, Promoted Fees,
    Cost of Goods, Shipping Expenses, Other Expenses, Total Profit.
  - Expenses: itemized by category.
  - Active inventory: Item Name, SKU, Quantity, Cost of Goods,
    Imported/Created At (no date range; a snapshot).

### Settings

- Groups: General (Marketplaces, Account, Subscription, Affiliate, Bank
  Accounts, Accounting Method, Experimental), Inventory (Pricing Rules,
  Shipping Presets, AI Generation, Warnings, Sale Detection, Labels,
  Danger Zone), Partners (eBay Programs).
- **Pricing Rules**: a primary marketplace (set in Marketplaces) and, per
  other marketplace, increase / decrease / match by a % or $, ending in
  .0, .99, etc., with each marketplace's total fees shown. The default
  offset is simply the **difference between the fee percentages**
  (Poshmark 20% − eBay 13.6% = −6.4%; − Depop 3.3% = −16.7%), so the net
  is only roughly equal. The rules drive the "Price inconsistency"
  warning and bulk crosslist prices.
- **Shipping Presets**: named presets with per-marketplace shipping
  fields and a "When should AI generation use this preset?" condition.
- **AI Generation**: custom instructions (1,500 characters, applied to
  every generated listing, with section templates) and a description
  footer (500 characters).
- **Warnings** (titled "Inventory Rules"): publishing error, partially
  delisted, mismatched quantities (always on); price inconsistency,
  missing SKU (optional).
- **Subscription**: plan card, Smart Credits ("[n] remaining of 500",
  renews monthly), a usage bar by activity, a ledger Date | Activity |
  Credits, "Buy more" in packs of 200 for $5 (bought credits expire after
  90 days). Plans per month: Poshmark or eBay Automation $25, Full
  Automation $39.99, Crosslisting Plus $39.99 (1,500 active items),
  Crosslisting Pro $59.99, Bundle Plus $69.99, Bundle Pro $89.99; annual
  saves ~12%. Otto has a free monthly allowance measured by text
  processed, then spends credits.
- Bank Accounts (Plaid import into Expenses, Pro plans only), Labels
  (custom inventory labels), Danger Zone (reset a marketplace's column),
  eBay Programs (business policies, out-of-stock control).

### Where Calculated Chaos is ahead

- Vinted support; sales entered by hand (offline, markets, Facebook);
  physical stock (boxes, thermal labels, wall markers, transfer); a
  spreadsheet import with AI column analysis for a seller's existing
  sheet.

## What to bring in

P1 (after backlog item 6, one PR each):
1. **Finances insights**: sell-through rate, average profit and average
   days listed per platform, top brands and categories, and each number
   compared with the previous period. Pure math on data we have
   (`domain/finance-summary.js`).
2. **Goals on Home**: a profit, sales, listings or sell-through target
   per period with a progress bar, saved in `appSettings`.
3. **Issues filter in the catalog**: one filter for every problem (no
   price, missing photos/info, eBay publish error, duplicate code, 30+
   days listed), with optional warnings switched on in Settings.
4. **eBay sale tracker**: a log of detected eBay sales and what the app
   did with each (marked sold, ended the listing, failed), which also
   gives Home its "eBay sales to confirm" row.

P2 (after Import, backlog item 4), in this order (decided with Vitor
2026-10-20, after the in-app map):

5. **Expenses and P&L**, accrual only (the app already counts an item's
   cost when it sells; cash accounting would double-count unless every
   screen changed). Planned as 2-3 PRs: expenses (categories with hints,
   form, list, CSV export); the P&L screen in Finances with its export;
   then a Sales table with inline cost editing, mileage at the IRS rate
   and expense CSV import (reusing the spreadsheet import's parsing).
6. **AI custom instructions and a description footer** for ✨ (small;
   goes through the server-built prompt, so it pairs with backlog items
   1 and 2).
7. **Pricing rules per platform**: a primary price plus a % or $ rule
   per platform, with an optional .99 ending. Needs a price per platform
   on the item, the label, the listing text and the eBay publish, so it
   gets its own plan.
8. **Shipping presets**, then Home's **What's new** card and a
   **Dismissed** tab for Needs attention.

The **Getting started checklist** leaves P2: we build our own as part of
onboarding (multi-tenant step 5). Nifty showed none on an account in use.

P3: an assistant that proposes actions and runs them only after
approval, and maybe an MCP server.

**AI credits**: Vitor wants a credits counter like Smart Credits for the
paid plans (CLAUDE.md backlog item 7).

Not to copy:
- Poshmark/Mercari automation with the user's password: against those
  platforms' terms and needs an always-on server.
- The 25-items-per-page grid.
- Market-comps pricing, the Photoroom AI Studio, bank import (Plaid) and
  Otto, for now: each needs a paid outside service or data source.

## Sources

- The in-app map (2026-10-20), read-only, private (Vitor's Notion page
  "Nifty map (2026-10-20)" and the screenshots on his computer).
- docs.nifty.ai: index (`/llms.txt`), Choosing a Plan, Home, Inventory
  Manager, Warnings, Creating and Editing Items, Listing Shortcuts,
  Pricing Rules, Sale Detection Tracker, Analytics, Expenses, Insights &
  Reports, Ask Otto, MCP Server, Quickstart.
- blog.vendoo.co/nifty-ai-review (a competitor, so biased).
- nifty.ai/post/nifty-vs-crosslist and nifty.ai/post/nifty-reviews
  (Nifty's own, promotional).
- crosslist.com/blog/best-crosslisting-apps-for-resellers.
