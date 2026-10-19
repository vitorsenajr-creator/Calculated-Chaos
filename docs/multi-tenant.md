# ADR-001: Multi-business (multi-tenant) Calculated Chaos

**Status:** Accepted (design only; no code yet)
**Date:** 2026-10-19
**Deciders:** Vitor

## Context

Calculated Chaos was built for one reselling business. The goal is to offer
it to new, unrelated sellers, each with their own catalog, settings and eBay
account, on a paid plan.

The 2026-10-19 code and security review found that everything assumes one
business:

- **No data has an owner.** `items`, `drafts`, `liveSessions`, `liveItems`,
  `app_config/settings`, `app_settings/productCodeCounter` and
  `live_catalog_options/*` are global. Every approved user reads and writes
  all of it.
- **One shared eBay connection.** `ebay_tokens/main` holds the access and
  refresh tokens, readable by any approved user in the browser
  (`src/ebay-api.js`). The connect flow shows the tokens on a page and asks
  the user to copy-paste them (`api/ebay-auth.js`). Business policy IDs and
  the merchant location come from Vercel env vars, so they only exist on one
  eBay account (`api/ebay-list.js`, `api/ebay-listing-tools.js`).
- **AI calls are an open proxy.** `api/analyze-photo.js` and
  `api/narration.js` accept a browser-built `promptText` (and
  `outputSchema`) with no per-user limit. Any approved user can spend the
  server's Anthropic/Deepgram keys without bound. (Prompts are built on the
  server since v3.15.3; the per-user limit is still open.)
- **Hardcoded single-business values.** Firebase project ID in
  `api/_requireApprovedUser.js`, admin emails in `src/config/firebase.js`
  and in the Console rules.
- **Hosting.** Vercel Hobby is non-commercial only and caps at 12
  functions (11 used).

### Current Firestore rules (Console, as of 2026-10-19)

What holds up:
- Users can't self-approve: `users` create only allows `status: 'pending'`
  unless the caller is an admin; update/delete are admin-only. Employees
  can't remove their own `role: 'employee'`.

Problems:
- **`app_settings` has no rule, so it's denied.** The atomic product-code
  counter (`reserveNextProductCode()`) always fails, and `saveItemFlow()`
  silently falls back to a local "max + 1" guess. Cross-device duplicate
  protection has likely never worked.
- **`ebay_error_log` has no rule**, so the eBay error library can't save.
- **Employees have full access** to everything `isApproved()` covers,
  including `ebay_tokens` (refresh token) and `app_config`. Employees also
  need the eBay token today: marking an item sold calls
  `endEbayListingIfSold()`, and tokens load at startup for everyone. So the
  token can't simply be locked to owners; it has to move server-side.

## Decision

1. **One Firebase project, data partitioned by business** (Option B below).
2. **Signup by approval.** After sign-up and Vitor's approval, the first
   screen is always **"Create your business"** (in English). The creator
   becomes that business's owner. The product name stays "Calculated Chaos".
3. **Each business connects its own eBay account.** Tokens are stored and
   refreshed only on the server. Policy IDs and the merchant location live
   in the business settings, not in env vars.
4. **Paid plans with AI credits**, debited on the server before every AI
   call.

## Options Considered

### Option A: One Firebase project per business

| Dimension | Assessment |
|-----------|------------|
| Complexity | High: per-customer provisioning, config, rules and deploys |
| Cost | Fixed overhead per customer |
| Scalability | Poor: every rule or schema change repeated N times |
| Team familiarity | Same stack, but manual ops |

**Pros:** physical isolation; a bug can't leak across businesses.
**Cons:** no self-serve signup; Vitor provisions every customer by hand;
the app must pick a Firebase config at runtime; migrations multiply.

### Option B: One project, `businesses/{bizId}/...` (chosen)

| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium: one data-path refactor and new rules |
| Cost | Shared; scales with usage |
| Scalability | Good: one deploy, one rule set |
| Team familiarity | Standard Firebase SaaS pattern |

