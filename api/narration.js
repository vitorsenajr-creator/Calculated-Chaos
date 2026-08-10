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
//   action: 'extract'  { promptText }
//     -> generic text-only Claude proxy (Haiku 4.5) that turns a
//        narration transcript into structured catalog fields. Prompt is
//        built client-side (modules/narration-capture.js) and just passed
//        through, same pattern as generate-listing.js, so iterating on
//        prompt wording doesn't need a redeploy of prompt logic split
//        across two places.
//     Returns: raw Anthropic Messages API response

import { requireApprovedUser } from './_requireApprovedUser.js';

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

async function handleExtract(req, res){
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server is not configured with an API key.' });
  }

  const { promptText } = req.body || {};
  if (!promptText || typeof promptText !== 'string') {
    return res.status(400).json({ error: 'No prompt provided.' });
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
    if (action === 'extract') return await handleExtract(req, res);
    return res.status(400).json({ error: 'Unknown action' });
  }catch(err){
    console.error('Serverless function error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
