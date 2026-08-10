// Voice narration capture for the standard Add Item modal — record a short
// spoken description while holding the item, transcribe it (Deepgram
// Nova-3, server-side), then extract catalog fields from the transcript
// (Claude Haiku 4.5, server-side) for review before applying to the form.
// New in this session — modularized immediately rather than added to
// main.js, same reasoning as modules/sold-confirm.js: cheaper to keep out
// of the IIFE now than to extract later.
//
// Design decisions (discussed 2026-08-10 with Vitor):
// - Audio is never persisted anywhere — sent to /api/narration
//   (action:'transcribe'), discarded client-side the moment the transcript
//   comes back. The serverless function never writes it to disk/Storage.
// - English only — Deepgram is called with language=en, no auto-detect,
//   since the narrator doesn't speak Portuguese.
// - The review card only shows fields the extraction actually found a
//   value for — unlike the photo-analysis card (analyzeItemPhoto/
//   renderAiAnalysis in main.js), which always shows its four fixed fields
//   regardless of what the AI found.
// - Applying to the form always asks before overwriting a field that
//   already holds a different value, via the same browser confirm()
//   pattern used everywhere else in this app for destructive actions —
//   most relevant when she's already run photo analysis on the same item.
import { escapeHtml } from './format-utils.js';
import { PRESET_COLORS, PRESET_CLOTHING_TYPES } from './constants.js';

const MAX_RECORDING_MS = 120000; // 2 min safety cutoff — auto-stop if she forgets to tap stop

const CONDITION_LABELS = {
  novo_etiqueta: 'New with tags',
  novo_sem_etiqueta: 'New without tags',
  excelente: 'Used — excellent',
  bom: 'Used — good',
  aceitavel: 'Used — fair',
  defeito: 'Flawed (for parts/repair)',
};

function pickSupportedMimeType(){
  const candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'];
  for (const type of candidates){
    if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type)){
      return type;
    }
  }
  return ''; // let the browser pick its own default
}

