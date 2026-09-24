// /api/ebay-item-aspects.js
// Handles two things via req.body.mode (merged into one file to stay under
// Vercel Hobby's 12-serverless-function-per-deployment limit — these were
// two separate new endpoints added the same day, so merging them was the
// lowest-risk way to free up a slot):
//
//   mode: 'aspects' (default) — required item specifics for a given eBay
//     category. Lets the frontend show real, category-specific fields
//     (Pattern, Material, "Vintage?", etc.) at cataloging time, instead of
//     the listing publish step silently auto-filling a placeholder ("Does
//     not apply") for anything it wasn't explicitly given — see
//     ebay-list.js's fillMissingRequiredAspects, which stays in place as a
//     last-resort safety net, not the primary path.
//     POST body: { access_token, category_id }
//     Returns: { success, aspects: [{ name, required, selectionOnly, allowedValues }] }
//
//   mode: 'suggest_fee' — asks the AI for a rough estimate of a resale
//     platform's typical seller fee %, for the "🔍 Suggest %" button in
//     Settings → Platforms. Purely informational — she reviews/edits the
//     number before saving.
//     POST body: { mode: 'suggest_fee', platformName }
//     Returns: { feePct, note }
//
//   mode: 'explain_error' — fallback for an eBay publish error the app's own
//     error library (src/modules/ebay-error-hints.js) doesn't recognize:
//     asks the AI to explain it in plain English and name the one field to
//     change. Only called for UNRECOGNIZED errors, so the cost stays small.
//     POST body: { mode: 'explain_error', errors, step, item, category, aspectsSent }
//     Returns: { explanation, fieldToChange, suggestedValue }

import { requireApprovedUser } from './_requireApprovedUser.js';

const EBAY_SANDBOX = process.env.EBAY_SANDBOX === 'true';
const EBAY_API_BASE = EBAY_SANDBOX ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';
const CATEGORY_TREE_ID = '0'; // eBay's default/shared tree ID for EBAY_US

async function handleAspects(req, res) {
  const { access_token, category_id } = req.body || {};
  if (!access_token) return res.status(400).json({ error: 'Missing access_token' });
  if (!category_id) return res.status(400).json({ error: 'Missing category_id' });

  const url = `${EBAY_API_BASE}/commerce/taxonomy/v1/category_tree/${CATEGORY_TREE_ID}/get_item_aspects_for_category?category_id=${encodeURIComponent(category_id)}`;
  const r = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${access_token}`,
      'Content-Type': 'application/json',
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
    }
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }

  if (!r.ok) {
    return res.status(r.status).json({ error: 'eBay item aspects lookup failed', detail: data });
  }

  // eBay's aspectUsage field always shows "RECOMMENDED" even for hard-
  // required aspects — aspectConstraint.aspectRequired is what actually
  // tells the truth (per eBay's own Taxonomy API docs).
  const aspects = (data.aspects || []).map(a => ({
    name: a.localizedAspectName,
    required: !!a.aspectConstraint?.aspectRequired,
    selectionOnly: a.aspectConstraint?.aspectMode === 'SELECTION_ONLY',
    allowedValues: (a.aspectValues || []).map(v => v.localizedValue).filter(Boolean),
  })).filter(a => a.name);

  return res.status(200).json({ success: true, aspects });
}

async function handleSuggestFee(req, res) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server is not configured with an API key.' });
  }

  const { platformName } = req.body || {};
  if (!platformName || typeof platformName !== 'string') {
    return res.status(400).json({ error: 'No platform name provided.' });
  }

  const promptText = `What is the typical total seller fee percentage on the resale/marketplace platform "${platformName}" (as a seller selling secondhand clothing/goods)? Consider the platform's standard selling/referral fee, and if payment processing fees are usually bundled in for a typical seller, include those too — give one single all-in percentage a reseller should budget for.
Respond with ONLY a JSON object, no markdown fences, no preamble: {"feePct": number, "note": "1 sentence explaining what this covers, e.g. whether payment processing is included"}
If you're not confident about this specific platform, still give your best reasonable estimate rather than refusing — reseller marketplace fees are usually in the 5-25% range.`;

  const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      messages: [{ role: 'user', content: promptText }]
    })
  });

  const data = await anthropicResponse.json();
  if (!anthropicResponse.ok) {
    console.error('Anthropic API error:', data);
    return res.status(anthropicResponse.status).json({ error: 'Upstream API error', detail: data });
  }

  const textBlock = data.content && data.content.find(b => b.type === 'text');
  if (!textBlock) {
    return res.status(500).json({ error: "The AI didn't return a usable response." });
  }
  let cleaned = textBlock.text.replace(/```json|```/gi, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1) {
    return res.status(500).json({ error: "Couldn't make sense of the AI's response." });
  }
  cleaned = cleaned.slice(firstBrace, lastBrace + 1);

  let result;
  try { result = JSON.parse(cleaned); } catch (e) {
    return res.status(500).json({ error: "Couldn't make sense of the AI's response." });
  }
  const feePct = parseFloat(result.feePct);
  if (isNaN(feePct)) {
    return res.status(500).json({ error: 'AI did not return a usable fee percentage.' });
  }

  return res.status(200).json({ feePct, note: result.note || null });
}

