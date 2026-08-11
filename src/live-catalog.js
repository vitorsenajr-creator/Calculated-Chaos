// Live Catalog — fast item capture during a live sale (added 2026-08-10).
// Deliberately a separate page/bundle from the main app (see vite.config.js
// + live-catalog.html), not a tab inside it — it's a different workflow
// (numbered lot list while presenting live) that never touches the real
// `items` collection. Still behind the same Firebase login/project.
import '../src/config/firebase.js';
import { items, setItems } from './modules/state.js';
import {
  getAllClothingTypes, getAllBrands, getSizeSuggestionsForType,
} from './modules/catalog-lookups.js';
import { PRESET_CLOTHING_TYPES, PRESET_COLORS, PLATFORM_LABEL } from './modules/constants.js';
import { escapeHtml } from './modules/format-utils.js';
import { compressImage } from './modules/image-compression.js';
import { initLiveNarration } from './modules/live-narration.js';

// Common garment measurement labels — same vocabulary the main app's
// measure tool already uses (Top/Pants/Dress/Outerwear categories,
// flattened into one list here since a live sale moves too fast to also
// pick a garment category first). Any custom-typed label gets added to
// this list going forward too, same as Tipo/Brand/Size.
const DEFAULT_MEASURE_LABELS = [
  'Pit to pit', 'Length', 'Sleeve length', 'Shoulder to shoulder',
  'Waist', 'Hip', 'Inseam', 'Rise', 'Width', 'Neck', 'Thigh', 'Length (insole)',
];

let customOptions = { tipos: [], brands: [], sizes: [], colors: [], fabrics: [], measureLabels: [] };
let currentSession = null; // { id, name, date, startNum, nextNum, itemCount }
let liveItemsCache = [];   // items in the currently-open session
let measureRowCount = 0;
let currentPhotos = [];    // compressed data-URLs pending upload for the item being built in the form

// ---------- SKU (added for Live Show — a stock number distinct from both
// the session's own #-Live sequence and the main catalog's productCode) ----
// LV-0001: "LV-" prefix + its own global counter (live_catalog_options/
// skuCounter, incremented via a transaction so concurrent adds never
// collide). Originally also had a check-letter suffix (LV-0001-K) for
// typo-catching, but Vitor found that confusing on a printed label — "LV-"
// alone is enough of a differentiator from the main catalog's plain
// #0001-style productCode. Live items live in their own `liveItems`
// Firestore collection, never inside the main catalog's `items` array, so
// there's no actual collision risk with nextProductCode() (catalog-
// lookups.js) today — that would only matter if a future "promote to real
// catalog" flow ever fed a Live SKU straight into the main sequence, which
// doesn't exist yet.
function formatLiveSku(n){
  return `LV-${String(n).padStart(4, '0')}`;
}
async function nextLiveSku(){
  const { doc, runTransaction } = fns();
  const counterRef = doc(db(), 'live_catalog_options', 'skuCounter');
  const n = await runTransaction(db(), async (tx) => {
    const snap = await tx.get(counterRef);
    const current = snap.exists() ? (snap.data().next || 1) : 1;
    tx.set(counterRef, { next: current + 1 }, { merge: true });
    return current;
  });
  return formatLiveSku(n);
}

function db(){ return window.db; }
function fns(){ return window.firestoreFns; }

// ---------- AUTH ----------
function showAuthForm(){
  document.getElementById('authOverlay').style.display = 'flex';
  document.getElementById('authCheckingState').style.display = 'none';
  document.getElementById('authFormState').style.display = 'block';
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

document.getElementById('authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  setAuthError('');
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const submitBtn = document.getElementById('authSubmitBtn');
  submitBtn.disabled = true;
  try{
    await window.authFns.signInWithEmailAndPassword(window.auth, email, password);
  }catch(err){
    setAuthError(err.message || 'Something went wrong.');
  }finally{
    submitBtn.disabled = false;
  }
});

function waitForFirebaseReady(){
  return new Promise(resolve => {
    (function check(){ if (window.firebaseReady) resolve(); else setTimeout(check, 50); })();
  });
}

waitForFirebaseReady().then(() => {
  window.authFns.onAuthStateChanged(window.auth, async (user) => {
    if (!user){ showAuthForm(); return; }
    try{
      const { doc, getDoc } = fns();
      const snap = await getDoc(doc(db(), 'users', user.uid));
      if (snap.exists() && snap.data().status === 'approved'){
        showApp();
        await initLiveCatalog();
      } else {
        setAuthError('Your account is not approved yet — sign in from the main app once approved.');
        await window.authFns.signOut(window.auth);
      }
    }catch(e){
      console.error('Auth check failed:', e);
      setAuthError('Could not verify your account. Try again.');
      showAuthForm();
    }
  });
});

