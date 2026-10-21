// AI usage meter (v3.24.5): records every successful Anthropic call per user,
// month, call type and model, and builds the report the Developer Panel shows
// (api/platform.js action 'ai_usage'). Server only: the ai_usage collection
// has no client rule, so Firebase Admin is the only writer and reader.
//
// Recording never fails the AI request: a metering error is logged and the
// answer still goes back to the person.

import { FieldValue } from 'firebase-admin/firestore';
import { getFirebaseAdmin } from './_firebaseAdmin.js';
import { usageMonth, usageDocId, usageIncrements, toolNamesFrom, summarizeUsage } from '../src/domain/ai-usage.js';

// Numbers become FieldValue.increment (nested maps, like tools, recurse).
function toIncrements(obj){
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    out[key] = value && typeof value === 'object' ? toIncrements(value) : FieldValue.increment(value);
  }
  return out;
}

// auth: the object _requireApprovedUser returns (uid, bizId).
// call: the call type (see AI_CALL_LABELS); model: the model that answered.
// usage and content: the Anthropic response's usage and content blocks.
export async function recordAiUsage({ auth, call, model, usage, content }){
  try {
    const admin = getFirebaseAdmin();
    if (!admin.ok) return;
    const month = usageMonth();
    const uid = auth?.uid || null;
    const id = usageDocId({ month, uid, call, model });
    const increments = usageIncrements({ usage, tools: toolNamesFrom(content) });
    await admin.db.collection('ai_usage').doc(id).set({
      month, uid, bizId: auth?.bizId || null, call, model: model || null,
      ...toIncrements(increments),
    }, { merge: true });
  } catch (err) {
    console.error('ai-usage-meter', err);
  }
}

// The month's report for the Developer Panel: totals, per call type, per user
// (with the e-mail and role from users/{uid}) and tools.
export async function aiUsageReport(db, month){
  const snap = await db.collection('ai_usage').where('month', '==', month).get();
  const rows = snap.docs.map(doc => doc.data());
  const uids = [...new Set(rows.map(row => row.uid).filter(Boolean))];
  const users = {};
  if (uids.length) {
    const docs = await db.getAll(...uids.map(uid => db.collection('users').doc(uid)));
    for (const doc of docs) {
      if (doc.exists) users[doc.id] = { email: doc.get('email') || null, role: doc.get('role') || null };
    }
  }
  const summary = summarizeUsage(rows);
  return {
    month,
    rowCount: rows.length,
    ...summary,
    byUser: summary.byUser.map(line => ({ ...line, email: users[line.uid]?.email || null, role: users[line.uid]?.role || null })),
  };
}
