// The Settings screen (UI layer; v3.17.6, docs/modularization.md).
// renderSettings() rebuilds the whole screen from appSettings on every
// call, then fills in the panels that load their own data. The buttons in
// its template call the window.* handlers registered by the other files
// in this folder.
//
// Since v3.22.0 the sections are grouped: an index (Account, Appearance,
// Pricing & platforms, ...) opens one group at a time; on desktop the
// index stays on the left. Every group is still rendered and only the
// open one is visible, so every id the handlers and ebay-api.js look up
// (e.g. #ebayConnectionStatus) is always in the page, as before.
import { appSettings } from '../../modules/state.js';
import { escapeHtml } from '../../modules/format-utils.js';
import { aiUsageRemaining, aiUsagePct } from '../../data/settings-store.js';
import { renderAuthorizeAccessPanel, renderEmployeeAccountsPanel, createEmployeeLogin } from './admin-panels.js';
import { isPlatformAdmin } from '../../modules/admin-claim.js';
import { sendVerificationEmail, refreshEmailVerified } from '../../modules/email-verification.js';
import { renderEbayConnectionStatus } from './ebay-panel.js';
import { renderPlatformsSettingsList } from './platforms-panel.js';
import { getAllPlatforms } from '../../modules/platforms.js';
import { APP_VERSION, APP_VERSION_DATE } from '../../modules/version.js';
import { THEMES, normalizeTheme, applyAccent } from '../theme.js';
import { ACCENT_PRESETS, isHexColor } from '../../domain/accent.js';
import { shrinkImageToDataUrl } from '../../platform/images.js';
import { warningsPageHtml, wireWarningsPanel, warningsSummary } from './warnings-panel.js';

const GROUP_KEY = 'cc.settings.group';
const DESKTOP = '(min-width: 900px)';
const CARRIER_LABEL = { usps_ground: 'USPS Ground Advantage', usps_priority: 'USPS Priority Mail', ups_ground: 'UPS Ground' };
const CHEVRON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
// A saved logo is a small data: URL (≤256 px); this caps what a save may
// add to the settings doc (Firestore allows 1 MB per document).
const MAX_LOGO_CHARS = 200000;
const BACK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>';

// The open group; null on the phone means the index is showing.
let currentGroup = null;

function storedGroup(){
  try{ return localStorage.getItem(GROUP_KEY) || 'account'; }catch(e){ return 'account'; }
}
function storeGroup(g){
  try{ localStorage.setItem(GROUP_KEY, g); }catch(e){ /* not remembered */ }
}
function isDesktop(){
  return typeof window.matchMedia === 'function' && window.matchMedia(DESKTOP).matches;
}

// The index, in order, under its headings. Team is for platform admins.
function settingsGroups(){
  const remaining = aiUsageRemaining();
  const limit = appSettings.aiUsageLimit || 500;
  const theme = THEMES.find(t => t.key === normalizeTheme(appSettings.theme));
  const carrier = CARRIER_LABEL[appSettings.defaultCarrier] || appSettings.defaultCarrier || CARRIER_LABEL.usps_ground;
  const platformCount = getAllPlatforms(appSettings).length;
  return [
    { heading: 'You', groups: [
      { key: 'account', title: 'Account', summary: window.auth.currentUser?.email || '' },
      { key: 'appearance', title: 'Appearance', summary: [(appSettings.storeName || '').trim(), theme ? theme.label : ''].filter(Boolean).join(' · ') },
    ] },
    { heading: 'Business', groups: [
      { key: 'pricing', title: 'Pricing & platforms', summary: `${appSettings.targetMarginPct || 40}% margin · ${platformCount} platform${platformCount === 1 ? '' : 's'}` },
      { key: 'shipping', title: 'Shipping', summary: `${carrier} · ${appSettings.sellerPaysShipping ? 'you pay' : 'buyer pays'}` },
      { key: 'listings', title: 'Listings', summary: appSettings.listingStandardText ? 'Closing text set' : 'No closing text yet' },
      { key: 'warnings', title: 'Warnings', summary: warningsSummary() },
      { key: 'labels', title: 'Labels', summary: `${appSettings.labelWidthIn || 2.25} × ${appSettings.labelHeightIn || 1.25} in` },
      { key: 'ai', title: 'AI usage', summary: `${limit - remaining} of ${limit} used` },
      ...(isPlatformAdmin() ? [{ key: 'team', title: 'Team', summary: 'Employee logins' }] : []),
    ] },
    { heading: 'Integrations', groups: [
      { key: 'ebay', title: 'eBay', summary: 'Connection, sales and tools' },
    ] },
    { heading: 'Data', groups: [
      { key: 'data', title: 'Data', summary: 'Duplicate check · exports' },
    ] },
  ];
}

