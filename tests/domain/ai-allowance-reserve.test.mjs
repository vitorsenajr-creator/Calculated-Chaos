// The store's AI allowance reserved in a transaction (api/_aiAllowance.js,
// v3.28.14) and the narration limits (api/narration.js). A fake Firestore
// with optimistic transactions stands in for Firebase Admin: a transaction
// whose reads changed before its commit runs again, as Firestore's would.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

delete process.env.FIREBASE_SERVICE_ACCOUNT; // the meter write is skipped
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.DEEPGRAM_API_KEY = 'test-key';

const { requireAiAllowance, reserveAiUnit, getAiAllowance, ALLOWANCE_UNAVAILABLE } = await import('../../api/_aiAllowance.js');
const { NO_STORE_ERROR } = await import('../../api/_requireApprovedUser.js');
const { handleTranscribe, handleExtract, MAX_AUDIO_BYTES, AUDIO_TOO_LONG } = await import('../../api/narration.js');

const NOW = new Date('2026-10-15T12:00:00Z');
const AUTH = { ok: true, uid: 'u1', bizId: 'biz1' };
const COUNTER = 'ai_allowance/biz1__2026-10';

function fakeDb(docs = {}, { failReads = false, failTx = false } = {}){
  const store = new Map(Object.entries(docs));
  const versions = new Map();
  const tick = () => new Promise(r => setImmediate(r));
  const version = (key) => versions.get(key) || 0;
  const snap = (path) => {
    const d = store.get(path);
    return { exists: d !== undefined, data: () => (d === undefined ? undefined : { ...d }) };
  };
  const rowsOf = (q) => [...store.entries()]
    .filter(([path, d]) => path.startsWith(q.name + '/') && q.filters.every(([f, v]) => d[f] === v))
    .map(([, d]) => ({ data: () => ({ ...d }) }));
  const query = (name, filters) => ({
    isQuery: true, name, filters,
    where: (f, op, v) => query(name, [...filters, [f, v]]),
    get: async () => { if (failReads) throw new Error('unavailable'); await tick(); return { docs: rowsOf({ name, filters }) }; },
  });
  const doc = (path) => ({
    path,
    get: async () => { if (failReads) throw new Error('unavailable'); await tick(); return snap(path); },
  });
  const apply = (path, data, merge) => {
    store.set(path, merge ? { ...(store.get(path) || {}), ...data } : { ...data });
    versions.set(path, version(path) + 1);
    const coll = path.split('/')[0];
    versions.set(coll, version(coll) + 1);
  };
  const db = {
    store, commits: 0, retries: 0,
    collection: (name) => ({ doc: (id) => doc(`${name}/${id}`), where: (f, op, v) => query(name, [[f, v]]) }),
    async runTransaction(fn){
      for (let attempt = 0; attempt < 10; attempt++){
        const reads = new Map();
        const writes = [];
        const tx = {
          async get(ref){
            if (failReads || failTx) throw new Error('unavailable');
            // Snapshot first, then yield: the other transaction reads the
            // same state before either commits.
            let out;
            if (ref.isQuery){ reads.set(ref.name, version(ref.name)); out = { docs: rowsOf(ref) }; }
            else { reads.set(ref.path, version(ref.path)); out = snap(ref.path); }
            await tick();
            return out;
          },
          set(ref, data, opts){ writes.push([ref.path, data, !!(opts && opts.merge)]); },
        };
        const result = await fn(tx);
        // Commit: no await from the check to the writes, so it is atomic here.
        if ([...reads].some(([key, v]) => version(key) !== v)){ db.retries++; continue; }
        for (const w of writes) apply(...w);
        db.commits++;
        return result;
      }
      throw new Error('transaction kept conflicting');
    },
  };
  return db;
}

function fakeRes(){
  return { statusCode: null, body: null, status(c){ this.statusCode = c; return this; }, json(b){ this.body = b; return this; } };
}

const biz = (limit) => ({ 'businesses/biz1': limit == null ? { live: true } : { live: true, aiMonthlyLimit: limit } });

let realFetch, fetchCalls, fetchReply;
beforeEach(() => {
  realFetch = globalThis.fetch;
  fetchCalls = [];
  fetchReply = async () => ({ ok: true, status: 200, json: async () => ({ model: 'm', usage: {}, content: [], results: { channels: [{ alternatives: [{ transcript: 'blue dress size M' }] }] } }) });
  globalThis.fetch = async (url, init) => { fetchCalls.push(String(url)); return fetchReply(url, init); };
});
afterEach(() => { globalThis.fetch = realFetch; });