function blobToBase64(blob){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      // reader.result is "data:<mime>;base64,<data>" — strip the prefix
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

// Applies value to a <select id=selectId> + "Add new…"/"Other…" <input
// id=otherId> pair — the pattern already used throughout this modal
// (Category, Color, Clothing Type). Falls back to the other-input when the
// value isn't one of the select's known options.
function applySelectOrOther(selectId, otherId, value){
  const select = document.getElementById(selectId);
  const other = document.getElementById(otherId);
  if (!select || !value) return;
  const known = Array.from(select.options).map(o => o.value);
  if (known.includes(value)){
    select.value = value;
    if (other){ other.style.display = 'none'; other.value = ''; }
  } else {
    select.value = '__other__';
    if (other){ other.value = value; other.style.display = 'block'; }
  }
}

// Field key (from the extraction JSON) -> { label, targetId } — targetId is
// what the overwrite-conflict check reads/writes for that field.
const FIELD_META = {
  name:          { label: 'Item name', targetId: 'fName' },
  brand:         { label: 'Brand', targetId: 'fBrand' },
  gender:        { label: 'Gender', targetId: 'fGender' },
  clothing_type: { label: 'Clothing type', targetId: 'fClothingType' },
  color:         { label: 'Color', targetId: 'fColor' },
  size:          { label: 'Size', targetId: 'fSize' },
  category:      { label: 'Category', targetId: 'fCategory' },
  condition:     { label: 'Condition', targetId: 'fCondition' },
  price:         { label: 'Price', targetId: 'fListPrice' },
  notes:         { label: 'Notes', targetId: 'fNotes' },
};

export function initNarrationCapture(){
  const btn = document.getElementById('narrateItemBtn');
  const area = document.getElementById('narrationAnalysisArea');
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
    if (mediaRecorder && mediaRecorder.state === 'recording'){
      stopRecording();
    } else {
      startRecording();
    }
  });

  function currentFieldValue(key){
    const el = document.getElementById(FIELD_META[key].targetId);
    if (!el) return '';
    return (el.value || '').trim();
  }

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
        area.innerHTML = `<div class="ai-error">Couldn't reach the transcription service. Please try again.</div>`;
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

      const promptText = `You are helping catalog a secondhand item for resale on eBay/Mercari/Poshmark from a spoken narration. The seller described the item out loud while holding it. Here is the transcript:

"${transcript.replace(/"/g, '\\"')}"

Respond with ONLY a JSON object (no markdown fences, no preamble), with this exact shape — use an empty string "" (or null for price) for anything not mentioned or not confidently inferable. Do not guess just to fill a field:
{
  "name": "short item name/description, e.g. 'Levi's 501 denim jacket', or empty string if unclear",
  "brand": "brand name if mentioned, else empty string",
  "gender": "one of: Women's, Men's, Girls', Boys', Unisex — or empty string if not mentioned/not applicable",
  "clothing_type": "if this is clothing/shoes/bag/accessory, one of: ${PRESET_CLOTHING_TYPES.join(', ')}, or another specific type if none fit. Empty string if not applicable or not mentioned.",
  "color": "one of: ${PRESET_COLORS.join(', ')}, or another specific color if none fit. Empty string if not mentioned.",
  "size": "size exactly as mentioned, e.g. 'M', '32x30', '8.5' — empty string if not mentioned",
  "category": "a short general category, e.g. Clothing, Shoes, Home Goods — empty string if unclear",
  "condition": "one of: novo_etiqueta (still has tags/new with tags), novo_sem_etiqueta (new without tags), excelente (used, excellent condition), bom (used, good condition), aceitavel (used, fair condition, visible wear), defeito (flawed, for parts/repair) — only if something about condition/tags/wear was actually said, else empty string",
  "price": number or null (asking/listing price in USD, only if a specific price was explicitly said out loud),
  "notes": "anything else mentioned that doesn't fit above — fabric/material, measurements, flaws, care instructions, etc., combined into one short readable note. Empty string if nothing extra was said."
}
Respond with the JSON object only. Do not include any text, explanation, or markdown formatting before or after it. Your entire response must be parseable as JSON.`;

      const extractRes = await fetch('/api/narration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ action: 'extract', promptText }),
      });
      if (!extractRes.ok){
        area.innerHTML = `<div class="ai-error">Couldn't reach the AI right now. Please check your connection and try again.</div>`;
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
      console.error('Narration processing error:', err);
      area.innerHTML = `<div class="ai-error">Something went wrong processing the narration. Please try again.</div>`;
      setIdleUI();
    }
  }

  function renderReview(transcript, result){
    // Only fields the extraction actually found something for — unlike the
    // photo-analysis card, which always shows its fixed set of fields.
    const detected = Object.keys(FIELD_META).filter(key => {
      const v = result[key];
      return v !== null && v !== undefined && String(v).trim() !== '';
    });

    if (detected.length === 0){
      area.innerHTML = `
        <div class="ai-analysis-box">
          <div class="ai-tag">Narration transcribed — no fields detected</div>
          <div class="ai-reasoning">"${escapeHtml(transcript)}"</div>
          <div class="ai-disclaimer">Didn't find anything usable in that narration. Try again with more specific details (brand, size, color, price...).</div>
          <div class="ai-actions">
            <button id="narrationDismissBtn">Dismiss</button>
          </div>
        </div>`;
      document.getElementById('narrationDismissBtn').addEventListener('click', () => { area.innerHTML = ''; });
      return;
    }

    const rows = detected.map(key => {
      const meta = FIELD_META[key];
      const value = key === 'price' ? Number(result.price).toFixed(2) : String(result[key]);
      const inputId = `narr_${key}`;
      const isTextarea = key === 'notes';
      return `
        <div style="margin-bottom:10px;">
          <div style="font-size:10px; text-transform:uppercase; letter-spacing:0.04em; color:var(--plum-soft); font-weight:700; margin-bottom:4px;">${escapeHtml(meta.label)}</div>
          ${isTextarea
            ? `<textarea id="${inputId}" style="width:100%; min-height:56px; padding:8px 11px; border:1px solid var(--line); border-radius:8px; font-size:13px; color:var(--plum); background:var(--white);">${escapeHtml(value)}</textarea>`
            : `<input type="text" id="${inputId}" value="${escapeHtml(value)}" style="width:100%; padding:8px 11px; border:1px solid var(--line); border-radius:8px; font-size:13px; color:var(--plum); background:var(--white);">`
          }
        </div>`;
    }).join('');

    area.innerHTML = `
      <div class="ai-analysis-box">
        <div class="ai-tag">Narration transcribed — review & apply</div>
        <details style="margin-bottom:10px;">
          <summary style="cursor:pointer; font-size:12px; color:var(--plum-soft);">Show transcript</summary>
          <div class="ai-reasoning" style="margin-top:6px;">"${escapeHtml(transcript)}"</div>
        </details>
        ${rows}
        <div class="ai-disclaimer">Only fields the narration actually mentioned are shown — adjust anything before applying.</div>
        <div class="ai-actions">
          <button id="narrationApplyBtn" class="apply-btn">✓ Apply to form</button>
          <button id="narrationDismissBtn">Dismiss</button>
        </div>
      </div>`;

    document.getElementById('narrationApplyBtn').addEventListener('click', () => {
      // Pull the (possibly hand-edited) values from the review inputs.
      const pending = {};
      detected.forEach(key => {
        const el = document.getElementById(`narr_${key}`);
        const v = (el.value || '').trim();
        if (v) pending[key] = v;
      });

      // Always ask before overwriting a field that already has a different
      // value — most relevant when photo analysis already filled the form.
      const conflicts = Object.keys(pending).filter(key => {
        const existing = currentFieldValue(key);
        return existing && existing !== pending[key];
      });
      if (conflicts.length > 0){
        const list = conflicts.map(key => FIELD_META[key].label).join(', ');
        if (!confirm(`This will overwrite the following field(s) that already have a value: ${list}. Continue?`)) return;
      }

      Object.entries(pending).forEach(([key, value]) => {
        switch(key){
          case 'name': document.getElementById('fName').value = value; break;
          case 'brand': document.getElementById('fBrand').value = value; break;
          case 'size': document.getElementById('fSize').value = value; break;
          case 'notes': document.getElementById('fNotes').value = value; break;
          case 'price': document.getElementById('fListPrice').value = (parseFloat(value) || 0).toFixed(2); break;
          case 'gender': document.getElementById('fGender').value = value; break;
          case 'condition':
            if (CONDITION_LABELS[value]) document.getElementById('fCondition').value = value;
            break;
          case 'clothing_type': applySelectOrOther('fClothingType', 'fClothingTypeOther', value); break;
          case 'color': applySelectOrOther('fColor', 'fColorOther', value); break;
          case 'category': applySelectOrOther('fCategory', 'fCategoryOther', value); break;
        }
      });

      area.innerHTML = `
        <div style="font-size:12px; color:var(--sage-deep); background:rgba(127,150,120,0.12); padding:9px 12px; border-radius:10px; margin-bottom:14px;">
          ✓ Narration applied — review the form below and adjust anything before saving.
        </div>`;
    });

    document.getElementById('narrationDismissBtn').addEventListener('click', () => { area.innerHTML = ''; });
  }
}
