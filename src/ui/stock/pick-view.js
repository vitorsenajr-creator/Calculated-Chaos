// Stock → Pick (UI layer; v3.24.2): sale screenshots in, the sold pieces
// out, box by box. The AI reads each screenshot (one call each, counted by
// the AI usage counter); src/domain/sale-match.js matches the lines to
// items. Nothing is written to Firestore: the screenshots' answers, the
// person's own picks and the "picked" ticks live on this device only.
import { items } from '../../modules/state.js';
import { escapeHtml } from '../../modules/format-utils.js';
import { saleLines, buildPickList } from '../../domain/sale-match.js';
import { prepareScreenshot } from '../../platform/images.js';

const SESSION_KEY = 'cc.pick.session';
const MAX_SHOTS = 20;

let hooks = {
  readSaleScreenshot: async () => ({ ok: false, message: 'Not available.' }),
  platformLabel: (k) => k,
  openItem: () => {},
  searchCatalog: () => {},
};

// shots: [{ id, name, status: 'reading'|'done'|'failed'|'skipped', result, message }]
let st = { shots: [], chosen: {}, picked: [] };
let file = null; // the screenshot files, by shot id, for Try again

function load(){
  try{
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (s && Array.isArray(s.shots)){
      st = {
        // A read cut short by a reload can't finish: offer Try again.
        shots: s.shots.map(x => x.status === 'reading' ? { ...x, status: 'failed', message: 'The reading was interrupted.' } : x),
        chosen: s.chosen && typeof s.chosen === 'object' ? s.chosen : {},
        picked: Array.isArray(s.picked) ? s.picked : [],
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

function rowNotes(r){
  const notes = [];
  if (r.match.skuNotFound) notes.push(`SKU ${escapeHtml(r.line.sku)} isn't a code in the catalog. Check this is the right piece.`);
  else if (r.match.how === 'name' && r.match.confidence !== 'high') notes.push('Check this is the right piece.');
  if (r.alreadySold) notes.push('Already marked sold in the app.');
  if (r.soldTwice) notes.push('Another sale in this list points to this same item. Check both orders.');
  if (r.listedElsewhere.length) notes.push(`Still listed on ${r.listedElsewhere.map(p => escapeHtml(hooks.platformLabel(p))).join(', ')}. Delist it there.`);
  if (r.line.partial) notes.push('Part of this line was cut off in the screenshot.');
  return notes.map(n => `<div class="pick-note">${n}</div>`).join('');
}

function saleLine(line){
  return [
    line.platform ? escapeHtml(hooks.platformLabel(line.platform)) : '',
    line.price !== null ? money(line.price) : escapeHtml(line.priceText),
    line.size ? `Size ${escapeHtml(line.size)}` : '',
    line.buyer ? escapeHtml(line.buyer) : '',
  ].filter(Boolean).join(' · ');
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
        <div class="pick-top"><span class="pick-code">${escapeHtml(item.productCode || 'No code')}</span>${matchBadge(r)}</div>
        <div class="pick-title">${escapeHtml(item.name || r.line.title)}</div>
        <div class="pick-sub">${saleLine(r.line)}</div>
        ${rowNotes(r)}
        ${others}
      </div>
      <button type="button" class="row-btn" data-open-item="${escapeHtml(item.id)}">Open</button>
    </div>`;
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
  const { lines, repeats } = saleLines(done.map(s => ({ source: s.id, result: s.result })));
  const pl = buildPickList(lines, items, st.chosen);
  const picked = new Set(st.picked);
  const pickedCount = lines.filter(l => picked.has(l.key)).length;

  const shotsHtml = st.shots.map(s => `
    <li class="pick-shot">
      <span class="pick-shot-text">
        <span class="pick-shot-name">${escapeHtml(s.name)}</span>
        ${shotSummary(s)}
      </span>
      ${s.status === 'failed' ? `<button type="button" class="row-btn" data-retry="${s.id}">Try again</button>` : ''}
      <button type="button" class="row-btn" data-remove-shot="${s.id}" aria-label="Remove ${escapeHtml(s.name)}">Remove</button>
    </li>`).join('');

  const boxesHtml = pl.boxes.map(b => {
    const n = b.rows.filter(r => picked.has(r.line.key)).length;
    return `
      <section class="panel pick-box">
        <div class="panel-head">
          <h3 class="panel-title">${b.box ? `Box ${escapeHtml(b.box)}` : 'No box'}</h3>
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
            <div class="pick-top">${r.line.sku ? `<span class="pick-code">SKU ${escapeHtml(r.line.sku)}</span>` : ''}</div>
            <div class="pick-title">${escapeHtml(r.line.title)}</div>
            <div class="pick-sub">${saleLine(r.line)}</div>
            ${r.line.partial ? '<div class="pick-note">Part of this line was cut off in the screenshot.</div>' : ''}
            <div class="pick-alts"><button type="button" class="pick-alt" data-search="${escapeHtml(searchText(r.line))}">Search catalog</button></div>
          </div>
        </div>`).join('')}
    </section>` : '';

  const reading = st.shots.some(s => s.status === 'reading');
  const summary = lines.length ? `
    <section class="panel pick-summary">
      <div class="panel-head">
        <h2 class="panel-title">To pick</h2>
        <span class="panel-meta">${plural(lines.length, 'item')} from ${plural(pl.orders, 'order')}${repeats ? ` · ${plural(repeats, 'repeat')} skipped` : ''}</span>
      </div>
      <div class="pick-progress">
        <progress max="${lines.length}" value="${pickedCount}" aria-label="Picked"></progress>
        <span>${pickedCount} of ${lines.length} picked</span>
      </div>
    </section>` : '';

  pane.innerHTML = `
    <section class="panel stock-form">
      <h2 class="panel-title">Pick sold items</h2>
      <p class="stock-form-desc">Add screenshots of your sales (an order page on Poshmark, eBay, Mercari…). The app reads each one, finds the pieces by SKU or by name and lists them box by box. Each screenshot uses one AI analysis.</p>
      <div class="stock-form-row">
        <label class="primary-btn pick-add">Add screenshots<input type="file" id="pickFileInput" class="visually-hidden" accept="image/*" multiple></label>
        ${st.shots.length ? '<button type="button" class="secondary-btn" id="pickClearBtn">Clear list</button>' : ''}
      </div>
      <p class="pick-hint">On a computer you can also paste a screenshot here (Ctrl+V or ⌘V).</p>
      ${flashText ? `<p class="pick-flash" role="status">${escapeHtml(flashText)}</p>` : ''}
      ${shotsHtml ? `<ul class="pick-shots">${shotsHtml}</ul>` : ''}
    </section>
    ${summary}
    ${boxesHtml}
    ${unmatchedHtml}
    ${!lines.length && done.length && !reading ? '<div class="attn-empty pick-empty">No sold items were found in these screenshots.</div>' : ''}`;
  flashText = '';
  wire(pane);
}

function wire(pane){
  pane.querySelector('#pickFileInput').addEventListener('change', (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    addFiles(files);
  });
  pane.querySelector('#pickClearBtn')?.addEventListener('click', () => {
    if (!confirm('Clear the screenshots and the picked marks?')) return;
    st = { shots: [], chosen: {}, picked: [] };
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
  pane.querySelectorAll('[data-open-item]').forEach(b => b.addEventListener('click', () => hooks.openItem(b.dataset.openItem)));
  pane.querySelectorAll('[data-search]').forEach(b => b.addEventListener('click', () => hooks.searchCatalog(b.dataset.search)));
}
