// /api/narration.js — combines what were transcribe-narration.js and
// extract-narration-fields.js into one file, dispatched on `action`. Done
// to fit Vercel's Hobby-plan 12-serverless-function cap (see CLAUDE.md
// "Voice narration capture" section for the full story — the project was
// already at exactly 12 functions before this feature).
//
// POST body: { action, ... }
//
//   action: 'transcribe'  { audioBase64, mimeType }
//     -> transcribes a short spoken narration via Deepgram Nova-3
//        (English only, smart formatting). Audio is never persisted —
//        decoded to a Buffer in memory for the one outbound request, then
//        discarded when the function returns. Capped at MAX_AUDIO_BYTES
//        (413 above it) and counted as one AI action against the store's
//        monthly allowance (429 at the limit), v3.28.8.
//     Returns: { transcript }
//
//   action: 'extract'  { kind: 'item', transcript }
//     -> Claude (Haiku 4.5) turns a narration transcript into structured
//        catalog fields. The prompt is built here (v3.15.3) by
//        src/modules/narration-prompts.js; the browser only sends the
//        transcript, so this isn't a general-purpose Claude proxy.
//     Returns: raw Anthropic Messages API response

import { requireApprovedUser } from './_requireApprovedUser.js';
import { recordAiUsage } from './_aiUsage.js';
import { requireAiAllowance } from './_aiAllowance.js';
import { buildNarrationExtractPrompt } from '../src/modules/narration-prompts.js';

// The app stops a recording at 2 minutes (MAX_RECORDING_MS in
// src/modules/narration-capture.js), about 2 MB at the browsers' default
// bitrates. 3 MB of audio is 4 MB of base64, still under Vercel's 4.5 MB
// request limit, so an over-long upload gets this clear 413 instead.
export const MAX_AUDIO_BYTES = 3 * 1024 * 1024;
export const AUDIO_TOO_LONG = 'This recording is too long to transcribe. Keep a narration under 2 minutes and try again.';

// opts goes to requireAiAllowance (tests pass a fake Firestore as opts.db).
export async function handleTranscribe(req, res, auth, opts = {}){
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server is not configured with a Deepgram API key.' });
  }

  const { audioBase64, mimeType } = req.body || {};
  if (!audioBase64 || typeof audioBase64 !== 'string') {
    return res.status(400).json({ error: 'No audio provided.' });
  }

  // Checked on the base64 length first, so an oversized upload is never decoded.
  if (audioBase64.length > Math.ceil(MAX_AUDIO_BYTES / 3) * 4) {
    return res.status(413).json({ error: AUDIO_TOO_LONG });
  }
  const audioBuffer = Buffer.from(audioBase64, 'base64');
  if (audioBuffer.length > MAX_AUDIO_BYTES) {
    return res.status(413).json({ error: AUDIO_TOO_LONG });
  }
  const contentType = typeof mimeType === 'string' && /^audio\/[\w.+-]+(;.*)?$/i.test(mimeType) ? mimeType : 'audio/webm';

  // The store's monthly AI allowance (v3.28.8): the unit goes back when
  // Deepgram fails.
  const held = await requireAiAllowance(auth, res, opts);
  if (!held) return;

  let dgResponse, data;
  try {
    dgResponse = await fetch(
      'https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&punctuate=true&language=en',
      {
        method: 'POST',
        headers: {
          'Authorization': `Token ${apiKey}`,
          'Content-Type': contentType,
        },
        body: audioBuffer,
      }
    );
    data = await dgResponse.json();
  } catch (e) {
    await held.release();
    throw e;
  }
  if (!dgResponse.ok) {
    console.error('Deepgram API error:', data);
    await held.release();
    return res.status(dgResponse.status).json({ error: 'Transcription failed', detail: data });
  }

  // On the meter too, so the Developer Panel shows transcriptions next to
  // the Anthropic calls (no tokens, only the count).
  await recordAiUsage({ auth, call: 'narration_transcribe', model: 'deepgram-nova-3', usage: null, content: null });
  const transcript = data.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
  return res.status(200).json({ transcript });
}

export async function handleExtract(req, res, auth, opts = {}){
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server is not configured with an API key.' });
  }

  const { kind, transcript } = req.body || {};
  if (!transcript || typeof transcript !== 'string') {
    return res.status(400).json({ error: 'No transcript provided. Reload the app to get the latest version.' });
  }
  const promptText = buildNarrationExtractPrompt(kind, transcript);
  if (!promptText) {
    return res.status(400).json({ error: 'Unknown narration kind.' });
  }
  // The store's monthly AI allowance (v3.28.1); the unit goes back when
  // Anthropic fails (v3.28.8).
  const held = await requireAiAllowance(auth, res, opts);
  if (!held) return;

  let anthropicResponse, data;
  try {
    anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        // Plain structured extraction from a short transcript — no need for
        // Sonnet's cost/latency here. Thinking is on by default for this model
        // and its tokens count toward max_tokens, so the limit leaves room for it.
        model: 'claude-haiku-5-5',
        max_tokens: 2000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'low' },
        messages: [{ role: 'user', content: promptText }]
      })
    });
    data = await anthropicResponse.json();
  } catch (e) {
    await held.release();
    throw e;
  }
  if (!anthropicResponse.ok) {
    console.error('Anthropic API error:', data);
    await held.release();
    return res.status(anthropicResponse.status).json({ error: 'Upstream API error', detail: data });
  }

  await recordAiUsage({ auth, call: 'narration_extract', model: data.model, usage: data.usage, content: data.content });
  return res.status(200).json(data);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authCheck = await requireApprovedUser(req);
  if (!authCheck.ok) {
    return res.status(authCheck.status).json({ error: authCheck.error });
  }

  const { action } = req.body || {};

  try{
    if (action === 'transcribe') return await handleTranscribe(req, res, authCheck);
    if (action === 'extract') return await handleExtract(req, res, authCheck);
    return res.status(400).json({ error: 'Unknown action' });
  }catch(err){
    console.error('Serverless function error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
