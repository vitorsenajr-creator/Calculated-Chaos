// Vercel Serverless Function
// Transcribes a short spoken narration (recorded while cataloging an item)
// using Deepgram Nova-3. Kept separate from extract-narration-fields.js so
// the transcription step and the field-extraction step can be swapped or
// retried independently — same "one endpoint per concern" pattern as
// analyze-photo.js / generate-listing.js.
// The frontend calls this at /api/transcribe-narration (see
// src/modules/narration-capture.js).

import { requireApprovedUser } from './_requireApprovedUser.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authCheck = await requireApprovedUser(req);
  if (!authCheck.ok) {
    return res.status(authCheck.status).json({ error: authCheck.error });
  }

  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server is not configured with a Deepgram API key.' });
  }

  const { audioBase64, mimeType } = req.body || {};
  if (!audioBase64 || typeof audioBase64 !== 'string') {
    return res.status(400).json({ error: 'No audio provided.' });
  }

  try {
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

  } catch (err) {
    console.error('Serverless function error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