**Pros:** self-serve onboarding; employees become members with a role;
one migration path.
**Cons:** isolation depends on correct security rules, so the rules must be
versioned and reviewed.

### Option C: Firestore named databases per business

**Cons:** per-project database limits, a separate rule deploy per database,
and the client has to select the database at runtime. Same ops burden as
A with fewer benefits. Rejected.

## Trade-off Analysis

B trades physical isolation for operability. The isolation risk is handled
by security rules that only let members of business X read
`businesses/X/...`, and by keeping secrets (eBay tokens, credit counters)
in places the browser can't write. A needs Vitor in the loop for every new
customer, which defeats a self-serve paid product.

## Data model

```
businesses/{bizId}             name, ownerUid, createdAt, plan, settings
  members/{uid}                role: owner | employee
  items/{itemId}
  drafts/{draftId}
  liveSessions/{id}
  liveItems/{id}
  options/{id}                 was live_catalog_options/*
  counters/{name}              productCode, liveSku (per business)
  ebay_error_log/{id}
  usage/{yyyy-mm}              creditsUsed, creditsLimit, costUsd (server-written)
ebay_connections/{bizId}       tokens + policy IDs; server-only (no client rule)
users/{uid}                    email, status (pending/approved), activeBizId
ebay_category_cache/{slug}     stays global (not business data)
```

Rules sketch:
- `isMember(biz)`: `exists(businesses/biz/members/uid)` and the user is
  approved.
- `isOwner(biz)`: member with `role == 'owner'`.
- Members read/write items, drafts, live data, counters and the error log.
  Only owners write business settings and members.
- `usage/*`: members read, nobody writes from the client.
- `ebay_connections/*`: no client access at all.

## AI credits

**1 credit ≈ $0.01 of real API cost.** Debits per action:

| Action | Endpoint | Credits | Estimated cost |
|---|---|---|---|
| ✨ Analyze & write (up to 5 photos) | `analyze-photo` `full` | 5 | ~$0.04-0.05 |
| Redo text only (uses `aiFacts`) | `analyze-photo` `listing_only` | 2 | ~$0.02 |
| Voice narration (~1 min) | `narration` | 1 | ~$0.01 |
| Suggest fee / explain eBay error | `ebay-item-aspects` | 1 | ~$0.005 |

Costs are estimates from the call shapes and current prices. Calibrate them
from the `ai-usage` logs before launch.

Plan quota formula:

```
credits = (plan price × share of revenue for AI) ÷ $0.01
```

At a 35% AI share (example prices, not decided): $19 → 650 credits (~130
items), $39 → 1,350 (~270), $79 → 2,750 (~550).

Enforcement:
- The server debits in a Firestore transaction **before** calling the
  provider (needs `firebase-admin` and a service account env var). On a
  provider failure it refunds the debit.
- Monthly reset with no cron: the counter doc is keyed by month
  (`usage/2026-10`).
- The UI shows the balance, warns at 80% and blocks AI actions at 100% with
  an upgrade / buy-a-pack message. Non-AI features keep working.
- Add a per-minute rate limit per business.
- Log real tokens and USD per call next to the debit, to re-tune the table.
- This requires the fixed rules to move into a server-side `system` prompt
  (backlog item 2), or a user could pay 5 credits for an arbitrary prompt.

## Consequences

- **Easier:** onboarding new sellers without Vitor provisioning anything;
  real employee permissions; per-business cost tracking.
- **Harder:** every Firestore path goes through a business-scoped helper;
  the server needs `firebase-admin` credentials; the rules become the
  security boundary and must be versioned in the repo.
- **Revisit:** `loadItems()` reads the whole catalog on every app open. With
  many businesses this becomes a real Firestore read cost; add local caching
  or incremental loads. Also `ebay-account-deletion.js` must actually delete
  a seller's data once more than one seller exists.

