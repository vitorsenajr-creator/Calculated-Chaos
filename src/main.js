import './config/firebase.js';
import { APP_VERSION, APP_VERSION_DATE } from './modules/version.js';
import { bizCol, bizDoc, loadActiveBusiness } from './modules/biz.js';
import { buildListingTitle, buildListingDescription as buildListingDescriptionText } from './domain/listing-copy.js';
import { openLightbox, isLightboxOpen, initLightbox } from './ui/lightbox.js';
import { openBatchLabelModal, initPrintModal } from './ui/labels/print-modal.js';
import { initStorageBoxes } from './ui/labels/storage-boxes.js';
import { initQuickLabels } from './ui/labels/quick-labels.js';
import { initStockTransfer, refreshStockTransferBoxListIfOpen } from './ui/labels/stock-transfer.js';
import { initPrint } from './platform/print.js';
import { saveOrShareFile, downloadBlob, downloadUrl } from './platform/files.js';
import {
  loadEbayConnection, ensureEbayConnected,
  checkEbaySalesNow, endEbayListingIfSold, listItemOnEbay, showBulkEbayPreflight,
  ebayConnectFlowPending,
  ebayPostSoldMessageLines,
} from './ebay-api.js';
import {
  MAX_PHOTOS, MAX_PHOTO_DIM, PHOTO_QUALITY,
  PLATFORM_FEES, PLATFORM_LABEL, PLATFORM_NAME, PLATFORM_COLOR, PLATFORM_FAVICON,
  CONDITION_FACTOR, CONDITION_LABEL, POSHMARK_STYLE_TAGS,
  PREP_LABEL, BASE_CATEGORY_VALUE, DAILY_QUOTES,
  PRESET_CATEGORIES, PRESET_COLORS, PRESET_CLOTHING_TYPES,
} from './modules/constants.js';
import {
  nextProductCode as _nextProductCode,
  getAllStorageBoxes as _getAllStorageBoxes,
  getAllSizes as _getAllSizes,
  getSizeSuggestionsForType as _getSizeSuggestionsForType,
  getAllSources as _getAllSources,
  getAllCategories as _getAllCategories,
  getAllColors as _getAllColors,
  getAllClothingTypes as _getAllClothingTypes,
} from './modules/catalog-lookups.js';
import { compressImage } from './modules/image-compression.js';
import { escapeHtml, toTitleCase, daysSince, daysToSell, uid, csvEscape, statusLabel, attachCurrencyFormatting } from './modules/format-utils.js';
import {
  getCategoryPriceHistory as _getCategoryPriceHistory,
  getPriceReference as _getPriceReference,
  suggestPrice as _suggestPrice,
  estimateShipping as _estimateShipping,
  platformFee as _platformFee,
  projectedProfit as _projectedProfit,
} from './modules/pricing.js';
import {
  buildFullInventoryRows, buildSoldItemsRows,
  buildCategoryReportRows, buildExcelSheetsData,
} from './modules/reports.js';
import { DEFAULT_SETTINGS } from './modules/settings.js';
import {
  loadSettings, saveSettings, incrementAiUsage, aiUsageRemaining,
} from './data/settings-store.js';
import { renderSettings, renderEbayConnectionStatus } from './ui/settings/index.js';
import { initHomeView, renderHome } from './ui/home/home-view.js';
import { initStockView, renderStock } from './ui/stock/stock-view.js';
import { initFinanceView, renderFinance } from './ui/finance/finance-view.js';
import { initUpdateBanner } from './ui/update-banner.js';
import { applyTheme, applyAccent, applyLastTheme, currentTheme } from './ui/theme.js';
import { CATALOG_SORTS, sortCatalog } from './domain/catalog-sort.js';
import { WEEK_TAGS, weekTagIndex } from './domain/week-tags.js';
import { items, setItems, appSettings, setAppSettings } from './modules/state.js';
import {
  isIncomplete, missingFields,
  filtersActiveCount as _filtersActiveCount,
  applyFilters as _applyFilters,
} from './modules/catalog-filters.js';
import {
  getAllPlatforms as _getAllPlatforms,
  getPlatformLabel as _getPlatformLabel,
  getPlatformColor as _getPlatformColor,
} from './modules/platforms.js';
import {
  initSoldConfirmModal,
  showBulkSoldConfirm as _showBulkSoldConfirm,
} from './modules/sold-confirm.js';
import { initNarrationCapture } from './modules/narration-capture.js';
import { matchAllowedValue, isSizeAspect } from './modules/ebay-aspect-match.js';
import { suggestEbayTypeValue, isTypeAspect } from './modules/ebay-type-map.js';
import {
  normalizeStyleTags, AI_GENDER_VALUES, AI_SIZE_TYPE_VALUES, LISTING_DESC_LIMIT,
} from './modules/ai-item.js';
import {
  reserveNextProductCode, findItemsWithProductCode,
} from './modules/product-code-bank.js';
import { jsonAuthHeaders } from './modules/api-auth.js';
import { loadAdminClaim } from './modules/admin-claim.js';
import { sendVerificationEmail, refreshEmailVerified, tokenEmailVerified } from './modules/email-verification.js';

