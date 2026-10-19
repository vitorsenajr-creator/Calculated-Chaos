// Full-screen photo viewer (UI layer; v3.17.2, docs/modularization.md).
// Moved out of main.js. Its state (which photos, which index) is private:
// callers only use openLightbox(photos, index), closeLightbox() and
// isLightboxOpen(). Before this, the catalog grid set the viewer's
// variables directly to show an item's photos.
let lightboxIndex = 0;
let lightboxPhotos = [];
let lightboxTouchStartX = 0;

// Opens the viewer on a copy of `photos` (URLs), starting at `startIdx`.
export function openLightbox(photos, startIdx = 0){
  lightboxPhotos = [...photos];
  lightboxIndex = startIdx;
  document.getElementById('lightboxOverlay').classList.remove('hidden');
  renderLightbox();
  document.body.style.overflow = 'hidden';
}

export function closeLightbox(){
  document.getElementById('lightboxOverlay').classList.add('hidden');
  document.body.style.overflow = '';
}

function renderLightbox(){
  const img = document.getElementById('lightboxImg');
  const counter = document.getElementById('lightboxCounter');
  const prev = document.getElementById('lightboxPrev');
  const next = document.getElementById('lightboxNext');
  const thumbs = document.getElementById('lightboxThumbs');

  img.src = lightboxPhotos[lightboxIndex];
  counter.textContent = `${lightboxIndex + 1} / ${lightboxPhotos.length}`;
  prev.disabled = lightboxIndex === 0;
  next.disabled = lightboxIndex === lightboxPhotos.length - 1;

  thumbs.innerHTML = lightboxPhotos.map((src, i) => `
      <div class="lightbox-thumb ${i === lightboxIndex ? 'active' : ''}" data-thumb="${i}">
        <img src="${src}">
      </div>
    `).join('');

  // Scroll active thumb into view
  const activeThumb = thumbs.querySelector('.lightbox-thumb.active');
  if (activeThumb) activeThumb.scrollIntoView({behavior:'smooth', inline:'center', block:'nearest'});
}

export function isLightboxOpen(){
  return !document.getElementById('lightboxOverlay').classList.contains('hidden');
}

// Wires the buttons, thumbnails, swipe and keyboard once (main.js calls it
// at startup, where these listeners used to be registered).
export function initLightbox(){
  document.getElementById('lightboxClose').addEventListener('click', closeLightbox);
  document.getElementById('lightboxOverlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('lightboxOverlay')) closeLightbox();
  });
  document.getElementById('lightboxPrev').addEventListener('click', (e) => {
    e.stopPropagation();
    if (lightboxIndex > 0){ lightboxIndex--; renderLightbox(); }
  });
  document.getElementById('lightboxNext').addEventListener('click', (e) => {
    e.stopPropagation();
    if (lightboxIndex < lightboxPhotos.length - 1){ lightboxIndex++; renderLightbox(); }
  });
  document.getElementById('lightboxThumbs').addEventListener('click', (e) => {
    const thumb = e.target.closest('.lightbox-thumb');
    if (thumb){ lightboxIndex = parseInt(thumb.dataset.thumb); renderLightbox(); }
  });

  // Swipe support for mobile
  document.getElementById('lightboxOverlay').addEventListener('touchstart', (e) => {
    lightboxTouchStartX = e.touches[0].clientX;
  }, {passive:true});
  document.getElementById('lightboxOverlay').addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - lightboxTouchStartX;
    if (Math.abs(dx) < 40) return; // too small
    if (dx < 0 && lightboxIndex < lightboxPhotos.length - 1){ lightboxIndex++; renderLightbox(); }
    if (dx > 0 && lightboxIndex > 0){ lightboxIndex--; renderLightbox(); }
  }, {passive:true});

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    if (document.getElementById('lightboxOverlay').classList.contains('hidden')) return;
    if (e.key === 'ArrowRight' && lightboxIndex < lightboxPhotos.length - 1){ lightboxIndex++; renderLightbox(); }
    if (e.key === 'ArrowLeft' && lightboxIndex > 0){ lightboxIndex--; renderLightbox(); }
    if (e.key === 'Escape') closeLightbox();
  });
}
