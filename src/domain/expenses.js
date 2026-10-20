// Business expenses (v3.23.3, Nifty P2 item 1) — pure logic, no DOM,
// window, Firebase or app state. One expense = { id, date 'YYYY-MM-DD',
// category, amount (positive, cents), description, kind 'expense' | 'refund' }.
// A refund is money back on an earlier expense: it lowers the total.
// Accrual only (Vitor, 2026-10-20): buying stock isn't an expense here,
// an item's cost counts when it sells, so there's no inventory category.

import { isMileageCategory, mileageAmount, MAX_MILES } from './mileage.js';

// Keys are stored on the docs; labels and hints are what the menu shows.
// The list follows the Schedule C lines, plus two reseller ones (sourcing
// trips, shipping supplies).
export const EXPENSE_CATEGORIES = [
  { key: 'advertising', label: 'Advertising & Promotion', hint: 'Ads, boosted posts and promoted listings paid outside a sale.' },
  { key: 'bank_fees', label: 'Bank Service Charges', hint: 'Account, transfer and overdraft fees.' },
  { key: 'insurance', label: 'Business Insurance', hint: 'Business coverage (not health or car insurance).' },
  { key: 'rent', label: 'Commercial Rent', hint: 'A storage unit, booth or other space for the business.' },
  { key: 'utilities', label: 'Commercial Utilities', hint: 'Power and water for that space (not phone or internet).' },
  { key: 'contract_labor', label: 'Contract Labor', hint: 'People you pay for photos, listing, cleaning or prep.' },
  { key: 'dues_subscriptions', label: 'Dues & Subscriptions', hint: 'Paid groups, wholesale clubs and memberships.' },
  { key: 'education', label: 'Education & Training', hint: 'Courses and workshops about the business.' },
  { key: 'electronics', label: 'Electronics & Devices', hint: 'Phones, computers, cameras and printers.' },
  { key: 'equipment_rental', label: 'Equipment & Vehicle Rental', hint: 'Renting tools or a vehicle (not for sourcing).' },
  { key: 'internet', label: 'Internet', hint: 'Internet service for the business (not mobile data).' },
  { key: 'professional_fees', label: 'Legal & Professional Fees', hint: 'Accountants, lawyers and consultants.' },
  { key: 'meals', label: 'Meals & Entertainment', hint: 'Food and drinks while working on the business.' },
  { key: 'office_equipment', label: 'Office Furniture & Equipment', hint: 'Racks, shelves, photo setups, mannequins, packing tables.' },
  { key: 'office_supplies', label: 'Office Supplies', hint: 'Paper, pens, label rolls and printer ink.' },
  { key: 'phone', label: 'Phone', hint: 'Business share of a mobile or landline plan.' },
  { key: 'sourcing_travel', label: 'Sourcing Transportation', hint: 'Getting to thrift stores and sales: gas, rides, rentals.' },
  { key: 'shipping_supplies', label: 'Shipping & Supplies', hint: 'Postage bought outside a sale, mailers, boxes, tape.' },
  { key: 'software', label: 'Software & Online Services', hint: 'Apps, storage and online tools.' },
  { key: 'travel', label: 'Travel Expense', hint: 'Trips that aren’t for sourcing: flights, hotels.' },
  { key: 'vehicle', label: 'Vehicle Expense', hint: 'Gas and repairs for business driving that isn’t sourcing.' },
  { key: 'other', label: 'Other', hint: 'Anything else, like repairs or cleaning supplies.' },
];

const BY_KEY = Object.fromEntries(EXPENSE_CATEGORIES.map(c => [c.key, c]));
export const EXPENSE_KINDS = ['expense', 'refund'];
export const EXPENSE_PERIODS = ['month', 'year', 'all'];
export const MAX_DESCRIPTION = 200;
export const MAX_AMOUNT = 1000000;

export function categoryLabel(key){
  return BY_KEY[key] ? BY_KEY[key].label : 'Other';
}

