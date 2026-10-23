// Server-side Firebase Admin access (v3.15.4). Not a route: the leading
// underscore keeps Vercel from deploying it as a function.
//
// Reads the service-account key from the FIREBASE_SERVICE_ACCOUNT env var
// (the whole .json file Firebase Console → Project settings → Service
// accounts → "Generate new private key" downloads). With it the server can
// verify sign-in tokens itself and read/write Firestore with admin rights,
// which later work needs (server-only eBay tokens, AI credits, businesses).
//
// Never throws: callers get { ok:false, error } and decide what to do, so a
// missing or broken key can't take the whole app down.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getAppCheck } from 'firebase-admin/app-check';

// Override with the FIREBASE_PROJECT_ID env var; defaults to the current project.
export const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'calculated-chaos-4027a';

// Platform admins, by Firebase Auth uid (v3.18.1): Vitor and Jasmine (two,
// so one can recover the other). A uid can't be claimed by signing up with
// someone's email, unlike the email list this replaced. The rules and the
// app don't read this list: "Sync admin access" in the Developer Panel
// copies it onto the accounts as the platformAdmin claim
// (_adminClaims.js), so after changing it, run that sync.
export const PLATFORM_ADMIN_UIDS = [
  'TpE1hmofirMzGSPE6C8arBl9eGi2', // vitor.sena.jr@gmail.com
  'O7TKdj6AYKOCMcc998ioaYM1Y0o2', // insuredbyjasmine@gmail.com
];
export const isPlatformAdminUid = (uid) => PLATFORM_ADMIN_UIDS.includes(uid);

const APP_NAME = 'calculated-chaos-admin';
let cached = null;

function load(){
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw || !raw.trim()){
    return { ok: false, error: 'FIREBASE_SERVICE_ACCOUNT is not set in Vercel.' };
  }
  let sa;
  try{
    sa = JSON.parse(raw);
  }catch(e){
    return { ok: false, error: 'FIREBASE_SERVICE_ACCOUNT is not valid JSON. Paste the whole downloaded .json file, from { to }.' };
  }
  const missing = ['project_id', 'client_email', 'private_key'].filter(k => !sa || !sa[k]);
  if (missing.length){
    return { ok: false, error: `FIREBASE_SERVICE_ACCOUNT is missing: ${missing.join(', ')}. Paste the whole downloaded .json file.` };
  }
  if (sa.project_id !== FIREBASE_PROJECT_ID){
    return { ok: false, error: `FIREBASE_SERVICE_ACCOUNT belongs to project "${sa.project_id}", but the app uses "${FIREBASE_PROJECT_ID}".` };
  }
  // Some copy-paste paths leave the key's line breaks as literal "\n".
  const privateKey = String(sa.private_key).replace(/\\n/g, '\n');
  try{
    const app = getApps().find(a => a.name === APP_NAME) || initializeApp({
      credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey }),
      projectId: sa.project_id,
    }, APP_NAME);
    return { ok: true, auth: getAuth(app), db: getFirestore(app), appCheck: getAppCheck(app), projectId: sa.project_id, clientEmail: sa.client_email };
  }catch(e){
    return { ok: false, error: `Firebase Admin could not start: ${e.message || e}` };
  }
}

// { ok:true, auth, db, appCheck, projectId, clientEmail } or { ok:false, error }.
// Cached per function instance.
export function getFirebaseAdmin(){
  if (!cached) cached = load();
  return cached;
}
