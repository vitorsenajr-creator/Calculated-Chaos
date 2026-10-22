# Infrastructure reference

Where things live and how they connect. No secrets here: passwords, API
keys, tokens and environment variable values stay in the owners' password
manager and in the Vercel and Firebase consoles.

## Domain

- Name: `calculatedchaos.app`, registered at Spaceship.
- WHOIS privacy on, DNSSEC on, auto-renew on.
- Expires 2027-10-22.

## DNS (Spaceship)

| Type  | Host  | Value                                  |
|-------|-------|----------------------------------------|
| A     | `@`   | `216.198.79.1`                         |
| CNAME | `www` | `73c65b9c6e3ecff3.vercel-dns-017.com`  |

## Hosting (Vercel)

- Project: `calculated-chaos-deploy_1-1`. Production deploys on push to `main`.
- Domains: `calculatedchaos.app` and `www.calculatedchaos.app`, SSL automatic.
- `calculatedchaos.app` redirects (308) to `https://www.calculatedchaos.app`.
- Previous address still in use by eBay and the Firebase authorized domains:
  `calculated-chaos-deploy1-1.vercel.app`. Keep it working.
- Environment variables are set in the Vercel project (names listed in
  `CLAUDE.md`, "Vercel env vars"). Check there before changing any.

## Firebase

- Project: `calculated-chaos-4027a`.
- Authorized domains include `calculatedchaos.app` and
  `www.calculatedchaos.app`.
- Auth provider Google: pending activation in the console (needed by the
  "Continue with Google" button).
- Auth emails (verification, password reset) use Firebase's default sender.
  Pending: a branded sender and an action domain on `calculatedchaos.app`.

## eBay

- OAuth callback and account deletion URLs are registered in the eBay
  developer portal. They use the Vercel address above. Never rename them.

## Open items for this file

- Decide the sender for app emails (service not chosen yet).
- Decide whether `calculatedchaos.app/` becomes the welcome page and the
  app moves to `/app` (see the plan in the session of 2026-10-22).
