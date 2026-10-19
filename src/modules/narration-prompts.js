// Prompts for the voice-narration "extract" step (api/narration.js). Built
// on the SERVER since v3.15.3: the browser sends only the transcript and
// which flow it came from (`kind`), so the endpoint can't be used as a
// general-purpose Claude proxy. Wording moved verbatim from
// narration-capture.js (item modal) and live-narration.js (Live Catalog).

import { PRESET_COLORS, PRESET_CLOTHING_TYPES } from './constants.js';

export const NARRATION_TRANSCRIPT_MAX = 6000;

function quoteTranscript(transcript){
  return String(transcript || '').slice(0, NARRATION_TRANSCRIPT_MAX).replace(/"/g, '\\"');
}

// Item modal "🎙️ Narrate item".
function buildItemNarrationPrompt(transcript){
  return `You are helping catalog a secondhand item for resale on eBay/Mercari/Poshmark from a spoken narration. The seller described the item out loud while holding it. Here is the transcript:

"${quoteTranscript(transcript)}"

Respond with ONLY a JSON object (no markdown fences, no preamble), with this exact shape — use an empty string "" (or null for price) for anything not mentioned or not confidently inferable. Do not guess just to fill a field:
{
  "name": "short item name/description, e.g. 'Levi's 501 denim jacket', or empty string if unclear",
  "brand": "brand name if mentioned, else empty string",
  "gender": "one of: Women's, Men's, Girls', Boys', Unisex — or empty string if not mentioned/not applicable",
  "clothing_type": "if this is clothing/shoes/bag/accessory, one of: ${PRESET_CLOTHING_TYPES.join(', ')}, or another specific type if none fit. Empty string if not applicable or not mentioned.",
  "color": "one of: ${PRESET_COLORS.join(', ')}, or another specific color if none fit. Empty string if not mentioned.",
  "size": "size exactly as mentioned, e.g. 'M', '32x30', '8.5' — empty string if not mentioned",
  "category": "a short general category, e.g. Clothing, Shoes, Home Goods — empty string if unclear",
  "condition": "one of: novo_etiqueta (still has tags/new with tags), novo_sem_etiqueta (new without tags), excelente (used, excellent condition), bom (used, good condition), aceitavel (used, fair condition, visible wear), defeito (flawed, for parts/repair) — only if something about condition/tags/wear was actually said, else empty string",
  "price": number or null (asking/listing price in USD, only if a specific price was explicitly said out loud),
  "notes": "anything else mentioned that doesn't fit above — fabric/material, measurements, flaws, care instructions, etc., combined into one short readable note. Empty string if nothing extra was said."
}
Respond with the JSON object only. Do not include any text, explanation, or markdown formatting before or after it. Your entire response must be parseable as JSON.`;
}

// Live Catalog quick-add narration.
function buildLiveNarrationPrompt(transcript){
  return `You are helping catalog an item for a live-sale "lot list" (Poshmark/similar live shopping) from a spoken narration. The seller described the item out loud while holding it, right before presenting it live. Here is the transcript:

"${quoteTranscript(transcript)}"

Respond with ONLY a JSON object (no markdown fences, no preamble), with this exact shape — use an empty string "" for anything not mentioned or not confidently inferable, and an empty array for measurements if none were mentioned. Do not guess just to fill a field:
{
  "tipo": "the item type, e.g. 'Sweater', 'Jeans', 'Dress' — empty string if unclear",
  "brand": "brand name if mentioned, else empty string",
  "size": "size exactly as mentioned, e.g. 'M', '32x30' — empty string if not mentioned",
  "color": "one of: ${PRESET_COLORS.join(', ')}, or another specific color if none fit. Empty string if not mentioned.",
  "fabric": "fabric/material composition if mentioned, e.g. '100% cotton', '80% polyester 20% spandex' — empty string if not mentioned",
  "measurements": [{"label": "e.g. Pit to pit, Length, Waist, Sleeve length", "value": "e.g. 20 in"}] — one entry per measurement actually stated, empty array if none,
  "notes": "anything else mentioned that doesn't fit above — flaws, condition, styling notes, etc. Empty string if nothing extra was said."
}
Respond with the JSON object only. Do not include any text, explanation, or markdown formatting before or after it. Your entire response must be parseable as JSON.`;
}

// kind: 'item' | 'live'. Returns null for an unknown kind.
export function buildNarrationExtractPrompt(kind, transcript){
  if (kind === 'item') return buildItemNarrationPrompt(transcript);
  if (kind === 'live') return buildLiveNarrationPrompt(transcript);
  return null;
}