export const app = (function(){
  // APP_VERSION / APP_VERSION_DATE live in modules/version.js (shared with
  // the Developer Panel) — bump them there.

  setAppSettings({ ...DEFAULT_SETTINGS });
  let itemsLoaded = false; // true once the initial Firestore fetch in loadItems() resolves
  let currentEditId = null;
  let currentDraftId = null; // set when the item modal was opened from a Photo Session draft, so a successful save knows to delete the source draft doc
  let openedFromBulkReview = false; // set when the item modal was opened via "Edit" from the bulk eBay preflight's blocked/needs-review lists — a successful save then offers to list it immediately instead of making her redo the whole bulk flow
  // 'owner' (default, full access) or 'employee' (Catalog only — see
  // applyRoleRestrictions()). Set from the signed-in user's Firestore doc
  // right after login, before anything else renders.
  let currentUserRole = 'owner';
  let draftItems = []; // Photo Session groups awaiting cataloging — own Firestore collection, never mixed into `items`
  // Catalog sub-tab ('all' | 'drafts') and sort order (v3.20.1); the sort
  // is a per-device convenience kept in localStorage (guarded: storage can
  // be blocked in private mode).
  let catalogSection = 'all';
  let catalogSort = (() => { try{ return localStorage.getItem('cc.catalog.sort') || 'newest'; }catch(e){ return 'newest'; } })();
  let filterPanelOpen = false; // survives re-renders (e.g. picking a filter chip), unlike the old plain classList.toggle which reset on every re-render
  let currentPhotos = []; // dataUrls (compressed)
  let currentMeasurements = null; // {type, values:{label:inches}, photo:dataUrl} | null
  let currentStatus = 'catalogado';
  let currentPrep = 'ready';
  // True whenever the Product Code field still holds the auto-filled
  // suggestion (fillNextProductCode) rather than something she typed/edited
  // herself — decides whether Save reserves a fresh number atomically
  // (new item, untouched suggestion) or just checks the typed value isn't
  // already used by another item (see "duplicate registration numbers" in
  // CLAUDE.md). Set in openModal(), cleared by the input listener below.
  let productCodeIsAutoSuggested = false;
  let activeFilters = { status:null, category:null, incomplete:false, needsPhoto:false, box:null, notSold:false, size:null, platformsInclude:[], platformsExclude:[] };
  let bulkSelectMode = false;
  let bulkSelectedIds = new Set();
  let searchQuery = '';
  let lastUsedBox = ''; // pre-fills the storage box field with whatever was used last
  let lastUsedSource = ''; // pre-fills the source field with whatever was used last
  let lastUsedCategory = 'Clothing'; // pre-fills the category field with whatever was used last
  let lastUsedEbayCategory = null; // { id, path } — carries over between items during a Quick Catalog session only

  // ---------- PLATFORM MANAGEMENT (Settings → Platforms) ----------
  // Built-in platforms keep fixed keys (eBay especially has real API
  // integration logic keyed to that exact string) but her fee %s can be
  // overridden; customPlatforms are entirely her own, addable/removable.
  // Every place that used to read PLATFORM_LABEL/PLATFORM_FEES/PLATFORM_COLOR
  // directly should go through these instead so custom platforms show up
  // everywhere built-ins do (filters, badges, the Platform dropdown, fee calc).
  function getAllPlatforms(){ return _getAllPlatforms(appSettings); }
  function getPlatformLabel(key){ return _getPlatformLabel(appSettings, key); }
  function getPlatformColor(key){ return _getPlatformColor(appSettings, key); }

  function getDailyQuote(){
    const today = new Date();
    const dayIndex = Math.floor(today.getTime() / 86400000); // days since epoch
    return DAILY_QUOTES[dayIndex % DAILY_QUOTES.length];
  }

  // Real, computed observations about the current inventory — not a fixed
  // list of text, but generated fresh from whatever `items` holds right now.
  // Each one returns null if there isn't enough data to say anything useful,
  // so we never show a hollow or misleading insight.
  function computePerformanceInsights(){
    const insights = [];
    const active = items.filter(i => i.status !== 'vendido');
    const sold = items.filter(i => i.status === 'vendido');

    // Slow movers
    const stale = active.filter(i => daysSince(i.createdAt || Date.now()) > 30);
    if (stale.length){
      insights.push(`${stale.length} item${stale.length===1?'':'s'} have been sitting 30+ days — a price cut or relist might move them.`);
    }

    // Best category by realized margin (needs at least a couple sold items to mean anything)
    if (sold.length >= 3){
      const byCat = {};
      sold.forEach(i => {
        if (!byCat[i.category]) byCat[i.category] = { profit: 0, count: 0 };
        byCat[i.category].profit += (i.netProfit || 0);
        byCat[i.category].count += 1;
      });
      const ranked = Object.entries(byCat).sort((a,b) => (b[1].profit/b[1].count) - (a[1].profit/a[1].count));
      if (ranked.length){
        const [cat, stat] = ranked[0];
        insights.push(`${cat} is your best earner so far — averaging $${(stat.profit/stat.count).toFixed(0)} profit per sale.`);
      }
    }

    // Incomplete items blocking listing
    const incompleteCount = active.filter(isIncomplete).length;
    if (incompleteCount){
      insights.push(`${incompleteCount} item${incompleteCount===1?'':'s'} still ${incompleteCount===1?'is':'are'} missing photos, cost, or measurements before ${incompleteCount===1?'it can':'they can'} list.`);
    }

    // Projected profit sitting in catalog
    const projectedTotal = active.reduce((s,i)=> s + projectedProfit(i), 0);
    if (active.length && projectedTotal > 0){
      insights.push(`$${projectedTotal.toFixed(0)} in projected profit is sitting in your current stock — ${active.length} item${active.length===1?'':'s'} not yet sold.`);
    }

    return insights;
  }

  function getTodaysHeaderMessage(){
    const today = new Date();
    const dayIndex = Math.floor(today.getTime() / 86400000);
    // Alternate day by day between the motivational quote and a computed
    // insight — if there's no insight available yet (e.g. brand new
    // catalog with nothing sold), fall back to the quote so the header is
    // never empty.
    if (dayIndex % 2 === 0){
      return { text: getDailyQuote(), isInsight: false };
    }
    const insights = computePerformanceInsights();
    if (insights.length){
      return { text: insights[dayIndex % insights.length], isInsight: true };
    }
    return { text: getDailyQuote(), isInsight: false };
  }


  // ---------- STORAGE (Firebase Firestore) ----------
  // Each item is stored as its own document in the 'items' collection,
  // so a large catalog (with photos) never approaches Firestore's 1MB-per-document limit.
  async function loadItems(){
    try{
      const { getDocs } = window.firestoreFns;
      const snap = await getDocs(bizCol('items'));
      setItems(snap.docs.map(d => d.data()));
      // Migration: the listing title/description fields used to be named
      // poshmarkTitle/poshmarkDescription (back when eBay had its own
      // separate, broken description builder, before this became a
      // shared cross-platform field) — normalize older saved items to the
      // new field names in memory. Not written back here; it happens
      // naturally the next time she saves that item.
      items.forEach(i => {
        if (!i.listingTitle && i.poshmarkTitle) i.listingTitle = i.poshmarkTitle;
        if (!i.listingDescription && i.poshmarkDescription) i.listingDescription = i.poshmarkDescription;
      });
    }catch(e){
      console.error('Load error', e);
      setItems([]);
    }
    // lastUsedSource/lastUsedBox used to only update in-memory when an item
    // was saved THIS session — so after any page reload they'd reset to
    // blank even though 288+ items already have a source on file. Seed them
    // from the most recently catalogued item instead, so a fresh reload
    // still remembers the last supplier/box used.
    const mostRecent = [...items].sort((a,b) => (b.createdAt||0) - (a.createdAt||0));
    const withSource = mostRecent.find(i => i.source && i.source.trim());
    if (withSource) lastUsedSource = withSource.source.trim();
    const withBox = mostRecent.find(i => i.storageBox && i.storageBox.trim());
    if (withBox) lastUsedBox = withBox.storageBox.trim();
    const withCategory = mostRecent.find(i => i.category && i.category.trim());
    if (withCategory) lastUsedCategory = withCategory.category.trim();
    itemsLoaded = true;
    renderAll();
  }

  async function saveItem(itemData){
    try{
      const { setDoc } = window.firestoreFns;
      await setDoc(bizDoc('items', itemData.id), itemData);
    }catch(e){
      console.error('Save error', e);
      const reason = (e && e.message) ? e.message : String(e);
      alert("Couldn't save this item.\n\nReason: " + reason);
      throw e;
    }
  }

  async function deleteItemFromDb(itemId){
    try{
      const { deleteDoc } = window.firestoreFns;
      await deleteDoc(bizDoc('items', itemId));
    }catch(e){
      console.error('Delete error', e);
      alert("Couldn't delete right now — please check your connection and try again.");
      throw e;
    }
  }

  // ---------- PHOTO SESSION DRAFTS (own Firestore collection) ----------
  async function loadDrafts(){
    try{
      const { getDocs } = window.firestoreFns;
      const snap = await getDocs(bizCol('drafts'));
      draftItems = snap.docs.map(d => d.data());
    }catch(e){
      console.error('Load drafts error', e);
      draftItems = [];
    }
  }

  async function saveDraftToDb(draft){
    try{
      const { setDoc } = window.firestoreFns;
      await setDoc(bizDoc('drafts', draft.id), draft);
    }catch(e){
      console.error('Save draft error', e);
      const reason = (e && e.message) ? e.message : String(e);
      alert("Couldn't save this photo batch as a draft.\n\nReason: " + reason + "\n\nMake sure the 'drafts' collection has been added to your Firestore security rules (see README).");
      throw e;
    }
  }

  async function deleteDraftFromDb(draftId){
    try{
      const { deleteDoc } = window.firestoreFns;
      await deleteDoc(bizDoc('drafts', draftId));
    }catch(e){
      console.error('Delete draft error', e);
    }
  }

  // ---------- PHOTO HOSTING AT SAVE TIME ----------
  // Photos used to be stored as base64 text directly inside the Firestore
  // item document — Firestore has a hard 1MB-per-document limit, and photos
  // straight from a phone camera easily blow past that with several photos
  // per item. This uploads any not-yet-hosted photo to Firebase Storage and
  // replaces it with a lightweight https:// link instead, so the Firestore
  // document itself stays tiny no matter how many/large the photos are.
  // Already-hosted photos (https:// links, from a prior save) are left
  // untouched — cheap and instant.
  async function ensurePhotosHostedForSave(itemId, photosArray, onProgress){
    if (!photosArray || !photosArray.length) return [];
    const { ref, uploadString, getDownloadURL } = window.storageFns;
    const hosted = [];
    for (let i = 0; i < photosArray.length; i++){
      const p = photosArray[i];
      if (typeof p === 'string' && p.startsWith('http')){
        hosted.push(p);
        if (onProgress) onProgress(i + 1, photosArray.length);
        continue;
      }
      const path = `item-photos/${itemId}/${i}_${Date.now()}.jpg`;
      const fileRef = ref(window.storage, path);
      await uploadString(fileRef, p, 'data_url');
      const url = await getDownloadURL(fileRef);
      hosted.push(url);
      if (onProgress) onProgress(i + 1, photosArray.length);
    }
    return hosted;
  }

  function setSaveProgress(pct, label){
    const area = document.getElementById('saveProgressArea');
    const bar = document.getElementById('saveProgressBar');
    const lbl = document.getElementById('saveProgressLabel');
    if (!area) return;
    if (pct === null){
      area.style.display = 'none';
      return;
    }
    area.style.display = 'block';
    bar.style.width = Math.max(4, Math.min(100, pct)) + '%';
    if (label) lbl.textContent = label;
  }

  // ---------- CURRENCY INPUT FORMATTING ----------
  // attachCurrencyFormatting now lives in modules/format-utils.js (imported
  // above) — pure DOM wiring, no app-state dependency, moved verbatim.

  // ---------- PRODUCT CODE & STORAGE BOX HELPERS ----------
  // nextProductCode/getAllStorageBoxes/getAllSizes/getSizeSuggestionsForType/
  // getAllSources/getAllCategories/getAllColors/getAllClothingTypes now live
  // in modules/catalog-lookups.js, parameterized on items — these wrappers
  // keep the original no-items-arg call sites unchanged.
  function nextProductCode(){ return _nextProductCode(items); }

  // The catalog only briefly needs to keep loading in the background (so the
  // app still opens instantly even after being away for hours) — but that
  // means items may not be loaded yet the instant someone opens "Add item".
  // Rather than confidently pre-filling a wrong number (e.g. #0001) from an
  // empty items list, show a placeholder and fill in the real one the moment
  // loading finishes, without blocking anything else in the app.
  function fillNextProductCode(inputEl){
    if (itemsLoaded){
      inputEl.value = nextProductCode();
      return;
    }
    inputEl.value = 'loading…';
    const waitAndFill = () => {
      if (itemsLoaded){
        if (inputEl.value === 'loading…') inputEl.value = nextProductCode();
      } else {
        setTimeout(waitAndFill, 100);
      }
    };
    setTimeout(waitAndFill, 100);
  }

  function getAllStorageBoxes(){
    const fromItems = _getAllStorageBoxes(items);
    const registered = (appSettings.storageBoxes || []).map(b => b.name);
    return Array.from(new Set([...fromItems, ...registered])).sort((a,b)=> a.localeCompare(b, undefined, {numeric:true}));
  }
  function getAllSizes(clothingType){ return _getAllSizes(items, clothingType); }
  function getSizeSuggestionsForType(clothingType){ return _getSizeSuggestionsForType(items, clothingType); }
  function getAllSources(){ return _getAllSources(items); }

  // iOS Safari doesn't show suggestions for <input list="..."> the way
  // desktop browsers do — the native datalist dropdown effectively never
  // appears on iPhone. This is a small custom dropdown built by hand so
  // "type and see past suppliers" actually works on the device this app is
  // mainly used on.
  function setupSourceAutocomplete(){
    const input = document.getElementById('fSource');
    const box = document.getElementById('sourceSuggestions');
    if (!input || !box) return;

    function renderSuggestions(){
      const q = input.value.trim().toLowerCase();
      const all = getAllSources();
      const matches = (q ? all.filter(s => s.toLowerCase().includes(q)) : all).slice(0, 8);
      if (!matches.length){ box.style.display = 'none'; box.innerHTML = ''; return; }
      box.innerHTML = matches.map(s => `<div class="source-suggestion-item" style="padding:9px 12px; cursor:pointer; font-size:14px;">${escapeHtml(s)}</div>`).join('');
      box.style.display = 'block';
      box.querySelectorAll('.source-suggestion-item').forEach((el, i) => {
        el.addEventListener('mousedown', (e) => {
          e.preventDefault(); // fires before input's blur, so the click isn't lost
          input.value = matches[i];
          box.style.display = 'none';
          renderEbaySizeCheck();
        });
      });
    }

    input.addEventListener('focus', renderSuggestions);
    input.addEventListener('input', renderSuggestions);
    input.addEventListener('input', () => renderEbaySizeCheck());
    input.addEventListener('change', () => renderEbaySizeCheck());
    input.addEventListener('blur', () => { setTimeout(() => { box.style.display = 'none'; }, 150); });
  }

  // Same reasoning as Source above — Size is too varied (letters, numbers,
  // waist/inseam combos, shoe sizes...) for a fixed dropdown, so this reuses
  // past sizes as tap-to-fill suggestions instead.
  function setupSizeAutocomplete(){
    const input = document.getElementById('fSize');
    const box = document.getElementById('sizeSuggestions');
    if (!input || !box) return;

    function renderSuggestions(){
      const q = input.value.trim().toLowerCase();
      const typeSelectVal = document.getElementById('fClothingType')?.value || '';
      const clothingType = typeSelectVal === '__other__'
        ? (document.getElementById('fClothingTypeOther')?.value.trim() || '')
        : typeSelectVal;
      // Sizing conventions differ a lot by garment (jeans use waist numbers,
      // tops use S/M/L, shoes use their own numbers) — scope suggestions to
      // sizes previously used for this same Clothing Type. If nothing's been
      // catalogued yet for that type (or no type is picked), fall back to
      // every size ever used rather than showing an empty list.
      const scoped = clothingType ? getSizeSuggestionsForType(clothingType) : [];
      const all = scoped.length ? scoped : getAllSizes();
      const matches = (q ? all.filter(s => s.toLowerCase().includes(q)) : all).slice(0, 12);
      if (!matches.length){ box.style.display = 'none'; box.innerHTML = ''; return; }
      box.innerHTML = matches.map(s => `<div class="size-suggestion-item" style="padding:9px 12px; cursor:pointer; font-size:14px;">${escapeHtml(s)}</div>`).join('');
      box.style.display = 'block';
      box.querySelectorAll('.size-suggestion-item').forEach((el, i) => {
        el.addEventListener('mousedown', (e) => {
          e.preventDefault(); // fires before input's blur, so the click isn't lost
          input.value = matches[i];
          box.style.display = 'none';
        });
      });
    }

    input.addEventListener('focus', renderSuggestions);
    input.addEventListener('input', renderSuggestions);
    input.addEventListener('blur', () => { setTimeout(() => { box.style.display = 'none'; }, 150); });
  }

  function getAllCategories(){ return _getAllCategories(items); }
  // Reads the Category field's real value, resolving "__other__" to whatever
  // was typed into the reveal field — same idea as the Color/Clothing Type helpers.
  function getCategoryValue(){
    const sel = document.getElementById('fCategory')?.value;
    return sel === '__other__' ? (document.getElementById('fCategoryOther')?.value.trim() || '') : (sel || '');
  }

  function getAllColors(){ return _getAllColors(items); }
  function getAllClothingTypes(){ return _getAllClothingTypes(items); }

  // Default shipping package for clothing items — applied automatically when
  // Category is "Clothing" and the weight/dimensions fields are still empty,
  // so Jasmine doesn't have to type the same box size for every garment.
  const DEFAULT_CLOTHING_SHIPPING = { weight: 2, length: 12, width: 12, height: 2 };
  function applyDefaultClothingShippingIfEmpty(){
    const wEl = document.getElementById('fWeight'), lEl = document.getElementById('fLen'), wiEl = document.getElementById('fWid'), hEl = document.getElementById('fHei');
    if (!wEl || !lEl || !wiEl || !hEl) return;
    const allEmpty = !wEl.value && !lEl.value && !wiEl.value && !hEl.value;
    if (!allEmpty) return;
    wEl.value = DEFAULT_CLOTHING_SHIPPING.weight;
    lEl.value = DEFAULT_CLOTHING_SHIPPING.length;
    wiEl.value = DEFAULT_CLOTHING_SHIPPING.width;
    hEl.value = DEFAULT_CLOTHING_SHIPPING.height;
  }

  // eBay's "Size Type" item aspect (Regular/Plus/Petite/Tall/Big & Tall/...)
  // defaults to "Regular" for clothing — the overwhelming common case — so
  // she isn't stuck typing it on every single garment. Only fills it when
  // nothing is set yet, so it never clobbers a value she (or the AI
  // analysis) already chose. Also nudges the aspect's own <select> if it's
  // already rendered on screen, so the default shows up immediately instead
  // of only taking effect on next render.
  function applyDefaultSizeTypeIfEmpty(){
    if (currentEbayAspects['Size Type']) return;
    currentEbayAspects['Size Type'] = 'Regular';
    const sizeTypeEl = document.querySelector('[data-aspect="Size Type"]');
    if (sizeTypeEl) sizeTypeEl.value = 'Regular';
  }

  // ---------- IMAGE COMPRESSION ----------
  // compressImage now lives in modules/image-compression.js — pure browser-
  // API function, imported directly above (no wrapper needed).

  // ---------- PRICING ENGINE ----------
  // Pricing engine now lives in modules/pricing.js, parameterized on
  // items/appSettings; these are thin wrappers so every existing call site
  // in this file (there are many) keeps working unchanged.
  function getCategoryPriceHistory(category){ return _getCategoryPriceHistory(items, category); }
  function getPriceReference(item){ return _getPriceReference(items, item); }
  function suggestPrice(item){ return _suggestPrice(items, item); }
  function estimateShipping(item){ return _estimateShipping(appSettings, item); }
  function platformFee(platform, price){ return _platformFee(appSettings, platform, price); }

  // ---------- PROJECTED PROFIT ----------
  function projectedProfit(item){ return _projectedProfit(items, appSettings, item); }

  // ---------- COMPLETENESS CHECK ----------
  // isIncomplete/missingFields now live in modules/catalog-filters.js
  // (imported above) — pure, no closure dependency, moved verbatim.

  // ---------- RENDER: FILTER PANEL ----------
  function renderFilterPanel(){
    const cats = Object.keys(BASE_CATEGORY_VALUE);
    const boxes = getAllStorageBoxes();
    const sizes = getAllSizes();
    const panel = document.getElementById('filterPanel');
    panel.innerHTML = `
      <div class="filter-group">
        <div class="fg-label">Status</div>
        <div class="filter-chips" id="statusChips">
          ${['catalogado','anunciado','vendido'].map(s => `<div class="filter-chip ${activeFilters.status===s?'active':''}" data-filter-status="${s}">${statusLabel(s)}</div>`).join('')}
        </div>
      </div>
      <div class="filter-group">
        <div class="fg-label">Category</div>
        <div class="filter-chips" id="catChips">
          ${cats.map(c => `<div class="filter-chip ${activeFilters.category===c?'active':''}" data-filter-cat="${c}">${c}</div>`).join('')}
        </div>
      </div>
      ${boxes.length ? `
      <div class="filter-group">
        <div class="fg-label">Storage box</div>
        <div class="filter-chips" id="boxChips">
          ${boxes.map(b => `<div class="filter-chip ${activeFilters.box===b?'active':''}" data-filter-box="${escapeHtml(b)}">📦 ${escapeHtml(b)}</div>`).join('')}
        </div>
      </div>` : ''}
      ${sizes.length ? `
      <div class="filter-group">
        <div class="fg-label">Size</div>
        <div class="filter-chips" id="sizeChips">
          ${sizes.map(s => `<div class="filter-chip ${activeFilters.size===s?'active':''}" data-filter-size="${escapeHtml(s)}">${escapeHtml(s)}</div>`).join('')}
        </div>
      </div>` : ''}
      <div class="filter-group">
        <div class="fg-label">Platform <span style="font-weight:400; font-size:11px; opacity:0.7;">— tap once for "on this", twice for "NOT on this"</span></div>
        <div class="filter-chips" id="platformChips">
          ${getAllPlatforms().map(p => {
            const isIncluded = activeFilters.platformsInclude.includes(p.key);
            const isExcluded = activeFilters.platformsExclude.includes(p.key);
            const cls = isIncluded ? 'filter-chip active' : isExcluded ? 'filter-chip platform-chip-excluded' : 'filter-chip';
            const label = isExcluded ? `NOT ${p.label}` : p.label;
            return `<div class="${cls}" data-filter-platform="${p.key}">${escapeHtml(label)}</div>`;
          }).join('')}
        </div>
      </div>
      <div class="filter-group">
        <div class="fg-label">Attention needed</div>
        <div class="filter-chips">
          <div class="filter-chip warn-chip ${activeFilters.incomplete?'active':''}" id="incompleteChip">⚠ Missing info</div>
          <div class="filter-chip warn-chip ${activeFilters.needsPhoto?'active':''}" id="needsPhotoChip">📷 Needs photos</div>
          <div class="filter-chip warn-chip ${activeFilters.noPrice?'active':''}" id="noPriceChip">No price</div>
          <div class="filter-chip warn-chip ${activeFilters.stale?'active':''}" id="staleChip">Listed 30+ days</div>
        </div>
      </div>
      <span class="filter-clear" id="clearFiltersBtn">Clear all filters</span>
    `;

    panel.querySelectorAll('[data-filter-status]').forEach(chip => {
      chip.addEventListener('click', () => {
        const s = chip.dataset.filterStatus;
        activeFilters.status = activeFilters.status === s ? null : s;
        renderAll();
      });
    });
    panel.querySelectorAll('[data-filter-cat]').forEach(chip => {
      chip.addEventListener('click', () => {
        const c = chip.dataset.filterCat;
        activeFilters.category = activeFilters.category === c ? null : c;
        renderAll();
      });
    });
    panel.querySelectorAll('[data-filter-box]').forEach(chip => {
      chip.addEventListener('click', () => {
        const b = chip.dataset.filterBox;
        activeFilters.box = activeFilters.box === b ? null : b;
        renderAll();
      });
    });
    panel.querySelectorAll('[data-filter-size]').forEach(chip => {
      chip.addEventListener('click', () => {
        const s = chip.dataset.filterSize;
        activeFilters.size = activeFilters.size === s ? null : s;
        renderAll();
      });
    });
    panel.querySelectorAll('[data-filter-platform]').forEach(chip => {
      chip.addEventListener('click', () => {
        const p = chip.dataset.filterPlatform;
        // 3-state cycle: neutral → include ("on this platform") → exclude
        // ("NOT on this platform") → back to neutral. Lets her combine
        // "on Poshmark" with "not on eBay" at the same time, which a single
        // multi-select + one global invert toggle couldn't express.
        if (activeFilters.platformsInclude.includes(p)){
          activeFilters.platformsInclude = activeFilters.platformsInclude.filter(x => x !== p);
          activeFilters.platformsExclude = [...activeFilters.platformsExclude, p];
        } else if (activeFilters.platformsExclude.includes(p)){
          activeFilters.platformsExclude = activeFilters.platformsExclude.filter(x => x !== p);
        } else {
          activeFilters.platformsInclude = [...activeFilters.platformsInclude, p];
        }
        renderAll();
      });
    });
    document.getElementById('incompleteChip').addEventListener('click', () => {
      activeFilters.incomplete = !activeFilters.incomplete;
      renderAll();
    });
    document.getElementById('needsPhotoChip').addEventListener('click', () => {
      activeFilters.needsPhoto = !activeFilters.needsPhoto;
      renderAll();
    });
    document.getElementById('noPriceChip').addEventListener('click', () => {
      activeFilters.noPrice = !activeFilters.noPrice;
      renderAll();
    });
    document.getElementById('staleChip').addEventListener('click', () => {
      activeFilters.stale = !activeFilters.stale;
      renderAll();
    });
    document.getElementById('clearFiltersBtn').addEventListener('click', () => {
      activeFilters = { status:null, category:null, incomplete:false, needsPhoto:false, box:null, notSold:false, size:null, platformsInclude:[], platformsExclude:[] };
      renderAll();
    });
  }

  function filtersActiveCount(){ return _filtersActiveCount(activeFilters); }
  function applyFilters(list){ return _applyFilters(list, activeFilters, searchQuery); }

  // ---------- MISSING INFO POPOVER ----------
  // Human-readable labels for whatever missingFields() (catalog-filters.js)
  // returns — kept here rather than in that module since it's presentation,
  // not completeness logic.
  const MISSING_FIELD_LABEL = {
    photos: 'Photos',
    cost: 'Cost',
    weight: 'Weight',
    dimensions: 'Dimensions (length & width)',
  };
  function showMissingInfoPopover(anchorEl, item){
    let pop = document.getElementById('missingInfoPopover');
    if (pop) pop.remove();
    const missing = missingFields(item);
    if (!missing.length) return;
    pop = document.createElement('div');
    pop.id = 'missingInfoPopover';
    pop.style.cssText = 'position:fixed; z-index:10000; background:var(--white); color:var(--plum); border:1px solid var(--line); border-radius:10px; box-shadow:0 8px 24px rgba(0,0,0,0.18); padding:10px 14px; font-size:13px; max-width:220px;';
    pop.innerHTML = `
      <div style="font-weight:700; font-size:11px; text-transform:uppercase; letter-spacing:0.04em; color:var(--terracotta-deep); margin-bottom:6px;">Missing on this item</div>
      <ul style="margin:0; padding-left:18px; line-height:1.6;">
        ${missing.map(f => `<li>${escapeHtml(MISSING_FIELD_LABEL[f] || f)}</li>`).join('')}
      </ul>
    `;
    document.body.appendChild(pop);
    const rect = anchorEl.getBoundingClientRect();
    const popRect = pop.getBoundingClientRect();
    let left = rect.left;
    if (left + popRect.width > window.innerWidth - 8) left = window.innerWidth - popRect.width - 8;
    pop.style.left = `${Math.max(8, left)}px`;
    pop.style.top = `${rect.bottom + 6}px`;
    // Closes on the next click anywhere (including re-tapping the same
    // chip, which just removes it above and lets this listener no-op) or
    // on Escape — same lightweight dismiss pattern as other popovers here.
    const dismiss = (ev) => {
      if (ev.type === 'keydown' && ev.key !== 'Escape') return;
      if (ev.type === 'click' && pop.contains(ev.target)) return;
      pop.remove();
      document.removeEventListener('click', dismiss, true);
      document.removeEventListener('keydown', dismiss, true);
    };
    setTimeout(() => {
      document.addEventListener('click', dismiss, true);
      document.addEventListener('keydown', dismiss, true);
    }, 0);
  }

  // ---------- RENDER: CATALOG ----------
  const HANGER_SVG = `<svg class="ic-placeholder" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 7a2 2 0 1 1 2 2c-1 .4-2 1-2 2v.5"/><path d="M12 11.5 3.4 17.6a1 1 0 0 0 .6 1.9h16a1 1 0 0 0 .6-1.9z"/></svg>`;
  const PRINT_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="1.5"/><path d="M7 14h10v7H7z"/></svg>`;
  const ARROW_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;

  // Status shortcuts above the list; they set the same filters as the
  // Status chips in the Filters panel.
  const CATALOG_STATUS_SEGS = [
    { key:'instock', label:'In stock', match: f => f.notSold && !f.status, apply: f => { f.notSold = true; f.status = null; } },
    { key:'listed', label:'Listed', match: f => f.status === 'anunciado', apply: f => { f.notSold = false; f.status = 'anunciado'; } },
    { key:'sold', label:'Sold', match: f => f.status === 'vendido', apply: f => { f.notSold = false; f.status = 'vendido'; } },
    { key:'all', label:'All', match: f => !f.notSold && !f.status, apply: f => { f.notSold = false; f.status = null; } },
  ];

  function renderCatalog(){
    const view = document.getElementById('catalogView');
    const drafts = catalogSection === 'drafts';
    const sectionTabs = `
      <div class="catalog-head">
        <h1 class="screen-title">Catalog</h1>
        <div class="seg" role="tablist" aria-label="Catalog sections">
          <button type="button" class="seg-btn${drafts ? '' : ' active'}" role="tab" aria-selected="${!drafts}" data-catalog-section="all">All</button>
          <button type="button" class="seg-btn${drafts ? ' active' : ''}" role="tab" aria-selected="${drafts}" data-catalog-section="drafts">Drafts${draftItems.length ? ` ${draftItems.length}` : ''}</button>
        </div>
      </div>`;

    if (drafts){
      // Photo Session groups live outside `items` entirely (own Firestore
      // collection), so they never show up in the catalog, stats or CSV
      // export; this tab is the only place they're visible until each one
      // is completed and saved.
      view.innerHTML = sectionTabs + (draftItems.length ? `
        <div class="panel drafts-list">
          ${draftItems.map(d => `
            <div class="draft-row" data-draft-id="${d.id}">
              <img src="${d.photos[0]}" alt="">
              <span class="draft-meta">${d.photos.length} photo${d.photos.length===1?'':'s'}${d.createdAt ? ` · ${daysSince(d.createdAt) === 0 ? 'today' : `${daysSince(d.createdAt)}d ago`}` : ''}</span>
              <button type="button" class="row-btn" data-act="complete-draft" data-draft-id="${d.id}">Complete</button>
              <button type="button" class="row-btn danger" data-act="delete-draft" data-draft-id="${d.id}">Delete</button>
            </div>`).join('')}
        </div>` : `<div class="empty-state"><p>No photo drafts. Start a Photo session from the + button to shoot a batch now and catalog it later.</p></div>`);
      wireCatalogControls();
      return;
    }

    const filterBtnClass = filtersActiveCount() > 0 ? 'filter-toggle-btn has-active' : 'filter-toggle-btn';
    const counts = {
      instock: items.filter(i => i.status !== 'vendido').length,
      listed: items.filter(i => i.status === 'anunciado').length,
      sold: items.filter(i => i.status === 'vendido').length,
      all: items.length,
    };
    const statusSeg = `
      <div class="seg seg-wide" role="group" aria-label="Status">
        ${CATALOG_STATUS_SEGS.map(sg => {
          const on = sg.match(activeFilters);
          return `<button type="button" class="seg-btn${on ? ' active' : ''}" aria-pressed="${on}" data-status-seg="${sg.key}">${sg.label} <span class="seg-count">${counts[sg.key]}</span></button>`;
        }).join('')}
      </div>`;
    // Tag Week theme: filter by the color of the week items came in.
    const activeWeek = WEEK_TAGS.find(t => t.index === activeFilters.weekTag);
    const weekDots = currentTheme() === 'tagweek' ? `
      <div class="tw-dots" role="group" aria-label="Filter by tag color">
        ${WEEK_TAGS.map(t => `<button type="button" class="tw-dot tag-${t.index}${activeFilters.weekTag === t.index ? ' active' : ''}" data-week-filter="${t.index}" aria-pressed="${activeFilters.weekTag === t.index}" aria-label="${t.name} tags, ${t.age}"></button>`).join('')}
        <span class="tw-dots-label">${activeWeek ? `${activeWeek.name} tags · ${activeWeek.age}` : 'Tag colors by week'}</span>
      </div>` : '';
    const controlsHtml = `
      ${sectionTabs}
      <div class="search-row">
        <input type="search" class="search-input" id="searchInput" placeholder="Name, brand, code or box" aria-label="Search the catalog" value="${escapeHtml(searchQuery)}" inputmode="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
      </div>
      ${statusSeg}
      ${weekDots}
      <div class="catalog-tools">
        <label class="sort-select">
          <span class="visually-hidden">Sort</span>
          <select id="catalogSortSelect" aria-label="Sort">
            ${CATALOG_SORTS.map(o => `<option value="${o.key}"${o.key === catalogSort ? ' selected' : ''}>${o.label}</option>`).join('')}
          </select>
        </label>
        <button type="button" class="${filterBtnClass}" id="filterToggleBtn" aria-expanded="${filterPanelOpen}">Filters${filtersActiveCount() ? ' (' + filtersActiveCount() + ')' : ''}</button>
        <button type="button" class="${bulkSelectMode ? 'filter-toggle-btn has-active' : 'filter-toggle-btn'}" id="bulkSelectToggleBtn">${bulkSelectMode ? 'Cancel' : 'Select'}</button>
      </div>
      <div class="filter-panel ${filterPanelOpen ? 'open' : ''}" id="filterPanel"></div>
    `;

    // The results list lives in its own container so typing in #searchInput
    // (below) only ever touches THAT — never the search field itself.
    // Rebuilding the whole view's innerHTML on every keystroke (as this used
    // to do) replaced #searchInput with a brand-new DOM node each time,
    // which resets the on-screen keyboard's "123"/ABC toggle state on iOS
    // after every single character typed.
    view.innerHTML = controlsHtml + '<div id="catalogListArea"></div>';
    wireCatalogControls();
    renderCatalogList();
  }

  function renderCatalogList(){
    const listArea = document.getElementById('catalogListArea');
    if (!listArea) return;
    const filtered = applyFilters(items);

    if (items.length === 0){
      listArea.innerHTML = `<div class="empty-state">
        <div class="serif-line">Your catalog is empty.</div>
        <p>Tap the + button to add your first item, or start a Photo session to shoot a batch first.</p>
      </div>`;
      wireCatalogListEvents();
      return;
    }

    if (filtered.length === 0){
      listArea.innerHTML = `<div class="empty-state">
        <div class="serif-line">No items match.</div>
        <p>Nothing fits this search and these filters.</p>
        <button type="button" class="secondary-btn" id="emptyClearFiltersBtn">Show all items</button>
      </div>`;
      document.getElementById('emptyClearFiltersBtn').addEventListener('click', () => {
        activeFilters = { status:null, category:null, incomplete:false, needsPhoto:false, box:null, notSold:false, size:null, platformsInclude:[], platformsExclude:[] };
        searchQuery = '';
        renderAll();
      });
      wireCatalogListEvents();
      return;
    }

    const sorted = sortCatalog(filtered, catalogSort);
    const STAGES = ['catalogado', 'anunciado', 'vendido'];
    const theme = currentTheme();
    const cardsHtml = sorted.map(item => {
      const photo = item.photos && item.photos[0];
      const hasListPrice = parseFloat(item.listPrice) > 0;
      const incomplete = isIncomplete(item);
      const noPhoto = !(item.photos && item.photos.length > 0);
      const sold = item.status === 'vendido';
      const listedDays = daysSince(item.status === 'anunciado' ? (item.ebayListedAt || item.createdAt) : item.createdAt);
      const isStale = item.status === 'anunciado' && listedDays >= 30;
      const selected = bulkSelectMode && bulkSelectedIds.has(item.id);
      const stage = Math.max(0, STAGES.indexOf(item.status));
      const sub = [
        item.size ? `Size ${escapeHtml(item.size)}` : '',
        item.color ? escapeHtml(item.color) : '',
        item.brand ? escapeHtml(item.brand) : '',
      ].filter(Boolean).join(' · ');
      const platforms = (item.listedPlatforms || []).map(p => {
        const name = escapeHtml(PLATFORM_NAME[p] || getPlatformLabel(p));
        if (p === 'ebay' && item.ebayListingId){
          return `<a class="ic-platform" href="${item.ebayListingUrl || `https://www.ebay.com/itm/${item.ebayListingId}`}" target="_blank" rel="noopener">${name} ↗</a>`;
        }
        return `<span class="ic-platform">${name}</span>`;
      }).join('');
      let priceHtml;
      if (sold){
        const profit = item.netProfit;
        priceHtml = profit !== undefined && profit !== null
          ? `<div class="ic-price ${profit >= 0 ? 'positive' : 'negative'}">${profit >= 0 ? '+' : '-'}$${Math.abs(profit).toFixed(2)}</div><div class="ic-price-note">profit</div>`
          : `<div class="ic-price">$${(parseFloat(item.soldPrice)||0).toFixed(2)}</div><div class="ic-price-note">sold</div>`;
      } else if (hasListPrice){
        priceHtml = `<div class="ic-price">$${parseFloat(item.listPrice).toFixed(2)}</div><div class="ic-price-note">+$${projectedProfit(item).toFixed(0)} proj.</div>`;
      } else {
        priceHtml = `<div class="ic-price missing">No price</div>`;
      }
      const soldWhen = sold && item.soldAt ? new Date(item.soldAt).toLocaleDateString('en-US', { month:'short', day:'numeric' }) : '';
      const soldWhere = sold && item.soldPlatform ? escapeHtml(PLATFORM_NAME[item.soldPlatform] || getPlatformLabel(item.soldPlatform)) : '';
      const bulkCheck = bulkSelectMode ? `<span class="bulk-check${selected ? ' on' : ''}" aria-hidden="true">${selected ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l4 4 10-10"/></svg>' : ''}</span>` : '';
      const photoInner = `${photo ? `<img src="${photo}" alt="">` : HANGER_SVG}`;
      const printBtn = `<button type="button" class="ic-btn" data-action="print-label" data-id="${item.id}" aria-label="Print label">${PRINT_SVG}</button>`;
      const warnBtn = incomplete ? `<button type="button" class="ic-warn" data-action="missing-info" data-id="${item.id}">${noPhoto ? 'No photo' : 'Missing info'}</button>` : '';
      const platformNames = (item.listedPlatforms || []).map(p => escapeHtml(PLATFORM_NAME[p] || getPlatformLabel(p))).join(', ');
      // The card contract (v3.21.2): every theme shows code, box, stage,
      // price, days, the warning and Edit; themes only arrange them.
      const daysText = `${listedDays} day${listedDays===1?'':'s'}${item.status === 'anunciado' ? ' listed' : ' in catalog'}`;
      const trackHtml = `<div class="ic-track" title="${statusLabel(item.status)}">
              ${STAGES.map((st, k) => `${k ? `<span class="ic-track-line${k <= stage ? ' done' : ''}"></span>` : ''}<span class="ic-dot${k <= stage ? ' done' : ''}"></span>`).join('')}
              <span class="ic-status">${statusLabel(item.status)}</span>
            </div>`;
      const editBtn = `<button type="button" class="ic-btn text" data-action="edit" data-id="${item.id}">Edit</button>`;

      if (theme === 'tagweek'){
        // Photo card with a hanging tag in the color of the week it came in.
        const code = item.productCode ? escapeHtml(item.productCode) + ' · ' : '';
        const tagText = sold
          ? `${code}SOLD${item.netProfit !== undefined && item.netProfit !== null ? ` ${item.netProfit >= 0 ? '+' : '-'}$${Math.abs(item.netProfit).toFixed(2)}` : ''}`
          : `${code}${hasListPrice ? '$' + parseFloat(item.listPrice).toFixed(0) : 'no price'}`;
        return `
      <div class="item-card tw-card${sold ? ' is-sold' : ''}${selected ? ' bulk-selected' : ''}" data-id="${item.id}">
        ${bulkCheck}
        <div class="item-photo tw-photo" ${photo ? `data-gallery="${item.id}"` : ''}>
          ${photoInner}
          ${item.photos && item.photos.length > 1 ? `<span class="photo-count-badge">${item.photos.length}</span>` : ''}
          <span class="tw-tag ${sold ? 'tag-sold' : `tag-${weekTagIndex(item, Date.now())}`}">${tagText}</span>
        </div>
        <div class="tw-body">
          <div class="ic-name">${escapeHtml(item.name || 'Unnamed item')}</div>
          <div class="ic-sub">${[item.size ? escapeHtml(item.size) : '', item.storageBox ? `Box ${escapeHtml(item.storageBox)}` : '', sold ? (soldWhen ? `Sold ${soldWhen}` : 'Sold') : daysText].filter(Boolean).join(' · ')}</div>
          ${trackHtml}
          <span class="tw-platforms${!sold && !platformNames ? ' not-listed' : ''}">${sold ? soldWhere : (platformNames || 'Not listed yet')}</span>
          ${warnBtn}
          <div class="tw-foot">${printBtn}${editBtn}</div>
        </div>
      </div>`;
      }
      if (theme === 'concourse'){
        // Gate-number row: the product code leads at monumental size.
        const priceLine = sold
          ? `<span class="cc-price ${(item.netProfit||0) >= 0 ? 'positive' : 'negative'}">${item.netProfit !== undefined && item.netProfit !== null ? `${item.netProfit >= 0 ? '+' : '-'}$${Math.abs(item.netProfit).toFixed(2)} profit` : 'Sold'}</span>${soldWhen ? `<span class="cc-days">${soldWhen}</span>` : ''}`
          : hasListPrice
            ? `<span class="cc-price">$${parseFloat(item.listPrice).toFixed(2)}</span><span class="cc-days${isStale ? ' stale' : ''}">${daysText}</span>`
            : `<span class="cc-go">Set price ${ARROW_SVG}</span><span class="cc-days">${daysText}</span>`;
        return `
      <div class="item-card cc-row${sold ? ' is-sold' : ''}${selected ? ' bulk-selected' : ''}" data-id="${item.id}">
        ${bulkCheck}
        <div class="cc-gate">
          <span class="cc-code">${escapeHtml(item.productCode || '—')}</span>
          ${item.storageBox ? `<span class="cc-chip">${escapeHtml(item.storageBox)}</span>` : ''}
        </div>
        <div class="item-photo cc-photo" ${photo ? `data-gallery="${item.id}"` : ''}>${photoInner}</div>
        <div class="cc-body">
          <div class="ic-name">${escapeHtml(item.name || 'Unnamed item')}</div>
          <div class="ic-sub">${[item.size ? escapeHtml(item.size) : '', sold ? soldWhere : (platformNames || 'not listed')].filter(Boolean).join(' · ')}</div>
          ${trackHtml}
          <div class="cc-foot">${priceLine}${warnBtn}</div>
        </div>
        <div class="cc-actions">${printBtn}${editBtn}</div>
      </div>`;
      }

      return `
      <div class="item-card${sold ? ' is-sold' : ''}${selected ? ' bulk-selected' : ''}" data-id="${item.id}">
        ${bulkSelectMode ? `<span class="bulk-check${selected ? ' on' : ''}" aria-hidden="true">${selected ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l4 4 10-10"/></svg>' : ''}</span>` : ''}
        <div class="item-photo" ${photo ? `data-gallery="${item.id}"` : ''}>
          ${photo ? `<img src="${photo}" alt="">` : `<svg class="ic-placeholder" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 7a2 2 0 1 1 2 2c-1 .4-2 1-2 2v.5"/><path d="M12 11.5 3.4 17.6a1 1 0 0 0 .6 1.9h16a1 1 0 0 0 .6-1.9z"/></svg>`}
          ${item.photos && item.photos.length > 1 ? `<span class="photo-count-badge">${item.photos.length}</span>` : ''}
        </div>
        <div class="item-body">
          <div class="ic-top">
            <div class="ic-name">${escapeHtml(item.name || 'Unnamed item')}</div>
            <div class="ic-price-col">${priceHtml}</div>
          </div>
          ${sub ? `<div class="ic-sub">${sub}</div>` : ''}
          <div class="ic-line">
            ${item.productCode ? `<span class="code-box">${escapeHtml(item.productCode)}</span>` : ''}
            ${item.storageBox ? `<span class="ic-box">Box ${escapeHtml(item.storageBox)}</span>` : ''}
            ${sold
              ? `<span class="ic-days">Sold${soldWhen ? ` ${soldWhen}` : ''}${soldWhere ? ` · ${soldWhere}` : ''}</span>`
              : `<span class="ic-days${isStale ? ' stale' : ''}">${daysText}</span>`}
            ${incomplete ? `<button type="button" class="ic-warn" data-action="missing-info" data-id="${item.id}">${noPhoto ? 'No photo' : 'Missing info'}</button>` : ''}
          </div>
          <div class="ic-bottom">
            <div class="ic-track" title="${statusLabel(item.status)}">
              ${STAGES.map((st, k) => `${k ? `<span class="ic-track-line${k <= stage ? ' done' : ''}"></span>` : ''}<span class="ic-dot${k <= stage ? ' done' : ''}"></span>`).join('')}
              <span class="ic-status">${statusLabel(item.status)}</span>
              ${platforms ? `<span class="ic-platforms">${platforms}</span>` : ''}
            </div>
            <div class="ic-actions">
              <button type="button" class="ic-btn" data-action="print-label" data-id="${item.id}" aria-label="Print label">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="1.5"/><path d="M7 14h10v7H7z"/></svg>
              </button>
              <button type="button" class="ic-btn text" data-action="edit" data-id="${item.id}">Edit</button>
            </div>
          </div>
        </div>
      </div>`;
    }).join('');

    // Bulk bar (v3.20.1): the everyday actions up front, the rest under
    // "More actions", with Delete last and set apart.
    const bulkBarHtml = bulkSelectMode ? `
      <div id="bulkActionBar" class="bulk-bar">
        <div class="bulk-head">
          <span class="bulk-count">${bulkSelectedIds.size} selected</span>
          <button type="button" class="link-btn" id="bulkSelectAllBtn">Select all ${filtered.length}</button>
        </div>
        <div class="bulk-row">
          <select id="bulkStatusSelect" aria-label="New status">
            <option value="catalogado">Cataloged</option>
            <option value="anunciado">Listed</option>
            <option value="vendido">Sold</option>
          </select>
          <button type="button" id="bulkApplyStatusBtn" class="primary-btn" ${bulkSelectedIds.size===0?'disabled':''}>Set status</button>
          <input type="text" id="bulkBoxInput" placeholder="Box" aria-label="Move to box" list="storageBoxList">
          <button type="button" id="bulkApplyBoxBtn" class="secondary-btn" ${bulkSelectedIds.size===0?'disabled':''}>Move</button>
          <button type="button" id="bulkPrintLabelsBtn" class="secondary-btn" ${bulkSelectedIds.size===0?'disabled':''}>Print labels</button>
        </div>
        <details class="bulk-more">
          <summary>More actions</summary>
          <div class="bulk-row">
            <input type="number" id="bulkDiscountInput" placeholder="Discount %" aria-label="Discount percent" min="1" max="90">
            <button type="button" id="bulkApplyDiscountBtn" class="secondary-btn" ${bulkSelectedIds.size===0?'disabled':''}>Apply discount</button>
            <button type="button" id="bulkGenerateDescBtn" class="secondary-btn" ${bulkSelectedIds.size===0?'disabled':''}>Generate descriptions</button>
            <button type="button" id="bulkPublishEbayBtn" class="secondary-btn" ${bulkSelectedIds.size===0?'disabled':''}>Publish on eBay</button>
          </div>
          <div class="bulk-row bulk-danger">
            <button type="button" id="bulkDeleteBtn" class="danger-btn" ${bulkSelectedIds.size===0?'disabled':''}>Delete selected</button>
          </div>
        </details>
        <div id="bulkActionStatus" class="bulk-status"></div>
      </div>
    ` : '';

    // The "+" would sit on top of the bulk bar; it comes back when bulk mode ends.
    if (currentTab === 'catalog') document.getElementById('fabAdd').style.display = bulkSelectMode ? 'none' : '';
    const scope = (CATALOG_STATUS_SEGS.find(sg => sg.match(activeFilters)) || { label: 'Filtered' }).label;
    const sortLabel = (CATALOG_SORTS.find(o => o.key === catalogSort) || CATALOG_SORTS[0]).label.toLowerCase();
    const countLine = theme === 'concourse'
      ? `<div class="cc-scope"><b>${escapeHtml(scope)}</b><span>${filtered.length} item${filtered.length===1?'':'s'}</span><span>· ${escapeHtml(sortLabel)}</span></div>`
      // Only a narrowed list needs a count line; the full catalog doesn't.
      : (searchQuery.trim() || filtersActiveCount() || filtered.length !== items.length)
        ? `<div class="list-count">${filtered.length} match${filtered.length===1?'':'es'} of ${items.length}</div>` : '';
    listArea.innerHTML = `${countLine}<div class="catalog-grid">${cardsHtml}</div>` + (bulkSelectMode ? `<div class="bulk-spacer"></div>` : '') + bulkBarHtml;
    wireCatalogListEvents();
  }

  // Wires the search field, filter toggle, bulk-mode toggle, and the drafts
  // banner — everything OUTSIDE #catalogListArea. Only runs on a full
  // renderCatalog() (tab switch, filters changing, bulk mode toggling,
  // etc.), never on every keystroke in #searchInput.
  function wireCatalogControls(){
    const searchInput = document.getElementById('searchInput');
    if (searchInput){
      searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        // Refresh only the results list — #searchInput itself is never
        // touched, so its focus/cursor and the on-screen keyboard's
        // current mode (letters vs. "123") stay exactly as they were.
        renderCatalogList();
      });
    }
    const filterToggleBtn = document.getElementById('filterToggleBtn');
    const filterPanel = document.getElementById('filterPanel');
    if (filterToggleBtn && filterPanel){
      renderFilterPanel();
      filterToggleBtn.addEventListener('click', () => {
        filterPanelOpen = !filterPanelOpen;
        filterPanel.classList.toggle('open', filterPanelOpen);
        filterToggleBtn.setAttribute('aria-expanded', filterPanelOpen ? 'true' : 'false');
      });
    }
    const bulkSelectToggleBtn = document.getElementById('bulkSelectToggleBtn');
    if (bulkSelectToggleBtn){
      bulkSelectToggleBtn.addEventListener('click', () => {
        bulkSelectMode = !bulkSelectMode;
        if (!bulkSelectMode) bulkSelectedIds.clear();
        renderCatalog();
      });
    }

    document.querySelectorAll('[data-catalog-section]').forEach(btn => {
      btn.addEventListener('click', () => {
        catalogSection = btn.dataset.catalogSection;
        renderCatalog();
      });
    });
    document.querySelectorAll('[data-status-seg]').forEach(btn => {
      btn.addEventListener('click', () => {
        CATALOG_STATUS_SEGS.find(sg => sg.key === btn.dataset.statusSeg).apply(activeFilters);
        renderAll();
      });
    });
    document.querySelectorAll('[data-week-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        const w = Number(btn.dataset.weekFilter);
        activeFilters.weekTag = activeFilters.weekTag === w ? null : w;
        renderAll();
      });
    });
    const sortSelect = document.getElementById('catalogSortSelect');
    if (sortSelect){
      sortSelect.addEventListener('change', () => {
        catalogSort = sortSelect.value;
        try{ localStorage.setItem('cc.catalog.sort', catalogSort); }catch(e){ /* not persisted */ }
        renderCatalogList();
      });
    }
    document.querySelectorAll('[data-act="complete-draft"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const draft = draftItems.find(d => d.id === btn.dataset.draftId);
        if (draft) openDraftForCataloging(draft);
      });
    });
    document.querySelectorAll('[data-act="delete-draft"]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('Delete this photo draft permanently? The photos will be lost.')) return;
        const id = btn.dataset.draftId;
        await deleteDraftFromDb(id);
        draftItems = draftItems.filter(d => d.id !== id);
        renderCatalog();
      });
    });
  }

  // Wires everything INSIDE #catalogListArea (item cards, bulk action bar) —
  // runs after both a full renderCatalog() and a list-only renderCatalogList().
  function wireCatalogListEvents(){
    document.querySelectorAll('.item-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (bulkSelectMode){
          const id = card.dataset.id;
          if (bulkSelectedIds.has(id)) bulkSelectedIds.delete(id);
          else bulkSelectedIds.add(id);
          renderCatalog();
          return;
        }
        // If tapped on the print-label button, open the print modal instead of edit
        const printBtn = e.target.closest('[data-action="print-label"]');
        if (printBtn){
          const item = items.find(i => i.id === printBtn.dataset.id);
          // A "batch" of exactly one item — same code path, same visual
          // result, as selecting this one item and using "Print labels".
          // The single-item print pipeline this used to call had its own
          // parallel (and repeatedly buggy) sizing/placement math; this
          // way there's only ever one label-rendering implementation.
          if (item) openBatchLabelModal([item]);
          return;
        }
        // If tapped on the "Missing info" chip, show what's missing instead
        // of opening the item — she can already see something's wrong from
        // the chip, this just answers "what" without a trip into the modal.
        const missingChip = e.target.closest('[data-action="missing-info"]');
        if (missingChip){
          const item = items.find(i => i.id === missingChip.dataset.id);
          if (item) showMissingInfoPopover(missingChip, item);
          return;
        }
        // If tapped on the photo area with gallery data, open lightbox
        const galleryEl = e.target.closest('[data-gallery]');
        if (galleryEl){
          const item = items.find(i => i.id === galleryEl.dataset.gallery);
          if (item && item.photos && item.photos.length > 0){
            openLightbox(item.photos, 0);
            return;
          }
        }
        const item = items.find(i => i.id === card.dataset.id);
        if (item) openModal(item);
      });
    });

    // ---------- BULK ACTIONS ----------
    const bulkStatus = (msg, isError) => {
      const el = document.getElementById('bulkActionStatus');
      if (el) el.innerHTML = `<span style="color:${isError ? 'var(--danger)' : 'var(--sage-deep)'};">${escapeHtml(msg)}</span>`;
    };

    const bulkSelectAllBtn = document.getElementById('bulkSelectAllBtn');
    if (bulkSelectAllBtn){
      bulkSelectAllBtn.addEventListener('click', () => {
        const filtered = applyFilters(items);
        filtered.forEach(i => bulkSelectedIds.add(i.id));
        renderCatalog();
      });
    }

    const bulkApplyStatusBtn = document.getElementById('bulkApplyStatusBtn');
    if (bulkApplyStatusBtn){
      bulkApplyStatusBtn.addEventListener('click', async () => {
        const newStatus = document.getElementById('bulkStatusSelect').value;
        const ids = Array.from(bulkSelectedIds);
        if (newStatus === 'vendido'){
          // Sold needs price/fee/shipping confirmed per item — see
          // modules/sold-confirm.js, same "explicit confirmation before the
          // financial calc runs" rule as the single-item modal.
          _showBulkSoldConfirm(ids, {
            escapeHtml, saveItem,
            onDone: (ebayPostSoldMessages) => {
              bulkSelectedIds.clear();
              bulkSelectMode = false;
              renderAll();
              if (ebayPostSoldMessages.length) alert(ebayPostSoldMessages.join('\n\n'));
              else showSavedToast();
            },
          });
          return;
        }
        bulkApplyStatusBtn.disabled = true;
        bulkStatus(`Updating ${ids.length} item${ids.length===1?'':'s'}…`);
        const skippedNoPlatform = [];
        for (const id of ids){
          const item = items.find(i => i.id === id);
          if (!item) continue;
          if (newStatus === 'anunciado' && (item.listedPlatforms || []).length === 0){
            // Same rule as the item modal: "Listed" without a platform
            // checked under "Listed on" means the app has no idea where to
            // look for this item once it sells — skip it instead of saving
            // a status that can't be acted on later.
            skippedNoPlatform.push(item.name || item.productCode || 'Item');
            continue;
          }
          const updated = { ...item, status: newStatus };
          const idx = items.findIndex(i => i.id === id);
          if (idx >= 0) items[idx] = updated;
          try{ await saveItem(updated); }catch(e){ /* saveItem already alerts */ }
        }
        bulkSelectedIds.clear();
        bulkSelectMode = false;
        renderAll();
        if (skippedNoPlatform.length){
          alert(`⚠️ Skipped setting these to "Listed" — no platform checked under "Listed on": ${skippedNoPlatform.join(', ')}. Edit each one, pick a platform, then try again.`);
        } else {
          showSavedToast();
        }
      });
    }


    const bulkApplyBoxBtn = document.getElementById('bulkApplyBoxBtn');
    if (bulkApplyBoxBtn){
      bulkApplyBoxBtn.addEventListener('click', async () => {
        const box = document.getElementById('bulkBoxInput').value.trim();
        if (!box){ bulkStatus('Enter a storage box name first.', true); return; }
        const ids = Array.from(bulkSelectedIds);
        bulkApplyBoxBtn.disabled = true;
        bulkStatus(`Moving ${ids.length} item${ids.length===1?'':'s'} to "${box}"…`);
        for (const id of ids){
          const item = items.find(i => i.id === id);
          if (!item) continue;
          const updated = { ...item, storageBox: box };
          const idx = items.findIndex(i => i.id === id);
          if (idx >= 0) items[idx] = updated;
          try{ await saveItem(updated); }catch(e){ /* saveItem already alerts */ }
        }
        bulkSelectedIds.clear();
        bulkSelectMode = false;
        renderAll();
        showSavedToast();
      });
    }

    const bulkApplyDiscountBtn = document.getElementById('bulkApplyDiscountBtn');
    if (bulkApplyDiscountBtn){
      bulkApplyDiscountBtn.addEventListener('click', async () => {
        const pct = parseFloat(document.getElementById('bulkDiscountInput').value);
        if (!pct || pct <= 0 || pct >= 100){ bulkStatus('Enter a discount percentage between 1 and 99.', true); return; }
        const ids = Array.from(bulkSelectedIds);
        bulkApplyDiscountBtn.disabled = true;
        let skipped = 0;
        bulkStatus(`Applying ${pct}% discount to ${ids.length} item${ids.length===1?'':'s'}…`);
        for (const id of ids){
          const item = items.find(i => i.id === id);
          if (!item || !item.listPrice){ skipped++; continue; } // nothing to discount off of
          const newPrice = Math.max(0.01, parseFloat(item.listPrice) * (1 - pct/100));
          const updated = { ...item, listPrice: newPrice.toFixed(2) };
          const idx = items.findIndex(i => i.id === id);
          if (idx >= 0) items[idx] = updated;
          try{ await saveItem(updated); }catch(e){ /* saveItem already alerts */ }
        }
        bulkSelectedIds.clear();
        bulkSelectMode = false;
        renderAll();
        showSavedToast();
        if (skipped) bulkStatus(`${skipped} item${skipped===1?'':'s'} skipped (no list price set).`, false);
      });
    }

    const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
    if (bulkDeleteBtn){
      bulkDeleteBtn.addEventListener('click', async () => {
        const ids = Array.from(bulkSelectedIds);
        if (!confirm(`Delete ${ids.length} item${ids.length===1?'':'s'} permanently? This can't be undone.`)) return;
        bulkDeleteBtn.disabled = true;
        bulkStatus(`Deleting ${ids.length} item${ids.length===1?'':'s'}…`);
        for (const id of ids){
          try{ await deleteItemFromDb(id); }catch(e){ continue; }
          setItems(items.filter(i => i.id !== id));
        }
        bulkSelectedIds.clear();
        bulkSelectMode = false;
        renderAll();
      });
    }

    const bulkPublishEbayBtn = document.getElementById('bulkPublishEbayBtn');
    if (bulkPublishEbayBtn){
      bulkPublishEbayBtn.addEventListener('click', () => showBulkEbayPreflight(false));
    }

    const bulkGenerateDescBtn = document.getElementById('bulkGenerateDescBtn');
    if (bulkGenerateDescBtn){
      bulkGenerateDescBtn.addEventListener('click', () => showBulkGenerateDescPreflight());
    }

    const bulkPrintLabelsBtn = document.getElementById('bulkPrintLabelsBtn');
    if (bulkPrintLabelsBtn){
      bulkPrintLabelsBtn.addEventListener('click', () => {
        const ids = Array.from(bulkSelectedIds);
        const selectedItems = ids.map(id => items.find(i => i.id === id)).filter(Boolean);
        if (selectedItems.length === 0) return;
        openBatchLabelModal(selectedItems);
      });
    }
  }

  // ---------- CSV EXPORT ----------
  function downloadCsv(filename, rows){
    const allRows = [...rows, [], [`Exported from Calculated Chaos ${APP_VERSION} (${APP_VERSION_DATE})`]];
    const csv = allRows.map(row => row.map(csvEscape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    downloadBlob(blob, filename);
  }

  function wireReportButtons(){
    // ---- Excel export (matches original Clothing Inventory Tracker format) ----
    const excelBtn = document.getElementById('exportExcel');
    if (excelBtn) excelBtn.addEventListener('click', async () => {
      excelBtn.querySelector('.et-title').textContent = 'Generating Excel…';
      try{
        // Load SheetJS dynamically
        if (!window.XLSX){
          await new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
            s.onload = resolve; s.onerror = reject;
            document.head.appendChild(s);
          });
        }
        const wb = XLSX.utils.book_new();
        const sheets = buildExcelSheetsData(items, appSettings);

        const clothingWs = XLSX.utils.aoa_to_sheet([sheets.clothing.header, ...sheets.clothing.rows]);
        clothingWs['!cols'] = sheets.clothing.header.map(h => ({ wch: Math.max(h.length + 2, 14) }));
        XLSX.utils.book_append_sheet(wb, clothingWs, 'Clothing Inventory');

        const householdWs = XLSX.utils.aoa_to_sheet([sheets.household.header, ...sheets.household.rows]);
        householdWs['!cols'] = sheets.household.header.map(h => ({ wch: Math.max(h.length + 2, 14) }));
        XLSX.utils.book_append_sheet(wb, householdWs, 'HouseholdMisc. Inventory');

        const allWs = XLSX.utils.aoa_to_sheet([sheets.all.header, ...sheets.all.rows]);
        allWs['!cols'] = sheets.all.header.map(h => ({ wch: Math.max(h.length + 2, 12) }));
        XLSX.utils.book_append_sheet(wb, allWs, 'All Items (Calculated Chaos)');

        XLSX.writeFile(wb, `Clothing_Inventory_Tracker_${new Date().toISOString().slice(0,10)}.xlsx`);
      }catch(err){
        console.error('Excel export error', err);
        alert('Could not generate Excel file. Please try the CSV export instead.');
      }finally{
        excelBtn.querySelector('.et-title').textContent = 'Excel (.xlsx)';
      }
    });

    const fullBtn = document.getElementById('exportFullInventory');
    if (fullBtn) fullBtn.addEventListener('click', () => {
      downloadCsv('calculated-chaos-full-inventory.csv', buildFullInventoryRows(items, appSettings));
    });

    const soldBtn = document.getElementById('exportSoldOnly');
    if (soldBtn) soldBtn.addEventListener('click', () => {
      downloadCsv('calculated-chaos-sold-items.csv', buildSoldItemsRows(items));
    });

    const catBtn = document.getElementById('exportCategoryReport');
    if (catBtn) catBtn.addEventListener('click', () => {
      downloadCsv('calculated-chaos-category-performance.csv', buildCategoryReportRows(items, appSettings));
    });
  }

  // The store's logo and name lead, with "by Calculated Chaos" under the
  // name, once a business has a name of its own (Settings > Appearance,
  // v3.22.1); until then the product name stands alone.
  function renderBrand(){
    // The business's theme and accent; cheap to reapply. The accent goes
    // second: its contrast adjustment depends on the theme's colors.
    if (appSettings.theme) applyTheme(appSettings.theme);
    applyAccent(appSettings.accentColor);
    const storeName = (appSettings.storeName || '').trim();
    const logo = typeof appSettings.storeLogo === 'string' && appSettings.storeLogo.startsWith('data:image/') ? appSettings.storeLogo : '';
    const text = storeName
      ? `<span class="brand-name">${escapeHtml(storeName)}</span><span class="brand-by">by Calculated Chaos</span>`
      : `<span class="brand-name">Calculated Chaos</span>`;
    const html = `${logo ? `<img class="brand-logo" src="${escapeHtml(logo)}" alt="">` : ''}<span class="brand-text">${text}</span>`;
    document.querySelectorAll('[data-brand]').forEach(el => { el.innerHTML = html; });
    // Employees can't open Settings, where Sign out lives, so the header
    // keeps one for them.
    const header = document.querySelector('.app-header');
    if (header && currentUserRole === 'employee' && !document.getElementById('headerSignOutBtn')){
      header.insertAdjacentHTML('beforeend', `<button type="button" class="header-btn" id="headerSignOutBtn">Sign out</button>`);
      document.getElementById('headerSignOutBtn').addEventListener('click', async () => {
        if (!confirm('Sign out of Calculated Chaos?')) return;
        await window.authFns.signOut(window.auth);
      });
    }
  }

  function renderAll(){
    renderBrand();
    renderHome();
    renderCatalog();
    renderFinance();
    if (currentTab === 'stock') renderStock();
    refreshStockTransferBoxListIfOpen();
  }

  // ---------- HOME ----------
  // The Home screen (ui/home/home-view.js) reaches the other screens
  // through these.
  initHomeView({
    getDrafts: () => draftItems,
    projectedProfit,
    getDailyMessage: () => getTodaysHeaderMessage().text,
    platformLabel: (key) => PLATFORM_NAME[key] || getPlatformLabel(key),
    platformColor: (key) => getPlatformColor(key),
    openCatalog: openCatalogWith,
    openTab: (tab) => switchToTab(tab),
    finishDrafts: () => {
      catalogSection = 'drafts';
      switchToTab('catalog');
      renderCatalog();
    },
  });

  // Opens the catalog's "All" list with these filters only (Home rows,
  // Stock boxes).
  function openCatalogWith(filters){
    activeFilters = { status:null, category:null, incomplete:false, needsPhoto:false, box:null, notSold:false, size:null, platformsInclude:[], platformsExclude:[], ...filters };
    catalogSection = 'all';
    switchToTab('catalog');
    renderAll();
  }

  // ---------- TABS ----------
  // Five places (Home, Catalog, Stock, Finances, Settings); Finances holds
  // three sub-tabs, 'finance' (Overview), 'months' and 'reports'.
  const TAB_VIEWS = { home: 'homeView', catalog: 'catalogView', stock: 'stockView', finance: 'financeArea', months: 'financeArea', reports: 'financeArea', settings: 'settingsView' };
  const FINANCE_PANES = { finance: 'financeView', months: 'monthsView', reports: 'reportsView' };
  const FAB_TABS = new Set(['home', 'catalog']);
  let currentTab = 'home';
  function switchToTab(tab){
    // Belt-and-suspenders: applyRoleRestrictions() already hides every
    // nav entry but Catalog for an employee, but anything that calls
    // switchToTab() directly (stat shortcuts, etc.) goes through here
    // too, so re-check rather than trust the UI was never bypassed.
    if (currentUserRole === 'employee') tab = 'catalog';
    if (!TAB_VIEWS[tab]) tab = 'home';
    currentTab = tab;
    const place = FINANCE_PANES[tab] ? 'finance' : tab;
    document.querySelectorAll('.nav-link').forEach(b => {
      const on = b.dataset.tab === place;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    document.querySelectorAll('.subtab[data-tab]').forEach(b => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    new Set(Object.values(TAB_VIEWS)).forEach(id => {
      document.getElementById(id).style.display = id === TAB_VIEWS[tab] ? '' : 'none';
    });
    Object.entries(FINANCE_PANES).forEach(([t, id]) => {
      document.getElementById(id).style.display = t === tab ? '' : 'none';
    });
    document.getElementById('fabAdd').style.display = FAB_TABS.has(tab) ? '' : 'none';
    closeFabMenu();
    if (tab === 'home') renderHome();
    if (tab === 'stock') renderStock();
    // Skip the rebuild while the "paste your eBay token" box is showing and
    // waiting on her — a full re-render replaces the whole Settings section,
    // including that box, with a fresh "Not connected" state (since the
    // token isn't saved yet), so switching tabs and back looked like the
    // connect flow had vanished.
    if (tab === 'settings' && !ebayConnectFlowPending) renderSettings({ fresh: true });
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('.nav-link, .subtab[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchToTab(btn.dataset.tab));
  });
  initStockView({ openCatalog: openCatalogWith });
  initFinanceView({
    projectedProfit,
    platformLabel: (key) => PLATFORM_NAME[key] || getPlatformLabel(key),
    platformColor: (key) => getPlatformColor(key),
    openTab: (tab) => switchToTab(tab),
    openItem: (id) => {
      const item = items.find(i => i.id === id);
      if (item){ switchToTab('catalog'); openModal(item); }
    },
    wireExports: wireReportButtons,
  });

  // ---------- ADD MENU ----------
  // One "+" (Home and Catalog only) opens New item / Quick catalog /
  // Photo session.
  const fabMenu = document.getElementById('fabMenu');
  const fabAddBtn = document.getElementById('fabAdd');
  function closeFabMenu(){
    fabMenu.hidden = true;
    fabAddBtn.setAttribute('aria-expanded', 'false');
    fabAddBtn.classList.remove('open');
  }
  fabAddBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const opening = fabMenu.hidden;
    fabMenu.hidden = !opening;
    fabAddBtn.setAttribute('aria-expanded', opening ? 'true' : 'false');
    fabAddBtn.classList.toggle('open', opening);
    if (opening) document.getElementById('fabNewItem').focus();
  });
  fabMenu.addEventListener('click', () => closeFabMenu());
  document.addEventListener('click', (e) => {
    if (!fabMenu.hidden && !fabMenu.contains(e.target)) closeFabMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !fabMenu.hidden){ closeFabMenu(); fabAddBtn.focus(); }
  });

  // ---------- MODAL CONTROL ----------
  const overlay = document.getElementById('itemModalOverlay');

  // ---------- EBAY CATEGORY SEARCH (curated cache + live fallback) ----------
  // First checks a shared Firestore cache (instant, no API call) built from
  // categories already confirmed for past items — this is the "curated list"
  // for anything used before. On a miss, falls back to a live search against
  // eBay's real category tree, which covers any product type (books,
  // antiques, appliances, whatever the store sells) without us having to
  // predict or hardcode category IDs. Every choice made gets saved back to
  // the cache, so it grows correct over time and each search becomes rarer.
  let chosenEbayCategory = null; // { id, path, validConditions }
  let ebayCategorySearchTimer = null;

  function slugifyEbayQuery(s){
    return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }

  function setChosenEbayCategory(cat){
    chosenEbayCategory = cat;
    const input = document.getElementById('fEbayCategoryQuery');
    const clearBtn = document.getElementById('ebayCategoryClearBtn');
    if (cat){
      input.value = `✓ ${cat.path}`;
      input.readOnly = true;
      input.classList.add('ebay-cat-confirmed');
      clearBtn.style.display = 'block';
    } else {
      input.value = '';
      input.readOnly = false;
      input.classList.remove('ebay-cat-confirmed');
      clearBtn.style.display = 'none';
    }
    document.getElementById('ebayCategoryResults').innerHTML = '';
    // Every eBay category accepts a different set of "condition" values —
    // publishing with one it doesn't accept is what causes error 25021.
    // So the moment a category is picked (by AI or manually), we ask eBay
    // which conditions are valid THERE and cache the answer on the choice.
    if (cat && cat.id && !cat.validConditions){
      fetchEbayValidConditions(cat.id).then(conds => {
        if (chosenEbayCategory && chosenEbayCategory.id === cat.id){
          chosenEbayCategory.validConditions = conds;
        }
      });
    }
    if (cat && cat.id){
      currentCategoryAspects = []; // don't check against the previous category's list while this one loads
      ebayAspectsLoadPromise = loadEbayAspectsForCategory(cat.id);
    } else {
      currentEbayAspects = {};
      currentCategoryAspects = [];
      document.getElementById('ebayAspectsContainer').innerHTML = '';
      renderEbaySizeCheck();
    }
  }

  // ---------- EBAY ITEM SPECIFICS (category-specific required aspects) ----------
  // Fields our own form already covers and sends automatically at publish
  // time (see api/ebay-list.js) — never shown here, would just be a
  // confusing duplicate of Brand/Color/Size/Gender above.
  const EBAY_ASPECTS_AUTO_COVERED = ['Department', 'Brand', 'Color', 'Size'];

  // Checks the fields eBay is known to need before ever calling the publish
  // API, so a real gap surfaces as a plain "check field X" instead of a raw
  // eBay error box (see v3.13.81/82 — a blank Size silently sent a made-up
  // value and failed with a cryptic errorId 25129). Two sources:
  //  1. Size, for any category eBay treats as apparel — the one dedicated
  //     field known to cause this.
  //  2. Whatever this item's chosen eBay category requires beyond that
  //     (Pattern, Material, etc.) — only checkable while THIS item's modal
  //     is the one open, since that required-field list only ever lives in
  //     the DOM (#ebayAspectsContainer), never stored on the item itself.
  function getMissingEbayFieldLabels(item){
    const missing = [];
    if (['Clothing', 'Shoes', 'Accessories'].includes(item.category) && !item.size){
      missing.push('Size');
    }
    if (currentEditId === item.id){
      const sizeSpec = getEbaySizeSpec();
      if (item.size && sizeSpec && !sizeSpec.allowedValues.includes(item.size.trim())
          && !matchAllowedValue('Size', item.size, sizeSpec.allowedValues)){
        missing.push("Size (pick one of eBay's standard sizes)");
      }
      document.querySelectorAll('#ebayAspectsContainer [data-aspect]').forEach(el => {
        if (!el.value.trim()) missing.push(el.dataset.aspect);
      });
    }
    return missing;
  }
  let currentEbayAspects = {}; // { "Pattern": "Floral", "Material": "Cotton", ... } — her real answers, saved on the item
  // Every item specific the chosen eBay category knows about, with its
  // official allowed values (Taxonomy API) — used to check Size against
  // eBay's own list before publishing, see renderEbaySizeCheck().
  let currentCategoryAspects = [];

  function getEbaySizeSpec(){
    return currentCategoryAspects.find(a => isSizeAspect(a.name) && a.allowedValues && a.allowedValues.length) || null;
  }

  // Checks the Size field against the chosen category's official list,
  // live as she types: silent when it's already a standard value, a
  // one-line "will be sent as XS" note when there's a confident match
  // (the server applies the same match — src/modules/ebay-aspect-match.js),
  // and a dropdown of eBay's real sizes when there isn't one — otherwise
  // that's a guaranteed errorId 25129 at publish time.
  function renderEbaySizeCheck(){
    const box = document.getElementById('ebaySizeCheck');
    if (!box) return;
    const spec = getEbaySizeSpec();
    const size = (document.getElementById('fSize')?.value || '').trim();
    if (!spec || !size || spec.allowedValues.includes(size)){ box.innerHTML = ''; return; }
    const match = matchAllowedValue('Size', size, spec.allowedValues);
    if (match){
      box.innerHTML = `<div style="font-size:12px; margin-top:4px; color:var(--plum-soft);">eBay will receive this as "<b>${escapeHtml(match)}</b>" (its standard size for this category).</div>`;
      return;
    }
    box.innerHTML = `<div style="font-size:12px; margin-top:6px; padding:8px; border-radius:8px; background:rgba(229,50,56,0.08); color:var(--plum);">
      ⚠️ "${escapeHtml(size)}" isn't one of eBay's standard sizes for this category — eBay will reject it.
      <select id="ebaySizePick" style="width:100%; margin-top:6px; padding:8px; border:1px solid var(--line); border-radius:8px; font-size:13px;">
        <option value="">Pick eBay's size…</option>
        ${spec.allowedValues.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('')}
      </select>
    </div>`;
    document.getElementById('ebaySizePick').addEventListener('change', (e) => {
      if (!e.target.value) return;
      document.getElementById('fSize').value = e.target.value;
      renderEbaySizeCheck();
    });
  }
  let currentAiAnalysis = null; // raw AI photo-analysis result for this item, saved on the item so it survives closing/reopening the modal
  // Visual facts (fabric tag, construction details, flaws) recorded by the
  // last ✨ analysis — saved as item.aiFacts so "🪄 Rewrite listing text"
  // can rewrite without re-sending photos.
  let currentAiFacts = null;
  // eBay item specifics from the ✨ analysis, waiting for the chosen
  // category's aspect list to load (applyPendingAiEbayAspects).
  let pendingAiEbayAspects = null;
  // Condition before the "New with tags" shortcut was checked, so
  // unchecking it restores that instead of guessing.
  let conditionBeforeNwtQuick = null;
  let ebayAspectsLoadPromise = null;

  async function loadEbayAspectsForCategory(categoryId){
    const container = document.getElementById('ebayAspectsContainer');
    container.innerHTML = `<div style="font-size:12px; opacity:0.6;">Checking what this category requires…</div>`;
    try{
      const ebayReady = await ensureEbayConnected();
      if (!ebayReady){ container.innerHTML = ''; return; }
      const idToken = await window.auth.currentUser.getIdToken();
      const res = await fetch('/api/ebay-item-aspects', {
        method: 'POST',
        headers: {'Content-Type':'application/json', 'Authorization': `Bearer ${idToken}`},
        body: JSON.stringify({ category_id: categoryId })
      });
      const data = await res.json();
      if (!data.success){ container.innerHTML = ''; return; }
      currentCategoryAspects = data.aspects;
      applyPendingAiEbayAspects();
      renderEbaySizeCheck();
      const needed = data.aspects.filter(a => a.required && !EBAY_ASPECTS_AUTO_COVERED.includes(a.name));
      renderEbayAspectsFields(needed);
    }catch(e){
      console.warn('eBay aspects lookup failed:', e);
      container.innerHTML = '';
    }
  }

  // Curated pick-lists for aspects eBay itself sometimes leaves as free
  // text (no allowedValues at all) even though it flags them required —
  // "Style" for leggings/activewear pants is exactly this case (real
  // account test, 2026-09-12): eBay's own aspect lookup returned no
  // selection list, leaving her to guess the right wording from memory
  // every single time. Keyed by [aspect name lowercased] -> a list of
  // {test, values} candidates tried in order (first match wins), since the
  // same aspect name (e.g. "Style") means something different on leggings
  // vs. a jacket. Still a free-text input with a <datalist> — never blocks
  // a value outside this list ("suggestion, not a restriction").
  const isJacketOrCoat = () => {
    const type = (document.getElementById('fClothingType')?.value || '').toLowerCase();
    const name = (document.getElementById('fName')?.value || '').toLowerCase();
    return type.includes('jacket') || type.includes('coat') || type.includes('blazer') ||
      /jacket|coat|shacket|blazer|parka/.test(name);
  };
  const CONDITIONAL_ASPECT_SUGGESTIONS = {
    style: [
      {
        test: () => {
          const type = (document.getElementById('fClothingType')?.value || '').toLowerCase();
          const name = (document.getElementById('fName')?.value || '').toLowerCase();
          return type.includes('legging') || name.includes('legging');
        },
        values: ['Leggings', 'Jeggings', 'Capri/Cropped', 'Bootcut', 'Flare', 'High-Waisted', 'Compression'],
      },
      {
        test: isJacketOrCoat,
        values: ['Casual', 'Business Casual', 'Western', 'Bomber', 'Trucker', 'Military', 'Preppy', 'Bohemian'],
      },
    ],
    type: [
      {
        // eBay's "Type" aspect for the Women's/Men's Coats & Jackets
        // category (real account test, 2026-09-15) — first entry
        // (Overshirt/Shacket) covers the item that surfaced this gap.
        test: isJacketOrCoat,
        values: ['Overshirt/Shacket', 'Blazer', 'Bomber Jacket', 'Denim Jacket', 'Field Jacket', 'Parka', 'Puffer/Quilted', 'Trench Coat', 'Wool Coat', 'Vest'],
      },
    ],
    'outer shell material': [
      {
        test: isJacketOrCoat,
        values: ['Corduroy', 'Cotton', 'Cotton Blend', 'Denim', 'Faux Leather', 'Leather', 'Nylon', 'Polyester', 'Suede', 'Wool', 'Wool Blend', 'Fleece'],
      },
    ],
  };

  // The eBay "Type" value last filled in automatically from Clothing Type —
  // lets a later Clothing Type change update it, without ever overwriting
  // something she typed herself.
  let autoFilledEbayType = null;

  function currentClothingTypeValue(){
    const sel = document.getElementById('fClothingType')?.value || '';
    return sel === '__other__' ? (document.getElementById('fClothingTypeOther')?.value.trim() || '') : sel;
  }

  function refreshAutoEbayType(){
    const el = Array.from(document.querySelectorAll('#ebayAspectsContainer [data-aspect]')).find(x => isTypeAspect(x.dataset.aspect));
    if (!el) return;
    const current = el.value.trim();
    if (current && current !== autoFilledEbayType) return; // her own value — leave it
    const spec = currentCategoryAspects.find(a => isTypeAspect(a.name));
    const next = suggestEbayTypeValue(currentClothingTypeValue(), spec ? spec.allowedValues : null) || '';
    el.value = next;
    if (next) currentEbayAspects[el.dataset.aspect] = next;
    else delete currentEbayAspects[el.dataset.aspect];
    autoFilledEbayType = next || null;
  }

  function renderEbayAspectsFields(neededAspects){
    const container = document.getElementById('ebayAspectsContainer');
    if (!neededAspects.length){ container.innerHTML = ''; return; }
    container.innerHTML = `
      <div style="font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; color:var(--plum-soft); margin-bottom:6px;">This eBay category also requires:</div>
      ${neededAspects.map(a => {
        const candidates = CONDITIONAL_ASPECT_SUGGESTIONS[a.name.toLowerCase()];
        const matched = candidates && candidates.find(c => c.test());
        const suggestions = (!a.selectionOnly && matched) ? matched.values : null;
        // Default to the common case (first suggestion) so this doesn't
        // block "List on eBay" by default — still freely editable/
        // clearable in the field below, same "only fill if empty" rule
        // as applyDefaultSizeTypeIfEmpty/applyDefaultClothingShippingIfEmpty.
        if (suggestions && !currentEbayAspects[a.name]) currentEbayAspects[a.name] = suggestions[0];
        // eBay "Type" = the Clothing Type she already picked above (e.g.
        // T-Shirt), in eBay's own spelling when the category has an
        // official list — see modules/ebay-type-map.js. Only fills a blank.
        if (!suggestions && isTypeAspect(a.name) && !currentEbayAspects[a.name]){
          const typeValue = suggestEbayTypeValue(currentClothingTypeValue(), a.allowedValues);
          if (typeValue){ currentEbayAspects[a.name] = typeValue; autoFilledEbayType = typeValue; }
        }
        const listId = `aspectSuggest_${a.name.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
        return `
        <div style="margin-bottom:8px;">
          <label style="font-size:12px; font-weight:600; color:var(--plum); display:block; margin-bottom:3px;">${escapeHtml(a.name)}</label>
          ${a.selectionOnly && a.allowedValues.length ? `
            <select data-aspect="${escapeHtml(a.name)}" style="width:100%; padding:9px 10px; border:1px solid var(--line); border-radius:8px; font-size:13px;">
              <option value="">—</option>
              ${a.allowedValues.map(v => `<option value="${escapeHtml(v)}" ${currentEbayAspects[a.name]===v?'selected':''}>${escapeHtml(v)}</option>`).join('')}
            </select>
          ` : suggestions ? `
            <input type="text" list="${listId}" data-aspect="${escapeHtml(a.name)}" value="${escapeHtml(currentEbayAspects[a.name] || '')}" style="width:100%; padding:9px 10px; border:1px solid var(--line); border-radius:8px; font-size:13px;">
            <datalist id="${listId}">${suggestions.map(v => `<option value="${escapeHtml(v)}">`).join('')}</datalist>
          ` : `
            <input type="text" data-aspect="${escapeHtml(a.name)}" value="${escapeHtml(currentEbayAspects[a.name] || '')}" style="width:100%; padding:9px 10px; border:1px solid var(--line); border-radius:8px; font-size:13px;">
          `}
        </div>
      `;
      }).join('')}
    `;
    container.querySelectorAll('[data-aspect]').forEach(el => {
      el.addEventListener('change', () => {
        const val = el.value.trim();
        if (val) currentEbayAspects[el.dataset.aspect] = val;
        else delete currentEbayAspects[el.dataset.aspect];
      });
    });
  }

  async function fetchEbayValidConditions(categoryId){
    try{
      const ebayReady = await ensureEbayConnected();
      if (!ebayReady) return null;
      const res = await fetch('/api/ebay-listing-tools', {
        method: 'POST',
        headers: await jsonAuthHeaders(),
        body: JSON.stringify({ action: 'condition_policies', category_id: categoryId })
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.conditions) && data.conditions.length){
        return data.conditions;
      }
      return null;
    }catch(e){
      console.warn('Condition policy lookup failed:', e);
      return null;
    }
  }

  async function searchEbayCategory(queryText, autoPick){
    const resultsEl = document.getElementById('ebayCategoryResults');
    const q = queryText.trim();
    if (!q){ resultsEl.innerHTML = ''; return; }
    resultsEl.innerHTML = '<div style="font-size:12px; opacity:0.6;">Searching…</div>';

    const slug = slugifyEbayQuery(q);

    // 1. Curated cache first — instant, no API call.
    try{
      const { doc, getDoc } = window.firestoreFns;
      const snap = await getDoc(doc(window.db, 'ebay_category_cache', slug));
      if (snap.exists()){
        const cached = snap.data();
        renderEbayCategoryResults([{ id: cached.id, name: cached.name, path: cached.path }], true, autoPick);
        return;
      }
    }catch(e){ console.warn('Category cache lookup failed:', e); }

    // 2. Live search fallback via eBay's real category tree.
    try{
      const ebayReady = await ensureEbayConnected();
      if (!ebayReady){
        resultsEl.innerHTML = '<div style="font-size:12px; color:var(--danger);">Connect your eBay account (Settings) to search categories.</div>';
        return;
      }
      const res = await fetch('/api/ebay-category-search', {
        method: 'POST',
        headers: await jsonAuthHeaders(),
        body: JSON.stringify({ query: q })
      });
      const data = await res.json();
      if (!data.success || !data.suggestions || !data.suggestions.length){
        resultsEl.innerHTML = '<div style="font-size:12px; color:var(--danger);">No matches found — try different words.</div>';
        return;
      }
      renderEbayCategoryResults(data.suggestions.slice(0, 8), false, autoPick);
    }catch(e){
      console.error('Category search failed:', e);
      resultsEl.innerHTML = '<div style="font-size:12px; color:var(--danger);">Search failed — try again.</div>';
    }
  }

  function renderEbayCategoryResults(list, fromCache, autoPick){
    const resultsEl = document.getElementById('ebayCategoryResults');
    const label = fromCache ? 'saved choice' : 'AI suggestion — tap to change';
    resultsEl.innerHTML = list.map((c, i) => `
      <div class="ebay-cat-option${autoPick && i===0 ? ' ebay-cat-selected' : ''}" data-idx="${i}" style="padding:8px 10px; font-size:12px; border:1px solid ${autoPick && i===0 ? 'var(--sage)' : 'var(--line)'}; border-radius:7px; margin-bottom:4px; cursor:pointer; background:white;">
        ${escapeHtml(c.path)}${(fromCache || (autoPick && i===0)) ? ` <span style="color:var(--sage);">· ${label}</span>` : ''}
      </div>`).join('');
    resultsEl.querySelectorAll('.ebay-cat-option').forEach(el => {
      el.addEventListener('click', () => pickEbayCategoryResult(list, parseInt(el.dataset.idx)));
    });
    if (autoPick && list.length){
      pickEbayCategoryResult(list, 0, true);
    }
  }

  async function pickEbayCategoryResult(list, idx, keepResultsVisible){
    const c = list[idx];
    setChosenEbayCategory(c);
    // Save/refresh this confirmed choice in the shared cache for instant reuse.
    try{
      const { doc, setDoc } = window.firestoreFns;
      const q = document.getElementById('fEbayCategoryQuery').dataset.lastQuery || c.name;
      await setDoc(doc(window.db, 'ebay_category_cache', slugifyEbayQuery(q)), {
        id: c.id, name: c.name, path: c.path, savedAt: Date.now()
      });
    }catch(e){ console.warn('Category cache save failed:', e); }
  }

  document.getElementById('fEbayCategoryQuery').addEventListener('input', (e) => {
    e.target.dataset.lastQuery = e.target.value;
    clearTimeout(ebayCategorySearchTimer);
    ebayCategorySearchTimer = setTimeout(() => searchEbayCategory(e.target.value), 450);
  });
  // Once a category is confirmed the field turns readOnly (see
  // setChosenEbayCategory) — clicking it again is how she reopens search to
  // change it, same as the ✕ button.
  document.getElementById('fEbayCategoryQuery').addEventListener('click', (e) => {
    if (e.target.readOnly) setChosenEbayCategory(null);
  });
  document.getElementById('ebayCategoryClearBtn').addEventListener('click', () => {
    setChosenEbayCategory(null);
    document.getElementById('fEbayCategoryQuery').focus();
  });

  function openModal(item, isDuplicate, opts){
    const keepScroll = !!(opts && opts.keepScroll);
    currentEditId = (item && !isDuplicate) ? item.id : null;
    currentPhotos = item && item.photos ? [...item.photos] : [];
    currentMeasurements = (item && !isDuplicate && item.measurements) ? JSON.parse(JSON.stringify(item.measurements)) : null;
    currentStatus = (item && !isDuplicate) ? item.status : 'catalogado';
    currentPrep = (item && !isDuplicate)
      ? (item.prep || 'ready')
      : (appSettings.autoPrepRules?.[getCategoryValue() || 'Clothing'] || 'ready');

    document.getElementById('modalTitle').textContent = isDuplicate ? 'Duplicate item' : (item ? 'Edit item' : (quickCatalogMode ? '⚡ New item (quick catalog)' : 'New item'));
    if (item && !isDuplicate && item.productCode){
      document.getElementById('fProductCode').value = item.productCode;
      productCodeIsAutoSuggested = false;
    } else {
      fillNextProductCode(document.getElementById('fProductCode'));
      productCodeIsAutoSuggested = true;
    }
    document.getElementById('fStorageBox').value = (item && !isDuplicate) ? (item.storageBox || '') : lastUsedBox;
    document.getElementById('storageBoxList').innerHTML = getAllStorageBoxes().map(b => `<option value="${escapeHtml(b)}">`).join('');
    document.getElementById('fSource').value = (item && !isDuplicate) ? (item.source || '') : lastUsedSource;
    document.getElementById('categoryList').innerHTML = getAllCategories().map(c => `<option value="${escapeHtml(c)}">`).join('');
    document.getElementById('colorList').innerHTML = getAllColors().map(c => `<option value="${escapeHtml(c)}">`).join('');
    {
      const categorySelect = document.getElementById('fCategory');
      const categoryOther = document.getElementById('fCategoryOther');
      const categoryOtherOption = document.getElementById('fCategoryOtherOption');
      // Presets and any category she's typed before (via "Add new…") are
      // merged into one alphabetical list and rebuilt every time the modal
      // opens — "Add new…" itself stays pinned last.
      categorySelect.querySelectorAll('option[data-custom="1"]').forEach(o => o.remove());
      Array.from(new Set([...PRESET_CATEGORIES, ...getAllCategories()]))
        .sort((a,b)=> a.localeCompare(b, undefined, {numeric:true}))
        .forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        opt.dataset.custom = '1';
        categorySelect.insertBefore(opt, categoryOtherOption);
      });

      const currentCategory = (item && !isDuplicate) ? (item.category || '') : lastUsedCategory;
      const knownCategoryValues = Array.from(categorySelect.options).map(o => o.value);
      if (currentCategory && !knownCategoryValues.includes(currentCategory)){
        categorySelect.value = '__other__';
        categoryOther.value = currentCategory;
        categoryOther.style.display = 'block';
      } else {
        categorySelect.value = currentCategory || 'Clothing';
        categoryOther.value = '';
        categoryOther.style.display = 'none';
      }
    }
    {
      const colorSelect = document.getElementById('fColor');
      const colorOther = document.getElementById('fColorOther');
      const otherOption = document.getElementById('fColorOtherOption');
      // Presets and any color she's typed before (via "Other…") are merged
      // into one alphabetical list and rebuilt every time the modal opens —
      // "—" and "Other…" stay pinned first/last.
      colorSelect.querySelectorAll('option[data-custom="1"]').forEach(o => o.remove());
      Array.from(new Set([...PRESET_COLORS, ...getAllColors()]))
        .sort((a,b)=> a.localeCompare(b, undefined, {numeric:true}))
        .forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        opt.dataset.custom = '1';
        colorSelect.insertBefore(opt, otherOption);
      });

      const currentColor = (item && !isDuplicate) ? (item.color || '') : '';
      const knownValues = Array.from(colorSelect.options).map(o => o.value);
      if (currentColor && !knownValues.includes(currentColor)){
        colorSelect.value = '__other__';
        colorOther.value = currentColor;
        colorOther.style.display = 'block';
      } else {
        colorSelect.value = currentColor;
        colorOther.value = '';
        colorOther.style.display = 'none';
      }
    }
    document.getElementById('clothingTypeList').innerHTML = getAllClothingTypes().map(c => `<option value="${escapeHtml(c)}">`).join('');
    {
      const typeSelect = document.getElementById('fClothingType');
      const typeOther = document.getElementById('fClothingTypeOther');
      const typeOtherOption = document.getElementById('fClothingTypeOtherOption');
      // Presets and any clothing type she's typed before (via "Other…") are
      // merged into one alphabetical list and rebuilt every time the modal
      // opens — same as Category and Color — "—" and "Other…" stay pinned
      // first/last.
      typeSelect.querySelectorAll('option[data-custom="1"]').forEach(o => o.remove());
      Array.from(new Set([...PRESET_CLOTHING_TYPES, ...getAllClothingTypes()]))
        .sort((a,b)=> a.localeCompare(b, undefined, {numeric:true}))
        .forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        opt.dataset.custom = '1';
        typeSelect.insertBefore(opt, typeOtherOption);
      });

      const currentType = (item && !isDuplicate) ? (item.clothingType || '') : '';
      const knownTypeValues = Array.from(typeSelect.options).map(o => o.value);
      if (currentType && !knownTypeValues.includes(currentType)){
        typeSelect.value = '__other__';
        typeOther.value = currentType;
        typeOther.style.display = 'block';
      } else {
        typeSelect.value = currentType;
        typeOther.value = '';
        typeOther.style.display = 'none';
      }
    }
    document.getElementById('fName').value = isDuplicate ? (item?.name || '') + ' (copy)' : (item?.name || '');
    // Quantity only makes sense when creating brand-new entries — editing an
    // existing item already represents exactly one physical piece.
    document.getElementById('fQuantity').value = '1';
    document.getElementById('fQuantityField').style.display = (item && !isDuplicate) ? 'none' : 'block';
    document.getElementById('fEbayCategoryQuery').value = '';
    document.getElementById('fEbayCategoryQuery').dataset.lastQuery = '';
    document.getElementById('ebayCategoryResults').innerHTML = '';
    // Quick Catalog carries the eBay category forward from one item to the
    // next (she's often cataloging a run of similar pieces) — still
    // per-item changeable, just saves re-searching the same one every time.
    const carryOverCategory = (!item && quickCatalogMode) ? lastUsedEbayCategory : null;
    // Strip any stale Department/Brand/Color/Size key that may have been
    // saved before EBAY_ASPECTS_AUTO_COVERED excluded them from this form
    // (or carried over from duplicating/re-categorizing an item) — the UI
    // never shows these to edit or clear, so a leftover value would keep
    // silently overriding the real field at publish time forever otherwise.
    // api/ebay-list.js guards against this too, but cleaning it here stops
    // it from being re-saved on every future edit.
    currentEbayAspects = (item && !isDuplicate && item.ebayAspects) ? { ...item.ebayAspects } : {};
    EBAY_ASPECTS_AUTO_COVERED.forEach(name => { delete currentEbayAspects[name]; });
    setChosenEbayCategory((item && item.ebayCategoryId)
      ? { id: item.ebayCategoryId, path: item.ebayCategoryPath || item.ebayCategoryId, validConditions: item.ebayValidConditions || null }
      : carryOverCategory);
    document.getElementById('fBrand').value = item?.brand || '';
    document.getElementById('fGender').value = item?.gender || '';
    document.getElementById('fSize').value = item?.size || '';
    renderEbaySizeCheck();
    document.getElementById('fCondition').value = item?.condition || 'excelente';
    conditionBeforeNwtQuick = null;
    syncNwtQuickCheckbox();
    document.getElementById('fCost').value = item?.cost || '';
    document.getElementById('fWeight').value = item?.weight || '';
    document.getElementById('fLen').value = item?.length || '';
    document.getElementById('fWid').value = item?.width || '';
    document.getElementById('fHei').value = item?.height || '';
    if ((!item || isDuplicate) && getCategoryValue() === 'Clothing'){
      applyDefaultClothingShippingIfEmpty();
      applyDefaultSizeTypeIfEmpty();
    }
    document.getElementById('fNotes').value = item?.notes || '';
    document.getElementById('fListPrice').value = isDuplicate ? '' : (item?.listPrice || '');
    updateListingGeneratorUI();
    const itemFreeShipping = item?.freeShipping !== undefined ? item.freeShipping : appSettings.sellerPaysShipping;
    document.getElementById('fFreeShipping').value = itemFreeShipping ? 'seller' : 'buyer';
    document.getElementById('suggestionArea').innerHTML = '';
    // A previously generated/saved listing description belongs to this item
    // (it's what's actually sent to eBay and copied to Poshmark) — show it
    // again instead of leaving the panel blank and making her regenerate it
    // just to see it.
    if (item && !isDuplicate && item.listingDescription){
      renderListingOutput(item.listingTitle || '', item.listingDescription, [...(item.listingStyleTags || [])], item.listingIsAi ? AI_LISTING_SOURCE_LABEL : null);
    } else {
      document.getElementById('listingOutputArea').innerHTML = '';
    }
    // Same idea as the listing description above — a previously generated AI
    // photo analysis belongs to this item, so show it again instead of
    // making her regenerate it just to see it.
    currentAiAnalysis = (item && !isDuplicate && item.aiAnalysis) ? item.aiAnalysis : null;
    currentAiFacts = (item && !isDuplicate && item.aiFacts) ? item.aiFacts : null;
    pendingAiEbayAspects = null;
    if (currentAiAnalysis){
      renderAiAnalysis(currentAiAnalysis);
    } else {
      document.getElementById('aiAnalysisArea').innerHTML = '';
    }
    // Same idea as the listing description/AI analysis above — an item
    // already published to eBay should show its "Already listed" link
    // immediately on reopen, not leave the panel blank until she clicks
    // "List on eBay" again just to see the link she already has.
    if (item && !isDuplicate && item.ebayListingId){
      const alreadyUrl = item.ebayListingUrl || `https://www.ebay.com/itm/${item.ebayListingId}`;
      document.getElementById('ebayStatusArea').innerHTML = `<div class="ebay-status-box success">✅ Already listed on eBay · <a href="${escapeHtml(alreadyUrl)}" target="_blank">View listing ↗</a></div>`;
    } else {
      document.getElementById('ebayStatusArea').innerHTML = '';
    }
    setSaveProgress(null);
    document.getElementById('deleteItemBtn').style.display = (item && !isDuplicate) ? 'block' : 'none';
    document.getElementById('duplicateItemBtn').style.display = (item && !isDuplicate) ? 'block' : 'none';
    // Same "only once it's a real saved item" gate as Duplicate/Delete —
    // saving a brand-new item reopens the modal with a real id (see
    // saveItemFlow), so this appears right in the card the moment it's
    // actually savable to a label, no extra step needed.
    document.getElementById('printLabelItemBtn').style.display = (item && !isDuplicate) ? 'block' : 'none';

    renderPhotoPreviews();
    renderMeasureChips();
    setStatusUI(currentStatus);
    setPrepUI(currentPrep);
    setListedPlatformsUI((item && !isDuplicate && Array.isArray(item.listedPlatforms)) ? [...item.listedPlatforms] : []);
    renderSoldFields(item && !isDuplicate ? item : null);
    attachCurrencyFormatting(['fCost','fListPrice']);
    ['fCost','fListPrice'].forEach(id => {
      const el = document.getElementById(id);
      if (el.value !== '') el.value = parseFloat(el.value).toFixed(2);
    });

    overlay.classList.remove('hidden');
    // Save re-opens the same item right after writing it (so "List on eBay"
    // works without an extra click) — that's not a fresh open, so don't
    // yank her scroll position back to the top of a form she was already
    // scrolled through.
    if (!keepScroll){
      const modalScrollEl = document.querySelector('#itemModalOverlay .modal');
      if (modalScrollEl) modalScrollEl.scrollTop = 0;
      const backToTopBtn = document.getElementById('modalBackToTop');
      if (backToTopBtn) backToTopBtn.style.display = 'none';
    }
  }

  function closeModal(){
    overlay.classList.add('hidden');
  }

  // Small confirmation toast shown after a successful save, since closing
  // the modal and landing back on the catalog gave no visible confirmation
  // that the save actually worked.
  function showSavedToast(){
    let toast = document.getElementById('savedToast');
    if (!toast){
      toast = document.createElement('div');
      toast.id = 'savedToast';
      toast.style.cssText = 'position:fixed; left:50%; bottom:28px; transform:translateX(-50%); background:var(--plum, #2B241E); color:white; padding:11px 20px; border-radius:999px; font-size:13px; font-weight:600; box-shadow:0 6px 18px rgba(0,0,0,0.25); z-index:9999; opacity:0; transition:opacity 0.25s ease;';
      document.body.appendChild(toast);
    }
    toast.textContent = '✓ Item saved';
    toast.style.opacity = '1';
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => { toast.style.opacity = '0'; }, 2000);
  }

  // ---------- THERMAL LABEL PRINTING ----------
  // Label markup and canvas drawing live in src/ui/label-render.js; the
  // print modal, Quick Labels, storage boxes and Stock Transfer in
  // src/ui/labels/; printing and file saving in src/platform/. Their
  // listeners are wired here, where they used to be.
  initPrintModal({ saveItem });
  initStorageBoxes({ saveSettings, refresh: renderStock });
  initQuickLabels({ saveItem, saveSettings, getAllStorageBoxes });
  initStockTransfer({ saveItem, saveSettings, getAllStorageBoxes });
  initPrint();

  let quickCatalogMode = false;

  document.getElementById('fabNewItem').addEventListener('click', () => openModal(null));
  document.getElementById('fabQuickCatalog').addEventListener('click', () => {
    quickCatalogMode = true;
    openModal(null);
  });
  // Closing with several photos already added risks losing real work (she's
  // usually mid-cataloging by the time that many photos are in) — autosave
  // first rather than silently discarding them. A handful of photos with
  // nothing else filled in is cheap to redo, so the threshold only kicks in
  // once there's enough at stake to be worth the silent save.
  const AUTOSAVE_ON_CLOSE_PHOTO_THRESHOLD = 4;
  async function closeModalWithAutosaveIfNeeded(){
    if (currentPhotos.length > AUTOSAVE_ON_CLOSE_PHOTO_THRESHOLD){
      await saveItemFlow({ skipValidation: true, suppressReopen: true });
    }
    quickCatalogMode = false;
    currentDraftId = null;
    closeModal();
  }
  document.getElementById('cancelItemBtn').addEventListener('click', closeModalWithAutosaveIfNeeded);
  document.getElementById('modalCloseX').addEventListener('click', closeModalWithAutosaveIfNeeded);

  // Keyboard shortcuts for the item form — mainly for Quick Catalog, where
  // the whole point is speed and hands ideally never leave the keyboard.
  // Ctrl/Cmd+Enter works from inside any field (including textareas) without
  // interfering with a plain Enter keypress. Esc mirrors the Cancel button
  // exactly (no confirmation today, so this isn't a new risk, just a new way
  // to reach the same action) — skipped while the photo lightbox is open on
  // top of the modal so it doesn't steal Esc from lightbox navigation.
  document.addEventListener('keydown', (e) => {
    if (document.getElementById('itemModalOverlay').classList.contains('hidden')) return;
    if (isLightboxOpen()) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter'){
      e.preventDefault();
      document.getElementById('saveItemBtn').click();
    } else if (e.key === 'Escape'){
      document.getElementById('cancelItemBtn').click();
    }
  });
  {
    const modalEl = document.querySelector('#itemModalOverlay .modal');
    const backToTopBtn = document.getElementById('modalBackToTop');
    if (modalEl && backToTopBtn){
      modalEl.addEventListener('scroll', () => {
        backToTopBtn.style.display = modalEl.scrollTop > 300 ? 'flex' : 'none';
      });
      backToTopBtn.addEventListener('click', () => {
        modalEl.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }
  }
  {
    // Same "back to top" affordance, for the whole page (catalog/reports/
    // finance/settings views can all get long) rather than just the item
    // modal — the page scrolls at the document level, not inside a div.
    const pageBackToTopBtn = document.getElementById('pageBackToTop');
    if (pageBackToTopBtn){
      window.addEventListener('scroll', () => {
        pageBackToTopBtn.style.display = window.scrollY > 300 ? 'flex' : 'none';
      });
      pageBackToTopBtn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }
  }

  // ---------- PHOTO SESSION ----------
  // Lets her batch-photograph a whole haul first and catalog every piece
  // later, instead of stopping to fill in the item form between each one.
  // Each group of photos becomes a draft in the `drafts` collection (its own
  // collection so it never mixes into `items` or anything derived from it —
  // catalog, stats, filters, CSV export).
  let photoSessionCurrentPhotos = [];
  let photoSessionItemCount = 1;
  let photoSessionSavedCount = 0;

  function renderPhotoSessionGrid(){
    const grid = document.getElementById('photoSessionGrid');
    grid.innerHTML = photoSessionCurrentPhotos.map((src, idx) => `
      <div class="photo-preview" data-idx="${idx}">
        <img src="${src}">
        <button class="rm-btn" data-idx="${idx}" data-act="rm-session-photo">✕</button>
      </div>
    `).join('');
    document.getElementById('photoSessionCounter').textContent = `Item ${photoSessionItemCount} — ${photoSessionCurrentPhotos.length} photo${photoSessionCurrentPhotos.length===1?'':'s'}`;
    grid.querySelectorAll('[data-act="rm-session-photo"]').forEach(btn => {
      btn.addEventListener('click', () => {
        photoSessionCurrentPhotos.splice(parseInt(btn.dataset.idx), 1);
        renderPhotoSessionGrid();
      });
    });
  }

  function resetPhotoSession(){
    photoSessionCurrentPhotos = [];
    photoSessionItemCount = 1;
    photoSessionSavedCount = 0;
    renderPhotoSessionGrid();
  }

  // Compresses+hosts the current group's photos and saves it as a draft doc
  // — called by both "Next item" and "Finish session" so a group is only
  // ever lost if she deliberately discards it via Cancel session.
  async function commitCurrentPhotoSessionGroup(){
    if (photoSessionCurrentPhotos.length === 0) return;
    const draftId = uid();
    const hostedUrls = await ensurePhotosHostedForSave(draftId, photoSessionCurrentPhotos);
    const draft = { id: draftId, photos: hostedUrls, createdAt: Date.now() };
    await saveDraftToDb(draft);
    draftItems.push(draft);
    photoSessionSavedCount++;
  }

  document.getElementById('fabPhotoSession').addEventListener('click', () => {
    resetPhotoSession();
    document.getElementById('photoSessionOverlay').classList.remove('hidden');
  });

  document.getElementById('photoSessionInput').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    const remaining = MAX_PHOTOS - photoSessionCurrentPhotos.length;
    const toProcess = files.slice(0, Math.max(0, remaining));
    if (files.length > toProcess.length){
      alert(`Only added ${toProcess.length} photo(s) — that brings this item to the ${MAX_PHOTOS}-photo limit.`);
    }
    for (const file of toProcess){
      try{
        const compressed = await compressImage(file);
        photoSessionCurrentPhotos.push(compressed);
        renderPhotoSessionGrid();
      }catch(err){
        console.error('Photo session processing error', err);
      }
    }
    e.target.value = '';
  });

  document.getElementById('photoSessionNextBtn').addEventListener('click', async () => {
    if (photoSessionCurrentPhotos.length === 0){
      alert('Add at least one photo for this item before moving to the next.');
      return;
    }
    const btn = document.getElementById('photoSessionNextBtn');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try{
      await commitCurrentPhotoSessionGroup();
      photoSessionCurrentPhotos = [];
      photoSessionItemCount++;
      renderPhotoSessionGrid();
      renderAll(); // refreshes the drafts banner count in the background
    }finally{
      btn.disabled = false;
      btn.textContent = 'Next item →';
    }
  });

  document.getElementById('photoSessionFinishBtn').addEventListener('click', async () => {
    const btn = document.getElementById('photoSessionFinishBtn');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try{
      await commitCurrentPhotoSessionGroup(); // saves the last in-progress group too, if any
      document.getElementById('photoSessionOverlay').classList.add('hidden');
      renderAll();
      if (photoSessionSavedCount > 0) showSavedToast();
    }finally{
      btn.disabled = false;
      btn.textContent = '✓ Finish session';
    }
  });

  document.getElementById('photoSessionCancelBtn').addEventListener('click', () => {
    const inProgress = photoSessionCurrentPhotos.length > 0;
    if (inProgress && !confirm(`Discard the photo(s) for the current item? Any earlier items already marked "Next item" this session are already saved as drafts and won't be lost.`)) return;
    document.getElementById('photoSessionOverlay').classList.add('hidden');
  });

  // Opens the item form pre-loaded with a draft's photos, as if starting a
  // brand-new item — currentDraftId remembers the source draft so a
  // successful save deletes it from the `drafts` collection afterward.
  // Deliberately calls openModal(null) rather than passing the draft as
  // `item` — openModal's isDuplicate path appends " (copy)" to the name
  // field, which doesn't apply here since a draft never has a name yet.
  function openDraftForCataloging(draft){
    currentDraftId = draft.id;
    openModal(null);
    currentPhotos = [...draft.photos];
    renderPhotoPreviews();
    document.getElementById('modalTitle').textContent = '📷 Complete draft item';
  }

  document.getElementById('fColor').addEventListener('change', (e) => {
    const other = document.getElementById('fColorOther');
    if (e.target.value === '__other__'){
      other.style.display = 'block';
      other.focus();
    } else {
      other.style.display = 'none';
      other.value = '';
    }
  });

  document.getElementById('fClothingType').addEventListener('change', (e) => {
    const other = document.getElementById('fClothingTypeOther');
    if (e.target.value === '__other__'){
      other.style.display = 'block';
      other.focus();
    } else {
      other.style.display = 'none';
      other.value = '';
    }
    // Picking any clothing type is a strong signal this is a garment —
    // fill in the standard shipping box size if it hasn't been set yet.
    if (e.target.value) applyDefaultClothingShippingIfEmpty();
    refreshAutoEbayType();
  });

  document.getElementById('fCategory').addEventListener('change', (e) => {
    const other = document.getElementById('fCategoryOther');
    if (e.target.value === '__other__'){
      other.style.display = 'block';
      other.focus();
    } else {
      other.style.display = 'none';
      other.value = '';
    }
    // Picking "Clothing" also fills the default shipping box, since Category
    // defaults to "Clothing" but she can change it before dimensions are entered.
    if (e.target.value === 'Clothing'){
      applyDefaultClothingShippingIfEmpty();
      applyDefaultSizeTypeIfEmpty();
    }
  });
  // Typing a custom category also gets the chance to trigger the default
  // shipping fill if she types "Clothing" manually via "Add new…" (edge case).
  document.getElementById('fCategoryOther').addEventListener('blur', (e) => {
    if (e.target.value.trim() === 'Clothing'){
      applyDefaultClothingShippingIfEmpty();
      applyDefaultSizeTypeIfEmpty();
    }
  });

  document.getElementById('fName').addEventListener('blur', (e) => {
    if (e.target.value.trim()) e.target.value = toTitleCase(e.target.value.trim());
  });

  // Any manual edit to the auto-filled Product Code suggestion means Save
  // should no longer trust it blindly — it now needs the duplicate check
  // instead of an atomic reservation (see productCodeIsAutoSuggested).
  document.getElementById('fProductCode').addEventListener('input', () => {
    productCodeIsAutoSuggested = false;
  });

  document.getElementById('duplicateItemBtn').addEventListener('click', () => {
    const item = items.find(i => i.id === currentEditId);
    if (item) openModal(item, true);
  });

  // Same batch-of-one print pipeline as the Catalog card's print button
  // and Select → "Print labels" (see v3.13.99) — one label-rendering
  // implementation, so this is guaranteed to look exactly the same.
  document.getElementById('printLabelItemBtn').addEventListener('click', () => {
    const item = items.find(i => i.id === currentEditId);
    if (item) openBatchLabelModal([item]);
  });

  // ================= MEASUREMENT TOOL =================
  // Everything in this block is defensively wrapped: a failure here must never
  // freeze the rest of the app (this is what caused the old "Loading your pieces…"
  // bug — a canvas API call that Safari/iOS didn't support, with no error boundary).
  const GARMENT_MEASUREMENTS = {
    Top: ['Pit to pit', 'Length (shoulder to hem)', 'Sleeve length', 'Shoulder width'],
    Pants: ['Waist', 'Inseam', 'Length (outseam)', 'Hip'],
    Dress: ['Pit to pit', 'Length', 'Waist'],
    Outerwear: ['Pit to pit', 'Length', 'Sleeve length', 'Shoulder width'],
    Shoes: ['Length (insole)', 'Width'],
    Other: ['Length', 'Width'],
  };

  let measureImgEl = null;
  // Either a single number (pixels/inch, uniform scale — tape-measure calibration)
  // or {h, v} (pixels/inch per axis — wall-marker calibration, which can differ
  // slightly per axis if the camera wasn't perfectly square-on to the wall).
  let measureScale = null;
  let measurePoints = [];         // in-progress tap points for the current line
  let measureMode = null;         // 'calibrate' | 'calibrate-markers' | 'measure' | null
  let measureActiveField = null;
  let measureValues = {};         // { label: inches }
  let measureCalibrationLines = []; // [{p1,p2,label}] — 1 line for tape mode, 2 (h+v) for wall-marker mode
  let measureAnnotations = [];    // [{p1,p2,label}]
  let measureWallPoints = {};     // { left, right, top, bottom } while tapping wall markers
  const WALL_MARKER_ORDER = ['left', 'right', 'top', 'bottom'];
  let measureZoom = 1;
  let measurePanX = 0, measurePanY = 0;  // screen-pixel pan offset, applied before scale
  let measureGesture = null;             // tracks the in-progress touch gesture (pan / pinch / tap)

  function renderMeasureChips(){
    try{
      const row = document.getElementById('measureChipRow');
      if (!row) return;
      const values = currentMeasurements?.values || {};
      if (Object.keys(values).length === 0){
        row.innerHTML = '<span style="font-size:12px; color:var(--plum-soft);">No measurements yet</span>';
        return;
      }
      row.innerHTML = Object.entries(values).map(([k,v]) =>
        `<span class="measure-chip">${escapeHtml(k)}: ${v.toFixed(1)}"</span>`
      ).join('');
    }catch(e){ console.error('renderMeasureChips failed', e); }
  }

  function openMeasureTool(){
    try{
      if (currentPhotos.length === 0){
        alert('Add at least one photo of the item next to a tape measure or ruler first.');
        return;
      }
      measureImgEl = null; measureScale = null; measurePoints = []; measureMode = null;
      measureActiveField = null; measureCalibrationLines = []; measureAnnotations = [];
      measureWallPoints = {};
      measureValues = currentMeasurements?.values ? { ...currentMeasurements.values } : {};
      setMeasureZoom(1);

      document.getElementById('measureStepPicker').style.display = 'block';
      document.getElementById('measureStepWork').style.display = 'none';
      document.getElementById('measureApplyBtn').style.display = 'none';
    document.getElementById('measureSavePhotoBtn').style.display = 'none';
      document.getElementById('measurePhotoPicker').innerHTML = currentPhotos.map((src, idx) =>
        `<img src="${src}" data-idx="${idx}" alt="photo ${idx+1}">`
      ).join('');
      document.getElementById('measureModalOverlay').classList.remove('hidden');
    }catch(e){
      console.error('openMeasureTool failed', e);
      alert("Couldn't open the measurement tool. Your item data is safe — try again, or add measurements manually in Notes.");
    }
  }

  function closeMeasureTool(){
    document.getElementById('measureModalOverlay').classList.add('hidden');
  }

  // Zoom/pan are applied as a CSS transform on the canvas itself (not a native
  // scroll container) — that's what makes pinch and one-finger drag reliable
  // inside a modal, and getBoundingClientRect() reflects CSS transforms, so
  // getCanvasPoint's existing rect-based math keeps mapping taps correctly
  // with no extra coordinate math needed anywhere else.
  function clampMeasurePan(){
    const canvas = document.getElementById('measureCanvas');
    const wrap = canvas.parentElement;
    const baseW = wrap.clientWidth;
    const baseH = canvas.width ? baseW * (canvas.height / canvas.width) : wrap.clientHeight;
    const scaledW = baseW * measureZoom, scaledH = baseH * measureZoom;
    measurePanX = scaledW <= baseW ? 0 : Math.min(0, Math.max(baseW - scaledW, measurePanX));
    measurePanY = scaledH <= baseH ? 0 : Math.min(0, Math.max(baseH - scaledH, measurePanY));
  }

  function applyMeasureTransform(){
    const canvas = document.getElementById('measureCanvas');
    canvas.style.transformOrigin = '0 0';
    canvas.style.transform = `translate(${measurePanX}px, ${measurePanY}px) scale(${measureZoom})`;
  }

  function setMeasureZoom(z){
    measureZoom = Math.max(1, Math.min(4, z));
    if (measureZoom === 1){ measurePanX = 0; measurePanY = 0; }
    clampMeasurePan();
    applyMeasureTransform();
  }

  // Zooms while keeping whatever content is under (clientX, clientY) visually
  // stationary — without this, zooming always grows from the canvas's
  // top-left corner, which makes the image appear to lurch toward one side
  // instead of zooming into where your fingers (or the pinch center) are.
  function zoomAroundPoint(newZoom, clientX, clientY){
    const canvas = document.getElementById('measureCanvas');
    const wrap = canvas.parentElement;
    const wrapRect = wrap.getBoundingClientRect();
    const oldZoom = measureZoom;
    newZoom = Math.max(1, Math.min(4, newZoom));

    const offsetX = clientX - wrapRect.left;
    const offsetY = clientY - wrapRect.top;
    const localX = (offsetX - measurePanX) / oldZoom;
    const localY = (offsetY - measurePanY) / oldZoom;

    measureZoom = newZoom;
    measurePanX = offsetX - localX * newZoom;
    measurePanY = offsetY - localY * newZoom;
    if (measureZoom === 1){ measurePanX = 0; measurePanY = 0; }
    clampMeasurePan();
    applyMeasureTransform();
  }

  function zoomAroundWrapCenter(newZoom){
    const canvas = document.getElementById('measureCanvas');
    const rect = canvas.parentElement.getBoundingClientRect();
    zoomAroundPoint(newZoom, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }
  document.getElementById('measureZoomInBtn').addEventListener('click', () => zoomAroundWrapCenter(measureZoom + 0.5));
  document.getElementById('measureZoomOutBtn').addEventListener('click', () => zoomAroundWrapCenter(measureZoom - 0.5));
  document.getElementById('measureZoomResetBtn').addEventListener('click', () => setMeasureZoom(1));

  function getCanvasPointFromClient(clientX, clientY){
    const canvas = document.getElementById('measureCanvas');
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  }

  // Single entry point for "a point was tapped" — shared by mouse clicks
  // (desktop) and the touch-gesture handler below (mobile), so calibration
  // and measurement taps behave identically regardless of input device.
  function handleMeasureTap(clientX, clientY){
    if (!measureMode) return;
    const pt = getCanvasPointFromClient(clientX, clientY);

    if (measureMode === 'calibrate-markers'){
      const nextKey = WALL_MARKER_ORDER.find(k => !measureWallPoints[k]);
      if (!nextKey) return;
      measureWallPoints[nextKey] = pt;
      redrawMeasureCanvas();
      updateUndoButtonVisibility();
      const remainingKey = WALL_MARKER_ORDER.find(k => !measureWallPoints[k]);
      if (remainingKey) updateWallMarkerProgress(remainingKey);
      else confirmWallMarkerCalibration();
      return;
    }

    measurePoints.push(pt);
    redrawMeasureCanvas();
    if (measurePoints.length === 2 && measureMode === 'measure'){
      finalizeMeasurement();
    }
  }

  // ---- Touch gestures on the canvas: 1-finger tap (place point) vs 1-finger
  // drag (pan, only meaningful once zoomed) vs 2-finger pinch (zoom). ----
  const TAP_MOVE_THRESHOLD = 8; // px of movement before a touch counts as a drag, not a tap

  function touchDist(t1, t2){
    return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
  }
  function touchMid(t1, t2){
    return { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
  }

  document.getElementById('measureCanvas').addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (e.touches.length === 2){
      measureGesture = {
        type: 'pinch',
        startDist: touchDist(e.touches[0], e.touches[1]),
        startZoom: measureZoom,
      };
    } else if (e.touches.length === 1){
      const t = e.touches[0];
      measureGesture = {
        type: 'tap',
        startX: t.clientX, startY: t.clientY,
        lastX: t.clientX, lastY: t.clientY,
        startPanX: measurePanX, startPanY: measurePanY,
      };
    }
  }, { passive: false });

  document.getElementById('measureCanvas').addEventListener('touchmove', (e) => {
    if (!measureGesture) return;
    e.preventDefault();
    if (measureGesture.type === 'pinch' && e.touches.length === 2){
      const dist = touchDist(e.touches[0], e.touches[1]);
      const mid = touchMid(e.touches[0], e.touches[1]);
      zoomAroundPoint(measureGesture.startZoom * (dist / measureGesture.startDist), mid.x, mid.y);
    } else if ((measureGesture.type === 'tap' || measureGesture.type === 'pan') && e.touches.length === 1){
      const t = e.touches[0];
      const dx = t.clientX - measureGesture.startX, dy = t.clientY - measureGesture.startY;
      if (measureGesture.type === 'tap' && Math.hypot(dx, dy) > TAP_MOVE_THRESHOLD){
        measureGesture.type = 'pan';
      }
      if (measureGesture.type === 'pan' && measureZoom > 1){
        measurePanX = measureGesture.startPanX + dx;
        measurePanY = measureGesture.startPanY + dy;
        clampMeasurePan();
        applyMeasureTransform();
      }
      measureGesture.lastX = t.clientX; measureGesture.lastY = t.clientY;
    }
  }, { passive: false });

  document.getElementById('measureCanvas').addEventListener('touchend', (e) => {
    if (measureGesture && measureGesture.type === 'tap'){
      handleMeasureTap(measureGesture.lastX, measureGesture.lastY);
    }
    measureGesture = e.touches.length > 0 ? measureGesture : null;
  }, { passive: false });

  function loadImageToCanvas(src, cb){
    try{
      const img = new Image();
      img.onload = () => {
        try{
          measureImgEl = img;
          const canvas = document.getElementById('measureCanvas');
          const maxW = 900;
          const scale = Math.min(1, maxW / img.naturalWidth);
          canvas.width = Math.round(img.naturalWidth * scale);
          canvas.height = Math.round(img.naturalHeight * scale);
          redrawMeasureCanvas();
          if (cb) cb();
        }catch(e){ console.error('image onload handling failed', e); }
      };
      img.onerror = () => alert("Couldn't load that photo. Try a different one.");
      img.src = src;
    }catch(e){ console.error('loadImageToCanvas failed', e); }
  }

  function drawMeasureLine(ctx, p1, p2, label, color){
    ctx.strokeStyle = color; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    ctx.fillStyle = color;
    [p1, p2].forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI*2); ctx.fill(); });
    if (label){
      ctx.font = 'bold 14px sans-serif';
      const textW = ctx.measureText(label).width;
      const midX = (p1.x + p2.x) / 2, midY = (p1.y + p2.y) / 2;
      // Plain fillRect (no roundRect) — kept deliberately simple for cross-browser safety.
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(midX - textW/2 - 5, midY - 18, textW + 10, 20);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, midX - textW/2, midY - 3);
    }
  }

  function redrawMeasureCanvas(){
    try{
      const canvas = document.getElementById('measureCanvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (measureImgEl) ctx.drawImage(measureImgEl, 0, 0, canvas.width, canvas.height);
      // Calibration reference lines are only useful while actively calibrating —
      // once you've moved on to measuring the garment (or applied/saved the
      // photo), they'd just be clutter over the item itself.
      const showCalibLines = measureMode === 'calibrate-markers';
      if (showCalibLines){
        measureCalibrationLines.forEach(l => drawMeasureLine(ctx, l.p1, l.p2, l.label, '#4da6ff'));
      }
      measureAnnotations.forEach(a => drawMeasureLine(ctx, a.p1, a.p2, a.label, '#e8c400'));
      // Wall-marker taps collected so far, before the 4th completes the calibration
      Object.entries(measureWallPoints).forEach(([key, p]) => {
        ctx.fillStyle = '#4da6ff';
        ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI*2); ctx.fill();
        ctx.font = 'bold 12px sans-serif'; ctx.fillStyle = '#fff';
        ctx.fillText(key[0].toUpperCase(), p.x - 3, p.y + 4);
      });
      if (measurePoints.length > 0){
        ctx.fillStyle = '#ff5252';
        measurePoints.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI*2); ctx.fill(); });
        if (measurePoints.length === 2){
          ctx.strokeStyle = '#ff5252'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(measurePoints[0].x, measurePoints[0].y);
          ctx.lineTo(measurePoints[1].x, measurePoints[1].y); ctx.stroke();
        }
      }
    }catch(e){ console.error('redrawMeasureCanvas failed', e); }
  }

  function switchToCalibrationStep(){
    measurePoints = [];
    measureWallPoints = {};
    document.getElementById('measureStepPicker').style.display = 'none';
    document.getElementById('measureStepWork').style.display = 'block';
    document.getElementById('measureStepLabel').textContent = 'Step 2 · Calibrate with wall markers';
    document.getElementById('measureTypeStep').style.display = 'none';
    document.getElementById('measureFieldList').innerHTML = '';
    document.getElementById('measureApplyBtn').style.display = 'none';
    document.getElementById('measureSavePhotoBtn').style.display = 'none';
    document.getElementById('measureCalibWarning').style.display = 'none';
    measureMode = 'calibrate-markers';
    updateWallMarkerProgress('left');
    updateUndoButtonVisibility();
    redrawMeasureCanvas();
  }

  const WALL_MARKER_LABEL = { left: 'LEFT', right: 'RIGHT', top: 'TOP', bottom: 'BOTTOM' };

  // Rough expected position of each marker within the photo (fraction of
  // width/height) — markers sit near the edges of the frame in a cross
  // layout, so this guess is normally close enough that the auto-zoom lands
  // right on (or very near) the marker; if it's off, a 1-finger drag still
  // repositions the view before tapping.
  const WALL_MARKER_GUESS = {
    left:   { fx: 0.08, fy: 0.5 },
    right:  { fx: 0.92, fy: 0.5 },
    top:    { fx: 0.5,  fy: 0.08 },
    bottom: { fx: 0.5,  fy: 0.92 },
  };
  const MARKER_AUTO_ZOOM = 3;

  // Sets pan/zoom so a given fractional position of the (unzoomed) photo is
  // centered in the viewport — used to auto-jump to each marker's expected
  // spot instead of making the user manually zoom in/out for every marker.
  function centerViewOnFraction(fx, fy, zoom){
    const canvas = document.getElementById('measureCanvas');
    const wrap = canvas.parentElement;
    const baseW = wrap.clientWidth;
    const baseH = canvas.width ? baseW * (canvas.height / canvas.width) : wrap.clientHeight;
    measureZoom = Math.max(1, Math.min(4, zoom));
    measurePanX = baseW / 2 - fx * baseW * measureZoom;
    measurePanY = baseH / 2 - fy * baseH * measureZoom;
    clampMeasurePan();
    applyMeasureTransform();
  }

  function updateWallMarkerProgress(key){
    const stepNum = WALL_MARKER_ORDER.indexOf(key) + 1;
    document.getElementById('measureInstructions').textContent =
      `Marker ${stepNum} of 4 — tap the ${WALL_MARKER_LABEL[key]} marker.`;
    const guess = WALL_MARKER_GUESS[key];
    centerViewOnFraction(guess.fx, guess.fy, MARKER_AUTO_ZOOM);
  }

  function updateUndoButtonVisibility(){
    const btn = document.getElementById('measureUndoMarkerBtn');
    const hasAny = WALL_MARKER_ORDER.some(k => measureWallPoints[k]);
    btn.style.display = (measureMode === 'calibrate-markers' && hasAny) ? 'inline-block' : 'none';
  }

  document.getElementById('measureUndoMarkerBtn').addEventListener('click', () => {
    for (let i = WALL_MARKER_ORDER.length - 1; i >= 0; i--){
      const k = WALL_MARKER_ORDER[i];
      if (measureWallPoints[k]){
        delete measureWallPoints[k];
        redrawMeasureCanvas();
        updateWallMarkerProgress(k);
        updateUndoButtonVisibility();
        return;
      }
    }
  });

  function switchToTypeStep(){
    measureMode = null;
    measureActiveField = null;
    document.getElementById('measureStepLabel').textContent = 'Step 3 · Select garment type & measure';
    document.getElementById('measureInstructions').textContent =
      'Choose what to measure below, then tap two points across that measurement on the photo.';
    document.getElementById('measureUndoMarkerBtn').style.display = 'none';
    document.getElementById('measureTypeStep').style.display = 'block';
    renderMeasureFieldList();
  }

  function renderMeasureFieldList(){
    const type = document.getElementById('measureGarmentType').value;
    const fields = GARMENT_MEASUREMENTS[type] || GARMENT_MEASUREMENTS.Other;
    const list = document.getElementById('measureFieldList');
    list.innerHTML = fields.map(f => {
      const hasValue = measureValues[f] != null;
      return `
      <div class="measure-field-row ${measureActiveField===f ? 'active' : ''}" data-field="${escapeHtml(f)}">
        <span>${escapeHtml(f)}</span>
        <span style="display:flex; align-items:center; gap:8px;">
          <span class="val">${hasValue ? measureValues[f].toFixed(1)+'"' : 'tap to measure'}</span>
          ${hasValue ? `
            <button type="button" data-action="redo" data-field="${escapeHtml(f)}" title="Retake this measurement" style="background:none; border:none; font-size:15px; cursor:pointer; padding:2px 4px; color:var(--plum-soft);">↺</button>
            <button type="button" data-action="clear" data-field="${escapeHtml(f)}" title="Clear this measurement" style="background:none; border:none; font-size:14px; cursor:pointer; padding:2px 4px; color:var(--danger);">✕</button>
          ` : ''}
        </span>
      </div>`;
    }).join('');
    const hasAny = Object.keys(measureValues).length > 0;
    document.getElementById('measureApplyBtn').style.display = hasAny ? 'block' : 'none';
    document.getElementById('measureSavePhotoBtn').style.display = hasAny ? 'block' : 'none';
  }

  // measureScale is either a plain number (uniform px/inch, tape-measure
  // calibration) or {h,v} (px/inch per axis, wall-marker calibration).
  function pixelsToInches(p1, p2, scale){
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    if (scale && typeof scale === 'object'){
      const dxIn = dx / scale.h, dyIn = dy / scale.v;
      return Math.hypot(dxIn, dyIn);
    }
    return Math.hypot(dx, dy) / scale;
  }

  function finalizeMeasurement(){
    if (measurePoints.length !== 2 || !measureScale || !measureActiveField) return;
    const inches = pixelsToInches(measurePoints[0], measurePoints[1], measureScale);
    measureValues[measureActiveField] = inches;
    measureAnnotations = measureAnnotations.filter(a => !a.field || a.field !== measureActiveField);
    measureAnnotations.push({
      p1: measurePoints[0], p2: measurePoints[1], field: measureActiveField,
      label: `${measureActiveField}: ${inches.toFixed(1)}"`
    });
    measurePoints = [];
    measureMode = null;
    measureActiveField = null;
    redrawMeasureCanvas();
    renderMeasureFieldList();
  }

  document.getElementById('openMeasureToolBtn').addEventListener('click', () => {
    try{ openMeasureTool(); }catch(e){ console.error(e); }
  });
  document.getElementById('measureCancelBtn').addEventListener('click', closeMeasureTool);
  document.getElementById('measureBackBtn').addEventListener('click', () => {
    try{
      document.getElementById('measureStepPicker').style.display = 'block';
      document.getElementById('measureStepWork').style.display = 'none';
      measureImgEl = null; measureScale = null; measurePoints = []; measureMode = null;
      measureCalibrationLines = []; measureAnnotations = []; measureWallPoints = {};
      setMeasureZoom(1);
    }catch(e){ console.error(e); }
  });

  document.getElementById('measurePhotoPicker').addEventListener('click', (e) => {
    try{
      const img = e.target.closest('img');
      if (!img) return;
      document.querySelectorAll('#measurePhotoPicker img').forEach(i => i.classList.remove('selected'));
      img.classList.add('selected');
      document.getElementById('measureStepPicker').style.display = 'none';
      document.getElementById('measureStepWork').style.display = 'block';
      setMeasureZoom(1);
      loadImageToCanvas(img.src, switchToCalibrationStep);
    }catch(e){ console.error('photo pick failed', e); }
  });

  // Mouse click — desktop only. Touch devices are handled entirely by the
  // touchstart/touchmove/touchend gesture handlers above (which also call
  // handleMeasureTap for an actual tap); browsers don't fire a synthetic
  // click after a touch we've already preventDefault()-ed, so there's no
  // double-handling between the two paths.
  document.getElementById('measureCanvas').addEventListener('click', (e) => {
    try{ handleMeasureTap(e.clientX, e.clientY); }
    catch(err){ console.error('canvas tap failed', err); }
  });

  // If the two axis scales come out very different, it usually means a tap
  // landed on the wrong marker (or a marker isn't quite where it should be) —
  // surfaced as a warning rather than blocked, since a real camera-angle
  // mismatch is possible too and shouldn't be a dead end.
  const CALIB_MISMATCH_WARN_PCT = 15;

  function confirmWallMarkerCalibration(){
    const { left, right, top, bottom } = measureWallPoints;
    const hSpacing = appSettings.wallMarkerSpacingHIn || 24;
    const vSpacing = appSettings.wallMarkerSpacingVIn || 24;
    const hPixels = Math.hypot(right.x - left.x, right.y - left.y);
    const vPixels = Math.hypot(bottom.x - top.x, bottom.y - top.y);
    const scaleH = hPixels / hSpacing, scaleV = vPixels / vSpacing;
    measureScale = { h: scaleH, v: scaleV };
    measureCalibrationLines = [
      { p1: left, p2: right, label: `${hSpacing}"` },
      { p1: top, p2: bottom, label: `${vSpacing}"` },
    ];
    measureWallPoints = {};
    setMeasureZoom(1); // back to full view for the actual garment measuring step
    switchToTypeStep();

    const mismatchPct = Math.abs(scaleH - scaleV) / ((scaleH + scaleV) / 2) * 100;
    const warning = document.getElementById('measureCalibWarning');
    if (mismatchPct > CALIB_MISMATCH_WARN_PCT){
      warning.textContent = `⚠ Horizontal and vertical scales differ by ${mismatchPct.toFixed(0)}% — double-check your marker taps before measuring, or recalibrate.`;
      warning.style.display = 'block';
    } else {
      warning.style.display = 'none';
    }
  }

  document.getElementById('measureGarmentType').addEventListener('change', () => {
    try{
      if (Object.keys(measureValues).length > 0 && !confirm('Switching garment type clears the measurements you already took on this photo. Continue?')){
        return;
      }
      measureValues = {};
      measureAnnotations = [];
      measureActiveField = null;
      redrawMeasureCanvas();
      renderMeasureFieldList();
    }catch(e){ console.error(e); }
  });

  document.getElementById('measureFieldList').addEventListener('click', (e) => {
    try{
      const clearBtn = e.target.closest('[data-action="clear"]');
      if (clearBtn){
        const field = clearBtn.dataset.field;
        delete measureValues[field];
        measureAnnotations = measureAnnotations.filter(a => a.field !== field);
        if (measureActiveField === field){ measureActiveField = null; measureMode = null; measurePoints = []; }
        redrawMeasureCanvas();
        renderMeasureFieldList();
        return;
      }
      const row = e.target.closest('.measure-field-row');
      if (!row) return;
      measureActiveField = row.dataset.field;
      measureMode = 'measure';
      measurePoints = [];
      document.getElementById('measureInstructions').textContent =
        `Tap two points across the "${measureActiveField}" measurement on the photo.`;
      renderMeasureFieldList();
    }catch(e){ console.error(e); }
  });

  // Exports whatever's currently drawn on the canvas (photo + measurement
  // lines) directly, without requiring "Apply to item" first — that button
  // saves the values into the item's fields, which isn't obviously the same
  // thing as "give me the labeled photo" from a first glance at the modal.
  document.getElementById('measureSavePhotoBtn').addEventListener('click', () => {
    try{
      const canvas = document.getElementById('measureCanvas');
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        const code = document.getElementById('fProductCode')?.value || 'measurement';
        const filename = `${code.replace(/[^a-z0-9-_]/gi, '_')}-measurements.png`;
        await saveOrShareFile(blob, filename, 'image/png');
      }, 'image/png');
    }catch(e){ console.error('save labeled photo failed', e); }
  });

  document.getElementById('measureApplyBtn').addEventListener('click', () => {
    try{
      const canvas = document.getElementById('measureCanvas');
      const annotatedPhoto = canvas.toDataURL('image/jpeg', 0.85);
      const type = document.getElementById('measureGarmentType').value;
      currentMeasurements = { type, values: { ...measureValues }, photo: annotatedPhoto };
      if (currentPhotos.length < MAX_PHOTOS){
        currentPhotos.push(annotatedPhoto);
        renderPhotoPreviews();
      }
      renderMeasureChips();
      closeMeasureTool();
    }catch(e){
      console.error('apply measurements failed', e);
      alert("Couldn't save the annotated photo, but your measurements are kept for this session — try Apply again.");
    }
  });

  // ---------- STATUS PILLS ----------
  function setStatusUI(status){
    currentStatus = status;
    document.querySelectorAll('.status-pill').forEach(p => {
      p.classList.toggle('selected', p.dataset.status === status);
    });
    renderSoldFields(items.find(i=>i.id===currentEditId));
  }
  document.getElementById('statusRow').addEventListener('click', (e) => {
    const pill = e.target.closest('.status-pill');
    if (!pill) return;
    // Marking Sold specifically (not re-clicking an already-selected Sold
    // pill, and not the other statuses) needs an explicit confirmation of
    // price/fee/shipping first — see openSoldConfirmModal.
    if (pill.dataset.status === 'vendido' && currentStatus !== 'vendido'){
      openSoldConfirmModal();
    } else {
      setStatusUI(pill.dataset.status);
    }
  });

  // ---------- SOLD CONFIRMATION MODAL ----------
  // Fires the moment an item transitions to Sold (single-item modal only —
  // bulk "Set: Sold" has its own review list, see modules/sold-confirm.js).
  // UI + validation lives in the module; here we just tell it what "sold
  // this item" means for the currently-open form: flip currentStatus,
  // populate the (still-existing) sold-fields inputs the normal Save flow
  // already reads, and autosave.
  const openSoldConfirmModal = initSoldConfirmModal({
    getItem: () => items.find(i => i.id === currentEditId),
    getListedPlatforms: () => currentListedPlatforms,
    escapeHtml,
    onConfirm: ({ price, platform, fee, shippingCost, otherCosts }) => {
      setStatusUI('vendido'); // rebuilds #soldFieldsArea — set its values AFTER this
      document.getElementById('fSoldPrice').value = price.toFixed(2);
      document.getElementById('fShippingCost').value = shippingCost.toFixed(2);
      document.getElementById('fSoldPlatform').value = platform;
      document.getElementById('fFeesTotal').value = fee.toFixed(2);
      document.getElementById('fOtherCosts').value = otherCosts.toFixed(2);
      // Autosave right away — she just explicitly confirmed every number
      // that feeds this sale, no reason to make her also remember to hit
      // the main Save button afterward. Reuses the real save button's
      // full pipeline (validation, photo upload, etc.) instead of
      // duplicating it.
      document.getElementById('saveItemBtn').click();
    },
  });

  // ---------- PREP PILLS ----------
  function setPrepUI(prep){
    currentPrep = prep;
    document.querySelectorAll('#prepRow .prep-pill').forEach(p => {
      p.classList.toggle('selected', p.dataset.prep === prep);
    });
  }
  document.getElementById('prepRow').addEventListener('click', (e) => {
    const pill = e.target.closest('.prep-pill');
    if (pill) setPrepUI(pill.dataset.prep);
  });

  // ---------- LISTED-ON PLATFORM PILLS (multi-select) ----------
  let currentListedPlatforms = [];
  function setListedPlatformsUI(list){
    currentListedPlatforms = list;
    // Rebuilt from getAllPlatforms() each time (not static HTML) so any
    // custom platforms added in Settings show up here too.
    const row = document.getElementById('listedPlatformsRow');
    row.innerHTML = getAllPlatforms().map(p => `<div class="prep-pill ${list.includes(p.key)?'selected':''}" data-plat="${p.key}">${escapeHtml(PLATFORM_NAME[p.key] || p.label)}</div>`).join('');
  }
  document.getElementById('listedPlatformsRow').addEventListener('click', (e) => {
    const pill = e.target.closest('.prep-pill');
    if (!pill) return;
    const plat = pill.dataset.plat;
    const next = currentListedPlatforms.includes(plat)
      ? currentListedPlatforms.filter(p => p !== plat)
      : [...currentListedPlatforms, plat];
    setListedPlatformsUI(next);
  });

  function renderSoldFields(item){
    const area = document.getElementById('soldFieldsArea');
    if (currentStatus !== 'vendido'){ area.innerHTML = ''; return; }
    const soldPriceVal = item?.soldPrice || document.getElementById('fListPrice').value || '';
    const shippingCostVal = item?.shippingCost || '';
    // Which platform it actually sold on — separate from the generic
    // "Platform" field above (used for fee estimates before a sale), since
    // a cross-listed item could sell anywhere it was listed. Also feeds the
    // real fee calc below instead of guessing from the generic field.
    const soldPlatformVal = item?.soldPlatform || item?.platform || '';
    // Fee starts from the auto calc but is a real editable field from here
    // on — the confirmation modal writes into this same input, and a
    // reopened already-sold item shows whatever was actually saved/edited
    // rather than recomputing and silently overwriting it.
    const feesTotalVal = item?.feesTotal !== undefined ? item.feesTotal : (soldPlatformVal && soldPriceVal ? platformFee(soldPlatformVal, parseFloat(soldPriceVal)) : 0);
    const otherCostsVal = item?.otherCosts || '';
    area.innerHTML = `
      <div class="field-row">
        <div class="field">
          <label>Final sale price ($)</label>
          <input type="number" class="mono" id="fSoldPrice" step="0.01" value="${soldPriceVal !== '' ? parseFloat(soldPriceVal).toFixed(2) : ''}">
        </div>
        <div class="field">
          <label>Shipping paid ($)</label>
          <input type="number" class="mono" id="fShippingCost" step="0.01" value="${shippingCostVal !== '' ? parseFloat(shippingCostVal).toFixed(2) : ''}">
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Platform fee ($)</label>
          <input type="number" class="mono" id="fFeesTotal" step="0.01" value="${parseFloat(feesTotalVal||0).toFixed(2)}">
        </div>
        <div class="field">
          <label>Other costs ($)</label>
          <input type="number" class="mono" id="fOtherCosts" step="0.01" value="${otherCostsVal !== '' ? parseFloat(otherCostsVal).toFixed(2) : ''}" placeholder="0.00">
        </div>
      </div>
      <div class="field">
        <label>Sold on</label>
        <select id="fSoldPlatform">
          <option value="">—</option>
          ${getAllPlatforms().map(p => `<option value="${p.key}" ${soldPlatformVal===p.key?'selected':''}>${escapeHtml(PLATFORM_NAME[p.key] || p.label)}</option>`).join('')}
        </select>
      </div>
    `;
    attachCurrencyFormatting(['fSoldPrice','fShippingCost','fFeesTotal','fOtherCosts']);
  }

  // ---------- PHOTOS ----------
  document.getElementById('photoZone').addEventListener('click', (e) => {
    if (e.target.tagName !== 'INPUT') document.getElementById('photoInput').click();
  });

  document.getElementById('photoInput').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    const remaining = MAX_PHOTOS - currentPhotos.length;
    if (remaining <= 0){
      alert(`You've reached the ${MAX_PHOTOS}-photo limit for this item. Remove one to add another.`);
      e.target.value = '';
      return;
    }
    const toProcess = files.slice(0, remaining);
    if (files.length > remaining){
      alert(`Only added ${remaining} photo(s) — that brings this item to the ${MAX_PHOTOS}-photo limit.`);
    }
    for (const file of toProcess){
      try{
        const compressed = await compressImage(file);
        currentPhotos.push(compressed);
        renderPhotoPreviews();
      }catch(err){
        console.error('Photo processing error', err);
      }
    }
    e.target.value = '';
  });

  function renderPhotoPreviews(){
    const grid = document.getElementById('photoPreviewGrid');
    const hasPhotos = currentPhotos.length > 0;
    grid.innerHTML = currentPhotos.map((src, idx) => `
      <div class="photo-preview" data-idx="${idx}">
        <img src="${src}" data-act="zoom" data-idx="${idx}">
        ${idx === 0
          ? `<span class="cover-badge">★ Cover</span>`
          : `<button class="cover-btn" data-idx="${idx}" data-act="cover" title="Make cover photo">☆</button>`}
        <button class="rm-btn" data-idx="${idx}" data-act="rm">✕</button>
        ${idx > 0 ? `<button class="move-btn move-left" data-idx="${idx}" data-act="moveleft">‹</button>` : ''}
        ${idx < currentPhotos.length - 1 ? `<button class="move-btn move-right" data-idx="${idx}" data-act="moveright">›</button>` : ''}
        <button class="dl-btn" data-idx="${idx}" data-act="dl">⬇ Save</button>
      </div>
    `).join('');
    const hint = document.getElementById('photoCountHint');
    hint.textContent = `${currentPhotos.length} / ${MAX_PHOTOS} photos · ★ sets cover photo · ‹ › reorders · tap photo to view full size`;
    const galleryHint = document.getElementById('photoGalleryHint');
    const saveAllBtn = document.getElementById('saveAllPhotosBtn');
    galleryHint.classList.toggle('visible', hasPhotos);
    saveAllBtn.classList.toggle('visible', currentPhotos.length > 1);
  }

  document.getElementById('photoPreviewGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (btn){
      const idx = parseInt(btn.dataset.idx);
      if (btn.dataset.act === 'rm'){
        currentPhotos.splice(idx, 1);
        renderPhotoPreviews();
        return;
      }
      if (btn.dataset.act === 'dl'){
        downloadPhoto(idx);
        return;
      }
      if (btn.dataset.act === 'cover'){
        // Moves this photo to the front — the first photo is always the
        // cover shot on every marketplace (eBay, Poshmark, Mercari…).
        const [moved] = currentPhotos.splice(idx, 1);
        currentPhotos.unshift(moved);
        renderPhotoPreviews();
        return;
      }
      if (btn.dataset.act === 'moveleft'){
        if (idx > 0){
          [currentPhotos[idx - 1], currentPhotos[idx]] = [currentPhotos[idx], currentPhotos[idx - 1]];
          renderPhotoPreviews();
        }
        return;
      }
      if (btn.dataset.act === 'moveright'){
        if (idx < currentPhotos.length - 1){
          [currentPhotos[idx + 1], currentPhotos[idx]] = [currentPhotos[idx], currentPhotos[idx + 1]];
          renderPhotoPreviews();
        }
        return;
      }
    }
    // Tap on image or preview card = open lightbox
    const preview = e.target.closest('.photo-preview');
    if (preview && e.target.tagName === 'IMG'){
      openLightbox(currentPhotos, parseInt(preview.dataset.idx));
    }
  });

  // ---------- LIGHTBOX ----------
  // src/ui/lightbox.js; its listeners are wired here, where they used to be.
  initLightbox();
  function downloadPhoto(idx){
    const nameField = document.getElementById('fName').value || 'item';
    downloadUrl(currentPhotos[idx], nameField.replace(/[^a-z0-9]+/gi,'_').toLowerCase() + '_photo_' + (idx+1) + '.jpg');
  }

  document.getElementById('saveAllPhotosBtn').addEventListener('click', async () => {
    const btn = document.getElementById('saveAllPhotosBtn');
    btn.textContent = '⬇ Saving…';
    btn.disabled = true;
    for (let i = 0; i < currentPhotos.length; i++){
      downloadPhoto(i);
      await new Promise(r => setTimeout(r, 400)); // small delay between downloads
    }
    btn.textContent = `✓ ${currentPhotos.length} photos saved`;
    setTimeout(() => {
      btn.textContent = '⬇ Save all photos to camera roll';
      btn.disabled = false;
    }, 2500);
  });

  // ---------- AI PHOTO ANALYSIS ----------
  const CATEGORY_OPTIONS = Object.keys(BASE_CATEGORY_VALUE);
  const CONDITION_OPTIONS = Object.keys(CONDITION_LABEL);

  function dataUrlToBase64(dataUrl){
    const parts = dataUrl.split(',');
    const match = parts[0] && parts[0].match(/data:(.*);base64/);
    const mediaType = match ? match[1] : 'image/jpeg';
    return { mediaType, base64: parts[1] || '' };
  }

  // Photos in currentPhotos are local base64 data URLs before an item is
  // first saved, but become hosted Firebase Storage https:// URLs after
  // saving (uploaded there to keep Firestore documents small). Sending a
  // hosted URL through dataUrlToBase64 silently produces an empty base64
  // string, which the Anthropic API rejects — this builds the right kind of
  // image block for whichever form the photo is currently in.
  // Walks a JSON-like string and escapes raw newline/carriage-return/tab
  // characters that appear INSIDE a quoted string value, while leaving
  // everything outside of strings (structural whitespace, braces, commas)
  // untouched. Real control characters inside a JSON string are invalid per
  // spec and make JSON.parse throw — this fixes that without altering
  // anything else about the response.
  function escapeRawControlCharsInJsonStrings(text){
    let out = '';
    let inString = false;
    let escapedNext = false;
    for (let i = 0; i < text.length; i++){
      const ch = text[i];
      if (inString){
        if (escapedNext){
          out += ch;
          escapedNext = false;
          continue;
        }
        if (ch === '\\'){
          out += ch;
          escapedNext = true;
          continue;
        }
        if (ch === '"'){
          inString = false;
          out += ch;
          continue;
        }
        if (ch === '\n'){ out += '\\n'; continue; }
        if (ch === '\r'){ continue; } // drop stray carriage returns
        if (ch === '\t'){ out += '\\t'; continue; }
        out += ch;
      } else {
        if (ch === '"'){ inString = true; }
        out += ch;
      }
    }
    return out;
  }

  function photoToImageBlock(src){
    if (!src) return null;
    if (src.startsWith('data:')){
      const { mediaType, base64 } = dataUrlToBase64(src);
      return base64 ? { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } } : null;
    }
    if (/^https?:\/\//i.test(src)){
      return { type: "image", source: { type: "url", url: src } };
    }
    return null;
  }

  // A freshly-added photo (not yet uploaded to Storage) is still a local
  // data: URL at the size compressImage() leaves it (up to 1600px, quality
  // 0.85) — fine for one photo, but 5 of those base64-encoded together can
  // exceed Vercel's ~4.5MB request body limit and come back as a flat
  // HTTP 413 before the AI ever sees them. Already-hosted https:// photos
  // (a saved item) aren't affected — those are sent as a URL reference, not
  // embedded — so this only re-encodes local data: URLs, smaller and at a
  // lower quality, purely for this request; the stored photo is untouched.
  const AI_PAYLOAD_MAX_DIM = 1000;
  const AI_PAYLOAD_QUALITY = 0.7;
  function shrinkDataUrlForAiPayload(dataUrl){
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > AI_PAYLOAD_MAX_DIM){
          height = Math.round(height * (AI_PAYLOAD_MAX_DIM / width));
          width = AI_PAYLOAD_MAX_DIM;
        } else if (height > AI_PAYLOAD_MAX_DIM){
          width = Math.round(width * (AI_PAYLOAD_MAX_DIM / height));
          height = AI_PAYLOAD_MAX_DIM;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', AI_PAYLOAD_QUALITY));
      };
      img.onerror = () => resolve(dataUrl); // fall back to the original rather than dropping the photo
      img.src = dataUrl;
    });
  }
  async function buildAiImageBlocks(photos, maxCount){
    const selected = (photos || []).slice(0, maxCount);
    const forPayload = await Promise.all(selected.map(src =>
      (src && src.startsWith('data:')) ? shrinkDataUrlForAiPayload(src) : src
    ));
    return forPayload.map(photoToImageBlock).filter(Boolean);
  }

  // ---------- ✨ ANALYZE & WRITE LISTING (single AI call, v3.13.115) ----------
  // One request reads up to 5 photos and returns every field it can fill
  // (brand, color, type, gender, size, size type, category, eBay category
  // search term, eBay item specifics, price range) plus the listing title/
  // description/style tags and the "visual facts" it saw (fabric tag,
  // construction details). Replaces the old separate "🔮 Analyze with AI"
  // and AI listing-writer calls, which both paid for the same photos.
  // Prompt + schema live in modules/ai-item.js; server is api/analyze-photo.js.

  // Shared caller for /api/analyze-photo. Returns {ok, result, usage} or
  // {ok:false, message} with the server's real error text when it fails.
  // `input` is the raw item data; the server builds the prompt and schema
  // from it (buildItemAiRequest() in modules/ai-item.js, v3.15.3).
  async function callAiItemEndpoint({ mode, imageBlocks, input }){
    const idToken = await window.auth.currentUser.getIdToken();
    const response = await fetch('/api/analyze-photo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
      body: JSON.stringify({ mode, imageBlocks, input })
    });
    if (!response.ok){
      let detail = '';
      try{
        const errJson = await response.json();
        detail = errJson?.detail?.error?.message || errJson?.error?.message || errJson?.error || '';
      }catch(parseErr){ /* body wasn't JSON — leave detail blank */ }
      return { ok:false, message: `Couldn't reach the AI (server said: HTTP ${response.status}${detail ? ' — ' + escapeHtml(String(detail)) : ''}). Try again in a moment — if it keeps happening, tell Vitor this exact message.` };
    }
    const data = await response.json();
    if (data.stop_reason === 'refusal'){
      return { ok:false, message: `The AI declined to analyze this item. Please try again — if it keeps happening, tell Vitor.` };
    }
    if (data.stop_reason === 'max_tokens'){
      return { ok:false, message: `The AI's answer was cut off before it finished. Please try again.` };
    }
    const textBlock = data.content && data.content.find(b => b.type === 'text');
    const result = parseAiJsonText(textBlock && textBlock.text);
    if (!result){
      return { ok:false, message: `Couldn't make sense of the AI's response. Please try again.` };
    }
    return { ok:true, result, usage: data.usage || null };
  }

  // Structured outputs already guarantee valid JSON — this tolerant parse is
  // for the fallback path (server retries without a schema if the model
  // rejects it), where the model can wrap the JSON in fences or write raw
  // newlines inside the multi-line description string.
  function parseAiJsonText(text){
    if (!text) return null;
    let cleaned = text.replace(/```json|```/gi, '').trim();
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace <= firstBrace) return null;
    cleaned = escapeRawControlCharsInJsonStrings(cleaned.slice(firstBrace, lastBrace + 1));
    try{ return JSON.parse(cleaned); }catch(parseErr){ return null; }
  }

  // Cuts at the last line break (else last space) before the limit instead
  // of mid-word, for the rare answer that overshoots the hard limit.
  function trimToLimit(text, limit){
    const s = String(text || '');
    if (s.length <= limit) return s;
    const cut = s.slice(0, limit);
    const at = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf(' '));
    return (at > limit * 0.6 ? cut.slice(0, at) : cut).trimEnd();
  }

  // The closet/bundle blurb only makes sense for clothing — she can
  // uncheck "Include my standard closing line" for anything else (e.g. a
  // pencil got "check my closet!" tacked on before this existed).
  function priceHistoryByCategory(){
    const history = {};
    CATEGORY_OPTIONS.forEach(c => {
      const h = getCategoryPriceHistory(c);
      if (h) history[c] = h;
    });
    return history;
  }

  // Analyses saved before v3.13.115 used likely_* keys and had no listing
  // copy — map them to the current shape so reopening an old item still
  // shows its card.
  function normalizeAiAnalysis(r){
    if (!r) return null;
    if (!('likely_brand' in r)) return r;
    return {
      brand: r.likely_brand || '', color: r.likely_color || '', clothing_type: r.likely_clothing_type || '',
      gender: r.likely_gender || '', size: r.likely_size || '', size_type: r.likely_size_type || '',
      category: r.category || '', ebay_search_term: r.ebay_search_term || '', visible_flaws: r.visible_flaws || '',
      price_low: r.price_low, price_high: r.price_high, reasoning: r.reasoning || '',
      identification: r.identification || '', title: '', description: '', style_tags: [],
      material: '', construction_details: [], ebay_aspects: [], appliedAt: r.appliedAt,
    };
  }

  async function analyzeAndWriteListing(){
    const btn = document.getElementById('analyzePhotoBtn');
    const area = document.getElementById('aiAnalysisArea');

    if (currentPhotos.length === 0){
      area.innerHTML = `<div class="ai-error">Add at least one photo first — the AI needs something to look at.</div>`;
      return;
    }
    if (aiUsageRemaining() <= 0){
      area.innerHTML = `<div class="ai-error">❌ You've reached your monthly AI analysis limit (${appSettings.aiUsageLimit || 500} analyses). Go to ⚙ Settings to reset the counter.</div>`;
      return;
    }

    btn.disabled = true;
    btn.textContent = '✨ Analyzing & writing…';
    area.innerHTML = `<div class="ai-loading">Reading the photos and writing the listing — this takes 15-30 seconds…</div>`;

    try{
      // 5 photos: front, back and the tag/label close-up are what matter
      // most — the tag photo needs to be among the first 5.
      const imageBlocks = await buildAiImageBlocks(currentPhotos, 5);
      if (imageBlocks.length === 0){
        area.innerHTML = `<div class="ai-error">Couldn't read the photo(s) for analysis. Please try again.</div>`;
        return;
      }

      // Redo: a field still holding the value the previous ✨ run filled in
      // counts as "not entered" again, so the new run reads the photos fresh
      // instead of echoing its own last answer back as ground truth —
      // anything she changed since stays as her own value.
      const f = gatherListingFormFields();
      const prev = (currentAiAnalysis && currentAiAnalysis.applied) ? currentAiAnalysis : null;
      if (prev){
        AI_FILLED_FORM_FIELDS.forEach(k => {
          if (sameText(f[k], prev.applied[k])) f[k] = (prev.sellerInput && prev.sellerInput[k]) || '';
        });
      }
      const sellerInput = Object.fromEntries(AI_FILLED_FORM_FIELDS.map(k => [k, f[k] || '']));
      // Same idea for the price: only replaced if empty or still the AI's.
      const currentPrice = document.getElementById('fListPrice').value.trim();
      const priceIsAiOrEmpty = !parseFloat(currentPrice) || (prev && sameText(currentPrice, prev.applied.price));
      const res = await callAiItemEndpoint({
        mode: 'full',
        imageBlocks,
        input: {
          fields: f,
          useStandardClosing: f.useStandardClosing,
          standardClosingText: appSettings.listingStandardText || '',
          priceHistory: priceHistoryByCategory(),
        },
      });
      if (!res.ok){
        area.innerHTML = `<div class="ai-error">${res.message}</div>`;
        return;
      }

      const r = res.result;
      const text = (v) => String(v || '').trim();
      currentAiAnalysis = {
        brand: text(r.brand), color: text(r.color), clothing_type: text(r.clothing_type),
        gender: text(r.gender), size: text(r.size), size_type: text(r.size_type),
        category: text(r.category), ebay_search_term: text(r.ebay_search_term),
        visible_flaws: text(r.visible_flaws), material: text(r.material),
        construction_details: Array.isArray(r.construction_details) ? r.construction_details.map(text).filter(Boolean).slice(0, 8) : [],
        ebay_aspects: Array.isArray(r.ebay_aspects)
          ? r.ebay_aspects.filter(a => a && text(a.name) && text(a.value)).map(a => ({ name: text(a.name), value: text(a.value) }))
          : [],
        price_low: parseFloat(r.price_low) || 0, price_high: parseFloat(r.price_high) || 0,
        reasoning: text(r.reasoning),
        title: text(r.title).slice(0, 80),
        description: trimToLimit(r.description, LISTING_DESC_LIMIT),
        style_tags: normalizeStyleTags(r.style_tags),
        usage: res.usage,
        analyzedAt: Date.now(),
        sellerInput,
      };
      await incrementAiUsage();
      // v3.13.117: no review step — apply everything and save right away;
      // the summary shown afterwards has "🔄 Redo analysis" if it's off.
      btn.textContent = '✨ Applying & saving…';
      const r2 = currentAiAnalysis;
      const low = Math.max(0, r2.price_low), high = Math.max(low, r2.price_high);
      await applyAiAnalysisToForm(r2, {
        values: {
          name: r2.title, brand: r2.brand, color: r2.color, clothingType: r2.clothing_type,
          gender: r2.gender, size: r2.size, sizeType: r2.size_type,
          price: Math.round(((low + high) / 2) * 100) / 100,
        },
        overwritePrice: priceIsAiOrEmpty,
      });
      const remaining = aiUsageRemaining();
      if (remaining <= 50 && remaining > 0){
        area.innerHTML += `<div style="font-size:11px; color:var(--amber-deep); background:rgba(217,160,91,0.15); padding:7px 10px; border-radius:8px; margin-top:6px;">⚠ ${remaining} AI analyses remaining this month. Reset in ⚙ Settings.</div>`;
      } else if (remaining === 0){
        area.innerHTML += `<div style="font-size:11px; color:var(--danger); background:rgba(181,86,74,0.1); padding:7px 10px; border-radius:8px; margin-top:6px;">❌ Monthly AI limit reached. Go to ⚙ Settings to reset.</div>`;
      }
    }catch(err){
      area.innerHTML = `<div class="ai-error">Couldn't complete the analysis right now. Please try again in a moment.</div>`;
    }finally{
      btn.disabled = false;
      btn.textContent = '✨ Analyze & write listing';
    }
  }

  // Already applied → a one-line summary (the fields/listing are on the form
  // now); otherwise the full review card.
  function renderAiAnalysis(raw){
    const result = normalizeAiAnalysis(raw);
    const area = document.getElementById('aiAnalysisArea');
    if (result.appliedAt){
      renderAiAppliedSummary(result);
      return;
    }
    renderAiAnalysisCard(result);
  }

  // What ✨ filled in and saved (v3.13.117 — it applies without a review
  // step), with "🔄 Redo analysis" to run it again if something's off.
  function renderAiAppliedSummary(result){
    const area = document.getElementById('aiAnalysisArea');
    const low = Math.max(0, parseFloat(result.price_low) || 0);
    const high = Math.max(low, parseFloat(result.price_high) || low);
    const filled = [['Brand', result.brand], ['Color', result.color], ['Type', result.clothing_type],
      ['Gender', result.gender], ['Size', result.size], ['Size type', result.size_type], ['Category', result.category]]
      .filter(([, v]) => v).map(([k, v]) => `${k}: <b>${escapeHtml(v)}</b>`).join(' · ');
    const appliedPrice = result.applied && result.applied.price;
    const priceLine = result.priceKept
      ? `Price kept at <b>$${escapeHtml(String(appliedPrice || ''))}</b> (AI range $${low.toFixed(2)} – $${high.toFixed(2)})`
      : `Price set to <b>$${escapeHtml(String(appliedPrice || ((low + high) / 2).toFixed(2)))}</b> (AI range $${low.toFixed(2)} – $${high.toFixed(2)})`;
    area.innerHTML = `
      <div style="font-size:12px; color:var(--plum); background:rgba(127,150,120,0.12); padding:10px 12px; border-radius:10px; margin-bottom:14px;">
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <span style="flex:1; color:var(--sage-deep); font-weight:600;">✓ AI analysis applied & saved · ${escapeHtml(new Date(result.appliedAt).toLocaleDateString())}</span>
          <button class="copy-btn" id="aiRedoBtn">🔄 Redo analysis</button>
        </div>
        ${filled ? `<div style="margin-top:6px;">${filled}</div>` : ''}
        <div style="margin-top:4px;">${priceLine}</div>
        <details style="margin-top:6px;">
          <summary style="cursor:pointer; color:var(--plum-soft);">Details</summary>
          ${result.visible_flaws ? `<div style="margin-top:4px;"><b>Wear noted:</b> ${escapeHtml(result.visible_flaws)}</div>` : ''}
          ${result.reasoning ? `<div style="margin-top:4px;"><b>Price reasoning:</b> ${escapeHtml(result.reasoning)}</div>` : ''}
          ${result.material ? `<div style="margin-top:4px;"><b>Tag reads:</b> ${escapeHtml(result.material)}</div>` : ''}
          ${(result.ebay_aspects || []).length ? `<div style="margin-top:4px;"><b>eBay item specifics seen:</b> ${result.ebay_aspects.map(a => `${escapeHtml(a.name)}: ${escapeHtml(a.value)}`).join(' · ')} <span style="opacity:0.8;">(filled only where the eBay category uses them)</span></div>` : ''}
          <div style="margin-top:4px; opacity:0.8;">Fix anything directly in the form — or redo the analysis. Fields you changed since are kept as yours.</div>
        </details>
      </div>`;
    document.getElementById('aiRedoBtn').addEventListener('click', analyzeAndWriteListing);
  }

  function renderAiAnalysisCard(result){
    const area = document.getElementById('aiAnalysisArea');
    const low = Math.max(0, parseFloat(result.price_low) || 0);
    const high = Math.max(low, parseFloat(result.price_high) || low);
    const mid = Math.round(((low+high)/2) * 100) / 100;
    const labelStyle = 'font-size:10px; text-transform:uppercase; letter-spacing:0.04em; color:var(--plum-soft); font-weight:700; margin-bottom:4px;';
    const inputStyle = 'width:100%; padding:8px 11px; border:1px solid var(--line); border-radius:8px; font-size:13px; color:var(--plum); background:var(--white);';
    const field = (label, inner) => `<div style="flex:1; min-width:120px;"><div style="${labelStyle}">${label}</div>${inner}</div>`;
    const select = (id, values, current) => `<select id="${id}" style="${inputStyle}">${values.map(v =>
      `<option value="${escapeHtml(v)}" ${v === (current || '') ? 'selected' : ''}>${v ? escapeHtml(v) : '—'}</option>`).join('')}</select>`;
    const nameValue = result.title || result.identification || '';
    const tags = result.style_tags || [];

    area.innerHTML = `
      <div class="ai-analysis-box">
        <div class="ai-tag">AI estimate — review & apply</div>

        <div style="margin-top:6px; margin-bottom:12px;">
          <div style="${labelStyle}">${result.title ? 'Title / item name' : 'Item name'} (edit if needed)</div>
          <input type="text" id="aiNameEdit" value="${escapeHtml(nameValue)}"
            style="width:100%; padding:9px 11px; border:1.5px solid var(--blush); border-radius:10px; font-size:14px; font-family:var(--font-ui); font-weight:600; color:var(--plum); background:var(--white);">
        </div>

        <div style="display:flex; gap:10px; margin-bottom:12px; flex-wrap:wrap;">
          ${field('Brand', `<input type="text" id="aiBrandEdit" value="${escapeHtml(result.brand || '')}" style="${inputStyle}">`)}
          ${field('Color', `<input type="text" id="aiColorEdit" value="${escapeHtml(result.color || '')}" list="colorList" style="${inputStyle}">`)}
          ${field('Suggested price', `<input type="number" id="aiPriceEdit" value="${mid.toFixed(2)}" step="0.01" style="${inputStyle} font-family:var(--font-ui); color:var(--terracotta-deep);">`)}
          ${field('Clothing type', `<input type="text" id="aiClothingTypeEdit" value="${escapeHtml(result.clothing_type || '')}" list="clothingTypeList" style="${inputStyle}">`)}
          ${field('Gender', select('aiGenderEdit', AI_GENDER_VALUES, result.gender))}
          ${field('Size', `<input type="text" id="aiSizeEdit" value="${escapeHtml(result.size || '')}" style="${inputStyle}">`)}
          ${field('Size type', select('aiSizeTypeEdit', AI_SIZE_TYPE_VALUES, result.size_type))}
        </div>

        <div style="font-size:12px; color:var(--plum-soft); margin-bottom:4px;">
          <b>Price range:</b> $${low.toFixed(2)} – $${high.toFixed(2)}
          ${result.visible_flaws ? ` · <b>Wear noted:</b> ${escapeHtml(result.visible_flaws)}` : ''}
        </div>
        <div class="ai-reasoning">${escapeHtml(result.reasoning || '')}</div>
        ${result.material ? `<div style="font-size:12px; color:var(--plum-soft); margin-top:6px;"><b>Tag reads:</b> ${escapeHtml(result.material)}</div>` : ''}
        ${(result.ebay_aspects || []).length ? `
          <div style="font-size:12px; color:var(--plum-soft); margin-top:6px;">
            <b>eBay item specifics seen:</b> ${result.ebay_aspects.map(a => `${escapeHtml(a.name)}: ${escapeHtml(a.value)}`).join(' · ')}
            <div style="font-size:11px; opacity:0.8;">Filled in only where the chosen eBay category uses them, and never over a value you already set.</div>
          </div>` : ''}
        ${result.description ? `
          <details style="margin-top:10px;">
            <summary style="font-size:12px; font-weight:600; color:var(--plum); cursor:pointer;">Listing description & style tags (preview)</summary>
            <div style="white-space:pre-wrap; font-size:12px; color:var(--plum); background:var(--white); border:1px solid var(--line); border-radius:8px; padding:9px 11px; margin-top:6px;">${escapeHtml(result.description)}</div>
            ${tags.length ? `<div style="font-size:12px; color:var(--plum-soft); margin-top:6px;"><b>Style tags:</b> ${tags.map(escapeHtml).join(', ')}</div>` : ''}
          </details>` : ''}
        <div class="ai-disclaimer">AI estimate based on visual cues only — not a live market lookup. "Apply" fills the form${result.description ? ' and the listing text' : ''}, then saves the item.</div>
        <div class="ai-actions">
          <button id="aiApplyBtn" class="apply-btn">✓ Apply to form</button>
          <button id="aiDismissBtn">Dismiss</button>
        </div>
      </div>
    `;

    document.getElementById('aiApplyBtn').addEventListener('click', () => {
      const val = (id) => (document.getElementById(id)?.value || '').trim();
      applyAiAnalysisToForm(result, {
        values: {
          name: val('aiNameEdit'), brand: val('aiBrandEdit'), color: val('aiColorEdit'),
          clothingType: val('aiClothingTypeEdit'), gender: val('aiGenderEdit'),
          size: val('aiSizeEdit'), sizeType: val('aiSizeTypeEdit'),
          price: parseFloat(document.getElementById('aiPriceEdit').value) || mid,
        },
        overwritePrice: true,
      });
    });
    document.getElementById('aiDismissBtn').addEventListener('click', () => {
      currentAiAnalysis = null;
      document.getElementById('aiAnalysisArea').innerHTML = '';
    });
  }

  // Sets a select that has an "Other…" escape hatch (Color, Category,
  // Clothing type): a known option is selected directly, anything else goes
  // into the matching custom text field.
  function setSelectOrOther(selectId, otherId, value){
    const sel = document.getElementById(selectId);
    const other = document.getElementById(otherId);
    if (Array.from(sel.options).some(o => o.value === value)){
      sel.value = value;
      other.style.display = 'none';
      other.value = '';
    } else {
      sel.value = '__other__';
      other.value = value;
      other.style.display = 'block';
    }
  }

  // Fields ✨ fills on the form — also what a redo compares against to
  // tell "still the AI's value" from "she changed it".
  const AI_FILLED_FORM_FIELDS = ['brand', 'color', 'clothingType', 'gender', 'size'];
  const sameText = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

  // `values`: what to put on the form (the AI's own answer when ✨ applies
  // automatically, or her edits on a pre-v3.13.117 review card).
  // `overwritePrice`: false keeps a price she already set.
  async function applyAiAnalysisToForm(result, { values, overwritePrice }){
    // Status shows on the card's Apply button (old saved cards) or on the
    // ✨ button itself (automatic apply).
    const applyBtn = document.getElementById('aiApplyBtn') || document.getElementById('analyzePhotoBtn');
    const edited = values;
    applyBtn.disabled = true;
    applyBtn.textContent = 'Applying…';

    if (edited.name) document.getElementById('fName').value = edited.name;
    if (edited.brand) document.getElementById('fBrand').value = edited.brand;
    if (edited.color) setSelectOrOther('fColor', 'fColorOther', edited.color);
    if (result.category && result.category.trim()) setSelectOrOther('fCategory', 'fCategoryOther', result.category.trim());
    if (edited.clothingType) setSelectOrOther('fClothingType', 'fClothingTypeOther', edited.clothingType);
    if (edited.gender) document.getElementById('fGender').value = edited.gender;
    if (edited.size){
      document.getElementById('fSize').value = edited.size;
      renderEbaySizeCheck();
    }
    // Analyses from before v3.13.115 have no AI title — build the same SEO
    // title "Generate listing description" uses from the fields just set.
    if (!result.title){
      const seoTitle = buildListingTitle(gatherListingFormFields());
      if (seoTitle.trim()) document.getElementById('fName').value = seoTitle;
    }
    // If the item turned out to be Clothing and shipping dims are still
    // empty, fill in the standard box size and the "Regular" Size Type.
    if (getCategoryValue() === 'Clothing'){
      applyDefaultClothingShippingIfEmpty();
      applyDefaultSizeTypeIfEmpty();
    }
    // Override the "Regular" default only if the AI (or her edit on the
    // card) says something else — Plus, Petite, Tall, etc.
    if (edited.sizeType){
      currentEbayAspects['Size Type'] = edited.sizeType;
      const sizeTypeEl = document.querySelector('[data-aspect="Size Type"]');
      if (sizeTypeEl) sizeTypeEl.value = edited.sizeType;
    }
    // Condition is intentionally NOT auto-applied from the AI — it stays at
    // whatever the form already has. Notes is left untouched too: the AI's
    // visible_flaws is shown on the card, but Notes only holds what she typed.
    if (overwritePrice && edited.price > 0) document.getElementById('fListPrice').value = edited.price.toFixed(2);

    // Listing copy written in the same call.
    let staleLabels = [];
    if (result.description){
      renderListingOutput(edited.name || result.title, result.description, [...(result.style_tags || [])], AI_LISTING_SOURCE_LABEL);
      // The description was written with the AI's own values — if she
      // changed any of them on the card, offer the cheap photo-free rewrite.
      const same = sameText;
      [['Brand', edited.brand, result.brand], ['Color', edited.color, result.color],
       ['Clothing type', edited.clothingType, result.clothing_type], ['Gender', edited.gender, result.gender],
       ['Size', edited.size, result.size]].forEach(([label, mine, ai]) => { if (!same(mine, ai)) staleLabels.push(label); });
    }
    // What the AI saw in the photos — saved on the item so "🪄 Rewrite
    // listing text" can rewrite later without re-sending any photo.
    if (result.title || result.material || (result.construction_details || []).length){
      currentAiFacts = {
        material: result.material || '',
        construction_details: [...(result.construction_details || [])],
        visible_flaws: result.visible_flaws || '',
        recordedAt: result.analyzedAt || Date.now(),
      };
    }

    // eBay item specifics: applied once the chosen category's aspect list is
    // known (see applyPendingAiEbayAspects) — only aspects that category
    // actually has, matched to eBay's official values, never over hers.
    pendingAiEbayAspects = (result.ebay_aspects || []).length ? [...result.ebay_aspects] : null;
    if (result.ebay_search_term){
      document.getElementById('fEbayCategoryQuery').value = result.ebay_search_term;
      document.getElementById('fEbayCategoryQuery').dataset.lastQuery = result.ebay_search_term;
      applyBtn.textContent = 'Finding eBay category…';
      await searchEbayCategory(result.ebay_search_term, true);
      await waitForEbayAspects();
    } else if (pendingAiEbayAspects && currentCategoryAspects.length){
      applyPendingAiEbayAspects();
      renderEbayAspectsFields(currentCategoryAspects.filter(a => a.required && !EBAY_ASPECTS_AUTO_COVERED.includes(a.name)));
    }

    // What ended up on the form — shown in the summary, and what a redo
    // compares against (see analyzeAndWriteListing).
    const after = gatherListingFormFields();
    currentAiAnalysis = {
      ...currentAiAnalysis,
      appliedAt: Date.now(),
      applied: { ...Object.fromEntries(AI_FILLED_FORM_FIELDS.map(k => [k, after[k] || ''])), price: document.getElementById('fListPrice').value.trim() },
      priceKept: !overwritePrice,
    };
    applyBtn.textContent = 'Saving…';
    // Same autosave the listing generators use: a new item gets saved for
    // the first time (no eBay-category gate), and the modal reopens on it.
    await saveItemFlow({ skipValidation: true, listingIsAi: result.description ? true : undefined });
    if (staleLabels.length) renderListingStaleNotice(staleLabels);
  }

  // Waits for the eBay aspect lookup started by the category pick, so the
  // AI's item specifics are applied before the autosave — capped so a slow
  // or failed lookup never blocks the save.
  async function waitForEbayAspects(){
    if (!ebayAspectsLoadPromise) return;
    await Promise.race([ebayAspectsLoadPromise, new Promise(r => setTimeout(r, 10000))]);
  }

  function applyPendingAiEbayAspects(){
    if (!pendingAiEbayAspects) return;
    pendingAiEbayAspects.forEach(({ name, value }) => {
      const v = String(value || '').trim();
      if (!v) return;
      const spec = currentCategoryAspects.find(a => String(a.name).toLowerCase() === String(name).toLowerCase());
      if (!spec) return; // this category doesn't have it
      if (EBAY_ASPECTS_AUTO_COVERED.includes(spec.name) || /^size type$/i.test(spec.name)) return;
      if (currentEbayAspects[spec.name]) return; // never overwrite her value
      let finalValue = v;
      if (spec.allowedValues && spec.allowedValues.length){
        const match = matchAllowedValue(spec.name, v, spec.allowedValues);
        if (match) finalValue = match;
        else if (spec.selectionOnly) return; // eBay would reject anything off its list
      }
      currentEbayAspects[spec.name] = finalValue;
    });
    pendingAiEbayAspects = null;
  }

  // Shown above the listing text when item details changed after it was
  // written (on the review card, or in the form afterwards).
  function renderListingStaleNotice(labels){
    const out = document.getElementById('listingOutputArea');
    if (!out || !document.getElementById('listDescText')) return;
    let notice = document.getElementById('listingStaleNotice');
    if (!notice){
      notice = document.createElement('div');
      notice.id = 'listingStaleNotice';
      notice.style.cssText = 'font-size:12px; color:var(--plum); background:rgba(217,160,91,0.15); padding:8px 10px; border-radius:8px; margin:8px 0; display:flex; align-items:center; gap:8px; flex-wrap:wrap;';
      out.prepend(notice);
    }
    notice.innerHTML = `<span style="flex:1;">⚠️ ${escapeHtml(labels.join(', '))} changed after this text was written — rewrite it so they match?</span>
      <button class="copy-btn" id="listingStaleRewriteBtn">🪄 Rewrite text</button>`;
    document.getElementById('listingStaleRewriteBtn').addEventListener('click', generateListingDescriptionAI);
  }

  // Editing a detail the description depends on, while AI-written text is
  // showing, offers the same rewrite.
  [['fBrand', 'Brand'], ['fSize', 'Size'], ['fColor', 'Color'], ['fColorOther', 'Color'], ['fGender', 'Gender'],
   ['fClothingType', 'Clothing type'], ['fClothingTypeOther', 'Clothing type'], ['fCondition', 'Condition']].forEach(([id, label]) => {
    document.getElementById(id)?.addEventListener('change', () => {
      if (!document.getElementById('listDescText')) return;
      const existing = document.getElementById('listingStaleNotice')?.querySelector('span')?.textContent || '';
      const labels = existing.replace(/^⚠️\s*/, '').split(' changed after')[0].split(', ').filter(Boolean);
      if (!labels.includes(label)) labels.push(label);
      renderListingStaleNotice(labels);
    });
  });

  // "🏷️ New with tags" shortcut between the photos and ✨ Analyze
  // (v3.13.116) — only a front for the Condition field further down, which
  // stays the single source of truth: checking it sets Condition to New
  // with tags (the analysis treats Condition as ground truth, so the title
  // and description come out with NWT in one call), unchecking restores the
  // previous Condition. Changing Condition directly keeps the box in sync.
  function syncNwtQuickCheckbox(){
    const box = document.getElementById('fNwtQuick');
    if (box) box.checked = document.getElementById('fCondition').value === 'novo_etiqueta';
  }
  document.getElementById('fNwtQuick').addEventListener('change', (e) => {
    const cond = document.getElementById('fCondition');
    if (e.target.checked){
      if (cond.value !== 'novo_etiqueta') conditionBeforeNwtQuick = cond.value;
      cond.value = 'novo_etiqueta';
    } else {
      cond.value = (conditionBeforeNwtQuick && conditionBeforeNwtQuick !== 'novo_etiqueta') ? conditionBeforeNwtQuick : 'excelente';
      conditionBeforeNwtQuick = null;
    }
    // Same event a manual pick fires — e.g. offers the listing-text rewrite
    // if AI text is already showing.
    cond.dispatchEvent(new Event('change'));
  });
  document.getElementById('fCondition').addEventListener('change', syncNwtQuickCheckbox);

  document.getElementById('analyzePhotoBtn').addEventListener('click', analyzeAndWriteListing);

  // ---------- VOICE NARRATION CAPTURE ----------
  // Record → transcribe (Deepgram) → extract fields (Claude) → review card,
  // see modules/narration-capture.js. Self-contained: touches the same
  // form field IDs analyzeAndWriteListing/renderAiAnalysis do, no extra wiring
  // needed here.
  initNarrationCapture();

  // ---------- PRICE + SHIPPING SUGGESTION ----------
  document.getElementById('calcSuggestionBtn').addEventListener('click', () => {
    const draft = {
      category: getCategoryValue(),
      condition: document.getElementById('fCondition').value,
      brand: document.getElementById('fBrand').value,
      cost: document.getElementById('fCost').value,
      weight: document.getElementById('fWeight').value,
      length: document.getElementById('fLen').value,
      width: document.getElementById('fWid').value,
      height: document.getElementById('fHei').value,
    };
    const price = suggestPrice(draft);
    const ship = estimateShipping(draft);
    const platform = currentListedPlatforms[0] || 'ebay';
    const fee = platformFee(platform, price);
    const cheapestShip = ship.options[0]?.price || 0;
    const sellerAbsorbsShipping = document.getElementById('fFreeShipping')?.value === 'seller';
    const shipCostForProfit = sellerAbsorbsShipping ? cheapestShip : 0;
    const netEstimate = price - fee - shipCostForProfit - (parseFloat(draft.cost)||0);
    const priceRef = getPriceReference(draft);

    document.getElementById('fListPrice').value = price.toFixed(2);

    document.getElementById('suggestionArea').innerHTML = `
      <div class="suggestion-box">
        <div class="stamp-corner">suggested</div>
        <div class="suggestion-row"><span>Suggested listing price</span></div>
        <div class="suggestion-final">$${price.toFixed(2)}</div>
        <div class="suggestion-row" style="margin-top:8px;"><span>Estimated platform fee</span><b>−$${fee.toFixed(2)}</b></div>
        <div class="suggestion-row"><span>Shipping (cheapest option)${sellerAbsorbsShipping ? '' : ' — buyer pays'}</span><b>${sellerAbsorbsShipping ? '−' : ''}$${cheapestShip.toFixed(2)}</b></div>
        <div class="suggestion-row"><span>Estimated net profit</span><b style="color:${netEstimate>=0?'var(--sage-deep)':'var(--danger)'}">$${netEstimate.toFixed(2)}</b></div>
        ${priceRef ? `<div class="price-history-note">📈 Based partly on ${priceRef.count} past sale${priceRef.count===1?'':'s'} of ${priceRef.matchType === 'brand' ? `<b>${escapeHtml(draft.brand)}</b>` : `${draft.category}`}</div>` : ''}
      </div>
      <div class="shipping-box">
        <div style="font-size:11px; font-weight:600; text-transform:uppercase; color:var(--plum-soft); margin-bottom:8px;">
          Shipping simulation (billable weight: ${ship.billable}lb)
        </div>
        ${ship.options.map(o => `
          <div class="ship-option">
            <span class="carrier">${o.carrier}</span>
            <span class="price">$${o.price.toFixed(2)}</span>
          </div>
        `).join('')}
      </div>
    `;
  });

  // ---------- LISTING GENERATOR ----------
  // The builders live in src/domain/listing-copy.js (pure). The description
  // takes the seller's standard closing line from Settings.
  function buildListingDescription(f){
    return buildListingDescriptionText(f, { standardClosingText: appSettings.listingStandardText });
  }

  // Reads whatever's currently sitting in the three Style Tag inputs (she
  // can edit them freely before copying/saving) — undefined if the listing
  // output panel isn't currently showing tag inputs at all, so callers can
  // tell "no tags shown" apart from "all three boxes are blank."
  function readCurrentStyleTagInputs(){
    if (!document.getElementById('poshTag0')) return undefined;
    return [0,1,2].map(i => document.getElementById('poshTag'+i)?.value.trim() || '').filter(Boolean);
  }

  const AI_LISTING_SOURCE_LABEL = '🪄 AI-written — review before copying';

  function renderListingOutput(title, description, styleTagGuesses, sourceLabel){
    while (styleTagGuesses.length < 3) styleTagGuesses.push('');

    document.getElementById('listingOutputArea').innerHTML = `
      <div class="listing-output">
        ${sourceLabel ? `<div style="display:inline-block; background:var(--gold); color:white; font-size:9.5px; font-weight:700; padding:4px 10px; border-radius:20px; text-transform:uppercase; letter-spacing:0.04em; margin-bottom:10px;">${escapeHtml(sourceLabel)}</div>` : ''}
        <div class="lo-label">Title <span style="font-family:var(--font-ui); font-weight:400; color:${title.length > 80 ? 'var(--danger)' : 'var(--plum-soft)'};">(${title.length}/80)</span></div>
        <div class="lo-title" id="listTitleText">${escapeHtml(title)}</div>
        <div style="display:flex; gap:8px; margin-bottom:12px;">
          <button class="copy-btn" id="copyListTitleBtn">Copy title</button>
          ${sourceLabel ? `<button class="copy-btn" id="applyListTitleBtn">Apply title</button>` : ''}
        </div>

        <div class="lo-label">Description <span style="font-family:var(--font-ui); font-weight:400; color:${description.length > LISTING_DESC_LIMIT ? 'var(--danger)' : 'var(--plum-soft)'};">(${description.length}/${LISTING_DESC_LIMIT})</span></div>
        <div style="font-size:11px; color:var(--plum-soft); margin-bottom:4px;">This exact text is also what gets sent as the eBay listing description — edit freely before saving the item.</div>
        <textarea id="listDescText">${escapeHtml(description)}</textarea>
        <button class="copy-btn" id="copyListDescBtn" style="margin-bottom:12px;">Copy description</button>

        <div class="lo-label">Style Tags <span style="font-weight:400; color:var(--plum-soft);">(up to 3 — edit freely, then copy)</span></div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:8px;">
          ${styleTagGuesses.map((t,i) => `<input type="text" class="posh-tag-input" id="poshTag${i}" value="${escapeHtml(t)}" placeholder="tag ${i+1}" style="flex:1; min-width:100px; padding:8px 10px; border:1px solid var(--line); border-radius:8px; font-size:13px;">`).join('')}
        </div>
        <button class="copy-btn" id="copyPoshTagsBtn">Copy tags</button>
      </div>
    `;

    document.getElementById('copyListTitleBtn').addEventListener('click', () => {
      navigator.clipboard.writeText(document.getElementById('listTitleText').textContent).then(() => {
        const btn = document.getElementById('copyListTitleBtn');
        btn.textContent = 'Copied ✓';
        setTimeout(() => { btn.textContent = 'Copy title'; }, 1800);
      });
    });
    document.getElementById('applyListTitleBtn')?.addEventListener('click', () => {
      document.getElementById('fName').value = document.getElementById('listTitleText').textContent;
      const btn = document.getElementById('applyListTitleBtn');
      btn.textContent = 'Applied ✓';
      setTimeout(() => { btn.textContent = 'Apply title'; }, 1800);
    });
    document.getElementById('copyListDescBtn').addEventListener('click', () => {
      navigator.clipboard.writeText(document.getElementById('listDescText').value).then(() => {
        const btn = document.getElementById('copyListDescBtn');
        btn.textContent = 'Copied ✓';
        setTimeout(() => { btn.textContent = 'Copy description'; }, 1800);
      });
    });
    document.getElementById('copyPoshTagsBtn').addEventListener('click', () => {
      const tags = [0,1,2].map(i => document.getElementById('poshTag'+i).value.trim()).filter(Boolean).join(', ');
      navigator.clipboard.writeText(tags).then(() => {
        const btn = document.getElementById('copyPoshTagsBtn');
        btn.textContent = 'Copied ✓';
        setTimeout(() => { btn.textContent = 'Copy tags'; }, 1800);
      });
    });
  }

  // Field-gathering is shared across every listing generator (Poshmark,
  // Mercari, generic) — not Poshmark-specific despite the historical name.
  function gatherListingFormFields(){
    const name = document.getElementById('fName').value.trim() || 'Item';
    const category = getCategoryValue();
    const clothingTypeSelectVal = document.getElementById('fClothingType').value;
    const clothingType = clothingTypeSelectVal === '__other__'
      ? document.getElementById('fClothingTypeOther').value.trim()
      : clothingTypeSelectVal;
    const brand = document.getElementById('fBrand').value.trim();
    const gender = document.getElementById('fGender').value;
    const size = document.getElementById('fSize').value.trim();
    const condition = document.getElementById('fCondition').value;
    const notes = document.getElementById('fNotes').value.trim();
    const colorSelectVal = document.getElementById('fColor').value;
    const color = colorSelectVal === '__other__' ? document.getElementById('fColorOther').value.trim() : colorSelectVal;
    const measurements = (currentMeasurements?.values && Object.keys(currentMeasurements.values).length > 0)
      ? Object.entries(currentMeasurements.values).map(([k,v]) => `${k}: ${v.toFixed(1)}"`).join(', ')
      : '';
    const price = document.getElementById('fListPrice').value;
    const useStandardClosing = document.getElementById('fUseStandardClosing')?.checked !== false;
    return { name, category, clothingType, brand, gender, size, condition, notes, color, measurements, price, useStandardClosing };
  }

  async function generateListingDescription(){
    const f = gatherListingFormFields();
    const title = buildListingTitle(f);
    const description = buildListingDescription(f);
    // Best-effort starting point for Style Tags (max 3 on Poshmark) — she can
    // freely edit these before copying, this just saves typing from scratch.
    const styleTagGuesses = Array.from(new Set([f.clothingType, f.color, f.gender ? `${f.gender} Style` : ''].filter(Boolean))).slice(0, 3);
    renderListingOutput(title, description, styleTagGuesses, null);
    // Same autosave the AI generator already does — previously this instant
    // template only ever lived on screen until a separate manual Save,
    // including erroring out on a never-saved item.
    await autosaveGeneratedListingText(false);
  }

  // Shared by the single-item "🪄 Rewrite listing text" button and the bulk
  // "generate descriptions for selected items" tool — rewrites only the
  // title/description/tags. Doesn't touch the DOM or `items`; callers
  // decide what to do with the result. `f` is the same shape
  // gatherListingFormFields() returns, plus `aiFacts` (visual facts saved
  // by an earlier ✨ analysis — when present NO photos are sent, ~$0.01 per
  // rewrite) or else `imageBlocks` (photos, the pre-v3.13.115 behavior).
  async function requestAiListingDescription(f){
    const aiFacts = f.aiFacts || null;
    const res = await callAiItemEndpoint({
      mode: 'listing_only',
      imageBlocks: aiFacts ? [] : (f.imageBlocks || []),
      input: {
        fields: f,
        useStandardClosing: f.useStandardClosing,
        standardClosingText: appSettings.listingStandardText || '',
        aiFacts,
      },
    });
    if (!res.ok) return res;
    return {
      ok: true,
      title: String(res.result.title || '').trim().slice(0, 80),
      description: trimToLimit(res.result.description, LISTING_DESC_LIMIT),
      styleTagGuesses: normalizeStyleTags(res.result.style_tags),
    };
  }

  async function generateListingDescriptionAI(){
    const btn = document.getElementById('genListingAiBtn');
    const area = document.getElementById('listingOutputArea');

    if (aiUsageRemaining() <= 0){
      area.innerHTML = `<div class="ai-error">❌ You've reached your monthly AI analysis limit (${appSettings.aiUsageLimit || 500} analyses). Go to ⚙ Settings to reset the counter.</div>`;
      return;
    }

    const f = gatherListingFormFields();
    const aiFacts = currentAiFacts;

    btn.disabled = true;
    btn.textContent = '🪄 Writing…';
    area.innerHTML = `<div class="ai-loading">Creating a special listing…</div>`;

    try{
      // With saved visual facts the photos aren't needed; without them
      // (item never ran ✨ Analyze), read up to 5 photos as before.
      const imageBlocks = aiFacts ? [] : await buildAiImageBlocks(currentPhotos, 5);

      const result = await requestAiListingDescription({ ...f, aiFacts, imageBlocks });
      if (!result.ok){
        area.innerHTML = `<div class="ai-error">${result.message}</div>`;
        return;
      }

      renderListingOutput(result.title, result.description, result.styleTagGuesses, AI_LISTING_SOURCE_LABEL);
      // Autosave the moment the description is delivered — previously she
      // had to click Save separately just to enable "Publish on eBay",
      // and until then the text only ever lived on screen.
      await autosaveGeneratedListingText(true);
      await incrementAiUsage();
      const remaining = aiUsageRemaining();
      if (remaining <= 50 && remaining > 0){
        document.getElementById('listingOutputArea').innerHTML += `<div style="font-size:11px; color:var(--amber-deep); background:rgba(217,160,91,0.15); padding:7px 10px; border-radius:8px; margin-top:6px;">⚠ ${remaining} AI analyses remaining this month. Reset in ⚙ Settings.</div>`;
      }
    }catch(err){
      area.innerHTML = `<div class="ai-error">Couldn't complete the AI write-up right now. Please try again in a moment.</div>`;
    }finally{
      btn.disabled = false;
      btn.textContent = '🪄 Rewrite listing text with AI';
    }
  }

  // Persists whatever's currently rendered in the listing-description panel
  // onto the item — the trigger is the AI delivering a description, not a
  // separate manual Save click.
  //  - Brand-new item (never saved) → same full save the Save button does,
  //    same validations (name, eBay category chosen) included.
  //  - Already-saved item → just updates listingTitle/listingDescription in
  //    place, without re-running the full save flow or its side effects
  //    (photo upload, re-opening the modal, eBay relist prompt, etc.).
  async function autosaveGeneratedListingText(isAi){
    if (!currentEditId){
      // skipValidation: generating a description shouldn't be blocked by the
      // "choose an eBay category first" gate the manual Save button
      // enforces — that only matters once she actually tries to list on
      // eBay, which checks for it independently.
      await saveItemFlow({ skipValidation: true, listingIsAi: isAi });
      return;
    }
    const idx = items.findIndex(i => i.id === currentEditId);
    if (idx < 0) return;
    const title = document.getElementById('listTitleText')?.textContent || '';
    const description = document.getElementById('listDescText')?.value || '';
    const styleTags = readCurrentStyleTagInputs();
    const updated = { ...items[idx], listingTitle: title, listingDescription: description, listingStyleTags: styleTags !== undefined ? styleTags : (items[idx].listingStyleTags || []), listingIsAi: isAi };
    items[idx] = updated;
    try{
      await saveItem(updated);
    }catch(e){ /* saveItem already alerts the user on failure */ }
  }

  // ---------- BULK AI DESCRIPTION GENERATION ----------
  // Same shape as ebay-api.js's bulk eBay preflight/report (computeBulkEbayGroups
  // / showBulkEbayPreflight / runBulkEbayPublish / renderBulkEbayReport): a
  // preview of what will happen, a confirm button, a sequential run with
  // live progress, then a report — for generating+saving listing
  // descriptions across every selected item that doesn't have one yet,
  // instead of opening and generating them one at a time.
  function showBulkGenerateDescPreflight(){
    const statusEl = document.getElementById('bulkActionStatus');
    if (!statusEl) return;

    const ids = Array.from(bulkSelectedIds);
    const selected = ids.map(id => items.find(i => i.id === id)).filter(Boolean);
    const alreadyHas = selected.filter(i => i.listingDescription);
    const eligible = selected.filter(i => !i.listingDescription);
    const noPhotos = eligible.filter(i => !(i.photos && i.photos.length));
    const ready = eligible.filter(i => i.photos && i.photos.length);
    const itemLabel = (item) => escapeHtml(item.name || item.productCode || 'Item');
    const editBtn = (item) => `<button class="bulk-desc-edit-btn" data-edit-id="${item.id}" style="background:transparent; border:1px solid var(--line); border-radius:7px; padding:6px 12px; font-size:13px; cursor:pointer; margin-left:8px;">Edit</button>`;
    const itemRow = (text) => `<div style="margin-top:6px; font-size:14px; line-height:1.4; display:flex; align-items:center; flex-wrap:wrap;">${text}</div>`;
    const remaining = aiUsageRemaining();

    statusEl.innerHTML = `
      <div class="ebay-connect-box">
        <div class="ec-title">Generate ${ready.length} description${ready.length===1?'':'s'} with AI?</div>
        <div class="ec-sub">
          ${alreadyHas.length ? `<div>⏭️ ${alreadyHas.length} already ${alreadyHas.length===1?'has':'have'} a description (skipped)</div>` : ''}
          ${noPhotos.length ? `<div style="margin-top:8px; font-size:13px;"><b style="color:var(--danger);">🚫 ${noPhotos.length} can't generate — no photos</b>${noPhotos.map(i => itemRow(`${itemLabel(i)}${editBtn(i)}`)).join('')}</div>` : ''}
          ${remaining < ready.length ? `<div style="margin-top:8px; font-size:13px; color:var(--amber-deep);">⚠ Only ${remaining} AI use${remaining===1?'':'s'} left this month — will stop once that runs out and report what's left.</div>` : ''}
        </div>
        <button id="bulkConfirmGenerateDescBtn" style="background:var(--gold); color:white; border:none; border-radius:8px; padding:11px; font-size:13px; font-weight:600; cursor:pointer; width:100%; margin-top:10px;" ${ready.length===0?'disabled':''}>
          🪄 Generate ${ready.length} now
        </button>
        <button id="bulkCancelGenerateDescBtn" style="background:transparent; border:1px solid var(--line); border-radius:8px; padding:9px; font-size:13px; cursor:pointer; width:100%; margin-top:6px;">
          Cancel
        </button>
      </div>`;

    document.getElementById('bulkCancelGenerateDescBtn').addEventListener('click', () => { statusEl.innerHTML = ''; });
    statusEl.querySelectorAll('[data-edit-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const item = items.find(i => i.id === btn.dataset.editId);
        if (item) openModal(item);
      });
    });
    const confirmBtn = document.getElementById('bulkConfirmGenerateDescBtn');
    if (confirmBtn && ready.length){
      confirmBtn.addEventListener('click', () => runBulkGenerateDescriptions(ready));
    }
  }

  // Single-item core, extracted so it can be reused outside the bulk
  // preflight flow too (see window.generateListingDescriptionForItem below
  // — the eBay audit's "generate missing descriptions" button calls this
  // directly instead of duplicating the AI request/usage-tracking logic).
  async function generateListingDescriptionForItem(item){
    if (aiUsageRemaining() <= 0){
      return { ok:false, message: 'Monthly AI usage limit reached' };
    }
    try{
      const f = {
        brand: item.brand || '', category: item.category || '', clothingType: item.clothingType || '',
        gender: item.gender || '', size: item.size || '', condition: item.condition || '',
        notes: item.notes || '', color: item.color || '',
        measurements: (item.measurements?.values && Object.keys(item.measurements.values).length > 0)
          ? Object.entries(item.measurements.values).map(([k,v]) => `${k}: ${v.toFixed(1)}"`).join(', ')
          : '',
        price: item.listPrice || '',
        // No live checkbox to ask in a bulk/automated flow — the closet/
        // bundle blurb only makes sense for clothing, so decide from the
        // item's own category instead (this is what produced a "check my
        // closet!" line on a pencil before).
        useStandardClosing: item.category === 'Clothing',
        // Items analyzed with ✨ (v3.13.115+) rewrite from their saved
        // visual facts — no photos sent; older items still send photos.
        aiFacts: item.aiFacts || null,
        imageBlocks: item.aiFacts ? [] : await buildAiImageBlocks(item.photos, 5),
      };
      const result = await requestAiListingDescription(f);
      if (!result.ok) return { ok:false, message: result.message };
      const idx = items.findIndex(i => i.id === item.id);
      if (idx >= 0){
        const updated = { ...items[idx], listingTitle: result.title, listingDescription: result.description, listingStyleTags: result.styleTagGuesses || [], listingIsAi: true };
        items[idx] = updated;
        await saveItem(updated);
      }
      await incrementAiUsage();
      return { ok:true };
    }catch(e){
      return { ok:false, message: "Couldn't complete the AI write-up right now." };
    }
  }
  window.generateListingDescriptionForItem = generateListingDescriptionForItem;

  // Cross-module "jump to this item" — used by modules/ebay-audit.js's
  // import flow (Settings) to open a freshly-imported item's modal without
  // that module needing access to main.js's closure state directly.
  window.openItemModalById = function(id){
    const item = items.find(i => i.id === id);
    if (item){ switchToTab('catalog'); openModal(item); }
  };

  async function runBulkGenerateDescriptions(toGenerate){
    const results = []; // { item, ok, message? }
    for (let i = 0; i < toGenerate.length; i++){
      const item = toGenerate[i];
      const statusEl = document.getElementById('bulkActionStatus');
      if (statusEl){
        statusEl.innerHTML = `<div style="opacity:0.8;">⏳ Writing description ${i+1} of ${toGenerate.length}: ${escapeHtml(item.name || item.productCode || 'item')}…</div>`;
      }
      const { ok, message } = await generateListingDescriptionForItem(item);
      results.push({ item, ok, message });
    }
    renderAll();
    renderBulkGenerateDescReport(results);
  }

  function renderBulkGenerateDescReport(results){
    // renderAll() rebuilds the bulk bar from scratch, so #bulkActionStatus
    // from before the loop is stale — always re-query it here.
    const statusEl = document.getElementById('bulkActionStatus');
    if (!statusEl) return; // bulk mode got closed some other way mid-loop

    const success = results.filter(r => r.ok);
    const failed = results.filter(r => !r.ok);
    const itemLabel = (item) => escapeHtml(item.name || item.productCode || 'Item');
    const editBtn = (item) => `<button class="bulk-desc-edit-btn" data-edit-id="${item.id}" style="background:transparent; border:1px solid var(--line); border-radius:7px; padding:6px 12px; font-size:13px; cursor:pointer; margin-left:8px;">Edit</button>`;
    const itemRow = (text) => `<div style="margin-top:6px; font-size:14px; line-height:1.4; display:flex; align-items:center; flex-wrap:wrap;">${text}</div>`;

    let html = `<div class="ebay-connect-box"><div class="ec-title">Bulk description generation finished</div><div class="ec-sub">`;
    if (success.length){
      html += `<div style="margin-bottom:8px; font-size:13px;"><b style="color:var(--sage-deep);">✅ ${success.length} generated and saved</b>`;
      html += success.map(r => itemRow(itemLabel(r.item))).join('');
      html += `</div>`;
    }
    if (failed.length){
      html += `<div style="font-size:13px;"><b style="color:var(--danger);">❌ ${failed.length} failed</b>`;
      html += failed.map(r => itemRow(`${itemLabel(r.item)} — ${escapeHtml(r.message || 'unknown error')}${editBtn(r.item)}`)).join('');
      html += `</div>`;
    }
    html += `</div>
      <button id="bulkGenerateDescReportCloseBtn" style="background:transparent; border:1px solid var(--line); border-radius:8px; padding:9px; font-size:13px; cursor:pointer; width:100%; margin-top:8px;">Close</button>
    </div>`;

    statusEl.innerHTML = html;
    statusEl.querySelectorAll('[data-edit-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const item = items.find(i => i.id === btn.dataset.editId);
        if (item) openModal(item);
      });
    });
    const closeBtn = document.getElementById('bulkGenerateDescReportCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', () => { statusEl.innerHTML = ''; });
  }

  // Always uses the structured generator (title + "Details:" bullet
  // description), regardless of the Platform dropdown — this is the one
  // and only description used everywhere now (eBay reuses whatever's saved
  // here, see api/ebay-list.js's buildDescription), so gating it behind
  // "Platform = Poshmark" only meant it silently went unsaved for anyone
  // whose Platform was set to anything else. generateGenericListing() (the
  // old fallback for non-Poshmark platforms) is retired — its output lived
  // in different DOM elements the save handler never read from.
  document.getElementById('genListingBtn').addEventListener('click', generateListingDescription);
  document.getElementById('genListingAiBtn').addEventListener('click', generateListingDescriptionAI);

  function updateListingGeneratorUI(){
    document.getElementById('genListingBtn').textContent = '📝 Generate listing copy (instant template)';
    document.getElementById('genListingAiBtn').textContent = '🪄 Rewrite listing text with AI';
    document.getElementById('genListingAiBtn').style.display = 'block';
    document.getElementById('genListingAiHint').style.display = 'block';
  }

  // ---------- SAVE / DELETE ----------
  // `skipValidation` lets an autosave (triggered by generating a listing
  // description, or by closing the modal with several photos already
  // added — see below) persist the item without the two checks that only
  // make sense for a deliberate manual Save: a real name (defaults to
  // "Item", same fallback the listing generators already use) and a
  // chosen eBay category (irrelevant until she actually tries to list on
  // eBay — that action checks for it independently).
  async function saveItemFlow({ skipValidation = false, suppressReopen = false, listingIsAi } = {}){
    let name = document.getElementById('fName').value.trim();
    if (!name){
      if (skipValidation) name = 'Item';
      else{
        alert('Give your item a name before saving.');
        return;
      }
    }
    if (!chosenEbayCategory && !skipValidation){
      alert('Choose an eBay category before saving — tap the eBay Category field and search for it.');
      return;
    }
    if (currentStatus === 'anunciado' && currentListedPlatforms.length === 0){
      alert('Status is "Listed" but no platform is checked under "Listed on" — pick at least one platform before saving, so the app knows where to look when it sells.');
      return;
    }
    name = toTitleCase(name);
    document.getElementById('fName').value = name;
    const saveBtn = document.getElementById('saveItemBtn');
    const originalBtnText = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    setSaveProgress(5, 'Preparing…');

    // Legacy "Platform" field was retired — "Listed on" (currentListedPlatforms)
    // is what actually drives fee estimates now, this is just the in-memory
    // default used below when a sold-platform isn't chosen yet.
    const platform = currentListedPlatforms[0] || 'ebay';
    const listPrice = parseFloat(document.getElementById('fListPrice').value) || 0;
    const storageBox = document.getElementById('fStorageBox').value.trim();
    if (storageBox) lastUsedBox = storageBox;
    const source = document.getElementById('fSource').value.trim();
    if (source) lastUsedSource = source;
    const category = getCategoryValue();
    if (category) lastUsedCategory = category;
    if (chosenEbayCategory) lastUsedEbayCategory = chosenEbayCategory;
    const colorSelectVal = document.getElementById('fColor').value;
    const color = colorSelectVal === '__other__'
      ? document.getElementById('fColorOther').value.trim()
      : colorSelectVal;
    const clothingTypeSelectVal = document.getElementById('fClothingType').value;
    const clothingType = clothingTypeSelectVal === '__other__'
      ? document.getElementById('fClothingTypeOther').value.trim()
      : clothingTypeSelectVal;

    const itemId = currentEditId || uid();
    // Quantity only applies to brand-new items — editing an existing one
    // always represents exactly one physical piece regardless of the field.
    const requestedQty = currentEditId ? 1 : Math.max(1, Math.min(50, parseInt(document.getElementById('fQuantity').value, 10) || 1));

    // Upload any not-yet-hosted photos to Storage BEFORE writing to Firestore —
    // this is what keeps the item document tiny regardless of photo size/count.
    let hostedPhotos = currentPhotos;
    try{
      if (currentPhotos.length){
        setSaveProgress(10, `Uploading photo 1 of ${currentPhotos.length}…`);
        hostedPhotos = await ensurePhotosHostedForSave(itemId, currentPhotos, (done, total) => {
          // Photos are ~85% of the total progress bar; the final Firestore
          // write is a quick last step.
          const pct = 10 + Math.round((done / total) * 75);
          setSaveProgress(pct, done < total ? `Uploading photo ${done + 1} of ${total}…` : 'Photos uploaded — saving details…');
        });
      }
      setSaveProgress(90, 'Saving details…');
    }catch(e){
      console.error('Photo upload failed:', e);
      saveBtn.disabled = false;
      saveBtn.textContent = originalBtnText;
      setSaveProgress(null);
      alert("Couldn't upload photos right now — please try again. If this keeps happening, tell Vitor: " + (e?.message || e));
      return;
    }

    const existingItemForCode = currentEditId ? items.find(i => i.id === currentEditId) : null;
    const rawProductCode = document.getElementById('fProductCode').value.trim();
    let baseProductCode;
    if (productCodeIsAutoSuggested && !currentEditId){
      // New item, still showing the auto-filled suggestion — don't trust
      // that guess (another terminal may have taken it since the modal
      // opened, see CLAUDE.md "duplicate registration numbers"). Reserve a
      // fresh number atomically via a Firestore transaction instead, which
      // two terminals can never both win.
      try{
        baseProductCode = await reserveNextProductCode();
      }catch(e){
        console.error('Failed to reserve a product code, falling back to a local guess:', e);
        baseProductCode = (rawProductCode && rawProductCode !== 'loading…') ? rawProductCode : nextProductCode();
      }
    } else {
      baseProductCode = (rawProductCode && rawProductCode !== 'loading…') ? rawProductCode : nextProductCode();
      // A hand-typed/edited code bypasses the atomic reservation above, so
      // check it isn't already used by a DIFFERENT item before saving —
      // but only when it's actually changed from what this item already
      // had (a plain re-save of an existing item shouldn't pay for a
      // Firestore round-trip on every click).
      if (baseProductCode !== existingItemForCode?.productCode){
        const dupMatches = await findItemsWithProductCode(baseProductCode, currentEditId);
        if (dupMatches.length){
          const suggestion = await reserveNextProductCode().catch(() => nextProductCode());
          document.getElementById('fProductCode').value = suggestion;
          productCodeIsAutoSuggested = false;
          saveBtn.disabled = false;
          saveBtn.textContent = originalBtnText;
          setSaveProgress(null);
          alert(`Registration number ${baseProductCode} is already used by "${dupMatches[0].name || 'another item'}".\n\nA new number has been filled in for you: ${suggestion}. Review it and save again.`);
          return;
        }
      }
    }
    // Every save here rebuilds the item from form fields — fields with no
    // form input of their own (set programmatically elsewhere, like the
    // eBay listing metadata written by publishItemToEbayCore) must be
    // explicitly carried forward from the currently-saved item, or a save
    // right after listing on eBay (even just closing the modal, which
    // autosaves once there are more than 4 photos — see
    // closeModalWithAutosaveIfNeeded) silently wipes the app's own record
    // of an already-live eBay listing. The listing itself stays live on
    // eBay when this happens — only this app's memory of it is lost —
    // but that's exactly what lets the next "List on eBay" tap create a
    // second, duplicate live listing, since the app no longer knows one
    // already exists.
    const existingItem = currentEditId ? items.find(i => i.id === currentEditId) : null;
    const itemData = {
      id: itemId,
      ebayListingId: existingItem?.ebayListingId || null,
      ebayListingUrl: existingItem?.ebayListingUrl || null,
      ebayOfferId: existingItem?.ebayOfferId || null,
      ebaySku: existingItem?.ebaySku || null,
      ebayListedAt: existingItem?.ebayListedAt || null,
      hostedPhotoUrls: existingItem?.hostedPhotoUrls || null,
      // Quantity > 1 tags every copy "-1", "-2", etc. off the same base code
      // (e.g. "#4578-1", "#4578-2") instead of consuming several numbers from
      // the main sequence — makes it visually obvious they're duplicates.
      productCode: requestedQty > 1 ? `${baseProductCode}-1` : baseProductCode,
      storageBox,
      source,
      color,
      clothingType,
      name,
      category,
      ebayCategoryId: chosenEbayCategory?.id || null,
      ebayCategoryPath: chosenEbayCategory?.path || null,
      ebayValidConditions: chosenEbayCategory?.validConditions || null,
      ebayAspects: { ...currentEbayAspects },
      // Persists whatever's currently in the listing-generator output (if a
      // listing description was generated/edited this session) so it
      // survives closing the modal — previously this text only ever lived
      // on screen, never saved. This exact text also becomes the eBay
      // description instead of eBay building its own disconnected one from
      // shipping-box dimensions. Falls back to whatever was already saved
      // if nothing was (re)generated this time.
      listingTitle: document.getElementById('listTitleText')?.textContent
        || existingItem?.listingTitle || '',
      listingDescription: document.getElementById('listDescText')?.value
        || existingItem?.listingDescription || '',
      // Same idea as listingTitle/listingDescription above, for the Style
      // Tags panel — previously these were never saved at all (only ever
      // read by the "Copy tags" button), so they silently disappeared the
      // moment the item was saved and the modal reopened.
      listingStyleTags: readCurrentStyleTagInputs()
        ?? existingItem?.listingStyleTags ?? [],
      // Whether the current listingTitle/listingDescription came from the AI
      // writer vs. the instant template vs. a manual edit — drives whether
      // the "AI-written" badge (and its "Apply title" button) still shows
      // when this item's modal is reopened later. Only set explicitly by the
      // two generator flows (autosaveGeneratedListingText); a plain manual
      // Save preserves whatever was already there instead of guessing.
      listingIsAi: listingIsAi !== undefined ? listingIsAi
        : (existingItem?.listingIsAi || false),
      // Persists the last-generated AI photo analysis (identification, price
      // guess, reasoning, etc.) the same way listingDescription is persisted
      // above — kept in sync with the on-screen card via currentAiAnalysis,
      // including being cleared when she dismisses the card.
      aiAnalysis: currentAiAnalysis || null,
      // What the last ✨ analysis saw in the photos (v3.13.115) — lets a
      // later "🪄 Rewrite listing text" skip re-sending the photos.
      aiFacts: currentAiFacts || existingItem?.aiFacts || null,
      brand: document.getElementById('fBrand').value.trim(),
      gender: document.getElementById('fGender').value,
      size: document.getElementById('fSize').value.trim(),
      condition: document.getElementById('fCondition').value,
      cost: document.getElementById('fCost').value,
      weight: document.getElementById('fWeight').value,
      length: document.getElementById('fLen').value,
      width: document.getElementById('fWid').value,
      height: document.getElementById('fHei').value,
      notes: document.getElementById('fNotes').value.trim(),
      listPrice: listPrice || '',
      listedPlatforms: [...currentListedPlatforms],
      freeShipping: document.getElementById('fFreeShipping').value === 'seller',
      measurements: currentMeasurements || null,
      photos: hostedPhotos,
      status: currentStatus,
      prep: currentPrep,
      createdAt: currentEditId ? (existingItem?.createdAt || Date.now()) : Date.now(),
    };

    if (currentStatus === 'vendido'){
      const soldPrice = parseFloat(document.getElementById('fSoldPrice')?.value) || listPrice;
      const shippingCost = parseFloat(document.getElementById('fShippingCost')?.value) || 0;
      const soldPlatform = document.getElementById('fSoldPlatform')?.value || platform;
      // The fee field is editable (pre-filled from the platform calc, but
      // she can override it — a promo, a dispute credit, whatever doesn't
      // match the standard rate) — read whatever's actually in the field
      // rather than silently recomputing and overwriting an edit. Only
      // falls back to a fresh calc if the field is somehow missing/empty.
      const feesTotalInput = document.getElementById('fFeesTotal')?.value;
      const feesTotal = feesTotalInput !== undefined && feesTotalInput !== '' ? parseFloat(feesTotalInput) : platformFee(soldPlatform, soldPrice);
      const otherCosts = parseFloat(document.getElementById('fOtherCosts')?.value) || 0;
      itemData.soldPrice = soldPrice;
      itemData.shippingCost = shippingCost;
      itemData.soldPlatform = soldPlatform;
      itemData.feesTotal = feesTotal;
      itemData.otherCosts = otherCosts;
      itemData.soldAt = existingItem?.soldAt || Date.now();
      itemData.netProfit = soldPrice - (parseFloat(itemData.cost)||0) - feesTotal - shippingCost - otherCosts;
    }

    // Quantity > 1: build N copies sharing every field except id/productCode,
    // reusing the same already-uploaded photos rather than re-uploading them
    // per copy. Each copy is still its own real item — own status, own sold
    // price later, own printable label — just filled out once.
    const itemsToSave = [itemData];
    for (let i = 1; i < requestedQty; i++){
      itemsToSave.push({
        ...itemData,
        id: uid(),
        productCode: `${baseProductCode}-${i + 1}`,
      });
    }

    for (const it of itemsToSave){
      const idx = items.findIndex(i => i.id === it.id);
      if (idx >= 0) items[idx] = it;
      else items.push(it);
    }

    try{
      for (let i = 0; i < itemsToSave.length; i++){
        if (itemsToSave.length > 1) setSaveProgress(90, `Saving item ${i + 1} of ${itemsToSave.length}…`);
        await saveItem(itemsToSave[i]);
      }
    }catch(e){
      saveBtn.disabled = false;
      saveBtn.textContent = originalBtnText;
      setSaveProgress(null);
      return; // error already shown to user inside saveItem
    }
    // Doesn't block the save above (that's already committed), but DOES get
    // awaited here so we know whether to warn before moving on — silently
    // firing-and-forgetting this is what let one item stay live on eBay
    // after it sold elsewhere and get sold a second time.
    const ebayEndResult = await endEbayListingIfSold(itemData);
    const ebayPostSoldLines = ebayPostSoldMessageLines(itemData, ebayEndResult);
    if (ebayPostSoldLines.length){
      // Loud and blocking on purpose — a missed eBay/other-platform
      // double-sell is a real money loss, not a "review when convenient" notice.
      alert(ebayPostSoldLines.join('\n\n'));
    }
    // If this save completed a Photo Session draft, it's now a real item —
    // remove the source draft doc so it stops showing up in the drafts list.
    if (currentDraftId){
      await deleteDraftFromDb(currentDraftId);
      draftItems = draftItems.filter(d => d.id !== currentDraftId);
      currentDraftId = null;
    }
    setSaveProgress(100, 'Saved!');
    renderAll();
    const lastSaved = itemsToSave[itemsToSave.length - 1];
    // suppressReopen: an autosave that's about to close the modal itself
    // (or that already has its own follow-up, like generating a listing
    // description) doesn't want the normal post-save reopen/relist dance.
    if (suppressReopen){
      // no-op — caller decides what happens next
    } else if (quickCatalogMode){
      // The whole point of quick catalog mode is never stopping to close and
      // reopen the form between items — go straight to a blank one, ready
      // for the next photo.
      openModal(null);
    } else if (openedFromBulkReview){
      // She came here from "Edit" on a blocked/needs-review item in the bulk
      // eBay preflight — fixing and saving should offer to list it right
      // away instead of sending her back to redo bulk-select from scratch.
      openedFromBulkReview = false;
      openModal(lastSaved, false, { keepScroll: true });
      listItemOnEbay(lastSaved);
    } else {
      // Re-open the last-saved item (now with a real id) instead of closing —
      // this is what lets "List on eBay" work right after Save, without an
      // extra click to reopen the item first.
      openModal(lastSaved, false, { keepScroll: true });
      // Already live on eBay? The eBay app/mobile can't edit API-created
      // listings (a platform limitation, not ours — desktop Seller Hub
      // still can), so this is the practical way to push an edit out to the
      // live listing: reuses the same "update listing?" confirmation the
      // manual relist button already shows, no plain browser confirm().
      if (lastSaved.ebayListingId){
        listItemOnEbay(lastSaved, true);
      }
    }
    saveBtn.disabled = false;
    saveBtn.textContent = originalBtnText;
    setSaveProgress(null);
    showSavedToast();
    return lastSaved;
  }
  document.getElementById('saveItemBtn').addEventListener('click', () => saveItemFlow());

  document.getElementById('deleteItemBtn').addEventListener('click', async () => {
    if (!currentEditId) return;
    if (!confirm('Delete this item permanently?')) return;
    const idToDelete = currentEditId;
    try{
      await deleteItemFromDb(idToDelete);
    }catch(e){
      return;
    }
    setItems(items.filter(i => i.id !== idToDelete));
    renderAll();
    closeModal();
  });


  // ---------- SETTINGS ----------
  // Loading/saving appSettings and the AI usage counter live in
  // src/data/settings-store.js; the Settings screen and its handlers in
  // src/ui/settings/ (imported at the top of this file).


  // ---------- INIT ----------
  applyLastTheme();
  // Home and Catalog are laid out differently per theme (v3.21.1).
  document.addEventListener('themechange', () => renderAll());
  document.addEventListener('brandchange', () => renderBrand());
  renderBrand();
  initUpdateBanner(APP_VERSION);
  setupSourceAutocomplete();
  setupSizeAutocomplete();
  async function waitForFirebaseThenLoad(){
    if (window.firebaseReady){
      await Promise.all([loadSettings(), loadItems(), loadEbayConnection(), loadDrafts()]);
      checkEbaySalesNow(); // best-effort, silent unless it finds something
      // Home is the start screen on every device (v3.20.0); an employee
      // lands on Catalog (switchToTab enforces it).
      switchToTab('home');
    } else {
      setTimeout(waitForFirebaseThenLoad, 50);
    }
  }

  // ---------- AUTH GATE ----------
  // Nobody sees the app until Firebase confirms they're signed in AND their
  // Firestore user doc says status:'approved'. New sign-ups are always
  // 'pending' and sit behind the "Awaiting approval" screen until an admin
  // approves them in the Developer Panel. (Before v3.18.1 an admin email
  // was approved on sight; admins are now marked by a server-set claim.)
  let isSignupMode = false;
  // Shown when an admin removed the account (Developer Panel → Remove
  // disables the login, v3.18.2).
  const REMOVED_ACCOUNT_MSG = 'This account has been removed. Contact the person who manages your access.';

  // A returning, already-signed-in user still has to wait for Firebase's
  // async onAuthStateChanged callback to fire before showApp() can run —
  // showing the actual login FORM by default during that gap meant every
  // page load flashed the login screen even for someone who never needed
  // to type anything. #authCheckingState is a neutral "Checking your
  // session…" placeholder shown by default instead; showAuthForm()/
  // showAuthPending() only swap it out once we know it's actually needed.
  function showAuthForm(){
    document.getElementById('authOverlay').style.display = 'flex';
    document.getElementById('authCheckingState').style.display = 'none';
    document.getElementById('authFormState').style.display = 'block';
    document.getElementById('authPendingState').style.display = 'none';
    document.body.classList.add('auth-locked');
  }
  // mode 'approval' = waiting for an admin; 'verify' = approved, but the
  // email isn't verified yet (required since v3.18.4).
  let pendingMode = 'approval';
  function showAuthPending(mode = 'approval'){
    pendingMode = mode;
    const verifyOnly = mode === 'verify';
    document.getElementById('authPendingTitle').textContent = verifyOnly ? 'Verify your email' : 'Awaiting approval';
    document.getElementById('authPendingText').style.display = verifyOnly ? 'none' : '';
    document.getElementById('authVerifyBox').classList.toggle('auth-verify-only', verifyOnly);
    document.getElementById('authOverlay').style.display = 'flex';
    document.getElementById('authCheckingState').style.display = 'none';
    document.getElementById('authFormState').style.display = 'none';
    document.getElementById('authPendingState').style.display = 'block';
    document.body.classList.add('auth-locked');
    renderPendingVerification();
  }
  // Email verification on the "Awaiting approval" screen (v3.18.3).
  // Nothing is sent unless the person clicks the button.
  function renderPendingVerification(msg = ''){
    const user = window.auth.currentUser;
    const verified = !!(user && user.emailVerified);
    document.getElementById('authVerifyText').textContent = verified
      ? `✅ Your email (${user.email}) is verified.`
      : pendingMode === 'verify'
        ? `Calculated Chaos now needs a verified email. Send yourself a verification email (${user ? user.email : ''}), click the link in it, then tap "I've verified it".`
        : `Please also verify your email (${user ? user.email : ''}): send yourself a verification email, click the link in it, then tap "I've verified it".`;
    document.getElementById('authVerifyActions').style.display = verified ? 'none' : 'block';
    document.getElementById('authVerifyMsg').textContent = msg;
  }
  function showApp(){
    document.getElementById('authOverlay').style.display = 'none';
    document.body.classList.remove('auth-locked');
  }

  // Hides every nav entry except Catalog for an employee account (Home,
  // with its profit numbers and daily insight, included). This is a
  // UI-level restriction only — it stops an employee from casually
  // stumbling into financial data, it does NOT stop someone who opens
  // devtools and queries Firestore directly. Closing that gap needs a
  // matching rule in the Firebase Console's Firestore Security Rules
  // (not something this repo can deploy) — see CLAUDE.md.
  function applyRoleRestrictions(){
    if (currentUserRole !== 'employee') return;
    document.querySelectorAll('.nav-link').forEach(btn => {
      if (btn.dataset.tab !== 'catalog') btn.style.display = 'none';
    });
    renderBrand();
  }
  function setAuthError(msg){
    const el = document.getElementById('authError');
    el.style.display = msg ? 'block' : 'none';
    el.textContent = msg || '';
  }
  function applyAuthMode(){
    document.getElementById('authTitle').textContent = isSignupMode ? 'Create account' : 'Welcome back';
    document.getElementById('authSubtitle').textContent = isSignupMode
      ? 'Requests need to be approved before you get access.'
      : 'Sign in to Calculated Chaos.';
    document.getElementById('authSubmitBtn').textContent = isSignupMode ? 'Create account' : 'Sign in';
    document.getElementById('authToggleText').innerHTML = isSignupMode
      ? `Already have an account? <a id="authToggleLink">Sign in</a>`
      : `Don't have an account? <a id="authToggleLink">Create one</a>`;
    document.getElementById('authToggleLink').addEventListener('click', () => {
      isSignupMode = !isSignupMode;
      setAuthError('');
      applyAuthMode();
    });
  }
  applyAuthMode();

  document.getElementById('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    setAuthError('');
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    const submitBtn = document.getElementById('authSubmitBtn');
    submitBtn.disabled = true;
    try{
      const { signInWithEmailAndPassword, createUserWithEmailAndPassword } = window.authFns;
      if (isSignupMode){
        const cred = await createUserWithEmailAndPassword(window.auth, email, password);
        const { doc, setDoc } = window.firestoreFns;
        await setDoc(doc(window.db, 'users', cred.user.uid), {
          email,
          status: 'pending',
          createdAt: Date.now(),
        });
      } else {
        await signInWithEmailAndPassword(window.auth, email, password);
      }
      // onAuthStateChanged below takes it from here (checks approval status).
    }catch(err){
      setAuthError(err.code === 'auth/user-disabled' ? REMOVED_ACCOUNT_MSG : (err.message || 'Something went wrong.'));
    }finally{
      submitBtn.disabled = false;
    }
  });

  document.getElementById('authSignOutBtn').addEventListener('click', async () => {
    await window.authFns.signOut(window.auth);
  });
  document.getElementById('authVerifySendBtn').addEventListener('click', async (e) => {
    e.target.disabled = true;
    const r = await sendVerificationEmail(window.auth.currentUser);
    e.target.disabled = false;
    renderPendingVerification(r.ok ? `Sent to ${window.auth.currentUser?.email}. Check your inbox (and spam), click the link, then tap "I've verified it".` : `❌ ${r.error}`);
  });
  document.getElementById('authVerifyCheckBtn').addEventListener('click', async (e) => {
    e.target.disabled = true;
    const verified = await refreshEmailVerified(window.auth.currentUser);
    e.target.disabled = false;
    // Approved and now verified: start over through the gate to open the app.
    if (verified && pendingMode === 'verify'){ window.location.reload(); return; }
    renderPendingVerification(verified === null ? '❌ Could not check right now. Try again.' : verified ? '' : 'Not verified yet. Click the link in the email first.');
  });

  function waitForFirebaseReady(){
    return new Promise(resolve => {
      (function check(){
        if (window.firebaseReady) resolve(); else setTimeout(check, 50);
      })();
    });
  }

  waitForFirebaseReady().then(() => {
    window.authFns.onAuthStateChanged(window.auth, async (user) => {
      if (!user){
        showAuthForm();
        return;
      }
      try{
        const { doc, getDoc, setDoc } = window.firestoreFns;
        const userRef = doc(window.db, 'users', user.uid);
        let snap = await getDoc(userRef);
        if (!snap.exists()){
          // First time we see this uid (e.g. account existed before this
          // feature shipped) — default to pending, never to approved.
          await setDoc(userRef, { email: user.email, status: 'pending', createdAt: Date.now() });
          snap = await getDoc(userRef);
        }
        if (snap.data().status === 'removed'){
          // A device still signed in from before the removal.
          await window.authFns.signOut(window.auth);
          setAuthError(REMOVED_ACCOUNT_MSG);
          return;
        }
        if (snap.data().status === 'approved' && !(await tokenEmailVerified(user))){
          // The rules and the server refuse an unverified email (v3.18.4).
          showAuthPending('verify');
          return;
        }
        if (snap.data().status === 'approved'){
          currentUserRole = snap.data().role === 'employee' ? 'employee' : 'owner';
          // Picks business vs pre-business data paths before anything loads.
          await loadActiveBusiness(snap.data());
          // Admin-only UI (Settings) reads this synchronously later.
          await loadAdminClaim(user);
          showApp();
          applyRoleRestrictions();
          waitForFirebaseThenLoad();
        } else {
          showAuthPending();
        }
      }catch(e){
        console.error('Auth check failed:', e);
        setAuthError('Could not verify your account. Try again.');
        showAuthForm();
      }
    });
  });

  // Opens the item modal from the bulk eBay preflight's "Edit" buttons —
  // see openedFromBulkReview above for what happens after she saves.
  function openModalFromBulkReview(item){
    openedFromBulkReview = true;
    openModal(item);
  }

  // Bridge for ebay-api.js — everything it needs from this closure that it
  // can't import directly (ebay-api.js is imported by this same file before
  // this IIFE's body runs, so it can't reach anything declared in here on
  // its own). `items`/`appSettings` no longer need to go through here —
  // ebay-api.js imports those straight from modules/state.js now.
  // `currentEditId` is still a getter because it gets reassigned
  // (`currentEditId = …`) — a plain reference would freeze at whatever it
  // was the instant this object was built. Every other entry here is a
  // function or a const, which are never reassigned, so a plain reference
  // stays correct.
  return {
    get currentEditId(){ return currentEditId; },
    saveItem, renderAll, escapeHtml, CONDITION_LABEL, bulkSelectedIds,
    suggestPrice, platformFee, showSavedToast, openModal, renderEbayConnectionStatus,
    openModalFromBulkReview, setListedPlatformsUI, setStatusUI, getMissingEbayFieldLabels, closeModal,
    aiUsageRemaining, incrementAiUsage,
  };
})();
