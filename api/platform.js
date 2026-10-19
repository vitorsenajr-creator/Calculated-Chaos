// /api/platform.js — platform-admin operations for the Developer Panel
// (admin.html), dispatched on `action`. This is the home for every future
// platform operation (creating businesses, AI credits, admin claims; see
// docs/multi-tenant.md) so they don't each need a new Vercel function: it
// took the LAST of the Hobby plan's 12 function slots (v3.15.4).
//
// POST body: { action, ... }
//
//   action: 'health'
//     -> checks that the server's Firebase Admin access works (service-
//        account key present and valid, right project, can verify the
//        caller's sign-in, can read Firestore).
//     Returns: { ok, checks: [{ name, ok, detail }] }
//
//   action: 'migrate_status'
//     -> read-only counts for the business migration (_migration.js):
//        root vs businesses/{bizId} per collection, the mapped single docs,
//        docs that wouldn't be copied, members.
//
//   action: 'migrate_copy', step, cursor
//     -> copies one step/page into businesses/{bizId} (copy, never move)
//        and returns the next { step, cursor }, or next: null when done.
//        After the switch only the members step ('setup') runs.
//
//   action: 'migrate_switch', live: true | false
//     -> turns the business data on for the app, server and rules
//        (businesses/{bizId}.live), or back off.
//
//   action: 'admin_claims' | 'admin_claims_sync'
//     -> the platform-admin custom claim (_adminClaims.js): who should be
//        an admin and who has the claim; sync gives it to the listed
//        accounts and removes it from any other.
//
// Platform admins only (PLATFORM_ADMIN_UIDS in _firebaseAdmin.js).

import { requireApprovedUser } from './_requireApprovedUser.js';
import { getFirebaseAdmin, isPlatformAdminUid, FIREBASE_PROJECT_ID } from './_firebaseAdmin.js';
import { migrationStatus, migrationCopy, migrationSwitch } from './_migration.js';
import { adminClaimsStatus, adminClaimsSync } from './_adminClaims.js';

async function handleHealth(auth){
  const checks = [];
  const admin = getFirebaseAdmin();
  checks.push({
    name: 'Service account key (FIREBASE_SERVICE_ACCOUNT)',
    ok: admin.ok,
    detail: admin.ok ? `Loaded for project ${admin.projectId} (${admin.clientEmail})` : admin.error,
  });
  checks.push({
    name: 'Sign-in verified by the server',
    ok: auth.via === 'admin',
    detail: auth.via === 'admin'
      ? 'Your sign-in token was verified with Firebase Admin.'
      : 'Using the older fallback check (Firebase Admin not available).',
  });
  if (admin.ok){
    try{
      const snap = await admin.db.collection('users').doc(auth.uid).get();
      checks.push({
        name: 'Firestore read with admin access',
        ok: snap.exists,
        detail: snap.exists ? 'Read your user record.' : 'Connected, but your user record was not found.',
      });
    }catch(e){
      checks.push({ name: 'Firestore read with admin access', ok: false, detail: e.message || String(e) });
    }
  }
  checks.push({ name: 'Firebase project', ok: true, detail: FIREBASE_PROJECT_ID });
  return { ok: checks.every(c => c.ok), checks };
}

export default async function handler(req, res){
  if (req.method !== 'POST'){
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireApprovedUser(req);
  if (!auth.ok){
    return res.status(auth.status).json({ error: auth.error });
  }
  if (!isPlatformAdminUid(auth.uid)){
    return res.status(403).json({ error: 'Platform admins only.' });
  }

  const { action } = req.body || {};
  try{
    if (action === 'health') return res.status(200).json(await handleHealth(auth));
    if (action === 'migrate_status' || action === 'migrate_copy' || action === 'migrate_switch'){
      const admin = getFirebaseAdmin();
      if (!admin.ok) return res.status(503).json({ error: admin.error });
      const result = action === 'migrate_status' ? await migrationStatus(admin.db)
        : action === 'migrate_copy' ? await migrationCopy(admin.db, auth, req.body || {})
        : await migrationSwitch(admin.db, auth, req.body || {});
      return res.status(result.ok ? 200 : result.status).json(result.ok ? result : { error: result.error });
    }
    if (action === 'admin_claims' || action === 'admin_claims_sync'){
      const admin = getFirebaseAdmin();
      if (!admin.ok) return res.status(503).json({ error: admin.error });
      const result = action === 'admin_claims' ? await adminClaimsStatus(admin.auth) : await adminClaimsSync(admin.auth);
      if (action === 'admin_claims_sync') console.log('admin-claims-sync', JSON.stringify({ by: auth.uid, admins: result.admins.map(a => a.uid) }));
      return res.status(200).json(result);
    }
    return res.status(400).json({ error: 'Unknown action' });
  }catch(err){
    console.error('platform function error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
