// Settings → eBay → ship-from address (v3.28.19), with /api/ebay-auth and
// /api/ebay-setup mocked: the sample address is flagged, a bad ZIP is shown
// on its field with no request, a good address is sent and shown, and Run
// eBay setup carries the address. Needs `npm run harness` on port 5180.
// Browser: CHROME_PATH, else /usr/bin/chromium.
import { chromium } from 'playwright-core';

const BASE = process.env.HARNESS_URL || 'http://localhost:5180/app.html';
const executablePath = process.env.CHROME_PATH || '/usr/bin/chromium';

const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const sent = [];
let address = { city: 'Orlando', stateOrProvince: 'FL', postalCode: '32801' };
const line = (a) => `${a.city}, ${a.stateOrProvince} ${a.postalCode}`;

await page.route('**/api/ebay-auth*', (route) => route.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ connected: true, sellerUsername: 'savytrendsetters', connected_at: Date.now() }),
}));
await page.route('**/api/ebay-setup', async (route) => {
  const body = JSON.parse(route.request().postData() || '{}');
  sent.push(body);
  let data;
  if (body.action === 'location'){
    data = { success: true, setUp: true, address, line: line(address), placeholder: address.city === 'Orlando' };
  } else if (body.action === 'location_update'){
    address = { city: body.address.city, stateOrProvince: body.address.stateOrProvince, postalCode: body.address.postalCode };
    data = { success: true, setUp: true, address, line: line(address), placeholder: false };
  } else {
    data = { success: true, saved: true, results: {}, shipFrom: { address: body.address, line: line(body.address) } };
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
});

const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? ' — ' + extra : ''}`); };

await page.goto(BASE);
await page.waitForSelector('.nav-link.bottom[data-tab="settings"]', { state: 'visible', timeout: 20000 });
await page.click('.nav-link.bottom[data-tab="settings"]');
await page.click('[data-settings-group="ebay"]');
await page.waitForFunction(() => /Ships from|sample address/.test(document.getElementById('shipFromCurrent')?.innerText || ''), null, { timeout: 10000 });

const current = await page.innerText('#shipFromCurrent');
check('the sample address is flagged', /sample address/.test(current) && /Orlando, FL 32801/.test(current), current);
check('the form is not prefilled with the sample', (await page.inputValue('#shipFromCity')) === '');

await page.fill('#shipFromCity', 'austin');
await page.selectOption('#shipFromState', 'TX');
await page.fill('#shipFromZip', '7870');
const before = sent.length;
await page.click('#shipFromSaveBtn');
const zipError = await page.innerText('#shipFromZipError');
check('a bad ZIP shows on its field, with no request', /5-digit ZIP/.test(zipError) && sent.length === before
  && (await page.getAttribute('#shipFromZip', 'aria-invalid')) === 'true'
  && (await page.evaluate(() => document.activeElement?.id)) === 'shipFromZip', zipError);

await page.fill('#shipFromZip', '78701');
await page.click('#shipFromSaveBtn');
await page.waitForFunction(() => /saved on eBay/.test(document.getElementById('ebaySetupResult')?.innerText || ''), null, { timeout: 10000 });
const upd = sent.find(b => b.action === 'location_update');
check('the address is sent, city capitalized, no street', JSON.stringify(upd?.address) === JSON.stringify({ city: 'Austin', stateOrProvince: 'TX', postalCode: '78701', country: 'US' }), JSON.stringify(upd));
check('the new address is shown', /Ships from Austin, TX 78701/.test(await page.innerText('#shipFromCurrent')));
check('the error is cleared', (await page.innerText('#shipFromZipError')) === '' && (await page.getAttribute('#shipFromZip', 'aria-invalid')) === null);

await page.evaluate(() => window.runEbaySetup());
await page.waitForFunction(() => /Done!/.test(document.getElementById('ebaySetupResult')?.innerText || ''), null, { timeout: 10000 });
const setup = sent.find(b => !b.action);
check('Run eBay setup carries the address', setup?.address?.postalCode === '78701' && setup?.address?.city === 'Austin', JSON.stringify(setup));

await page.fill('#shipFromCity', '');
const n = sent.length;
await page.evaluate(() => window.runEbaySetup());
check('Run eBay setup with no city sends nothing', sent.length === n && /city/.test(await page.innerText('#shipFromCityError')));

const width = await page.evaluate(() => document.documentElement.scrollWidth);
check('no horizontal scroll at 390 px', width <= 390, String(width));
await page.screenshot({ path: process.env.SHOT || '/tmp/ship-from.png', fullPage: false });
check('no page errors', errors.length === 0, errors.join('; '));

await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
