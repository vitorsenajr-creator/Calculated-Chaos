// The "new version" decisions (v3.25.1) — pure, no DOM, window, fetch or
// timers, so the rules can be tested in Node. The platform layer
// (src/platform/app-update.js) does the fetching and the timing.

// How often a visible app asks the server, and how long "Not now" hides
// the strip before it may show again.
export const CHECK_EVERY_MS = 15 * 60 * 1000;
export const SNOOZE_MS = 60 * 60 * 1000;

// True when the server serves a different build than the one running.
// Compares build ids, not version numbers, so a deploy without a
// APP_VERSION bump still counts. A version.json without a buildId (from a
// build older than this check) never triggers the strip.
export function isNewBuild(runningBuildId, served){
  if (!runningBuildId || !served || typeof served !== 'object') return false;
  const servedId = typeof served.buildId === 'string' ? served.buildId : '';
  return servedId !== '' && servedId !== runningBuildId;
}
