// The Settings save handlers (UI layer; v3.17.6, docs/modularization.md):
// prices and AI limit, labels, wall markers, shipping and carriers, listing
// text, auto-prep rules, and the AI counter resets. Moved out of main.js
// unchanged. Importing it registers the window.save*Settings handlers the
// Settings buttons call.
import { appSettings } from '../../modules/state.js';
import { saveSettings, resetAiCounter } from '../../data/settings-store.js';
import { renderSettings } from './settings-view.js';

window.savePriceSettings = async function(){
  appSettings.targetMarginPct = parseFloat(document.getElementById('sMarginPct').value) || 40;
  appSettings.minMarkupMultiplier = parseFloat(document.getElementById('sMarkupMulti').value) || 1.8;
  appSettings.aiUsageLimit = parseInt(document.getElementById('sAiLimit')?.value) || 500;
  appSettings.aiResetDayOfMonth = parseInt(document.getElementById('sAiResetDay')?.value) || 1;
  appSettings.aiScheduledReset = document.getElementById('sAiScheduled')?.value === 'true';
  await saveSettings();
  showSaveMsg('priceSaveMsg');
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
  };
  await saveSettings();
  showSaveMsg('labelSaveMsg');
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
    msg.textContent = `✓ Scheduled reset set for day ${day} of each month.`;
    msg.style.display = 'block';
    setTimeout(()=>{ msg.style.display='none'; msg.textContent='✓ Counter reset successfully.'; }, 3000);
  }
};

export function showSaveMsg(id){
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = 'block';
  setTimeout(()=> el.style.display = 'none', 2500);
}
