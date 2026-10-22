// The Pick activity log (v3.27.7): pure logic, no DOM, window or Firebase.
// One entry per action in Stock → Pick, kept per user so anything can be traced:
// a screenshot read, a sale recorded, the list cleared, the checklist shared.
// Entries are { id, at, uid, email, type, …details }; they are only ever added.

export const PICK_LOG_TYPES = ['screenshot', 'sold', 'clear', 'checklist'];
const CODES_MAX = 60;

// Firestore refuses undefined, and a clear can name hundreds of pieces:
// keep the lists short and drop empty values.
export function cleanDetails(details){
  const out = {};
  Object.entries(details || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    out[k] = Array.isArray(v) ? v.slice(0, CODES_MAX).map(x => String(x)) : v;
  });
  return out;
}

export function makeEntry(type, details, user, at = Date.now(), rand = Math.random()){
  return {
    id: `${at}-${Math.floor(rand * 1e6).toString(36)}`,
    at,
    uid: user && user.uid ? user.uid : '',
    email: user && user.email ? user.email : '',
    type,
    ...cleanDetails(details),
  };
}

// [start, end) in ms of a local month, from "YYYY-MM".
export function monthRange(ym){
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ''));
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return [new Date(y, mo - 1, 1).getTime(), new Date(y, mo, 1).getTime()];
}

export const monthOf = (at) => {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const money = (v) => (Number.isFinite(Number(v)) ? `$${Number(v).toFixed(2)}` : '');

// One line of text for an entry.
export function describeEntry(e){
  if (e.type === 'screenshot'){
    const orders = e.orderNumbers && e.orderNumbers.length ? ` (${e.orderNumbers.join(', ')})` : '';
    return `Read a screenshot${e.file ? ` "${e.file}"` : ''}: ${plural(Number(e.orders) || 0, 'order')}${orders}, ${plural(Number(e.pieces) || 0, 'piece')}.`;
  }
  if (e.type === 'sold'){
    const parts = [
      e.price !== undefined ? `${money(e.price)}${e.platform ? ` on ${e.platform}` : ''}` : '',
      e.fee !== undefined ? `fee ${money(e.fee)}` : '',
      e.profit !== undefined ? `profit ${money(e.profit)}` : '',
      e.orderNumber ? `order ${e.orderNumber}` : '',
      e.buyer ? `buyer ${e.buyer}` : '',
    ].filter(Boolean);
    return `Recorded sale of ${[e.code, e.name].filter(Boolean).join(' ') || 'a piece'}${parts.length ? `: ${parts.join(', ')}` : ''}.`;
  }
  if (e.type === 'clear'){
    const codes = e.codes && e.codes.length ? ` Pieces: ${e.codes.join(', ')}.` : '';
    return `Cleared the list: ${plural(Number(e.pieces) || 0, 'piece')} from ${plural(Number(e.orders) || 0, 'order')} (${plural(Number(e.screenshots) || 0, 'screenshot')}, ${Number(e.picked) || 0} picked, ${Number(e.recorded) || 0} recorded).${codes}`;
  }
  if (e.type === 'checklist'){
    return `Shared the checklist: ${plural(Number(e.pieces) || 0, 'piece')} from ${plural(Number(e.orders) || 0, 'order')}.`;
  }
  return 'Pick action.';
}

// Newest first; one user or everyone.
export function filterLog(entries, uid = ''){
  return (entries || []).filter(e => !uid || e.uid === uid).sort((a, b) => b.at - a.at);
}

// The people who appear in a list of entries: [{ uid, email }], by email.
export function logUsers(entries){
  const seen = new Map();
  (entries || []).forEach(e => { if (e.uid && !seen.has(e.uid)) seen.set(e.uid, e.email || e.uid); });
  return [...seen.entries()].map(([uid, email]) => ({ uid, email })).sort((a, b) => a.email.localeCompare(b.email));
}