// ---------- INIT: load real catalog items (for suggestions) + custom options ----------
async function initLiveCatalog(){
  try{
    const { collection, getDocs, doc, getDoc } = fns();
    const itemsSnap = await getDocs(collection(db(), 'items'));
    setItems(itemsSnap.docs.map(d => d.data()));
  }catch(e){ console.warn('Could not load catalog items for suggestions:', e); setItems([]); }

  try{
    const { doc, getDoc } = fns();
    const optSnap = await getDoc(doc(db(), 'live_catalog_options', 'main'));
    if (optSnap.exists()) customOptions = { tipos:[], brands:[], sizes:[], colors:[], fabrics:[], measureLabels:[], ...optSnap.data() };
    if (customOptions.labelConfig) labelConfig = customOptions.labelConfig;
  }catch(e){ console.warn('Could not load saved Live Catalog options:', e); }

  renderMeasureLabelOptions();
  initLiveNarration({ rememberIfNew, addMeasureRow });
  initPhotoWidget();
  initPhotoEditWidget();
  await renderSessionList();
}

async function saveCustomOptions(){
  try{
    const { doc, setDoc } = fns();
    await setDoc(doc(db(), 'live_catalog_options', 'main'), customOptions);
  }catch(e){ console.warn('Could not save new option:', e); }
}

// Adds a newly-typed value to the right custom list (if it's genuinely new)
// and persists it — this is what makes "add a new Brand/Tipo/Size" stick
// for next time, same idea as the real catalog's autocomplete lists.
function rememberIfNew(listKey, value){
  if (!value || !value.trim()) return;
  const v = value.trim();
  const existing = new Set([
    ...(listKey === 'tipos' ? PRESET_CLOTHING_TYPES : listKey === 'colors' ? PRESET_COLORS : []),
    ...customOptions[listKey],
  ]);
  if (!existing.has(v)){
    customOptions[listKey] = [...customOptions[listKey], v];
    saveCustomOptions();
  }
}

function renderMeasureLabelOptions(){
  const dl = document.getElementById('lcMeasureLabelOptions');
  const all = Array.from(new Set([...DEFAULT_MEASURE_LABELS, ...customOptions.measureLabels]));
  dl.innerHTML = all.map(l => `<option value="${escapeHtml(l)}">`).join('');
}

function renderFieldOptions(){
  const tipoAll = Array.from(new Set([...PRESET_CLOTHING_TYPES, ...getAllClothingTypes(items), ...customOptions.tipos]));
  document.getElementById('lcTipoOptions').innerHTML = tipoAll.map(t => `<option value="${escapeHtml(t)}">`).join('');
  const brandAll = Array.from(new Set([...getAllBrands(items), ...customOptions.brands]));
  document.getElementById('lcBrandOptions').innerHTML = brandAll.map(b => `<option value="${escapeHtml(b)}">`).join('');
  const currentTipo = document.getElementById('lcTipo').value.trim();
  const sizeAll = Array.from(new Set([...getSizeSuggestionsForType(items, currentTipo), ...customOptions.sizes]));
  document.getElementById('lcSizeOptions').innerHTML = sizeAll.map(s => `<option value="${escapeHtml(s)}">`).join('');
  const colorAll = Array.from(new Set([...PRESET_COLORS, ...customOptions.colors]));
  document.getElementById('lcColorOptions').innerHTML = colorAll.map(c => `<option value="${escapeHtml(c)}">`).join('');
  // No preset fabric list anywhere in the app (main catalog has no
  // structured fabric field either) — just whatever's been typed before.
  document.getElementById('lcFabricOptions').innerHTML = customOptions.fabrics.map(f => `<option value="${escapeHtml(f)}">`).join('');
}
document.getElementById('lcTipo').addEventListener('input', renderFieldOptions);

// ---------- SESSION PICKER ----------
async function renderSessionList(){
  const area = document.getElementById('sessionListArea');
  try{
    const { collection, getDocs } = fns();
    const snap = await getDocs(collection(db(), 'liveSessions'));
    const sessions = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => (b.createdAt||0) - (a.createdAt||0));
    area.innerHTML = sessions.length ? sessions.map(s => `
      <div class="lc-session-card">
        <div>
          <div class="name">${escapeHtml(s.name || 'Untitled live')}</div>
          <div class="meta">${escapeHtml(PLATFORM_LABEL[s.platform] || s.platform || '')} · ${escapeHtml(s.date || '')} · ${s.itemCount || 0} item${(s.itemCount||0)===1?'':'s'}</div>
        </div>
        <button class="icon-btn" data-open-session="${s.id}">Open →</button>
      </div>`).join('') : `<div class="lc-empty">No lives yet — start one below.</div>`;
    area.querySelectorAll('[data-open-session]').forEach(btn => {
      btn.addEventListener('click', () => openSession(sessions.find(s => s.id === btn.dataset.openSession)));
    });
  }catch(e){
    console.error('Failed to load live sessions:', e);
    area.innerHTML = `<div class="lc-empty">Couldn't load your lives — try refreshing.</div>`;
  }
}

// Platform selector reuses the app's real platform vocabulary — "Other"
// (outra) included since a live doesn't have to be on one of the 5
// built-ins. No custom-platform support here (this dropdown doesn't have
// access to appSettings.customPlatforms), which is fine: it's just a
// label on the session, not tied to fee calculation like the real catalog.
(function populatePlatformSelect(){
  const sel = document.getElementById('lcNewSessionPlatform');
  sel.innerHTML = Object.keys(PLATFORM_LABEL).map(key =>
    `<option value="${key}">${escapeHtml(PLATFORM_LABEL[key])}</option>`).join('');
  sel.value = 'poshmark';
})();

