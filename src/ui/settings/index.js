// Settings (UI layer; v3.17.6, docs/modularization.md). main.js imports
// this one file: it loads every Settings module (each registers the
// window.* handlers its buttons call) and re-exports what main.js uses.
import { runEbayAudit, runListFulfillmentPolicies, runBackfillDescriptions } from '../../modules/ebay-audit.js';
import { runEbayErrorLibrary } from '../../modules/ebay-error-log.js';
import { runDuplicateProductCodeAudit, renumberDuplicateProductCode } from '../../modules/product-code-bank.js';
import './forms.js';
import './platforms-panel.js';
export { renderSettings, openSettingsGroup } from './settings-view.js';
export { renderEbayConnectionStatus } from './ebay-panel.js';

// See modules/ebay-audit.js — the whole thing lives there, this just
// exposes it the same way every other Settings action here is (a
// window.* function wired via inline onclick, since renderSettings()
// tears down and rebuilds this HTML on every render).
window.runEbayAudit = runEbayAudit;
window.runEbayErrorLibrary = runEbayErrorLibrary;
window.runListFulfillmentPolicies = runListFulfillmentPolicies;
window.runBackfillDescriptions = runBackfillDescriptions;
// See modules/product-code-bank.js — same reasoning as above.
window.runDuplicateProductCodeAudit = runDuplicateProductCodeAudit;
window.renumberDuplicateProductCode = renumberDuplicateProductCode;