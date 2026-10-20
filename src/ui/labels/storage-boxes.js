// Registered storage boxes (UI layer; v3.17.3, docs/modularization.md):
// register + print, reprint, remove, through window.* handlers. The list
// lives on the Stock screen since v3.20.1 (ui/stock/stock-view.js).
import { appSettings } from '../../modules/state.js';
import { openBoxLabelModal } from './print-modal.js';

let saveSettings, refresh;

// saveSettings comes from main.js; refresh redraws the box list.
export function initStorageBoxes(deps){
  ({ saveSettings, refresh } = deps);

  window.registerAndPrintBox = async function(){
    const input = document.getElementById('sNewBoxName');
    const name = input.value.trim();
    if (!name){ alert('Enter a box name/number.'); return; }
    if ((appSettings.storageBoxes || []).some(b => b.name.toLowerCase() === name.toLowerCase())){
      alert('A box with that name is already registered.');
      return;
    }
    const box = { name, createdAt: Date.now() };
    appSettings.storageBoxes = [...(appSettings.storageBoxes || []), box];
    await saveSettings();
    input.value = '';
    refresh();
    openBoxLabelModal(box);
  };

  window.reprintStorageBox = function(index){
    const box = (appSettings.storageBoxes || [])[index];
    if (box) openBoxLabelModal(box);
  };

  window.removeStorageBox = async function(index){
    const box = (appSettings.storageBoxes || [])[index];
    if (!box) return;
    if (!confirm(`Remove "${box.name}" from the registered boxes list? This doesn't touch any item already assigned to it.`)) return;
    appSettings.storageBoxes = appSettings.storageBoxes.filter((_, i) => i !== index);
    await saveSettings();
    refresh();
  };
}
