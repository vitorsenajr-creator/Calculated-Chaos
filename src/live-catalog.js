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
import { PRESET_CLOTHING_TYPES, PLATFORM_LABEL } from './modules/constants.js';
import { escapeHtml } from './modules/format-utils.js';

// Common garment measurement labels — same vocabulary the main app's
// measure tool already uses (Top/Pants/Dress/Outerwear categories,
// flattened into one list here since a live sale moves too fast to also
// pick a garment category first). Any custom-typed label gets added to
// this list going forward too, same as Tipo/Brand/Size.
const DEFAULT_MEASURE_LABELS = [
  'Pit to pit', 'Length', 'Sleeve length', 'Shoulder to shoulder',
  'Waist', 'Hip', 'Inseam', 'Rise', 'Width', 'Neck', 'Thigh', 'Length (insole)',
];

let customOptions = { tipos: [], brands: [], sizes: [], fabrics: [], measureLabels: [] };
let currentSession = null; // { id, name, date, startNum, nextNum, itemCount }
let liveItemsCache = [];   // items in the currently-open session
let measureRowCount = 0;

function db(){ return window.db; }
function fns(){ return window.firestoreFns; }

// ---------- AUTH ----------
function showAuthForm(){ document.getElementById('authOverlay').style.display = 'flex'; }
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
    if (optSnap.exists()) customOptions = { tipos:[], brands:[], sizes:[], fabrics:[], measureLabels:[], ...optSnap.data() };
  }catch(e){ console.warn('Could not load saved Live Catalog options:', e); }

  renderMeasureLabelOptions();
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
  const existing = new Set([...(listKey === 'tipos' ? PRESET_CLOTHING_TYPES : []), ...customOptions[listKey]]);
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

function resetForm(keepNum){
  document.getElementById('lcNum').value = keepNum ?? (currentSession ? currentSession.nextNum : 1);
  document.getElementById('lcTipo').value = '';
  document.getElementById('lcBrand').value = '';
  document.getElementById('lcSize').value = '';
  document.getElementById('lcFabric').value = '';
  document.getElementById('lcMeasureRows').innerHTML = '';
  measureRowCount = 0;
  // At least 5 rows available every time, per her spec — she can add more,
  // never fewer, so there's always room without an extra click.
  for (let i = 0; i < 5; i++) addMeasureRow();
  document.getElementById('lcTipo').focus();
}

document.getElementById('lcAddItemBtn').addEventListener('click', async () => {
  if (!currentSession) return;
  const btn = document.getElementById('lcAddItemBtn');
  btn.disabled = true;
  try{
    const num = parseInt(document.getElementById('lcNum').value, 10) || currentSession.nextNum;
    const tipo = document.getElementById('lcTipo').value.trim();
    const brand = document.getElementById('lcBrand').value.trim();
    const size = document.getElementById('lcSize').value.trim();
    const fabric = document.getElementById('lcFabric').value.trim();
    const measurements = Array.from(document.querySelectorAll('#lcMeasureRows .lc-measure-row')).map(row => ({
      label: row.querySelector('[data-measure-label]').value.trim(),
      value: row.querySelector('[data-measure-value]').value.trim(),
    })).filter(m => m.label || m.value);

    // Nothing is required to save (moving fast during a live) — even a
    // totally blank row still gets a number reserved, editable later.
    rememberIfNew('tipos', tipo);
    rememberIfNew('brands', brand);
    rememberIfNew('sizes', size);
    rememberIfNew('fabrics', fabric);
    measurements.forEach(m => rememberIfNew('measureLabels', m.label));
    renderMeasureLabelOptions();

    const { doc, setDoc, updateDoc } = fns();
    const itemId = `${currentSession.id}_${Date.now()}`;
    const itemDoc = { sessionId: currentSession.id, num, tipo, brand, size, fabric, measurements, createdAt: Date.now() };
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

function renderLiveItemsTableRows(){
  const body = document.getElementById('lcTableBody');
  if (!liveItemsCache.length){
    body.innerHTML = `<tr><td colspan="9" class="lc-empty">No items yet — add your first one above.</td></tr>`;
    return;
  }
  const sorted = [...liveItemsCache].sort((a,b) => (a.num||0) - (b.num||0));
  body.innerHTML = sorted.map(item => `
    <tr data-item-row="${item.id}">
      <td class="lc-num-cell"><input type="number" data-field="num" value="${item.num ?? ''}"></td>
      <td><input type="text" data-field="tipo" value="${escapeHtml(item.tipo || '')}"></td>
      <td><input type="text" data-field="brand" value="${escapeHtml(item.brand || '')}"></td>
      <td><input type="text" data-field="size" value="${escapeHtml(item.size || '')}"></td>
      <td><input type="text" data-field="fabric" value="${escapeHtml(item.fabric || '')}"></td>
      <td class="lc-measure-cell">${escapeHtml(measurementsSummary(item.measurements))}</td>
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
        if (field === 'tipo' || field === 'brand' || field === 'size' || field === 'fabric'){
          rememberIfNew(field === 'tipo' ? 'tipos' : field === 'brand' ? 'brands' : field === 'size' ? 'sizes' : 'fabrics', value);
        }
      }catch(e){ console.error('Failed to update item:', e); }
    });
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
}