// Date defaults to today — she can still change it for a live logged after the fact.
document.getElementById('lcNewSessionDate').valueAsDate = new Date();
document.getElementById('lcCreateSessionBtn').addEventListener('click', async () => {
  const btn = document.getElementById('lcCreateSessionBtn');
  btn.disabled = true;
  try{
    const name = document.getElementById('lcNewSessionName').value.trim() || `Live ${new Date().toLocaleDateString('en-US')}`;
    const platform = document.getElementById('lcNewSessionPlatform').value || 'poshmark';
    const date = document.getElementById('lcNewSessionDate').value || new Date().toISOString().slice(0,10);
    const startNum = parseInt(document.getElementById('lcNewSessionStart').value, 10) || 1;
    const { doc, setDoc } = fns();
    const id = `live_${Date.now()}`;
    const session = { name, platform, date, startNum, nextNum: startNum, itemCount: 0, createdAt: Date.now() };
    await setDoc(doc(db(), 'liveSessions', id), session);
    openSession({ id, ...session });
  }catch(e){
    console.error('Failed to create live session:', e);
    alert(`Couldn't start the live: ${e.message || e}`);
  }finally{
    btn.disabled = false;
  }
});

async function openSession(session){
  if (!session) return;
  currentSession = session;
  document.getElementById('sessionPickerView').style.display = 'none';
  document.getElementById('liveEntryView').style.display = 'block';
  document.getElementById('lcSessionTitle').textContent = session.name;
  document.getElementById('lcSessionMeta').textContent = [PLATFORM_LABEL[session.platform] || session.platform, session.date].filter(Boolean).join(' · ');
  resetForm();
  renderFieldOptions();
  await renderLiveItemsTable();
}
document.getElementById('lcBackToSessions').addEventListener('click', async () => {
  currentSession = null;
  document.getElementById('liveEntryView').style.display = 'none';
  document.getElementById('sessionPickerView').style.display = 'block';
  await renderSessionList();
});

// ---------- QUICK-ADD FORM ----------
function addMeasureRow(label, value){
  measureRowCount++;
  const row = document.createElement('div');
  row.className = 'lc-measure-row';
  row.dataset.rowId = measureRowCount;
  row.innerHTML = `
    <input type="text" list="lcMeasureLabelOptions" placeholder="Measurement (e.g. Pit to pit)" data-measure-label value="${escapeHtml(label || '')}">
    <input type="text" placeholder="Value (e.g. 20 in)" data-measure-value value="${escapeHtml(value || '')}">
    <button type="button" class="rm-btn" data-remove-row title="Remove">✕</button>
  `;
  row.querySelector('[data-remove-row]').addEventListener('click', () => row.remove());
  document.getElementById('lcMeasureRows').appendChild(row);
}
document.getElementById('lcAddMeasureRowBtn').addEventListener('click', () => addMeasureRow());

// ---------- PHOTOS (optional, multiple per item) ----------
// Compressed client-side (same compressImage() the main catalog uses) and
// held as pending data-URLs until "Add item" actually uploads them to
// Storage — mirrors main.js's ensurePhotosHostedForSave pattern (photos
// never sit as base64 inside the Firestore document itself) but scoped to
// its own live-item-photos/ Storage path, fully separate from the real
// catalog's item-photos/.
const MAX_LIVE_PHOTOS = 6;

function initPhotoWidget(){
  const input = document.getElementById('lcPhotoInput');
  const addBtn = document.getElementById('lcPhotoAddBtn');
  addBtn.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const files = Array.from(input.files || []).slice(0, Math.max(0, MAX_LIVE_PHOTOS - currentPhotos.length));
    input.value = '';
    for (const file of files){
      try{
        const dataUrl = await compressImage(file);
        currentPhotos.push(dataUrl);
      }catch(e){ console.error('Photo compression failed:', e); }
    }
    renderPhotoThumbs();
  });
}
function renderPhotoThumbs(){
  const wrap = document.getElementById('lcPhotoThumbs');
  const addBtn = document.getElementById('lcPhotoAddBtn');
  wrap.querySelectorAll('.lc-photo-thumb').forEach(el => el.remove());
  currentPhotos.forEach((src, idx) => {
    const thumb = document.createElement('div');
    thumb.className = 'lc-photo-thumb';
    thumb.innerHTML = `<img src="${src}"><button type="button" class="lc-photo-rm" title="Remove">✕</button>`;
    thumb.querySelector('.lc-photo-rm').addEventListener('click', () => {
      currentPhotos.splice(idx, 1);
      renderPhotoThumbs();
    });
    wrap.insertBefore(thumb, addBtn);
  });
  addBtn.style.display = currentPhotos.length >= MAX_LIVE_PHOTOS ? 'none' : '';
}
async function uploadLivePhotos(itemId, photosArray){
  if (!photosArray.length) return [];
  const { ref, uploadString, getDownloadURL } = window.storageFns;
  const hosted = [];
  for (let i = 0; i < photosArray.length; i++){
    const path = `live-item-photos/${itemId}/${i}_${Date.now()}.jpg`;
    const fileRef = ref(window.storage, path);
    await uploadString(fileRef, photosArray[i], 'data_url');
    hosted.push(await getDownloadURL(fileRef));
  }
  return hosted;
}

