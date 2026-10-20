// Expense CSV/Excel import (v3.23.7, Nifty P2 item 1, fourth part) — pure,
// no DOM, window, Firebase or app state. It reuses the spreadsheet
// import's readers (money, dates with day/month order, header row).
// Columns: Date, Category, Amount, Description, Distance. A negative amount
// is a refund; a row with a distance and no amount is a trip at the IRS
// rate of its date (Sourcing Transportation or Vehicle Expense only).
// Category words the app doesn't know are mapped by the person, once per
// word, to a category or to "Skip (personal)" (Vitor 2026-10-20).
import { normalizeText, parseMoney, parseDate, detectDateOrder } from './import-sheet.js';
import { EXPENSE_CATEGORIES, MAX_DESCRIPTION, MAX_AMOUNT, isoDate } from './expenses.js';
import { isMileageCategory, mileageAmount, MAX_MILES } from './mileage.js';

export const MAX_EXPENSE_ROWS = 5000;
export const EXPENSE_COLUMNS = ['date', 'category', 'amount', 'description', 'distance'];
export const COLUMN_LABEL = { date: 'Date', category: 'Category', amount: 'Amount', description: 'Description', distance: 'Distance (miles)' };
export const SKIP = 'skip';

const HEADER_WORDS = {
  date: ['date', 'transaction date', 'posted date', 'posting date', 'expense date', 'day', 'data', 'fecha'],
  category: ['category', 'type', 'expense type', 'expense category', 'categoria', 'tipo'],
  amount: ['amount', 'total', 'cost', 'value', 'price', 'debit', 'amount usd', 'valor', 'monto', 'importe', 'custo'],
  description: ['description', 'details', 'memo', 'note', 'notes', 'merchant', 'payee', 'name', 'descricao', 'descripcion', 'detalhe'],
  distance: ['distance', 'miles', 'mileage', 'mi', 'distancia', 'milhas', 'millas'],
};

// One column per field: exact header words first, then headers that
// contain one ("Amount (USD)"). Returns { field: columnIndex | -1 }.
export function suggestExpenseMapping(headers){
  const norm = headers.map(h => normalizeText(h));
  const out = Object.fromEntries(EXPENSE_COLUMNS.map(k => [k, -1]));
  const used = new Set();
  for (const pass of ['exact', 'contains']){
    for (const k of EXPENSE_COLUMNS){
      if (out[k] !== -1) continue;
      const words = HEADER_WORDS[k].map(normalizeText);
      const at = norm.findIndex((h, i) => !used.has(i) && h && (pass === 'exact'
        ? words.includes(h)
        : words.some(w => w.length > 2 && (` ${h} `).includes(` ${w} `))));
      if (at >= 0){ out[k] = at; used.add(at); }
    }
  }
  return out;
}

