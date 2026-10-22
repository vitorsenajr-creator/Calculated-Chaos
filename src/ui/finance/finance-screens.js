// The Finances screens (Overview, Sales, Reports with the P&L, and Expenses)
// as one group that loads on first use (v3.26.9, src/ui/lazy-screen.js).
// main.js builds the hooks; this only wires them into each screen.
import { initFinanceView, renderFinance } from './finance-view.js';
import { initExpensesView, renderExpenses, exportExpensesCsv } from './expenses-view.js';
import { initPnlView, exportPnlCsv } from './pnl-view.js';

export function mountFinance(financeHooks, expensesHooks, pnlHooks){
  initFinanceView(financeHooks);
  initExpensesView(expensesHooks);
  initPnlView(pnlHooks);
  return { renderFinance, renderExpenses, exportExpensesCsv, exportPnlCsv };
}