## Action Items (one PR each, in order)

1. [x] **Rules hotfix for today's single business (v3.14.2):** add
   `app_settings` and `ebay_error_log`, version the rules as
   `firestore.rules` (Console stays the source of truth). `email_verified`
   on `isAdmin()` is deferred until the app sends verification emails, or
   it would lock out the current (likely unverified) admin accounts.
1a. [x] **Developer Panel v1 (v3.15.0):** `admin.html` with Approvals,
   Users, eBay status, eBay errors and App tabs. Later sections:
   Businesses (after step 5) and Credits & cost (with step 8).
2. [x] Server foundation (v3.15.4): `firebase-admin` + the
   `FIREBASE_SERVICE_ACCOUNT` env var; ID tokens verified in
   `_requireApprovedUser.js`; `api/platform.js` (last Hobby function slot)
   for platform actions, starting with `health`.
3. [x] eBay tokens server-side. v3.16.0: tokens in `ebay_connections/*`
   (server only), refreshed by the server. v3.16.2: the OAuth callback
   writes the connection itself via a one-time `state` code
   (`ebay_oauth_states/{state}`: uid, email, `connectionId`, 10-minute
   expiry); no tokens are shown or pasted. v3.17.0: every eBay endpoint
   uses `ebay_connections/{bizId}` for a live business
   (`ebayConnectionId(auth)`).
4. [x] Business-scoped data paths. v3.16.4: `src/modules/biz.js`
   (`bizCol()`/`bizDoc()`) at all 31 business-data call sites. v3.17.0:
   `loadActiveBusiness()` picks `businesses/{bizId}/…` when the business
   is live. Decided (2026-10-19): the current business has a random id
   (name in a field), and settings live in
   `businesses/{bizId}/config/settings`.
4a. [ ] **Auth hardening, before step 5** (planned 2026-10-19). New
   sellers sign themselves up, so the sign-in side needs to be ready
   first. Small fixes first, in this order:
   - Platform admin as a custom claim set by `api/platform.js`, instead
     of the email lists in `isAdmin()` / `ADMIN_EMAILS` /
     `PLATFORM_ADMIN_EMAILS`. The rules trust `token.email` without
     `email_verified`, and a password sign-up can use any email address.
   - Send verification emails for password sign-ups; invites (step 5)
     only accept a verified email.
   - Firebase Auth: one account per email (link Google and password
     sign-ins); authorized domains limited to production.
   - Developer Panel "Remove" also disables the Firebase Auth account
     (Admin SDK), not only the Firestore user doc.
   Then Google sign-in: the OAuth consent screen needs the Privacy and
   Terms links (step 10), and the iOS home-screen app needs popup sign-in
   or an auth domain served from the app's own domain. Then App Check
   (reCAPTCHA) against bot sign-ups and AI-endpoint abuse, and 2FA for
   admins (needs Identity Platform).
5. [ ] "Create your business" onboarding, members/roles, owner invites
   employees; new rules.
6. [x] Migration (v3.16.5 copy, v3.17.0 switch; `api/_migration.js`,
   Developer Panel → App → "Business migration"). The copy ran on
   2026-10-19 (1,442 items, all counts matched) and the switch was
   confirmed in production the same day. "Switch to business data" runs
   a final copy (which also removes business docs deleted at the root
   since an earlier copy) and sets `businesses/{bizId}.live`; the app,
   the eBay endpoints and the rules follow that field, and "Switch back"
   sets it to false. Copy, never move: the root collections stay
   (read-only for the business's members) until Vitor confirms they can
   be removed, in a separate step with a fresh backup first.
7. [ ] eBay policies per business (reuse `ebay-setup.js` listing).
8. [ ] Server-side prompts + AI credits + usage UI (with backlog item 1).
9. [ ] Billing (e.g. Stripe), plan → credit limit.
10. [ ] Vercel Pro, error monitoring, staging, Terms of Service and
    Privacy Policy, README.
