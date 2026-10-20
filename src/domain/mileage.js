// Mileage at the IRS standard business rate (v3.23.7, Nifty P2 item 1,
// fourth part) — pure, no DOM, window, Firebase or app state.
// The rate depends on the trip's date, so each mileage expense saves its
// miles, the rate used and the amount; a later change to this table never
// moves a saved expense. Update the table when the IRS announces a rate
// (decided with Vitor 2026-10-20: a fixed table, no per-business override).
// Sources:
//   2023: IRS Notice 2023-03 (65.5¢)
//   2024: IRS Notice 2024-08 (67¢)
//   2025: IRS Notice 2025-5 (70¢)
//   2026: IRS Notice 2026-10 (72.5¢), raised to 76¢ for miles driven on or
//         after July 1, 2026 by Announcement 2026-11 (IRB 2026-29).

// 'YYYY-MM-DD' in local time (kept here so expenses.js can import this
// file without a cycle).
function isoDate(ts){
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const MILEAGE_RATES = [
  { from: '2023-01-01', rate: 0.655, label: 'IRS 2023' },
  { from: '2024-01-01', rate: 0.67, label: 'IRS 2024' },
  { from: '2025-01-01', rate: 0.70, label: 'IRS 2025' },
  { from: '2026-01-01', rate: 0.725, label: 'IRS Jan–Jun 2026' },
  { from: '2026-07-01', rate: 0.76, label: 'IRS Jul–Dec 2026' },
];
// The years the table covers; a date after the last one uses the last rate
// and says so.
const LAST_YEAR = 2026;

// Categories where a trip can be entered in miles (Vitor 2026-10-20).
export const MILEAGE_CATEGORIES = ['sourcing_travel', 'vehicle'];
export const MAX_MILES = 10000;

export function isMileageCategory(key){
  return MILEAGE_CATEGORIES.includes(key);
}

// The rate for a 'YYYY-MM-DD' date: { rate, label, estimated } where
// `estimated` means the date is outside the published table.
export function rateFor(date){
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(date)) ? date : isoDate(Date.now());
  let pick = null;
  for (const r of MILEAGE_RATES) if (d >= r.from) pick = r;
  if (!pick) return { ...MILEAGE_RATES[0], estimated: true };
  return { ...pick, estimated: Number(d.slice(0, 4)) > LAST_YEAR };
}

const round2 = (n) => Math.round(n * 100) / 100;

// Miles → { miles, rate, amount } for that date.
export function mileageAmount(miles, date){
  const { rate } = rateFor(date);
  const m = Math.round(Number(miles) * 10) / 10;
  return { miles: m, rate, amount: round2(m * rate) };
}

// "42 mi × $0.76 (IRS Jul–Dec 2026) = $31.92"
export function mileageLine(miles, date){
  const r = rateFor(date);
  const { miles: m, amount } = mileageAmount(miles, date);
  const cents = (r.rate * 100) % 1 ? (r.rate * 100).toFixed(1) : String(Math.round(r.rate * 100));
  return `${m.toLocaleString('en-US')} mi × ${cents}¢ (${r.label}) = $${amount.toFixed(2)}`;
}

// The IRS doesn't let one vehicle use both the standard mileage rate and
// actual costs in a year. A soft warning: true when a year has Vehicle
// Expense entries both in miles and in dollars.
export function mixesVehicleMethods(expenses, year){
  const ofYear = (expenses || []).filter(e => e.category === 'vehicle' && String(e.date || '').startsWith(String(year)) && e.kind !== 'refund');
  return ofYear.some(e => e.miles > 0) && ofYear.some(e => !(e.miles > 0));
}
