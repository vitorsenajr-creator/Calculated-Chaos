// AI usage meter (v3.24.5): pure helpers, no DOM and no Firebase. Each
// successful Anthropic call adds one increment to a document per user,
// month, call type and model (api/_aiUsage.js writes them); the Developer
// Panel adds the documents up (api/platform.js action 'ai_usage').

// The call types the server records, named after the app's AI features.
// Keys match what each endpoint sends: analyze-photo's mode, plus the
// narration, eBay and Pick calls. narration_transcribe is Deepgram, not
// Anthropic (v3.28.8): it has no tokens, only calls.
export const AI_CALL_LABELS = {
  full: 'Photo analysis & listing',
  listing_only: 'Listing rewrite',
  import_map: 'Import column check',
  sale_screenshot: 'Pick: sale screenshot',
  narration_transcribe: 'Narration transcription',
  narration_extract: 'Narration extract',
  suggest_fee: 'Suggested fee',
  explain_error: 'eBay error explanation',
};

// Month key in UTC, 'YYYY-MM', so every server sees the same month.
export function usageMonth(date = new Date()){
  return date.toISOString().slice(0, 7);
}

// One document per user × month × call × model. Doc ids can't contain '/',
// so anything odd is replaced.
export function usageDocId({ month, uid, call, model }){
  return [month, uid || 'anonymous', call, model]
    .map(part => String(part || 'unknown').replace(/[^a-zA-Z0-9_.-]/g, '_'))
    .join('__');
}

// Names of the tools the model asked for in this response (tool_use blocks).
// The calls send no tools today, so this stays empty until a call adds them.
export function toolNamesFrom(content){
  return (Array.isArray(content) ? content : [])
    .filter(block => block && block.type === 'tool_use' && block.name)
    .map(block => String(block.name));
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

// The numbers to add for one call. Tools go in a nested map, one count per
// tool name, so the server can add them with a merge.
export function usageIncrements({ usage, tools }){
  const u = usage || {};
  const toolCounts = {};
  for (const name of tools || []){
    const key = String(name).replace(/[^a-zA-Z0-9_-]/g, '_');
    toolCounts[key] = (toolCounts[key] || 0) + 1;
  }
  return {
    calls: 1,
    inputTokens: num(u.input_tokens),
    outputTokens: num(u.output_tokens),
    cacheWriteTokens: num(u.cache_creation_input_tokens),
    cacheReadTokens: num(u.cache_read_input_tokens),
    tools: toolCounts,
  };
}

const TOTAL_KEYS = ['calls', 'inputTokens', 'outputTokens', 'cacheWriteTokens', 'cacheReadTokens'];

function emptyTotals(){
  return Object.fromEntries(TOTAL_KEYS.map(k => [k, 0]));
}

function addInto(target, row){
  for (const k of TOTAL_KEYS) target[k] += num(row[k]);
  return target;
}

function addTools(target, tools){
  for (const [name, count] of Object.entries(tools || {})) {
    target[name] = (target[name] || 0) + num(count);
  }
  return target;
}

// Adds the stored rows up: the grand total, one line per call type, one
// line per user (with their business and tools) and the tools in total.
// Lists come back busiest first.
export function summarizeUsage(rows){
  const total = emptyTotals();
  const tools = {};
  const byCall = {};
  const byUser = {};
  for (const row of rows || []) {
    addInto(total, row);
    addTools(tools, row.tools);

    const callKey = row.call || 'unknown';
    byCall[callKey] = byCall[callKey] || { call: callKey, ...emptyTotals() };
    addInto(byCall[callKey], row);

    const userKey = row.uid || 'anonymous';
    byUser[userKey] = byUser[userKey] || { uid: row.uid || null, bizId: row.bizId || null, tools: {}, ...emptyTotals() };
    if (!byUser[userKey].bizId && row.bizId) byUser[userKey].bizId = row.bizId;
    addInto(byUser[userKey], row);
    addTools(byUser[userKey].tools, row.tools);
  }
  const busiest = (a, b) => b.calls - a.calls || (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens);
  return {
    total,
    tools,
    byCall: Object.values(byCall).sort(busiest),
    byUser: Object.values(byUser).sort(busiest),
  };
}
