// /api/ebay-account-deletion.js
// Required by eBay for ANY Production keyset — this endpoint handles:
//  1) The verification "challenge" eBay sends once when you save the endpoint
//     URL + verification token in the Developer Portal.
//  2) Real marketplace account deletion/closure notifications after that.
//
// Setup in eBay Developer Portal → Alerts and Notifications → Marketplace
// Account Deletion:
//   - Notification endpoint: https://<your-domain>/api/ebay-account-deletion
//   - Verification token: any string 32-80 chars, letters/numbers/underscore/
//     hyphen only — put the SAME value in the EBAY_DELETION_VERIFICATION_TOKEN
//     Vercel environment variable.
//
// IMPORTANT: the endpoint URL used in the hash MUST be byte-for-byte identical
// to what you typed into eBay's "Notification endpoint" field (same casing,
// no trailing slash difference, etc) or the challenge will fail.

import crypto from 'crypto';

const VERIFICATION_TOKEN = process.env.EBAY_DELETION_VERIFICATION_TOKEN;
// Must exactly match what's entered in the eBay Developer Portal field.
const ENDPOINT_URL = process.env.EBAY_DELETION_ENDPOINT_URL
  || 'https://calculated-chaos-deploy1-1.vercel.app/api/ebay-account-deletion';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    // Step 1: respond to eBay's verification challenge.
    // WHATWG URL instead of Vercel's req.query, which logs DEP0169 (v3.26.6).
    const challengeCode = new URL(req.url || '/', 'http://localhost').searchParams.get('challenge_code') ?? undefined;
    if (!challengeCode) {
      return res.status(400).json({ error: 'Missing challenge_code' });
    }
    if (!VERIFICATION_TOKEN) {
      return res.status(500).json({ error: 'EBAY_DELETION_VERIFICATION_TOKEN is not configured' });
    }
    const hash = crypto.createHash('sha256');
    // Order matters and must be exactly: challengeCode + verificationToken + endpoint
    hash.update(challengeCode);
    hash.update(VERIFICATION_TOKEN);
    hash.update(ENDPOINT_URL);
    const challengeResponse = hash.digest('hex');
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({ challengeResponse });
  }

  if (req.method === 'POST') {
    // Step 2: a real account deletion/closure notification. eBay just needs
    // a 200 response quickly — we log it and, since this app currently shares
    // one eBay connection (ebay_connections/main), we don't hold per-customer data
    // tied to individual eBay usernames yet. When multi-tenant support is
    // added, this is where we'd delete that specific user's stored data.
    // Log only what identifies the notification. The body carries the
    // seller's username and user id, which must not go to the logs.
    console.log('eBay account deletion notification received:', JSON.stringify({
      topic: req.body?.metadata?.topic ?? null,
      notificationId: req.body?.notification?.notificationId ?? null,
      publishDate: req.body?.notification?.publishDate ?? null,
    }));
    return res.status(200).json({ received: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