// Opens a group (or the index, with null) without rebuilding the screen.
function showGroup(group){
  const view = document.getElementById('settingsView');
  if (!view) return;
  currentGroup = group;
  if (group) storeGroup(group);
  view.querySelector('.settings-layout')?.classList.toggle('has-group', !!group);
  view.querySelectorAll('[data-settings-page]').forEach(page => {
    page.hidden = page.dataset.settingsPage !== group;
  });
  view.querySelectorAll('[data-settings-group]').forEach(btn => {
    if (btn.dataset.settingsGroup === group) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
}

function isLogo(v){
  return typeof v === 'string' && v.startsWith('data:image/');
}

// Says when the accent was darkened or lightened for contrast.
function accentNote(){
  if (!isHexColor(appSettings.accentColor)) return "Using the theme's own colors.";
  const root = document.documentElement.style;
  const applied = [root.getPropertyValue('--brand-2').trim(), root.getPropertyValue('--nav-active').trim()];
  const adjusted = applied.some(v => v && v.toUpperCase() !== appSettings.accentColor.toUpperCase());
  return adjusted
    ? `Adjusted where needed so text stays readable: buttons and links use <b>${escapeHtml(applied[0])}</b>, the navigation marker <b>${escapeHtml(applied[1])}</b>.`
    : `Used as is: <b>${escapeHtml(appSettings.accentColor.toUpperCase())}</b>.`;
}

// fresh: entering Settings from the nav. The phone starts at the index;
// the desktop reopens the last group. Re-renders after a save keep the
// group that is open.
export function renderSettings({ fresh = false } = {}){
  const view = document.getElementById('settingsView');
  const remaining = aiUsageRemaining();
  const pct = aiUsagePct();
  const valueClass = pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : 'ok';
  const periodStart = appSettings.aiUsagePeriodStart
    ? new Date(appSettings.aiUsagePeriodStart).toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'})
    : '—';

  const PREP_OPTIONS = [
    {value:'needs_wash', label:'Needs wash'},
    {value:'needs_repair', label:'Needs repair'},
    {value:'needs_photo', label:'Needs photos'},
    {value:'ready', label:'Ready to list'},
  ];
  const CATEGORIES = ['Clothing','Shoes','Accessories','Electronics','Home & Decor','Collectibles','Toys','Books','Other'];

  const index = settingsGroups();
  const keys = index.flatMap(s => s.groups.map(g => g.key));
  const titles = Object.fromEntries(index.flatMap(s => s.groups.map(g => [g.key, g.title])));
  if (fresh) currentGroup = isDesktop() ? storedGroup() : null;
  else if (!currentGroup && isDesktop()) currentGroup = storedGroup();
  if (currentGroup && !keys.includes(currentGroup)) currentGroup = isDesktop() ? 'account' : null;

  const page = (key, body) => `
      <section class="settings-page" data-settings-page="${key}" aria-labelledby="settingsTitle-${key}" hidden>
        <div class="settings-page-head">
          <button type="button" class="settings-back" data-settings-back aria-label="Back to Settings">${BACK}<span>Settings</span></button>
          <h2 class="settings-page-title" id="settingsTitle-${key}">${titles[key] || ''}</h2>
        </div>
        ${body}
      </section>`;

  const indexHtml = index.map(s => `
        <div class="settings-index-section">
          <h2 class="settings-index-heading">${s.heading}</h2>
          <div class="panel settings-index-list">${s.groups.map(g => `
            <button type="button" class="settings-index-row" data-settings-group="${g.key}">
              <span class="settings-index-text"><span class="settings-index-title">${g.title}</span><span class="settings-index-summary">${escapeHtml(g.summary)}</span></span>
              ${CHEVRON}
            </button>`).join('')}
          </div>
        </div>`).join('');

  view.innerHTML = `
    <div class="settings-layout">
      <div class="settings-index-col">
        <h1 class="screen-title">Settings</h1>
        <nav class="settings-index" aria-label="Settings">${indexHtml}
        </nav>
      </div>
      <div class="settings-pages">
${page('account', `
      <!-- ACCOUNT -->
      <div class="settings-section">
        <h3>Account</h3>
        <div class="ss-desc">Signed in as <b>${escapeHtml(window.auth.currentUser?.email || '')}</b> · App version ${APP_VERSION} (${APP_VERSION_DATE})</div>
        ${window.auth.currentUser && !window.auth.currentUser.emailVerified ? `
        <div id="verifyEmailBox" class="settings-block">
          <div class="ebay-status-box pending">Your email isn't verified yet. Verified emails will soon be required to use the app: send yourself a verification email, click the link in it, then tap "I've verified it".</div>
          <div class="settings-btn-row">
            <button id="verifyEmailSendBtn" class="settings-save-btn inline">Send verification email</button>
            <button id="verifyEmailCheckBtn" class="settings-save-btn inline secondary">I've verified it</button>
          </div>
          <div id="verifyEmailMsg" class="ss-desc"></div>
        </div>` : ''}
        <div class="settings-btn-row">
          <button id="checkUpdatesBtn" class="settings-save-btn inline secondary">Check for updates</button>
          <button id="signOutBtn" class="settings-save-btn inline secondary">Sign out</button>
          ${isPlatformAdmin() ? `<a href="/admin.html" class="settings-save-btn inline secondary">Developer Panel</a>` : ''}
        </div>
      </div>`)}
${page('appearance', `
      <!-- STORE IDENTITY (v3.22.1) -->
      <div class="settings-section" id="storeSection">
        <h3>Store</h3>
        <div class="ss-desc">Your store's name and logo lead the header for everyone in this business, with "by Calculated Chaos" under them. Changes save as you make them.</div>
        <div class="settings-row">
          <div><div class="sr-label">Store name</div><div class="sr-sub">Leave blank to show Calculated Chaos</div></div>
          <input type="text" id="sStoreName" class="wide" maxlength="40" value="${escapeHtml(appSettings.storeName || '')}" placeholder="Your store">
        </div>
        <div class="settings-row">
          <div><div class="sr-label">Logo</div><div class="sr-sub">PNG, JPG, WebP or SVG, shrunk to 256 px</div></div>
          <div class="logo-field">
            ${isLogo(appSettings.storeLogo) ? `<img class="logo-preview" src="${escapeHtml(appSettings.storeLogo)}" alt="Current logo">` : '<span class="logo-none">No logo</span>'}
            <label class="small-btn file-btn">${isLogo(appSettings.storeLogo) ? 'Replace' : 'Upload'}<input type="file" id="sStoreLogo" accept="image/png,image/jpeg,image/webp,image/svg+xml"></label>
            ${isLogo(appSettings.storeLogo) ? '<button type="button" class="small-btn danger" data-remove-logo>Remove</button>' : ''}
          </div>
        </div>
        <div class="ss-desc settings-error" id="storeLogoError" role="alert"></div>
        <div class="settings-success" id="storeSaveMsg">Saved</div>
      </div>

      <!-- ACCENT COLOR (v3.22.1) -->
      <div class="settings-section" id="accentSection">
        <h3>Accent color</h3>
        <div class="ss-desc">Buttons, links, the active tab and the navigation marker, in every theme. Red for urgent and green for profit don't change.</div>
        <div class="accent-options" role="group" aria-label="Accent color">
          <button type="button" class="accent-swatch default${isHexColor(appSettings.accentColor) ? '' : ' active'}" data-accent="" aria-pressed="${!isHexColor(appSettings.accentColor)}"><span class="accent-chip" aria-hidden="true"></span>Theme default</button>
          ${ACCENT_PRESETS.map(p => {
            const on = (appSettings.accentColor || '').toUpperCase() === p.hex;
            return `<button type="button" class="accent-swatch${on ? ' active' : ''}" data-accent="${p.hex}" aria-pressed="${on}"><span class="accent-chip" style="background:${p.hex};" aria-hidden="true"></span>${p.name}</button>`;
          }).join('')}
          <label class="accent-swatch custom${isHexColor(appSettings.accentColor) && !ACCENT_PRESETS.some(p => p.hex === appSettings.accentColor.toUpperCase()) ? ' active' : ''}">
            <input type="color" id="sAccentCustom" value="${isHexColor(appSettings.accentColor) ? appSettings.accentColor : '#1E3A7B'}" aria-label="Custom accent color">Custom
          </label>
        </div>
        <div class="ss-desc accent-note" id="accentNote">${accentNote()}</div>
        <div class="settings-success" id="accentSaveMsg">Saved</div>
      </div>

      <!-- APPEARANCE (v3.21.0) -->
      <div class="settings-section" id="appearanceSection">
        <h3>Theme</h3>
        <div class="ss-desc">The look of the app for everyone in this business. It changes as soon as you pick one.</div>
        <div class="theme-options" role="radiogroup" aria-label="Theme">
          ${THEMES.map(t => {
            const on = normalizeTheme(appSettings.theme) === t.key;
            return `<label class="theme-option${on ? ' active' : ''}">
              <input type="radio" name="appTheme" value="${t.key}" ${on ? 'checked' : ''}>
              <span class="theme-swatch" aria-hidden="true">${t.swatches.map(c => `<span style="background:${c};"></span>`).join('')}</span>
              <span class="theme-text"><b>${t.label}</b><small>${t.note}</small></span>
            </label>`;
          }).join('')}
        </div>
        <div class="settings-success" id="themeSaveMsg">Saved</div>
      </div>`)}
${page('pricing', `
      <!-- PRICE MARKUP RULE -->
      <div class="settings-section">
        <h3>Price markup rule</h3>
        <div class="ss-desc">Set your minimum profit targets. The suggested price calculator uses these to ensure every item is priced for real profit, not just above cost.</div>
        <div class="settings-row">
          <div><div class="sr-label">Target net margin</div><div class="sr-sub">Minimum % profit after fees & shipping</div></div>
          <input type="number" id="sMarginPct" value="${appSettings.targetMarginPct || 40}" min="5" max="90" step="5">
        </div>
        <div class="settings-row">
          <div><div class="sr-label">Minimum markup</div><div class="sr-sub">List price must be at least this × cost</div></div>
          <input type="number" id="sMarkupMulti" value="${appSettings.minMarkupMultiplier || 1.8}" min="1.1" max="5" step="0.1">
        </div>
        <button class="settings-save-btn" onclick="savePriceSettings()">Save price settings</button>
        <div class="settings-success" id="priceSaveMsg">Saved</div>
      </div>

      <!-- PLATFORMS -->
      <div class="settings-section">
        <h3>Platforms</h3>
        <div class="ss-desc">Fee % is used for profit calculations everywhere in the app. eBay/Mercari/Poshmark/Vinted/Depop keep their names fixed (eBay especially has real integration tied to it), but you can adjust any fee % here. Add your own platforms below too — "Suggest %" asks the AI for a current estimate you can review before saving.</div>
        <div id="platformsList"></div>
        <div class="settings-add-row">
          <input type="text" id="sNewPlatformName" placeholder="New platform name">
          <input type="number" id="sNewPlatformFee" placeholder="Fee %" min="0" max="100" step="0.1" class="narrow">
          <button class="settings-save-btn inline" onclick="addCustomPlatform()">Add platform</button>
        </div>
        <div class="settings-success" id="platformsSaveMsg">Saved</div>
      </div>`)}
${page('shipping', `
      <!-- DEFAULT SHIPPING PROFILE -->
      <div class="settings-section">
        <h3>Default shipping profile</h3>
        <div class="ss-desc">These defaults pre-fill new items and power the shipping simulator. Change per-item if needed.</div>
        <div class="settings-row">
          <div><div class="sr-label">Preferred carrier</div><div class="sr-sub">Used for shipping estimates</div></div>
          <select id="sCarrier">
            <option value="usps_ground" ${appSettings.defaultCarrier==='usps_ground'?'selected':''}>USPS Ground Advantage</option>
            <option value="usps_priority" ${appSettings.defaultCarrier==='usps_priority'?'selected':''}>USPS Priority Mail</option>
            <option value="ups_ground" ${appSettings.defaultCarrier==='ups_ground'?'selected':''}>UPS Ground</option>
          </select>
        </div>
        <div class="settings-row">
          <div><div class="sr-label">Who pays shipping?</div><div class="sr-sub">Affects profit calculations</div></div>
          <select id="sShippingPayer">
            <option value="buyer" ${!appSettings.sellerPaysShipping?'selected':''}>Buyer pays</option>
            <option value="seller" ${appSettings.sellerPaysShipping?'selected':''}>I pay (free shipping)</option>
          </select>
        </div>
        <div class="settings-row">
          <div><div class="sr-label">Default package weight</div><div class="sr-sub">Used when item has no weight set (lb)</div></div>
          <input type="number" id="sDefaultWeight" value="${appSettings.defaultWeightLb || 0.5}" min="0.1" max="10" step="0.1">
        </div>
        <button class="settings-save-btn" onclick="saveShippingSettings()">Save shipping settings</button>
        <div class="settings-success" id="shippingSaveMsg">Saved</div>
      </div>

      <!-- CUSTOM CARRIERS -->
      <div class="settings-section">
        <h3>Custom carriers</h3>
        <div class="ss-desc">Add any carrier not built in (FedEx, DHL, Media Mail...) with your own base price and per-pound rate. They'll show up as extra options in the shipping simulator.</div>
        ${(appSettings.customCarriers || []).length === 0 ? `<div class="ss-desc settings-empty-note">No custom carriers added yet.</div>` : ''}
        ${(appSettings.customCarriers || []).map((c, i) => `
          <div class="settings-row">
            <div><div class="sr-label">${c.name}</div><div class="sr-sub">Base $${(c.basePrice||0).toFixed(2)} + $${(c.perLbPrice||0).toFixed(2)}/lb after 1st lb</div></div>
            <button class="small-btn danger" onclick="removeCustomCarrier(${i})">Remove</button>
          </div>
        `).join('')}
        <div class="settings-add-row carriers">
          <label class="settings-add-field wide"><span>Carrier name</span><input type="text" id="sNewCarrierName" placeholder="e.g. FedEx Ground"></label>
          <label class="settings-add-field"><span>Base price</span><input type="number" id="sNewCarrierBase" placeholder="0.00" min="0" step="0.01"></label>
          <label class="settings-add-field"><span>Per lb after 1st</span><input type="number" id="sNewCarrierPerLb" placeholder="0.00" min="0" step="0.01"></label>
          <button class="settings-save-btn inline" onclick="addCustomCarrier()">Add carrier</button>
        </div>
      </div>`)}
${page('listings', `
      <!-- AUTO-PREP RULES -->
      <div class="settings-section">
        <h3>Auto-prep by category</h3>
        <div class="ss-desc">When a new item is cataloged, its prep status is set automatically based on category. Change any rule to match your workflow.</div>
        ${CATEGORIES.map(cat => `
        <div class="settings-row">
          <div><div class="sr-label">${cat}</div></div>
          <select id="sPrep_${cat.replace(/[^a-z]/gi,'_')}">
            ${PREP_OPTIONS.map(p => `<option value="${p.value}" ${(appSettings.autoPrepRules||{})[cat]===p.value?'selected':''}>${p.label}</option>`).join('')}
          </select>
        </div>`).join('')}
        <button class="settings-save-btn" onclick="savePrepSettings()">Save prep rules</button>
        <div class="settings-success" id="prepSaveMsg">Saved</div>
      </div>

      <!-- LISTING STANDARD TEXT -->
      <div class="settings-section">
        <h3>Listing closing text</h3>
        <div class="ss-desc">Your own standard closing line — shipping policy, bundle offer, thank-you note, whatever you want. It's used automatically every time you generate a listing description (instant template), shared across every platform (eBay reuses it too), and offered as an option when generating with AI.</div>
        <textarea id="sListingText" class="settings-textarea" placeholder="e.g. Bundle discount available — check my closet! Ships next business day">${escapeHtml(appSettings.listingStandardText || '')}</textarea>
        <button class="settings-save-btn" onclick="saveListingTextSettings()">Save listing text</button>
        <div class="settings-success" id="listingTextSaveMsg">Saved</div>
      </div>`)}
${page('warnings', warningsPageHtml())}
${page('labels', `
      <!-- THERMAL LABEL PRINTING -->
      <div class="settings-section">
        <h3>Label printing</h3>
        <div class="ss-desc">Sets the size of the labels loaded in your thermal printer and which details print on them. This is used by the print button on each item. Printed top-to-bottom by priority: product code, then name/color, then storage box — pinned to the top of the label with minimal margins so a larger sheet can be trimmed below it.</div>
        <div class="settings-row">
          <div><div class="sr-label">Label width</div><div class="sr-sub">Inches</div></div>
          <input type="number" id="sLabelWidth" value="${appSettings.labelWidthIn || 2.25}" min="1" max="6" step="0.05">
        </div>
        <div class="settings-row">
          <div><div class="sr-label">Label height</div><div class="sr-sub">Inches</div></div>
          <input type="number" id="sLabelHeight" value="${appSettings.labelHeightIn || 1.25}" min="0.5" max="6" step="0.05">
        </div>
        <div class="settings-row">
          <div><div class="sr-label">Product code</div><div class="sr-sub">Always printed</div></div>
          <input type="checkbox" checked disabled>
        </div>
        <div class="settings-row">
          <div><div class="sr-label">Item name</div></div>
          <input type="checkbox" id="sLabelFieldName" ${appSettings.labelFields?.name !== false ? 'checked' : ''}>
        </div>
        <div class="settings-row">
          <div><div class="sr-label">Color</div></div>
          <input type="checkbox" id="sLabelFieldColor" ${appSettings.labelFields?.color !== false ? 'checked' : ''}>
        </div>
        <div class="settings-row">
          <div><div class="sr-label">Storage box</div></div>
          <input type="checkbox" id="sLabelFieldBox" ${appSettings.labelFields?.box !== false ? 'checked' : ''}>
        </div>
        <div class="settings-row">
          <div><div class="sr-label">Category / type</div></div>
          <input type="checkbox" id="sLabelFieldCategory" ${appSettings.labelFields?.category ? 'checked' : ''}>
        </div>
        <div class="settings-row">
          <div><div class="sr-label">Brand</div></div>
          <input type="checkbox" id="sLabelFieldBrand" ${appSettings.labelFields?.brand ? 'checked' : ''}>
        </div>
        <button class="settings-save-btn" onclick="saveLabelSettings()">Save label settings</button>
        <div class="settings-success" id="labelSaveMsg">Saved</div>
      </div>`)}
${page('ai', `
      <!-- AI USAGE COUNTER -->
      <div class="settings-section">
        <h3>AI analysis usage</h3>
        <div class="ss-desc">Tracks how many "Analyze with AI" photo analyses have been used in the current billing period.</div>
        <div class="ai-counter-box">
          <div class="ai-counter-stat">
            <div class="label">Used this period</div>
            <div class="value ${valueClass}">${appSettings.aiUsageCount || 0}</div>
          </div>
          <div class="ai-counter-stat">
            <div class="label">Remaining</div>
            <div class="value ${valueClass}">${remaining}</div>
          </div>
          <div class="ai-counter-stat">
            <div class="label">Limit</div>
            <div class="value">${appSettings.aiUsageLimit || 500}</div>
          </div>
          <div class="ai-counter-stat">
            <div class="label">Period started</div>
            <div class="value small">${periodStart}</div>
          </div>
        </div>
        <div class="ai-meter"><div class="ai-meter-fill ${valueClass}" style="width:${pct}%;"></div></div>

        <div class="settings-row">
          <div><div class="sr-label">Monthly limit</div><div class="sr-sub">Max AI analyses per billing period</div></div>
          <input type="number" id="sAiLimit" value="${appSettings.aiUsageLimit || 500}" min="10" max="9999" step="50">
        </div>
        <div class="settings-row">
          <div><div class="sr-label">Auto-reset on day</div><div class="sr-sub">Day of month to automatically reset counter</div></div>
          <input type="number" id="sAiResetDay" value="${appSettings.aiResetDayOfMonth || 1}" min="1" max="28">
        </div>
        <div class="settings-row">
          <div><div class="sr-label">Scheduled reset</div><div class="sr-sub">Automatically reset on the day above each month</div></div>
          <select id="sAiScheduled">
            <option value="true" ${appSettings.aiScheduledReset ? 'selected' : ''}>On (monthly)</option>
            <option value="false" ${!appSettings.aiScheduledReset ? 'selected' : ''}>Off (manual only)</option>
          </select>
        </div>
        <button class="settings-save-btn" onclick="saveAiUsageSettings()">Save AI settings</button>
        <div class="settings-success" id="aiSaveMsg">Saved</div>

        <div class="reset-btn-row">
          <button class="reset-btn scheduled" onclick="handleScheduledReset()">Schedule next reset</button>
          <button class="reset-btn immediate" onclick="handleImmediateReset()">Reset now</button>
        </div>
        <div id="resetConfirmMsg" class="settings-success">Counter reset.</div>
      </div>`)}
${page('team', `
      <!-- AUTHORIZE ACCESS (admin only) -->
      <div class="settings-section" id="authorizeAccessSection" style="display:none;">
        <h3>Developer Panel</h3>
        <div class="ss-desc">Access requests, users, the eBay connection and the eBay error library live in the Developer Panel (Settings → Account).</div>
        <div id="authorizeAccessBox"></div>
      </div>

      <!-- EMPLOYEE ACCOUNTS (admin only) -->
      <div class="settings-section" id="employeeAccountsSection" style="display:none;">
        <h3>Employee accounts</h3>
        <div class="ss-desc">Create a login for someone who should only see the Catalog — no Home, Stock, Finances, or Settings. This restricts what the app SHOWS them; it isn't a database-level guarantee (see CLAUDE.md for the Firestore rule that closes that gap).</div>
        <div class="field-row">
          <div class="field"><label>Employee email</label><input type="email" id="newEmployeeEmail" placeholder="employee@example.com"></div>
          <div class="field"><label>Temporary password</label><input type="text" id="newEmployeePassword" placeholder="At least 6 characters"></div>
        </div>
        <button id="createEmployeeBtn" class="settings-save-btn inline">Create employee account</button>
        <div id="employeeAccountsResult" class="settings-result"></div>
        <div id="employeeAccountsList" class="settings-result"></div>
      </div>`)}
${page('ebay', `
      <h3 class="settings-subhead">Connection</h3>
      <!-- EBAY CONNECTION STATUS -->
      <div class="settings-section">
        <h3>eBay connection</h3>
        <div class="ss-desc">Always confirm this shows the right seller account before publishing anything.</div>
        <div id="ebayConnectionStatus"></div>
      </div>

      <!-- EBAY ONE-TIME SETUP -->
      <div class="settings-section">
        <h3>eBay one-time setup</h3>
        <div class="ss-desc">Creates the required Business Policies (fulfillment, payment, return) and a merchant location on your connected eBay account via API — no need to use eBay's Seller Hub UI. Run this once per seller account (connect eBay first, then run this). If you ever reconnect to a DIFFERENT seller account, run this again — policies and location are per-account.</div>
        <button class="settings-save-btn" onclick="runEbaySetup()">Run eBay setup</button>
        <div id="ebaySetupResult" class="settings-result"></div>
      </div>

      <h3 class="settings-subhead">Sales and offers</h3>
      <!-- EBAY SALE CHECK -->
      <div class="settings-section">
        <h3>eBay sale sync</h3>
        <div class="ss-desc">The app automatically checks for new eBay sales every time it opens and marks matching items as Sold. Use this to check right now instead of waiting to reopen the app.</div>
        <button class="settings-save-btn" onclick="checkEbaySalesNow(true)">Check for eBay sales now</button>
        <div id="ebaySalesCheckResult" class="settings-result"></div>
      </div>

      <!-- EBAY OFFERS TO WATCHERS -->
      <div class="settings-section">
        <h3>Offer discount to watchers</h3>
        <div class="ss-desc">Finds your eBay listings that have interested buyers (watchers or abandoned-cart) and lets you send them a discount offer, straight from eBay's own Negotiation feature.</div>
        <button class="settings-save-btn" onclick="findEligibleOffers()">Check for interested buyers</button>
        <div id="ebayOffersResult" class="settings-result"></div>
      </div>

      <h3 class="settings-subhead">Tools</h3>
      <!-- EBAY LISTING AUDIT -->
      <div class="settings-section">
        <h3>eBay listing audit</h3>
        <div class="ss-desc">Fetches every listing that's actually live on eBay and cross-checks it against this catalog — flags listings with no matching item here (never imports them automatically), and listings whose live shipping policy doesn't match what the item says it should be.</div>
        <button class="settings-save-btn" onclick="runEbayAudit()">Audit eBay listings</button>
        <div id="ebayAuditResult" class="settings-result"></div>
        <button class="settings-save-btn secondary" onclick="runListFulfillmentPolicies()">List my eBay shipping policies (find a policy's ID)</button>
        <div id="ebayPoliciesResult" class="settings-result"></div>
        <button class="settings-save-btn secondary" onclick="runBackfillDescriptions()">Backfill missing eBay descriptions</button>
        <div id="ebayBackfillResult" class="settings-result"></div>
      </div>

      <!-- EBAY ERROR LIBRARY -->
      <div class="settings-section">
        <h3>eBay error library</h3>
        <div class="ss-desc">Every eBay publish error seen on this account, with how often it happened. Errors the app doesn't know how to fix yet are listed first, with the AI's explanation when it gave one — those are the ones to add to the library next.</div>
        <button class="settings-save-btn" onclick="runEbayErrorLibrary()">Open eBay error library</button>
        <div id="ebayErrorLibraryResult" class="settings-result"></div>
      </div>`)}
${page('data', `
      <!-- DUPLICATE REGISTRATION NUMBERS (temporary tool) -->
      <div class="settings-section">
        <h3>Duplicate registration numbers</h3>
        <div class="ss-desc">Temporary tool: checks the loaded catalog for two items sharing the exact same registration/product code (e.g. two items both saved as #0089) — can happen when two devices add an item at almost the same time. New items now reserve their number from a shared counter so this shouldn't happen going forward; use this to find and fix any that already slipped through.</div>
        <button class="settings-save-btn" onclick="runDuplicateProductCodeAudit()">Check for duplicate numbers</button>
        <div id="duplicateCodesResult" class="settings-result"></div>
      </div>

      <!-- EXPORTS -->
      <div class="settings-section">
        <h3>Export</h3>
        <div class="ss-desc">Excel and CSV exports of the inventory and sales are in Finances → Reports, under Export.</div>
        <button type="button" class="settings-save-btn secondary" data-settings-open-reports>Open Reports</button>
      </div>`)}
        <div class="settings-none">Pick a section on the left.</div>
      </div>
    </div>`;
  renderEbayConnectionStatus();
  renderPlatformsSettingsList();
  showGroup(currentGroup);

  view.querySelectorAll('[data-settings-group]').forEach(btn => btn.addEventListener('click', () => {
    showGroup(btn.dataset.settingsGroup);
    if (!isDesktop()) window.scrollTo(0, 0);
    view.querySelector(`[data-settings-page="${btn.dataset.settingsGroup}"] .settings-back`)?.focus({ preventScroll: true });
  }));
  view.querySelectorAll('[data-settings-back]').forEach(btn => btn.addEventListener('click', () => {
    const from = currentGroup;
    showGroup(null);
    window.scrollTo(0, 0);
    view.querySelector(`[data-settings-group="${from}"]`)?.focus({ preventScroll: true });
  }));
  view.querySelector('[data-settings-open-reports]')?.addEventListener('click', () => {
    document.querySelector('.subtab[data-tab="reports"]')?.click();
  });

  document.getElementById('signOutBtn')?.addEventListener('click', async () => {
    if (!confirm('Sign out of Calculated Chaos?')) return;
    await window.authFns.signOut(window.auth);
  });
  // Store identity and accent (v3.22.1): saved as they change.
  document.getElementById('sStoreName')?.addEventListener('change', (e) => window.saveStoreName(e.target.value));
  document.getElementById('sStoreLogo')?.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    const errEl = document.getElementById('storeLogoError');
    errEl.textContent = '';
    if (!file) return;
    try{
      const data = await shrinkImageToDataUrl(file, 256);
      if (data.length > MAX_LOGO_CHARS) throw new Error('That logo is still too large after shrinking. Try a simpler image.');
      await window.saveStoreLogo(data);
    }catch(err){
      errEl.textContent = err.message || "That image couldn't be used.";
    }
  });
  view.querySelector('[data-remove-logo]')?.addEventListener('click', () => window.saveStoreLogo(''));
  view.querySelectorAll('[data-accent]').forEach(btn => btn.addEventListener('click', () => window.saveAccent(btn.dataset.accent)));
  const customAccent = document.getElementById('sAccentCustom');
  customAccent?.addEventListener('input', () => applyAccent(customAccent.value));
  customAccent?.addEventListener('change', () => window.saveAccent(customAccent.value));
  wireWarningsPanel();
  document.querySelectorAll('input[name="appTheme"]').forEach(input => {
    input.addEventListener('change', () => window.saveAppearance(input.value));
  });
  // Was the header's refresh button before v3.20.0: a real reload from
  // the server, so a stale cached copy never "refreshes" into itself.
  document.getElementById('checkUpdatesBtn')?.addEventListener('click', () => {
    window.location.reload(true);
  });
  // Email verification (v3.18.3): sent only when the person clicks.
  document.getElementById('verifyEmailSendBtn')?.addEventListener('click', async (e) => {
    const msg = document.getElementById('verifyEmailMsg');
    e.target.disabled = true;
    const r = await sendVerificationEmail(window.auth.currentUser);
    e.target.disabled = false;
    msg.textContent = r.ok ? `Sent to ${window.auth.currentUser?.email}. Check your inbox (and spam), click the link, then tap "I've verified it".` : `❌ ${r.error}`;
  });
  document.getElementById('verifyEmailCheckBtn')?.addEventListener('click', async (e) => {
    const msg = document.getElementById('verifyEmailMsg');
    e.target.disabled = true;
    const verified = await refreshEmailVerified(window.auth.currentUser);
    e.target.disabled = false;
    if (verified){
      document.getElementById('verifyEmailBox').innerHTML = '<div class="ebay-status-box success">✅ Email verified.</div>';
    }else{
      msg.textContent = verified === null ? '❌ Could not check right now. Try again.' : 'Not verified yet. Click the link in the email first.';
    }
  });
  document.getElementById('createEmployeeBtn')?.addEventListener('click', async () => {
    const email = document.getElementById('newEmployeeEmail').value.trim();
    const password = document.getElementById('newEmployeePassword').value;
    const resultEl = document.getElementById('employeeAccountsResult');
    if (!email || !password){
      resultEl.innerHTML = `<div class="ebay-status-box error">Enter both an email and a password.</div>`;
      return;
    }
    if (password.length < 6){
      resultEl.innerHTML = `<div class="ebay-status-box error">Password needs to be at least 6 characters (Firebase's minimum).</div>`;
      return;
    }
    const btn = document.getElementById('createEmployeeBtn');
    btn.disabled = true;
    resultEl.innerHTML = `<div class="ebay-status-box pending">⏳ Creating account…</div>`;
    const result = await createEmployeeLogin(email, password);
    btn.disabled = false;
    if (result.ok){
      resultEl.innerHTML = `<div class="ebay-status-box success">✅ Employee account created for ${escapeHtml(email)} — Catalog-only access. Share the email/password with them directly; they can sign in right away (no approval step needed).</div>`;
      document.getElementById('newEmployeeEmail').value = '';
      document.getElementById('newEmployeePassword').value = '';
      renderEmployeeAccountsPanel();
    } else {
      resultEl.innerHTML = `<div class="ebay-status-box error">❌ Could not create the account: ${escapeHtml(result.error || 'unknown error')}</div>`;
    }
  });
  if (isPlatformAdmin()){
    renderAuthorizeAccessPanel();
    renderEmployeeAccountsPanel();
  }
}