test('two calls at the same time on the last free slot: only one passes', async () => {
  const db = fakeDb({ ...biz(3), [COUNTER]: { bizId: 'biz1', month: '2026-10', used: 2 } });
  const res1 = fakeRes(), res2 = fakeRes();
  const [a, b] = await Promise.all([
    requireAiAllowance(AUTH, res1, { db, now: NOW }),
    requireAiAllowance(AUTH, res2, { db, now: NOW }),
  ]);
  assert.equal([a, b].filter(Boolean).length, 1);
  assert.deepEqual([res1.statusCode, res2.statusCode].sort(), [429, null]);
  assert.ok(db.retries >= 1, 'the second transaction saw the first one commit');
  assert.equal(db.store.get(COUNTER).used, 3);
  const refused = res1.statusCode === 429 ? res1 : res2;
  assert.equal(refused.body.error, 'Your store used its 3 AI actions for October. They reset on November 1.');
});

test('ten calls at once with three slots left: exactly three pass', async () => {
  const db = fakeDb({ ...biz(10), [COUNTER]: { used: 7 } });
  const results = await Promise.all(Array.from({ length: 10 }, () => requireAiAllowance(AUTH, fakeRes(), { db, now: NOW })));
  assert.equal(results.filter(Boolean).length, 3);
  assert.equal(db.store.get(COUNTER).used, 10);
});

test('a month with no counter starts from the ai_usage meter', async () => {
  const db = fakeDb({
    ...biz(3),
    'ai_usage/a': { bizId: 'biz1', month: '2026-10', calls: 1 },
    'ai_usage/b': { bizId: 'biz1', month: '2026-10', calls: 1 },
    'ai_usage/c': { bizId: 'biz1', month: '2026-09', calls: 40 },
    'ai_usage/d': { bizId: 'other', month: '2026-10', calls: 40 },
  });
  assert.equal((await getAiAllowance(AUTH, { db, now: NOW })).used, 2);
  const r = await reserveAiUnit(AUTH, { db, now: NOW });
  assert.equal(r.reserved, true);
  assert.equal(r.allowance.used, 3);
  assert.deepEqual(db.store.get(COUNTER), { bizId: 'biz1', month: '2026-10', used: 3, updatedAt: NOW });
  const res = fakeRes();
  assert.equal(await requireAiAllowance(AUTH, res, { db, now: NOW }), false);
  assert.equal(res.statusCode, 429);
  assert.equal((await getAiAllowance(AUTH, { db, now: NOW })).used, 3);
});

test('release hands the unit back once, never below zero', async () => {
  const db = fakeDb({ ...biz(5), [COUNTER]: { used: 4 } });
  const r = await reserveAiUnit(AUTH, { db, now: NOW });
  assert.equal(db.store.get(COUNTER).used, 5);
  await r.release();
  await r.release();
  assert.equal(db.store.get(COUNTER).used, 4);
});

test('no limit: passes without a counter; no store: 403 (v3.28.9)', async () => {
  const db = fakeDb(biz(null));
  const res = fakeRes();
  const held = await requireAiAllowance(AUTH, res, { db, now: NOW });
  assert.ok(held);
  assert.equal(held.reserved, false);
  await held.release();
  assert.equal(res.statusCode, null);
  assert.equal(db.store.has(COUNTER), false);

  const none = fakeRes();
  assert.equal(await requireAiAllowance({ ok: true, uid: 'u1', bizId: null }, none, { db, now: NOW }), false);
  assert.equal(none.statusCode, 403);
  assert.equal(none.body.error, NO_STORE_ERROR);
});

// Vitor, 2026-10-24: when Firestore fails, refuse only stores with a limit.
test('the store limit unreadable: the call goes through, nothing held', async () => {
  const db = fakeDb(biz(100), { failReads: true });
  const res = fakeRes();
  const held = await requireAiAllowance(AUTH, res, { db, now: NOW });
  assert.ok(held);
  assert.equal(held.reserved, false);
  assert.equal(res.statusCode, null);
});

test('a limited store whose counter cannot be reserved: 503 and no upstream call', async () => {
  const db = fakeDb(biz(100), { failTx: true });
  const res = fakeRes();
  assert.equal(await requireAiAllowance(AUTH, res, { db, now: NOW }), false);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, ALLOWANCE_UNAVAILABLE);

  const res2 = fakeRes();
  await handleExtract({ body: { kind: 'item', transcript: 'a blue dress' } }, res2, AUTH, { db, now: NOW });
  assert.equal(res2.statusCode, 503);
  assert.equal(fetchCalls.length, 0);

  // A store without a limit is never refused for this.
  const free = fakeDb(biz(null), { failTx: true });
  const res3 = fakeRes();
  assert.ok(await requireAiAllowance(AUTH, res3, { db: free, now: NOW }));
  assert.equal(res3.statusCode, null);
});

