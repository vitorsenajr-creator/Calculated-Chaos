// Pricing / profit engine — moved out of main.js's IIFE verbatim, just
// parameterized on `items`/`appSettings` instead of closing over them
// (main.js still keeps thin wrapper functions with the original names/
// signatures so every existing call site is unchanged).
import { CONDITION_FACTOR, BASE_CATEGORY_VALUE, PLATFORM_FEES } from './constants.js';

export function getCategoryPriceHistory(items, category){
  const sold = items.filter(i => i.status === 'vendido' && i.category === category && i.soldPrice);
  if (sold.length < 2) return null;
  const avg = sold.reduce((s,i)=> s + parseFloat(i.soldPrice), 0) / sold.length;
  return { avg: Math.round(avg*100)/100, count: sold.length };
}

// Reverses a past sale's own condition discount to estimate what that
// item would have been worth "as new" — this is what lets us compare
// sales across different conditions fairly, and is also the fix for a
// real bug: blending a raw historical sold price (which already reflects
// ITS OWN condition) with a fresh condition-factor multiplication was
// discounting twice.
export function estimateMintValue(soldItem){
  const factor = CONDITION_FACTOR[soldItem.condition] || 0.55;
  return parseFloat(soldItem.soldPrice) / factor;
}

// Sales from last week should count more than sales from 6 months ago —
// decays smoothly rather than a hard cutoff.
export function recencyWeight(soldAtMs){
  const daysAgo = (Date.now() - (soldAtMs || Date.now())) / 86400000;
  return 1 / (1 + Math.max(0, daysAgo) / 90);
}

// Weighted median (not mean) of "mint value" across a set of past sales —
// median resists a single unusually expensive or cheap sale skewing the
// whole estimate the way a plain average does.
export function weightedMedianMintValue(soldItems){
  const entries = soldItems
    .map(i => ({ value: estimateMintValue(i), weight: recencyWeight(i.soldAt) }))
    .sort((a,b) => a.value - b.value);
  const totalWeight = entries.reduce((s,e)=> s + e.weight, 0);
  let cum = 0;
  for (const e of entries){
    cum += e.weight;
    if (cum >= totalWeight / 2) return e.value;
  }
  return entries[entries.length - 1].value;
}

// Finds the most specific real sales data we have for this item: same
// BRAND first (any category — a brand's value carries across categories
// and is far more predictive than category alone), falling back to same
// category if there isn't enough brand-specific history yet.
export function getPriceReference(items, item){
  const brand = (item.brand || '').trim().toLowerCase();
  if (brand){
    const sameBrand = items.filter(i => i.status === 'vendido' && i.soldPrice && (i.brand||'').trim().toLowerCase() === brand);
    if (sameBrand.length >= 2){
      return { mintValue: weightedMedianMintValue(sameBrand), count: sameBrand.length, matchType: 'brand' };
    }
  }
  const sameCat = items.filter(i => i.status === 'vendido' && i.soldPrice && i.category === item.category);
  if (sameCat.length >= 2){
    return { mintValue: weightedMedianMintValue(sameCat), count: sameCat.length, matchType: 'category' };
  }
  return null;
}

export function suggestPrice(items, item){
  const base = BASE_CATEGORY_VALUE[item.category] || 20;
  const condFactor = CONDITION_FACTOR[item.condition] || 0.5;
  const ref = getPriceReference(items, item);
  let suggested;
  if (ref){
    // Re-apply THIS item's condition to the real historical "mint value"
    // — not to the raw sold price, which already had a condition baked
    // in (that was the double-discount bug).
    const historicalEstimate = ref.mintValue * condFactor;
    // Trust brand-specific data a bit more than category-wide data.
    const blendWeight = ref.matchType === 'brand' ? 0.7 : 0.6;
    const formulaBrandBoost = (item.brand && item.brand.trim() && ref.matchType !== 'brand') ? 1.15 : 1.0;
    const formulaEstimate = base * condFactor * formulaBrandBoost;
    suggested = formulaEstimate * (1 - blendWeight) + historicalEstimate * blendWeight;
  } else {
    // No real sales data yet to lean on — softer generic brand boost than
    // before (+15% instead of +25%), since a bare brand name alone isn't
    // strong evidence of a premium; real data (above) is what should
    // actually drive brand value once it exists.
    const brandBoost = item.brand && item.brand.trim() ? 1.15 : 1.0;
    suggested = base * condFactor * brandBoost;
  }

  const cost = parseFloat(item.cost) || 0;
  const minMargin = cost * 1.8 + 5;
  suggested = Math.max(suggested, minMargin);
  return Math.round(suggested * 100) / 100;
}

export function estimateShipping(appSettings, item){
  const weight = parseFloat(item.weight) || 0.5;
  const len = parseFloat(item.length) || 10;
  const wid = parseFloat(item.width) || 8;
  const hei = parseFloat(item.height) || 2;
  const dimWeight = (len * wid * hei) / 139;
  const billable = Math.max(weight, dimWeight);

  function tierPrice(base, perLb){
    return Math.round((base + Math.max(0, billable - 1) * perLb) * 100) / 100;
  }
  const options = [];
  if (billable <= 0.9 && len <= 15 && wid <= 12){
    options.push({carrier:'USPS Ground Advantage (envelope)', price: 5.49});
  }
  options.push({carrier:'USPS Ground Advantage', price: tierPrice(8.40, 1.35)});
  options.push({carrier:'USPS Priority Mail', price: tierPrice(10.85, 1.65)});
  if (billable >= 5){
    options.push({carrier:'UPS Ground', price: tierPrice(12.90, 1.45)});
  }
  (appSettings.customCarriers || []).forEach(c => {
    options.push({carrier: c.name, price: tierPrice(c.basePrice || 0, c.perLbPrice || 0)});
  });
  return {billable: Math.round(billable*100)/100, options};
}

export function platformFee(appSettings, platform, price){
  let rate;
  if (appSettings.platformFeeOverrides?.[platform] !== undefined){
    rate = appSettings.platformFeeOverrides[platform];
  } else if (PLATFORM_FEES[platform] !== undefined){
    rate = PLATFORM_FEES[platform];
  } else {
    const custom = (appSettings.customPlatforms || []).find(p => p.key === platform);
    rate = custom ? custom.feePct / 100 : 0.12;
  }
  return Math.round(price * rate * 100) / 100;
}

// Estimated profit for an item that hasn't sold yet — uses listing price if set,
// otherwise the suggested price, minus estimated platform fee and cheapest shipping.
export function projectedProfit(items, appSettings, item){
  const price = item.listPrice ? parseFloat(item.listPrice) : suggestPrice(items, item);
  const fee = platformFee(appSettings, item.platform || 'ebay', price);
  // Shipping is only a seller cost if this item offers free shipping (buyer absorbs it otherwise).
  const itemOffersFreeShipping = item.freeShipping !== undefined ? item.freeShipping : appSettings.sellerPaysShipping;
  let shipCost = 0;
  if (itemOffersFreeShipping){
    const ship = estimateShipping(appSettings, item);
    shipCost = ship.options[0]?.price || 0;
  }
  const cost = parseFloat(item.cost) || 0;
  return Math.round((price - fee - shipCost - cost) * 100) / 100;
}
