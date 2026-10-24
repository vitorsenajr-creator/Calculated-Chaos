// The store's monthly AI allowance as the server sees it (v3.28.1).
// api/platform.js action ai_allowance answers from the store's monthly
// counter (api/_aiAllowance.js, v3.28.8), which is also what the server
// enforces. Here the
// app keeps the last answer so Settings → AI usage and the checks before
// an AI call (aiUsageRemaining in settings-store.js) show the same numbers.
//
// A store without a server limit (the migrated one) answers
// `limited: false`, and the app keeps its own counter as before.

import { jsonAuthHeaders } from '../modules/api-auth.js';

let current = null; // null = unknown or not limited

export function serverAiAllowance(){
  return current && current.limited ? current : null;
}

// Asks the server. Never throws: on failure the last answer stays.
export async function loadAiAllowance(){
  try{
    const res = await fetch('/api/platform', { method: 'POST', headers: await jsonAuthHeaders(), body: JSON.stringify({ action: 'ai_allowance' }) });
    if (!res.ok) return serverAiAllowance();
    const data = await res.json();
    current = data && data.limited ? {
      limited: true,
      limit: data.limit,
      used: data.used,
      remaining: data.remaining,
      month: data.month,
      resetsOn: data.resetsOn,
    } : null;
  }catch(e){
    console.warn('Could not read the AI allowance:', e);
  }
  return serverAiAllowance();
}

// After a successful AI call: count it here until the next load.
export function noteAiCall(){
  if (!current || !current.limited) return;
  current.used += 1;
  current.remaining = Math.max(0, current.limit - current.used);
}

// After the server refused a call (429 with aiLimit): it is used up.
export function noteAiLimitReached(aiLimit){
  if (!aiLimit || !current) return;
  current.used = Number(aiLimit.used) || current.limit;
  current.remaining = 0;
}
