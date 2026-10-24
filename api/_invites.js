// Store invitations (docs/multi-tenant.md step 5, v3.28.12). Not a route:
// api/platform.js calls these for the Developer Panel (list, add, remove),
// and api/_business.js reads an invite to let a verified, invited account
// create its store while self-serve sign-up is off.
//
// invites/{normalized email}: { email, createdAt, createdBy, usedAt?, usedBy?,
// bizId? }. Server only (firestore.rules: no client access); Firebase Admin
// ignores the rules, so api/platform.js only calls the admin actions for a
// platform admin.

import { normalizeInviteEmail, inviteState } from '../src/domain/new-business.js';

const COLLECTION = 'invites';
const err = (status, error) => ({ ok: false, status, error });

export const inviteRef = (db, email) => db.collection(COLLECTION).doc(email);

// The invite data for an email, or null (also for a bad email).
export async function readInvite(db, rawEmail){
  const email = normalizeInviteEmail(rawEmail);
  if (!email) return null;
  const snap = await inviteRef(db, email).get();
  return snap.exists ? snap.data() : null;
}

const publicInvite = (id, d) => ({
  email: d.email || id,
  state: inviteState(d),
  createdAt: d.createdAt || null,
  createdBy: d.createdBy || null,
  usedAt: d.usedAt || null,
  bizId: d.bizId || null,
});

export async function invitesList(db){
  const snap = await db.collection(COLLECTION).get();
  const invites = [];
  snap.forEach(doc => invites.push(publicInvite(doc.id, doc.data())));
  invites.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return { ok: true, invites };
}

// body: { email }. Adding an email that is already invited changes nothing.
export async function inviteAdd(db, caller, body){
  const email = normalizeInviteEmail(body && body.email);
  if (!email) return err(400, 'Enter a valid email address.');
  const ref = inviteRef(db, email);
  const snap = await ref.get();
  if (snap.exists){
    const d = snap.data();
    if (inviteState(d) === 'used') return err(409, `${email} already used its invite to create a store.`);
    return { ok: true, invite: publicInvite(email, d), existing: true };
  }
  const data = { email, createdAt: Date.now(), createdBy: caller.uid };
  await ref.set(data);
  return { ok: true, invite: publicInvite(email, data), existing: false };
}

// body: { email }. Removes the invite (a used one too: the store it made stays).
export async function inviteRemove(db, caller, body){
  const email = normalizeInviteEmail(body && body.email);
  if (!email) return err(400, 'Missing email.');
  await inviteRef(db, email).delete();
  return { ok: true, email };
}