// ---------- EDIT PHOTOS ON AN ALREADY-SAVED ITEM ----------
// Every other field in the items table is inline-editable after save
// (tipo/brand/size/color/fabric/prep notes) — photos were the one
// exception, view-only via the thumbnail. This modal closes that gap:
// add more (up to MAX_LIVE_PHOTOS total) or remove existing ones, each
// change written straight to Firestore, same immediate-save pattern the
// rest of the table already uses.
let photoEditItemId = null;

function openPhotoEditModal(itemId){
  const item = liveItemsCache.find(i => i.id === itemId);
  if (!item) return;
  photoEditItemId = itemId;
  renderPhotoEditThumbs();
  document.getElementById('lcPhotoEditOverlay').style.display = 'flex';
}
function closePhotoEditModal(){
  document.getElementById('lcPhotoEditOverlay').style.display = 'none';
  photoEditItemId = null;
}
function renderPhotoEditThumbs(){
  const item = liveItemsCache.find(i => i.id === photoEditItemId);
  const wrap = document.getElementById('lcPhotoEditThumbs');
  const addBtn = document.getElementById('lcPhotoEditAddBtn');
  if (!item) return;
  const photos = item.photos || [];
  wrap.querySelectorAll('.lc-photo-thumb').forEach(el => el.remove());
  photos.forEach((src, idx) => {
    const thumb = document.createElement('div');
    thumb.className = 'lc-photo-thumb';
    thumb.innerHTML = `<img src="${src}"><button type="button" class="lc-photo-rm" title="Remove">✕</button>`;
    thumb.querySelector('.lc-photo-rm').addEventListener('click', () => removeLivePhoto(idx));
    wrap.insertBefore(thumb, addBtn);
  });
  addBtn.style.display = photos.length >= MAX_LIVE_PHOTOS ? 'none' : '';
  document.getElementById('lcPhotoEditCount').textContent = `${photos.length} / ${MAX_LIVE_PHOTOS} photos`;
}
async function removeLivePhoto(idx){
  const item = liveItemsCache.find(i => i.id === photoEditItemId);
  if (!item) return;
  const photos = [...(item.photos || [])];
  photos.splice(idx, 1);
  try{
    const { doc, updateDoc } = fns();
    await updateDoc(doc(db(), 'liveItems', photoEditItemId), { photos });
    item.photos = photos;
    renderPhotoEditThumbs();
    renderLiveItemsTableRows();
  }catch(e){ console.error('Failed to remove photo:', e); alert("Couldn't remove that photo — check your connection and try again."); }
}
function initPhotoEditWidget(){
  const input = document.getElementById('lcPhotoEditInput');
  const addBtn = document.getElementById('lcPhotoEditAddBtn');
  addBtn.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const item = liveItemsCache.find(i => i.id === photoEditItemId);
    if (!item) return;
    const existing = item.photos || [];
    const files = Array.from(input.files || []).slice(0, Math.max(0, MAX_LIVE_PHOTOS - existing.length));
    input.value = '';
    if (!files.length) return;
    addBtn.disabled = true;
    addBtn.textContent = 'Uploading…';
    try{
      const compressed = [];
      for (const file of files){
        try{ compressed.push(await compressImage(file)); }catch(e){ console.error('Photo compression failed:', e); }
      }
      const newUrls = await uploadLivePhotos(photoEditItemId, compressed);
      const photos = [...existing, ...newUrls];
      const { doc, updateDoc } = fns();
      await updateDoc(doc(db(), 'liveItems', photoEditItemId), { photos });
      item.photos = photos;
      renderPhotoEditThumbs();
      renderLiveItemsTableRows();
    }catch(e){
      console.error('Failed to add photo:', e);
      alert("Couldn't upload that photo — check your connection and try again.");
    }finally{
      addBtn.disabled = false;
      addBtn.textContent = '+';
    }
  });
}
document.getElementById('lcPhotoEditCloseBtn').addEventListener('click', closePhotoEditModal);
document.getElementById('lcPhotoEditOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'lcPhotoEditOverlay') closePhotoEditModal();
});

function resetForm(keepNum){
  document.getElementById('lcNum').value = keepNum ?? (currentSession ? currentSession.nextNum : 1);
  document.getElementById('lcTipo').value = '';
  document.getElementById('lcBrand').value = '';
  document.getElementById('lcSize').value = '';
  document.getElementById('lcColor').value = '';
  document.getElementById('lcFabric').value = '';
  document.getElementById('lcNotes').value = '';
  document.getElementById('lcMeasureRows').innerHTML = '';
  measureRowCount = 0;
  // At least 5 rows available every time, per her spec — she can add more,
  // never fewer, so there's always room without an extra click.
  for (let i = 0; i < 5; i++) addMeasureRow();
  currentPhotos = [];
  renderPhotoThumbs();
  document.getElementById('lcNarrationArea').innerHTML = '';
  document.getElementById('lcTipo').focus();
}

