// The eBay question before an item goes to the trash (v3.26.0). Resolves to
// 'remove' (end the eBay listing, then trash the item), 'app_only' (trash it
// and leave the eBay listing live) or null (keep the item). It never deletes
// anything itself: the caller does the work for the choice it gets.
import { escapeHtml } from '../../modules/format-utils.js';

export function askEbayBeforeDelete({ item, step, error = '' }){
  return new Promise(resolve => {
    const dlg = document.createElement('dialog');
    dlg.className = 'trash-dialog';
    const name = escapeHtml(item.name || item.productCode || 'This item');
    const link = item.ebayListingUrl
      ? `<a href="${escapeHtml(item.ebayListingUrl)}" target="_blank" rel="noopener">Open the listing on eBay ↗</a>`
      : '';
    const errorLine = error
      ? `<p class="trash-error" role="alert">Couldn't end the eBay listing: ${escapeHtml(error)}. Nothing was deleted.</p>`
      : '';
    const body = step === 'manual'
      ? `<h2>Listed on eBay</h2>
         <p><b>${name}</b> is listed on eBay, but the app doesn't have the listing's ID, so it can't end it. End it on eBay first, or move the item to the trash and leave the listing live.</p>
         ${link ? `<p>${link}</p>` : ''}
         ${errorLine}
         <form method="dialog" class="trash-actions">
           <button type="submit" value="cancel" class="secondary-btn">Keep item</button>
           <button type="submit" value="app_only" class="danger-btn">Delete only in the app</button>
         </form>`
      : `<h2>Also remove it from eBay?</h2>
         <p><b>${name}</b> is listed on eBay. Deleting it in the app doesn't end the eBay listing, so it can still sell there.</p>
         ${errorLine}
         <form method="dialog" class="trash-actions">
           <button type="submit" value="cancel" class="secondary-btn">Keep item</button>
           <button type="submit" value="app_only" class="secondary-btn">Delete only in the app</button>
           <button type="submit" value="remove" class="danger-btn">Remove from eBay and delete</button>
         </form>`;
    dlg.innerHTML = `<div class="trash-body">${body}</div>`;
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => {
      const choice = dlg.returnValue === 'cancel' || !dlg.returnValue ? null : dlg.returnValue;
      dlg.remove();
      resolve(choice);
    });
    dlg.showModal();
    // Focus starts on "Keep item", so a stray Enter doesn't delete anything.
    dlg.querySelector('button[value="cancel"]')?.focus();
  });
}
