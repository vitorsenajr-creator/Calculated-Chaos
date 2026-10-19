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

// Override with the FIREBASE_PROJECT_ID env var; defaults to the current project.
export const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'calculated-chaos-4027a';

// Platform admins. Keep in sync with ADMIN_EMAILS in src/config/firebase.js
// and isAdmin() in firestore.rules.
export const PLATFORM_ADMIN_EMAILS = ['vitor.sena.jr@gmail.com', 'insuredbyjasmine@gmail.com'];
export const isPlatformAdminEmail = (email) => PLATFORM_ADMIN_EMAILS.includes(String(email || '').toLowerCase());

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
    return { ok: true, auth: getAuth(app), db: getFirestore(app), projectId: sa.project_id, clientEmail: sa.client_email };
  }catch(e){
    return { ok: false, error: `Firebase Admin could not start: ${e.message || e}` };
  }
}

// { ok:true, auth, db, projectId, clientEmail } or { ok:false, error }.
// Cached per function instance.
export function getFirebaseAdmin(){
  if (!cached) cached = load();
  return cached;
}
