// A short confirmation at the bottom of the screen (v3.23.5, shared since
// v3.23.6 by Expenses and Sales). Tokens only; announced as a status.
export function showToast(text){
  let t = document.getElementById('appToast');
  if (!t){
    t = document.createElement('div');
    t.id = 'appToast';
    t.className = 'app-toast';
    t.setAttribute('role', 'status');
    document.body.appendChild(t);
  }
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2200);
}
