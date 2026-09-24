// Records every eBay publish failure in Firestore (`ebay_error_log`), one
// doc per distinct error (eBay errorId + message), with a running count —
// so new, not-yet-understood errors pile up in one place (Settings →
// "eBay error library") instead of only ever existing as a phone
// screenshot. Entries the library (modules/ebay-error-hints.js) doesn't
// recognize are flagged, and are what to turn into new library entries.
//
// Best-effort everywhere: a logging failure (offline, Firestore rules)
// must never get in the way of the publish flow itself.

import { escapeHtml } from './format-utils.js';
import { EBAY_ERROR_LIBRARY } from './ebay-error-hints.js';

const COLLECTION = 'ebay_error_log';

function hashString(str){
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// Same error on a different item still counts as the same error: the
// message's item-specific bits (quoted values, numbers) are stripped
// before hashing.
function logDocId(code, message){
  const shape = String(message || '').toLowerCase()
    .replace(/"[^"]*"|“[^”]*”/g, '""')
    .replace(/\d+/g, '#')
    .slice(0, 200);
  return `${code || 'nocode'}_${hashString(shape)}`;
}

// errors: diagnoseEbayFailure(...).errors
export async function logEbayFailure(result, item, errors){
  try{
    const fns = window.firestoreFns;
    if (!fns || !window.db) return;
    const list = errors && errors.length
      ? errors
      : [{ code: null, message: (result && (result.error || result.message)) || 'Unknown failure', key: null }];
    const now = new Date().toISOString();
    for (const e of list){
      const ref = fns.doc(window.db, COLLECTION, logDocId(e.code, e.message));
      await fns.runTransaction(window.db, async (tx) => {
        const snap = await tx.get(ref);
        const prev = snap.exists() ? snap.data() : null;
        tx.set(ref, {
          code: e.code || null,
          message: String(e.message || '').slice(0, 1000),
          libraryKey: e.key || null,
          step: (result && result.step) || null,
          count: (prev?.count || 0) + 1,
          firstSeen: prev?.firstSeen || now,
          lastSeen: now,
          lastItem: item ? { id: item.id || null, name: item.name || null, productCode: item.productCode || null } : null,
          lastCategory: result?.categoryPathUsed || item?.ebayCategoryPath || null,
          aiExplanation: prev?.aiExplanation || null,
        });
      });
    }
  }catch(e){
    console.warn('eBay error log write failed (non-blocking):', e);
  }
}

// Stores the AI's explanation on the log entries for these errors, so the
// Settings screen shows it next to the raw message and it can be turned
// into a permanent library entry later.
export async function saveAiExplanationToLog(errors, explanation){
  try{
    const fns = window.firestoreFns;
    if (!fns || !window.db || !errors || !errors.length) return;
    for (const e of errors){
      await fns.setDoc(fns.doc(window.db, COLLECTION, logDocId(e.code, e.message)), { aiExplanation: explanation }, { merge: true });
    }
  }catch(e){
    console.warn('Saving AI explanation to eBay error log failed (non-blocking):', e);
  }
}

async function loadEbayErrorLog(){
  const fns = window.firestoreFns;
  const snap = await fns.getDocs(fns.collection(window.db, COLLECTION));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

const fmtDate = (iso) => { try{ return new Date(iso).toLocaleString(); }catch(e){ return iso || ''; } };

// Settings → "eBay error library". Exposed on window (see main.js), same
// pattern as runEbayAudit — its result area lives inside renderSettings()'s
// HTML, rebuilt on every render.
export async function runEbayErrorLibrary(){
  const area = document.getElementById('ebayErrorLibraryResult');
  if (!area) return;
  area.innerHTML = `<div style="opacity:0.7; font-size:13px;">⏳ Loading…</div>`;
  let log = [];
  let loadError = null;
  try{ log = await loadEbayErrorLog(); }catch(e){ loadError = e.message || String(e); }

  const unknown = log.filter(e => !e.libraryKey).sort((a, b) => String(b.lastSeen).localeCompare(String(a.lastSeen)));
  const known = log.filter(e => e.libraryKey).sort((a, b) => String(b.lastSeen).localeCompare(String(a.lastSeen)));
  const titleFor = (key) => (EBAY_ERROR_LIBRARY.find(x => x.key === key) || {}).title || key;

  const row = (e) => `
    <div style="padding:8px 0; border-top:1px solid var(--line); font-size:13px; line-height:1.4;">
      <div><b>${e.code ? `#${escapeHtml(String(e.code))}` : 'No code'}</b> · seen ${e.count || 1}× · last ${escapeHtml(fmtDate(e.lastSeen))}${e.step ? ` · step "${escapeHtml(e.step)}"` : ''}</div>
      ${e.libraryKey ? `<div style="color:var(--sage-deep);">✓ ${escapeHtml(titleFor(e.libraryKey))}</div>` : ''}
      <div style="opacity:0.8;">${escapeHtml(e.message || '')}</div>
      ${e.aiExplanation ? `<div style="margin-top:4px; padding:6px 8px; background:rgba(0,0,0,0.04); border-radius:6px;">🤖 ${escapeHtml(e.aiExplanation)}</div>` : ''}
      ${e.lastItem?.name ? `<div style="font-size:12px; opacity:0.65;">Last item: ${escapeHtml(e.lastItem.productCode ? e.lastItem.productCode + ' — ' : '')}${escapeHtml(e.lastItem.name)}${e.lastCategory ? ` · ${escapeHtml(e.lastCategory)}` : ''}</div>` : ''}
    </div>`;

  let html = `<div class="ebay-connect-box"><div class="ec-sub">`;
  if (loadError){
    html += `<div style="color:var(--danger); font-size:13px;">Couldn't load the error log: ${escapeHtml(loadError)}</div>`;
  }
  html += `<div style="margin-bottom:10px;"><b style="color:var(--danger);">❓ Not in the library yet (${unknown.length})</b>`;
  html += unknown.length ? unknown.map(row).join('') : `<div style="font-size:13px; opacity:0.7; margin-top:4px;">None — every error seen so far is recognized.</div>`;
  html += `</div>`;
  html += `<div style="margin-bottom:10px;"><b style="color:var(--sage-deep);">✅ Recognized, seen on this account (${known.length})</b>`;
  html += known.length ? known.map(row).join('') : `<div style="font-size:13px; opacity:0.7; margin-top:4px;">None logged yet.</div>`;
  html += `</div>`;
  html += `<details><summary style="cursor:pointer; font-size:13px; font-weight:600;">📚 Everything the app knows how to fix (${EBAY_ERROR_LIBRARY.length})</summary>`;
  html += EBAY_ERROR_LIBRARY.map(x => `<div style="padding:6px 0; border-top:1px solid var(--line); font-size:13px;"><b>${escapeHtml(x.title)}</b>${x.codes.length ? ` <span style="opacity:0.6;">(${x.codes.map(c => '#' + c).join(', ')})</span>` : ''}</div>`).join('');
  html += `</details></div></div>`;
  area.innerHTML = html;
}
