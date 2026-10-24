// Monthly AI allowance per business (v3.28.1, docs/multi-tenant.md step 5).
// Pure helpers shared by the server (api/_aiAllowance.js, which enforces
// it) and the app (Settings → AI usage, which shows it).
//
// A business with a positive `aiMonthlyLimit` on its doc (new stores get
// 100, domain/new-business.js) may make that many AI calls per calendar
// month in UTC, every call type counted (Vitor, 2026-10-23). The count is
// the store's monthly counter (`ai_allowance/{bizId}__{month}`, v3.28.8),
// which the server raises by one in a transaction before each call and
// lowers again when the call fails; a month with no counter yet starts from
// the ai_usage meter (api/_aiUsage.js). A business without the field has no
// server limit.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

// The limit on a business doc, or null when there is none.
export function businessAiLimit(bizData){
  const v = bizData && bizData.aiMonthlyLimit;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : null;
}

// Calls in a list of ai_usage rows.
export function usedCalls(rows){
  return (rows || []).reduce((sum, r) => sum + (typeof r?.calls === 'number' && r.calls > 0 ? r.calls : 0), 0);
}

// The store's counter doc id for a month (v3.28.8). Doc ids can't hold '/'.
export function allowanceDocId(bizId, month){
  return `${String(bizId).replace(/[^a-zA-Z0-9_.-]/g, '_')}__${month}`;
}

// Units held on a counter doc (never negative).
export function counterUsed(data){
  const v = data && data.used;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

// 'YYYY-MM' → the first day of the next month, 'YYYY-MM-01'.
export function resetDate(month){
  const [y, m] = String(month).split('-').map(Number);
  const next = m === 12 ? [y + 1, 1] : [y, m + 1];
  return `${next[0]}-${String(next[1]).padStart(2, '0')}-01`;
}

export function monthName(month){
  return MONTHS[Number(String(month).split('-')[1]) - 1] || month;
}

// { limited, limit, used, remaining, allowed, month, resetsOn }.
export function allowanceOf({ limit, used, month }){
  if (!limit) return { limited: false, limit: null, used, remaining: null, allowed: true, month, resetsOn: null };
  const remaining = Math.max(0, limit - used);
  return { limited: true, limit, used, remaining, allowed: remaining > 0, month, resetsOn: resetDate(month) };
}

// The message for a refused call.
export function limitMessage({ limit, month }){
  const next = resetDate(month);
  const day = `${monthName(next.slice(0, 7))} 1`;
  return `Your store used its ${limit} AI actions for ${monthName(month)}. They reset on ${day}.`;
}
