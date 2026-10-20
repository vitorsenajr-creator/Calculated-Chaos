// Image files picked by the person (platform layer; v3.22.1). This is the
// web implementation: decode with an <img>, redraw on a canvas. A
// Capacitor build can keep it (the WebView has both).

// Shrinks a picked image so its longer side is at most `maxPx` and
// returns it as a data: URL (WebP when the browser can encode it, else
// PNG; both keep transparency). SVGs are drawn to pixels too, so nothing
// but a plain bitmap is ever saved. Rejects when the file isn't an image
// the browser can read.
export function shrinkImageToDataUrl(file, maxPx = 256){
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)){
      reject(new Error('Pick an image file (PNG, JPG, WebP or SVG).'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const w = img.naturalWidth || maxPx;
      const h = img.naturalHeight || maxPx;
      const scale = Math.min(1, maxPx / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      let data = canvas.toDataURL('image/webp', 0.9);
      if (!data.startsWith('data:image/webp')) data = canvas.toDataURL('image/png');
      resolve(data);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That image couldn't be read. Try a PNG or JPG."));
    };
    img.src = url;
  });
}
