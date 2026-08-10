// Vercel Serverless Function
// Generic text-only Claude proxy used to turn a narration transcript into
// structured catalog fields. Kept separate from analyze-photo.js (which
// requires images) and generate-listing.js (different prompt/response
// shape) so each can evolve independently — same pattern as those two.
// Prompt is built client-side (narration-capture.js) and just passed
// through, same as generate-listing.js, so iterating on prompt wording
// doesn't need a redeploy of prompt logic split across two places.
// The frontend calls this at /api/extract-narration-fields.

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

  const { promptText } = req.body || {};
  if (!promptText || typeof promptText !== 'string') {
    return res.status(400).json({ error: 'No prompt provided.' });
  }

  try {
    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        // Plain structured extraction from a short transcript — no need for
        // Sonnet's cost/latency here, Haiku 4.5 handles this reliably.
        model: 'claude-haiku-4-5',
        max_tokens: 500,
        messages: [{ role: 'user', content: promptText }]
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
