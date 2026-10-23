// The Settings save handlers (UI layer; v3.17.6, docs/modularization.md):
// prices and AI limit, labels, wall markers, shipping and carriers, listing
// text, auto-prep rules, and the AI counter resets. Moved out of main.js
// unchanged. Importing it registers the window.save*Settings handlers the
// Settings buttons call.
import { appSettings } from '../../modules/state.js';
import { saveSettings, saveSettingsFields, resetAiCounter } from '../../data/settings-store.js';
import { renderSettings } from './settings-view.js';
import { applyTheme, applyAccent, normalizeTheme } from '../theme.js';
import { isHexColor } from '../../domain/accent.js';
import { normalizePickMessage } from '../../domain/pick-messages.js';

window.savePriceSettings = async function(){
  appSettings.targetMarginPct = parseFloat(document.getElementById('sMarginPct').value) || 40;
  appSettings.minMarkupMultiplier = parseFloat(document.getElementById('sMarkupMulti').value) || 1.8;
  appSettings.aiUsageLimit = parseInt(document.getElementById('sAiLimit')?.value) || 500;
  appSettings.aiResetDayOfMonth = parseInt(document.getElementById('sAiResetDay')?.value) || 1;
  appSettings.aiScheduledReset = document.getElementById('sAiScheduled')?.value === 'true';
  await saveSettings();
  showSaveMsg('priceSaveMsg');
};

// AI usage (v3.22.0): its own Save button now that it's a separate group.
// Same fields savePriceSettings also writes, so either button works.
window.saveAiUsageSettings = async function(){
  appSettings.aiUsageLimit = parseInt(document.getElementById('sAiLimit')?.value) || 500;
  appSettings.aiResetDayOfMonth = parseInt(document.getElementById('sAiResetDay')?.value) || 1;
  appSettings.aiScheduledReset = document.getElementById('sAiScheduled')?.value === 'true';
  await saveSettings();
  showSaveMsg('aiSaveMsg');
};

window.saveLabelSettings = async function(){
  appSettings.labelWidthIn = parseFloat(document.getElementById('sLabelWidth').value) || 2.25;
  appSettings.labelHeightIn = parseFloat(document.getElementById('sLabelHeight').value) || 1.25;
  appSettings.labelFields = {
    box: document.getElementById('sLabelFieldBox').checked,
    name: document.getElementById('sLabelFieldName').checked,
    color: document.getElementById('sLabelFieldColor').checked,
    category: document.getElementById('sLabelFieldCategory').checked,
    brand: document.getElementById('sLabelFieldBrand').checked,
    barcode: document.getElementById('sLabelFieldBarcode').checked,
    storeName: document.getElementById('sLabelFieldStore').checked,
  };
  await saveSettings();
  showSaveMsg('labelSaveMsg');
};

// Pick list message (v3.27.24): only the pickMessage field is written, with
// merge, like the AI writing instructions.
window.savePickMessageSettings = async function(){
  const pm = normalizePickMessage({
    mode: document.getElementById('sPickMsgMode').value,
    text: document.getElementById('sPickMsgText')?.value,
  });
  const ok = await saveSettingsFields({ pickMessage: pm });
  showSaveMsg(ok ? 'pickMsgSaveMsg' : 'pickMsgErrMsg');
};
window.pickMessageCount = function(){
  const el = document.getElementById('sPickMsgText');
  const out = document.getElementById('pickMsgCount');
  if (el && out) out.textContent = `${el.value.length} / ${el.maxLength}`;
};
// Shows the text box only for the Fixed mode.
window.pickMessageModeChange = function(){
  const mode = document.getElementById('sPickMsgMode').value;
  const wrap = document.getElementById('pickMsgFixedWrap');
  if (wrap) wrap.hidden = mode !== 'fixed';
};

// Appearance (v3.21.0): applied at once, then saved for the business.
window.saveAppearance = async function(key){
  appSettings.theme = normalizeTheme(key);
  applyTheme(appSettings.theme);
  document.querySelectorAll('.theme-option').forEach(el => {
    el.classList.toggle('active', el.querySelector('input').value === appSettings.theme);
  });
  await saveSettings();
  showSaveMsg('themeSaveMsg');
};

// Store identity (v3.22.1). main.js redraws the header and sidebar on
// 'brandchange'.
window.saveStoreName = async function(value){
  appSettings.storeName = String(value || '').trim().slice(0, 40);
  document.dispatchEvent(new CustomEvent('brandchange'));
  await saveSettings();
  showSaveMsg('storeSaveMsg');
};

// dataUrl: a shrunk data: image URL, or '' to remove the logo.
window.saveStoreLogo = async function(dataUrl){
  appSettings.storeLogo = typeof dataUrl === 'string' && dataUrl.startsWith('data:image/') ? dataUrl : '';
  document.dispatchEvent(new CustomEvent('brandchange'));
  await saveSettings();
  renderSettings();
  showSaveMsg('storeSaveMsg');
};

// hex: '#RRGGBB', or '' for the theme's own colors.
window.saveAccent = async function(hex){
  appSettings.accentColor = isHexColor(hex) ? hex.toUpperCase() : '';
  applyAccent(appSettings.accentColor);
  await saveSettings();
  renderSettings();
  showSaveMsg('accentSaveMsg');
};

