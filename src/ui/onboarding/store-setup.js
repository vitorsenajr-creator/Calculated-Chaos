// "Create your store" (docs/multi-tenant.md step 5, v3.28.0): the screen a
// new seller sees after verifying the email, while self-serve sign-up is
// on. It lives in the sign-in overlay (#authStoreState in app.html) and is
// loaded on demand by main.js's sign-in gate, so it costs nothing for
// accounts that already have a store.
//
// The store itself is created by the server (api/platform.js action
// business_create → api/_business.js): the browser may not write the
// business or its members. After it answers, the page reloads and the gate
// opens the app on the new store.

import { jsonAuthHeaders } from '../../modules/api-auth.js';
import { shrinkImageToDataUrl } from '../../platform/images.js';
import { validateStoreName, SELL_ON_OPTIONS, MAX_LOGO_CHARS, STORE_NAME_MAX, TERMS_VERSION, TERMS_REQUIRED_ERROR } from '../../domain/new-business.js';

async function platformCall(body){
  const res = await fetch('/api/platform', { method: 'POST', headers: await jsonAuthHeaders(), body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return res.ok ? { ok: true, ...data } : { ok: false, error: data.error || `The server answered ${res.status}.` };
}

// { selfServe, hasBusiness }, or null when it can't be asked (the gate then
// keeps the "Awaiting approval" screen, as before v3.28.0).
export async function fetchSignupStatus(){
  try{
    const r = await platformCall({ action: 'signup_status' });
    return r.ok ? { selfServe: r.selfServe === true, hasBusiness: r.hasBusiness === true } : null;
  }catch(e){
    console.warn('Could not read the sign-up status:', e);
    return null;
  }
}

const $ = (id) => document.getElementById(id);
let wired = false;
let logo = '';
const sellsOn = new Set();

function setError(msg){
  const el = $('storeError');
  el.textContent = msg || '';
  el.style.display = msg ? 'block' : 'none';
}

function drawChips(){
  $('storeSellsOn').innerHTML = SELL_ON_OPTIONS.map(o =>
    `<button type="button" class="store-chip" data-key="${o.key}" aria-pressed="${sellsOn.has(o.key)}">${o.label}</button>`
  ).join('');
}

function drawLogo(){
  const img = $('storeLogoPreview');
  img.hidden = !logo;
  if (logo) img.src = logo; else img.removeAttribute('src');
  $('storeLogoRemove').hidden = !logo;
  $('storeLogoLabel').firstChild.textContent = logo ? 'Replace logo ' : 'Add logo ';
}

function wire(){
  if (wired) return;
  wired = true;
  $('storeNameInput').maxLength = STORE_NAME_MAX;
  $('storeNameInput').addEventListener('input', () => setError(''));
  $('storeTermsInput').addEventListener('change', () => setError(''));
  $('storeSellsOn').addEventListener('click', (e) => {
    const chip = e.target.closest('.store-chip');
    if (!chip) return;
    const key = chip.dataset.key;
    if (sellsOn.has(key)) sellsOn.delete(key); else sellsOn.add(key);
    chip.setAttribute('aria-pressed', String(sellsOn.has(key)));
  });
  $('storeLogoInput').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    setError('');
    if (!file) return;
    try{
      const data = await shrinkImageToDataUrl(file, 256);
      if (data.length > MAX_LOGO_CHARS) throw new Error('That logo is still too large after shrinking. Try a simpler image.');
      logo = data;
      drawLogo();
    }catch(err){
      setError(err.message || "That image couldn't be used.");
    }
  });
  $('storeLogoRemove').addEventListener('click', () => { logo = ''; drawLogo(); });
  $('storeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    setError('');
    const check = validateStoreName($('storeNameInput').value);
    if (!check.ok){
      setError(check.error);
      $('storeNameInput').focus();
      return;
    }
    // The server refuses a store without the Terms too (api/_business.js).
    if (!$('storeTermsInput').checked){
      setError(TERMS_REQUIRED_ERROR);
      $('storeTermsInput').focus();
      return;
    }
    const btn = $('storeCreateBtn');
    btn.disabled = true;
    btn.textContent = 'Creating your store…';
    let r;
    try{
      r = await platformCall({ action: 'business_create', name: check.name, logo, sellsOn: [...sellsOn], acceptTerms: true, termsVersion: TERMS_VERSION });
    }catch(err){
      r = { ok: false, error: 'No connection. Check your internet and try again.' };
    }
    if (r.ok){
      // The gate starts over and opens the app on the new store.
      window.location.reload();
      return;
    }
    btn.disabled = false;
    btn.textContent = 'Create my store';
    setError(r.error);
  });
}

// Shows the store screen in the sign-in overlay. `signOut` is main.js's
// sign-out (it also stops the live sync).
export function showStoreSetup({ signOut }){
  wire();
  drawChips();
  drawLogo();
  const so = $('storeSignOutBtn');
  so.onclick = () => signOut();
  $('authOverlay').style.display = 'flex';
  $('authCheckingState').style.display = 'none';
  $('authFormState').style.display = 'none';
  $('authPendingState').style.display = 'none';
  $('authStoreState').style.display = 'block';
  document.body.classList.add('auth-locked');
  $('storeNameInput').focus();
}
