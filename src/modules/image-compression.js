// Photo compression — pure browser-API function (File in, compressed data
// URL out), moved out of main.js's IIFE verbatim. No closure dependency
// beyond the two size/quality constants, both already in constants.js.
import { MAX_PHOTO_DIM, PHOTO_QUALITY } from './constants.js';

export function compressImage(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > MAX_PHOTO_DIM){
          height = Math.round(height * (MAX_PHOTO_DIM / width));
          width = MAX_PHOTO_DIM;
        } else if (height > MAX_PHOTO_DIM){
          width = Math.round(width * (MAX_PHOTO_DIM / height));
          height = MAX_PHOTO_DIM;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', PHOTO_QUALITY));
      };
      img.onerror = reject;
      img.src = ev.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
