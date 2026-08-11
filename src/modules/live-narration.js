// Voice narration capture for the Live Catalog quick-add form — same
// record/transcribe/extract pipeline as modules/narration-capture.js (the
// standard Add Item modal's version), reusing the same /api/narration.js
// endpoints untouched, but targeting Live Catalog's own field set (Tipo/
// Brand/Size/Color/Fabric/Measurements/Notes) instead of the main catalog
// form. Kept as its own module rather than generalizing narration-capture.js
// to take a field map, since the two forms' fields, IDs, and review-card
// wiring don't overlap enough to share cleanly — same reasoning that kept
// sold-confirm.js and dashboard.js as separate modules from day one.
import { escapeHtml } from './format-utils.js';
import { PRESET_COLORS } from './constants.js';

const MAX_RECORDING_MS = 120000; // 2 min safety cutoff, same as the main modal's narration

function pickSupportedMimeType(){
  const candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'];
  for (const type of candidates){
    if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type)){
      return type;
    }
  }
  return '';
}

function blobToBase64(blob){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const commaIdx = reader.result.indexOf(',');
      resolve(reader.result.slice(commaIdx + 1));
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function formatSeconds(totalSeconds){
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// initLiveNarration(opts) — opts.rememberIfNew(listKey, value) lets a
// narrated Tipo/Brand/Size/Color/Fabric feed the same autocomplete-memory
// lists the typed inputs already use; opts.addMeasureRow(label, value) and
// opts.getEmptyMeasureRowEls() let it fill the existing measurement rows
// instead of duplicating that row-building logic here.
export function initLiveNarration({ rememberIfNew, addMeasureRow }){
  const btn = document.getElementById('lcNarrateBtn');
  const area = document.getElementById('lcNarrationArea');
  if (!btn || !area) return;

  let mediaRecorder = null;
  let audioChunks = [];
  let recordingStartedAt = 0;
  let timerInterval = null;

  function setIdleUI(){
    clearInterval(timerInterval);
    btn.textContent = '🎙️ Narrate item';
    btn.classList.remove('recording');
    btn.disabled = false;
  }

  function setRecordingUI(){
    btn.classList.add('recording');
    const tick = () => {
      const elapsed = Math.floor((Date.now() - recordingStartedAt) / 1000);
      btn.textContent = `⏹ Stop (${formatSeconds(elapsed)})`;
    };
    tick();
    timerInterval = setInterval(tick, 1000);
    area.innerHTML = `
      <div class="ai-analysis-box">
        <div class="ai-tag">🎙️ Recording — mention tipo, brand, size, color, fabric/composition, measurements, anything else</div>
      </div>`;
  }

  async function startRecording(){
    let stream;
    try{
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }catch(err){
      alert('Microphone access is required to narrate an item. Please allow microphone access and try again.');
      return;
    }
    const mimeType = pickSupportedMimeType();
    try{
      mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    }catch(err){
      alert("Couldn't start recording on this device/browser.");
      stream.getTracks().forEach(t => t.stop());
      return;
    }
    audioChunks = [];
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      clearInterval(timerInterval);
      const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || mimeType || 'audio/webm' });
      audioChunks = [];
      processRecording(blob);
    };
    recordingStartedAt = Date.now();
    mediaRecorder.start();
    setRecordingUI();
    setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
    }, MAX_RECORDING_MS);
  }

  function stopRecording(){
    if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
  }

  btn.addEventListener('click', () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') stopRecording();
    else startRecording();
  });

  async function processRecording(blob){
    btn.disabled = true;
    btn.textContent = '🎙️ Processing…';
    area.innerHTML = `<div class="ai-loading">Listening to the narration…</div>`;

    try{
      const audioBase64 = await blobToBase64(blob);
      const idToken = await window.auth.currentUser.getIdToken();

      const transcribeRes = await fetch('/api/narration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ action: 'transcribe', audioBase64, mimeType: blob.type }),
      });
      if (!transcribeRes.ok){
        const errData = await transcribeRes.json().catch(() => null);
        area.innerHTML = `
          <div class="ai-error">
            Couldn't reach the transcription service: ${escapeHtml(errData?.error || `HTTP ${transcribeRes.status}`)}
            ${errData?.detail ? `<div style="margin-top:8px; padding:8px; background:rgba(0,0,0,0.04); border-radius:6px; font-family:monospace; font-size:11px; white-space:pre-wrap;">${escapeHtml(JSON.stringify(errData.detail, null, 2))}</div>` : ''}
          </div>`;
        setIdleUI();
        return;
      }
      const { transcript } = await transcribeRes.json();
      if (!transcript || !transcript.trim()){
        area.innerHTML = `<div class="ai-error">Didn't catch any speech in that recording. Please try again.</div>`;
        setIdleUI();
        return;
      }

      area.innerHTML = `<div class="ai-loading">Pulling out the details…</div>`;

      const promptText = `You are helping catalog an item for a live-sale "lot list" (Poshmark/similar live shopping) from a spoken narration. The seller described the item out loud while holding it, right before presenting it live. Here is the transcript:

"${transcript.replace(/"/g, '\\"')}"

Respond with ONLY a JSON object (no markdown fences, no preamble), with this exact shape — use an empty string "" for anything not mentioned or not confidently inferable, and an empty array for measurements if none were mentioned. Do not guess just to fill a field:
{
  "tipo": "the item type, e.g. 'Sweater', 'Jeans', 'Dress' — empty string if unclear",
  "brand": "brand name if mentioned, else empty string",
  "size": "size exactly as mentioned, e.g. 'M', '32x30' — empty string if not mentioned",
  "color": "one of: ${PRESET_COLORS.join(', ')}, or another specific color if none fit. Empty string if not mentioned.",
  "fabric": "fabric/material composition if mentioned, e.g. '100% cotton', '80% polyester 20% spandex' — empty string if not mentioned",
  "measurements": [{"label": "e.g. Pit to pit, Length, Waist, Sleeve length", "value": "e.g. 20 in"}] — one entry per measurement actually stated, empty array if none,
  "notes": "anything else mentioned that doesn't fit above — flaws, condition, styling notes, etc. Empty string if nothing extra was said."
}
Respond with the JSON object only. Do not include any text, explanation, or markdown formatting before or after it. Your entire response must be parseable as JSON.`;

      const extractRes = await fetch('/api/narration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ action: 'extract', promptText }),
      });
      if (!extractRes.ok){
        const errData = await extractRes.json().catch(() => null);
        area.innerHTML = `
          <div class="ai-error">
            Couldn't reach the AI: ${escapeHtml(errData?.error || `HTTP ${extractRes.status}`)}
            ${errData?.detail ? `<div style="margin-top:8px; padding:8px; background:rgba(0,0,0,0.04); border-radius:6px; font-family:monospace; font-size:11px; white-space:pre-wrap;">${escapeHtml(JSON.stringify(errData.detail, null, 2))}</div>` : ''}
          </div>`;
        setIdleUI();
        return;
      }
      const data = await extractRes.json();
      const textBlock = data.content && data.content.find(b => b.type === 'text');
      if (!textBlock){
        area.innerHTML = `<div class="ai-error">The AI didn't return a usable response. Please try again.</div>`;
        setIdleUI();
        return;
      }

      let cleaned = textBlock.text.replace(/```json|```/gi, '').trim();
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace){
        area.innerHTML = `<div class="ai-error">Couldn't make sense of the AI's response. Please try again.</div>`;
        setIdleUI();
        return;
      }
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);

      let result;
      try{
        result = JSON.parse(cleaned);
      }catch(parseErr){
        area.innerHTML = `<div class="ai-error">Couldn't make sense of the AI's response. Please try again.</div>`;
        setIdleUI();
        return;
      }

      renderReview(transcript, result);
      setIdleUI();
    }catch(err){
      console.error('Live narration processing error:', err);
      area.innerHTML = `<div class="ai-error">Something went wrong processing the narration. Please try again.</div>`;
      setIdleUI();
    }
  }

  const FIELD_LABELS = { tipo: 'Tipo', brand: 'Brand', size: 'Size', color: 'Color', fabric: 'Fabric', notes: 'Notes' };

  function renderReview(transcript, result){
    const textKeys = Object.keys(FIELD_LABELS).filter(k => result[k] && String(result[k]).trim());
    const measurements = Array.isArray(result.measurements) ? result.measurements.filter(m => m && (m.label || m.value)) : [];

    if (textKeys.length === 0 && measurements.length === 0){
      area.innerHTML = `
        <div class="ai-analysis-box">
          <div class="ai-tag">Narration transcribed — no fields detected</div>
          <div class="ai-reasoning">"${escapeHtml(transcript)}"</div>
          <div class="ai-disclaimer">Didn't find anything usable in that narration. Try again with more specific details.</div>
          <div class="ai-actions"><button id="lcNarrDismissBtn">Dismiss</button></div>
        </div>`;
      document.getElementById('lcNarrDismissBtn').addEventListener('click', () => { area.innerHTML = ''; });
      return;
    }

    const rows = textKeys.map(key => {
      const inputId = `lcNarr_${key}`;
      const isTextarea = key === 'notes';
      const value = String(result[key]);
      return `
        <div style="margin-bottom:10px;">
          <div style="font-size:10px; text-transform:uppercase; letter-spacing:0.04em; color:var(--plum-soft); font-weight:700; margin-bottom:4px;">${escapeHtml(FIELD_LABELS[key])}</div>
          ${isTextarea
            ? `<textarea id="${inputId}" style="width:100%; min-height:44px; padding:8px 11px; border:1px solid var(--line); border-radius:8px; font-size:13px; color:var(--plum); background:var(--white);">${escapeHtml(value)}</textarea>`
            : `<input type="text" id="${inputId}" value="${escapeHtml(value)}" style="width:100%; padding:8px 11px; border:1px solid var(--line); border-radius:8px; font-size:13px; color:var(--plum); background:var(--white);">`
          }
        </div>`;
    }).join('');

    const measurementsNote = measurements.length
      ? `<div style="font-size:12px; color:var(--plum-soft); margin-bottom:10px;">+ ${measurements.length} measurement${measurements.length === 1 ? '' : 's'} detected: ${escapeHtml(measurements.map(m => `${m.label || '?'} ${m.value || ''}`).join(', '))}</div>`
      : '';

    area.innerHTML = `
      <div class="ai-analysis-box">
        <div class="ai-tag">Narration transcribed — review & apply</div>
        <details style="margin-bottom:10px;">
          <summary style="cursor:pointer; font-size:12px; color:var(--plum-soft);">Show transcript</summary>
          <div class="ai-reasoning" style="margin-top:6px;">"${escapeHtml(transcript)}"</div>
        </details>
        ${rows}
        ${measurementsNote}
        <div class="ai-disclaimer">Only fields the narration actually mentioned are shown — adjust anything before applying. This fills the form above; it doesn't save the item yet.</div>
        <div class="ai-actions">
          <button id="lcNarrApplyBtn" class="apply-btn">✓ Apply to form</button>
          <button id="lcNarrDismissBtn">Dismiss</button>
        </div>
      </div>`;

    document.getElementById('lcNarrApplyBtn').addEventListener('click', () => {
      const currentFieldValue = (fieldId) => (document.getElementById(fieldId)?.value || '').trim();
      const targetIds = { tipo: 'lcTipo', brand: 'lcBrand', size: 'lcSize', color: 'lcColor', fabric: 'lcFabric' };

      const pending = {};
      textKeys.forEach(key => {
        const el = document.getElementById(`lcNarr_${key}`);
        const v = (el.value || '').trim();
        if (v) pending[key] = v;
      });

      // Notes appends (never destructive); every other field asks before
      // overwriting an existing different value — same pattern as the main
      // modal's narration (modules/narration-capture.js).
      const conflicts = Object.keys(pending).filter(key => {
        if (key === 'notes') return false;
        const existing = currentFieldValue(targetIds[key]);
        return existing && existing !== pending[key];
      });
      if (conflicts.length > 0){
        const list = conflicts.map(key => FIELD_LABELS[key]).join(', ');
        if (!confirm(`This will overwrite the following field(s) that already have a value: ${list}. Continue?`)) return;
      }

      Object.entries(pending).forEach(([key, value]) => {
        if (key === 'notes'){
          // Prep notes append rather than overwrite — same "never
          // destructive" treatment notes gets in the main modal's
          // narration (modules/narration-capture.js). Distinct from the
          // per-item SALE notes field (item.notes, only shown once "Sold?"
          // is toggled) — this is item.prepNotes, captured before the live.
          const notesEl = document.getElementById('lcNotes');
          const existing = (notesEl.value || '').trim();
          notesEl.value = existing ? `${existing}\n${value}` : value;
          return;
        }
        document.getElementById(targetIds[key]).value = value;
        const listKey = key === 'tipo' ? 'tipos' : key === 'brand' ? 'brands' : key === 'size' ? 'sizes' : key === 'color' ? 'colors' : 'fabrics';
        rememberIfNew(listKey, value);
      });

      if (measurements.length){
        // Existing blank rows get filled first (the form always starts with
        // 5 empty rows), then new rows are added for any overflow — avoids
        // piling up duplicate empty rows every time narration runs.
        const existingRows = Array.from(document.querySelectorAll('#lcMeasureRows .lc-measure-row'));
        let rowIdx = 0;
        measurements.forEach(m => {
          while (rowIdx < existingRows.length){
            const row = existingRows[rowIdx];
            const labelEl = row.querySelector('[data-measure-label]');
            const valueEl = row.querySelector('[data-measure-value]');
            rowIdx++;
            if (!labelEl.value.trim() && !valueEl.value.trim()){
              labelEl.value = m.label || '';
              valueEl.value = m.value || '';
              return;
            }
          }
          addMeasureRow(m.label, m.value);
        });
      }

      area.innerHTML = `
        <div style="font-size:12px; color:var(--sage-deep); background:rgba(127,150,120,0.12); padding:9px 12px; border-radius:10px; margin-bottom:14px;">
          ✓ Narration applied — review the form above before adding the item.
        </div>`;
    });

    document.getElementById('lcNarrDismissBtn').addEventListener('click', () => { area.innerHTML = ''; });
  }
}
