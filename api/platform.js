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
// Platform admins only (PLATFORM_ADMIN_EMAILS in _firebaseAdmin.js).

import { requireApprovedUser } from './_requireApprovedUser.js';
import { getFirebaseAdmin, isPlatformAdminEmail, FIREBASE_PROJECT_ID } from './_firebaseAdmin.js';

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
  if (!isPlatformAdminEmail(auth.email)){
    return res.status(403).json({ error: 'Platform admins only.' });
  }

  const { action } = req.body || {};
  try{
    if (action === 'health') return res.status(200).json(await handleHealth(auth));
    return res.status(400).json({ error: 'Unknown action' });
  }catch(err){
    console.error('platform function error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
