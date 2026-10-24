// Monthly AI allowance, enforced on the server (v3.28.1). Not a route:
// every endpoint that calls Anthropic asks requireAiAllowance() first.
//
// The rule is in src/domain/ai-allowance.js: a business with
// `aiMonthlyLimit` on its doc may make that many AI calls per UTC month;
// the count is the ai_usage meter (api/_aiUsage.js), summed for the
// business and month. Businesses without the field (the migrated one) are
// not limited. An account without a live store gets no AI at all (v3.28.8):
// its calls would count against no store, so requireAiAllowance() answers
// 403 before any Anthropic call.
//
// A failure to read the limit or the meter lets the call through and logs
// `ai-allowance-error`: the meter is a soft cap until paid credits exist,
// and a broken read must not stop every store's AI. Two calls at the same
// moment can each pass at the last free slot, so a store can go one or two
// over; paid credits will need a reservation in a transaction instead.

import { getFirebaseAdmin } from './_firebaseAdmin.js';
import { NO_STORE_ERROR } from './_requireApprovedUser.js';
import { usageMonth } from '../src/domain/ai-usage.js';
import { businessAiLimit, usedCalls, allowanceOf, limitMessage } from '../src/domain/ai-allowance.js';

// auth: what _requireApprovedUser returns (bizId only for a live business).
export async function getAiAllowance(auth, { now = new Date() } = {}){
  const month = usageMonth(now);
  if (!auth || !auth.bizId) return allowanceOf({ limit: null, used: 0, month });
  const admin = getFirebaseAdmin();
  if (!admin.ok) throw new Error(admin.error);
  const biz = await admin.db.collection('businesses').doc(auth.bizId).get();
  const limit = businessAiLimit(biz.exists ? biz.data() : null);
  if (!limit) return allowanceOf({ limit: null, used: 0, month });
  const snap = await admin.db.collection('ai_usage')
    .where('bizId', '==', auth.bizId)
    .where('month', '==', month)
    .get();
  return allowanceOf({ limit, used: usedCalls(snap.docs.map(d => d.data())), month });
}

// Sends 403 and returns false for an account without a store, 429 and false
// when the business is at its limit; true otherwise (including when the
// check itself fails).
export async function requireAiAllowance(auth, res){
  if (!auth || !auth.bizId){
    console.log('ai-allowance-no-store', JSON.stringify({ uid: auth && auth.uid || null }));
    res.status(403).json({ error: NO_STORE_ERROR });
    return false;
  }
  let a;
  try{
    a = await getAiAllowance(auth);
  }catch(e){
    console.error('ai-allowance-error', JSON.stringify({ bizId: auth && auth.bizId, error: String(e && e.message || e) }));
    return true;
  }
  if (a.allowed) return true;
  console.log('ai-allowance-refused', JSON.stringify({ bizId: auth.bizId, uid: auth.uid, used: a.used, limit: a.limit, month: a.month }));
  res.status(429).json({ error: limitMessage(a), aiLimit: { used: a.used, limit: a.limit, resetsOn: a.resetsOn } });
  return false;
}
