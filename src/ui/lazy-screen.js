// Screens the first view does not need load the first time they are used
// (v3.26.9). lazyScreen(load, mount) gives three calls:
// - use(fn): runs fn with the mounted screen. When the screen is already
//   loaded, fn runs at once (a click handler can still open a file or a
//   print from it); otherwise it waits for the load.
// - ifLoaded(fn): runs fn only if the screen is loaded. For redraws that
//   don't need to load it: a screen that loads later draws itself.
// - prefetch(): loads it in the background, once the first screen is up.
// A failed load shows a message and is tried again on the next use.
import { showToast } from './toast.js';

export function lazyScreen(load, mount){
  let screen = null;
  let pending = null;
  function get(){
    if (screen) return Promise.resolve(screen);
    if (!pending){
      pending = load()
        .then(mod => mount(mod))
        .then(s => { screen = s; return s; }, err => {
          pending = null;
          console.error('Could not load a screen:', err);
          showToast('This part of the app did not load. Reload the page to get the latest version.');
          throw err;
        });
    }
    return pending;
  }
  return {
    use(fn){
      if (screen){
        fn(screen);
        return Promise.resolve();
      }
      return get().then(fn, () => {});
    },
    ifLoaded(fn){
      if (screen) fn(screen);
    },
    prefetch(){
      get().catch(() => {});
    },
  };
}
