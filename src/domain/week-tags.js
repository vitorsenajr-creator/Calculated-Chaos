// Weekly tag colors for the Tag Week theme (v3.21.1) — pure, no DOM or
// app state. Like a thrift store's color-of-the-week tags: an item wears
// the color of the week it was cataloged, so the shelf's age reads at a
// glance. Week 0 is the last 7 days; week 4 means 4 weeks or older.
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const WEEK_TAGS = [
  { index: 0, name: 'Blue', age: 'This week' },
  { index: 1, name: 'Green', age: '1 week' },
  { index: 2, name: 'Yellow', age: '2 weeks' },
  { index: 3, name: 'Orange', age: '3 weeks' },
  { index: 4, name: 'Pink', age: '4+ weeks' },
];

export function weekTagIndex(item, now){
  if (!item.createdAt) return 4;
  const weeks = Math.floor(Math.max(0, now - item.createdAt) / WEEK_MS);
  return Math.min(weeks, 4);
}

// In-stock items per tag color, newest week first.
export function shelfByTag(items, now){
  const counts = [0, 0, 0, 0, 0];
  items.forEach(i => { if (i.status !== 'vendido') counts[weekTagIndex(i, now)] += 1; });
  return WEEK_TAGS.map(t => ({ ...t, count: counts[t.index] }));
}
