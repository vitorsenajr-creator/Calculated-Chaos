// The sign-in gate for a pending account, with /api/platform mocked
// (v3.28.8): an invited, verified account sees "Create your store"; a
// stranger sees "Awaiting approval"; an invited, unverified account is asked
// to verify first. Needs `npm run harness` running on port 5180.
// Browser: CHROME_PATH, else /usr/bin/chromium.
import { chromium } from 'playwright-core';

const BASE = process.env.HARNESS_URL || 'http://localhost:5180/app.html';
const executablePath = process.env.CHROME_PATH || '/usr/bin/chromium';

const CASES = [
  { name: 'invited and verified', email: 'maya@example.test', verified: true, status: { selfServe: false, invited: true, canCreate: true, hasBusiness: false }, title: 'store' },
  { name: 'not invited', email: 'stranger@example.test', verified: true, status: { selfServe: false, invited: false, canCreate: false, hasBusiness: false }, title: 'Awaiting approval' },
  { name: 'invited, not verified', email: 'maya@example.test', verified: false, status: { selfServe: false, invited: true, canCreate: false, hasBusiness: false }, title: 'Verify your email' },
];

const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
let failed = 0;
for (const c of CASES){
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const calls = [];
  // Make the harness user a pending account with this email.
  await page.route('**/src/config/firebase.js*', async (route) => {
    const res = await route.fetch();
    const body = (await res.text()) + `
;docs.set('users/harness-owner', { status: 'pending', email: ${JSON.stringify(c.email)} });
user.email = ${JSON.stringify(c.email)}; user.emailVerified = ${c.verified};
user.getIdTokenResult = async () => ({ claims: { email_verified: ${c.verified} } });`;
    await route.fulfill({ response: res, body });
  });
  await page.route('**/api/platform', async (route) => {
    const req = JSON.parse(route.request().postData() || '{}');
    calls.push(req.action);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ...c.status }) });
  });
  await page.goto(BASE);
  await page.waitForFunction(() => document.getElementById('authOverlay')?.style.display === 'flex'
    && (document.getElementById('authPendingState')?.style.display === 'block' || document.getElementById('authStoreState')?.style.display === 'block'), null, { timeout: 15000 });
  const storeShown = await page.evaluate(() => document.getElementById('authStoreState').style.display === 'block');
  const pendingTitle = await page.evaluate(() => document.getElementById('authPendingTitle').textContent);
  const storeText = storeShown ? await page.evaluate(() => document.getElementById('authStoreState').innerText) : '';
  const ok = c.title === 'store' ? storeShown && /Set up your store/.test(storeText) && /Create my store/.test(storeText) : !storeShown && pendingTitle === c.title;
  const clean = errors.length === 0 && calls.includes('signup_status');
  if (!(ok && clean)) console.log(JSON.stringify({ storeText, errors, calls }));
  console.log(`${ok && clean ? 'PASS' : 'FAIL'}: ${c.name} -> ${storeShown ? 'store setup screen' : pendingTitle}${errors.length ? ' errors: ' + errors.join('; ') : ''}`);
  if (!(ok && clean)) failed++;
  await page.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