// The "+" shortcuts (v3.26.7): saved as soon as the box changes. The "+" on
// Home and Catalog follows the event; a failed save puts the box back.
window.saveFabShortcuts = async function(on){
  const ok = await saveSettingsFields({ fabShortcuts: !!on });
  const box = document.getElementById('sFabShortcuts');
  const msg = document.getElementById('fabShortcutsSaveMsg');
  if (box && !ok) box.checked = !on;
  if (msg){
    msg.textContent = ok ? 'Saved' : "Couldn't save. Check your connection and try again.";
    msg.classList.toggle('error', !ok);
    msg.style.display = 'block';
    clearTimeout(msg._t);
    if (ok) msg._t = setTimeout(() => { msg.style.display = 'none'; }, 1800);
  }
  if (ok) document.dispatchEvent(new CustomEvent('fabshortcutschange'));
};

window.saveWallMarkerSettings = async function(){
  appSettings.wallMarkerSpacingHIn = parseFloat(document.getElementById('sMarkerSpacingH').value) || 24;
  appSettings.wallMarkerSpacingVIn = parseFloat(document.getElementById('sMarkerSpacingV').value) || 24;
  await saveSettings();
  showSaveMsg('markerSaveMsg');
};

window.saveShippingSettings = async function(){
  appSettings.defaultCarrier = document.getElementById('sCarrier').value;
  appSettings.sellerPaysShipping = document.getElementById('sShippingPayer').value === 'seller';
  appSettings.defaultWeightLb = parseFloat(document.getElementById('sDefaultWeight').value) || 0.5;
  await saveSettings();
  showSaveMsg('shippingSaveMsg');
};

window.saveListingTextSettings = async function(){
  appSettings.listingStandardText = document.getElementById('sListingText').value.trim();
  await saveSettings();
  showSaveMsg('listingTextSaveMsg');
};

// AI writing instructions (v3.24.1): only this field is written (merge).
window.saveAiInstructionsSettings = async function(){
  const el = document.getElementById('sAiInstructions');
  const ok = await saveSettingsFields({ aiInstructions: el.value.trim().slice(0, 1500) });
  showSaveMsg(ok ? 'aiInstrSaveMsg' : 'aiInstrErrMsg');
};
window.aiInstructionsCount = function(){
  const el = document.getElementById('sAiInstructions');
  const out = document.getElementById('aiInstrCount');
  if (el && out) out.textContent = `${el.value.length} / ${el.maxLength}`;
};
// Adds an example on its own line (skipped if it's already there).
window.aiInstructionsAdd = function(btn){
  const el = document.getElementById('sAiInstructions');
  const t = btn.dataset.text;
  if (!el || !t || el.value.includes(t)) return;
  const next = (el.value.trim() ? el.value.trim() + '\n' : '') + t;
  if (next.length > el.maxLength) return;
  el.value = next;
  window.aiInstructionsCount();
  el.focus();
};

window.addCustomCarrier = async function(){
  const name = document.getElementById('sNewCarrierName').value.trim();
  const basePrice = parseFloat(document.getElementById('sNewCarrierBase').value);
  const perLbPrice = parseFloat(document.getElementById('sNewCarrierPerLb').value) || 0;
  if (!name){ alert('Enter a carrier name.'); return; }
  if (isNaN(basePrice) || basePrice < 0){ alert('Enter a valid base price.'); return; }
  appSettings.customCarriers = [...(appSettings.customCarriers || []), { name, basePrice, perLbPrice }];
  await saveSettings();
  renderSettings();
};

window.removeCustomCarrier = async function(index){
  appSettings.customCarriers = (appSettings.customCarriers || []).filter((_, i) => i !== index);
  await saveSettings();
  renderSettings();
};

window.savePrepSettings = async function(){
  const CATEGORIES = ['Clothing','Shoes','Accessories','Electronics','Home & Decor','Collectibles','Toys','Books','Other'];
  const rules = {};
  CATEGORIES.forEach(cat => {
    const el = document.getElementById('sPrep_' + cat.replace(/[^a-z]/gi,'_'));
    if (el) rules[cat] = el.value;
  });
  appSettings.autoPrepRules = rules;
  await saveSettings();
  showSaveMsg('prepSaveMsg');
};

window.handleImmediateReset = async function(){
  if (!confirm('Reset the AI usage counter to 0 right now? This cannot be undone.')) return;
  await resetAiCounter('immediate');
  renderSettings();
  const msg = document.getElementById('resetConfirmMsg');
  if (msg){ msg.style.display = 'block'; setTimeout(()=>msg.style.display='none', 3000); }
};

window.handleScheduledReset = async function(){
  const day = parseInt(document.getElementById('sAiResetDay')?.value) || 1;
  appSettings.aiScheduledReset = true;
  appSettings.aiResetDayOfMonth = day;
  await saveSettings();
  const msg = document.getElementById('resetConfirmMsg');
  if (msg){
    msg.textContent = `Scheduled reset set for day ${day} of each month.`;
    msg.style.display = 'block';
    setTimeout(()=>{ msg.style.display='none'; msg.textContent='Counter reset.'; }, 3000);
  }
};

export function showSaveMsg(id){
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = 'block';
  setTimeout(()=> el.style.display = 'none', 2500);
}
