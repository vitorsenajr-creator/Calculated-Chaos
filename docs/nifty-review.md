# Nifty review: design, tools and structure (2026-10-20)

Nifty (nifty.ai, formerly AutoPosher until February 2026) is the
reference the redesign was organized against (CLAUDE.md, "Redesign").
This review maps its structure and tools from its public documentation
(docs.nifty.ai) and third-party reviews, to decide what to bring into
Calculated Chaos. It was done without access to the app itself or
screenshots, so it covers structure, flows and data model, not visuals.
A visual review needs screenshots from Vitor or a trial account (7 days
free).

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

P2 (after Import, backlog item 4):

5. **Expenses and P&L**: categories (including sourcing trips), a
   spreadsheet import, a P&L export. Fits with backlog item 5 (platform
   reports).
6. **Pricing rules per platform**: a primary price plus a % or $ rule per
   platform, with an optional .99 ending.
7. **"Similar items" and shipping presets** when cataloging.
8. **Getting started checklist** on Home for new sellers (onboarding,
   multi-tenant step 5).

P3: an assistant that proposes actions and runs them only after
approval, and maybe an MCP server.

**AI credits**: Vitor wants a credits counter like Smart Credits for the
paid plans (CLAUDE.md backlog item 7).

Not to copy:
- Poshmark/Mercari automation with the user's password: against those
  platforms' terms and needs an always-on server.
- The 25-items-per-page grid.

## Sources

- docs.nifty.ai: index (`/llms.txt`), Choosing a Plan, Home, Inventory
  Manager, Warnings, Creating and Editing Items, Listing Shortcuts,
  Pricing Rules, Sale Detection Tracker, Analytics, Expenses, Insights &
  Reports, Ask Otto, MCP Server, Quickstart.
- blog.vendoo.co/nifty-ai-review (a competitor, so biased).
- nifty.ai/post/nifty-vs-crosslist and nifty.ai/post/nifty-reviews
  (Nifty's own, promotional).
- crosslist.com/blog/best-crosslisting-apps-for-resellers.
