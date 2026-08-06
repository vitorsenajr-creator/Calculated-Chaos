// Reports / CSV / Excel data — pure calculations over `items` (+ `appSettings`
// where fee/shipping settings affect projected profit), moved out of
// main.js's IIFE verbatim. No DOM here — callers build HTML/wire buttons
// and call downloadCsv/XLSX themselves with the rows these return.
import { CONDITION_LABEL, PREP_LABEL } from './constants.js';
import { daysSince, daysToSell, statusLabel } from './format-utils.js';
import { projectedProfit } from './pricing.js';

// Everything renderReports() needs to build its HTML: category performance
// (realized, from sold items), projected pipeline (active items), top
// earners/upside, and stale eBay listings.
export function computeReportsData(items, appSettings){
  const sold = items.filter(i => i.status === 'vendido');
  const active = items.filter(i => i.status !== 'vendido');

  const byCat = {};
  sold.forEach(i => {
    const c = i.category || 'Other';
    if (!byCat[c]) byCat[c] = [];
    byCat[c].push(i);
  });
  const catRows = Object.keys(byCat).map(c => {
    const list = byCat[c];
    const revenue = list.reduce((s,i)=> s + (parseFloat(i.soldPrice)||0), 0);
    const profit = list.reduce((s,i)=> s + (i.netProfit||0), 0);
    const avgDaysToSell = list.reduce((s,i)=> s + (daysToSell(i)||0), 0) / list.length;
    return { cat:c, count:list.length, revenue, profit, avgDaysToSell, margin: revenue>0 ? profit/revenue*100 : 0 };
  }).sort((a,b)=> b.profit - a.profit);

  // Projected pipeline by category (active, not-yet-sold items)
  const byCatActive = {};
  active.forEach(i => {
    const c = i.category || 'Other';
    if (!byCatActive[c]) byCatActive[c] = [];
    byCatActive[c].push(i);
  });
  const projectedRows = Object.keys(byCatActive).map(c => {
    const list = byCatActive[c];
    const projected = list.reduce((s,i)=> s + projectedProfit(items, appSettings, i), 0);
    return { cat:c, count:list.length, projected };
  }).sort((a,b)=> b.projected - a.projected);
  const totalProjected = active.reduce((s,i)=> s + projectedProfit(items, appSettings, i), 0);

  const topItemsByProfit = [...sold].sort((a,b)=> (b.netProfit||0) - (a.netProfit||0)).slice(0,5);
  const topProjectedItems = [...active].sort((a,b)=> projectedProfit(items, appSettings, b) - projectedProfit(items, appSettings, a)).slice(0,5);
  // Uses ebayListedAt (when it actually went live on eBay), not
  // createdAt (when it was first cataloged) — those can be weeks apart,
  // and days-since-cataloged was misleading here before.
  const slowMovers = items.filter(i => i.ebayListingId && i.status !== 'vendido' && i.ebayListedAt && daysSince(i.ebayListedAt) >= 30)
    .sort((a,b)=> daysSince(b.ebayListedAt) - daysSince(a.ebayListedAt));

  return { sold, active, catRows, projectedRows, totalProjected, topItemsByProfit, topProjectedItems, slowMovers };
}

export function buildFullInventoryRows(items, appSettings){
  const header = ['Name','Category','Brand','Condition','Status','Cost','Weight(lb)','Length(in)','Width(in)','Height(in)','List Price','Sold Price','Listed On','Projected Profit','Net Profit','Days in Catalog','Notes','Photo Count'];
  return [header, ...items.map(i => [
    i.name, i.category, i.brand, CONDITION_LABEL[i.condition]||i.condition, statusLabel(i.status),
    i.cost, i.weight, i.length, i.width, i.height,
    i.listPrice, i.soldPrice||'', (i.listedPlatforms||[]).join(', '),
    i.status !== 'vendido' ? projectedProfit(items, appSettings, i).toFixed(2) : '',
    i.netProfit!==undefined ? i.netProfit.toFixed(2) : '',
    daysSince(i.createdAt), i.notes, (i.photos||[]).length
  ])];
}

export function buildSoldItemsRows(items){
  const sold = items.filter(i => i.status === 'vendido');
  const header = ['Name','Category','Brand','Sold Price','Cost','Platform Fees','Shipping Paid','Net Profit','Listed On','Date Sold','Days to Sell'];
  return [header, ...sold.map(i => [
    i.name, i.category, i.brand, i.soldPrice, i.cost, i.feesTotal, i.shippingCost,
    i.netProfit!==undefined ? i.netProfit.toFixed(2) : '', (i.listedPlatforms||[]).join(', '),
    i.soldAt ? new Date(i.soldAt).toLocaleDateString('en-US') : '', daysToSell(i) ?? ''
  ])];
}

