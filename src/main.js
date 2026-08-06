import './config/firebase.js';
import {
  loadEbayTokens, saveEbayTokens, ebayTokenIsValid, getValidEbayToken,
  checkEbaySalesNow, endEbayListingIfSold, listItemOnEbay, showBulkEbayPreflight,
  ebayTokens, clearEbayTokens,
} from './ebay-api.js';

export const app = (function(){
  // ⬇ Bump this with every meaningful update, and update the date.
  // This is what shows in the badge at the top of the app, and in CSV exports —
  // it's the single source of truth for "which version is this?"
  const APP_VERSION = 'v3.11.0';
  const APP_VERSION_DATE = '2026-08-06';

  let items = [];
  let itemsLoaded = false; // true once the initial Firestore fetch in loadItems() resolves
  let currentEditId = null;
  let currentDraftId = null; // set when the item modal was opened from a Photo Session draft, so a successful save knows to delete the source draft doc
  let openedFromBulkReview = false; // set when the item modal was opened via "Edit" from the bulk eBay preflight's blocked/needs-review lists — a successful save then offers to list it immediately instead of making her redo the whole bulk flow
  let draftItems = []; // Photo Session groups awaiting cataloging — own Firestore collection, never mixed into `items`
  let draftsPanelOpen = false;
  let filterPanelOpen = false; // survives re-renders (e.g. picking a filter chip), unlike the old plain classList.toggle which reset on every re-render
  let currentPhotos = []; // dataUrls (compressed)
  let currentMeasurements = null; // {type, values:{label:inches}, photo:dataUrl} | null
  let currentStatus = 'catalogado';
  let currentPrep = 'ready';
  let activeFilters = { status:null, category:null, incomplete:false, needsPhoto:false, box:null, notSold:false, size:null, platformsInclude:[], platformsExclude:[] };
  let bulkSelectMode = false;
  let bulkSelectedIds = new Set();
  let searchQuery = '';
  let lastUsedBox = ''; // pre-fills the storage box field with whatever was used last
  let lastUsedSource = ''; // pre-fills the source field with whatever was used last
  let lastUsedCategory = 'Clothing'; // pre-fills the category field with whatever was used last
  let lastUsedEbayCategory = null; // { id, path } — carries over between items during a Quick Catalog session only

  const MAX_PHOTOS = 16;
  const MAX_PHOTO_DIM = 1600; // px, longest side after compression — matches eBay's own zoom recommendation
  const PHOTO_QUALITY = 0.85;

  const PLATFORM_FEES = {
    ebay: 0.1335,
    mercari: 0.10,
    poshmark: 0.20,
    vinted: 0.05,
    depop: 0.10,
    outra: 0.12
  };

  const PLATFORM_LABEL = {
    ebay: '🛒 eBay', mercari: '📦 Mercari', poshmark: '👗 Poshmark', vinted: '♻️ Vinted', depop: '📸 Depop', outra: 'Other'
  };
  // Plain names (no emoji) for built-ins — used next to their real favicon
  // in badges, where an emoji alongside a real logo would be redundant.
  const PLATFORM_NAME = {
    ebay: 'eBay', mercari: 'Mercari', poshmark: 'Poshmark', vinted: 'Vinted', depop: 'Depop', outra: 'Other'
  };
  // Official brand colors (researched, not guessed).
  const PLATFORM_COLOR = {
    ebay: '#E53238', mercari: '#5E6DF2', poshmark: '#7F0353', vinted: '#007782', depop: '#FF2300', outra: '#8A7E82'
  };
  // Official favicons — used instead of emoji on badges for the 5 built-in
  // platforms. Deliberately NOT bundling full logo assets (trademark risk,
  // especially given this may become a real product later); a favicon is a
  // much lighter, lower-risk way to show a recognizable real icon. Custom
  // platforms she adds herself have no favicon to fetch, so they keep the
  // emoji/color-only badge style.
  const PLATFORM_FAVICON = {
    ebay: 'https://www.ebay.com/favicon.ico',
    mercari: 'https://www.mercari.com/favicon.ico',
    poshmark: 'https://poshmark.com/favicon.ico',
    vinted: 'https://www.vinted.com/favicon.ico',
    depop: 'https://www.depop.com/favicon.ico',
  };

  // ---------- PLATFORM MANAGEMENT (Settings → Platforms) ----------
  // Built-in platforms keep fixed keys (eBay especially has real API
  // integration logic keyed to that exact string) but her fee %s can be
  // overridden; customPlatforms are entirely her own, addable/removable.
  // Every place that used to read PLATFORM_LABEL/PLATFORM_FEES/PLATFORM_COLOR
  // directly should go through these instead so custom platforms show up
  // everywhere built-ins do (filters, badges, the Platform dropdown, fee calc).
  function getAllPlatforms(){
    const builtIns = Object.keys(PLATFORM_LABEL).filter(k => k !== 'outra').map(key => ({
      key,
      label: PLATFORM_LABEL[key],
      color: PLATFORM_COLOR[key] || '#8A7E82',
      feePct: (appSettings.platformFeeOverrides?.[key] ?? PLATFORM_FEES[key]) * 100,
      builtIn: true,
    }));
    const custom = (appSettings.customPlatforms || []).map(p => ({ ...p, builtIn: false }));
    return [...builtIns, ...custom];
  }
  function getPlatformLabel(key){
    return getAllPlatforms().find(p => p.key === key)?.label || PLATFORM_LABEL[key] || key;
  }
  function getPlatformColor(key){
    return getAllPlatforms().find(p => p.key === key)?.color || '#8A7E82';
  }

  const CONDITION_FACTOR = {
    novo_etiqueta: 1.0,
    novo_sem_etiqueta: 0.85,
    excelente: 0.70,
    bom: 0.55,
    aceitavel: 0.40,
    defeito: 0.22
  };

  const CONDITION_LABEL = {
    novo_etiqueta: 'New with tags',
    novo_sem_etiqueta: 'New without tags',
    excelente: 'Excellent pre-owned condition',
    bom: 'Good pre-owned condition',
    aceitavel: 'Fair condition, priced accordingly',
    defeito: 'Sold as-is for parts or repair'
  };

  // Poshmark doesn't have a granular condition dropdown like eBay — sellers
  // are expected to spell condition out in the description using these
  // community-standard abbreviations (NWT/NWOT/EUC/VGUC/GUC).
  const POSHMARK_CONDITION_LABEL = {
    novo_etiqueta: 'NWT — New With Tags',
    novo_sem_etiqueta: 'NWOT — New Without Tags',
    excelente: 'EUC — Excellent Used Condition, no rips/stains/major flaws',
    bom: 'VGUC — Very Good Used Condition, minor flaws from gentle use',
    aceitavel: 'GUC — Good Used Condition, see notes for flaws',
    defeito: 'Flawed / sold as-is — see photos & notes for details'
  };

  // Poshmark's own fixed "Style Tags" vocabulary — she picks these by
  // clicking them in Poshmark's UI while publishing (not free text), so the
  // AI must only ever suggest tags that actually exist in this list.
  const POSHMARK_STYLE_TAGS = [
    '70s','80s','90s','Activewear','Animal Print','Athleisure','Avant Garde',
    'Baggy','Balletcore','Beach','Beaded','Bikercore','Blokecore','Bodycon','Bohemian','Bow','Bridal','Bridesmaid','Business Casual',
    'Cable Knit','Cashmere','Casual','Chunky','Collegiate','Colorblock','Colorful','Contemporary','Coord Sets','Coquette Girl','Corduroy','Cottagecore','Cozy','Crochet','Cropped','Cruelty-Free','Cut Out',
    'Denim','Distressed','DIY','Drop Waist',
    'Eclectic Grandpa','Embroidered',
    'Fall','Faux Fur','Feminine','Festival','Festive','Flannel','Flare','Floral','Formal','Fringe',
    'Gingham','Girlhoodcore','Gorpcore','Goth','Grunge',
    'Hand Knit','Handmade','Herringbone','Houndstooth',
    'Indie Sleeze',
    'Knit',
    'Lace','Leather','Leopard Print','Lightweight','Linen','Luxury',
    'Maximalism','Mesh','Metallic','Minimalist','Monochrome','Monogram','Moto',
    'Neon','Neutral','Nylon',
    'Office','Oversized',
    'Paisley','Party','Pastel','Patchwork','Peplum','Plaid','Platform','Pleated','Polka Dot','Preppy','Punk',
    'Quiet Luxury','Quilted',
    'Relaxed Fit','Resortwear','Retro','Rosette','Ruffle',
    'Satin','Sequins','Sheer','Sherpa','Silk','Sporty','Strapless','Streetwear','Stripes','Suede',
    'Tailored','Tennis Prep','Travel','Tropical','Tweed','Two-Tone',
    'Unisex','Upcycled','Utility',
    'Vacation','Vegan','Velour','Vintage',
    'Waterproof','Wedding','Western','Whimsigoth','Winter','Wool','Woven',
    'Y2K',
  ];

  const PREP_LABEL = {
    needs_wash: 'Needs wash', needs_repair: 'Needs repair', needs_photo: 'Needs photos', ready: 'Ready to list'
  };

  const BASE_CATEGORY_VALUE = {
    'Clothing': 28, 'Shoes': 35, 'Accessories': 22, 'Electronics': 60,
    'Home & Decor': 25, 'Collectibles': 40, 'Toys': 18, 'Books': 12, 'Other': 20
  };

  const DAILY_QUOTES = [
    "Somebody's closet clutter is somebody else's perfect find.",
    "Every tag you write is a tiny act of treasure hunting, in reverse.",
    "Today's pile is tomorrow's paycheck. One photo at a time.",
    "Thrifted doesn't mean tired — it means it found you twice.",
    "A good sorter sees inventory. A great one sees stories waiting to ship.",
    "Slow and steady fills the shelf. Today, just do one.",
    "The best closet is the one that turns over.",
    "Chaos, weighed and measured, is just a system in disguise.",
    "Nobody buys what they can't see. Light wins more than luck.",
    "Small stack today, smaller stack tomorrow.",
    "You're not behind. You're mid-sort.",
    "Every label you print is a little promise kept.",
    "Good bones sell themselves. Good photos help them along.",
    "A folded shirt and a fair price — that's the whole business.",
    "Patience smells like cedar and looks like a full rack.",
    "What didn't sell yesterday just needs a better light today.",
    "Cataloging is just love letters to your future buyer.",
    "The hanger remembers. So should the spreadsheet.",
    "One box at a time turns clutter into cash flow.",
    "You don't need to finish today. You need to start.",
    "Worn once, loved twice — that's the resale promise.",
    "Every measurement you log saves a future return.",
    "Steady hands, fair prices, happy closets.",
    "The pile shrinks the moment you stop staring at it.",
    "A great listing is just honesty with good lighting.",
    "Today's task: turn one maybe into one done.",
    "Stock doesn't sort itself, but it does reward whoever starts.",
    "Some days you list ten. Some days you list one. Both count.",
    "The tag says condition. The photo says character.",
    "Good inventory hygiene is just kindness to your future self."
  ];

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

  function renderDailyQuote(){
    const { text, isInsight } = getTodaysHeaderMessage();
    document.getElementById('dailyQuote').innerHTML = `<span class="mark">${isInsight ? '📊' : '✺'}</span><span>${escapeHtml(text)}</span>`;
  }

  // ---------- STORAGE (Firebase Firestore) ----------
  // Each item is stored as its own document in the 'items' collection,
  // so a large catalog (with photos) never approaches Firestore's 1MB-per-document limit.
  async function loadItems(){
    try{
      const { collection, getDocs } = window.firestoreFns;
      const snap = await getDocs(collection(window.db, 'items'));
      items = snap.docs.map(d => d.data());
    }catch(e){
      console.error('Load error', e);
      items = [];
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
      const { doc, setDoc } = window.firestoreFns;
      await setDoc(doc(window.db, 'items', itemData.id), itemData);
    }catch(e){
      console.error('Save error', e);
      const reason = (e && e.message) ? e.message : String(e);
      alert("Couldn't save this item.\n\nReason: " + reason);
      throw e;
    }
  }

  async function deleteItemFromDb(itemId){
    try{
      const { doc, deleteDoc } = window.firestoreFns;
      await deleteDoc(doc(window.db, 'items', itemId));
    }catch(e){
      console.error('Delete error', e);
      alert("Couldn't delete right now — please check your connection and try again.");
      throw e;
    }
  }

  function uid(){ return 'it_' + Date.now() + '_' + Math.random().toString(36).slice(2,8); }

  // ---------- PHOTO SESSION DRAFTS (own Firestore collection) ----------
  async function loadDrafts(){
    try{
      const { collection, getDocs } = window.firestoreFns;
      const snap = await getDocs(collection(window.db, 'drafts'));
      draftItems = snap.docs.map(d => d.data());
    }catch(e){
      console.error('Load drafts error', e);
      draftItems = [];
    }
  }

  async function saveDraftToDb(draft){
    try{
      const { doc, setDoc } = window.firestoreFns;
      await setDoc(doc(window.db, 'drafts', draft.id), draft);
    }catch(e){
      console.error('Save draft error', e);
      const reason = (e && e.message) ? e.message : String(e);
      alert("Couldn't save this photo batch as a draft.\n\nReason: " + reason + "\n\nMake sure the 'drafts' collection has been added to your Firestore security rules (see README).");
      throw e;
    }
  }

  async function deleteDraftFromDb(draftId){
    try{
      const { doc, deleteDoc } = window.firestoreFns;
      await deleteDoc(doc(window.db, 'drafts', draftId));
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
  // Forces full-cents display (e.g. "18" -> "18.00") on blur for USD number inputs.
  function attachCurrencyFormatting(ids){
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (!el || el.dataset.currencyFormatBound) return;
      el.dataset.currencyFormatBound = '1';
      el.addEventListener('blur', () => {
        if (el.value === '') return;
        const n = parseFloat(el.value);
        if (!isNaN(n)) el.value = n.toFixed(2);
      });
    });
  }

  // ---------- PRODUCT CODE & STORAGE BOX HELPERS ----------
  function nextProductCode(){
    let maxNum = 0;
    items.forEach(i => {
      // Quantity > 1 items are tagged "#4578-2" etc. — strip that duplicate
      // suffix before reading the base number, so a batch of duplicates
      // doesn't corrupt where the main sequence resumes.
      const base = (i.productCode || '').replace(/-\d+$/, '');
      const match = base.match(/(\d+)\s*$/);
      if (match){
        const n = parseInt(match[1], 10);
        if (n > maxNum) maxNum = n;
      }
    });
    return '#' + String(maxNum + 1).padStart(4, '0');
  }

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
    const boxes = new Set();
    items.forEach(i => { if (i.storageBox && i.storageBox.trim()) boxes.add(i.storageBox.trim()); });
    return Array.from(boxes).sort((a,b)=> a.localeCompare(b, undefined, {numeric:true}));
  }

  function getAllSizes(clothingType){
    const sizes = new Set();
    items.forEach(i => {
      if (!i.size || !i.size.trim()) return;
      if (clothingType && i.clothingType !== clothingType) return;
      sizes.add(i.size.trim());
    });
    return Array.from(sizes).sort((a,b)=> a.localeCompare(b, undefined, {numeric:true}));
  }

  // Standard size run for each clothing type, so the suggestion list isn't
  // empty the very first time a type is used. Covers adult women's sizing
  // (the primary inventory today) — tell Vitor if men's/kids' ranges are
  // needed too and this table can grow per-gender.
  const PRESET_SIZES_BY_TYPE = {
    'T-Shirt':      ['XS','S','M','L','XL','XXL'],
    'Tank Top':     ['XS','S','M','L','XL','XXL'],
    'Blouse':       ['XS','S','M','L','XL','XXL'],
    'Sweater':      ['XS','S','M','L','XL','XXL'],
    'Hoodie':       ['XS','S','M','L','XL','XXL'],
    'Blazer':       ['XS','S','M','L','XL','XXL'],
    'Jacket/Coat':  ['XS','S','M','L','XL','XXL'],
    'Activewear':   ['XS','S','M','L','XL','XXL'],
    'Swimwear':     ['XS','S','M','L','XL','XXL'],
    'Jeans':        ['0','2','4','6','8','10','12','14','16','18','20'],
    'Pants':        ['0','2','4','6','8','10','12','14','16','18','20'],
    'Shorts':       ['0','2','4','6','8','10','12','14','16','18','20'],
    'Skirt':        ['0','2','4','6','8','10','12','14','16','18','20'],
    'Dress':        ['0','2','4','6','8','10','12','14','16','18','20'],
    'Shoes':        ['5','5.5','6','6.5','7','7.5','8','8.5','9','9.5','10','10.5','11'],
    'Bag':          ['One Size'],
    'Accessory':    ['One Size'],
  };

  // Presets first (in their natural size-run order), then any custom sizes
  // she's actually used for this type that aren't already in that list —
  // e.g. she types "Petite M" once and it's added to future suggestions
  // for that same clothing type, same as colors.
  function getSizeSuggestionsForType(clothingType){
    const presets = PRESET_SIZES_BY_TYPE[clothingType] || [];
    const used = getAllSizes(clothingType).filter(s => !presets.includes(s));
    return [...presets, ...used];
  }

  function getAllSources(){
    const sources = new Set();
    items.forEach(i => { if (i.source && i.source.trim()) sources.add(i.source.trim()); });
    return Array.from(sources).sort((a,b)=> a.localeCompare(b, undefined, {numeric:true}));
  }

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
        });
      });
    }

    input.addEventListener('focus', renderSuggestions);
    input.addEventListener('input', renderSuggestions);
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

  // Category is a dropdown of presets + "Add new…", same model as Color and
  // Clothing Type: picking "Add new…" reveals a text field, and whatever she
  // types there gets injected as a real dropdown option (above "Add new…")
  // the next time she opens the form, so she only ever types a given custom
  // category once.
  const PRESET_CATEGORIES = Object.keys(BASE_CATEGORY_VALUE);
  function getAllCategories(){
    const cats = new Set();
    items.forEach(i => { if (i.category && i.category.trim() && !PRESET_CATEGORIES.includes(i.category.trim())) cats.add(i.category.trim()); });
    return Array.from(cats).sort((a,b)=> a.localeCompare(b, undefined, {numeric:true}));
  }
  // Reads the Category field's real value, resolving "__other__" to whatever
  // was typed into the reveal field — same idea as the Color/Clothing Type helpers.
  function getCategoryValue(){
    const sel = document.getElementById('fCategory')?.value;
    return sel === '__other__' ? (document.getElementById('fCategoryOther')?.value.trim() || '') : (sel || '');
  }

  const PRESET_COLORS = ['Black','White','Gray','Beige/Tan','Brown','Red','Pink','Orange','Yellow','Green','Blue','Purple','Gold','Silver','Multi-Color'];
  function getAllColors(){
    const colors = new Set();
    items.forEach(i => { if (i.color && i.color.trim() && !PRESET_COLORS.includes(i.color.trim())) colors.add(i.color.trim()); });
    return Array.from(colors).sort((a,b)=> a.localeCompare(b, undefined, {numeric:true}));
  }

  const PRESET_CLOTHING_TYPES = ['T-Shirt','Tank Top','Blouse','Sweater','Hoodie','Jeans','Pants','Shorts','Skirt','Dress','Jacket/Coat','Blazer','Activewear','Swimwear','Shoes','Bag','Accessory'];
  function getAllClothingTypes(){
    const types = new Set();
    items.forEach(i => { if (i.clothingType && i.clothingType.trim() && !PRESET_CLOTHING_TYPES.includes(i.clothingType.trim())) types.add(i.clothingType.trim()); });
    return Array.from(types).sort((a,b)=> a.localeCompare(b, undefined, {numeric:true}));
  }

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

  // ---------- IMAGE COMPRESSION ----------
  function compressImage(file){
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > height && width > MAX_PHOTO_DIM){
            height = Math.round(height * (MAX_PHOTO_DIM / width));
            width = MAX_PHOTO_DIM;
          } else if (height > MAX_PHOTO_DIM){
            width = Math.round(width * (MAX_PHOTO_DIM / height));
            height = MAX_PHOTO_DIM;
          }
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', PHOTO_QUALITY));
        };
        img.onerror = reject;
        img.src = ev.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // ---------- PRICING ENGINE ----------
  function getCategoryPriceHistory(category){
    const sold = items.filter(i => i.status === 'vendido' && i.category === category && i.soldPrice);
    if (sold.length < 2) return null;
    const avg = sold.reduce((s,i)=> s + parseFloat(i.soldPrice), 0) / sold.length;
    return { avg: Math.round(avg*100)/100, count: sold.length };
  }

  // Reverses a past sale's own condition discount to estimate what that
  // item would have been worth "as new" — this is what lets us compare
  // sales across different conditions fairly, and is also the fix for a
  // real bug: blending a raw historical sold price (which already reflects
  // ITS OWN condition) with a fresh condition-factor multiplication was
  // discounting twice.
  function estimateMintValue(soldItem){
    const factor = CONDITION_FACTOR[soldItem.condition] || 0.55;
    return parseFloat(soldItem.soldPrice) / factor;
  }

  // Sales from last week should count more than sales from 6 months ago —
  // decays smoothly rather than a hard cutoff.
  function recencyWeight(soldAtMs){
    const daysAgo = (Date.now() - (soldAtMs || Date.now())) / 86400000;
    return 1 / (1 + Math.max(0, daysAgo) / 90);
  }

  // Weighted median (not mean) of "mint value" across a set of past sales —
  // median resists a single unusually expensive or cheap sale skewing the
  // whole estimate the way a plain average does.
  function weightedMedianMintValue(soldItems){
    const entries = soldItems
      .map(i => ({ value: estimateMintValue(i), weight: recencyWeight(i.soldAt) }))
      .sort((a,b) => a.value - b.value);
    const totalWeight = entries.reduce((s,e)=> s + e.weight, 0);
    let cum = 0;
    for (const e of entries){
      cum += e.weight;
      if (cum >= totalWeight / 2) return e.value;
    }
    return entries[entries.length - 1].value;
  }

  // Finds the most specific real sales data we have for this item: same
  // BRAND first (any category — a brand's value carries across categories
  // and is far more predictive than category alone), falling back to same
  // category if there isn't enough brand-specific history yet.
  function getPriceReference(item){
    const brand = (item.brand || '').trim().toLowerCase();
    if (brand){
      const sameBrand = items.filter(i => i.status === 'vendido' && i.soldPrice && (i.brand||'').trim().toLowerCase() === brand);
      if (sameBrand.length >= 2){
        return { mintValue: weightedMedianMintValue(sameBrand), count: sameBrand.length, matchType: 'brand' };
      }
    }
    const sameCat = items.filter(i => i.status === 'vendido' && i.soldPrice && i.category === item.category);
    if (sameCat.length >= 2){
      return { mintValue: weightedMedianMintValue(sameCat), count: sameCat.length, matchType: 'category' };
    }
    return null;
  }

  function suggestPrice(item){
    const base = BASE_CATEGORY_VALUE[item.category] || 20;
    const condFactor = CONDITION_FACTOR[item.condition] || 0.5;
    const ref = getPriceReference(item);
    let suggested;
    if (ref){
      // Re-apply THIS item's condition to the real historical "mint value"
      // — not to the raw sold price, which already had a condition baked
      // in (that was the double-discount bug).
      const historicalEstimate = ref.mintValue * condFactor;
      // Trust brand-specific data a bit more than category-wide data.
      const blendWeight = ref.matchType === 'brand' ? 0.7 : 0.6;
      const formulaBrandBoost = (item.brand && item.brand.trim() && ref.matchType !== 'brand') ? 1.15 : 1.0;
      const formulaEstimate = base * condFactor * formulaBrandBoost;
      suggested = formulaEstimate * (1 - blendWeight) + historicalEstimate * blendWeight;
    } else {
      // No real sales data yet to lean on — softer generic brand boost than
      // before (+15% instead of +25%), since a bare brand name alone isn't
      // strong evidence of a premium; real data (above) is what should
      // actually drive brand value once it exists.
      const brandBoost = item.brand && item.brand.trim() ? 1.15 : 1.0;
      suggested = base * condFactor * brandBoost;
    }

    const cost = parseFloat(item.cost) || 0;
    const minMargin = cost * 1.8 + 5;
    suggested = Math.max(suggested, minMargin);
    return Math.round(suggested * 100) / 100;
  }

  function estimateShipping(item){
    const weight = parseFloat(item.weight) || 0.5;
    const len = parseFloat(item.length) || 10;
    const wid = parseFloat(item.width) || 8;
    const hei = parseFloat(item.height) || 2;
    const dimWeight = (len * wid * hei) / 139;
    const billable = Math.max(weight, dimWeight);

    function tierPrice(base, perLb){
      return Math.round((base + Math.max(0, billable - 1) * perLb) * 100) / 100;
    }
    const options = [];
    if (billable <= 0.9 && len <= 15 && wid <= 12){
      options.push({carrier:'USPS Ground Advantage (envelope)', price: 5.49});
    }
    options.push({carrier:'USPS Ground Advantage', price: tierPrice(8.40, 1.35)});
    options.push({carrier:'USPS Priority Mail', price: tierPrice(10.85, 1.65)});
    if (billable >= 5){
      options.push({carrier:'UPS Ground', price: tierPrice(12.90, 1.45)});
    }
    (appSettings.customCarriers || []).forEach(c => {
      options.push({carrier: c.name, price: tierPrice(c.basePrice || 0, c.perLbPrice || 0)});
    });
    return {billable: Math.round(billable*100)/100, options};
  }

  function platformFee(platform, price){
    let rate;
    if (appSettings.platformFeeOverrides?.[platform] !== undefined){
      rate = appSettings.platformFeeOverrides[platform];
    } else if (PLATFORM_FEES[platform] !== undefined){
      rate = PLATFORM_FEES[platform];
    } else {
      const custom = (appSettings.customPlatforms || []).find(p => p.key === platform);
      rate = custom ? custom.feePct / 100 : 0.12;
    }
    return Math.round(price * rate * 100) / 100;
  }

  // ---------- PROJECTED PROFIT ----------
  // Estimated profit for an item that hasn't sold yet — uses listing price if set,
  // otherwise the suggested price, minus estimated platform fee and cheapest shipping.
  function projectedProfit(item){
    const price = item.listPrice ? parseFloat(item.listPrice) : suggestPrice(item);
    const fee = platformFee(item.platform || 'ebay', price);
    // Shipping is only a seller cost if this item offers free shipping (buyer absorbs it otherwise).
    const itemOffersFreeShipping = item.freeShipping !== undefined ? item.freeShipping : appSettings.sellerPaysShipping;
    let shipCost = 0;
    if (itemOffersFreeShipping){
      const ship = estimateShipping(item);
      shipCost = ship.options[0]?.price || 0;
    }
    const cost = parseFloat(item.cost) || 0;
    return Math.round((price - fee - shipCost - cost) * 100) / 100;
  }

  // ---------- COMPLETENESS CHECK ----------
  function isIncomplete(item){
    return !(item.photos && item.photos.length > 0) || !item.cost || !item.weight || !item.length || !item.width;
  }
  function missingFields(item){
    const missing = [];
    if (!(item.photos && item.photos.length > 0)) missing.push('photos');
    if (!item.cost) missing.push('cost');
    if (!item.weight) missing.push('weight');
    if (!item.length || !item.width) missing.push('dimensions');
    return missing;
  }

  function daysSince(ts){
    return Math.floor((Date.now() - ts) / 86400000);
  }

  // ---------- RENDER: STATS ----------
  function renderStats(){
    const active = items.filter(i => i.status !== 'vendido');
    const sold = items.filter(i => i.status === 'vendido');
    const incomplete = items.filter(isIncomplete);
    const totalProfit = sold.reduce((s,i)=> s + (i.netProfit||0), 0);
    const totalProjected = active.reduce((s,i)=> s + projectedProfit(i), 0);

    document.getElementById('statsStrip').innerHTML = `
      <div class="stat-card" data-stat="instock" style="cursor:pointer;"><div class="label">In stock</div><div class="value">${active.length}</div></div>
      <div class="stat-card" data-stat="sold" style="cursor:pointer;"><div class="label">Sold</div><div class="value">${sold.length}</div></div>
      <div class="stat-card warn" data-stat="incomplete" style="cursor:pointer;"><div class="label">Incomplete</div><div class="value">${incomplete.length}</div></div>
      <div class="stat-card profit" data-stat="realized" style="cursor:pointer;"><div class="label">Realized profit</div><div class="value">$${totalProfit.toFixed(0)}</div></div>
      <div class="stat-card projected" data-stat="projected" style="cursor:pointer;"><div class="label">Projected profit</div><div class="value">$${totalProjected.toFixed(0)}</div></div>
    `;
    document.getElementById('statsStrip').querySelectorAll('[data-stat]').forEach(card => {
      card.addEventListener('click', () => {
        const stat = card.dataset.stat;
        // Each stat jumps to the view that actually explains that number —
        // same underlying data, just a faster path to it (and a natural
        // spot for deeper analysis instead of only ever seeing the total).
        if (stat === 'instock'){
          activeFilters = { status:null, category:null, incomplete:false, needsPhoto:false, box:null, notSold:true, size:null, platformsInclude:[], platformsExclude:[] };
          switchToTab('catalog'); renderAll();
        } else if (stat === 'sold'){
          activeFilters = { status:'vendido', category:null, incomplete:false, needsPhoto:false, box:null, notSold:false, size:null, platformsInclude:[], platformsExclude:[] };
          switchToTab('catalog'); renderAll();
        } else if (stat === 'incomplete'){
          activeFilters = { status:null, category:null, incomplete:true, needsPhoto:false, box:null, notSold:false, size:null, platformsInclude:[], platformsExclude:[] };
          switchToTab('catalog'); renderAll();
        } else if (stat === 'realized'){
          switchToTab('finance');
        } else if (stat === 'projected'){
          switchToTab('reports');
        }
      });
    });
  }

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
    document.getElementById('clearFiltersBtn').addEventListener('click', () => {
      activeFilters = { status:null, category:null, incomplete:false, needsPhoto:false, box:null, notSold:false, size:null, platformsInclude:[], platformsExclude:[] };
      renderAll();
    });
  }

  function filtersActiveCount(){
    let n = 0;
    if (activeFilters.status) n++;
    if (activeFilters.category) n++;
    if (activeFilters.incomplete) n++;
    if (activeFilters.needsPhoto) n++;
    if (activeFilters.box) n++;
    if (activeFilters.notSold) n++;
    if (activeFilters.size) n++;
    if (activeFilters.platformsInclude.length || activeFilters.platformsExclude.length) n++;
    return n;
  }

  function applyFilters(list){
    return list.filter(item => {
      if (activeFilters.status && item.status !== activeFilters.status) return false;
      if (activeFilters.notSold && item.status === 'vendido') return false;
      if (activeFilters.category && item.category !== activeFilters.category) return false;
      if (activeFilters.incomplete && !isIncomplete(item)) return false;
      if (activeFilters.needsPhoto && (item.photos && item.photos.length > 0)) return false;
      if (activeFilters.box && item.storageBox !== activeFilters.box) return false;
      if (activeFilters.size && item.size !== activeFilters.size) return false;
      if (activeFilters.platformsInclude.length){
        const onAny = activeFilters.platformsInclude.some(p => (item.listedPlatforms || []).includes(p));
        if (!onAny) return false;
      }
      if (activeFilters.platformsExclude.length){
        const onAnyExcluded = activeFilters.platformsExclude.some(p => (item.listedPlatforms || []).includes(p));
        if (onAnyExcluded) return false;
      }
      if (searchQuery){
        const q = searchQuery.toLowerCase();
        const hay = [item.name, item.brand, item.category, item.clothingType, item.notes, item.productCode, item.storageBox, item.source, item.color].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  // ---------- RENDER: CATALOG ----------
  function statusLabel(s){
    return {catalogado:'Cataloged', anunciado:'Listed', vendido:'Sold'}[s] || s;
  }

  function renderCatalog(){
    const view = document.getElementById('catalogView');
    const filtered = applyFilters(items);

    const filterBtnClass = filtersActiveCount() > 0 ? 'filter-toggle-btn has-active' : 'filter-toggle-btn';
    // Draft groups from a Photo Session live outside `items` entirely (own
    // Firestore collection), so they never show up in the catalog, stats, or
    // CSV export below — this banner + the drafts panel it toggles is the
    // only place they're visible until she completes and saves each one.
    const draftsBannerHtml = draftItems.length > 0 ? `
      <div id="draftsBanner" style="display:flex; align-items:center; justify-content:space-between; background:var(--blush); border:1px solid var(--terracotta); border-radius:10px; padding:10px 14px; margin-bottom:10px; cursor:pointer;">
        <span style="font-size:13px; font-weight:600; color:var(--terracotta-deep);">📷 ${draftItems.length} photo draft${draftItems.length===1?'':'s'} to complete</span>
        <span style="font-size:12px; color:var(--terracotta-deep);">${draftsPanelOpen ? '▲ Close' : '▼ Open'}</span>
      </div>
      <div id="draftsPanel" style="display:${draftsPanelOpen ? 'block' : 'none'}; margin-bottom:12px;">
        ${draftItems.map(d => `
          <div class="draft-card" data-draft-id="${d.id}" style="display:flex; align-items:center; gap:10px; background:var(--white); border:1px solid var(--line); border-radius:10px; padding:8px 10px; margin-bottom:8px;">
            <img src="${d.photos[0]}" style="width:44px; height:44px; object-fit:cover; border-radius:6px; flex-shrink:0;">
            <span style="flex:1; font-size:12.5px; color:var(--plum-soft);">${d.photos.length} photo${d.photos.length===1?'':'s'}</span>
            <button class="icon-btn" data-act="complete-draft" data-draft-id="${d.id}">Complete →</button>
            <button class="icon-btn" data-act="delete-draft" data-draft-id="${d.id}" style="color:var(--danger);">🗑</button>
          </div>
        `).join('')}
      </div>
    ` : '';
    const controlsHtml = `
      ${draftsBannerHtml}
      <div class="search-row">
        <input type="text" class="search-input" id="searchInput" placeholder="Search by name, brand, category…" value="${escapeHtml(searchQuery)}">
        <button class="${filterBtnClass}" id="filterToggleBtn">Filters${filtersActiveCount() ? ' (' + filtersActiveCount() + ')' : ''}</button>
        <button class="${bulkSelectMode ? 'filter-toggle-btn has-active' : 'filter-toggle-btn'}" id="bulkSelectToggleBtn">${bulkSelectMode ? '✕ Cancel' : '☑ Select'}</button>
      </div>
      <div class="filter-panel ${filterPanelOpen ? 'open' : ''}" id="filterPanel"></div>
    `;

    if (items.length === 0){
      view.innerHTML = controlsHtml + `<div class="empty-state">
        <div class="big">🌷</div>
        <div class="serif-line">Your shelf is empty, for now.</div>
        <p>Tap the + button to catalog your first find.</p>
      </div>`;
      wireCatalogControls();
      return;
    }

    if (filtered.length === 0){
      view.innerHTML = controlsHtml + `<div class="empty-state">
        <div class="big">🔍</div>
        <div class="serif-line">No matches here.</div>
        <p>Try adjusting your search or filters.</p>
      </div>`;
      wireCatalogControls();
      return;
    }

    const sorted = [...filtered].sort((a,b)=> (b.createdAt||0) - (a.createdAt||0));
    const cardsHtml = sorted.map(item => {
      const photo = item.photos && item.photos[0];
      const price = item.listPrice ? parseFloat(item.listPrice) : suggestPrice(item);
      const incomplete = isIncomplete(item);
      const noPhoto = !(item.photos && item.photos.length > 0);
      const age = daysSince(item.createdAt);
      const isStale = item.status === 'anunciado' && age >= 30;

      return `
      <div class="item-card ${bulkSelectMode && bulkSelectedIds.has(item.id) ? 'bulk-selected' : ''}" data-id="${item.id}" style="${bulkSelectMode ? 'position:relative;' : ''}">
        ${bulkSelectMode ? `<div class="bulk-checkbox" style="position:absolute; top:8px; left:8px; z-index:5; width:24px; height:24px; border-radius:50%; background:${bulkSelectedIds.has(item.id) ? 'var(--sage)' : 'rgba(255,255,255,0.85)'}; border:2px solid ${bulkSelectedIds.has(item.id) ? 'var(--sage)' : 'var(--line)'}; display:flex; align-items:center; justify-content:center; color:white; font-size:14px;">${bulkSelectedIds.has(item.id) ? '✓' : ''}</div>` : ''}
        <div class="item-photo" ${item.photos && item.photos.length > 0 ? `data-gallery="${item.id}" style="cursor:pointer;"` : ''}>
          ${photo ? `<img src="${photo}">` : `<span class="placeholder">🧥</span>`}
          ${item.photos && item.photos.length > 1 ? `<span class="photo-count-badge">${item.photos.length} 🔍</span>` : ''}
        </div>
        <div class="item-body">
          <div class="item-top">
            <div>
              <div class="item-name">${item.productCode ? `<span class="product-code">${escapeHtml(item.productCode)}</span> ` : ''}${escapeHtml(item.name || 'Unnamed item')}</div>
              <div class="item-cat">${escapeHtml(item.category||'')}${item.brand ? ' · ' + escapeHtml(item.brand) : ''}${item.gender ? ' · ' + escapeHtml(item.gender) : ''}${item.size ? ' · Size ' + escapeHtml(item.size) : ''}</div>
            </div>
            <div class="chip-row">
              <div class="status-chip status-${item.status}">${statusLabel(item.status)}</div>
              ${(item.listedPlatforms || []).map(p => {
                const favicon = PLATFORM_FAVICON[p];
                const faviconImg = favicon ? `<img src="${favicon}" alt="" style="width:12px; height:12px; border-radius:3px; vertical-align:-2px; margin-right:3px;">` : '';
                if (p === 'ebay' && item.ebayListingId){
                  return `<a class="ebay-badge" href="${item.ebayListingUrl || `https://www.ebay.com/itm/${item.ebayListingId}`}" target="_blank">${faviconImg}eBay ↗</a>`;
                }
                // Plain name next to the real favicon (built-ins) instead of
                // the emoji+name label, which is only used as a fallback
                // for custom platforms with no favicon to show.
                const label = favicon ? (PLATFORM_NAME[p] || p) : getPlatformLabel(p);
                return `<span class="platform-badge" style="background:${getPlatformColor(p)};">${faviconImg}${escapeHtml(label)}</span>`;
              }).join('')}
              ${incomplete ? `<div class="warn-chip">⚠ ${noPhoto ? 'No photo' : 'Missing info'}</div>` : ''}
            </div>
          </div>
          <div class="item-meta-row">
            ${item.storageBox ? `<span class="meta-bit">📦 <b>${escapeHtml(item.storageBox)}</b></span>` : ''}
            ${item.source ? `<span class="meta-bit">🏷️ <b>${escapeHtml(item.source)}</b></span>` : ''}
            ${item.color ? `<span class="meta-bit">🎨 <b>${escapeHtml(item.color)}</b></span>` : ''}
            ${item.weight ? `<span class="meta-bit">⚖ <b>${item.weight}lb</b></span>` : ''}
            ${(item.length && item.width) ? `<span class="meta-bit">📐 <b>${item.length}×${item.width}×${item.height||0}"</b></span>` : ''}
            <span class="meta-bit">cost <b>$${(parseFloat(item.cost)||0).toFixed(2)}</b></span>
            ${item.status !== 'vendido' ? `<span class="meta-bit ${isStale?'stale':''}">📅 <b>${age}d</b> ${item.status==='anunciado' ? 'listed' : 'in catalog'}</span>` : ''}
          </div>
          <div class="item-price-row">
            <div class="price-suggested">
              <span class="tag-label">${item.listPrice ? 'listed at' : 'suggested'}</span>
              $${price.toFixed(2)}
              ${item.status !== 'vendido' ? `<span class="projected-inline">→ $${projectedProfit(item).toFixed(2)} proj.</span>` : ''}
            </div>
            <div style="display:flex; gap:6px;">
              <button class="icon-btn" data-action="print-label" data-id="${item.id}" title="Print label">🖨️</button>
              <button class="icon-btn" data-action="edit" data-id="${item.id}">Edit</button>
            </div>
          </div>
        </div>
      </div>`;
    }).join('');

    const bulkBarHtml = bulkSelectMode ? `
      <div id="bulkActionBar" style="position:fixed; bottom:0; left:0; right:0; background:var(--cream); border-top:2px solid var(--line); padding:12px 16px; box-shadow:0 -4px 14px rgba(0,0,0,0.1); z-index:60;">
        <div style="font-size:12px; color:var(--plum-soft); margin-bottom:8px;">${bulkSelectedIds.size} item${bulkSelectedIds.size===1?'':'s'} selected</div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
          <select id="bulkStatusSelect" style="padding:8px 10px; border-radius:8px; border:1px solid var(--line); font-size:13px;">
            <option value="catalogado">Set: Cataloged</option>
            <option value="anunciado">Set: Listed</option>
            <option value="vendido">Set: Sold</option>
          </select>
          <button id="bulkApplyStatusBtn" class="settings-save-btn" style="width:auto; padding:8px 14px; margin:0;" ${bulkSelectedIds.size===0?'disabled':''}>Apply</button>
          <input type="text" id="bulkBoxInput" placeholder="Move to box…" list="storageBoxList" style="padding:8px 10px; border-radius:8px; border:1px solid var(--line); font-size:13px; width:110px;">
          <button id="bulkApplyBoxBtn" class="settings-save-btn" style="width:auto; padding:8px 14px; margin:0;" ${bulkSelectedIds.size===0?'disabled':''}>Move</button>
          <input type="number" id="bulkDiscountInput" placeholder="Discount %" min="1" max="90" style="padding:8px 10px; border-radius:8px; border:1px solid var(--line); font-size:13px; width:90px;">
          <button id="bulkApplyDiscountBtn" class="settings-save-btn" style="width:auto; padding:8px 14px; margin:0;" ${bulkSelectedIds.size===0?'disabled':''}>Apply %</button>
          <button id="bulkDeleteBtn" style="background:var(--danger); color:white; border:none; border-radius:8px; padding:8px 14px; font-size:13px; cursor:pointer;" ${bulkSelectedIds.size===0?'disabled':''}>Delete</button>
          <button id="bulkPublishEbayBtn" style="background:#E53238; color:white; border:none; border-radius:8px; padding:8px 14px; font-size:13px; font-weight:600; cursor:pointer;" ${bulkSelectedIds.size===0?'disabled':''}>🛒 Publish on eBay</button>
          <button id="bulkSelectAllBtn" style="background:transparent; border:1px solid var(--line); border-radius:8px; padding:8px 14px; font-size:13px; cursor:pointer;">Select all (${filtered.length})</button>
        </div>
        <div id="bulkActionStatus" style="margin-top:8px; font-size:12px;"></div>
      </div>
    ` : '';

    view.innerHTML = controlsHtml + `<div style="font-size:12px; color:var(--plum-soft); margin-bottom:10px;">${filtered.length} item${filtered.length===1?'':'s'}</div>` + cardsHtml + (bulkSelectMode ? `<div style="height:140px;"></div>` : '') + bulkBarHtml;
    wireCatalogControls();
  }

  function wireCatalogControls(){
    const searchInput = document.getElementById('searchInput');
    if (searchInput){
      searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        const cursorPos = e.target.selectionStart;
        renderCatalog();
        const newInput = document.getElementById('searchInput');
        if (newInput){ newInput.focus(); newInput.setSelectionRange(cursorPos, cursorPos); }
      });
    }
    const filterToggleBtn = document.getElementById('filterToggleBtn');
    const filterPanel = document.getElementById('filterPanel');
    if (filterToggleBtn && filterPanel){
      renderFilterPanel();
      filterToggleBtn.addEventListener('click', () => {
        filterPanelOpen = !filterPanelOpen;
        filterPanel.classList.toggle('open', filterPanelOpen);
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

    const draftsBanner = document.getElementById('draftsBanner');
    if (draftsBanner){
      draftsBanner.addEventListener('click', () => {
        draftsPanelOpen = !draftsPanelOpen;
        renderCatalog();
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
          if (item) openPrintLabelModal(item);
          return;
        }
        // If tapped on the photo area with gallery data, open lightbox
        const galleryEl = e.target.closest('[data-gallery]');
        if (galleryEl){
          const item = items.find(i => i.id === galleryEl.dataset.gallery);
          if (item && item.photos && item.photos.length > 0){
            // Temporarily set lightbox photos to this item's photos
            lightboxPhotos = [...item.photos];
            lightboxIndex = 0;
            document.getElementById('lightboxOverlay').classList.remove('hidden');
            renderLightbox();
            document.body.style.overflow = 'hidden';
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
        bulkApplyStatusBtn.disabled = true;
        bulkStatus(`Updating ${ids.length} item${ids.length===1?'':'s'}…`);
        for (const id of ids){
          const item = items.find(i => i.id === id);
          if (!item) continue;
          const updated = { ...item, status: newStatus };
          if (newStatus === 'vendido' && item.status !== 'vendido'){
            const soldPrice = parseFloat(item.listPrice) || suggestPrice(item);
            const feesTotal = platformFee(item.platform || 'ebay', soldPrice);
            updated.soldPrice = soldPrice;
            updated.shippingCost = updated.shippingCost || 0;
            // No per-item picker makes sense in a bulk action — defaults to
            // the item's general platform field; she can correct it per-item
            // afterward via the "Sold on" field if it actually sold elsewhere.
            updated.soldPlatform = item.soldPlatform || item.platform || 'ebay';
            updated.feesTotal = feesTotal;
            updated.soldAt = item.soldAt || Date.now();
            updated.netProfit = soldPrice - (parseFloat(item.cost)||0) - feesTotal - (updated.shippingCost||0);
          }
          const idx = items.findIndex(i => i.id === id);
          if (idx >= 0) items[idx] = updated;
          try{
            await saveItem(updated);
            if (newStatus === 'vendido') endEbayListingIfSold(updated); // best-effort
          }catch(e){ /* saveItem already alerts */ }
        }
        bulkSelectedIds.clear();
        bulkSelectMode = false;
        renderAll();
        showSavedToast();
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
          items = items.filter(i => i.id !== id);
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
  }

  function escapeHtml(s){
    return (s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // Capitalizes just the first letter of each word — deliberately leaves the
  // rest of each word untouched (doesn't force lowercase) so things like
  // "iPhone" or "USB-C" already in the name aren't mangled.
  function toTitleCase(s){
    return (s || '').replace(/\S+/g, w => w.charAt(0).toUpperCase() + w.slice(1));
  }

  // ---------- RENDER: FINANCE ----------
  function renderFinance(){
    const view = document.getElementById('financeView');
    const sold = items.filter(i => i.status === 'vendido');
    if (sold.length === 0){
      view.innerHTML = `<div class="empty-state">
        <div class="big">🌿</div>
        <div class="serif-line">Nothing sold just yet.</div>
        <p>Mark an item as "Sold" and your monthly financial summary will show up here.</p>
      </div>`;
      return;
    }
    const byMonth = {};
    sold.forEach(i => {
      const d = new Date(i.soldAt || i.createdAt);
      const key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
      if (!byMonth[key]) byMonth[key] = [];
      byMonth[key].push(i);
    });
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const sortedKeys = Object.keys(byMonth).sort().reverse();

    view.innerHTML = sortedKeys.map(key => {
      const [y,m] = key.split('-');
      const list = byMonth[key];
      const revenue = list.reduce((s,i)=> s + (parseFloat(i.soldPrice)||0), 0);
      const cost = list.reduce((s,i)=> s + (parseFloat(i.cost)||0), 0);
      const fees = list.reduce((s,i)=> s + (i.feesTotal||0), 0);
      const shipping = list.reduce((s,i)=> s + (parseFloat(i.shippingCost)||0), 0);
      const profit = revenue - cost - fees - shipping;
      const margin = revenue > 0 ? (profit/revenue*100) : 0;

      return `<div class="month-card">
        <h3>${monthNames[parseInt(m)-1]} ${y} · ${list.length} ${list.length===1?'item sold':'items sold'}</h3>
        <div class="fin-grid">
          <div class="fin-item"><div class="label">Gross revenue</div><div class="value">$${revenue.toFixed(2)}</div></div>
          <div class="fin-item cost"><div class="label">Acquisition cost</div><div class="value">$${cost.toFixed(2)}</div></div>
          <div class="fin-item cost"><div class="label">Platform fees</div><div class="value">$${fees.toFixed(2)}</div></div>
          <div class="fin-item cost"><div class="label">Shipping paid</div><div class="value">$${shipping.toFixed(2)}</div></div>
          <div class="fin-item highlight"><div class="label">Net profit</div><div class="value">$${profit.toFixed(2)}</div></div>
          <div class="fin-item highlight"><div class="label">Net margin</div><div class="value">${margin.toFixed(1)}%</div></div>
        </div>
      </div>`;
    }).join('');
  }

  // ---------- RENDER: REPORTS ----------
  function renderReports(){
    const view = document.getElementById('reportsView');
    const sold = items.filter(i => i.status === 'vendido');
    const active = items.filter(i => i.status !== 'vendido');

    const byCat = {};
    sold.forEach(i => {
      const c = i.category || 'Other';
      if (!byCat[c]) byCat[c] = [];
      byCat[c].push(i);
    });
    const catRows = Object.keys(byCat).map(c => {
      const list = byCat[c];
      const revenue = list.reduce((s,i)=> s + (parseFloat(i.soldPrice)||0), 0);
      const profit = list.reduce((s,i)=> s + (i.netProfit||0), 0);
      const avgDaysToSell = list.reduce((s,i)=> s + (daysToSell(i)||0), 0) / list.length;
      return { cat:c, count:list.length, revenue, profit, avgDaysToSell, margin: revenue>0 ? profit/revenue*100 : 0 };
    }).sort((a,b)=> b.profit - a.profit);

    // Projected pipeline by category (active, not-yet-sold items)
    const byCatActive = {};
    active.forEach(i => {
      const c = i.category || 'Other';
      if (!byCatActive[c]) byCatActive[c] = [];
      byCatActive[c].push(i);
    });
    const projectedRows = Object.keys(byCatActive).map(c => {
      const list = byCatActive[c];
      const projected = list.reduce((s,i)=> s + projectedProfit(i), 0);
      return { cat:c, count:list.length, projected };
    }).sort((a,b)=> b.projected - a.projected);
    const totalProjected = active.reduce((s,i)=> s + projectedProfit(i), 0);

    const topItemsByProfit = [...sold].sort((a,b)=> (b.netProfit||0) - (a.netProfit||0)).slice(0,5);
    const topProjectedItems = [...active].sort((a,b)=> projectedProfit(b) - projectedProfit(a)).slice(0,5);
    // Uses ebayListedAt (when it actually went live on eBay), not
    // createdAt (when it was first cataloged) — those can be weeks apart,
    // and days-since-cataloged was misleading here before.
    const slowMovers = items.filter(i => i.ebayListingId && i.status !== 'vendido' && i.ebayListedAt && daysSince(i.ebayListedAt) >= 30)
      .sort((a,b)=> daysSince(b.ebayListedAt) - daysSince(a.ebayListedAt));

    let html = '';

    html += `<div class="export-section">
      <div class="es-label">Export data</div>
      <div class="export-btn-grid">
        <div class="export-btn" id="exportExcel">
          <div><div class="et-title">📊 Export to Excel (.xlsx)</div><div class="et-sub">Same format as her original Clothing Inventory Tracker — ready to open in Excel</div></div>
          <div class="et-arrow">↓</div>
        </div>
        <div class="export-btn" id="exportFullInventory">
          <div><div class="et-title">Full inventory (CSV)</div><div class="et-sub">Every item, every status — for backup or spreadsheet work</div></div>
          <div class="et-arrow">↓</div>
        </div>
        <div class="export-btn" id="exportSoldOnly">
          <div><div class="et-title">Sold items only (CSV)</div><div class="et-sub">Great for taxes or bookkeeping</div></div>
          <div class="et-arrow">↓</div>
        </div>
        <div class="export-btn" id="exportCategoryReport">
          <div><div class="et-title">Performance by category (CSV)</div><div class="et-sub">See what's worth sourcing more of</div></div>
          <div class="et-arrow">↓</div>
        </div>
      </div>
    </div>`;

    if (active.length > 0){
      html += `<div class="cat-card pipeline-card">
        <h3>Projected pipeline</h3>
        <div class="sub" style="margin-bottom:10px;">What's still on the shelf, estimated at today's suggested or listed prices, after fees and shipping.</div>
        <div class="pipeline-total">$${totalProjected.toFixed(2)} <span>across ${active.length} active item${active.length===1?'':'s'}</span></div>
        ${projectedRows.map(r => `
          <div class="cat-rank-row">
            <div>
              <div class="name">${escapeHtml(r.cat)}</div>
              <div class="sub">${r.count} item${r.count===1?'':'s'} not yet sold</div>
            </div>
            <div class="num projected-num">$${r.projected.toFixed(0)}</div>
          </div>
        `).join('')}
      </div>`;
    }

    if (catRows.length > 0){
      html += `<div class="cat-card">
        <h3>Category performance</h3>
        <div class="sub" style="margin-bottom:6px;">Realized profit from items already sold.</div>
        ${catRows.map(r => {
          const proj = projectedRows.find(p => p.cat === r.cat);
          return `
          <div class="cat-rank-row">
            <div>
              <div class="name">${escapeHtml(r.cat)}</div>
              <div class="sub">${r.count} sold · avg ${r.avgDaysToSell.toFixed(0)}d to sell · ${r.margin.toFixed(0)}% margin${proj ? ` · $${proj.projected.toFixed(0)} more projected` : ''}</div>
            </div>
            <div class="num">$${r.profit.toFixed(0)}</div>
          </div>
        `;}).join('')}
      </div>`;
    }

    if (topProjectedItems.length > 0){
      html += `<div class="cat-card">
        <h3>Biggest upside waiting to sell</h3>
        ${topProjectedItems.map(i => `
          <div class="cat-rank-row">
            <div>
              <div class="name">${escapeHtml(i.name)}</div>
              <div class="sub">${escapeHtml(i.category||'')}${i.brand ? ' · '+escapeHtml(i.brand) : ''} · ${statusLabel(i.status)}</div>
            </div>
            <div class="num projected-num">$${projectedProfit(i).toFixed(2)}</div>
          </div>
        `).join('')}
      </div>`;
    }

    if (topItemsByProfit.length > 0){
      html += `<div class="cat-card">
        <h3>Best earners</h3>
        ${topItemsByProfit.map(i => `
          <div class="cat-rank-row">
            <div>
              <div class="name">${escapeHtml(i.name)}</div>
              <div class="sub">${escapeHtml(i.category||'')}${i.brand ? ' · '+escapeHtml(i.brand) : ''}</div>
            </div>
            <div class="num">$${(i.netProfit||0).toFixed(2)}</div>
          </div>
        `).join('')}
      </div>`;
    }

    if (slowMovers.length > 0){
      html += `<div class="cat-card">
        <h3>Stale eBay listings (30+ days, unsold)</h3>
        <div class="sub" style="margin-bottom:10px;">Still live and hasn't sold — worth a price drop, refreshed photos, or a Best Offer.</div>
        ${slowMovers.map(i => `
          <div class="cat-rank-row" data-open-item="${i.id}" style="cursor:pointer;">
            <div>
              <div class="name">${escapeHtml(i.name)}</div>
              <div class="sub">${escapeHtml(i.category||'')} · listed at $${(parseFloat(i.listPrice)||0).toFixed(2)}</div>
            </div>
            <div class="num" style="color:var(--amber-deep);">${daysSince(i.ebayListedAt)}d</div>
          </div>
        `).join('')}
      </div>`;
    }

    if (sold.length === 0 && catRows.length === 0 && slowMovers.length === 0 && active.length === 0){
      html += `<div class="empty-state">
        <div class="big">📊</div>
        <div class="serif-line">Reports build themselves as you go.</div>
        <p>Once you've cataloged and sold a few pieces, performance insights will show up here.</p>
      </div>`;
    }

    view.innerHTML = html;
    wireReportButtons();
    view.querySelectorAll('[data-open-item]').forEach(row => {
      row.addEventListener('click', () => {
        const item = items.find(i => i.id === row.dataset.openItem);
        if (item){ switchToTab('catalog'); openModal(item); }
      });
    });
  }

  function daysToSell(item){
    if (!item.soldAt || !item.createdAt) return null;
    return Math.floor((item.soldAt - item.createdAt) / 86400000);
  }

  // ---------- CSV EXPORT ----------
  function csvEscape(val){
    const s = String(val ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')){
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function downloadCsv(filename, rows){
    const allRows = [...rows, [], [`Exported from Calculated Chaos ${APP_VERSION} (${APP_VERSION_DATE})`]];
    const csv = allRows.map(row => row.map(csvEscape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function wireReportButtons(){
    // ---- Excel export (matches original Clothing Inventory Tracker format) ----
    const excelBtn = document.getElementById('exportExcel');
    if (excelBtn) excelBtn.addEventListener('click', async () => {
      excelBtn.querySelector('.et-title').textContent = '📊 Generating Excel…';
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

        // ---------- Clothing Inventory sheet ----------
        const clothingItems = items.filter(i => i.category === 'Clothing' || i.category === 'Shoes' || i.category === 'Accessories');
        const clothingHeader = ['Purchase ID','Purchase Date','Listed Date','Source','Brand','Gender','Size','Color','Type','Used/New','Category','Qty Purchased','Purchase Cost','Tax / Fees','Total Cost','Cost Per Unit','Listed Price','Status','Listing Title','Receipt / Link'];
        const clothingRows = clothingItems.map(i => [
          i.sourcePurchaseId || i.productCode || '',
          i.createdAt ? new Date(i.createdAt).toLocaleDateString('en-US') : '',
          i.soldAt ? new Date(i.soldAt).toLocaleDateString('en-US') : '',
          i.sourceImport || 'Calculated Chaos',
          i.brand || '',
          i.gender || '',
          i.size || '',
          i.color || '',
          i.clothingType || i.name || '',
          CONDITION_LABEL[i.condition] ? (i.condition.includes('novo') ? 'New' : 'Used') : 'Used',
          i.category || '',
          1,  // Qty
          i.cost || '',
          '', // Tax
          i.cost || '',
          i.cost || '',
          i.listPrice || '',
          statusLabel(i.status),
          i.name || '',
          ''
        ]);
        const clothingWs = XLSX.utils.aoa_to_sheet([clothingHeader, ...clothingRows]);
        clothingWs['!cols'] = clothingHeader.map(h => ({ wch: Math.max(h.length + 2, 14) }));
        XLSX.utils.book_append_sheet(wb, clothingWs, 'Clothing Inventory');

        // ---------- Household/Misc sheet ----------
        const householdItems = items.filter(i => !['Clothing','Shoes','Accessories'].includes(i.category));
        const householdHeader = ['Purchase ID','Purchase Date','Listed Date','Source','Brand','Product','New/ Vintage/Antique','Category','Qty Purchased','Purchase Cost','Tax / Fees','Total Cost','Cost Per Unit','Listed Price','Status','Listing Title','Receipt / Link'];
        const householdRows = householdItems.map(i => [
          i.sourcePurchaseId || i.productCode || '',
          i.createdAt ? new Date(i.createdAt).toLocaleDateString('en-US') : '',
          i.soldAt ? new Date(i.soldAt).toLocaleDateString('en-US') : '',
          i.sourceImport || 'Calculated Chaos',
          i.brand || '',
          i.name || '',
          CONDITION_LABEL[i.condition] ? (i.condition.includes('novo') ? 'New' : 'Used') : 'Used',
          i.category || '',
          1,
          i.cost || '',
          '',
          i.cost || '',
          i.cost || '',
          i.listPrice || '',
          statusLabel(i.status),
          i.name || '',
          ''
        ]);
        const householdWs = XLSX.utils.aoa_to_sheet([householdHeader, ...householdRows]);
        householdWs['!cols'] = householdHeader.map(h => ({ wch: Math.max(h.length + 2, 14) }));
        XLSX.utils.book_append_sheet(wb, householdWs, 'HouseholdMisc. Inventory');

        // ---------- All items (extended) sheet ----------
        const allHeader = ['Product Code','Storage Box','Source','Name','Category','Brand','Gender','Size','Color','Condition','Status','Prep Status','Cost ($)','List Price ($)','Sold Price ($)','Net Profit ($)','Projected Profit ($)','Platform','Listed On','Weight (lb)','Length (in)','Width (in)','Height (in)','Days in Catalog','Notes','Photo Count'];
        const allRows = items.map(i => [
          i.productCode || '',
          i.storageBox || '',
          i.source || '',
          i.name || '',
          i.category || '',
          i.brand || '',
          i.gender || '',
          i.size || '',
          i.color || '',
          CONDITION_LABEL[i.condition] || i.condition || '',
          statusLabel(i.status),
          PREP_LABEL[i.prep] || i.prep || '',
          i.cost || '',
          i.listPrice || '',
          i.soldPrice || '',
          i.netProfit !== undefined ? parseFloat(i.netProfit).toFixed(2) : '',
          i.status !== 'vendido' ? projectedProfit(i).toFixed(2) : '',
          i.platform || '',
          (i.listedPlatforms || []).join(', '),
          i.weight || '',
          i.length || '',
          i.width || '',
          i.height || '',
          daysSince(i.createdAt),
          i.notes || '',
          (i.photos || []).length
        ]);
        const allWs = XLSX.utils.aoa_to_sheet([allHeader, ...allRows]);
        allWs['!cols'] = allHeader.map(h => ({ wch: Math.max(h.length + 2, 12) }));
        XLSX.utils.book_append_sheet(wb, allWs, 'All Items (Calculated Chaos)');

        XLSX.writeFile(wb, `Clothing_Inventory_Tracker_${new Date().toISOString().slice(0,10)}.xlsx`);
      }catch(err){
        console.error('Excel export error', err);
        alert('Could not generate Excel file. Please try the CSV export instead.');
      }finally{
        excelBtn.querySelector('.et-title').textContent = '📊 Export to Excel (.xlsx)';
      }
    });

    const fullBtn = document.getElementById('exportFullInventory');
    if (fullBtn) fullBtn.addEventListener('click', () => {
      const header = ['Name','Category','Brand','Condition','Status','Cost','Weight(lb)','Length(in)','Width(in)','Height(in)','List Price','Sold Price','Platform','Projected Profit','Net Profit','Days in Catalog','Notes','Photo Count'];
      const rows = [header, ...items.map(i => [
        i.name, i.category, i.brand, CONDITION_LABEL[i.condition]||i.condition, statusLabel(i.status),
        i.cost, i.weight, i.length, i.width, i.height,
        i.listPrice, i.soldPrice||'', i.platform,
        i.status !== 'vendido' ? projectedProfit(i).toFixed(2) : '',
        i.netProfit!==undefined ? i.netProfit.toFixed(2) : '',
        daysSince(i.createdAt), i.notes, (i.photos||[]).length
      ])];
      downloadCsv('calculated-chaos-full-inventory.csv', rows);
    });

    const soldBtn = document.getElementById('exportSoldOnly');
    if (soldBtn) soldBtn.addEventListener('click', () => {
      const sold = items.filter(i => i.status === 'vendido');
      const header = ['Name','Category','Brand','Sold Price','Cost','Platform Fees','Shipping Paid','Net Profit','Platform','Date Sold','Days to Sell'];
      const rows = [header, ...sold.map(i => [
        i.name, i.category, i.brand, i.soldPrice, i.cost, i.feesTotal, i.shippingCost,
        i.netProfit!==undefined ? i.netProfit.toFixed(2) : '', i.platform,
        i.soldAt ? new Date(i.soldAt).toLocaleDateString('en-US') : '', daysToSell(i) ?? ''
      ])];
      downloadCsv('calculated-chaos-sold-items.csv', rows);
    });

    const catBtn = document.getElementById('exportCategoryReport');
    if (catBtn) catBtn.addEventListener('click', () => {
      const sold = items.filter(i => i.status === 'vendido');
      const active = items.filter(i => i.status !== 'vendido');
      const byCat = {};
      sold.forEach(i => {
        const c = i.category || 'Other';
        if (!byCat[c]) byCat[c] = [];
        byCat[c].push(i);
      });
      const byCatActive = {};
      active.forEach(i => {
        const c = i.category || 'Other';
        if (!byCatActive[c]) byCatActive[c] = [];
        byCatActive[c].push(i);
      });
      const allCats = Array.from(new Set([...Object.keys(byCat), ...Object.keys(byCatActive)]));
      const header = ['Category','Items Sold','Total Revenue','Realized Profit','Avg Margin %','Avg Days to Sell','Active Items','Projected Profit (Active)'];
      const rows = [header, ...allCats.map(c => {
        const list = byCat[c] || [];
        const activeList = byCatActive[c] || [];
        const revenue = list.reduce((s,i)=> s + (parseFloat(i.soldPrice)||0), 0);
        const profit = list.reduce((s,i)=> s + (i.netProfit||0), 0);
        const avgDays = list.length ? list.reduce((s,i)=> s + (daysToSell(i)||0), 0) / list.length : 0;
        const projected = activeList.reduce((s,i)=> s + projectedProfit(i), 0);
        return [c, list.length, revenue.toFixed(2), profit.toFixed(2), (revenue>0?profit/revenue*100:0).toFixed(1), avgDays.toFixed(1), activeList.length, projected.toFixed(2)];
      })];
      downloadCsv('calculated-chaos-category-performance.csv', rows);
    });
  }

  function renderVersionBadge(){
    document.getElementById('versionBadge').textContent = `${APP_VERSION} · ${APP_VERSION_DATE}`;
    const refreshBtn = document.getElementById('appRefreshBtn');
    if (refreshBtn){
      refreshBtn.addEventListener('click', () => {
        // Force a real reload from the server (bypass cache) so a stale
        // cached copy of the app never gets "refreshed" into itself.
        window.location.reload(true);
      });
    }
    // Always-visible log out button (header, every tab) — the one buried at
    // the top of Settings was easy to miss, this is the same signOut call
    // just reachable without navigating there first.
    const headerLogOutBtn = document.getElementById('headerLogOutBtn');
    if (headerLogOutBtn){
      headerLogOutBtn.addEventListener('click', async () => {
        if (!confirm('Log out of Calculated Chaos?')) return;
        await window.authFns.signOut(window.auth);
      });
    }
  }

  function renderAll(){
    renderVersionBadge();
    renderDailyQuote();
    renderStats();
    renderCatalog();
    renderFinance();
    renderReports();
  }

  // ---------- TABS ----------
  function switchToTab(tab){
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.getElementById('catalogView').style.display = tab === 'catalog' ? 'block' : 'none';
    document.getElementById('financeView').style.display = tab === 'finance' ? 'block' : 'none';
    document.getElementById('reportsView').style.display = tab === 'reports' ? 'block' : 'none';
    document.getElementById('settingsView').style.display = tab === 'settings' ? 'block' : 'none';
    if (tab === 'settings') renderSettings();
  }
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchToTab(btn.dataset.tab));
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
      loadEbayAspectsForCategory(cat.id);
    } else {
      currentEbayAspects = {};
      document.getElementById('ebayAspectsContainer').innerHTML = '';
    }
  }

  // ---------- EBAY ITEM SPECIFICS (category-specific required aspects) ----------
  // Fields our own form already covers and sends automatically at publish
  // time (see api/ebay-list.js) — never shown here, would just be a
  // confusing duplicate of Brand/Color/Size/Gender above.
  const EBAY_ASPECTS_AUTO_COVERED = ['Department', 'Brand', 'Color', 'Size'];
  let currentEbayAspects = {}; // { "Pattern": "Floral", "Material": "Cotton", ... } — her real answers, saved on the item

  async function loadEbayAspectsForCategory(categoryId){
    const container = document.getElementById('ebayAspectsContainer');
    container.innerHTML = `<div style="font-size:12px; opacity:0.6;">Checking what this category requires…</div>`;
    try{
      const token = await getValidEbayToken();
      if (!token){ container.innerHTML = ''; return; }
      const idToken = await window.auth.currentUser.getIdToken();
      const res = await fetch('/api/ebay-item-aspects', {
        method: 'POST',
        headers: {'Content-Type':'application/json', 'Authorization': `Bearer ${idToken}`},
        body: JSON.stringify({ access_token: token, category_id: categoryId })
      });
      const data = await res.json();
      if (!data.success){ container.innerHTML = ''; return; }
      const needed = data.aspects.filter(a => a.required && !EBAY_ASPECTS_AUTO_COVERED.includes(a.name));
      renderEbayAspectsFields(needed);
    }catch(e){
      console.warn('eBay aspects lookup failed:', e);
      container.innerHTML = '';
    }
  }

  function renderEbayAspectsFields(neededAspects){
    const container = document.getElementById('ebayAspectsContainer');
    if (!neededAspects.length){ container.innerHTML = ''; return; }
    container.innerHTML = `
      <div style="font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; color:var(--plum-soft); margin-bottom:6px;">This eBay category also requires:</div>
      ${neededAspects.map(a => `
        <div style="margin-bottom:8px;">
          <label style="font-size:12px; font-weight:600; color:var(--plum); display:block; margin-bottom:3px;">${escapeHtml(a.name)}</label>
          ${a.selectionOnly && a.allowedValues.length ? `
            <select data-aspect="${escapeHtml(a.name)}" style="width:100%; padding:9px 10px; border:1px solid var(--line); border-radius:8px; font-size:13px;">
              <option value="">—</option>
              ${a.allowedValues.map(v => `<option value="${escapeHtml(v)}" ${currentEbayAspects[a.name]===v?'selected':''}>${escapeHtml(v)}</option>`).join('')}
            </select>
          ` : `
            <input type="text" data-aspect="${escapeHtml(a.name)}" value="${escapeHtml(currentEbayAspects[a.name] || '')}" style="width:100%; padding:9px 10px; border:1px solid var(--line); border-radius:8px; font-size:13px;">
          `}
        </div>
      `).join('')}
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
      const token = await getValidEbayToken();
      if (!token) return null;
      const res = await fetch('/api/ebay-condition-policies', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ access_token: token, category_id: categoryId })
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
      const token = await getValidEbayToken();
      if (!token){
        resultsEl.innerHTML = '<div style="font-size:12px; color:var(--danger);">Connect your eBay account (Settings) to search categories.</div>';
        return;
      }
      const res = await fetch('/api/ebay-category-search', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ access_token: token, query: q })
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

  function openModal(item, isDuplicate){
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
    } else {
      fillNextProductCode(document.getElementById('fProductCode'));
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
    currentEbayAspects = (item && !isDuplicate && item.ebayAspects) ? { ...item.ebayAspects } : {};
    setChosenEbayCategory((item && item.ebayCategoryId)
      ? { id: item.ebayCategoryId, path: item.ebayCategoryPath || item.ebayCategoryId, validConditions: item.ebayValidConditions || null }
      : carryOverCategory);
    document.getElementById('fBrand').value = item?.brand || '';
    document.getElementById('fGender').value = item?.gender || '';
    document.getElementById('fSize').value = item?.size || '';
    document.getElementById('fCondition').value = item?.condition || 'excelente';
    document.getElementById('fCost').value = item?.cost || '';
    document.getElementById('fWeight').value = item?.weight || '';
    document.getElementById('fLen').value = item?.length || '';
    document.getElementById('fWid').value = item?.width || '';
    document.getElementById('fHei').value = item?.height || '';
    if ((!item || isDuplicate) && getCategoryValue() === 'Clothing'){
      applyDefaultClothingShippingIfEmpty();
    }
    document.getElementById('fNotes').value = item?.notes || '';
    document.getElementById('fListPrice').value = isDuplicate ? '' : (item?.listPrice || '');
    document.getElementById('fPlatform').value = item?.platform || 'ebay';
    updateListingGeneratorUI();
    const itemFreeShipping = item?.freeShipping !== undefined ? item.freeShipping : appSettings.sellerPaysShipping;
    document.getElementById('fFreeShipping').value = itemFreeShipping ? 'seller' : 'buyer';
    document.getElementById('suggestionArea').innerHTML = '';
    document.getElementById('listingOutputArea').innerHTML = '';
    document.getElementById('aiAnalysisArea').innerHTML = '';
    document.getElementById('ebayStatusArea').innerHTML = '';
    setSaveProgress(null);
    document.getElementById('deleteItemBtn').style.display = (item && !isDuplicate) ? 'block' : 'none';
    document.getElementById('duplicateItemBtn').style.display = (item && !isDuplicate) ? 'block' : 'none';

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
    const modalScrollEl = document.querySelector('#itemModalOverlay .modal');
    if (modalScrollEl) modalScrollEl.scrollTop = 0;
    const backToTopBtn = document.getElementById('modalBackToTop');
    if (backToTopBtn) backToTopBtn.style.display = 'none';
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
      toast.style.cssText = 'position:fixed; left:50%; bottom:28px; transform:translateX(-50%); background:var(--plum, #3D2C32); color:white; padding:11px 20px; border-radius:999px; font-size:13px; font-weight:600; box-shadow:0 6px 18px rgba(0,0,0,0.25); z-index:9999; opacity:0; transition:opacity 0.25s ease;';
      document.body.appendChild(toast);
    }
    toast.textContent = '✓ Item saved';
    toast.style.opacity = '1';
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => { toast.style.opacity = '0'; }, 2000);
  }

  // ---------- THERMAL LABEL PRINTING ----------
  // Builds the label's inner markup (code / box / secondary line), sized in
  // CSS "in" units so the exact same markup looks right both in the on-screen
  // preview and on the physical label (1in == 96px on screen, and an actual
  // inch when printed — no separate scale math needed).
  function buildLabelInnerHtml(item){
    const fields = appSettings.labelFields || {};
    const secondaryParts = [];
    if (fields.name !== false && item.name) secondaryParts.push(item.name);
    if (fields.category && item.category) secondaryParts.push(item.category);
    if (fields.brand && item.brand) secondaryParts.push(item.brand);
    const secondary = secondaryParts.join(' · ');

    return `
      <div class="label-code">${escapeHtml(item.productCode || '')}</div>
      ${fields.box !== false && item.storageBox ? `<div class="label-box">📦 ${escapeHtml(item.storageBox)}</div>` : ''}
      ${secondary ? `<div class="label-secondary">${escapeHtml(secondary)}</div>` : ''}
    `;
  }

  // Wall marker: a crosshair with a small empty gap at the center (so the
  // ideal tap point is the gap's geometric center, not a blurry printed
  // intersection) plus an alignment tick above the top arm for mounting the
  // label level on the wall. Plain rects + one stroked circle — no roundRect.
  function markerGeometry(w, h){
    const minDim = Math.min(w, h);
    const armLen = minDim * 0.32;
    const gapR = armLen * 0.24;
    const thick = Math.max(0.018, minDim * 0.03);
    const tickLen = armLen * 0.55;
    const tickGap = armLen * 0.12;
    return { cx: w / 2, cy: h / 2, armLen, gapR, thick, tickLen, tickGap };
  }

  function buildMarkerInnerHtml(w, h){
    const { cx, cy, armLen, gapR, thick, tickLen, tickGap } = markerGeometry(w, h);
    const color = '#3D2C32';
    const bar = (left, top, width, height) =>
      `<div style="position:absolute; left:${left}in; top:${top}in; width:${width}in; height:${height}in; background:${color};"></div>`;
    return `
      <div style="position:relative; width:${w}in; height:${h}in;">
        ${bar(cx - thick / 2, cy - gapR - armLen, thick, armLen)}
        ${bar(cx - thick / 2, cy + gapR, thick, armLen)}
        ${bar(cx - gapR - armLen, cy - thick / 2, armLen, thick)}
        ${bar(cx + gapR, cy - thick / 2, armLen, thick)}
        ${bar(cx - thick / 2, cy - gapR - armLen - tickGap - tickLen, thick, tickLen)}
        <div style="position:absolute; left:${cx - gapR}in; top:${cy - gapR}in; width:${gapR * 2}in; height:${gapR * 2}in; border-radius:50%; border:${thick * 0.6}in solid ${color}; box-sizing:border-box;"></div>
      </div>
    `;
  }

  function drawMarkerToCanvas(w, h){
    const dpi = 300;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * dpi);
    canvas.height = Math.round(h * dpi);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFDFA';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const g = markerGeometry(w, h);
    const cx = g.cx * dpi, cy = g.cy * dpi;
    const armLen = g.armLen * dpi, gapR = g.gapR * dpi, thick = g.thick * dpi;
    const tickLen = g.tickLen * dpi, tickGap = g.tickGap * dpi;
    const color = '#3D2C32';

    ctx.fillStyle = color;
    ctx.fillRect(cx - thick / 2, cy - gapR - armLen, thick, armLen);
    ctx.fillRect(cx - thick / 2, cy + gapR, thick, armLen);
    ctx.fillRect(cx - gapR - armLen, cy - thick / 2, armLen, thick);
    ctx.fillRect(cx + gapR, cy - thick / 2, armLen, thick);
    ctx.fillRect(cx - thick / 2, cy - gapR - armLen - tickGap - tickLen, thick, tickLen);

    ctx.strokeStyle = color;
    ctx.lineWidth = thick * 0.6;
    ctx.beginPath();
    ctx.arc(cx, cy, gapR, 0, Math.PI * 2);
    ctx.stroke();

    return canvas;
  }

  // Renders the same label content to a canvas (plain fillText/fillRect only —
  // no roundRect) so it can be saved as a PNG. Needed for phones, where this
  // printer has no OS print driver and can only be used through its own app
  // (FlashLabel Pro) — she opens the saved image there to print it.
  function drawLabelToCanvas(item){
    const w = appSettings.labelWidthIn || 2.25;
    const h = appSettings.labelHeightIn || 1.25;
    const dpi = 300;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * dpi);
    canvas.height = Math.round(h * dpi);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFDFA';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const maxWidth = canvas.width - (w * 0.16 * dpi);

    function fitFontIn(text, family, weight, maxFontIn, minFontIn){
      let fontIn = maxFontIn;
      while (fontIn > minFontIn){
        ctx.font = `${weight} ${fontIn * dpi}px ${family}`;
        if (ctx.measureText(text).width <= maxWidth) break;
        fontIn -= 0.02;
      }
      return fontIn;
    }

    const fields = appSettings.labelFields || {};
    const code = item.productCode || '';
    const boxText = (fields.box !== false && item.storageBox) ? ('📦 ' + item.storageBox) : '';
    const secondaryParts = [];
    if (fields.name !== false && item.name) secondaryParts.push(item.name);
    if (fields.category && item.category) secondaryParts.push(item.category);
    if (fields.brand && item.brand) secondaryParts.push(item.brand);
    const secondary = secondaryParts.join(' · ');

    const codeFontIn = fitFontIn(code, "'JetBrains Mono', monospace", 700, Math.min(1.1, h * 0.4), 0.14);
    const boxFontIn = boxText ? fitFontIn(boxText, "'Inter', sans-serif", 700, Math.min(0.55, h * 0.22), 0.1) : 0;
    const secFontIn = 0.11;
    const gapIn = 0.03;

    const totalIn = codeFontIn + (boxText ? gapIn + boxFontIn : 0) + (secondary ? gapIn + secFontIn : 0);
    let curY = ((h - totalIn) / 2 + codeFontIn / 2) * dpi;

    ctx.fillStyle = '#3D2C32';
    ctx.font = `700 ${codeFontIn * dpi}px 'JetBrains Mono', monospace`;
    ctx.fillText(code, canvas.width / 2, curY);
    curY += (codeFontIn / 2) * dpi;

    if (boxText){
      curY += (gapIn + boxFontIn / 2) * dpi;
      ctx.font = `700 ${boxFontIn * dpi}px 'Inter', sans-serif`;
      ctx.fillText(boxText, canvas.width / 2, curY);
      curY += (boxFontIn / 2) * dpi;
    }

    if (secondary){
      curY += (gapIn + secFontIn / 2) * dpi;
      ctx.font = `500 ${secFontIn * dpi}px 'Inter', sans-serif`;
      ctx.fillStyle = '#6B5760';
      let text = secondary;
      while (ctx.measureText(text).width > maxWidth && text.length > 1){
        text = text.slice(0, -1);
      }
      if (text !== secondary) text = text.slice(0, -1) + '…';
      ctx.fillText(text, canvas.width / 2, curY);
    }

    return canvas;
  }

  // Shrinks an element's font-size (in inches) until it fits its container's
  // width, so long product codes / box names never get cut off mid-character.
  function shrinkToFit(el, maxFontIn, minFontIn){
    if (!el) return;
    let fontIn = maxFontIn;
    el.style.fontSize = fontIn + 'in';
    const container = el.parentElement;
    let guard = 0;
    while (el.scrollWidth > container.clientWidth && fontIn > minFontIn && guard < 60){
      fontIn -= 0.015;
      el.style.fontSize = fontIn.toFixed(3) + 'in';
      guard++;
    }
  }

  let printLabelItem = null;
  let printMode = 'item'; // 'item' | 'marker'

  function openPrintLabelModal(item){
    printMode = 'item';
    printLabelItem = item;
    const w = appSettings.labelWidthIn || 2.25;
    const h = appSettings.labelHeightIn || 1.25;
    const wrap = document.getElementById('labelPreviewWrap');
    wrap.innerHTML = `<div class="label-sheet" style="width:${w}in; height:${h}in;">${buildLabelInnerHtml(item)}</div>`;

    const sheet = wrap.querySelector('.label-sheet');
    const codeEl = sheet.querySelector('.label-code');
    const boxEl = sheet.querySelector('.label-box');
    shrinkToFit(codeEl, Math.min(1.1, h * 0.4), 0.14);
    shrinkToFit(boxEl, Math.min(0.55, h * 0.22), 0.1);

    document.querySelector('#printLabelOverlay h3').textContent = 'Print label';
    document.getElementById('printLabelOverlay').classList.remove('hidden');
  }

  window.openMarkerPrintModal = function(){
    printMode = 'marker';
    printLabelItem = null;
    const w = appSettings.labelWidthIn || 2.25;
    const h = appSettings.labelHeightIn || 1.25;
    const wrap = document.getElementById('labelPreviewWrap');
    wrap.innerHTML = `<div class="label-sheet" style="width:${w}in; height:${h}in; border:none;">${buildMarkerInnerHtml(w, h)}</div>`;

    document.querySelector('#printLabelOverlay h3').textContent = 'Print wall marker';
    document.getElementById('printLabelOverlay').classList.remove('hidden');
  };

  window.openCalibInstructionsModal = function(){
    document.getElementById('calibInstructionsOverlay').classList.remove('hidden');
  };
  document.getElementById('calibInstructionsCloseBtn').addEventListener('click', () => {
    document.getElementById('calibInstructionsOverlay').classList.add('hidden');
  });
  document.getElementById('calibInstructionsOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'calibInstructionsOverlay') e.target.classList.add('hidden');
  });

  function closePrintLabelModal(){
    document.getElementById('printLabelOverlay').classList.add('hidden');
    printLabelItem = null;
  }

  document.getElementById('labelPrintCancelBtn').addEventListener('click', closePrintLabelModal);
  document.getElementById('printLabelOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'printLabelOverlay') closePrintLabelModal();
  });

  document.getElementById('labelPrintBtn').addEventListener('click', () => {
    if (printMode === 'item' && !printLabelItem) return;
    const w = appSettings.labelWidthIn || 2.25;
    const h = appSettings.labelHeightIn || 1.25;

    // Set the physical page size to match the configured label so the
    // thermal printer doesn't get sent a full-sheet page.
    let pageStyle = document.getElementById('dynamicLabelPageStyle');
    if (!pageStyle){
      pageStyle = document.createElement('style');
      pageStyle.id = 'dynamicLabelPageStyle';
      document.head.appendChild(pageStyle);
    }
    pageStyle.textContent = `@page{ size: ${w}in ${h}in; margin: 0; }`;

    // Reuse the already-fitted markup from the preview so the printed
    // label matches exactly what was just shown.
    const previewSheet = document.querySelector('#labelPreviewWrap .label-sheet');
    const printContent = document.getElementById('labelPrintContent');
    printContent.innerHTML = `<div class="label-sheet" style="width:${w}in; height:${h}in;">${previewSheet.innerHTML}</div>`;

    closePrintLabelModal();
    document.body.classList.add('printing-label');
    window.print();
  });

  document.getElementById('labelSaveImgBtn').addEventListener('click', async () => {
    if (printMode === 'item' && !printLabelItem) return;
    try{ await document.fonts.ready; }catch(e){}
    const w = appSettings.labelWidthIn || 2.25;
    const h = appSettings.labelHeightIn || 1.25;
    const canvas = printMode === 'marker'
      ? drawMarkerToCanvas(w, h)
      : drawLabelToCanvas(printLabelItem);
    const filename = printMode === 'marker'
      ? 'wall-marker.png'
      : `${(printLabelItem.productCode || 'label').replace(/[^a-z0-9-_]/gi, '_')}.png`;

    canvas.toBlob(async (blob) => {
      if (!blob) return;

      // iOS Safari (and most mobile browsers) ignore the <a download> attribute
      // on a blob URL — it just opens the image in a new tab, forcing a manual
      // long-press → Save Image. The Web Share API opens the native share sheet
      // instead, which saves (or shares straight into FlashLabel Pro) in one step.
      const file = new File([blob], filename, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })){
        try{
          await navigator.share({ files: [file], title: filename });
          closePrintLabelModal();
          return;
        }catch(e){
          if (e && e.name === 'AbortError') return; // user cancelled the share sheet
          // fall through to the download-link approach below
        }
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      closePrintLabelModal();
    }, 'image/png');
  });

  function exitPrintLabelView(){
    document.body.classList.remove('printing-label');
  }
  document.getElementById('labelPrintExitBtn').addEventListener('click', exitPrintLabelView);
  // 'afterprint' + refocus cover desktop browsers (dialog closes → app
  // restores automatically); the exit button above covers mobile browsers
  // where neither of those reliably fires.
  window.addEventListener('afterprint', exitPrintLabelView);
  window.addEventListener('focus', () => {
    if (document.body.classList.contains('printing-label')) exitPrintLabelView();
  });

  let quickCatalogMode = false;

  document.getElementById('fabAdd').addEventListener('click', () => openModal(null));
  document.getElementById('fabQuickCatalog').addEventListener('click', () => {
    quickCatalogMode = true;
    openModal(null);
  });
  document.getElementById('cancelItemBtn').addEventListener('click', () => { quickCatalogMode = false; currentDraftId = null; closeModal(); });
  document.getElementById('modalCloseX').addEventListener('click', () => { quickCatalogMode = false; currentDraftId = null; closeModal(); });

  // Keyboard shortcuts for the item form — mainly for Quick Catalog, where
  // the whole point is speed and hands ideally never leave the keyboard.
  // Ctrl/Cmd+Enter works from inside any field (including textareas) without
  // interfering with a plain Enter keypress. Esc mirrors the Cancel button
  // exactly (no confirmation today, so this isn't a new risk, just a new way
  // to reach the same action) — skipped while the photo lightbox is open on
  // top of the modal so it doesn't steal Esc from lightbox navigation.
  document.addEventListener('keydown', (e) => {
    if (document.getElementById('itemModalOverlay').classList.contains('hidden')) return;
    if (!document.getElementById('lightboxOverlay').classList.contains('hidden')) return;
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
    if (e.target.value === 'Clothing') applyDefaultClothingShippingIfEmpty();
  });
  // Typing a custom category also gets the chance to trigger the default
  // shipping fill if she types "Clothing" manually via "Add new…" (edge case).
  document.getElementById('fCategoryOther').addEventListener('blur', (e) => {
    if (e.target.value.trim() === 'Clothing') applyDefaultClothingShippingIfEmpty();
  });

  document.getElementById('fName').addEventListener('blur', (e) => {
    if (e.target.value.trim()) e.target.value = toTitleCase(e.target.value.trim());
  });

  document.getElementById('duplicateItemBtn').addEventListener('click', () => {
    const item = items.find(i => i.id === currentEditId);
    if (item) openModal(item, true);
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
        const file = new File([blob], filename, { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })){
          try{ await navigator.share({ files: [file], title: filename }); return; }
          catch(err){ if (err && err.name === 'AbortError') return; }
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
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
    if (pill) setStatusUI(pill.dataset.status);
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
      <div class="field">
        <label>Sold on</label>
        <select id="fSoldPlatform">
          <option value="">—</option>
          ${getAllPlatforms().map(p => `<option value="${p.key}" ${soldPlatformVal===p.key?'selected':''}>${escapeHtml(PLATFORM_NAME[p.key] || p.label)}</option>`).join('')}
        </select>
      </div>
    `;
    attachCurrencyFormatting(['fSoldPrice','fShippingCost']);
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
      openLightbox(parseInt(preview.dataset.idx));
    }
  });

  // ---------- LIGHTBOX ----------
  let lightboxIndex = 0;
  let lightboxPhotos = [];
  let lightboxTouchStartX = 0;

  function openLightbox(startIdx){
    lightboxPhotos = [...currentPhotos];
    lightboxIndex = startIdx;
    document.getElementById('lightboxOverlay').classList.remove('hidden');
    renderLightbox();
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox(){
    document.getElementById('lightboxOverlay').classList.add('hidden');
    document.body.style.overflow = '';
  }

  function renderLightbox(){
    const img = document.getElementById('lightboxImg');
    const counter = document.getElementById('lightboxCounter');
    const prev = document.getElementById('lightboxPrev');
    const next = document.getElementById('lightboxNext');
    const thumbs = document.getElementById('lightboxThumbs');

    img.src = lightboxPhotos[lightboxIndex];
    counter.textContent = `${lightboxIndex + 1} / ${lightboxPhotos.length}`;
    prev.disabled = lightboxIndex === 0;
    next.disabled = lightboxIndex === lightboxPhotos.length - 1;

    thumbs.innerHTML = lightboxPhotos.map((src, i) => `
      <div class="lightbox-thumb ${i === lightboxIndex ? 'active' : ''}" data-thumb="${i}">
        <img src="${src}">
      </div>
    `).join('');

    // Scroll active thumb into view
    const activeThumb = thumbs.querySelector('.lightbox-thumb.active');
    if (activeThumb) activeThumb.scrollIntoView({behavior:'smooth', inline:'center', block:'nearest'});
  }

  document.getElementById('lightboxClose').addEventListener('click', closeLightbox);
  document.getElementById('lightboxOverlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('lightboxOverlay')) closeLightbox();
  });
  document.getElementById('lightboxPrev').addEventListener('click', (e) => {
    e.stopPropagation();
    if (lightboxIndex > 0){ lightboxIndex--; renderLightbox(); }
  });
  document.getElementById('lightboxNext').addEventListener('click', (e) => {
    e.stopPropagation();
    if (lightboxIndex < lightboxPhotos.length - 1){ lightboxIndex++; renderLightbox(); }
  });
  document.getElementById('lightboxThumbs').addEventListener('click', (e) => {
    const thumb = e.target.closest('.lightbox-thumb');
    if (thumb){ lightboxIndex = parseInt(thumb.dataset.thumb); renderLightbox(); }
  });

  // Swipe support for mobile
  document.getElementById('lightboxOverlay').addEventListener('touchstart', (e) => {
    lightboxTouchStartX = e.touches[0].clientX;
  }, {passive:true});
  document.getElementById('lightboxOverlay').addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - lightboxTouchStartX;
    if (Math.abs(dx) < 40) return; // too small
    if (dx < 0 && lightboxIndex < lightboxPhotos.length - 1){ lightboxIndex++; renderLightbox(); }
    if (dx > 0 && lightboxIndex > 0){ lightboxIndex--; renderLightbox(); }
  }, {passive:true});

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    if (document.getElementById('lightboxOverlay').classList.contains('hidden')) return;
    if (e.key === 'ArrowRight' && lightboxIndex < lightboxPhotos.length - 1){ lightboxIndex++; renderLightbox(); }
    if (e.key === 'ArrowLeft' && lightboxIndex > 0){ lightboxIndex--; renderLightbox(); }
    if (e.key === 'Escape') closeLightbox();
  });

  function downloadPhoto(idx){
    const a = document.createElement('a');
    a.href = currentPhotos[idx];
    const nameField = document.getElementById('fName').value || 'item';
    a.download = nameField.replace(/[^a-z0-9]+/gi,'_').toLowerCase() + '_photo_' + (idx+1) + '.jpg';
    document.body.appendChild(a);
    a.click();
    a.remove();
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

  async function analyzeItemPhoto(){
    const btn = document.getElementById('analyzePhotoBtn');
    const area = document.getElementById('aiAnalysisArea');

    if (currentPhotos.length === 0){
      area.innerHTML = `<div class="ai-error">Add at least one photo first — the AI needs something to look at.</div>`;
      return;
    }

    // Check usage limit
    if (aiUsageRemaining() <= 0){
      area.innerHTML = `<div class="ai-error">❌ You've reached your monthly AI analysis limit (${appSettings.aiUsageLimit || 500} analyses). Go to ⚙ Settings to reset the counter.</div>`;
      return;
    }

    btn.disabled = true;
    btn.textContent = '🔮 Analyzing...';
    area.innerHTML = `<div class="ai-loading">Looking closely at your item — this takes a few seconds…</div>`;

    try{
      const photosToSend = currentPhotos.slice(0, 3); // up to 3 photos for context
      const imageBlocks = photosToSend.map(photoToImageBlock).filter(Boolean);
      if (imageBlocks.length === 0){
        area.innerHTML = `<div class="ai-error">Couldn't read the photo(s) for analysis. Please try again.</div>`;
        btn.disabled = false;
        btn.textContent = '🔮 Analyze with AI';
        return;
      }

      const existingHistory = {};
      CATEGORY_OPTIONS.forEach(c => {
        const h = getCategoryPriceHistory(c);
        if (h) existingHistory[c] = h;
      });

      const promptText = `You are helping value a secondhand item for resale on eBay/Mercari/Poshmark. Look at the photo(s) and respond with ONLY a JSON object (no markdown fences, no preamble), with this exact shape:
{
  "identification": "short name of the item, e.g. 'Levi's 501 denim jacket'",
  "likely_brand": "brand name if visible/identifiable, or empty string if unknown",
  "likely_color": "one of: ${PRESET_COLORS.join(', ')}, or another specific color name if none of those fit — pick the single most dominant color of the item",
  "likely_clothing_type": "if this is a clothing/shoe/bag/accessory item, one of: ${PRESET_CLOTHING_TYPES.join(', ')}, or another specific clothing type name if none of those fit. If the item is not clothing/footwear/accessories, use an empty string.",
  "category": "a short, specific category name for this item. Reuse one of these if it genuinely fits: ${CATEGORY_OPTIONS.join(', ')} — otherwise suggest a new, concise category name that fits better (e.g. 'Appliances', 'Antiques', 'Board Games')",
  "ebay_search_term": "a short, specific eBay listing category search term for this exact item, e.g. 'women's skirt', 'hardcover book', 'antique table lamp', 'microwave oven' — specific enough to find the right eBay category, not a broad bucket like 'Clothing'",
  "visible_flaws": "short description of visible wear, stains, damage, or empty string if none seen",
  "price_low": number (low end of a reasonable resale price guess in USD),
  "price_high": number (high end of a reasonable resale price guess in USD),
  "reasoning": "1-2 sentence explanation of the price guess, mentioning visual cues you used"
}
Known past sale averages by category on this account (use only as light context, not gospel): ${JSON.stringify(existingHistory)}
Be realistic and conservative — secondhand resale prices are usually modest. If you cannot identify the item with any confidence, still provide your best guess and say so in reasoning.
Respond with the JSON object only. Do not include any text, explanation, or markdown formatting before or after it. Your entire response must be parseable as JSON.`;

      const idToken = await window.auth.currentUser.getIdToken();
      const response = await fetch("/api/analyze-photo", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${idToken}` },
        body: JSON.stringify({
          imageBlocks,
          promptText
        })
      });

      if (!response.ok){
        area.innerHTML = `<div class="ai-error">Couldn't reach the AI right now. Please check your connection and try again.</div>`;
        return;
      }
      const data = await response.json();
      const textBlock = data.content && data.content.find(b => b.type === 'text');
      if (!textBlock){
        area.innerHTML = `<div class="ai-error">The AI didn't return a usable response. Please try again.</div>`;
        return;
      }

      let cleaned = textBlock.text.replace(/```json|```/gi, '').trim();
      // Extract just the JSON object in case the model added any stray text around it
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace){
        area.innerHTML = `<div class="ai-error">Couldn't make sense of the AI's response. Please try again.</div>`;
        return;
      }
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
      cleaned = escapeRawControlCharsInJsonStrings(cleaned);

      let result;
      try{
        result = JSON.parse(cleaned);
      }catch(parseErr){
        area.innerHTML = `<div class="ai-error">Couldn't make sense of the AI's response. Please try again.</div>`;
        return;
      }

      renderAiAnalysis(result);
      // Increment AI usage counter
      await incrementAiUsage();
      // Show usage warning if getting close to limit
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
      btn.textContent = '🔮 Analyze with AI';
    }
  }

  function renderAiAnalysis(result){
    const area = document.getElementById('aiAnalysisArea');
    const low = Math.max(0, parseFloat(result.price_low) || 0);
    const high = Math.max(low, parseFloat(result.price_high) || low);
    const mid = Math.round(((low+high)/2) * 100) / 100;

    area.innerHTML = `
      <div class="ai-analysis-box">
        <div class="ai-tag">AI estimate — review & apply</div>

        <div style="margin-top:6px; margin-bottom:12px;">
          <div style="font-size:10px; text-transform:uppercase; letter-spacing:0.04em; color:var(--plum-soft); font-weight:700; margin-bottom:4px;">Item name (edit if needed)</div>
          <input type="text" id="aiNameEdit" value="${escapeHtml(result.identification || '')}"
            style="width:100%; padding:9px 11px; border:1.5px solid var(--blush); border-radius:10px; font-size:14px; font-family:'Fraunces',serif; font-weight:600; color:var(--plum); background:var(--white);">
        </div>

        <div style="display:flex; gap:10px; margin-bottom:12px; flex-wrap:wrap;">
          <div style="flex:1; min-width:120px;">
            <div style="font-size:10px; text-transform:uppercase; letter-spacing:0.04em; color:var(--plum-soft); font-weight:700; margin-bottom:4px;">Brand</div>
            <input type="text" id="aiBrandEdit" value="${escapeHtml(result.likely_brand || '')}"
              style="width:100%; padding:8px 11px; border:1px solid var(--line); border-radius:8px; font-size:13px; color:var(--plum); background:var(--white);">
          </div>
          <div style="flex:1; min-width:120px;">
            <div style="font-size:10px; text-transform:uppercase; letter-spacing:0.04em; color:var(--plum-soft); font-weight:700; margin-bottom:4px;">Color</div>
            <input type="text" id="aiColorEdit" value="${escapeHtml(result.likely_color || '')}" list="colorList"
              style="width:100%; padding:8px 11px; border:1px solid var(--line); border-radius:8px; font-size:13px; color:var(--plum); background:var(--white);">
          </div>
          <div style="flex:1; min-width:120px;">
            <div style="font-size:10px; text-transform:uppercase; letter-spacing:0.04em; color:var(--plum-soft); font-weight:700; margin-bottom:4px;">Suggested price</div>
            <input type="number" id="aiPriceEdit" value="${mid.toFixed(2)}" step="0.01"
              style="width:100%; padding:8px 11px; border:1px solid var(--line); border-radius:8px; font-size:13px; font-family:'JetBrains Mono',monospace; color:var(--terracotta-deep); background:var(--white);">
          </div>
          <div style="flex:1; min-width:120px;">
            <div style="font-size:10px; text-transform:uppercase; letter-spacing:0.04em; color:var(--plum-soft); font-weight:700; margin-bottom:4px;">Clothing type</div>
            <input type="text" id="aiClothingTypeEdit" value="${escapeHtml(result.likely_clothing_type || '')}" list="clothingTypeList"
              style="width:100%; padding:8px 11px; border:1px solid var(--line); border-radius:8px; font-size:13px; color:var(--plum); background:var(--white);">
          </div>
        </div>

        <div style="font-size:12px; color:var(--plum-soft); margin-bottom:4px;">
          <b>Price range:</b> $${low.toFixed(2)} – $${high.toFixed(2)}
          ${result.visible_flaws ? ` · <b>Wear noted:</b> ${escapeHtml(result.visible_flaws)}` : ''}
        </div>
        <div class="ai-reasoning">${escapeHtml(result.reasoning || '')}</div>
        <div class="ai-disclaimer">AI estimate based on visual cues only — not a live market lookup. Adjust before saving.</div>
        <div class="ai-actions">
          <button id="aiApplyBtn" class="apply-btn">✓ Apply to form</button>
          <button id="aiDismissBtn">Dismiss</button>
        </div>
      </div>
    `;

    document.getElementById('aiApplyBtn').addEventListener('click', () => {
      // Name — always apply the (possibly edited) AI name if field is empty OR user chose AI's
      const editedName = document.getElementById('aiNameEdit').value.trim();
      if (editedName){
        document.getElementById('fName').value = editedName;
      }
      // Brand
      const editedBrand = document.getElementById('aiBrandEdit').value.trim();
      if (editedBrand){
        document.getElementById('fBrand').value = editedBrand;
      }
      // Color
      const editedColor = document.getElementById('aiColorEdit').value.trim();
      if (editedColor){
        const colorSelect = document.getElementById('fColor');
        const colorOther = document.getElementById('fColorOther');
        const knownColorValues = Array.from(colorSelect.options).map(o => o.value);
        if (knownColorValues.includes(editedColor)){
          colorSelect.value = editedColor;
          colorOther.style.display = 'none';
          colorOther.value = '';
        } else {
          colorSelect.value = '__other__';
          colorOther.value = editedColor;
          colorOther.style.display = 'block';
        }
      }
      // Category — same select+"Add new…" model as Color: if the AI's
      // suggestion matches a known option it's selected directly, otherwise
      // it's dropped into the custom "Add new…" field.
      if (result.category && result.category.trim()){
        const editedCategory = result.category.trim();
        const categorySelect = document.getElementById('fCategory');
        const categoryOther = document.getElementById('fCategoryOther');
        const knownCategoryValues = Array.from(categorySelect.options).map(o => o.value);
        if (knownCategoryValues.includes(editedCategory)){
          categorySelect.value = editedCategory;
          categoryOther.style.display = 'none';
          categoryOther.value = '';
        } else {
          categorySelect.value = '__other__';
          categoryOther.value = editedCategory;
          categoryOther.style.display = 'block';
        }
      }
      // Clothing type
      const editedClothingType = document.getElementById('aiClothingTypeEdit').value.trim();
      if (editedClothingType){
        const typeSelect = document.getElementById('fClothingType');
        const typeOther = document.getElementById('fClothingTypeOther');
        const knownTypeValues = Array.from(typeSelect.options).map(o => o.value);
        if (knownTypeValues.includes(editedClothingType)){
          typeSelect.value = editedClothingType;
          typeOther.style.display = 'none';
          typeOther.value = '';
        } else {
          typeSelect.value = '__other__';
          typeOther.value = editedClothingType;
          typeOther.style.display = 'block';
        }
      }
      // If the item turned out to be Clothing and shipping dims are still
      // empty, fill in the standard box size now too.
      if (getCategoryValue() === 'Clothing'){
        applyDefaultClothingShippingIfEmpty();
      }
      // Condition is intentionally NOT auto-applied from the AI's guess — it
      // always stays at whatever the form already has (defaults to "Used -
      // Excellent" for new items).
      // Notes is intentionally left untouched by "Apply to form" — the AI's
      // visible_flaws is already shown for review in the card above, but
      // Notes only ever contains what she typed herself, so it stays clean.
      // Price
      const editedPrice = parseFloat(document.getElementById('aiPriceEdit').value) || mid;
      document.getElementById('fListPrice').value = editedPrice.toFixed(2);

      // eBay category — auto-search using the AI's suggested search term and
      // auto-pick the top match, so she doesn't have to type it herself in
      // most cases. Results stay visible below so she can pick a different
      // one with one tap if the AI guessed wrong.
      if (result.ebay_search_term){
        document.getElementById('fEbayCategoryQuery').value = result.ebay_search_term;
        document.getElementById('fEbayCategoryQuery').dataset.lastQuery = result.ebay_search_term;
        searchEbayCategory(result.ebay_search_term, true);
      }

      document.getElementById('aiAnalysisArea').innerHTML = `
        <div style="font-size:12px; color:var(--sage-deep); background:rgba(127,150,120,0.12); padding:9px 12px; border-radius:10px; margin-bottom:14px;">
          ✓ AI suggestions applied — review the form below and adjust anything before saving.
        </div>`;
    });

    document.getElementById('aiDismissBtn').addEventListener('click', () => {
      document.getElementById('aiAnalysisArea').innerHTML = '';
    });
  }

  document.getElementById('analyzePhotoBtn').addEventListener('click', analyzeItemPhoto);

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
    const platform = document.getElementById('fPlatform').value;
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

  // Builds a Poshmark title within the platform's 80-char hard limit,
  // adding optional parts (in priority order) only while they still fit —
  // brand + clothing type are never dropped, since Poshmark's own guidance
  // and every seller-SEO source agree those two are the most important.
  // Poshmark's title limit (80 chars) is confirmed in their own support docs.
  // Their description limit is NOT clearly documented anywhere reliable —
  // Jasmine confirmed the app shows no visible counter and has never
  // truncated her longer GPT-written descriptions in practice, so this is a
  // generous working limit rather than a confirmed platform maximum. Bump
  // this single number if a longer description ever gets rejected.
  const POSHMARK_DESC_LIMIT = 1500;

  function buildPoshmarkTitle({ brand, clothingType, category, gender, size, color, condition }){
    let title = [brand, clothingType || category].filter(Boolean).join(' ').trim();
    const optional = [];
    if (size) optional.push(`Size ${size}`);
    if (color) optional.push(color);
    if (gender) optional.push(gender);
    if (condition === 'novo_etiqueta') optional.push('NWT');
    optional.forEach(part => {
      const candidate = (title + ' ' + part).trim();
      if (candidate.length <= 80) title = candidate;
    });
    return title.slice(0, 80);
  }

  // Builds a Poshmark description within the 500-char limit. Lines are added
  // in priority order (most important first) and lower-priority lines are
  // dropped first if space runs out — mirrors the "never cut your first/last
  // 10 words" SEO guidance by keeping brand/type/size at the very top.
  function buildPoshmarkDescription({ name, brand, clothingType, size, condition, notes, measurements, keywords }){
    const intro = `${name}${brand ? ' by ' + brand : ''}${clothingType ? ' — ' + clothingType : ''}`;

    const detailLines = [];
    if (size) detailLines.push(`* Size: ${size}`);
    detailLines.push(`* Condition: ${POSHMARK_CONDITION_LABEL[condition] || condition}`);
    if (measurements) detailLines.push(`* Measurements: ${measurements}`);
    if (notes) detailLines.push(`* ${notes}`);

    const closing = (appSettings.poshmarkStandardText || '').trim() || `Bundle discount available — check my closet! 📦`;

    const sections = [
      intro,
      `Details:\n\n${detailLines.join('\n')}`,
      closing,
    ];
    if (keywords.length) sections.push(`Keywords: ${keywords.join(', ')}`);

    let text = '';
    for (const section of sections){
      const candidate = text ? text + '\n\n' + section : section;
      if (candidate.length <= POSHMARK_DESC_LIMIT) text = candidate;
    }
    return text;
  }

  function renderPoshmarkListingOutput(title, description, styleTagGuesses, sourceLabel){
    while (styleTagGuesses.length < 3) styleTagGuesses.push('');

    document.getElementById('listingOutputArea').innerHTML = `
      <div class="listing-output">
        ${sourceLabel ? `<div style="display:inline-block; background:var(--gold); color:white; font-size:9.5px; font-weight:700; padding:4px 10px; border-radius:20px; text-transform:uppercase; letter-spacing:0.04em; margin-bottom:10px;">${escapeHtml(sourceLabel)}</div>` : ''}
        <div class="lo-label">Title <span style="font-family:'JetBrains Mono',monospace; font-weight:400; color:${title.length > 80 ? 'var(--danger)' : 'var(--plum-soft)'};">(${title.length}/80)</span></div>
        <div class="lo-title" id="poshTitleText">${escapeHtml(title)}</div>
        <button class="copy-btn" id="copyPoshTitleBtn" style="margin-bottom:12px;">Copy title</button>

        <div class="lo-label">Description <span style="font-family:'JetBrains Mono',monospace; font-weight:400; color:${description.length > POSHMARK_DESC_LIMIT ? 'var(--danger)' : 'var(--plum-soft)'};">(${description.length}/${POSHMARK_DESC_LIMIT})</span></div>
        <div style="font-size:11px; color:var(--plum-soft); margin-bottom:4px;">This exact text is also what gets sent as the eBay listing description — edit freely before saving the item.</div>
        <textarea id="poshDescText">${escapeHtml(description)}</textarea>
        <button class="copy-btn" id="copyPoshDescBtn" style="margin-bottom:12px;">Copy description</button>

        <div class="lo-label">Style Tags <span style="font-weight:400; color:var(--plum-soft);">(up to 3 — edit freely, then copy)</span></div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:8px;">
          ${styleTagGuesses.map((t,i) => `<input type="text" class="posh-tag-input" id="poshTag${i}" value="${escapeHtml(t)}" placeholder="tag ${i+1}" style="flex:1; min-width:100px; padding:8px 10px; border:1px solid var(--line); border-radius:8px; font-size:13px;">`).join('')}
        </div>
        <button class="copy-btn" id="copyPoshTagsBtn">Copy tags</button>
      </div>
    `;

    document.getElementById('copyPoshTitleBtn').addEventListener('click', () => {
      navigator.clipboard.writeText(document.getElementById('poshTitleText').textContent).then(() => {
        const btn = document.getElementById('copyPoshTitleBtn');
        btn.textContent = 'Copied ✓';
        setTimeout(() => { btn.textContent = 'Copy title'; }, 1800);
      });
    });
    document.getElementById('copyPoshDescBtn').addEventListener('click', () => {
      navigator.clipboard.writeText(document.getElementById('poshDescText').value).then(() => {
        const btn = document.getElementById('copyPoshDescBtn');
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
    return { name, category, clothingType, brand, gender, size, condition, notes, color, measurements, price };
  }

  function generatePoshmarkListing(){
    const f = gatherListingFormFields();
    const keywords = Array.from(new Set([f.clothingType, f.category, f.color, f.gender].filter(Boolean))).slice(0, 5);
    const title = buildPoshmarkTitle(f);
    const description = buildPoshmarkDescription({ ...f, keywords });
    // Best-effort starting point for Style Tags (max 3 on Poshmark) — she can
    // freely edit these before copying, this just saves typing from scratch.
    const styleTagGuesses = Array.from(new Set([f.clothingType, f.color, f.gender ? `${f.gender} Style` : ''].filter(Boolean))).slice(0, 3);
    renderPoshmarkListingOutput(title, description, styleTagGuesses, null);
  }

  async function generatePoshmarkListingAI(){
    const btn = document.getElementById('genPoshAiBtn');
    const area = document.getElementById('listingOutputArea');

    if (aiUsageRemaining() <= 0){
      area.innerHTML = `<div class="ai-error">❌ You've reached your monthly AI analysis limit (${appSettings.aiUsageLimit || 500} analyses). Go to ⚙ Settings to reset the counter.</div>`;
      return;
    }

    const f = gatherListingFormFields();

    // Always include the standard closing line from Settings when one is
    // set — she can edit or clear it there if a particular listing shouldn't
    // have it, instead of being asked on every single generation.
    const standardText = (appSettings.poshmarkStandardText || '').trim();
    const includeStandardText = !!standardText;

    btn.disabled = true;
    btn.textContent = '🪄 Writing…';
    area.innerHTML = `<div class="ai-loading">Writing a Poshmark-optimized listing…</div>`;

    try{
      // Send several photos, not just the cover shot — tag/label close-ups
      // (fabric content, size, care instructions) are usually a few photos
      // in, and reading them is what makes the AI's description as detailed
      // as a description written by hand from the actual garment tag.
      const imageBlocks = currentPhotos.slice(0, 5).map(photoToImageBlock).filter(Boolean);

      const closingLineInstruction = includeStandardText
        ? `a closing line that is EXACTLY this seller-provided text, verbatim, only trimmed at the end if needed to fit the 500-character limit: "${standardText}"`
        : `a line saying 'Bundle discount available — check my closet!'`;

      const promptText = `You are an expert Poshmark reseller writing an SEO-optimized listing for this item, following Poshmark's own best practices. You have been given up to 5 photos of the item — look at ALL of them carefully, not just the first. Sellers commonly include a close-up photo of the clothing tag/label showing fabric content (e.g. "100% cotton", "95% polyester 5% spandex"), care instructions, and sometimes country of origin or a style/RN number. If any such tag or label is visible in any photo, read it and use that real information — this is the single biggest thing that makes a description feel complete instead of generic. Never guess or invent fabric content or care instructions that you can't actually read; if no tag is visible or legible, just omit that detail rather than making it up.

Treat Brand, Size, Color, and Condition given in "Item data" below as ground truth — never contradict or change them. Every other descriptive detail (neckline, sleeve/hem/cuff style, knit or weave texture, silhouette/fit, closures, pockets, lining, pattern, etc.) must come ONLY from what you can actually see in the photos — never invent a construction detail you can't visually confirm.

Respond with ONLY a JSON object (no markdown fences, no preamble), with this exact shape:
{
  "title": "Poshmark title, HARD LIMIT 80 characters. Formula: Brand + Item Type + a key style/color detail + Size. Never omit Brand or Item Type if they are provided below. Keyword-first, no filler words, no ALL CAPS.",
  "description": "Poshmark description, HARD LIMIT ${POSHMARK_DESC_LIMIT} characters, formatted in EXACTLY this structure:\n(1) A short, direct opening — 1 sentence, at most 2 only if truly needed. State what the item is and its most notable visual features (color/pattern, fabric texture, fit) in plain, factual language. NO marketing filler, NO phrases like 'the kind of piece that earns its keep', 'reach for this on...', 'effortlessly', 'elevate your wardrobe', or similar generic copywriting — just describe what it actually is and looks like.\n(2) A blank line, then the word 'Details:' alone on its own line.\n(3) A bullet list where every single line starts with '* ' (asterisk + space), in this order:\n  * Brand: <from item data>\n  * Style: <a specific, descriptive style phrase for this exact item — e.g. 'Oversized color block pullover sweater', not just the raw item type>\n  * Size: <from item data>\n  * Color: <from item data, described richly if it's multi-color or patterned>\n  * Condition: <the EXACT condition wording given below, never altered>\n  followed by 3-6 more '* Label: detail' lines covering whichever garment-construction attributes are actually visible AND relevant to this specific item type (a sweater and a dress need different attributes) — choose from things like Neckline, Sleeve length, Hem & cuffs, Fabric/knit texture, Closures, Pockets, Lining, Silhouette/fit, or fabric content/care instructions if a tag was legible.\n  then one final bullet noting which angles the photos show and confirming there's no visible flaw beyond what's noted in seller notes below (e.g. 'Front and back views shown — no visible wear or pilling'). Only state 'no visible flaws' if that's consistent with the seller notes; if seller notes mention a flaw, reflect that honestly instead.\n(4) A blank line, then one short, factual closing line (not flowery) — a genuine, concrete reason this specific piece is useful (e.g. what to pair it with), one sentence only.\n(5) A blank line, then ${closingLineInstruction}.\nDo not add anything after that — no keywords line, no hashtags, nothing else.",
  "style_tags": ["up to 3 tags chosen ONLY from this exact list (copy the spelling exactly, do not invent new ones or alter wording): ${POSHMARK_STYLE_TAGS.join(', ')}. Pick whichever 1-3 best match this item's era/material/silhouette/aesthetic — it's fine to return fewer than 3 if nothing else fits well."]
}
Item data:
Brand: ${f.brand || '(unknown)'}
Item type: ${f.clothingType || f.category || '(unknown)'}
Category: ${f.category}
Gender: ${f.gender || '(unspecified)'}
Size: ${f.size || '(unspecified)'}
Color: ${f.color || '(unspecified)'}
Condition (use this EXACT wording in the description): ${POSHMARK_CONDITION_LABEL[f.condition] || f.condition}
Measurements: ${f.measurements || '(none provided)'}
Seller notes / flaws: ${f.notes || '(none)'}
Price: ${f.price ? '$' + f.price : '(unset)'}
Be accurate and honest — never invent brand, material, or condition details that aren't given above or clearly readable in a photo. Do not use words like "rare", "vintage", or "authentic" unless explicitly supported by the data. Respond with the JSON object only — no text before or after it.`;

      const idToken = await window.auth.currentUser.getIdToken();
      const response = await fetch("/api/generate-poshmark-listing", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${idToken}` },
        body: JSON.stringify({ imageBlocks, promptText })
      });

      if (!response.ok){
        let detail = '';
        try{
          const errJson = await response.json();
          detail = errJson?.error?.message || errJson?.detail?.error?.message || errJson?.error || '';
        }catch(parseErr){ /* body wasn't JSON — leave detail blank */ }
        area.innerHTML = `<div class="ai-error">Couldn't generate the listing (server said: HTTP ${response.status}${detail ? ' — ' + escapeHtml(String(detail)) : ''}). Try again in a moment — if it keeps happening, tell Vitor this exact message.</div>`;
        return;
      }
      const data = await response.json();
      const textBlock = data.content && data.content.find(b => b.type === 'text');
      if (!textBlock){
        area.innerHTML = `<div class="ai-error">The AI didn't return a usable response. Please try again.</div>`;
        return;
      }
      let cleaned = textBlock.text.replace(/```json|```/gi, '').trim();
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace){
        area.innerHTML = `<div class="ai-error">Couldn't make sense of the AI's response. Please try again.</div>`;
        return;
      }
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
      // The description we ask for is explicitly multi-line (blank lines,
      // bullet points), and the model very often writes real newline/tab
      // characters inside that JSON string value instead of the escaped
      // \n / \t JSON requires. A raw control character inside a quoted JSON
      // string is invalid and makes JSON.parse throw even when the response
      // is otherwise complete and well-formed. This walks the text and only
      // escapes newlines/tabs that fall inside a quoted string, leaving
      // structural whitespace outside strings untouched.
      cleaned = escapeRawControlCharsInJsonStrings(cleaned);

      let result;
      try{
        result = JSON.parse(cleaned);
      }catch(parseErr){
        area.innerHTML = `<div class="ai-error">Couldn't make sense of the AI's response. Please try again.</div>`;
        return;
      }

      const title = String(result.title || '').slice(0, 80);
      const description = String(result.description || '').slice(0, POSHMARK_DESC_LIMIT);
      const styleTagGuesses = Array.isArray(result.style_tags) ? result.style_tags.slice(0, 3).map(String) : [];

      renderPoshmarkListingOutput(title, description, styleTagGuesses, '🪄 AI-written — review before copying');
      await incrementAiUsage();
      const remaining = aiUsageRemaining();
      if (remaining <= 50 && remaining > 0){
        document.getElementById('listingOutputArea').innerHTML += `<div style="font-size:11px; color:var(--amber-deep); background:rgba(217,160,91,0.15); padding:7px 10px; border-radius:8px; margin-top:6px;">⚠ ${remaining} AI analyses remaining this month. Reset in ⚙ Settings.</div>`;
      }
    }catch(err){
      area.innerHTML = `<div class="ai-error">Couldn't complete the AI write-up right now. Please try again in a moment.</div>`;
    }finally{
      btn.disabled = false;
      btn.textContent = '🪄 Generate Poshmark listing with AI';
    }
  }

  function generateGenericListing(){
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
    const len = document.getElementById('fLen').value;
    const wid = document.getElementById('fWid').value;
    const hei = document.getElementById('fHei').value;
    const weight = document.getElementById('fWeight').value;
    const price = document.getElementById('fListPrice').value;

    const title = [brand, gender, name, size ? `Size ${size}` : '', condition === 'novo_etiqueta' ? 'NWT' : '', clothingType || (category !== 'Other' ? category : '')]
      .filter(Boolean).join(' ').replace(/\s+/g,' ').trim().slice(0, 80);

    let body = `${name}${brand ? ' by ' + brand : ''}\n\n`;
    if (clothingType) body += `Type: ${clothingType}\n`;
    if (gender) body += `Gender: ${gender}\n`;
    if (size) body += `Size: ${size}\n`;
    body += `Condition: ${CONDITION_LABEL[condition] || condition}\n`;
    if (notes) body += `Details: ${notes}\n`;
    if (len && wid) body += `Package: ${len}" L x ${wid}" W${hei ? ' x ' + hei + '" H' : ''}\n`;
    if (currentMeasurements?.values && Object.keys(currentMeasurements.values).length > 0){
      const m = Object.entries(currentMeasurements.values).map(([k,v]) => `${k}: ${v.toFixed(1)}"`).join(', ');
      body += `Measurements (laid flat): ${m}\n`;
    }
    if (weight) body += `Weight: ${weight} lb\n`;
    body += `\nFrom a smoke-free home. Ships fast and well-packaged. Bundle and save on multiple items — just ask!\n`;
    if (price) body += `\nPrice: $${parseFloat(price).toFixed(2)}`;

    document.getElementById('listingOutputArea').innerHTML = `
      <div class="listing-output">
        <div class="lo-label">Suggested title</div>
        <div class="lo-title">${escapeHtml(title)}</div>
        <div class="lo-label">Listing description</div>
        <textarea id="listingBodyText" readonly>${escapeHtml(body)}</textarea>
        <button class="copy-btn" id="copyListingBtn">Copy to clipboard</button>
      </div>
    `;
    document.getElementById('copyListingBtn').addEventListener('click', () => {
      const text = title + '\n\n' + body;
      navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById('copyListingBtn');
        btn.textContent = 'Copied ✓';
        setTimeout(() => { btn.textContent = 'Copy to clipboard'; }, 1800);
      }).catch(() => {
        document.getElementById('listingBodyText').select();
      });
    });
  }

  document.getElementById('genListingBtn').addEventListener('click', () => {
    const platform = document.getElementById('fPlatform').value;
    if (platform === 'poshmark') generatePoshmarkListing();
    else generateGenericListing();
  });

  document.getElementById('genPoshAiBtn').addEventListener('click', generatePoshmarkListingAI);

  // The AI Poshmark button only makes sense once Platform is set to
  // Poshmark — this also relabels the free/instant button so it's obvious
  // there IS a Poshmark-specific generator instead of it silently doing
  // something different depending on a dropdown she might not have touched.
  function updateListingGeneratorUI(){
    const platform = document.getElementById('fPlatform').value;
    const isPosh = platform === 'poshmark';
    document.getElementById('genListingBtn').textContent = isPosh ? '📝 Generate Poshmark listing (instant template)' : '📝 Generate listing copy';
    document.getElementById('genPoshAiBtn').style.display = isPosh ? 'block' : 'none';
    document.getElementById('genPoshAiHint').style.display = isPosh ? 'block' : 'none';
  }
  document.getElementById('fPlatform').addEventListener('change', updateListingGeneratorUI);

  // ---------- SAVE / DELETE ----------
  document.getElementById('saveItemBtn').addEventListener('click', async () => {
    let name = document.getElementById('fName').value.trim();
    if (!name){
      alert('Give your item a name before saving.');
      return;
    }
    if (!chosenEbayCategory){
      alert('Choose an eBay category before saving — tap the eBay Category field and search for it.');
      return;
    }
    name = toTitleCase(name);
    document.getElementById('fName').value = name;
    const saveBtn = document.getElementById('saveItemBtn');
    const originalBtnText = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    setSaveProgress(5, 'Preparing…');

    const platform = document.getElementById('fPlatform').value;
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

    const rawProductCode = document.getElementById('fProductCode').value.trim();
    const baseProductCode = (rawProductCode && rawProductCode !== 'loading…') ? rawProductCode : nextProductCode();
    const itemData = {
      id: itemId,
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
      // Poshmark listing was generated/edited this session) so it survives
      // closing the modal — previously this text only ever lived on screen,
      // never saved. This exact text also becomes the eBay description
      // (point 4) instead of eBay building its own disconnected one from
      // shipping-box dimensions. Falls back to whatever was already saved
      // if nothing was (re)generated this time.
      poshmarkTitle: document.getElementById('poshTitleText')?.textContent
        || items.find(i => i.id === currentEditId)?.poshmarkTitle || '',
      poshmarkDescription: document.getElementById('poshDescText')?.value
        || items.find(i => i.id === currentEditId)?.poshmarkDescription || '',
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
      platform,
      listedPlatforms: [...currentListedPlatforms],
      freeShipping: document.getElementById('fFreeShipping').value === 'seller',
      measurements: currentMeasurements || null,
      photos: hostedPhotos,
      status: currentStatus,
      prep: currentPrep,
      createdAt: currentEditId ? (items.find(i=>i.id===currentEditId)?.createdAt || Date.now()) : Date.now(),
    };

    if (currentStatus === 'vendido'){
      const soldPrice = parseFloat(document.getElementById('fSoldPrice')?.value) || listPrice;
      const shippingCost = parseFloat(document.getElementById('fShippingCost')?.value) || 0;
      const soldPlatform = document.getElementById('fSoldPlatform')?.value || platform;
      const feesTotal = platformFee(soldPlatform, soldPrice);
      itemData.soldPrice = soldPrice;
      itemData.shippingCost = shippingCost;
      itemData.soldPlatform = soldPlatform;
      itemData.feesTotal = feesTotal;
      itemData.soldAt = items.find(i=>i.id===currentEditId)?.soldAt || Date.now();
      itemData.netProfit = soldPrice - (parseFloat(itemData.cost)||0) - feesTotal - shippingCost;
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
    endEbayListingIfSold(itemData); // best-effort, doesn't block the save above
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
    if (quickCatalogMode){
      // The whole point of quick catalog mode is never stopping to close and
      // reopen the form between items — go straight to a blank one, ready
      // for the next photo.
      openModal(null);
    } else if (openedFromBulkReview){
      // She came here from "Edit" on a blocked/needs-review item in the bulk
      // eBay preflight — fixing and saving should offer to list it right
      // away instead of sending her back to redo bulk-select from scratch.
      openedFromBulkReview = false;
      openModal(lastSaved);
      listItemOnEbay(lastSaved);
    } else {
      // Re-open the last-saved item (now with a real id) instead of closing —
      // this is what lets "List on eBay" work right after Save, without an
      // extra click to reopen the item first.
      openModal(lastSaved);
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
  });

  document.getElementById('deleteItemBtn').addEventListener('click', async () => {
    if (!currentEditId) return;
    if (!confirm('Delete this item permanently?')) return;
    const idToDelete = currentEditId;
    try{
      await deleteItemFromDb(idToDelete);
    }catch(e){
      return;
    }
    items = items.filter(i => i.id !== idToDelete);
    renderAll();
    closeModal();
  });


  // ---------- SETTINGS ----------

  const DEFAULT_SETTINGS = {
    // 1. Price markup rule
    targetMarginPct: 40,          // minimum net margin % she wants
    minMarkupMultiplier: 1.8,     // cost × this = minimum list price floor

    // 2. Default shipping profile
    defaultCarrier: 'usps_ground', // usps_ground | usps_priority | ups_ground
    sellerPaysShipping: false,     // true = she absorbs shipping, false = buyer pays
    defaultWeightLb: 0.5,         // fallback weight when item has none
    customCarriers: [],           // [{name, basePrice, perLbPrice}] — user-added carriers with their own pricing

    // 3. Auto-prep by category
    autoPrepRules: {
      'Clothing':     'needs_wash',
      'Shoes':        'needs_photo',
      'Accessories':  'needs_photo',
      'Electronics':  'needs_photo',
      'Home & Decor': 'needs_photo',
      'Collectibles': 'needs_photo',
      'Toys':         'needs_photo',
      'Other':        'needs_photo',
    },

    // AI usage counter
    aiUsageCount: 0,
    aiUsageLimit: 500,
    aiUsagePeriodStart: null,   // ISO string of when current period started
    aiResetDayOfMonth: 1,       // day of month to auto-reset (1 = first of month)
    aiScheduledReset: true,     // true = auto-reset monthly, false = manual only

    // Poshmark listing generator — her own standard closing line (shipping
    // policy, bundle offer, thank-you note, whatever she wants) so she
    // never has to type it by hand every time she generates a listing.
    poshmarkStandardText: '',

    // Platform management (Settings → Platforms). The 5 built-in platforms
    // (ebay/mercari/poshmark/vinted/depop) keep their fixed keys — eBay
    // especially has real integration logic keyed to that exact string —
    // but their fee % can be overridden here. customPlatforms are entirely
    // her own (key/label/emoji/feePct), addable and removable.
    platformFeeOverrides: {}, // { ebay: 0.15, ... } — overrides PLATFORM_FEES per key
    customPlatforms: [],      // [{ key, label, emoji, feePct }]

    // 4. Thermal label printing (per-item)
    labelWidthIn: 2.25,
    labelHeightIn: 1.25,
    labelFields: {
      box: true,
      name: true,
      category: false,
      brand: false,
    },

    // 5. Wall measurement markers — real-world center-to-center spacing of
    // the 4 printed crosshair targets mounted on the wall, used to calibrate
    // the measurement tool instead of a tape measure in every photo.
    wallMarkerSpacingHIn: 24,
    wallMarkerSpacingVIn: 24,
  };

  let appSettings = { ...DEFAULT_SETTINGS };

  async function loadSettings(){
    try{
      const { doc, getDoc } = window.firestoreFns;
      const snap = await getDoc(doc(window.db, 'app_config', 'settings'));
      if (snap.exists()){
        appSettings = { ...DEFAULT_SETTINGS, ...snap.data() };
      }
    }catch(e){ appSettings = { ...DEFAULT_SETTINGS }; }
    // Initialize period if first time
    if (!appSettings.aiUsagePeriodStart){
      appSettings.aiUsagePeriodStart = new Date().toISOString();
      await saveSettings();
    }
    // Check if scheduled reset is due
    await checkScheduledReset();
  }

  async function saveSettings(){
    try{
      const { doc, setDoc } = window.firestoreFns;
      await setDoc(doc(window.db, 'app_config', 'settings'), appSettings);
    }catch(e){ console.error('Failed to save settings', e); }
  }

  async function checkScheduledReset(){
    if (!appSettings.aiScheduledReset || !appSettings.aiUsagePeriodStart) return;
    const periodStart = new Date(appSettings.aiUsagePeriodStart);
    const now = new Date();
    const dayOfMonth = appSettings.aiResetDayOfMonth || 1;
    // Check if we've passed a reset day since period started
    const resetDate = new Date(now.getFullYear(), now.getMonth(), dayOfMonth);
    if (resetDate <= periodStart){
      // Reset day hasn't come this month yet, check last month
      return;
    }
    if (resetDate <= now && periodStart < resetDate){
      // Reset is due
      await resetAiCounter('scheduled');
    }
  }

  async function resetAiCounter(type){
    appSettings.aiUsageCount = 0;
    appSettings.aiUsagePeriodStart = new Date().toISOString();
    await saveSettings();
    console.log(`AI counter reset (${type})`);
  }

  async function incrementAiUsage(){
    appSettings.aiUsageCount = (appSettings.aiUsageCount || 0) + 1;
    await saveSettings();
  }

  function aiUsageRemaining(){
    return Math.max(0, (appSettings.aiUsageLimit || 500) - (appSettings.aiUsageCount || 0));
  }

  function aiUsagePct(){
    return Math.min(100, Math.round(((appSettings.aiUsageCount || 0) / (appSettings.aiUsageLimit || 500)) * 100));
  }

  function renderSettings(){
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
        <button id="signOutBtn" class="settings-save-btn" style="width:auto; padding:8px 14px; margin:0;">Sign out</button>
      </div>

      <!-- AUTHORIZE ACCESS (admin only) -->
      <div class="settings-section" id="authorizeAccessSection" style="display:none;">
        <h3>Authorize access</h3>
        <div class="ss-desc">Approve or deny people who created an account and are waiting for access.</div>
        <div id="authorizeAccessBox"></div>
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

      <!-- POSHMARK STANDARD TEXT -->
      <div class="settings-section">
        <h3>Poshmark listing text</h3>
        <div class="ss-desc">Your own standard closing line — shipping policy, bundle offer, thank-you note, whatever you want. It's used automatically every time you generate a Poshmark listing (instant template), and offered as an option when generating with AI.</div>
        <textarea id="sPoshText" placeholder="e.g. Bundle discount available — check my closet! Ships next business day 📦" style="width:100%; min-height:70px; padding:10px 12px; border:1px solid var(--line); border-radius:10px; font-size:13px; font-family:'Inter',sans-serif; resize:vertical;">${escapeHtml(appSettings.poshmarkStandardText || '')}</textarea>
        <button class="settings-save-btn" onclick="savePoshmarkTextSettings()">Save Poshmark text</button>
        <div class="settings-success" id="poshTextSaveMsg">✓ Saved!</div>
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
        <div class="ss-desc">Sets the size of the labels loaded in your thermal printer and which details print on them. This is used by the 🖨️ button on each item.</div>
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
          <div><div class="sr-label">Storage box</div></div>
          <input type="checkbox" id="sLabelFieldBox" ${appSettings.labelFields?.box !== false ? 'checked' : ''} style="width:20px; height:20px;">
        </div>
        <div class="settings-row">
          <div><div class="sr-label">Item name</div></div>
          <input type="checkbox" id="sLabelFieldName" ${appSettings.labelFields?.name !== false ? 'checked' : ''} style="width:20px; height:20px;">
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
    if (window.isAdminEmail(window.auth.currentUser?.email)){
      renderAuthorizeAccessPanel();
    }
  }

  // Lists pending sign-ups and lets the admin approve or deny each one.
  // Only reachable from Settings when signed in as one of window.ADMIN_EMAILS —
  // the Firestore rules independently enforce this server-side too (see README).
  async function renderAuthorizeAccessPanel(){
    const section = document.getElementById('authorizeAccessSection');
    const box = document.getElementById('authorizeAccessBox');
    if (!section || !box) return;
    section.style.display = 'block';
    box.innerHTML = '<div style="font-size:12px; opacity:0.6;">Loading…</div>';
    try{
      const { collection, getDocs, doc, setDoc, deleteDoc } = window.firestoreFns;
      const snap = await getDocs(collection(window.db, 'users'));
      const all = [];
      snap.forEach(d => all.push({ id: d.id, ...d.data() }));
      const pending = all.filter(u => u.status === 'pending');
      const approved = all.filter(u => u.status === 'approved');

      box.innerHTML = (pending.length
        ? pending.map(u => `
          <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:10px 0; border-bottom:1px solid var(--line);">
            <span style="font-size:13px;">${escapeHtml(u.email || u.id)}</span>
            <div style="display:flex; gap:6px;">
              <button class="settings-save-btn" style="width:auto; padding:6px 12px; margin:0;" data-approve-uid="${u.id}">Approve</button>
              <button style="background:transparent; border:1px solid var(--danger); color:var(--danger); border-radius:8px; padding:6px 12px; font-size:13px; cursor:pointer;" data-deny-uid="${u.id}">Deny</button>
            </div>
          </div>`).join('')
        : '<div style="font-size:12px; color:var(--plum-soft);">No pending requests.</div>'
      ) + (approved.length
        ? `<div style="margin-top:14px; font-size:11px; text-transform:uppercase; letter-spacing:0.05em; color:var(--plum-soft);">Approved (${approved.length})</div>` +
          approved.map(u => `<div style="font-size:13px; padding:6px 0;">${escapeHtml(u.email || u.id)}</div>`).join('')
        : '');

      box.querySelectorAll('[data-approve-uid]').forEach(btn => btn.addEventListener('click', async () => {
        await setDoc(doc(window.db, 'users', btn.dataset.approveUid), { status: 'approved' }, { merge: true });
        renderAuthorizeAccessPanel();
      }));
      box.querySelectorAll('[data-deny-uid]').forEach(btn => btn.addEventListener('click', async () => {
        if (!confirm('Deny this request? They will need to sign up again to request access.')) return;
        await deleteDoc(doc(window.db, 'users', btn.dataset.denyUid));
        renderAuthorizeAccessPanel();
      }));
    }catch(e){
      console.error('Failed to load access requests:', e);
      box.innerHTML = '<div style="font-size:12px; color:var(--danger);">Failed to load — try again.</div>';
    }
  }

  let lastConnectionTestResult = null; // { ok, message } — survives the re-render below

  function renderEbayConnectionStatus(){
    const el = document.getElementById('ebayConnectionStatus');
    if (!el) return;
    const testBox = lastConnectionTestResult
      ? `<div class="ebay-status-box ${lastConnectionTestResult.ok ? 'success' : 'error'}" style="margin-top:8px;">${lastConnectionTestResult.message}</div>`
      : '';
    if (ebayTokens && ebayTokens.access_token){
      const connectedDate = ebayTokens.connected_at ? new Date(ebayTokens.connected_at).toLocaleString('en-US') : 'unknown';
      const lastTestedDate = ebayTokens.lastTestedAt ? new Date(ebayTokens.lastTestedAt).toLocaleString('en-US') : null;
      el.innerHTML = `
        <div class="ebay-status-box success">
          ✅ Connected${ebayTokens.sellerUsername ? ` as <b>${escapeHtml(ebayTokens.sellerUsername)}</b>` : ' <span style="opacity:0.7;">(fetching username…)</span>'}
          <br><small>Since: ${connectedDate}${lastTestedDate ? ` · Last tested: ${lastTestedDate}` : ''}</small>
          <br><br>
          <button onclick="connectEbay()" style="background:var(--terracotta); color:white; border:none; border-radius:8px; padding:8px 14px; font-size:12px; cursor:pointer; margin-right:8px;">🔄 Connect / switch account</button>
          <button onclick="testEbayConnection()" style="background:var(--sage); color:white; border:none; border-radius:8px; padding:8px 14px; font-size:12px; cursor:pointer; margin-right:8px;">🧪 Test connection</button>
          <button onclick="disconnectEbay()" style="background:transparent; border:1px solid var(--danger); color:var(--danger); border-radius:8px; padding:8px 14px; font-size:12px; cursor:pointer;">Disconnect</button>
          <div id="ebayTestResult">${testBox}</div>
        </div>`;
      if (!ebayTokens.sellerUsername) backfillSellerUsername();
    } else {
      el.innerHTML = `
        <div class="ebay-status-box pending">
          🔗 Not connected.
          <br><button onclick="connectEbay()" style="margin-top:8px; background:#E53238; color:white; border:none; border-radius:8px; padding:9px 16px; font-size:13px; font-weight:600; cursor:pointer;">Connect my eBay account</button>
        </div>`;
    }
  }

  // Backfills the seller username for tokens obtained before this feature
  // existed, without requiring a full disconnect/reconnect. Note: if the
  // stored token was granted before the identity scope was added, eBay may
  // reject the identity lookup — in that case a one-time reconnect is still
  // needed to pick up the new scope, but this covers most cases silently.
  let usernameBackfillInFlight = false;
  async function backfillSellerUsername(){
    if (usernameBackfillInFlight) return;
    usernameBackfillInFlight = true;
    try{
      const token = await getValidEbayToken();
      if (!token) return;
      const res = await fetch('/api/ebay-auth?action=username', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ access_token: token })
      });
      const data = await res.json();
      if (data.sellerUsername){
        await saveEbayTokens({ ...ebayTokens, sellerUsername: data.sellerUsername });
        renderEbayConnectionStatus();
      }
    }catch(e){ console.warn('Username backfill failed:', e); }
    finally{ usernameBackfillInFlight = false; }
  }

  window.findEligibleOffers = async function(){
    const resultEl = document.getElementById('ebayOffersResult');
    if (resultEl) resultEl.innerHTML = `<span style="opacity:0.7;">Checking for interested buyers…</span>`;
    try{
      const token = await getValidEbayToken();
      if (!token){
        if (resultEl) resultEl.innerHTML = `<div class="ebay-status-box error">❌ Connect your eBay account first.</div>`;
        return;
      }
      const res = await fetch('/api/ebay-negotiation', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ access_token: token, action: 'find_eligible' })
      });
      const data = await res.json();
      if (!data.success){
        if (resultEl) resultEl.innerHTML = `<div class="ebay-status-box error">❌ Couldn't check right now.</div>`;
        return;
      }
      const eligibleIds = new Set((data.listingIds || []).map(String));
      const matches = items.filter(i => i.ebayListingId && eligibleIds.has(String(i.ebayListingId)));
      if (matches.length === 0){
        if (resultEl) resultEl.innerHTML = `<div class="ebay-status-box success">✓ No interested buyers on any active listing right now.</div>`;
        return;
      }
      if (resultEl){
        resultEl.innerHTML = matches.map(item => `
          <div class="settings-row" data-offer-item="${item.id}">
            <div><div class="sr-label">${escapeHtml(item.name || 'Item')}</div><div class="sr-sub">Listed at $${(parseFloat(item.listPrice)||0).toFixed(2)}</div></div>
            <div style="display:flex; gap:6px; align-items:center;">
              <input type="number" min="1" max="90" placeholder="%" value="10" style="width:55px; padding:6px 8px; border-radius:8px; border:1px solid var(--line);" id="offerPct_${item.id}">
              <button onclick="sendWatcherOffer('${item.id}', '${item.ebayListingId}')" style="background:var(--sage); color:white; border:none; border-radius:8px; padding:8px 12px; font-size:12px; cursor:pointer;">Send</button>
            </div>
          </div>
        `).join('');
      }
    }catch(e){
      if (resultEl) resultEl.innerHTML = `<div class="ebay-status-box error">❌ ${escapeHtml(String(e.message || e))}</div>`;
    }
  };

  window.sendWatcherOffer = async function(itemId, listingId){
    const pctInput = document.getElementById('offerPct_' + itemId);
    const pct = parseFloat(pctInput?.value) || 10;
    const row = document.querySelector(`[data-offer-item="${itemId}"]`);
    try{
      const token = await getValidEbayToken();
      const res = await fetch('/api/ebay-negotiation', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ access_token: token, action: 'send_offer', listing_id: listingId, discount_percentage: pct })
      });
      const data = await res.json();
      if (data.success){
        if (row) row.innerHTML = `<div style="font-size:12px; color:var(--sage-deep);">✅ ${pct}% offer sent to interested buyers.</div>`;
      } else {
        if (row) row.innerHTML += `<div style="font-size:12px; color:var(--danger);">❌ Failed to send offer.</div>`;
      }
    }catch(e){
      if (row) row.innerHTML += `<div style="font-size:12px; color:var(--danger);">❌ ${escapeHtml(String(e.message || e))}</div>`;
    }
  };

  // Manually re-checks whether the stored eBay token still works, right now
  // — without needing to attempt a full publish to find out it's dead.
  // Calls the same identity lookup used to display the username, but always
  // re-runs it (ignoring any cached username) and shows a clear pass/fail.
  window.testEbayConnection = async function(){
    lastConnectionTestResult = { ok: true, message: '<span style="opacity:0.7;">Testing…</span>' };
    renderEbayConnectionStatus();
    try{
      const token = await getValidEbayToken();
      if (!token){
        lastConnectionTestResult = { ok: false, message: '❌ No valid token — try reconnecting.' };
        renderEbayConnectionStatus();
        return;
      }
      const res = await fetch('/api/ebay-auth?action=username', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ access_token: token })
      });
      const data = await res.json();
      ebayTokens.lastTestedAt = Date.now();
      if (data.sellerUsername){
        await saveEbayTokens({ ...ebayTokens, sellerUsername: data.sellerUsername, lastTestedAt: Date.now() });
        lastConnectionTestResult = { ok: true, message: `✅ Connection OK — logged in as <b>${escapeHtml(data.sellerUsername)}</b>` };
      } else {
        await saveEbayTokens({ ...ebayTokens, lastTestedAt: Date.now() });
        lastConnectionTestResult = { ok: false, message: '❌ Token didn\'t work. Try "Connect / switch account" to reconnect.' };
      }
    }catch(e){
      lastConnectionTestResult = { ok: false, message: `❌ Test failed: ${escapeHtml(String(e.message || e))}` };
    }
    renderEbayConnectionStatus();
  };

  // Fully disconnects the eBay account: clears the in-memory token (the
  // actual cause of the earlier wrong-account mixup — deleting only the
  // Firestore doc wasn't enough while the tab stayed open and the token
  // was still valid in memory) AND removes it from Firestore.
  window.disconnectEbay = async function(){
    if (!confirm('Disconnect this eBay account? You\'ll need to log in again before publishing.')) return;
    try{
      const { doc, deleteDoc } = window.firestoreFns;
      await deleteDoc(doc(window.db, 'ebay_tokens', 'main'));
    }catch(e){ console.warn('Failed to delete stored eBay token:', e); }
    clearEbayTokens();
    renderEbayConnectionStatus();
    alert('Disconnected. To switch to a different eBay account, also sign out of ebay.com in your browser before reconnecting.');
  };

  // Save handlers
  window.runEbaySetup = async function(){
    const area = document.getElementById('ebaySetupResult');
    area.innerHTML = `<div class="ebay-status-box pending">⏳ Creating business policies and location on eBay…</div>`;
    try{
      const token = await getValidEbayToken();
      if (!token){
        area.innerHTML = `<div class="ebay-status-box error">❌ Connect your eBay account first (in an item's "List on eBay" panel), then come back here.</div>`;
        return;
      }
      const res = await fetch('/api/ebay-setup', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ access_token: token })
      });
      const data = await res.json();
      if (data.success){
        area.innerHTML = `
          <div class="ebay-status-box success">
            ✅ Created successfully! Copy these 4 values into your Vercel Environment Variables, then redeploy:
            <div style="margin-top:8px; padding:8px; background:rgba(0,0,0,0.04); border-radius:6px; font-family:monospace; font-size:11px; white-space:pre-wrap;">EBAY_FULFILLMENT_POLICY_ID=${escapeHtml(data.results.fulfillmentPolicyId)}
EBAY_PAYMENT_POLICY_ID=${escapeHtml(data.results.paymentPolicyId)}
EBAY_RETURN_POLICY_ID=${escapeHtml(data.results.returnPolicyId)}
EBAY_MERCHANT_LOCATION_KEY=${escapeHtml(data.results.merchantLocationKey)}</div>
          </div>`;
      } else {
        area.innerHTML = `
          <div class="ebay-status-box error">
            ⚠️ Partially created — some steps failed. Details below:
            <div style="margin-top:8px; padding:8px; background:rgba(0,0,0,0.04); border-radius:6px; font-family:monospace; font-size:11px; white-space:pre-wrap;">${escapeHtml(JSON.stringify(data, null, 2))}</div>
          </div>`;
      }
    }catch(e){
      area.innerHTML = `<div class="ebay-status-box error">❌ Setup failed: ${escapeHtml(e.message)}</div>`;
    }
  };

  // ---------- PLATFORMS SETTINGS (Settings → Platforms) ----------
  function renderPlatformsSettingsList(){
    const container = document.getElementById('platformsList');
    if (!container) return;
    const platforms = getAllPlatforms();
    container.innerHTML = platforms.map(p => `
      <div style="display:flex; align-items:center; gap:8px; padding:8px 0; border-bottom:1px solid var(--line);">
        <span style="flex:1; font-size:13px; font-weight:600; color:var(--plum);">${escapeHtml(p.label)}</span>
        <input type="number" data-platform-fee="${p.key}" value="${p.feePct.toFixed(2)}" min="0" max="100" step="0.1" style="width:70px; padding:6px 8px; border:1px solid var(--line); border-radius:6px; font-size:13px;">
        <span style="font-size:12px; color:var(--plum-soft);">%</span>
        <button class="icon-btn" data-platform-suggest="${p.key}" title="Ask the AI for a current fee % estimate">🔍</button>
        ${p.builtIn ? '' : `<button class="icon-btn" data-platform-delete="${p.key}" style="color:var(--danger);" title="Remove this platform">🗑</button>`}
      </div>
    `).join('');

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
      const idToken = await window.auth.currentUser.getIdToken();
      const res = await fetch('/api/ebay-item-aspects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
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

  window.savePoshmarkTextSettings = async function(){
    appSettings.poshmarkStandardText = document.getElementById('sPoshText').value.trim();
    await saveSettings();
    showSaveMsg('poshTextSaveMsg');
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

  function showSaveMsg(id){
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = 'block';
    setTimeout(()=> el.style.display = 'none', 2500);
  }


  // ---------- INIT ----------
  renderVersionBadge();
  setupSourceAutocomplete();
  setupSizeAutocomplete();
  async function waitForFirebaseThenLoad(){
    if (window.firebaseReady){
      await Promise.all([loadSettings(), loadItems(), loadEbayTokens(), loadDrafts()]);
      checkEbaySalesNow(); // best-effort, silent unless it finds something
    } else {
      setTimeout(waitForFirebaseThenLoad, 50);
    }
  }

  // ---------- AUTH GATE ----------
  // Nobody sees the app until Firebase confirms they're signed in AND their
  // Firestore user doc says status:'approved'. New sign-ups default to
  // 'pending' (except ADMIN_EMAILS, auto-approved) and sit behind the
  // "Awaiting approval" screen until the admin approves them in Settings.
  let isSignupMode = false;

  function showAuthForm(){
    document.getElementById('authOverlay').style.display = 'flex';
    document.getElementById('authFormState').style.display = 'block';
    document.getElementById('authPendingState').style.display = 'none';
    document.body.classList.add('auth-locked');
  }
  function showAuthPending(){
    document.getElementById('authOverlay').style.display = 'flex';
    document.getElementById('authFormState').style.display = 'none';
    document.getElementById('authPendingState').style.display = 'block';
    document.body.classList.add('auth-locked');
  }
  function showApp(){
    document.getElementById('authOverlay').style.display = 'none';
    document.body.classList.remove('auth-locked');
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
        const isAdmin = window.isAdminEmail(email);
        await setDoc(doc(window.db, 'users', cred.user.uid), {
          email,
          status: isAdmin ? 'approved' : 'pending',
          createdAt: Date.now(),
        });
      } else {
        await signInWithEmailAndPassword(window.auth, email, password);
      }
      // onAuthStateChanged below takes it from here (checks approval status).
    }catch(err){
      setAuthError(err.message || 'Something went wrong.');
    }finally{
      submitBtn.disabled = false;
    }
  });

  document.getElementById('authSignOutBtn').addEventListener('click', async () => {
    await window.authFns.signOut(window.auth);
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
          const isAdmin = window.isAdminEmail(user.email);
          await setDoc(userRef, { email: user.email, status: isAdmin ? 'approved' : 'pending', createdAt: Date.now() });
          snap = await getDoc(userRef);
        }
        if (snap.data().status === 'approved'){
          showApp();
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
  // its own). `items` and `currentEditId` are getters because they get
  // reassigned (`items = …`, `currentEditId = …`) — a plain reference would
  // freeze at whatever they were the instant this object was built. Every
  // other entry here is a function or a const, which are never reassigned,
  // so a plain reference stays correct.
  return {
    get items(){ return items; },
    get currentEditId(){ return currentEditId; },
    saveItem, renderAll, escapeHtml, CONDITION_LABEL, bulkSelectedIds,
    suggestPrice, platformFee, showSavedToast, openModal, renderEbayConnectionStatus,
    openModalFromBulkReview,
  };
})();