// 'YYYY-MM-DD' in local time.
export function isoDate(ts){
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function validDate(s){
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

// Checks the form's values. Returns { ok, expense } with clean values, or
// { ok:false, field, error } naming the first problem.
export function validateExpense(input, { now = Date.now() } = {}){
  const date = String(input.date || '').trim();
  if (!validDate(date)) return { ok: false, field: 'date', error: 'Pick a date.' };
  if (date < '2000-01-01') return { ok: false, field: 'date', error: 'That date is too far back.' };
  if (date > isoDate(now + 366 * 86400000)) return { ok: false, field: 'date', error: 'That date is more than a year away.' };
  const category = String(input.category || '');
  if (!BY_KEY[category]) return { ok: false, field: 'category', error: 'Pick a category.' };
  const description0 = String(input.description || '').trim().replace(/\s+/g, ' ');
  if (description0.length > MAX_DESCRIPTION) return { ok: false, field: 'description', error: `Keep the description under ${MAX_DESCRIPTION} characters.` };
  // A trip in miles (v3.23.7): the amount comes from the IRS rate of the
  // date, and the miles and rate are saved with it.
  if (input.miles !== undefined && input.miles !== null){
    if (!isMileageCategory(category)) return { ok: false, field: 'category', error: 'Miles work for Sourcing Transportation or Vehicle Expense.' };
    const m = Number(String(input.miles).replace(/[,\s]/g, ''));
    if (!String(input.miles).trim() || !(m > 0)) return { ok: false, field: 'miles', error: 'Enter the miles driven.' };
    if (m > MAX_MILES) return { ok: false, field: 'miles', error: 'That distance is too large.' };
    const { miles, rate, amount } = mileageAmount(m, date);
    if (!(amount > 0)) return { ok: false, field: 'miles', error: 'Enter the miles driven.' };
    return { ok: true, expense: { date, category, amount, description: description0, kind: 'expense', miles, rate } };
  }
  const raw = String(input.amount ?? '').replace(/[$,\s]/g, '');
  const amount = Math.round(parseFloat(raw) * 100) / 100;
  if (!raw || !(amount > 0)) return { ok: false, field: 'amount', error: 'Enter an amount more than zero.' };
  if (amount > MAX_AMOUNT) return { ok: false, field: 'amount', error: 'That amount is too large.' };
  const description = String(input.description || '').trim().replace(/\s+/g, ' ');
  if (description.length > MAX_DESCRIPTION) return { ok: false, field: 'description', error: `Keep the description under ${MAX_DESCRIPTION} characters.` };
  const kind = input.kind === 'refund' ? 'refund' : 'expense';
  return { ok: true, expense: { date, category, amount, description, kind } };
}

// What an expense adds to the total: a refund takes away.
export function signedAmount(e){
  const n = parseFloat(e.amount) || 0;
  return e.kind === 'refund' ? -n : n;
}

// The expenses dated in the period that contains `now`.
export function expensesInPeriod(list, period, now = Date.now()){
  const today = isoDate(now);
  const prefix = period === 'month' ? today.slice(0, 7) : period === 'year' ? today.slice(0, 4) : '';
  return list.filter(e => typeof e.date === 'string' && e.date.startsWith(prefix));
}

const round2 = (n) => Math.round(n * 100) / 100;

// Totals for a list: overall, refunds, and per category (largest first,
// categories with nothing left out).
export function summarizeExpenses(list){
  const byCat = {};
  let total = 0, refunds = 0;
  for (const e of list){
    const n = signedAmount(e);
    total += n;
    if (n < 0) refunds += -n;
    const key = BY_KEY[e.category] ? e.category : 'other';
    if (!byCat[key]) byCat[key] = { key, label: categoryLabel(key), total: 0, count: 0 };
    byCat[key].total += n;
    byCat[key].count += 1;
  }
  const byCategory = Object.values(byCat)
    .map(c => ({ ...c, total: round2(c.total) }))
    .filter(c => c.total !== 0 || c.count > 0)
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  return { count: list.length, total: round2(total), refunds: round2(refunds), byCategory };
}

// Newest first: by date, then by when it was entered.
export function sortExpenses(list){
  return [...list].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) || (b.createdAt || 0) - (a.createdAt || 0));
}

// One group per month ('YYYY-MM'), newest first, each with its total.
export function groupByMonth(list){
  const groups = [];
  for (const e of sortExpenses(list)){
    const key = e.date.slice(0, 7);
    let g = groups[groups.length - 1];
    if (!g || g.key !== key){ g = { key, items: [], total: 0 }; groups.push(g); }
    g.items.push(e);
    g.total = round2(g.total + signedAmount(e));
  }
  return groups;
}

// CSV rows (header first), oldest first like a ledger. A refund's amount
// is negative so the column sums to the total.
export function expenseCsvRows(list){
  const rows = [['Date', 'Category', 'Description', 'Amount', 'Type', 'Miles', 'Rate per mile']];
  for (const e of sortExpenses(list).reverse()){
    const trip = e.miles > 0;
    rows.push([e.date, categoryLabel(e.category), e.description || '', signedAmount(e).toFixed(2), e.kind === 'refund' ? 'Refund' : 'Expense', trip ? String(e.miles) : '', trip ? Number(e.rate).toFixed(3) : '']);
  }
  return rows;
}