export function buildCategoryReportRows(items, appSettings){
  const sold = items.filter(i => i.status === 'vendido');
  const active = items.filter(i => i.status !== 'vendido');
  const byCat = {};
  sold.forEach(i => {
    const c = i.category || 'Other';
    if (!byCat[c]) byCat[c] = [];
    byCat[c].push(i);
  });
  const byCatActive = {};
  active.forEach(i => {
    const c = i.category || 'Other';
    if (!byCatActive[c]) byCatActive[c] = [];
    byCatActive[c].push(i);
  });
  const allCats = Array.from(new Set([...Object.keys(byCat), ...Object.keys(byCatActive)]));
  const header = ['Category','Items Sold','Total Revenue','Realized Profit','Avg Margin %','Avg Days to Sell','Active Items','Projected Profit (Active)'];
  return [header, ...allCats.map(c => {
    const list = byCat[c] || [];
    const activeList = byCatActive[c] || [];
    const revenue = list.reduce((s,i)=> s + (parseFloat(i.soldPrice)||0), 0);
    const profit = list.reduce((s,i)=> s + (i.netProfit||0), 0);
    const avgDays = list.length ? list.reduce((s,i)=> s + (daysToSell(i)||0), 0) / list.length : 0;
    const projected = activeList.reduce((s,i)=> s + projectedProfit(items, appSettings, i), 0);
    return [c, list.length, revenue.toFixed(2), profit.toFixed(2), (revenue>0?profit/revenue*100:0).toFixed(1), avgDays.toFixed(1), activeList.length, projected.toFixed(2)];
  })];
}

// Raw sheet data for the 3-sheet Excel export (matches the original
// Clothing Inventory Tracker format) — caller (main.js) still owns
// loading SheetJS and building/writing the actual workbook.
export function buildExcelSheetsData(items, appSettings){
  const clothingItems = items.filter(i => i.category === 'Clothing' || i.category === 'Shoes' || i.category === 'Accessories');
  const clothingHeader = ['Purchase ID','Purchase Date','Listed Date','Source','Brand','Gender','Size','Color','Type','Used/New','Category','Qty Purchased','Purchase Cost','Tax / Fees','Total Cost','Cost Per Unit','Listed Price','Status','Listing Title','Receipt / Link'];
  const clothingRows = clothingItems.map(i => [
    i.sourcePurchaseId || i.productCode || '',
    i.createdAt ? new Date(i.createdAt).toLocaleDateString('en-US') : '',
    i.soldAt ? new Date(i.soldAt).toLocaleDateString('en-US') : '',
    i.sourceImport || 'Calculated Chaos',
    i.brand || '',
    i.gender || '',
    i.size || '',
    i.color || '',
    i.clothingType || i.name || '',
    CONDITION_LABEL[i.condition] ? (i.condition.includes('novo') ? 'New' : 'Used') : 'Used',
    i.category || '',
    1,  // Qty
    i.cost || '',
    '', // Tax
    i.cost || '',
    i.cost || '',
    i.listPrice || '',
    statusLabel(i.status),
    i.name || '',
    ''
  ]);

  const householdItems = items.filter(i => !['Clothing','Shoes','Accessories'].includes(i.category));
  const householdHeader = ['Purchase ID','Purchase Date','Listed Date','Source','Brand','Product','New/ Vintage/Antique','Category','Qty Purchased','Purchase Cost','Tax / Fees','Total Cost','Cost Per Unit','Listed Price','Status','Listing Title','Receipt / Link'];
  const householdRows = householdItems.map(i => [
    i.sourcePurchaseId || i.productCode || '',
    i.createdAt ? new Date(i.createdAt).toLocaleDateString('en-US') : '',
    i.soldAt ? new Date(i.soldAt).toLocaleDateString('en-US') : '',
    i.sourceImport || 'Calculated Chaos',
    i.brand || '',
    i.name || '',
    CONDITION_LABEL[i.condition] ? (i.condition.includes('novo') ? 'New' : 'Used') : 'Used',
    i.category || '',
    1,
    i.cost || '',
    '',
    i.cost || '',
    i.cost || '',
    i.listPrice || '',
    statusLabel(i.status),
    i.name || '',
    ''
  ]);

  const allHeader = ['Product Code','Storage Box','Source','Name','Category','Brand','Gender','Size','Color','Condition','Status','Prep Status','Cost ($)','List Price ($)','Sold Price ($)','Net Profit ($)','Projected Profit ($)','Listed On','Weight (lb)','Length (in)','Width (in)','Height (in)','Days in Catalog','Notes','Photo Count'];
  const allRows = items.map(i => [
    i.productCode || '',
    i.storageBox || '',
    i.source || '',
    i.name || '',
    i.category || '',
    i.brand || '',
    i.gender || '',
    i.size || '',
    i.color || '',
    CONDITION_LABEL[i.condition] || i.condition || '',
    statusLabel(i.status),
    PREP_LABEL[i.prep] || i.prep || '',
    i.cost || '',
    i.listPrice || '',
    i.soldPrice || '',
    i.netProfit !== undefined ? parseFloat(i.netProfit).toFixed(2) : '',
    i.status !== 'vendido' ? projectedProfit(items, appSettings, i).toFixed(2) : '',
    (i.listedPlatforms || []).join(', '),
    i.weight || '',
    i.length || '',
    i.width || '',
    i.height || '',
    daysSince(i.createdAt),
    i.notes || '',
    (i.photos || []).length
  ]);

  return {
    clothing: { header: clothingHeader, rows: clothingRows },
    household: { header: householdHeader, rows: householdRows },
    all: { header: allHeader, rows: allRows },
  };
}
