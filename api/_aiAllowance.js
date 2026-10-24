// Monthly AI allowance, enforced on the server (v3.28.1). Not a route:
// every endpoint that calls Anthropic or Deepgram asks requireAiAllowance()
// first.
//
// The rule is in src/domain/ai-allowance.js: a business with
// `aiMonthlyLimit` on its doc may make that many AI calls per UTC month.
// Businesses without the field (the migrated one) are not limited. An
// account without a live store gets no AI at all (v3.28.9): its calls would
// count against no store, so requireAiAllowance() answers 403 before any
// Anthropic or Deepgram call.
//
// Reservation (v3.28.14): the count lives in one counter doc per store and
// month, `ai_allowance/{bizId}__{month}` (server only, like ai_usage). A
// transaction checks it and adds one unit before the call, so two calls on
// the last free slot can't both pass; the caller hands the unit back with
// release() when the upstream call fails. A month with no counter yet starts
// from the ai_usage meter (the calls made before v3.28.14). The meter keeps
// recording every successful call for the Developer Panel.
//
// When Firestore fails (Vitor, 2026-10-24: refuse only stores with a limit):
// - the store's limit can't be read: the call goes through and logs
//   `ai-allowance-error` (a store without a limit, like the migrated one,
//   must never lose its AI to a hiccup, and here we can't tell which it is);
// - the limit is known but the counter can't be reserved: the call is
//   refused with 503 (ALLOWANCE_UNAVAILABLE) rather than run unmetered.

import { getFirebaseAdmin } from './_firebaseAdmin.js';
import { NO_STORE_ERROR } from './_requireApprovedUser.js';
import { usageMonth } from '../src/domain/ai-usage.js';
import { businessAiLimit, usedCalls, allowanceOf, limitMessage, allowanceDocId, counterUsed } from '../src/domain/ai-allowance.js';

export const ALLOWANCE_UNAVAILABLE = "Couldn't check your store's AI allowance right now. Try again in a minute.";

const NOTHING_HELD = Object.freeze({ reserved: false, release: async () => {} });

function adminDb(db){
  if (db) return db;
  const admin = getFirebaseAdmin();
  if (!admin.ok) throw new Error(admin.error);
  return admin.db;
}

function meterQuery(db, bizId, month){
  return db.collection('ai_usage').where('bizId', '==', bizId).where('month', '==', month);
}

async function limitOf(db, bizId){
  const biz = await db.collection('businesses').doc(bizId).get();
  return businessAiLimit(biz.exists ? biz.data() : null);
}

// auth: what _requireApprovedUser returns (bizId only for a live business).
// For Settings → AI usage: the counter when the month has one, else the meter.
export async function getAiAllowance(auth, { now = new Date(), db } = {}){
  const month = usageMonth(now);
  if (!auth || !auth.bizId) return allowanceOf({ limit: null, used: 0, month });
  db = adminDb(db);
  const limit = await limitOf(db, auth.bizId);
  if (!limit) return allowanceOf({ limit: null, used: 0, month });
  const counter = await db.collection('ai_allowance').doc(allowanceDocId(auth.bizId, month)).get();
  if (counter.exists) return allowanceOf({ limit, used: counterUsed(counter.data()), month });
  const snap = await meterQuery(db, auth.bizId, month).get();
  return allowanceOf({ limit, used: usedCalls(snap.docs.map(d => d.data())), month });
}

// Takes one unit for the call. Returns { allowance, reserved, release }:
// reserved is false when the store has no limit or is at it (then
// allowance.limited says which); allowance counts the unit just taken.
// Throws when Firestore can't be read; the error carries limitUnknown=true
// when even the store's limit couldn't be read.
export async function reserveAiUnit(auth, { now = new Date(), db } = {}){
  const month = usageMonth(now);
  if (!auth || !auth.bizId) return { allowance: allowanceOf({ limit: null, used: 0, month }), ...NOTHING_HELD };
  const bizId = auth.bizId;
  let limit;
  try{
    db = adminDb(db);
    limit = await limitOf(db, bizId);
  }catch(e){
    e.limitUnknown = true;
    throw e;
  }
  if (!limit) return { allowance: allowanceOf({ limit: null, used: 0, month }), ...NOTHING_HELD };

  const ref = db.collection('ai_allowance').doc(allowanceDocId(bizId, month));
  const result = await db.runTransaction(async (tx) => {
    const counter = await tx.get(ref);
    let used;
    if (counter.exists) used = counterUsed(counter.data());
    else used = usedCalls((await tx.get(meterQuery(db, bizId, month))).docs.map(d => d.data()));
    const before = allowanceOf({ limit, used, month });
    if (!before.allowed) return { allowance: before, reserved: false };
    tx.set(ref, { bizId, month, used: used + 1, updatedAt: now }, { merge: true });
    return { allowance: allowanceOf({ limit, used: used + 1, month }), reserved: true };
  });
  if (!result.reserved) return { ...result, release: NOTHING_HELD.release };

  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    try{
      await db.runTransaction(async (tx) => {
        const counter = await tx.get(ref);
        if (!counter.exists) return;
        tx.set(ref, { used: Math.max(0, counterUsed(counter.data()) - 1), updatedAt: new Date() }, { merge: true });
      });
    }catch(e){
      console.error('ai-allowance-release-error', JSON.stringify({ bizId, month, error: String(e && e.message || e) }));
    }
  };
  return { ...result, release };
}

// Sends 403 (no store), 429 (at the limit) or 503 (a limited store's
// counter couldn't be reserved) and returns false; otherwise returns the
// reservation, whose release() the caller must await when the upstream call
// fails.
export async function requireAiAllowance(auth, res, opts = {}){
  if (!auth || !auth.bizId){
    console.log('ai-allowance-no-store', JSON.stringify({ uid: auth && auth.uid || null }));
    res.status(403).json({ error: NO_STORE_ERROR });
    return false;
  }
  let r;
  try{
    r = await reserveAiUnit(auth, opts);
  }catch(e){
    const limitUnknown = !!(e && e.limitUnknown);
    console.error('ai-allowance-error', JSON.stringify({ bizId: auth.bizId, refused: !limitUnknown, error: String(e && e.message || e) }));
    if (limitUnknown) return NOTHING_HELD;
    res.status(503).json({ error: ALLOWANCE_UNAVAILABLE });
    return false;
  }
  if (r.reserved || !r.allowance.limited) return r;
  const a = r.allowance;
  console.log('ai-allowance-refused', JSON.stringify({ bizId: auth.bizId, uid: auth.uid, used: a.used, limit: a.limit, month: a.month }));
  res.status(429).json({ error: limitMessage(a), aiLimit: { used: a.used, limit: a.limit, resetsOn: a.resetsOn } });
  return false;
}