test('extract: an Anthropic error or a network failure gives the unit back', async () => {
  const db = fakeDb({ ...biz(5), [COUNTER]: { used: 2 } });
  fetchReply = async () => ({ ok: false, status: 529, json: async () => ({ error: { type: 'overloaded_error' } }) });
  const res = fakeRes();
  await handleExtract({ body: { kind: 'item', transcript: 'a blue dress' } }, res, AUTH, { db, now: NOW });
  assert.equal(res.statusCode, 529);
  assert.equal(fetchCalls.length, 1);
  assert.equal(db.store.get(COUNTER).used, 2);

  fetchReply = async () => { throw new Error('socket hang up'); };
  await assert.rejects(handleExtract({ body: { kind: 'item', transcript: 'a blue dress' } }, fakeRes(), AUTH, { db, now: NOW }));
  assert.equal(db.store.get(COUNTER).used, 2);

  fetchReply = async () => ({ ok: true, status: 200, json: async () => ({ model: 'claude-haiku-5-5', usage: {}, content: [] }) });
  const ok = fakeRes();
  await handleExtract({ body: { kind: 'item', transcript: 'a blue dress' } }, ok, AUTH, { db, now: NOW });
  assert.equal(ok.statusCode, 200);
  assert.equal(db.store.get(COUNTER).used, 3);
});

test('extract: a bad request is refused before anything is reserved', async () => {
  const db = fakeDb({ ...biz(5), [COUNTER]: { used: 2 } });
  const res = fakeRes();
  await handleExtract({ body: { kind: 'item' } }, res, AUTH, { db, now: NOW });
  assert.equal(res.statusCode, 400);
  assert.equal(db.store.get(COUNTER).used, 2);
});

const audio = (bytes) => Buffer.alloc(bytes, 7).toString('base64');

test('transcribe: audio over the cap gets 413 and spends nothing', async () => {
  const db = fakeDb({ ...biz(5), [COUNTER]: { used: 1 } });
  for (const audioBase64 of [audio(MAX_AUDIO_BYTES + 1), 'A'.repeat(Math.ceil(MAX_AUDIO_BYTES / 3) * 4 + 4)]){
    const res = fakeRes();
    await handleTranscribe({ body: { action: 'transcribe', audioBase64, mimeType: 'audio/webm' } }, res, AUTH, { db, now: NOW });
    assert.equal(res.statusCode, 413);
    assert.equal(res.body.error, AUDIO_TOO_LONG);
  }
  assert.equal(fetchCalls.length, 0);
  assert.equal(db.store.get(COUNTER).used, 1);
});

test('transcribe: at the limit gets 429 and Deepgram is not called', async () => {
  const db = fakeDb({ ...biz(5), [COUNTER]: { used: 5 } });
  const res = fakeRes();
  await handleTranscribe({ body: { action: 'transcribe', audioBase64: audio(1000), mimeType: 'audio/webm' } }, res, AUTH, { db, now: NOW });
  assert.equal(res.statusCode, 429);
  assert.deepEqual(res.body.aiLimit, { used: 5, limit: 5, resetsOn: '2026-11-01' });
  assert.equal(fetchCalls.length, 0);
});

test('transcribe: a good call spends one unit, a Deepgram failure gives it back', async () => {
  const db = fakeDb({ ...biz(5), [COUNTER]: { used: 1 } });
  const ok = fakeRes();
  await handleTranscribe({ body: { action: 'transcribe', audioBase64: audio(MAX_AUDIO_BYTES), mimeType: 'audio/mp4' } }, ok, AUTH, { db, now: NOW });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.body, { transcript: 'blue dress size M' });
  assert.match(fetchCalls[0], /^https:\/\/api\.deepgram\.com\//);
  assert.equal(db.store.get(COUNTER).used, 2);

  fetchReply = async () => ({ ok: false, status: 400, json: async () => ({ err_msg: 'corrupt audio' }) });
  const bad = fakeRes();
  await handleTranscribe({ body: { action: 'transcribe', audioBase64: audio(1000), mimeType: 'audio/webm' } }, bad, AUTH, { db, now: NOW });
  assert.equal(bad.statusCode, 400);
  assert.equal(db.store.get(COUNTER).used, 2);
});
