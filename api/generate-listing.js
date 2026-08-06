// Vercel Serverless Function
// Dedicated endpoint for AI-generated listing copy (title + description +
// style tags) — shared across platforms (eBay reuses this same saved
// description, not just Poshmark), kept separate from analyze-photo.js so
// the two features can evolve independently (different prompt shape,
// images are optional here instead of required). Runs server-side only, so
// the ANTHROPIC_API_KEY never reaches the browser — same env var already
// configured on Vercel, no new secret needed.
// The frontend calls this at /api/generate-listing (see src/main.js).

import { requireApprovedUser } from './_requireApprovedUser.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authCheck = await requireApprovedUser(req);
  if (!authCheck.ok) {
    return res.status(authCheck.status).json({ error: authCheck.error });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server is not configured with an API key.' });
  }

  const { imageBlocks, promptText } = req.body || {};

  if (!promptText || typeof promptText !== 'string') {
    return res.status(400).json({ error: 'No prompt provided.' });
  }
  // Unlike photo analysis, a cover photo is optional here — the item's text
  // fields (brand, size, condition, notes, measurements) are often enough on
  // their own to write a solid listing.
  const safeImageBlocks = Array.isArray(imageBlocks) ? imageBlocks : [];

  try {
    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1600,
        messages: [{
          role: 'user',
          content: [...safeImageBlocks, { type: 'text', text: promptText }]
        }]
      })
    });

    const data = await anthropicResponse.json();

    if (!anthropicResponse.ok) {
      console.error('Anthropic API error:', data);
      return res.status(anthropicResponse.status).json({ error: 'Upstream API error', detail: data });
    }

    return res.status(200).json(data);

  } catch (err) {
    console.error('Serverless function error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
