import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
  import {
    getFirestore, collection, doc, getDocs, getDoc, setDoc, deleteDoc
  } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
  import {
    getStorage, ref, uploadString, getDownloadURL
  } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";
  import {
    getAuth, setPersistence, browserLocalPersistence, onAuthStateChanged,
    signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut
  } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

  const firebaseConfig = {
    apiKey: "AIzaSyBvifh470V63Xi_HrGWL8lyyubjPdw1zGo",
    authDomain: "calculated-chaos-4027a.firebaseapp.com",
    projectId: "calculated-chaos-4027a",
    storageBucket: "calculated-chaos-4027a.firebasestorage.app",
    messagingSenderId: "1084070604336",
    appId: "1:1084070604336:web:365b8c2638a6c3016307f5"
  };

  const app = initializeApp(firebaseConfig);
  window.db = getFirestore(app);
  window.firestoreFns = { collection, doc, getDocs, getDoc, setDoc, deleteDoc };
  window.storage = getStorage(app);
  window.storageFns = { ref, uploadString, getDownloadURL };

  // ---------- Auth ----------
  // These accounts are treated as admin — able to approve/deny new sign-ups
  // from the "Authorize access" panel in Settings. This list must be kept in
  // sync with the isAdmin() function in the Firestore security rules
  // (Firebase Console → Firestore Database → Rules) — the client-side check
  // here only controls what's shown in the UI; the rules are what actually
  // enforce it server-side. See README for the rules text.
  window.ADMIN_EMAILS = ['vitor.sena.jr@gmail.com', 'insuredbyjasmine@gmail.com'];
  window.isAdminEmail = (email) => window.ADMIN_EMAILS.includes((email || '').toLowerCase());
  window.auth = getAuth(app);
  window.authFns = { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut };
  // Keeps the session on this device/browser until an explicit sign-out —
  // this is what lets a home-screen shortcut stay logged in indefinitely.
  setPersistence(window.auth, browserLocalPersistence).catch(err => console.error('Auth persistence error:', err));

  // Lets the admin create a login for an employee (Catalog-only access —
  // see applyRoleRestrictions() in main.js) WITHOUT getting signed out of
  // their own session. createUserWithEmailAndPassword on the primary
  // `window.auth` would normally sign the admin's browser in as the new
  // user instead — Firebase's own documented workaround is to run it on a
  // throwaway secondary App instance, then tear that instance down. The
  // Firestore write for the new user's doc still goes through the PRIMARY
  // app (window.db), which is still authenticated as the admin.
  window.createEmployeeAccount = async function(email, password){
    let secondaryApp;
    try{
      secondaryApp = initializeApp(firebaseConfig, `secondary-${Date.now()}`);
      const secondaryAuth = getAuth(secondaryApp);
      const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
      await setDoc(doc(window.db, 'users', cred.user.uid), {
        email, status: 'approved', role: 'employee', createdAt: Date.now(),
      });
      await signOut(secondaryAuth);
      return { ok: true };
    }catch(e){
      return { ok: false, error: e.message || String(e) };
    }finally{
      if (secondaryApp){ await deleteApp(secondaryApp).catch(() => {}); }
    }
  };

  window.firebaseReady = true;