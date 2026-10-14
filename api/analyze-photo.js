// Vercel Serverless Function
// This runs on Vercel's server, never in the browser — so the API key stays secret.
// Vercel automatically deploys any file in /api as a serverless endpoint.
//
// The single AI endpoint for an item (v3.13.115) — replaces the old
// analyze-photo + generate-listing pair (generate-listing.js was removed,
// freeing one of the Hobby plan's 12 function slots). Two modes:
//  - mode:'full'         → photos required; the "✨ Analyze & write listing"
//                          call (identification + eBay specifics + price +
//                          visual facts + listing copy, one request).
//  - mode:'listing_only' → photos optional; rewrites title/description/tags,
//                          photo-free when the item has saved aiFacts.
// The prompt and the JSON schema are built client-side
// (src/modules/ai-item.js) and passed through, same pattern as before.

import { requireApprovedUser } from './_requireApprovedUser.js';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = { full: 3000, listing_only: 1800 };

async function callAnthropic(apiKey, { content, maxTokens, outputSchema }){
  const body = {
    model: MODEL,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content }],
  };
  if (outputSchema){
    body.output_config = { format: { type: 'json_schema', schema: outputSchema } };
  }
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  return { response, data };
}

// A 400 that names the output format/schema means this model (or this
// schema) isn't accepted for structured outputs — retry once without it;
// the client's tolerant JSON parsing still handles the plain-text answer.
function isStructuredOutputRejection(response, data){
  if (response.status !== 400) return false;
  const msg = JSON.stringify(data?.error || data || '').toLowerCase();
  return msg.includes('output_config') || msg.includes('output_format') || msg.includes('json_schema') || msg.includes('schema');
}

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

  const { mode = 'full', imageBlocks, promptText, outputSchema } = req.body || {};

  if (!MAX_TOKENS[mode]) {
    return res.status(400).json({ error: `Unknown mode: ${mode}` });
  }
  const safeImageBlocks = Array.isArray(imageBlocks) ? imageBlocks : [];
  if (mode === 'full' && safeImageBlocks.length === 0) {
    return res.status(400).json({ error: 'No images provided.' });
  }
  if (!promptText || typeof promptText !== 'string') {
    return res.status(400).json({ error: 'No prompt provided.' });
  }
  const schema = (outputSchema && typeof outputSchema === 'object') ? outputSchema : null;

  try {
    const content = [...safeImageBlocks, { type: 'text', text: promptText }];
    let structured = !!schema;
    let { response, data } = await callAnthropic(apiKey, { content, maxTokens: MAX_TOKENS[mode], outputSchema: schema });

    if (structured && isStructuredOutputRejection(response, data)) {
      console.warn('Structured output rejected, retrying without it:', JSON.stringify(data?.error || data));
      structured = false;
      ({ response, data } = await callAnthropic(apiKey, { content, maxTokens: MAX_TOKENS[mode], outputSchema: null }));
    }

    if (!response.ok) {
      console.error('Anthropic API error:', data);
      return res.status(response.status).json({ error: 'Upstream API error', detail: data });
    }

    // Real token usage per call (Vercel function logs) — replaces the
    // estimates in the v3.13.115 analysis with measured numbers.
    console.log('ai-usage', JSON.stringify({
      mode, model: data.model, structured, images: safeImageBlocks.length,
      stop_reason: data.stop_reason, usage: data.usage,
    }));

    return res.status(200).json({ ...data, structured });

  } catch (err) {
    console.error('Serverless function error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
