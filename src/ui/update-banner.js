// "A new version is available" strip (UI layer; v3.20.2, reworked v3.25.1).
// Shown on top of everything, the sign-in screen included. It never
// reloads on its own, and Update waits while a dialog or an item form is
// open, so a half-filled form isn't lost.
import { watchForUpdates } from '../platform/app-update.js';

const BUSY_SELECTOR = 'dialog[open], .modal-overlay:not(.hidden)';

export function initUpdateBanner(){
  watchForUpdates(__BUILD_ID__, (served, { snooze }) => {
    if (document.getElementById('updateBanner')) return;
    const label = String(served.version || '').replace(/[^\w.-]/g, '');
    const bar = document.createElement('div');
    bar.id = 'updateBanner';
    bar.className = 'update-banner';
    bar.setAttribute('role', 'status');
    bar.innerHTML = `
      <span class="update-text" id="updateBannerText">A new version is available${label ? ` (${label})` : ''}.</span>
      <button type="button" class="update-btn" id="updateBannerReload">Update</button>
      <button type="button" class="update-close" id="updateBannerClose" aria-label="Not now">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>`;
    document.body.appendChild(bar);
    document.getElementById('updateBannerReload').addEventListener('click', () => {
      if (document.querySelector(BUSY_SELECTOR)){
        document.getElementById('updateBannerText').textContent =
          'Finish or close what you are working on, then tap Update.';
        return;
      }
      window.location.reload();
    });
    document.getElementById('updateBannerClose').addEventListener('click', () => {
      bar.remove();
      snooze();
    });
  });
}