// Words that mean a category: its label, its key, Nifty's export codes and
// everyday words seen on receipts and bank exports.
const NIFTY_CODES = {
  ADVERTISING_PROMOTION: 'advertising', BANK_FEES: 'bank_fees', BUSINESS_INSURANCE: 'insurance', COMMERCIAL_RENT: 'rent',
  COMMERCIAL_UTILITIES: 'utilities', CONTRACT_LABOR: 'contract_labor', DUES_SUBSCRIPTIONS: 'dues_subscriptions',
  EDUCATION_TRAINING: 'education', COMPUTER_HARDWARE: 'electronics', EQUIPMENT_RENTAL: 'equipment_rental',
  INTERNET_SERVICES: 'internet', PROFESSIONAL_FEES: 'professional_fees', MEALS_ENTERTAINMENT: 'meals',
  OFFICE_EQUIPMENT: 'office_equipment', OFFICE_SUPPLIES: 'office_supplies', PHONE_SERVICES: 'phone',
  SOURCING_TRANSPORTATION: 'sourcing_travel', SHIPPING_EXPENSE: 'shipping_supplies', COMPUTER_SOFTWARE: 'software',
  TRAVEL_EXPENSE: 'travel', VEHICLE_EXPENSE: 'vehicle', OTHER: 'other',
};
const EVERYDAY_WORDS = {
  advertising: ['ads', 'advertising', 'promoted listings', 'promotion', 'marketing', 'boost'],
  bank_fees: ['bank fee', 'bank fees', 'service charge', 'wire fee', 'overdraft'],
  insurance: ['insurance'],
  rent: ['rent', 'storage unit', 'storage', 'booth'],
  utilities: ['utilities', 'electric', 'electricity', 'water'],
  contract_labor: ['contractor', 'assistant', 'labor', 'helper', 'photographer'],
  dues_subscriptions: ['membership', 'subscription', 'dues', 'club'],
  education: ['course', 'training', 'class', 'workshop'],
  electronics: ['computer', 'laptop', 'camera', 'printer', 'electronics', 'iphone', 'phone case'],
  internet: ['internet', 'wifi', 'wi fi', 'broadband'],
  professional_fees: ['accountant', 'cpa', 'lawyer', 'legal', 'tax prep', 'bookkeeping'],
  meals: ['meals', 'meal', 'food', 'restaurant', 'lunch', 'coffee'],
  office_equipment: ['rack', 'racks', 'shelves', 'shelving', 'mannequin', 'hangers', 'steamer', 'furniture', 'equipment'],
  office_supplies: ['office supplies', 'supplies', 'paper', 'ink', 'label rolls', 'labels', 'pens'],
  phone: ['phone', 'cell phone', 'mobile', 'verizon', 'at t', 'tmobile', 't mobile'],
  sourcing_travel: ['sourcing', 'gas', 'fuel', 'gasoline', 'uber', 'lyft', 'parking', 'tolls', 'mileage', 'thrift trip'],
  shipping_supplies: ['shipping', 'postage', 'usps', 'ups', 'fedex', 'stamps', 'mailers', 'poly mailers', 'boxes', 'tape', 'packaging'],
  software: ['software', 'app', 'apps', 'online tools', 'cloud storage', 'google workspace', 'canva'],
  travel: ['travel', 'flight', 'hotel', 'airbnb', 'train'],
  vehicle: ['vehicle', 'car', 'car repair', 'oil change', 'auto'],
  other: ['other', 'misc', 'miscellaneous', 'cleaning', 'repairs'],
};
const WORD_TO_KEY = (() => {
  const m = new Map();
  const put = (w, k) => { const n = normalizeText(w); if (n && !m.has(n)) m.set(n, k); };
  EXPENSE_CATEGORIES.forEach(c => { put(c.label, c.key); put(c.key, c.key); put(c.label.replace('&', 'and'), c.key); });
  Object.entries(NIFTY_CODES).forEach(([code, k]) => put(code, k));
  Object.entries(EVERYDAY_WORDS).forEach(([k, list]) => list.forEach(w => put(w, k)));
  return m;
})();
// Inventory purchases aren't an expense here (accrual): suggest skipping.
const SKIP_WORDS = ['inventory', 'inventory purchases', 'inventory expense', 'cost of goods', 'cogs', 'personal', 'transfer', 'payment', 'deposit'].map(normalizeText);

// The category a word suggests: a key, SKIP, or null when unknown.
export function suggestCategory(word){
  const n = normalizeText(word);
  if (!n) return null;
  if (WORD_TO_KEY.has(n)) return WORD_TO_KEY.get(n);
  if (SKIP_WORDS.includes(n)) return SKIP;
  return null;
}

// Each distinct category word in the file with its row count and the
// suggestion: { word, count, suggested, known }. Unknown words first.
export function categoryWords(rows, col){
  const by = new Map();
  rows.forEach(r => {
    const raw = String(r[col] ?? '').trim();
    const key = normalizeText(raw);
    if (!key) return;
    if (!by.has(key)) by.set(key, { word: raw, count: 0 });
    by.get(key).count += 1;
  });
  return [...by.values()].map(w => {
    const s = suggestCategory(w.word);
    return { ...w, suggested: s, known: s !== null };
  }).sort((a, b) => (a.known - b.known) || b.count - a.count || a.word.localeCompare(b.word));
}

const round2 = (n) => Math.round(n * 100) / 100;
const dupKey = (e) => `${e.date}|${e.category}|${e.kind}|${Number(e.amount).toFixed(2)}`;

