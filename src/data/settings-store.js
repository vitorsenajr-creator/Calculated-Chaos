// Business settings in Firestore (data layer; v3.17.5,
// docs/modularization.md). Moved out of main.js unchanged: loading and
// saving `appSettings` (businesses/{bizId}/config/settings via bizDoc) and
// the ✨ AI usage counter that lives inside it.
//
// DEFAULT_SETTINGS shape and the pure read-only calculations
// (aiUsageRemaining/aiUsagePct/isScheduledResetDue) live in
// modules/settings.js. `appSettings` itself lives in modules/state.js
// (main.js sets it to DEFAULT_SETTINGS at startup) — loadSettings/
// resetAiCounter below reassign/mutate it via setAppSettings and persist it.
//
// Two rules here prevent real data loss (v3.13.96, CLAUDE.md): a failed
// read must never lead to a save, and every save merges.
import { bizDoc } from '../modules/biz.js';
import { appSettings, setAppSettings } from '../modules/state.js';
import {
  DEFAULT_SETTINGS,
  aiUsageRemaining as _aiUsageRemaining,
  aiUsagePct as _aiUsagePct,
  isScheduledResetDue,
} from '../modules/settings.js';
import { serverAiAllowance, noteAiCall } from './ai-allowance-store.js';

export async function loadSettings(){
  // Only true when the read itself succeeded (doc existed and parsed, OR
  // it genuinely doesn't exist yet — a real first-ever run). A thrown
  // error (offline blip, transient permission hiccup, etc.) must NEVER
  // be treated as "no settings yet" — see the 2026-09-16 bug below.
  let loadSucceeded = false;
  try{
    const { getDoc } = window.firestoreFns;
    const snap = await getDoc(bizDoc('config', 'settings'));
    if (snap.exists()){
      setAppSettings({ ...DEFAULT_SETTINGS, ...snap.data() });
      // Migration: renamed from poshmarkStandardText.
      if (!appSettings.listingStandardText && appSettings.poshmarkStandardText){
        appSettings.listingStandardText = appSettings.poshmarkStandardText;
      }
    }
    loadSucceeded = true;
  }catch(e){
    // Show local defaults so the app isn't stuck blank, but DO NOT persist
    // them below — a transient read failure used to fall into the
    // "first time ever" branch, which then called saveSettings() and
    // permanently overwrote her real saved settings with these defaults.
    console.error('Failed to load settings — showing local defaults without touching the saved copy:', e);
    setAppSettings({ ...DEFAULT_SETTINGS });
  }
  // Initialize period if first time — gated on the read having actually
  // succeeded, for the reason above.
  if (loadSucceeded && !appSettings.aiUsagePeriodStart){
    appSettings.aiUsagePeriodStart = new Date().toISOString();
    await saveSettings();
  }
  // Check if scheduled reset is due
  if (loadSucceeded) await checkScheduledReset();
}

export async function saveSettings(){
  try{
    const { setDoc } = window.firestoreFns;
    // merge:true — belt-and-suspenders alongside the loadSettings() fix
    // above: even if appSettings is ever incomplete in memory for some
    // other reason, a save can no longer blank out fields it doesn't
    // know about instead of actually overwriting them.
    await setDoc(bizDoc('config', 'settings'), appSettings, { merge: true });
  }catch(e){ console.error('Failed to save settings', e); }
}

// Saves only the given fields (v3.22.3, Goals), merged into the saved
// copy, and keeps them in memory. Writing just these fields means a
// session whose settings read failed can't overwrite the rest with
// defaults. Returns false when the write fails, so the caller can say so.
export async function saveSettingsFields(fields){
  try{
    const { setDoc } = window.firestoreFns;
    await setDoc(bizDoc('config', 'settings'), fields, { merge: true });
    Object.assign(appSettings, fields);
    return true;
  }catch(e){
    console.error('Failed to save settings', e);
    return false;
  }
}

async function checkScheduledReset(){
  if (isScheduledResetDue(appSettings)) await resetAiCounter('scheduled');
}

export async function resetAiCounter(type){
  appSettings.aiUsageCount = 0;
  appSettings.aiUsagePeriodStart = new Date().toISOString();
  await saveSettings();
  console.log(`AI counter reset (${type})`);
}

export async function incrementAiUsage(){
  noteAiCall();
  appSettings.aiUsageCount = (appSettings.aiUsageCount || 0) + 1;
  await saveSettings();
}

// A store with a server limit (v3.28.1) answers from the server's numbers,
// which are the ones enforced; any other store keeps its own counter.
export function aiUsageRemaining(){
  const s = serverAiAllowance();
  return s ? s.remaining : _aiUsageRemaining(appSettings);
}
export function aiUsagePct(){
  const s = serverAiAllowance();
  return s ? Math.min(100, Math.round((s.used / s.limit) * 100)) : _aiUsagePct(appSettings);
}