const EXPLAIN_FIELDS = ['size', 'brand', 'color', 'condition', 'weight', 'category', 'price', 'description', 'photos', 'ebay_settings', 'none'];

async function handleExplainError(req, res) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server is not configured with an API key.' });
  }
  const { errors, step, item, category, aspectsSent } = req.body || {};
  if (!Array.isArray(errors) || !errors.length) {
    return res.status(400).json({ error: 'No errors provided.' });
  }
  const clip = (v, n) => JSON.stringify(v ?? null).slice(0, n);

  const promptText = `You help a small secondhand reseller understand why the eBay Sell Inventory API rejected a listing, and what to change in her own catalog app to fix it.

Failed step: ${String(step || 'unknown').slice(0, 40)}
eBay errors (JSON): ${clip(errors, 4000)}
Item as cataloged (JSON): ${clip(item, 2000)}
eBay category: ${clip(category, 300)}
Item specifics that were sent (JSON): ${clip(aspectsSent, 2000)}

Her app has these editable fields: size, brand, color, condition, weight (package weight/dimensions), category (eBay category), price, description, photos, eBay settings (policies / account connection), and category item specifics (Pattern, Material, Type, etc.).

Respond with ONLY a JSON object, no markdown fences, no preamble:
{"explanation": "1-2 short plain-English sentences: what eBay rejected and exactly what to change. No jargon, no error codes.",
 "fieldToChange": one of ${JSON.stringify(EXPLAIN_FIELDS)} or "aspect:<exact item specific name>",
 "suggestedValue": "the exact new value to use, ONLY if it can be determined with confidence from the error or the data above, otherwise an empty string"}`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 400,
      messages: [{ role: 'user', content: promptText }]
    })
  });
  const data = await r.json();
  if (!r.ok) {
    console.error('Anthropic API error:', data);
    return res.status(r.status).json({ error: 'Upstream API error', detail: data });
  }
  const textBlock = data.content && data.content.find(b => b.type === 'text');
  const raw = textBlock ? textBlock.text.replace(/```json|```/gi, '') : '';
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  let result = null;
  if (first !== -1 && last !== -1) {
    try { result = JSON.parse(raw.slice(first, last + 1)); } catch (e) { result = null; }
  }
  if (!result || typeof result.explanation !== 'string') {
    return res.status(500).json({ error: "Couldn't make sense of the AI's response." });
  }
  const field = String(result.fieldToChange || 'none');
  return res.status(200).json({
    explanation: result.explanation.slice(0, 600),
    fieldToChange: (EXPLAIN_FIELDS.includes(field) || /^aspect:.+/.test(field)) ? field : 'none',
    suggestedValue: typeof result.suggestedValue === 'string' ? result.suggestedValue.slice(0, 120) : '',
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authCheck = await requireApprovedUser(req);
  if (!authCheck.ok) {
    return res.status(authCheck.status).json({ error: authCheck.error });
  }

  try {
    if (req.body?.mode === 'suggest_fee') {
      return await handleSuggestFee(req, res);
    }
    if (req.body?.mode === 'explain_error') {
      return await handleExplainError(req, res);
    }
    return await handleAspects(req, res);
  } catch (e) {
    console.error('ebay-item-aspects error:', e);
    return res.status(500).json({ error: 'Request failed', detail: String(e) });
  }
}
