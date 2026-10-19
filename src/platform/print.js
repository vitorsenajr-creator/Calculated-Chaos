// Printing (platform layer; v3.17.3, docs/modularization.md). This is the
// web implementation: a print-only view (#labelPrintArea in index.html,
// body.printing-label in style.css) plus window.print(). A Capacitor build
// swaps this file for a native printer plugin; callers don't change.

// Prints `html` on a page of exactly widthIn × heightIn inches.
//
// Must stay synchronous, and callers must call it synchronously from the
// click handler: iOS Safari drops window.print() after an await or a
// confirm() (v3.13.47).
export function printHtml(html, { widthIn, heightIn }){
  // Set the physical page size to match the configured label so the
  // thermal printer doesn't get sent a full-sheet page.
  let pageStyle = document.getElementById('dynamicLabelPageStyle');
  if (!pageStyle){
    pageStyle = document.createElement('style');
    pageStyle.id = 'dynamicLabelPageStyle';
    document.head.appendChild(pageStyle);
  }
  pageStyle.textContent = `@page{ size: ${widthIn}in ${heightIn}in; margin: 0; }`;

  document.getElementById('labelPrintContent').innerHTML = html;
  document.body.classList.add('printing-label');
  window.print();
}

function exitPrintLabelView(){
  document.body.classList.remove('printing-label');
}

// Wires the way back from the print-only view, once at startup.
export function initPrint(){
  document.getElementById('labelPrintExitBtn').addEventListener('click', exitPrintLabelView);
  // 'afterprint' + refocus cover desktop browsers (dialog closes → app
  // restores automatically); the exit button above covers mobile browsers
  // where neither of those reliably fires.
  window.addEventListener('afterprint', exitPrintLabelView);
  window.addEventListener('focus', () => {
    if (document.body.classList.contains('printing-label')) exitPrintLabelView();
  });
}
