// The Settings screen (UI layer; v3.17.6, docs/modularization.md).
// Moved out of main.js unchanged: renderSettings() rebuilds the whole
// screen from appSettings on every call, then fills in the panels that
// load their own data. The buttons in its template call the window.*
// handlers registered by the other files in this folder.
//
// The template keeps main.js's old indentation on purpose: that whitespace
// is part of the generated HTML (see docs/modularization.md).
import { appSettings } from '../../modules/state.js';
import { escapeHtml } from '../../modules/format-utils.js';
import { aiUsageRemaining, aiUsagePct } from '../../data/settings-store.js';
import { renderAuthorizeAccessPanel, renderEmployeeAccountsPanel, createEmployeeLogin } from './admin-panels.js';
import { isPlatformAdmin } from '../../modules/admin-claim.js';
import { renderEbayConnectionStatus } from './ebay-panel.js';
import { renderPlatformsSettingsList } from './platforms-panel.js';

export function renderSettings(){
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

  view.innerHTML = `

      <!-- ACCOUNT -->
      <div class="settings-section">
        <h3>Account</h3>
        <div class="ss-desc">Signed in as <b>${escapeHtml(window.auth.currentUser?.email || '')}</b></div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button id="signOutBtn" class="settings-save-btn" style="width:auto; padding:8px 14px; margin:0;">Sign out</button>
          ${isPlatformAdmin() ? `<a href="/admin.html" class="settings-save-btn" style="display:inline-block; width:auto; padding:8px 14px; margin:0; text-decoration:none;">🛠️ Developer Panel</a>` : ''}
        </div>
      </div>

      <!-- AUTHORIZE ACCESS (admin only) -->
      <div class="settings-section" id="authorizeAccessSection" style="display:none;">
        <h3>Developer Panel</h3>
        <div class="ss-desc">Access requests, users, the eBay connection and the eBay error library live in the Developer Panel (button under Account above).</div>
        <div id="authorizeAccessBox"></div>
      </div>

      <!-- EMPLOYEE ACCOUNTS (admin only) -->
      <div class="settings-section" id="employeeAccountsSection" style="display:none;">
        <h3>Employee accounts</h3>
        <div class="ss-desc">Create a login for someone who should only see the Catalog — no Dashboard, Finances, Reports, or Settings. This restricts what the app SHOWS them; it isn't a database-level guarantee (see CLAUDE.md for the Firestore rule that closes that gap).</div>
        <div class="field-row">
          <div class="field"><label>Employee email</label><input type="email" id="newEmployeeEmail" placeholder="employee@example.com"></div>
          <div class="field"><label>Temporary password</label><input type="text" id="newEmployeePassword" placeholder="At least 6 characters"></div>
        </div>
        <button id="createEmployeeBtn" class="settings-save-btn" style="width:auto; padding:8px 14px; margin:0;">Create employee account</button>
        <div id="employeeAccountsResult" style="margin-top:10px;"></div>
        <div id="employeeAccountsList" style="margin-top:14px;"></div>
      </div>

      <!-- AI USAGE COUNTER -->
      <div class="settings-section">
        <h3>AI Analysis Usage</h3>
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
            <div class="value" style="font-size:13px;">${periodStart}</div>
          </div>
        </div>
        <div style="background:var(--cream-soft); border-radius:8px; overflow:hidden; height:10px; margin-bottom:12px;">
          <div style="height:100%; width:${pct}%; background:${pct>=90?'var(--danger)':pct>=70?'var(--amber)':'var(--sage)'}; border-radius:8px; transition:width 0.3s;"></div>
        </div>

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

        <div class="reset-btn-row">
          <button class="reset-btn scheduled" onclick="handleScheduledReset()">🗓 Schedule next reset</button>
          <button class="reset-btn immediate" onclick="handleImmediateReset()">⚡ Reset now</button>
        </div>
        <div id="resetConfirmMsg" style="font-size:12px; color:var(--sage-deep); text-align:center; margin-top:8px; display:none;">✓ Counter reset successfully.</div>
      </div>

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
        <div class="settings-success" id="priceSaveMsg">✓ Saved!</div>
      </div>

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
        <div class="settings-success" id="shippingSaveMsg">✓ Saved!</div>

        <div style="margin-top:18px; padding-top:14px; border-top:1px dashed var(--line);">
          <div class="sr-label" style="margin-bottom:4px;">Custom carriers</div>
          <div class="ss-desc" style="margin-bottom:10px;">Add any carrier not built in (FedEx, DHL, Media Mail...) with your own base price and per-pound rate. They'll show up as extra options in the shipping simulator.</div>
          ${(appSettings.customCarriers || []).length === 0 ? `<div class="ss-desc" style="font-style:italic;">No custom carriers added yet.</div>` : ''}
          ${(appSettings.customCarriers || []).map((c, i) => `
            <div class="settings-row">
              <div><div class="sr-label">${c.name}</div><div class="sr-sub">Base $${(c.basePrice||0).toFixed(2)} + $${(c.perLbPrice||0).toFixed(2)}/lb after 1st lb</div></div>
              <button onclick="removeCustomCarrier(${i})" style="background:var(--terracotta); color:white; border:none; border-radius:8px; padding:6px 12px; font-size:12px; cursor:pointer;">Remove</button>
            </div>
          `).join('')}
          <div class="settings-row" style="align-items:flex-end; gap:8px; flex-wrap:wrap;">
            <div style="flex:1; min-width:120px;">
              <div class="sr-sub" style="margin-bottom:4px;">Carrier name</div>
              <input type="text" id="sNewCarrierName" placeholder="e.g. FedEx Ground" style="width:100%;">
            </div>
            <div style="width:100px;">
              <div class="sr-sub" style="margin-bottom:4px;">Base price</div>
              <input type="number" id="sNewCarrierBase" placeholder="0.00" min="0" step="0.01" style="width:100%;">
            </div>
            <div style="width:100px;">
              <div class="sr-sub" style="margin-bottom:4px;">Per lb after 1st</div>
              <input type="number" id="sNewCarrierPerLb" placeholder="0.00" min="0" step="0.01" style="width:100%;">
            </div>
            <button onclick="addCustomCarrier()" style="background:var(--sage); color:white; border:none; border-radius:8px; padding:9px 14px; font-size:13px; cursor:pointer; white-space:nowrap;">+ Add carrier</button>
          </div>
        </div>
      </div>

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
        <div class="settings-success" id="prepSaveMsg">✓ Saved!</div>
      </div>

      <!-- LISTING STANDARD TEXT -->
      <div class="settings-section">
        <h3>Listing closing text</h3>
        <div class="ss-desc">Your own standard closing line — shipping policy, bundle offer, thank-you note, whatever you want. It's used automatically every time you generate a listing description (instant template), shared across every platform (eBay reuses it too), and offered as an option when generating with AI.</div>
        <textarea id="sListingText" placeholder="e.g. Bundle discount available — check my closet! Ships next business day 📦" style="width:100%; min-height:70px; padding:10px 12px; border:1px solid var(--line); border-radius:10px; font-size:13px; font-family:'Inter',sans-serif; resize:vertical;">${escapeHtml(appSettings.listingStandardText || '')}</textarea>
        <button class="settings-save-btn" onclick="saveListingTextSettings()">Save listing text</button>
        <div class="settings-success" id="listingTextSaveMsg">✓ Saved!</div>
      </div>

      <!-- PLATFORMS -->
      <div class="settings-section">
        <h3>Platforms</h3>
        <div class="ss-desc">Fee % is used for profit calculations everywhere in the app. eBay/Mercari/Poshmark/Vinted/Depop keep their names fixed (eBay especially has real integration tied to it), but you can adjust any fee % here. Add your own platforms below too — "🔍 Suggest %" asks the AI for a current estimate you can review before saving.</div>
        <div id="platformsList"></div>
        <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap; align-items:center;">
          <input type="text" id="sNewPlatformName" placeholder="New platform name" style="flex:1; min-width:120px; padding:8px 10px; border:1px solid var(--line); border-radius:8px; font-size:13px;">
          <input type="number" id="sNewPlatformFee" placeholder="Fee %" min="0" max="100" step="0.1" style="width:80px; padding:8px 10px; border:1px solid var(--line); border-radius:8px; font-size:13px;">
          <button class="settings-save-btn" style="width:auto; margin:0;" onclick="addCustomPlatform()">+ Add platform</button>
        </div>
        <div class="settings-success" id="platformsSaveMsg">✓ Saved!</div>
      </div>

      <!-- THERMAL LABEL PRINTING -->
      <div class="settings-section">
        <h3>Label printing</h3>
        <div class="ss-desc">Sets the size of the labels loaded in your thermal printer and which details print on them. This is used by the 🖨️ button on each item. Printed top-to-bottom by priority: product code, then name/color, then storage box — pinned to the top of the label with minimal margins so a larger sheet can be trimmed below it.</div>
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
          <input type="checkbox" checked disabled style="width:20px; height:20px;">
        </div>
        <div class="settings-row">
          <div><div class="sr-label">Item name</div></div>
          <input type="checkbox" id="sLabelFieldName" ${appSettings.labelFields?.name !== false ? 'checked' : ''} style="width:20px; height:20px;">
        </div>
        <div class="settings-row">
          <div><div class="sr-label">Color</div></div>
          <input type="checkbox" id="sLabelFieldColor" ${appSettings.labelFields?.color !== false ? 'checked' : ''} style="width:20px; height:20px;">
        </div>
        <div class="settings-row">
          <div><div class="sr-label">Storage box</div></div>
          <input type="checkbox" id="sLabelFieldBox" ${appSettings.labelFields?.box !== false ? 'checked' : ''} style="width:20px; height:20px;">
        </div>
        <div class="settings-row">
          <div><div class="sr-label">Category / type</div></div>
          <input type="checkbox" id="sLabelFieldCategory" ${appSettings.labelFields?.category ? 'checked' : ''} style="width:20px; height:20px;">
        </div>
        <div class="settings-row">
          <div><div class="sr-label">Brand</div></div>
          <input type="checkbox" id="sLabelFieldBrand" ${appSettings.labelFields?.brand ? 'checked' : ''} style="width:20px; height:20px;">
        </div>
        <button class="settings-save-btn" onclick="saveLabelSettings()">Save label settings</button>
        <div class="settings-success" id="labelSaveMsg">✓ Saved!</div>
      </div>

      <!-- STORAGE BOX LABELS -->
      <div class="settings-section">
        <h3>Register / print storage box labels</h3>
        <div class="ss-desc">Register a storage box by name and print its label right away — before any item is assigned to it. Uses the label size configured above.</div>
        ${(appSettings.storageBoxes || []).length === 0 ? `<div class="ss-desc" style="font-style:italic;">No boxes registered yet.</div>` : ''}
        ${(appSettings.storageBoxes || []).map((b, i) => `
          <div class="settings-row">
            <div><div class="sr-label">📦 ${escapeHtml(b.name)}</div><div class="sr-sub">Registered ${new Date(b.createdAt).toLocaleDateString('en-US')}</div></div>
            <div style="display:flex; gap:6px;">
              <button onclick="reprintStorageBox(${i})" style="background:var(--sage); color:white; border:none; border-radius:8px; padding:6px 12px; font-size:12px; cursor:pointer;">🖨️ Reprint</button>
              <button onclick="removeStorageBox(${i})" style="background:var(--terracotta); color:white; border:none; border-radius:8px; padding:6px 12px; font-size:12px; cursor:pointer;">🗑️ Remove</button>
            </div>
          </div>
        `).join('')}
        <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap; align-items:center;">
          <input type="text" id="sNewBoxName" placeholder="Box name/number" style="flex:1; min-width:140px; padding:8px 10px; border:1px solid var(--line); border-radius:8px; font-size:13px;">
          <button class="settings-save-btn" style="width:auto; margin:0;" onclick="registerAndPrintBox()">📦 Register & print</button>
        </div>
      </div>

      <!-- WALL MEASUREMENT MARKERS -->
      <div class="settings-section">
        <h3>Wall measurement markers</h3>
        <div class="ss-desc">Print 4 crosshair targets and mount them on a wall (measure center-to-center with a tape measure, once). The measurement tool can then calibrate itself by tapping the 4 markers in a photo instead of needing a tape measure in every shot. Use a wider spacing for bulkier items like dresses.</div>
        <div class="settings-row">
          <div><div class="sr-label">Horizontal spacing</div><div class="sr-sub">Inches, center to center (left ↔ right markers)</div></div>
          <input type="number" id="sMarkerSpacingH" value="${appSettings.wallMarkerSpacingHIn || 24}" min="4" max="120" step="0.5">
        </div>
        <div class="settings-row">
          <div><div class="sr-label">Vertical spacing</div><div class="sr-sub">Inches, center to center (top ↔ bottom markers)</div></div>
          <input type="number" id="sMarkerSpacingV" value="${appSettings.wallMarkerSpacingVIn || 24}" min="4" max="120" step="0.5">
        </div>
        <button class="settings-save-btn" onclick="saveWallMarkerSettings()">Save marker spacing</button>
        <div class="settings-success" id="markerSaveMsg">✓ Saved!</div>
        <button class="settings-save-btn" style="background:var(--sage); margin-top:10px;" onclick="openMarkerPrintModal()">🎯 Print a marker</button>
        <button class="settings-save-btn" style="background:var(--plum); margin-top:10px;" onclick="openCalibInstructionsModal()">📖 Calibration instructions</button>
      </div>

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
        <div id="ebaySetupResult" style="margin-top:10px;"></div>
      </div>

      <!-- DUPLICATE REGISTRATION NUMBERS (temporary tool) -->
      <div class="settings-section">
        <h3>Duplicate registration numbers</h3>
        <div class="ss-desc">Temporary tool: checks the loaded catalog for two items sharing the exact same registration/product code (e.g. two items both saved as #0089) — can happen when two devices add an item at almost the same time. New items now reserve their number from a shared counter so this shouldn't happen going forward; use this to find and fix any that already slipped through.</div>
        <button class="settings-save-btn" onclick="runDuplicateProductCodeAudit()">🔍 Check for duplicate numbers</button>
        <div id="duplicateCodesResult" style="margin-top:10px;"></div>
      </div>

      <!-- EBAY ERROR LIBRARY -->
      <div class="settings-section">
        <h3>eBay error library</h3>
        <div class="ss-desc">Every eBay publish error seen on this account, with how often it happened. Errors the app doesn't know how to fix yet are listed first, with the AI's explanation when it gave one — those are the ones to add to the library next.</div>
        <button class="settings-save-btn" onclick="runEbayErrorLibrary()">📚 Open eBay error library</button>
        <div id="ebayErrorLibraryResult" style="margin-top:10px;"></div>
      </div>

      <!-- EBAY LISTING AUDIT -->
      <div class="settings-section">
        <h3>eBay listing audit</h3>
        <div class="ss-desc">Fetches every listing that's actually live on eBay and cross-checks it against this catalog — flags listings with no matching item here (never imports them automatically), and listings whose live shipping policy doesn't match what the item says it should be.</div>
        <button class="settings-save-btn" onclick="runEbayAudit()">🔍 Audit eBay listings</button>
        <div id="ebayAuditResult" style="margin-top:10px;"></div>
        <button class="settings-save-btn" style="margin-top:10px; background:var(--sage);" onclick="runListFulfillmentPolicies()">📋 List my eBay shipping policies (find a policy's ID)</button>
        <div id="ebayPoliciesResult" style="margin-top:10px;"></div>
        <button class="settings-save-btn" style="margin-top:10px; background:var(--gold);" onclick="runBackfillDescriptions()">🩹 Backfill missing eBay descriptions</button>
        <div id="ebayBackfillResult" style="margin-top:10px;"></div>
      </div>

      <!-- EBAY SALE CHECK -->
      <div class="settings-section">
        <h3>eBay sale sync</h3>
        <div class="ss-desc">The app automatically checks for new eBay sales every time it opens and marks matching items as Sold. Use this to check right now instead of waiting to reopen the app.</div>
        <button class="settings-save-btn" onclick="checkEbaySalesNow(true)">🔄 Check for eBay sales now</button>
        <div id="ebaySalesCheckResult" style="margin-top:10px;"></div>
      </div>

      <!-- EBAY OFFERS TO WATCHERS -->
      <div class="settings-section">
        <h3>Offer discount to watchers</h3>
        <div class="ss-desc">Finds your eBay listings that have interested buyers (watchers or abandoned-cart) and lets you send them a discount offer, straight from eBay's own Negotiation feature.</div>
        <button class="settings-save-btn" onclick="findEligibleOffers()">🔔 Check for interested buyers</button>
        <div id="ebayOffersResult" style="margin-top:10px;"></div>
      </div>

    `;
  renderEbayConnectionStatus();
  renderPlatformsSettingsList();

  document.getElementById('signOutBtn')?.addEventListener('click', async () => {
    await window.authFns.signOut(window.auth);
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
