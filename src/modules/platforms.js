// Platform list/lookup helpers — moved out of main.js's IIFE verbatim,
// parameterized on `appSettings` like pricing.js/reports.js instead of
// closing over it. Built-in platforms keep fixed keys (eBay especially
// has real API integration logic keyed to that exact string) but their
// fee %s can be overridden; customPlatforms are entirely her own,
// addable/removable. Every place that used to read
// PLATFORM_LABEL/PLATFORM_FEES/PLATFORM_COLOR directly should go through
// these instead so custom platforms show up everywhere built-ins do
// (filters, badges, the Platform dropdown, fee calc).
import { PLATFORM_LABEL, PLATFORM_COLOR, PLATFORM_FEES } from './constants.js';

export function getAllPlatforms(appSettings){
  const builtIns = Object.keys(PLATFORM_LABEL).filter(k => k !== 'outra').map(key => ({
    key,
    label: PLATFORM_LABEL[key],
    color: PLATFORM_COLOR[key] || '#8A7E82',
    feePct: (appSettings.platformFeeOverrides?.[key] ?? PLATFORM_FEES[key]) * 100,
    builtIn: true,
  }));
  const custom = (appSettings.customPlatforms || []).map(p => ({ ...p, builtIn: false }));
  return [...builtIns, ...custom];
}

export function getPlatformLabel(appSettings, key){
  return getAllPlatforms(appSettings).find(p => p.key === key)?.label || PLATFORM_LABEL[key] || key;
}

export function getPlatformColor(appSettings, key){
  return getAllPlatforms(appSettings).find(p => p.key === key)?.color || '#8A7E82';
}