document.getElementById('lcAddItemBtn').addEventListener('click', async () => {
  if (!currentSession) return;
  const btn = document.getElementById('lcAddItemBtn');
  btn.disabled = true;
  const originalLabel = btn.textContent;
  try{
    const num = parseInt(document.getElementById('lcNum').value, 10) || currentSession.nextNum;
    const tipo = document.getElementById('lcTipo').value.trim();
    const brand = document.getElementById('lcBrand').value.trim();
    const size = document.getElementById('lcSize').value.trim();
    const color = document.getElementById('lcColor').value.trim();
    const fabric = document.getElementById('lcFabric').value.trim();
    const prepNotes = document.getElementById('lcNotes').value.trim();
    const measurements = Array.from(document.querySelectorAll('#lcMeasureRows .lc-measure-row')).map(row => ({
      label: row.querySelector('[data-measure-label]').value.trim(),
      value: row.querySelector('[data-measure-value]').value.trim(),
    })).filter(m => m.label || m.value);
    const photosToUpload = [...currentPhotos];

    // Nothing is required to save (moving fast during a live) — even a
    // totally blank row still gets a number reserved, editable later.
    rememberIfNew('tipos', tipo);
    rememberIfNew('brands', brand);
    rememberIfNew('sizes', size);
    rememberIfNew('colors', color);
    rememberIfNew('fabrics', fabric);
    measurements.forEach(m => rememberIfNew('measureLabels', m.label));
    renderMeasureLabelOptions();

    const { doc, setDoc, updateDoc } = fns();
    const itemId = `${currentSession.id}_${Date.now()}`;

    if (photosToUpload.length){ btn.textContent = `Uploading photos… (0/${photosToUpload.length})`; }
    const photos = await uploadLivePhotos(itemId, photosToUpload);
    btn.textContent = 'Saving…';
    const sku = await nextLiveSku();

    const itemDoc = { sessionId: currentSession.id, num, sku, tipo, brand, size, color, fabric, prepNotes, measurements, photos, createdAt: Date.now() };
    await setDoc(doc(db(), 'liveItems', itemId), itemDoc);

    // If she edited the number to something higher than the running
    // counter (continuing a previous live's numbering), the sequence
    // picks up from there for the next item — per her spec.
    currentSession.nextNum = Math.max(currentSession.nextNum, num + 1);
    currentSession.itemCount = (currentSession.itemCount || 0) + 1;
    await updateDoc(doc(db(), 'liveSessions', currentSession.id), { nextNum: currentSession.nextNum, itemCount: currentSession.itemCount });

    liveItemsCache.push({ id: itemId, ...itemDoc });
    renderLiveItemsTableRows();
    resetForm();
  }catch(e){
    console.error('Failed to save live item:', e);
    alert("Couldn't save that item — check your connection and try again.");
  }finally{
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
});

// ---------- LIVE ITEMS TABLE ----------
async function renderLiveItemsTable(){
  try{
    const { collection, query, where, getDocs } = fns();
    const snap = await getDocs(query(collection(db(), 'liveItems'), where('sessionId', '==', currentSession.id)));
    liveItemsCache = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => (a.num||0) - (b.num||0));
  }catch(e){
    console.error('Failed to load live items:', e);
    liveItemsCache = [];
  }
  renderLiveItemsTableRows();
}

function measurementsSummary(measurements){
  return (measurements || []).filter(m => m.label || m.value).map(m => `${m.label || '?'}: ${m.value || '—'}`).join(' · ') || '—';
}

// Sale price/buyer/notes only show once "Sold?" is toggled on — but once
// shown, they stay editable indefinitely (per her spec: available and
// editable at any time on the card), not just at the moment of marking.
function saleFieldsHtml(item){
  if (!item.sold) return `<span class="lc-sale-empty">—</span>`;
  return `
    <div class="lc-sale-fields">
      <div><span class="lbl">Sale price</span><input type="text" inputmode="decimal" data-field="soldPrice" value="${escapeHtml(item.soldPrice || '')}" placeholder="e.g. 25"></div>
      <div><span class="lbl">Buyer</span><input type="text" data-field="buyer" value="${escapeHtml(item.buyer || '')}" placeholder="Poshmark username"></div>
      <div><span class="lbl">Notes</span><textarea data-field="notes" placeholder="Anything else">${escapeHtml(item.notes || '')}</textarea></div>
    </div>`;
}

function photoCellHtml(item){
  const photos = item.photos || [];
  return `
    <div class="lc-photo-cell">
      ${photos.length
        ? `<img class="lc-table-photo" src="${photos[0]}" data-view-photos="${item.id}">
           ${photos.length > 1 ? `<div class="lc-table-photo-count">+${photos.length - 1} more</div>` : ''}`
        : `<span class="lc-sale-empty">—</span>`}
      <button type="button" class="lc-photo-edit-btn" data-edit-photos="${item.id}" title="Add/remove photos">✎ Edit</button>
    </div>
  `;
}

