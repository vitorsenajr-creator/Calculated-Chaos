// Saving and sharing files (platform layer; v3.17.3,
// docs/modularization.md). This is the web implementation: the native
// share sheet when the browser can share files, else an <a download>
// link. A Capacitor build swaps this file for the Filesystem + Share
// plugins; callers don't change.

// iOS Safari (and most mobile browsers) ignore the <a download> attribute
// on a blob URL — it just opens the file in a new tab, forcing a manual
// long-press → Save. The Web Share API opens the native share sheet
// instead, which saves (or shares straight into FlashLabel Pro/Files) in
// one step.
//
// Resolves to 'shared', 'downloaded' or 'cancelled' (the user closed the
// share sheet). A share that fails for any other reason falls back to the
// download link, or is rethrown with { onShareError: 'throw' }.
export async function saveOrShareFile(blob, filename, type, { onShareError = 'download' } = {}){
  const file = new File([blob], filename, { type });
  if (navigator.canShare && navigator.canShare({ files: [file] })){
    try{
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    }catch(e){
      if (e && e.name === 'AbortError') return 'cancelled'; // user cancelled the share sheet
      if (onShareError === 'throw') throw e; // real failure, not a user cancel
      // fall through to the download-link approach below
    }
  }
  downloadBlob(blob, filename);
  return 'downloaded';
}

// Download only, no share sheet (the CSV exports). The object URL is
// revoked 2 s later, not right after the click: some browsers start the
// download asynchronously and an immediate revoke can cancel it.
export function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Downloads a URL the page already has (a data: photo, or a Storage URL)
// under `filename`. A cross-origin URL ignores `download` and just opens.
export function downloadUrl(url, filename){
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
