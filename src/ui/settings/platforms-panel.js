// Settings → Platforms (UI layer; v3.17.6, docs/modularization.md): the
// platform list with flat or tiered fees, adding a custom platform, and
// "🔍 Suggest %". Moved out of main.js unchanged. Importing it registers
// window.addCustomPlatform.
import { jsonAuthHeaders } from '../../modules/api-auth.js';
import { appSettings } from '../../modules/state.js';
import { escapeHtml, uid } from '../../modules/format-utils.js';
import {
  getAllPlatforms as _getAllPlatforms,
  getPlatformLabel as _getPlatformLabel,
} from '../../modules/platforms.js';
import { saveSettings } from '../../data/settings-store.js';
import { showSaveMsg } from './forms.js';

function getAllPlatforms(){ return _getAllPlatforms(appSettings); }
function getPlatformLabel(key){ return _getPlatformLabel(appSettings, key); }

// ---------- PLATFORMS SETTINGS (Settings → Platforms) ----------
// Which platform's tiered-fee editor is expanded — survives re-renders
// triggered by editing a tier (module-level, resets on Settings reopen,
// which is fine, this is just an open/closed UI state).
let openFeeRulesPlatform = null;

export function renderPlatformsSettingsList(){
  const container = document.getElementById('platformsList');
  if (!container) return;
  const platforms = getAllPlatforms();
  container.innerHTML = platforms.map(p => {
    const rules = appSettings.platformFeeRules?.[p.key];
    const hasTiers = rules && rules.length > 0;
    const isOpen = openFeeRulesPlatform === p.key;
    return `
      <div style="padding:8px 0; border-bottom:1px solid var(--line);">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="flex:1; font-size:13px; font-weight:600; color:var(--plum);">${escapeHtml(p.label)}</span>
          ${hasTiers
          ? `<span style="font-size:11px; color:var(--sage-deep); font-weight:600;">🎚️ Tiered</span>`
          : `<input type="number" data-platform-fee="${p.key}" value="${p.feePct.toFixed(2)}" min="0" max="100" step="0.1" style="width:70px; padding:6px 8px; border:1px solid var(--line); border-radius:6px; font-size:13px;"><span style="font-size:12px; color:var(--plum-soft);">%</span>`}
          <button class="icon-btn" data-platform-rules-toggle="${p.key}" title="Tiered fees (e.g. a flat $ fee under a price, % above it)">🎚️</button>
          <button class="icon-btn" data-platform-suggest="${p.key}" title="Ask the AI for a current fee % estimate">🔍</button>
          ${p.builtIn ? '' : `<button class="icon-btn" data-platform-delete="${p.key}" style="color:var(--danger);" title="Remove this platform">🗑</button>`}
        </div>
        ${isOpen ? `
          <div style="margin-top:8px; padding:10px; background:var(--cream-soft); border-radius:10px;">
            <div style="font-size:11px; color:var(--plum-soft); margin-bottom:8px;">Fee = % of sale price + a flat $ amount, per tier. The last tier (no "up to") catches everything above the ones before it.</div>
            ${(rules || []).map((r, i) => `
              <div style="display:flex; align-items:center; gap:6px; margin-bottom:6px;">
                ${r.upTo === null || r.upTo === undefined
                ? `<span style="font-size:12px; color:var(--plum-soft); width:110px;">Above all tiers:</span>`
                : `<span style="font-size:12px; color:var(--plum-soft);">Up to $</span><input type="number" data-tier-upto="${p.key}:${i}" value="${r.upTo}" min="0" step="0.5" style="width:60px; padding:5px 6px; border:1px solid var(--line); border-radius:6px; font-size:12px;">`}
                <input type="number" data-tier-pct="${p.key}:${i}" value="${r.pct || 0}" min="0" max="100" step="0.1" style="width:55px; padding:5px 6px; border:1px solid var(--line); border-radius:6px; font-size:12px;"><span style="font-size:11px; color:var(--plum-soft);">% +</span>
                <input type="number" data-tier-flat="${p.key}:${i}" value="${r.flat || 0}" min="0" step="0.01" style="width:55px; padding:5px 6px; border:1px solid var(--line); border-radius:6px; font-size:12px;"><span style="font-size:11px; color:var(--plum-soft);">$ flat</span>
                <button class="icon-btn" data-tier-delete="${p.key}:${i}" style="color:var(--danger); padding:4px 8px;" title="Remove this tier">🗑</button>
              </div>
            `).join('')}
            <div style="display:flex; gap:8px; margin-top:8px;">
              <button class="icon-btn" data-add-tier="${p.key}">+ Add tier</button>
              ${hasTiers ? `<button class="icon-btn" data-clear-tiers="${p.key}" style="color:var(--danger);">Use flat % instead</button>` : ''}
            </div>
          </div>
        ` : ''}
      </div>
    `;}).join('');

  container.querySelectorAll('[data-platform-fee]').forEach(input => {
    input.addEventListener('change', async () => {
      const key = input.dataset.platformFee;
      const pct = parseFloat(input.value);
      if (isNaN(pct) || pct < 0) return;
      const platform = getAllPlatforms().find(p => p.key === key);
      if (platform.builtIn){
        appSettings.platformFeeOverrides = { ...appSettings.platformFeeOverrides, [key]: pct / 100 };
      } else {
        appSettings.customPlatforms = appSettings.customPlatforms.map(p => p.key === key ? { ...p, feePct: pct } : p);
      }
      await saveSettings();
      showSaveMsg('platformsSaveMsg');
    });
  });
  container.querySelectorAll('[data-platform-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Remove "${getPlatformLabel(btn.dataset.platformDelete)}"? Items already tagged with it keep the tag, but it won't show up as an option anymore.`)) return;
      appSettings.customPlatforms = appSettings.customPlatforms.filter(p => p.key !== btn.dataset.platformDelete);
      await saveSettings();
      renderPlatformsSettingsList();
      showSaveMsg('platformsSaveMsg');
    });
  });
  container.querySelectorAll('[data-platform-suggest]').forEach(btn => {
    btn.addEventListener('click', () => suggestPlatformFee(btn.dataset.platformSuggest));
  });
  container.querySelectorAll('[data-platform-rules-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.platformRulesToggle;
      openFeeRulesPlatform = openFeeRulesPlatform === key ? null : key;
      renderPlatformsSettingsList();
    });
  });
  container.querySelectorAll('[data-add-tier]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.addTier;
      const existing = appSettings.platformFeeRules?.[key] || [];
      // New tier goes in just before the catch-all (no-limit) one, if
      // there is one, with a starting threshold that doesn't collide.
      const lastFiniteUpTo = existing.filter(r => r.upTo !== null && r.upTo !== undefined).reduce((m,r) => Math.max(m, r.upTo), 0);
      const newTier = { upTo: lastFiniteUpTo > 0 ? lastFiniteUpTo + 10 : 15, pct: 0, flat: 0 };
      const catchAllIdx = existing.findIndex(r => r.upTo === null || r.upTo === undefined);
      const updated = catchAllIdx >= 0
        ? [...existing.slice(0, catchAllIdx), newTier, ...existing.slice(catchAllIdx)]
        : [...existing, newTier, { upTo: null, pct: 0, flat: 0 }];
      appSettings.platformFeeRules = { ...appSettings.platformFeeRules, [key]: updated };
      await saveSettings();
      renderPlatformsSettingsList();
      showSaveMsg('platformsSaveMsg');
    });
  });
  container.querySelectorAll('[data-tier-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const [key, idxStr] = btn.dataset.tierDelete.split(':');
      const idx = parseInt(idxStr, 10);
      const updated = (appSettings.platformFeeRules?.[key] || []).filter((_, i) => i !== idx);
      appSettings.platformFeeRules = { ...appSettings.platformFeeRules, [key]: updated };
      await saveSettings();
      renderPlatformsSettingsList();
      showSaveMsg('platformsSaveMsg');
    });
  });
  container.querySelectorAll('[data-clear-tiers]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.clearTiers;
      if (!confirm(`Switch "${getPlatformLabel(key)}" back to a single flat %? Its tiers will be discarded.`)) return;
      appSettings.platformFeeRules = { ...appSettings.platformFeeRules, [key]: [] };
      await saveSettings();
      renderPlatformsSettingsList();
      showSaveMsg('platformsSaveMsg');
    });
  });
  const tierFieldHandler = (selector, field, parseFn) => {
    container.querySelectorAll(selector).forEach(input => {
      input.addEventListener('change', async () => {
        const [key, idxStr] = input.dataset[field].split(':');
        const idx = parseInt(idxStr, 10);
        const val = parseFn(input.value);
        if (val === null) return;
        const updated = (appSettings.platformFeeRules?.[key] || []).map((r, i) => i === idx ? { ...r, [field === 'tierUpto' ? 'upTo' : field === 'tierPct' ? 'pct' : 'flat']: val } : r);
        appSettings.platformFeeRules = { ...appSettings.platformFeeRules, [key]: updated };
        await saveSettings();
        showSaveMsg('platformsSaveMsg');
      });
    });
  };
  tierFieldHandler('[data-tier-upto]', 'tierUpto', v => { const n = parseFloat(v); return isNaN(n) || n < 0 ? null : n; });
  tierFieldHandler('[data-tier-pct]', 'tierPct', v => { const n = parseFloat(v); return isNaN(n) || n < 0 ? null : n; });
  tierFieldHandler('[data-tier-flat]', 'tierFlat', v => { const n = parseFloat(v); return isNaN(n) || n < 0 ? null : n; });
}

window.addCustomPlatform = async function(){
  const nameInput = document.getElementById('sNewPlatformName');
  const feeInput = document.getElementById('sNewPlatformFee');
  const name = nameInput.value.trim();
  const feePct = parseFloat(feeInput.value);
  if (!name){ alert('Enter a platform name.'); return; }
  if (isNaN(feePct) || feePct < 0){ alert('Enter a valid fee percentage.'); return; }
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '') || uid();
  if (getAllPlatforms().some(p => p.key === key)){ alert('A platform with that name already exists.'); return; }
  appSettings.customPlatforms = [...(appSettings.customPlatforms || []), { key, label: name, emoji: '', color: '#8A7E82', feePct }];
  await saveSettings();
  nameInput.value = '';
  feeInput.value = '';
  renderPlatformsSettingsList();
  showSaveMsg('platformsSaveMsg');
};

// Asks the AI for a rough current fee % estimate for a given platform —
// informational only, she reviews/edits the number before it's saved.
// Requires ANTHROPIC_API_KEY to be configured on the server; fails
// gracefully with a clear message if it isn't (yet).
async function suggestPlatformFee(platformKey){
  const btn = document.querySelector(`[data-platform-suggest="${platformKey}"]`);
  const input = document.querySelector(`[data-platform-fee="${platformKey}"]`);
  if (!btn || !input) return;
  const originalText = btn.textContent;
  btn.textContent = '⏳';
  btn.disabled = true;
  try{
    const label = getPlatformLabel(platformKey).replace(/^\p{Emoji}\s*/u, '');
    const res = await fetch('/api/ebay-item-aspects', {
      method: 'POST',
      headers: await jsonAuthHeaders(),
      body: JSON.stringify({ mode: 'suggest_fee', platformName: label })
    });
    const data = await res.json();
    if (!res.ok || !data.feePct){
      alert(`Couldn't get a suggestion: ${data.error || 'unknown error'}`);
      return;
    }
    input.value = data.feePct.toFixed(2);
    input.dispatchEvent(new Event('change'));
  }catch(e){
    alert("Couldn't reach the AI right now. Please try again.");
  }finally{
    btn.textContent = originalText;
    btn.disabled = false;
  }
}
