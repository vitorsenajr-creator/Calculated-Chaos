  // The Firebase SDK comes from npm (firebase@10.13.0, pinned), so the build
  // keeps only the functions used here. It used to load from the gstatic CDN
  // as four files that could not be trimmed (v3.26.10).
  import { initializeApp } from "firebase/app";
  import {
    getFirestore, collection, doc, getDocs, getDoc, setDoc, updateDoc, deleteDoc,
    query, where, runTransaction, writeBatch, onSnapshot
  } from "firebase/firestore";
  import {
    getStorage, ref, uploadString, getDownloadURL
  } from "firebase/storage";
  import {
    getAuth, setPersistence, browserLocalPersistence, onAuthStateChanged,
    signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, sendEmailVerification,
    GoogleAuthProvider, signInWithPopup, signInWithRedirect,
    sendPasswordResetEmail
  } from "firebase/auth";
  import { initializeAppCheck, ReCaptchaEnterpriseProvider, getToken } from "firebase/app-check";
  import { APP_CHECK_SITE_KEY } from "./app-check.js";

  const firebaseConfig = {
    apiKey: "AIzaSyBvifh470V63Xi_HrGWL8lyyubjPdw1zGo",
    authDomain: "calculated-chaos-4027a.firebaseapp.com",
    projectId: "calculated-chaos-4027a",
    storageBucket: "calculated-chaos-4027a.firebasestorage.app",
    messagingSenderId: "1084070604336",
    appId: "1:1084070604336:web:365b8c2638a6c3016307f5"
  };

  const app = initializeApp(firebaseConfig);

  // ---------- App Check (v3.28.2) ----------
  // Started before Firestore, Auth and Storage so their requests carry the
  // token once the Console enforces it. Off while no site key is set
  // (src/config/app-check.js). window.appCheckToken() gives the current token
  // for our own /api calls (modules/api-auth.js), or null.
  let appCheck = null;
  if (APP_CHECK_SITE_KEY){
    try{
      appCheck = initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY),
        isTokenAutoRefreshEnabled: true,
      });
    }catch(err){
      console.error('App Check could not start:', err);
    }
  }
  window.appCheckToken = async () => {
    if (!appCheck) return null;
    try{
      const r = await getToken(appCheck, false);
      return r && r.token ? r.token : null;
    }catch(err){
      console.warn('App Check token unavailable:', err);
      return null;
    }
  };
  window.db = getFirestore(app);
  window.firestoreFns = { collection, doc, getDocs, getDoc, setDoc, updateDoc, deleteDoc, query, where, runTransaction, writeBatch, onSnapshot };
  window.storage = getStorage(app);
  window.storageFns = { ref, uploadString, getDownloadURL };

  // ---------- Auth ----------
  // Platform admins are recognized by the platformAdmin claim in their
  // sign-in token (src/modules/admin-claim.js), not by email (v3.18.1).
  window.auth = getAuth(app);
  window.authFns = { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, sendEmailVerification, GoogleAuthProvider, signInWithPopup, signInWithRedirect, sendPasswordResetEmail };
  // Keeps the session on this device/browser until an explicit sign-out —
  // this is what lets a home-screen shortcut stay logged in indefinitely.
  setPersistence(window.auth, browserLocalPersistence).catch(err => console.error('Auth persistence error:', err));

  window.firebaseReady = true;