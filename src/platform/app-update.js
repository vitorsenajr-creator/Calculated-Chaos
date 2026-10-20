// New-version check (platform layer; v3.20.2). Asks the server which
// version it serves (dist/version.json, written by vite.config.js) and
// reports it when it differs from the running copy. Runs at startup and
// whenever the app comes back to the foreground, at most once a minute.
const MIN_INTERVAL_MS = 60 * 1000;

export function watchForUpdates(currentVersion, onNewVersion){
  let lastCheck = 0;
  let reported = false;
  async function check(){
    if (reported || Date.now() - lastCheck < MIN_INTERVAL_MS) return;
    lastCheck = Date.now();
    try{
      const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return; // e.g. the dev server, which has no version.json
      const { version } = await res.json();
      if (version && version !== currentVersion){
        reported = true;
        onNewVersion(version);
      }
    }catch(e){ /* offline or blocked: try again next time */ }
  }
  check();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
}
