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
//   action: 'ebay_retire_main' (v3.28.9)
//     -> moves the old shared eBay connection, ebay_connections/main, to
//        ebay_connections/_retired_main_<date> (copy and delete in one
//        transaction). Nothing reads 'main' any more; this retires it.
//
//   action: 'admin_claims' | 'admin_claims_sync'
//     -> the platform-admin custom claim (_adminClaims.js): who should be
//        an admin and who has the claim; sync gives it to the listed
//        accounts and removes it from any other.
//
//   action: 'users_auth_info'
//     -> sign-in details per user (email verified, login disabled, last
//        sign-in), which only Firebase Admin can read (_users.js).
//
//   action: 'user_remove' | 'user_restore' | 'user_deny', uid
//     -> Remove disables the login (reversible, status 'removed'), Restore
//        undoes it, Deny deletes a pending request and its login.
//
//   action: 'employee_create', email, password
//     -> a Catalog-only login, approved and added to the caller's business.
//
//   action: 'ai_usage', month ('YYYY-MM', default this month in UTC)
//     -> the AI usage meter (_aiUsage.js): totals, per call type, per user
//        (e-mail, role, business) and tools, for the month.
//
//   action: 'app_check' | 'app_check_set', mode (v3.28.2)
//     -> how our functions treat the App Check token (_appCheck.js,
//        platform/appcheck): 'off', 'monitor' or 'enforce'.
//
//   action: 'self_serve' | 'self_serve_set', on (v3.28.0)
//     -> the self-serve sign-up switch (_business.js, platform/signup):
//        read it, or turn it on or off.
//
// Platform admins only (PLATFORM_ADMIN_UIDS in _firebaseAdmin.js), except
// the two sign-up actions (v3.28.0, _business.js), which any signed-in
// account may call, pending ones included:
//
//   action: 'signup_status'
//     -> { selfServe, hasBusiness }: whether a verified pending account
//        sees "Create your store" or "Awaiting approval".
//
//   action: 'ai_allowance' (v3.28.1, any approved account)
//     -> { limited, limit, used, remaining, allowed, month, resetsOn } for
//        the caller's store (_aiAllowance.js).
//
//   action: 'business_create', name, logo?, sellsOn?
//     -> creates the caller's store and approves the account, only while
//        the switch is on and the email is verified. Returns { bizId }.

