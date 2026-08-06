// Vercel Serverless Function
// This runs on Vercel's server, never in the browser — so the API key stays secret.
// Vercel automatically deploys any file in /api as a serverless endpoint.
// The frontend calls this at /api/analyze-photo (see index.html).

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

  if (!imageBlocks || !Array.isArray(imageBlocks) || imageBlocks.length === 0) {
    return res.status(400).json({ error: 'No images provided.' });
  }
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
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: [...imageBlocks, { type: 'text', text: promptText }]
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
