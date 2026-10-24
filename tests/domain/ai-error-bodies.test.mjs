// The AI handlers never hand the provider's raw error body to the browser
// (v3.28.10): it goes to the server log only.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const SECRET = 'PROVIDER-SECRET-BODY-req_123';
const token = 'h.' + Buffer.from(JSON.stringify({ user_id: 'u1', email_verified: true, email: 'a@b.c' })).toString('base64') + '.s';

process.env.ANTHROPIC_API_KEY = 'k';
process.env.DEEPGRAM_API_KEY = 'k';
delete process.env.FIREBASE_SERVICE_ACCOUNT;

const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('firestore.googleapis.com')) {
    // The REST sign-in check: the user, its members doc and a live store (v3.28.8-9), so the
    // handlers reach the provider call instead of the "no store" refusal.
    const fields = /\/members\//.test(u) ? { role: { stringValue: 'owner' } }
      : /\/businesses\//.test(u) ? { live: { booleanValue: true } }
      : { status: { stringValue: 'approved' }, role: { stringValue: 'owner' }, activeBizId: { stringValue: 'b1' } };
    return new Response(JSON.stringify({ fields }), { status: 200 });
  }
  return new Response(JSON.stringify({ error: { message: SECRET }, detail: SECRET }), { status: 500 });
};
const quiet = console.error; console.error = () => {}; console.warn = () => {};

function call(handler, body) {
  return new Promise((resolve) => {
    const res = { status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
    handler({ method: 'POST', headers: { authorization: 'Bearer ' + token }, body }, res);
  });
}

test('analyze-photo: a provider error carries no raw body', async () => {
  const { default: handler } = await import('../../api/analyze-photo.js');
  const r = await call(handler, { mode: 'import_map', input: { headers: ['Name'], rows: [], values: {} } });
  assert.equal(r.code, 500);
  assert.equal(r.body.error, 'Upstream API error');
  assert.ok(!JSON.stringify(r.body).includes(SECRET));
  assert.equal(r.body.detail, undefined);
});

test('narration: extract and transcribe errors carry no raw body', async () => {
  const { default: handler } = await import('../../api/narration.js');
  const ex = await call(handler, { action: 'extract', kind: 'item', transcript: 'a red dress' });
  assert.equal(ex.code, 500, JSON.stringify(ex));
  assert.ok(!JSON.stringify(ex.body).includes(SECRET));
  assert.equal(ex.body.detail, undefined);
  const tr = await call(handler, { action: 'transcribe', audioBase64: Buffer.from('abc').toString('base64'), mimeType: 'audio/webm' });
  assert.equal(tr.code, 500, JSON.stringify(tr));
  assert.ok(!JSON.stringify(tr.body).includes(SECRET));
  assert.equal(tr.body.detail, undefined);
  globalThis.fetch = realFetch; console.error = quiet;
});
