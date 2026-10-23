// Long captures of three app screens for the welcome page's scroll tour
// (v3.27.22). For each screen it writes three PNGs in tests/harness/out:
// <name>-top (the fixed header), <name>-scroll (the whole content, no fixed
// bars) and <name>-nav (the bottom bar), all at 390 px x 2. Needs `npm run
// harness` on port 5180. public/welcome/tour-*.webp are made from them.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, 'out');
mkdirSync(outDir, { recursive: true });
const BASE = process.env.HARNESS_URL || 'http://localhost:5180/app.html';
const executablePath = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const SCREENS = [
  { tab: 'catalog', file: 'tour-catalog' },
  { tab: 'stock', section: 'pick', file: 'tour-pick' },
  { tab: 'finance', file: 'tour-finance' },
];

// Two order screenshots already read, so the Pick list shows pieces without
// calling the AI. Stored as the Pick screen keeps them on the device. The
// pieces are the three unsold sample items #1498, #1484 and #1485, matched by
// name (the order lines carry no SKU).
const PICK_SESSION = {
  shots: [
    { id: 'shot1', name: 'poshmark-order.png', status: 'done', message: '', result: { isSale: true, orders: [{
      platform: 'poshmark', orderNumber: '5F3A1C9E0B7D4A2E8C1F6B09', orderDate: '2026-10-18', buyer: '@maya.k',
      total: '$70.00', fee: '$14.00', netEarnings: '$56.00', salesTax: '',
      items: [
        { title: "Lee Women's Denim Pink Fringe Rhinestone Sequin Shorts Western Festival Sz 20", price: '$22.00', size: '20', sku: '', partial: false },
        { title: "Zara Women's Sheer Mesh Panel Sleeveless Bodysuit Pink Thong Cut Size S", price: '$18.00', size: 'S', sku: '', partial: false },
        { title: "Adidas Women's Cotton Blend Floral Logo Graphic Pullover Hoodie Pink Size M", price: '$19.00', size: 'M', sku: '', partial: false },
      ],
    }] } },
  ],
  chosen: {}, platforms: {}, picked: [], manual: [],
};


const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
const errors = [];
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript((session) => {
  try{ if (!localStorage.getItem('cc.pick.session')) localStorage.setItem('cc.pick.session', JSON.stringify(session)); }catch(e){}
}, PICK_SESSION);
await page.goto(BASE, { waitUntil: 'load' });
await page.locator('[data-tab="home"]').filter({ visible: true }).first().waitFor({ timeout: 15000 });
await page.waitForTimeout(800);

for (const s of SCREENS){
  await page.locator(`[data-tab="${s.tab}"]`).filter({ visible: true }).first().click();
  await page.waitForTimeout(700);
  if (s.section){
    await page.locator(`[data-stock-section="${s.section}"]`).filter({ visible: true }).first().click();
    await page.waitForTimeout(700);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  const box = await page.evaluate(() => {
    const h = document.querySelector('.app-header').getBoundingClientRect();
    const n = document.querySelector('.bottom-nav').getBoundingClientRect();
    return { headerBottom: Math.round(h.bottom), navTop: Math.round(n.top) };
  });
  await page.screenshot({ path: resolve(outDir, `${s.file}-view.png`) });
  const chrome = await page.addStyleTag({ content: '.bottom-nav,#pageBackToTop,#fabAdd{display:none!important}' });
  await page.screenshot({ path: resolve(outDir, `${s.file}-full.png`), fullPage: true });
  await chrome.evaluate(el => el.remove());
  console.log(s.file, JSON.stringify(box));
}
await browser.close();
if (errors.length) console.log('Page errors:\n' + errors.join('\n'));
