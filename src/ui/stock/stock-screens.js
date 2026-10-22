// The Stock screen and its Pick tab as one group that loads on first use
// (v3.26.9, src/ui/lazy-screen.js). main.js builds the hooks.
import { initStockView, renderStock } from './stock-view.js';
import { initPickView } from './pick-view.js';

export function mountStock(stockHooks, pickHooks){
  initStockView(stockHooks);
  initPickView(pickHooks);
  return { renderStock };
}