function renderLiveItemsTableRows(){
  const body = document.getElementById('lcTableBody');
  if (!liveItemsCache.length){
    body.innerHTML = `<tr><td colspan="14" class="lc-empty">No items yet — add your first one above.</td></tr>`;
    return;
  }
  const sorted = [...liveItemsCache].sort((a,b) => (a.num||0) - (b.num||0));
  body.innerHTML = sorted.map(item => `
    <tr data-item-row="${item.id}">
      <td class="lc-print-col"><input type="checkbox" class="lc-print-chk" data-print-chk="${item.id}"></td>
      <td class="lc-num-cell"><input type="number" data-field="num" value="${item.num ?? ''}"></td>
      <td class="lc-sku-cell">${escapeHtml(item.sku || '—')}</td>
      <td><input type="text" data-field="tipo" value="${escapeHtml(item.tipo || '')}"></td>
      <td><input type="text" data-field="brand" value="${escapeHtml(item.brand || '')}"></td>
      <td><input type="text" data-field="size" value="${escapeHtml(item.size || '')}"></td>
      <td><input type="text" data-field="color" value="${escapeHtml(item.color || '')}"></td>
      <td><input type="text" data-field="fabric" value="${escapeHtml(item.fabric || '')}"></td>
      <td>${photoCellHtml(item)}</td>
      <td class="lc-measure-cell">${escapeHtml(measurementsSummary(item.measurements))}</td>
      <td class="lc-notes-cell"><textarea data-field="prepNotes" placeholder="—">${escapeHtml(item.prepNotes || '')}</textarea></td>
      <td><button class="lc-sold-btn${item.sold ? ' is-sold' : ''}" data-toggle-sold="${item.id}">${item.sold ? '✓ Sold' : 'Sold?'}</button></td>
      <td class="lc-sale-cell">${saleFieldsHtml(item)}</td>
      <td><button class="lc-del-btn" data-delete-item="${item.id}" title="Delete">🗑</button></td>
    </tr>
  `).join('');

  body.querySelectorAll('[data-field]').forEach(input => {
    input.addEventListener('change', async () => {
      const row = input.closest('[data-item-row]');
      const itemId = row.dataset.itemRow;
      const field = input.dataset.field;
      const value = field === 'num' ? (parseInt(input.value, 10) || 0) : input.value.trim();
      try{
        const { doc, updateDoc } = fns();
        await updateDoc(doc(db(), 'liveItems', itemId), { [field]: value });
        const cached = liveItemsCache.find(i => i.id === itemId);
        if (cached) cached[field] = value;
        if (field === 'tipo' || field === 'brand' || field === 'size' || field === 'color' || field === 'fabric'){
          rememberIfNew(field === 'tipo' ? 'tipos' : field === 'brand' ? 'brands' : field === 'size' ? 'sizes' : field === 'color' ? 'colors' : 'fabrics', value);
        }
      }catch(e){ console.error('Failed to update item:', e); }
    });
  });
  body.querySelectorAll('[data-view-photos]').forEach(img => {
    img.addEventListener('click', () => {
      const item = liveItemsCache.find(i => i.id === img.dataset.viewPhotos);
      if (item && item.photos && item.photos.length) window.open(item.photos[0], '_blank');
    });
  });
  body.querySelectorAll('[data-edit-photos]').forEach(btn => {
    btn.addEventListener('click', () => openPhotoEditModal(btn.dataset.editPhotos));
  });
  body.querySelectorAll('[data-toggle-sold]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const itemId = btn.dataset.toggleSold;
      const cached = liveItemsCache.find(i => i.id === itemId);
      if (!cached) return;
      const sold = !cached.sold;
      try{
        const { doc, updateDoc } = fns();
        await updateDoc(doc(db(), 'liveItems', itemId), { sold });
        cached.sold = sold;
        renderLiveItemsTableRows();
      }catch(e){ console.error('Failed to update sold status:', e); }
    });
  });
  body.querySelectorAll('[data-delete-item]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this item from the live list?')) return;
      const itemId = btn.dataset.deleteItem;
      try{
        const { doc, deleteDoc, updateDoc } = fns();
        await deleteDoc(doc(db(), 'liveItems', itemId));
        liveItemsCache = liveItemsCache.filter(i => i.id !== itemId);
        currentSession.itemCount = Math.max(0, (currentSession.itemCount || 1) - 1);
        await updateDoc(doc(db(), 'liveSessions', currentSession.id), { itemCount: currentSession.itemCount });
        renderLiveItemsTableRows();
      }catch(e){ console.error('Failed to delete item:', e); }
    });
  });

  const selectAllChk = document.getElementById('lcPrintSelectAll');
  if (selectAllChk) selectAllChk.checked = false;
}

// ---------- LABEL PRINTING ----------
// Two sheet types:
//  - "sheet": Avery 5260 fixed grid (1" x 2-5/8", 3x10 = 30/sheet). Coordinates
//    match Avery's own published template: 0.1875in left margin, 0.5in top
//    margin, 2.75in horizontal pitch (2.625in label width + 0.125in gutter),
//    1in vertical pitch (label height, no row gap).
//  - "thermal": a continuous strip sized to a chosen label width, one label
//    per item stacked vertically with a dashed cut-guide line between each
//    — for a thermal-roll printer, or a normal printer set to a matching
//    label-roll paper size. Page height is left to the browser/@page "auto"
//    instead of a fixed sheet height.
// Which fields print (SKU/#/Tipo/Brand/Size/Color) and the sheet type/label
// size are all configured in the #lcLabelConfigOverlay modal, with a live
// on-screen preview — no more guessing what the physical sheet will look
// like before committing paper to it.
const LABEL_COLS = 3, LABEL_ROWS = 10, LABELS_PER_SHEET = LABEL_COLS * LABEL_ROWS;
const LABEL_LEFT_IN = 0.1875, LABEL_TOP_IN = 0.5, LABEL_PITCH_X_IN = 2.75, LABEL_PITCH_Y_IN = 1.0;
const THERMAL_PRESETS = {
  '4x6': { w: 4, h: 6 },
  '4x3': { w: 4, h: 3 },
  '2.25x1.25': { w: 2.25, h: 1.25 },
};

