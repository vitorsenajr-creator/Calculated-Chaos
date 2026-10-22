// Stock → Pick (UI layer; v3.24.2): sale screenshots in, the sold pieces
// out, box by box. The AI reads each screenshot (one call each, counted by
// the AI usage counter); src/domain/sale-match.js matches the lines to
// items. Nothing is written to Firestore: the screenshots' answers, the
// person's own picks and the "picked" ticks live on this device only.
import { items, appSettings } from '../../modules/state.js';
import { escapeHtml } from '../../modules/format-utils.js';
import { saleLines, buildPickList, boxTitle } from '../../domain/sale-match.js';
import { parseManualCode, addManualCode, removeManualCode, manualLines } from '../../domain/pick-manual.js';
import { prepareScreenshot } from '../../platform/images.js';
import { shareChecklist } from './pick-sheet-canvas.js';
import { openMarkSold, sellableRows } from './pick-sold.js';

const SESSION_KEY = 'cc.pick.session';
const MAX_SHOTS = 20;

let hooks = {
  readSaleScreenshot: async () => ({ ok: false, message: 'Not available.' }),
  platformLabel: (k) => k,
  platformKeys: () => [],
  fee: () => 0,
  markSold: async () => ({ ok: false }),
  onChange: () => {},
  openItem: () => {},
  searchCatalog: () => {},
};

// shots: [{ id, name, status: 'reading'|'done'|'failed'|'skipped', result, message }]
// chosen: line key → item id; platforms: order ref → platform key (the
// person's pick when the AI couldn't tell); picked: line keys ticked.
let st = { shots: [], chosen: {}, platforms: {}, picked: [], manual: [] };
let file = null; // the screenshot files, by shot id, for Try again

function load(){
  try{
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (s && Array.isArray(s.shots)){
      st = {
        // A read cut short by a reload can't finish: offer Try again.
        shots: s.shots.map(x => x.status === 'reading' ? { ...x, status: 'failed', message: 'The reading was interrupted.' } : x),
        chosen: s.chosen && typeof s.chosen === 'object' ? s.chosen : {},
        platforms: s.platforms && typeof s.platforms === 'object' ? s.platforms : {},
        picked: Array.isArray(s.picked) ? s.picked : [],
        // Codes typed in by hand (v3.25.3), in the order typed.
        manual: Array.isArray(s.manual) ? s.manual.filter(c => typeof c === 'string') : [],
      };
    }
  }catch(e){ /* nothing saved, or storage blocked */ }
}
function save(){
  try{ localStorage.setItem(SESSION_KEY, JSON.stringify(st)); }catch(e){ /* not persisted */ }
}

