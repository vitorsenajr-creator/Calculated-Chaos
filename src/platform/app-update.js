// New-version check (platform layer; v3.20.2, reworked v3.25.1). Asks the
// server which build it serves (dist/version.json, written by
// vite.config.js) and reports it when it differs from the running copy.
// Runs at startup, when the app comes back to the foreground, and every
// CHECK_EVERY_MS while it stays visible; at most once a minute. After
// snooze() the report waits SNOOZE_MS before it can come back.
import { CHECK_EVERY_MS, SNOOZE_MS, isNewBuild } from '../domain/update-check.js';

const MIN_INTERVAL_MS = 60 * 1000;

export function watchForUpdates(runningBuildId, onNewBuild){
  let lastCheck = 0;
  let shown = false;     // the strip is up; no need to ask again
  let snoozedUntil = 0;  // "Not now" was tapped; stay quiet until then

  async function check(){
    if (shown || Date.now() < snoozedUntil) return;
    if (Date.now() - lastCheck < MIN_INTERVAL_MS) return;
    lastCheck = Date.now();
    try{
      const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return; // e.g. the dev server, which has no version.json
      const served = await res.json();
      if (isNewBuild(runningBuildId, served)){
        shown = true;
        onNewBuild(served, { snooze });
      }
    }catch(e){ /* offline or blocked: try again next time */ }
  }

  function snooze(){
    shown = false;
    snoozedUntil = Date.now() + SNOOZE_MS;
  }

  check();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') check();
  }, CHECK_EVERY_MS);
}
