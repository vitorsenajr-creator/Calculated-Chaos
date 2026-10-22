// Screenshots of the app with the sample business, for the welcome page and
// for checks. Needs `npm run harness` running on port 5180 first.
// Browser: CHROME_PATH, else the Playwright Chromium in /opt/pw-browsers.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, 'out');
mkdirSync(outDir, { recursive: true });

const BASE = process.env.HARNESS_URL || 'http://localhost:5180/';
const executablePath = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const VIEWPORTS = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true },
  desktop: { viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 },
};

// Each shot: the tab to open (data-tab), an optional Stock sub-tab
// (data-stock-section), and a file name.
const SHOTS = [
  { tab: 'home', file: 'home' },
  { tab: 'catalog', file: 'catalog' },
  { tab: 'stock', section: 'pick', file: 'stock-pick' },
  { tab: 'finance', file: 'finance-overview' },
  { tab: 'reports', file: 'reports-pnl' },
];

// Two order screenshots already read, so the Pick list shows pieces without
// calling the AI. Stored as the Pick screen keeps them on the device. The
// pieces are unsold sample items: #0631, #0648, #0662 and #0679, plus one
// without a SKU (the name finds #0688).
const PICK_SESSION = {
  shots: [
    { id: 'shot1', name: 'poshmark-order.png', status: 'done', message: '', result: { isSale: true, orders: [{
      platform: 'poshmark', orderNumber: '5F3A1C9E0B7D4A2E8C1F6B09', orderDate: '2026-10-18', buyer: '@maya.k',
      total: '$70.00', fee: '$14.00', netEarnings: '$56.00', salesTax: '',
      items: [
        { title: 'Leather belt', price: '$32.00', size: 'M', sku: '0631', partial: false },
        { title: 'Striped button shirt', price: '$15.00', size: 'M', sku: '0648', partial: false },
        { title: 'Corduroy wide-leg pants', price: '$34.00', size: '26', sku: '0662', partial: false },
      ],
    }] } },
    { id: 'shot2', name: 'ebay-sale.png', status: 'done', message: '', result: { isSale: true, orders: [{
      platform: 'ebay', orderNumber: '24-05123-44891', orderDate: '2026-10-20', buyer: 'jk_vintage',
      total: '', fee: '', netEarnings: '', salesTax: '',
      items: [
        { title: 'Satin slip dress', price: '$48.00', size: 'XS', sku: '0679', partial: false },
        { title: 'Knit beanie', price: '$9.00', size: 'One size', sku: '', partial: false },
      ],
    }] } },
  ],
  chosen: {}, platforms: {}, picked: [], manual: [],
};

const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
const errors = [];

for (const [name, opts] of Object.entries(VIEWPORTS)){
  const page = await browser.newPage(opts);
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
  await page.addInitScript((session) => {
    try{ if (!localStorage.getItem('cc.pick.session')) localStorage.setItem('cc.pick.session', JSON.stringify(session)); }catch(e){}
  }, PICK_SESSION);
  await page.goto(BASE, { waitUntil: 'load' });
  // The first sign-in check and the data load finish on their own; wait for Home.
  await page.locator('[data-tab="home"]').filter({ visible: true }).first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);

  for (const shot of SHOTS){
    if (shot.tab !== 'home'){
      await page.locator(`[data-tab="${shot.tab}"]`).filter({ visible: true }).first().click();
      await page.waitForTimeout(600);
    }
    if (shot.section){
      await page.locator(`[data-stock-section="${shot.section}"]`).filter({ visible: true }).first().click();
      await page.waitForTimeout(600);
    }
    await page.screenshot({ path: resolve(outDir, `${shot.file}-${name}.png`), fullPage: false });
  }
  await page.close();
}

await browser.close();
console.log(`Screenshots in ${outDir}`);
if (errors.length) console.log('Page errors:\n' + errors.join('\n'));
