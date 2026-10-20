// "A new version is available" strip (UI layer; v3.20.2). Shown on top of
// everything, the sign-in screen included; it never reloads on its own,
// so a half-filled form isn't lost.
import { watchForUpdates } from '../platform/app-update.js';

export function initUpdateBanner(currentVersion){
  watchForUpdates(currentVersion, (newVersion) => {
    if (document.getElementById('updateBanner')) return;
    const bar = document.createElement('div');
    bar.id = 'updateBanner';
    bar.className = 'update-banner';
    bar.setAttribute('role', 'status');
    bar.innerHTML = `
      <span class="update-text">A new version is available (${newVersion.replace(/[^\w.-]/g, '')}).</span>
      <button type="button" class="update-btn" id="updateBannerReload">Update</button>
      <button type="button" class="update-close" id="updateBannerClose" aria-label="Not now">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>`;
    document.body.appendChild(bar);
    document.getElementById('updateBannerReload').addEventListener('click', () => window.location.reload());
    document.getElementById('updateBannerClose').addEventListener('click', () => bar.remove());
  });
}
