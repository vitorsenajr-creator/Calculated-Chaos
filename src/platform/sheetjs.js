// SheetJS, loaded on demand (platform layer; v3.23.1). The same version
// the Excel export in main.js loads; whichever runs first loads it once.
const SRC = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
let loading = null;

export function loadSheetJs(){
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!loading){
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SRC;
      s.onload = () => resolve(window.XLSX);
      s.onerror = () => { loading = null; reject(new Error("Couldn't load the spreadsheet reader. Check your connection.")); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

// A File → [{ name, aoa }] (one per sheet; aoa = rows of cell values).
// CSV/TSV are read as text with raw values, so "03/04/2026" stays a string
// for the import to read with the chosen day/month order; Excel dates come
// as serial numbers.
export async function readSpreadsheet(file){
  const XLSX = await loadSheetJs();
  const isText = /\.(csv|tsv|txt)$/i.test(file.name) || /^text\//.test(file.type);
  const wb = isText
    ? XLSX.read(await file.text(), { type: 'string', raw: true })
    : XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', cellDates: false });
  return wb.SheetNames.map(name => ({
    name,
    aoa: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '', blankrows: false }),
  }));
}
