// Vercel Serverless Function
// This runs on Vercel's server, never in the browser — so the API key stays secret.
// Vercel automatically deploys any file in /api as a serverless endpoint.
//
// The single AI endpoint for an item (v3.13.115) — replaces the old
// analyze-photo + generate-listing pair (generate-listing.js was removed,
// freeing one of the Hobby plan's 12 function slots). Its modes:
//  - mode:'full'         → photos required; the "✨ Analyze & write listing"
//                          call (identification + eBay specifics + price +
//                          visual facts + listing copy, one request).
//  - mode:'listing_only' → photos optional; rewrites title/description/tags,
//                          photo-free when the item has saved aiFacts.
//  - mode:'import_map'   → no photos; maps a spreadsheet's columns and
//                          value words to item fields for the import
//                          (v3.23.2, src/modules/ai-import.js). Only the
//                          headers, up to 10 sample rows and the distinct
//                          words are sent, each clipped.
//  - mode:'sale_screenshot' → exactly one screenshot of a sale (Stock →
//                          Pick, v3.24.2, src/modules/ai-sale-screenshot.js);
//                          returns the orders and items it shows, with SKUs.
// The prompt and the JSON schema are built HERE (v3.15.3) from the item
// data the browser sends (`input`), using the pure builders in
// src/modules/ai-item.js. A prompt or schema sent by the browser is ignored,
// so the endpoint can't be used as a general-purpose Claude proxy.

import { requireApprovedUser } from './_requireApprovedUser.js';
import { recordAiUsage } from './_aiUsage.js';
import { requireAiAllowance } from './_aiAllowance.js';
import { buildItemAiRequest } from '../src/modules/ai-item.js';
import { buildImportMapRequest } from '../src/modules/ai-import.js';
import { buildSaleScreenshotRequest } from '../src/modules/ai-sale-screenshot.js';

const MAX_IMAGES = 5;
const IMAGE_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// Keeps only well-formed image blocks (base64 or http(s) URL), at most
// MAX_IMAGES; anything else in the array is dropped.
function sanitizeImageBlocks(raw){
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const b of raw){
    if (out.length >= MAX_IMAGES) break;
    const src = b && b.type === 'image' ? b.source : null;
    if (!src) continue;
    if (src.type === 'base64' && IMAGE_MEDIA_TYPES.includes(src.media_type) && typeof src.data === 'string' && src.data){
      out.push({ type: 'image', source: { type: 'base64', media_type: src.media_type, data: src.data } });
    } else if (src.type === 'url' && typeof src.url === 'string' && /^https?:\/\//i.test(src.url)){
      out.push({ type: 'image', source: { type: 'url', url: src.url } });
    }
  }
  return out;
}

// Sonnet 5.5 at low effort (v3.14.1). Thinking is always on for this model
// (adaptive); effort is the control for how much it thinks, and low keeps
// latency and cost close to the old Sonnet 4.6 call. Thinking tokens count
// toward max_tokens, so the limits leave room for it on top of the JSON.
const MODEL = 'claude-sonnet-5-5';
const EFFORT = 'low';
const MAX_TOKENS = { full: 16000, listing_only: 8000, import_map: 8000, sale_screenshot: 8000 };
// Reading a sale screenshot is plain text reading, so it runs on Haiku 5.5
// (v3.24.2), much cheaper per screenshot. Haiku has no server-side refusal
// fallback, so it's sent without one.
const MODE_MODEL = { sale_screenshot: { model: 'claude-haiku-5-5', fallbacks: false } };

async function callAnthropic(apiKey, { mode, content, maxTokens, outputSchema }){
  const cfg = MODE_MODEL[mode] || { model: MODEL, fallbacks: true };
  const body = {
    model: cfg.model,
    max_tokens: maxTokens,
    thinking: { type: 'adaptive' },
    output_config: { effort: EFFORT },
    messages: [{ role: 'user', content }],
  };
  // If a safety classifier declines the request, the API re-runs it on
  // Anthropic's recommended fallback model in the same call.
  if (cfg.fallbacks) body.fallbacks = 'default';
  if (outputSchema){
    body.output_config.format = { type: 'json_schema', schema: outputSchema };
  }
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      ...(cfg.fallbacks ? { 'anthropic-beta': 'server-side-fallback-2026-07-01' } : {})
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

  const { mode = 'full', imageBlocks, input } = req.body || {};

  if (!MAX_TOKENS[mode]) {
    return res.status(400).json({ error: `Unknown mode: ${mode}` });
  }
  const safeImageBlocks = sanitizeImageBlocks(imageBlocks);
  if ((mode === 'full' || mode === 'sale_screenshot') && safeImageBlocks.length === 0) {
    return res.status(400).json({ error: 'No images provided.' });
  }
  if (!input || typeof input !== 'object') {
    return res.status(400).json({ error: 'No item data provided. Reload the app to get the latest version.' });
  }
  if (mode === 'import_map' && !(Array.isArray(input.headers) && input.headers.length)) {
    return res.status(400).json({ error: 'No columns provided.' });
  }
  const { promptText, schema } = mode === 'import_map' ? buildImportMapRequest(input)
    : mode === 'sale_screenshot' ? buildSaleScreenshotRequest(input)
    : buildItemAiRequest(mode, input);
  // The import sends no photos; a sale screenshot is read one at a time.
  if (mode === 'import_map') safeImageBlocks.length = 0;
  if (mode === 'sale_screenshot') safeImageBlocks.length = 1;

  // The store's monthly AI allowance (v3.28.1): checked after the request is
  // known to be valid, so a bad request never counts against it.
  if (!(await requireAiAllowance(authCheck, res))) return;

  try {
    const content = [...safeImageBlocks, { type: 'text', text: promptText }];
    let structured = !!schema;
    let { response, data } = await callAnthropic(apiKey, { mode, content, maxTokens: MAX_TOKENS[mode], outputSchema: schema });

    if (structured && isStructuredOutputRejection(response, data)) {
      console.warn('Structured output rejected, retrying without it:', JSON.stringify(data?.error || data));
      structured = false;
      ({ response, data } = await callAnthropic(apiKey, { mode, content, maxTokens: MAX_TOKENS[mode], outputSchema: null }));
    }

    if (!response.ok) {
      console.error('Anthropic API error:', data);
      return res.status(response.status).json({ error: 'Upstream API error' });
    }

    await recordAiUsage({ auth: authCheck, call: mode, model: data.model, usage: data.usage, content: data.content });

    // Real token usage per call (Vercel function logs) — replaces the
    // estimates in the v3.13.115 analysis with measured numbers.
    console.log('ai-usage', JSON.stringify({
      mode, model: data.model, structured, images: safeImageBlocks.length,
      effort: EFFORT, stop_reason: data.stop_reason, stop_details: data.stop_details || null,
      usage: data.usage,
    }));

    return res.status(200).json({ ...data, structured });

  } catch (err) {
    console.error('Serverless function error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