import { requireApprovedUser } from './_requireApprovedUser.js';
import { getFirebaseAdmin, isPlatformAdminUid, FIREBASE_PROJECT_ID } from './_firebaseAdmin.js';
import { migrationStatus, migrationCopy, migrationSwitch, retireMainConnection } from './_migration.js';
import { adminClaimsStatus, adminClaimsSync } from './_adminClaims.js';
import { usersAuthInfo, userRemove, userRestore, userDeny, employeeCreate } from './_users.js';
import { aiUsageReport } from './_aiUsage.js';
import { verifySignedInUser, signupStatus, businessCreate, readSelfServe, selfServeSet } from './_business.js';
import { getAiAllowance } from './_aiAllowance.js';
import { readAppCheckMode, setAppCheckMode } from './_appCheck.js';
import { usageMonth } from '../src/domain/ai-usage.js';

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

  const { action } = req.body || {};

  // Sign-up actions (v3.28.0): the caller may still be pending, so they run
  // before the approved-user and admin checks, with their own token check.
  if (action === 'signup_status' || action === 'business_create'){
    try{
      const admin = getFirebaseAdmin();
      if (!admin.ok) return res.status(503).json({ error: 'Sign-up is not available right now. Try again later.' });
      const caller = await verifySignedInUser(admin, req);
      if (!caller.ok) return res.status(caller.status).json({ error: caller.error });
      const result = action === 'signup_status' ? await signupStatus(admin, caller) : await businessCreate(admin, caller, req.body || {});
      if (action === 'business_create') console.log('business-create', JSON.stringify({ uid: caller.uid, ok: result.ok, bizId: result.bizId || null, existing: !!result.existing }));
      return res.status(result.ok ? 200 : result.status).json(result.ok ? result : { error: result.error });
    }catch(err){
      console.error('platform sign-up error:', err);
      return res.status(500).json({ error: 'Something went wrong. Try again.' });
    }
  }

  const auth = await requireApprovedUser(req);
  if (!auth.ok){
    return res.status(auth.status).json({ error: auth.error });
  }
  // The caller's store AI allowance (v3.28.1), for Settings → AI usage. Any
  // approved account; not an admin action.
  if (action === 'ai_allowance'){
    try{
      const a = await getAiAllowance(auth);
      return res.status(200).json({ ok: true, ...a });
    }catch(err){
      console.error('ai-allowance-error', err);
      return res.status(503).json({ error: 'Could not read the AI allowance right now.' });
    }
  }
  if (!isPlatformAdminUid(auth.uid)){
    return res.status(403).json({ error: 'Platform admins only.' });
  }

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
    if (action === 'ebay_retire_main'){
      const admin = getFirebaseAdmin();
      if (!admin.ok) return res.status(503).json({ error: admin.error });
      const result = await retireMainConnection(admin.db, auth);
      console.log('ebay-retire-main', JSON.stringify({ by: auth.uid, ok: result.ok, to: result.retiredTo || null }));
      return res.status(result.ok ? 200 : result.status).json(result.ok ? result : { error: result.error });
    }
    if (action === 'admin_claims' || action === 'admin_claims_sync'){
      const admin = getFirebaseAdmin();
      if (!admin.ok) return res.status(503).json({ error: admin.error });
      const result = action === 'admin_claims' ? await adminClaimsStatus(admin.auth) : await adminClaimsSync(admin.auth);
      if (action === 'admin_claims_sync') console.log('admin-claims-sync', JSON.stringify({ by: auth.uid, admins: result.admins.map(a => a.uid) }));
      return res.status(200).json(result);
    }
    if (action === 'app_check' || action === 'app_check_set'){
      const admin = getFirebaseAdmin();
      if (!admin.ok) return res.status(503).json({ error: admin.error });
      if (action === 'app_check') return res.status(200).json({ ok: true, mode: await readAppCheckMode(admin.db, { fresh: true }) });
      const result = await setAppCheckMode(admin.db, auth, req.body || {});
      console.log('app-check-set', JSON.stringify({ by: auth.uid, mode: result.mode || null }));
      return res.status(result.ok ? 200 : result.status).json(result.ok ? result : { error: result.error });
    }
    if (action === 'self_serve' || action === 'self_serve_set'){
      const admin = getFirebaseAdmin();
      if (!admin.ok) return res.status(503).json({ error: admin.error });
      if (action === 'self_serve') return res.status(200).json({ ok: true, selfServe: await readSelfServe(admin.db) });
      const result = await selfServeSet(admin.db, auth, req.body || {});
      console.log('self-serve-set', JSON.stringify({ by: auth.uid, on: result.selfServe ?? null }));
      return res.status(result.ok ? 200 : result.status).json(result.ok ? result : { error: result.error });
    }
    if (action === 'ai_usage'){
      const admin = getFirebaseAdmin();
      if (!admin.ok) return res.status(503).json({ error: admin.error });
      const requested = String((req.body || {}).month || '');
      const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(requested) ? requested : usageMonth();
      return res.status(200).json(await aiUsageReport(admin.db, month));
    }
    const userActions = { user_remove: userRemove, user_restore: userRestore, user_deny: userDeny, employee_create: employeeCreate };
    if (action === 'users_auth_info' || userActions[action]){
      const admin = getFirebaseAdmin();
      if (!admin.ok) return res.status(503).json({ error: admin.error });
      const result = action === 'users_auth_info' ? await usersAuthInfo(admin) : await userActions[action](admin, auth, req.body || {});
      if (action !== 'users_auth_info') console.log('platform-user-action', JSON.stringify({ action, by: auth.uid, target: (req.body || {}).uid || null, ok: result.ok }));
      return res.status(result.ok ? 200 : result.status).json(result.ok ? result : { error: result.error });
    }
    return res.status(400).json({ error: 'Unknown action' });
  }catch(err){
    console.error('platform function error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