export function initPickView(h){
  hooks = { ...hooks, ...h };
  file = new Map();
  load();
  // On a computer, a screenshot can be pasted while Pick is open.
  document.addEventListener('paste', (e) => {
    const pane = document.getElementById('stockPane-pick');
    if (!pane || pane.hidden || pane.offsetParent === null) return;
    const files = [...(e.clipboardData?.files || [])].filter(f => /^image\//.test(f.type));
    if (!files.length) return;
    e.preventDefault();
    addFiles(files);
  });
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const money = (v) => `$${Number(v).toFixed(2)}`;

function addFiles(files){
  const room = MAX_SHOTS - st.shots.length;
  const list = [...files].filter(f => /^image\//.test(f.type)).slice(0, Math.max(0, room));
  if (!list.length){
    if (room <= 0) flash(`Up to ${MAX_SHOTS} screenshots at a time. Clear the list to start a new one.`);
    return;
  }
  const ids = list.map(f => {
    const id = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    file.set(id, f);
    st.shots.push({ id, name: f.name || 'Pasted screenshot', status: 'reading', result: null, message: '' });
    return id;
  });
  save();
  renderPick();
  // One at a time, so the counter and the server see a steady pace.
  ids.reduce((p, id) => p.then(() => readShot(id)), Promise.resolve());
}

async function readShot(id){
  const shot = st.shots.find(s => s.id === id);
  const f = file.get(id);
  if (!shot) return;
  if (!f){
    Object.assign(shot, { status: 'failed', message: 'Add this screenshot again to read it.' });
    save(); renderPick(); return;
  }
  Object.assign(shot, { status: 'reading', message: '' });
  renderPick();
  let r;
  try{
    const img = await prepareScreenshot(f);
    r = await hooks.readSaleScreenshot({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } });
  }catch(err){
    r = { ok: false, message: err && err.message ? err.message : "That screenshot couldn't be read." };
  }
  const cur = st.shots.find(s => s.id === id);
  if (!cur) return; // removed while it was being read
  if (r && r.ok){
    Object.assign(cur, { status: 'done', result: { isSale: !!r.result.isSale, orders: Array.isArray(r.result.orders) ? r.result.orders : [] } });
  } else {
    Object.assign(cur, { status: r && r.skipped ? 'skipped' : 'failed', message: (r && r.message) || "Couldn't read it." });
  }
  save();
  renderPick();
}

let flashText = '';
let lastList = null; // the pick list on screen, for Print checklist
let lastLines = [];   // and its lines, for Mark sold's order fees
function flash(text){ flashText = text; renderPick(); }

function shotSummary(shot){
  if (shot.status === 'reading') return '<span class="pick-shot-state" role="status">Reading…</span>';
  if (shot.status === 'skipped') return `<span class="pick-shot-state warn">Not read: ${escapeHtml(shot.message)}</span>`;
  if (shot.status === 'failed') return `<span class="pick-shot-state warn">${escapeHtml(stripTags(shot.message))}</span>`;
  const orders = shot.result.orders || [];
  const count = orders.reduce((t, o) => t + (o.items || []).length, 0);
  if (!count) return '<span class="pick-shot-state warn">No sale found in this image</span>';
  return `<span class="pick-shot-state">${plural(orders.length, 'order')} · ${plural(count, 'item')}</span>`;
}
// Error messages from the shared AI caller can carry escaped HTML already.
const stripTags = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

function matchBadge(r){
  const how = r.match.how;
  if (how === 'sku') return `<span class="pick-badge ok">SKU ${escapeHtml(r.line.sku)} ✓</span>`;
  if (how === 'legacy') return `<span class="pick-badge ok">Old code ${escapeHtml(r.line.sku)} ✓</span>`;
  if (how === 'manual') return '<span class="pick-badge ok">Chosen by you</span>';
  const pct = Math.round(r.match.score * 100);
  return `<span class="pick-badge${r.match.confidence === 'high' ? '' : ' warn'}">By name · ${pct}%</span>`;
}

// The package's number in a ring, as printed on the checklist (v3.27.2).
function packBadge(r){
  return r.pack ? `<span class="pick-pack" title="Package ${r.pack}"><span class="visually-hidden">Package </span>${r.pack}</span>` : '';
}

function rowNotes(r){
  const notes = [];
  if (r.recorded){
    const it = r.item;
    notes.push(`<span class="pick-ok">Recorded as sold: ${money(it.soldPrice || 0)}${it.soldPlatform ? ` on ${escapeHtml(hooks.platformLabel(it.soldPlatform))}` : ''}, profit ${money(it.netProfit || 0)}.</span>`);
  }
  if (r.match.skuNotFound) notes.push(`SKU ${escapeHtml(r.line.sku)} isn't a code in the catalog. Check this is the right piece.`);
  else if (r.match.how === 'name' && r.match.confidence !== 'high') notes.push(`Check this is the right piece. The order says: ${escapeHtml(r.line.title)}`);
  if (r.alreadySold) notes.push('Already marked sold in the app.');
  if (r.soldTwice) notes.push('Another sale in this list points to this same item. Check both orders.');
  if (r.listedElsewhere.length){
    const where = r.listedElsewhere.map(p => escapeHtml(hooks.platformLabel(p))).join(', ');
    notes.push(r.platformUnknown
      ? `Listed on ${where}. Delist it from the ones it didn't sell on.`
      : `Still listed on ${where}. Delist it there.`);
  }
  if (r.line.partial) notes.push('Part of this line was cut off in the screenshot.');
  return notes.map(n => n.startsWith('<span class="pick-ok">') ? `<div class="pick-note ok">${n}</div>` : `<div class="pick-note">${n}</div>`).join('');
}

function saleLine(line){
  return [
    line.platform ? escapeHtml(hooks.platformLabel(line.platform)) : 'Platform not recognized (set it above)',
    line.price !== null ? money(line.price) : escapeHtml(line.priceText),
    line.size ? `Size ${escapeHtml(line.size)}` : '',
    line.buyer ? escapeHtml(line.buyer) : '',
  ].filter(Boolean).join(' · ');
}

// A line with no match offers the pieces that came close (v3.27.6), each as a
// small card to compare with the screenshot: "Use this" picks it for the line.
function suggestionsHtml(r){
  const list = r.match.suggestions || [];
  if (!list.length) return '';
  return `
    <div class="pick-sug-head">Possible pieces (check before using)</div>
    ${list.map(a => {
      const it = a.item;
      const photo = (it.photos || [])[0];
      const meta = [it.storageBox ? escapeHtml(boxTitle(it.storageBox)) : '', it.size ? `Size ${escapeHtml(it.size)}` : '', it.listPrice ? money(it.listPrice) : ''].filter(Boolean).join(' · ');
      return `
      <div class="pick-sug">
        ${photo ? `<img class="pick-thumb" src="${escapeHtml(photo)}" alt="" loading="lazy">` : '<span class="pick-thumb empty" aria-hidden="true"></span>'}
        <div class="pick-sug-main">
          <div class="pick-top"><span class="pick-code">${escapeHtml(it.productCode || 'No code')}</span><span class="pick-badge warn">${Math.round(a.score * 100)}%</span>${it.status === 'vendido' ? '<span class="pick-badge">Sold</span>' : ''}</div>
          <div class="pick-title">${escapeHtml(it.name || '')}</div>
          <div class="pick-sub">${meta}</div>
          <div class="pick-alts">
            <button type="button" class="pick-alt" data-choose="${escapeHtml(r.line.key)}" data-item="${escapeHtml(it.id)}">Use this</button>
            <button type="button" class="pick-alt" data-open-item="${escapeHtml(it.id)}">Open</button>
          </div>
        </div>
      </div>`;
    }).join('')}`;
}

function renderRow(r, done){
  const item = r.item;
  const photo = (item.photos || [])[0];
  const alts = r.match.how === 'name' ? r.match.alternatives : [];
  const others = alts.length || r.match.how === 'name' || r.match.how === 'manual' ? `
      <div class="pick-alts">
        ${alts.map(a => `<button type="button" class="pick-alt" data-choose="${escapeHtml(r.line.key)}" data-item="${escapeHtml(a.item.id)}">${escapeHtml(a.item.productCode || '')} ${escapeHtml(a.item.name || '')}</button>`).join('')}
        <button type="button" class="pick-alt" data-search="${escapeHtml(searchText(r.line))}">Search catalog</button>
      </div>` : '';
  return `
    <div class="pick-row${done ? ' done' : ''}">
      <label class="pick-check">
        <input type="checkbox" data-pick="${escapeHtml(r.line.key)}" ${done ? 'checked' : ''}>
        <span class="visually-hidden">Picked ${escapeHtml(item.productCode || item.name || '')}</span>
      </label>
      ${photo ? `<img class="pick-thumb" src="${escapeHtml(photo)}" alt="" loading="lazy">` : '<span class="pick-thumb empty" aria-hidden="true"></span>'}
      <div class="pick-main">
        <div class="pick-top">${packBadge(r)}<span class="pick-code">${escapeHtml(item.productCode || 'No code')}</span>${matchBadge(r)}</div>
        <div class="pick-title">${escapeHtml(item.name || r.line.title)}</div>
        <div class="pick-sub">${saleLine(r.line)}</div>
        ${rowNotes(r)}
        ${others}
      </div>
      <button type="button" class="row-btn" data-open-item="${escapeHtml(item.id)}">Open</button>
    </div>`;
}

// Under a screenshot, one select per order whose platform the AI couldn't
// tell; it sets the platform for every line of that order. The order ref
// matches saleLines(): the order number, else screenshot id + position.
// `shown` keeps an order read from two screenshots to one select.
function platformPickers(shot, shown){
  if (shot.status !== 'done') return '';
  const keys = hooks.platformKeys();
  return (shot.result.orders || []).map((o, oi) => {
    if (o.platform && o.platform !== 'unknown') return '';
    const ref = String(o.orderNumber || '').trim() || `${shot.id}#${oi}`;
    if (shown.has(ref)) return '';
    shown.add(ref);
    const cur = st.platforms[ref] || '';
    const label = o.orderNumber ? `Order …${escapeHtml(String(o.orderNumber).trim().slice(-6))}` : 'This order';
    return `
        <label class="pick-platform">
          <span>${label}: platform not recognized. Sold on</span>
          <select data-order-platform="${escapeHtml(ref)}">
            <option value="">Not sure</option>
            ${keys.map(k => `<option value="${escapeHtml(k)}" ${cur === k ? 'selected' : ''}>${escapeHtml(hooks.platformLabel(k))}</option>`).join('')}
          </select>
        </label>`;
  }).join('');
}

// The lines skipped as repeats, with the item each one was and where it
// was read first.
function skippedHtml(skipped, matchLine){
  if (!skipped.length) return '';
  const nameOf = (id) => (st.shots.find(s => s.id === id) || {}).name || 'an earlier screenshot';
  return `
    <details class="panel pick-skipped">
      <summary><span class="panel-title">Skipped as repeats</span><span class="panel-meta">${plural(skipped.length, 'line')}</span></summary>
      <p class="pick-skipped-desc">These lines were already read from another screenshot of the same order, so they're counted once.</p>
      ${skipped.map(l => {
        const m = matchLine(l);
        return `
        <div class="pick-skip-row">
          <div class="pick-top">${m.item ? `<span class="pick-code">${escapeHtml(m.item.productCode || '')}</span>` : ''}${l.sku ? `<span class="pick-badge">SKU ${escapeHtml(l.sku)}</span>` : ''}</div>
          <div class="pick-title">${escapeHtml(m.item ? (m.item.name || l.title) : l.title)}</div>
          <div class="pick-sub">${saleLine(l)}${l.orderNumber ? ` · Order ${escapeHtml(l.orderNumber)}` : ''}</div>
          <div class="pick-sub">In ${escapeHtml(nameOf(l.source))}; already read from ${escapeHtml(nameOf(l.firstSource))}.</div>
        </div>`;
      }).join('')}
    </details>`;
}

// Words to search the catalog with for a sale the app couldn't place: the
// title's first word, plus the second when it's a plain word (usually the
// brand: "Love Tree", but "John" from "John + Jenn"). The catalog search
// matches the text as typed, so a short start finds more.
function searchText(line){
  const [first = '', second = ''] = line.title.split(/\s+/);
  return /^[\p{L}]+$/u.test(second) ? `${first} ${second}` : first;
}

export function renderPick(){
  const pane = document.getElementById('stockPane-pick');
  if (!pane) return;
  const done = st.shots.filter(s => s.status === 'done');
  const fromShots = saleLines(done.map(s => ({ source: s.id, result: s.result })), st.platforms);
  const skipped = fromShots.skipped;
  // The screenshot lines, then the codes typed in by hand (v3.25.3).
  const lines = [...fromShots.lines, ...manualLines(st.manual)];
  const pl = buildPickList(lines, items, st.chosen);
  lastList = pl;
  lastLines = lines;
  const sellable = sellableRows(pl).length;
  const recorded = pl.boxes.flatMap(b => b.rows).filter(r => r.recorded).length;
  const picked = new Set(st.picked);
  const pickedCount = lines.filter(l => picked.has(l.key)).length;

  const shown = new Set();
  const shotsHtml = st.shots.map(s => `
    <li class="pick-shot">
      <span class="pick-shot-text">
        <span class="pick-shot-name">${escapeHtml(s.name)}</span>
        ${shotSummary(s)}
        ${platformPickers(s, shown)}
      </span>
      ${s.status === 'failed' ? `<button type="button" class="row-btn" data-retry="${s.id}">Try again</button>` : ''}
      <button type="button" class="row-btn" data-remove-shot="${s.id}" aria-label="Remove ${escapeHtml(s.name)}">Remove</button>
    </li>`).join('');

  const boxesHtml = pl.boxes.map(b => {
    const n = b.rows.filter(r => picked.has(r.line.key)).length;
    return `
      <section class="panel pick-box">
        <div class="panel-head">
          <h3 class="panel-title">${escapeHtml(boxTitle(b.box))}</h3>
          <span class="panel-meta">${plural(b.rows.length, 'item')}${n ? ` · ${n} picked` : ''}</span>
        </div>
        ${b.rows.map(r => renderRow(r, picked.has(r.line.key))).join('')}
      </section>`;
  }).join('');

  const unmatchedHtml = pl.unmatched.length ? `
    <section class="panel pick-box">
      <div class="panel-head">
        <h3 class="panel-title">Not found in the catalog</h3>
        <span class="panel-meta">${plural(pl.unmatched.length, 'item')}</span>
      </div>
      ${pl.unmatched.map(r => `
        <div class="pick-row">
          <span class="pick-thumb empty" aria-hidden="true"></span>
          <div class="pick-main">
            <div class="pick-top">${packBadge(r)}${r.line.sku ? `<span class="pick-code">SKU ${escapeHtml(r.line.sku)}</span>` : ''}</div>
            <div class="pick-title">${escapeHtml(r.line.title)}</div>
            <div class="pick-sub">${saleLine(r.line)}</div>
            ${r.line.partial ? '<div class="pick-note">Part of this line was cut off in the screenshot.</div>' : ''}
            ${suggestionsHtml(r)}
            <div class="pick-alts"><button type="button" class="pick-alt" data-search="${escapeHtml(searchText(r.line))}">Search catalog</button></div>
          </div>
        </div>`).join('')}
    </section>` : '';

  const reading = st.shots.some(s => s.status === 'reading');
  const summary = lines.length ? `
    <section class="panel pick-summary">
      <div class="panel-head">
        <h2 class="panel-title">To pick</h2>
        <span class="panel-meta">${plural(lines.length, 'item')} from ${plural(pl.orders, 'order')}${skipped.length ? ` · ${plural(skipped.length, 'repeat')} skipped (below)` : ''}</span>
      </div>
      <div class="pick-progress">
        <progress max="${lines.length}" value="${pickedCount}" aria-label="Picked"></progress>
        <span>${pickedCount} of ${lines.length} picked</span>
      </div>
      <div class="pick-print-row">
        ${sellable ? `<button type="button" class="primary-btn" id="pickSoldBtn">Mark sold (${sellable})</button>` : ''}
        <button type="button" class="secondary-btn" id="pickShareBtn">Share checklist</button>
        ${recorded ? `<span class="pick-hint">${plural(recorded, 'sale')} recorded</span>` : ''}
      </div>
    </section>` : '';

  pane.innerHTML = `
    <section class="panel stock-form">
      <h2 class="panel-title">Pick sold items</h2>
      <p class="stock-form-desc">Add screenshots of your sales (an order page on Poshmark, eBay, Mercari…). The app reads each one, finds the pieces by SKU or by name and lists them box by box. Each screenshot uses one AI analysis.</p>
      <div class="stock-form-row">
        <label class="primary-btn pick-add">Add screenshots<input type="file" id="pickFileInput" class="visually-hidden" accept="image/*" multiple></label>
        ${st.shots.length || st.manual.length ? '<button type="button" class="secondary-btn" id="pickClearBtn">Clear list</button>' : ''}
      </div>
      <div class="pick-typed">
        <label class="pick-typed-label" for="pickCodeInput">Item code</label>
        <div class="stock-form-row">
          <input type="text" id="pickCodeInput" class="pick-code-input" inputmode="numeric" autocomplete="off" placeholder="0897">
          <button type="button" class="secondary-btn" id="pickCodeAdd">Add</button>
        </div>
        <p class="goal-error" id="pickCodeError" role="alert" hidden></p>
        ${st.manual.length ? `<ul class="pick-chips">${st.manual.map(c => `<li class="pick-chip"><span>${escapeHtml(c)}</span><button type="button" data-remove-code="${escapeHtml(c)}" aria-label="Remove ${escapeHtml(c)}">×</button></li>`).join('')}</ul>` : ''}
      </div>
      <p class="pick-hint">On a computer you can also paste a screenshot here (Ctrl+V or ⌘V).</p>
      ${flashText ? `<p class="pick-flash" role="status">${escapeHtml(flashText)}</p>` : ''}
      ${shotsHtml ? `<ul class="pick-shots">${shotsHtml}</ul>` : ''}
    </section>
    ${summary}
    ${boxesHtml}
    ${unmatchedHtml}
    ${skippedHtml(skipped, pl.matchLine)}
    ${!lines.length && done.length && !reading ? '<div class="attn-empty pick-empty">No sold items were found in these screenshots.</div>' : ''}`;
  flashText = '';
  wire(pane);
}

function wire(pane){
  const codeInput = pane.querySelector('#pickCodeInput');
  const codeError = pane.querySelector('#pickCodeError');
  // Only the list is redrawn here, never on each keystroke (iOS keyboard).
  const addTyped = () => {
    const parsed = parseManualCode(codeInput.value);
    if (!parsed.ok){ codeError.textContent = parsed.error; codeError.hidden = false; codeInput.focus(); return; }
    const r = addManualCode(st.manual, parsed.code);
    if (r.duplicate){ codeError.textContent = `${parsed.code} is already in the list.`; codeError.hidden = false; codeInput.select(); return; }
    st.manual = r.list;
    save();
    renderPick();
    pane.querySelector('#pickCodeInput').focus();
  };
  codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter'){ e.preventDefault(); addTyped(); } });
  codeInput.addEventListener('input', () => { codeError.hidden = true; });
  pane.querySelector('#pickCodeAdd').addEventListener('click', addTyped);
  pane.querySelectorAll('[data-remove-code]').forEach(b => b.addEventListener('click', () => {
    st.manual = removeManualCode(st.manual, b.dataset.removeCode);
    save();
    renderPick();
  }));
  pane.querySelector('#pickFileInput').addEventListener('change', (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    addFiles(files);
  });
  pane.querySelector('#pickClearBtn')?.addEventListener('click', () => {
    if (!confirm('Clear the screenshots, the typed codes and the picked marks?')) return;
    st = { shots: [], chosen: {}, platforms: {}, picked: [], manual: [] };
    file.clear();
    save();
    renderPick();
  });
  pane.querySelectorAll('[data-retry]').forEach(b => b.addEventListener('click', () => readShot(b.dataset.retry)));
  pane.querySelectorAll('[data-remove-shot]').forEach(b => b.addEventListener('click', () => {
    st.shots = st.shots.filter(s => s.id !== b.dataset.removeShot);
    file.delete(b.dataset.removeShot);
    save();
    renderPick();
  }));
  pane.querySelectorAll('[data-pick]').forEach(cb => cb.addEventListener('change', () => {
    const set = new Set(st.picked);
    if (cb.checked) set.add(cb.dataset.pick); else set.delete(cb.dataset.pick);
    st.picked = [...set].slice(-500);
    save();
    renderPick();
    pane.querySelector(`[data-pick="${CSS.escape(cb.dataset.pick)}"]`)?.focus();
  }));
  pane.querySelectorAll('[data-choose]').forEach(b => b.addEventListener('click', () => {
    st.chosen = { ...st.chosen, [b.dataset.choose]: b.dataset.item };
    save();
    renderPick();
  }));
  pane.querySelectorAll('[data-order-platform]').forEach(sel => sel.addEventListener('change', () => {
    const platforms = { ...st.platforms };
    if (sel.value) platforms[sel.dataset.orderPlatform] = sel.value; else delete platforms[sel.dataset.orderPlatform];
    st.platforms = platforms;
    save();
    renderPick();
  }));
  pane.querySelector('#pickSoldBtn')?.addEventListener('click', () => {
    if (lastList) openMarkSold(lastList, lastLines, hooks);
  });
  // Synchronous inside the click: the share sheet needs the tap (iOS Safari).
  pane.querySelector('#pickShareBtn')?.addEventListener('click', () => {
    if (!lastList) return;
    shareChecklist(lastList, {
      picked: new Set(st.picked),
      storeName: (appSettings.storeName || '').trim(),
      platformLabel: hooks.platformLabel,
    });
  });
  pane.querySelectorAll('[data-open-item]').forEach(b => b.addEventListener('click', () => hooks.openItem(b.dataset.openItem)));
  pane.querySelectorAll('[data-search]').forEach(b => b.addEventListener('click', () => hooks.searchCatalog(b.dataset.search)));
}