let labelConfig = {
  fields: { sku: true, num: true, tipo: true, brand: true, size: true, color: false },
  mode: 'sheet',
  thermalPreset: '4x6',
  thermalW: 4,
  thermalH: 6,
};

function labelContentHtml(item, fields){
  if (!item) return '';
  const metaParts = [];
  if (fields.tipo && item.tipo) metaParts.push(item.tipo);
  if (fields.size && item.size) metaParts.push(item.size);
  const metaLine = metaParts.join(' · ');
  return `
    ${fields.sku ? `<div class="lc-label-sku">${escapeHtml(item.sku || '')}</div>` : ''}
    ${metaLine ? `<div class="lc-label-meta">${escapeHtml(metaLine)}</div>` : ''}
    ${fields.brand && item.brand ? `<div class="lc-label-meta">${escapeHtml(item.brand)}</div>` : ''}
    ${fields.color && item.color ? `<div class="lc-label-meta">${escapeHtml(item.color)}</div>` : ''}
    ${fields.num ? `<div class="lc-label-num">Live #${item.num ?? ''}</div>` : ''}
  `;
}

function labelCellHtml(item, posIndex, fields){
  const col = posIndex % LABEL_COLS;
  const row = Math.floor(posIndex / LABEL_COLS) % LABEL_ROWS;
  const left = (LABEL_LEFT_IN + col * LABEL_PITCH_X_IN).toFixed(4);
  const top = (LABEL_TOP_IN + row * LABEL_PITCH_Y_IN).toFixed(4);
  return `<div class="lc-label" style="left:${left}in; top:${top}in;">${labelContentHtml(item, fields)}</div>`;
}

function buildSheetLabelsHtml(itemsToPrint, startPos, fields){
  // startPos is 1-based (label #1 = top-left) — pad with blank cells up to
  // startPos-1 on the first sheet only.
  const slots = [];
  for (let i = 0; i < Math.max(0, startPos - 1); i++) slots.push(null);
  slots.push(...itemsToPrint);
  const sheetCount = Math.ceil(slots.length / LABELS_PER_SHEET);
  let html = '';
  for (let s = 0; s < sheetCount; s++){
    html += `<div class="lc-label-sheet">`;
    for (let i = 0; i < LABELS_PER_SHEET; i++){
      html += labelCellHtml(slots[s * LABELS_PER_SHEET + i], i, fields);
    }
    html += `</div>`;
  }
  return html;
}

function buildThermalStripHtml(itemsToPrint, w, h, fields){
  const labels = itemsToPrint.map(item => `<div class="lc-thermal-label" style="width:${w}in; height:${h}in;">${labelContentHtml(item, fields)}</div>`);
  return `
    <style>@page{ size:${w}in auto; margin:0; }</style>
    <div class="lc-thermal-strip" style="width:${w}in;">${labels.join('<div class="lc-thermal-cut"></div>')}</div>`;
}

function readLabelFieldsFromUI(){
  return {
    sku: document.getElementById('lcLblSku').checked,
    num: document.getElementById('lcLblNum').checked,
    tipo: document.getElementById('lcLblTipo').checked,
    brand: document.getElementById('lcLblBrand').checked,
    size: document.getElementById('lcLblSize').checked,
    color: document.getElementById('lcLblColor').checked,
  };
}

function currentThermalSize(){
  const preset = document.getElementById('lcThermalSizePreset').value;
  if (preset === 'custom'){
    return {
      w: parseFloat(document.getElementById('lcThermalW').value) || 4,
      h: parseFloat(document.getElementById('lcThermalH').value) || 6,
    };
  }
  return THERMAL_PRESETS[preset] || THERMAL_PRESETS['4x6'];
}

function selectedLabelItems(){
  const checked = Array.from(document.querySelectorAll('.lc-print-chk:checked')).map(chk => chk.dataset.printChk);
  const items = checked.length
    ? liveItemsCache.filter(i => checked.includes(i.id))
    : [...liveItemsCache];
  return items.sort((a,b) => (a.num||0) - (b.num||0));
}

function renderLabelPreview(){
  const area = document.getElementById('lcLabelPreviewArea');
  const fields = readLabelFieldsFromUI();
  const mode = document.getElementById('lcLabelMode').value;
  const items = selectedLabelItems();
  const previewItems = items.slice(0, 6);

  if (!previewItems.length){
    area.innerHTML = `<div class="lc-label-preview-more">No items selected — check rows in the table, or leave none checked to print all.</div>`;
    return;
  }

  if (mode === 'thermal'){
    const { w, h } = currentThermalSize();
    area.innerHTML = previewItems.map(item =>
      `<div class="lc-thermal-label" style="width:${Math.min(w, 3)}in; height:${Math.min(h, 2)}in;">${labelContentHtml(item, fields)}</div>`
    ).join('') + (items.length > previewItems.length ? `<div class="lc-label-preview-more">+${items.length - previewItems.length} more</div>` : '');
  } else {
    area.innerHTML = previewItems.map(item =>
      `<div class="lc-label" style="position:static; width:2.625in; height:1in;">${labelContentHtml(item, fields)}</div>`
    ).join('') + (items.length > previewItems.length ? `<div class="lc-label-preview-more">+${items.length - previewItems.length} more</div>` : '');
  }
}

function updateLabelConfigCount(){
  const count = selectedLabelItems().length;
  const checked = document.querySelectorAll('.lc-print-chk:checked').length;
  document.getElementById('lcLabelConfigCount').textContent = checked
    ? `${count} item(s) selected for printing.`
    : `No rows checked — this will print all ${count} item(s) in this live.`;
}

function openLabelConfigModal(){
  // Restore last-used settings so repeat print runs don't require reconfiguring.
  document.getElementById('lcLblSku').checked = labelConfig.fields.sku;
  document.getElementById('lcLblNum').checked = labelConfig.fields.num;
  document.getElementById('lcLblTipo').checked = labelConfig.fields.tipo;
  document.getElementById('lcLblBrand').checked = labelConfig.fields.brand;
  document.getElementById('lcLblSize').checked = labelConfig.fields.size;
  document.getElementById('lcLblColor').checked = labelConfig.fields.color;
  document.getElementById('lcLabelMode').value = labelConfig.mode;
  document.getElementById('lcThermalSizePreset').value = labelConfig.thermalPreset;
  document.getElementById('lcThermalW').value = labelConfig.thermalW;
  document.getElementById('lcThermalH').value = labelConfig.thermalH;
  toggleLabelModeSections();
  updateLabelConfigCount();
  renderLabelPreview();
  document.getElementById('lcLabelConfigOverlay').style.display = 'flex';
}
function closeLabelConfigModal(){
  document.getElementById('lcLabelConfigOverlay').style.display = 'none';
}
function toggleLabelModeSections(){
  const mode = document.getElementById('lcLabelMode').value;
  document.getElementById('lcSheetOptions').style.display = mode === 'sheet' ? 'block' : 'none';
  document.getElementById('lcThermalOptions').style.display = mode === 'thermal' ? 'block' : 'none';
  const isCustom = document.getElementById('lcThermalSizePreset').value === 'custom';
  document.getElementById('lcThermalCustomSize').style.display = (mode === 'thermal' && isCustom) ? 'flex' : 'none';
}

document.getElementById('lcPrintSelectAll').addEventListener('change', (e) => {
  document.querySelectorAll('.lc-print-chk').forEach(chk => { chk.checked = e.target.checked; });
});

document.getElementById('lcOpenLabelConfigBtn').addEventListener('click', openLabelConfigModal);
document.getElementById('lcLabelConfigCancelBtn').addEventListener('click', closeLabelConfigModal);
document.getElementById('lcLabelConfigOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'lcLabelConfigOverlay') closeLabelConfigModal();
});
['lcLblSku','lcLblNum','lcLblTipo','lcLblBrand','lcLblSize','lcLblColor'].forEach(id => {
  document.getElementById(id).addEventListener('change', renderLabelPreview);
});
document.getElementById('lcLabelMode').addEventListener('change', () => { toggleLabelModeSections(); renderLabelPreview(); });
document.getElementById('lcThermalSizePreset').addEventListener('change', () => { toggleLabelModeSections(); renderLabelPreview(); });
document.getElementById('lcThermalW').addEventListener('input', renderLabelPreview);
document.getElementById('lcThermalH').addEventListener('input', renderLabelPreview);

// Print is triggered directly inside this click handler with no intervening
// confirm()/await — on mobile Safari, a window.print() call that happens
// after a blocking confirm() dialog or an async gap can lose the "user
// activation" the browser requires and silently no-op (this matched a real
// report: printing worked on desktop but did nothing on a phone). Selection
// ambiguity (no rows checked) is now resolved as visible modal text instead
// of a confirm() dialog, specifically to avoid that gap.
document.getElementById('lcLabelConfigPrintBtn').addEventListener('click', () => {
  const items = selectedLabelItems();
  if (!items.length){ alert('No items to print labels for.'); return; }

  const fields = readLabelFieldsFromUI();
  const mode = document.getElementById('lcLabelMode').value;
  labelConfig = {
    fields,
    mode,
    thermalPreset: document.getElementById('lcThermalSizePreset').value,
    thermalW: parseFloat(document.getElementById('lcThermalW').value) || 4,
    thermalH: parseFloat(document.getElementById('lcThermalH').value) || 6,
  };
  customOptions.labelConfig = labelConfig;
  saveCustomOptions();

  if (mode === 'thermal'){
    const { w, h } = currentThermalSize();
    document.getElementById('lcPrintOverlay').innerHTML = buildThermalStripHtml(items, w, h, fields);
  } else {
    const startPos = Math.min(30, Math.max(1, parseInt(document.getElementById('lcPrintStartPos').value, 10) || 1));
    document.getElementById('lcPrintOverlay').innerHTML = buildSheetLabelsHtml(items, startPos, fields);
  }
  closeLabelConfigModal();
  window.print();
});
