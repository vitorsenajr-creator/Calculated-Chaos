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
//        discarded when the function returns.
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
import { buildNarrationExtractPrompt } from '../src/modules/narration-prompts.js';

async function handleTranscribe(req, res){
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server is not configured with a Deepgram API key.' });
  }

  const { audioBase64, mimeType } = req.body || {};
  if (!audioBase64 || typeof audioBase64 !== 'string') {
    return res.status(400).json({ error: 'No audio provided.' });
  }

  const audioBuffer = Buffer.from(audioBase64, 'base64');
  const dgResponse = await fetch(
    'https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&punctuate=true&language=en',
    {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': mimeType || 'audio/webm',
      },
      body: audioBuffer,
    }
  );

  const data = await dgResponse.json();
  if (!dgResponse.ok) {
    console.error('Deepgram API error:', data);
    return res.status(dgResponse.status).json({ error: 'Transcription failed', detail: data });
  }

  const transcript = data.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
  return res.status(200).json({ transcript });
}

async function handleExtract(req, res, auth){
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

  const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
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

  const data = await anthropicResponse.json();
  if (!anthropicResponse.ok) {
    console.error('Anthropic API error:', data);
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
    if (action === 'transcribe') return await handleTranscribe(req, res);
    if (action === 'extract') return await handleExtract(req, res, authCheck);
    return res.status(400).json({ error: 'Unknown action' });
  }catch(err){
    console.error('Serverless function error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