// Rows → [{ row, status: 'ok' | 'error' | 'skip', error, expense, duplicate }].
// `categoryMap` maps a normalized word to a key or SKIP; a word missing
// from it (or an empty category cell) falls back to 'other'.
export function buildExpenseRows(rows, { mapping, categoryMap = {}, dateOrder = 'mdy', existing = [], firstRow = 2, now = Date.now() } = {}){
  const seen = new Set(existing.map(dupKey));
  const maxDate = isoDate(now + 366 * 86400000);
  const cell = (r, k) => (mapping[k] >= 0 ? r[mapping[k]] : '');
  return rows.map((r, i) => {
    const row = firstRow + i;
    const fail = (error) => ({ row, status: 'error', error, expense: null, duplicate: false });
    const word = String(cell(r, 'category') ?? '').trim();
    const mapped = word ? (categoryMap[normalizeText(word)] ?? suggestCategory(word) ?? 'other') : 'other';
    if (mapped === SKIP) return { row, status: 'skip', error: null, expense: null, duplicate: false };
    const t = parseDate(cell(r, 'date'), dateOrder);
    if (t === null) return fail('No date');
    if (Number.isNaN(t)) return fail(`Can't read the date "${String(cell(r, 'date')).slice(0, 20)}"`);
    const date = isoDate(t);
    if (date < '2000-01-01' || date > maxDate) return fail('Date out of range');
    const description = String(cell(r, 'description') ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_DESCRIPTION);
    const amount = parseMoney(cell(r, 'amount'));
    const dist = parseMoney(cell(r, 'distance'));
    if (Number.isNaN(amount)) return fail(`Can't read the amount "${String(cell(r, 'amount')).slice(0, 20)}"`);
    let expense;
    if ((amount === null || amount === 0) && dist !== null && !Number.isNaN(dist) && dist > 0){
      if (!isMileageCategory(mapped)) return fail('A distance needs Sourcing Transportation or Vehicle Expense');
      if (dist > MAX_MILES) return fail('Distance too large');
      const trip = mileageAmount(dist, date);
      expense = { date, category: mapped, amount: trip.amount, description, kind: 'expense', miles: trip.miles, rate: trip.rate };
    } else {
      if (amount === null || amount === 0) return fail('No amount');
      if (Math.abs(amount) > MAX_AMOUNT) return fail('Amount too large');
      expense = { date, category: mapped, amount: round2(Math.abs(amount)), description, kind: amount < 0 ? 'refund' : 'expense' };
    }
    const key = dupKey(expense);
    const duplicate = seen.has(key);
    seen.add(key);
    return { row, status: 'ok', error: null, expense, duplicate };
  });
}

// What gets saved: the ok rows, minus the ones the person unticked
// (duplicates start unticked).
export function rowsToSave(built, included){
  return built.filter((b, i) => b.status === 'ok' && included.has(i)).map(b => b.expense);
}

export function defaultIncluded(built){
  return new Set(built.map((b, i) => (b.status === 'ok' && !b.duplicate ? i : -1)).filter(i => i >= 0));
}

// Totals for the preview: count, refunds, trips, net total and per category.
export function previewTotals(list){
  const by = {};
  let total = 0, refunds = 0, trips = 0;
  list.forEach(e => {
    const n = e.kind === 'refund' ? -e.amount : e.amount;
    total += n;
    if (e.kind === 'refund') refunds += 1;
    if (e.miles > 0) trips += 1;
    by[e.category] = round2((by[e.category] || 0) + n);
  });
  const byCategory = Object.entries(by).map(([key, amount]) => ({ key, amount }))
    .sort((a, b) => b.amount - a.amount);
  return { count: list.length, refunds, trips, total: round2(total), byCategory };
}

// The docs to save, each with the import's id and file name.
export function buildExpenseDocs(list, { importId, fileName = '', importedAt = Date.now(), uid = null, newId }){
  return list.map(e => ({
    id: newId(),
    data: { ...e, createdAt: importedAt, createdBy: uid, updatedAt: importedAt, importId, importFile: String(fileName).slice(0, 120), importedAt },
  }));
}

// The date order to read the file with ('mdy' unless a day > 12 comes first).
export function expenseDateOrder(rows, mapping){
  return mapping.date >= 0 ? detectDateOrder(rows.map(r => r[mapping.date])) : 'mdy';
}

// The downloadable template: headers plus an expense, a refund and a trip.
export function templateRows(){
  return [
    ['Date', 'Category', 'Amount', 'Description', 'Distance'],
    ['10/01/2026', 'Shipping & Supplies', '23.40', 'Poly mailers, 100 pack', ''],
    ['10/03/2026', 'Office Supplies', '-4.99', 'Returned label rolls (refund)', ''],
    ['10/05/2026', 'Sourcing Transportation', '', 'Goodwill run (round trip)', '42'],
  ];
}

// The most recent import among the saved expenses: { importId, file, count,
// importedAt } or null.
export function latestImport(expenses){
  const by = {};
  (expenses || []).forEach(e => {
    if (!e.importId) return;
    const g = by[e.importId] || (by[e.importId] = { importId: e.importId, file: e.importFile || '', count: 0, importedAt: e.importedAt || 0 });
    g.count += 1;
  });
  const list = Object.values(by).sort((a, b) => b.importedAt - a.importedAt);
  return list[0] || null;
}
