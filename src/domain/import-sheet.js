// Spreadsheet import (v3.23.1) — pure logic, no DOM, window, Firebase or
// app state. The screen (ui/import/) reads the file with SheetJS into rows
// (arrays of cell values) and passes them here with the settings it needs
// (the platform fee function, the existing catalog). Everything that turns
// a sheet into items lives here so it can be tested in plain Node:
//   1. suggestMapping(headers): which item field each column fills, from
//      the header text (English, Portuguese, Spanish);
//   2. suggestValueMap(...): how the sheet spells statuses, conditions and
//      platforms, mapped to the app's keys;
//   3. buildImportRows(...): each row as items to save, with its errors,
//      warnings and possible duplicates; importTotals() sums them up.

export const MAX_IMPORT_ROWS = 10000;
export const MAX_QTY_PER_ROW = 100;

// The item fields a column can fill, in the order the review step lists
// them. `kind` drives the conversion.
export const IMPORT_FIELDS = [
  { key: 'name', label: 'Name', kind: 'text' },
  { key: 'brand', label: 'Brand', kind: 'text' },
  { key: 'category', label: 'Category', kind: 'text' },
  { key: 'size', label: 'Size', kind: 'text' },
  { key: 'color', label: 'Color', kind: 'text' },
  { key: 'condition', label: 'Condition', kind: 'condition' },
  { key: 'status', label: 'Status', kind: 'status' },
  { key: 'cost', label: 'Cost', kind: 'money' },
  { key: 'listPrice', label: 'List price', kind: 'money' },
  { key: 'soldPrice', label: 'Sold price', kind: 'money' },
  { key: 'soldAt', label: 'Date sold', kind: 'date' },
  { key: 'soldPlatform', label: 'Sold on (platform)', kind: 'platform' },
  { key: 'feesTotal', label: 'Platform fees', kind: 'money' },
  { key: 'shippingCost', label: 'Shipping paid', kind: 'money' },
  { key: 'otherCosts', label: 'Other costs', kind: 'money' },
  { key: 'createdAt', label: 'Date added', kind: 'date' },
  { key: 'listedPlatforms', label: 'Listed on (platforms)', kind: 'platforms' },
  { key: 'legacyCode', label: 'Code / SKU (kept as legacy code)', kind: 'text' },
  { key: 'quantity', label: 'Quantity', kind: 'number' },
  { key: 'source', label: 'Source', kind: 'text' },
  { key: 'storageBox', label: 'Storage box', kind: 'text' },
  { key: 'notes', label: 'Notes', kind: 'text' },
  { key: 'weight', label: 'Weight (lb)', kind: 'number' },
  { key: 'length', label: 'Length (in)', kind: 'number' },
  { key: 'width', label: 'Width (in)', kind: 'number' },
  { key: 'height', label: 'Height (in)', kind: 'number' },
];
export const FIELD_BY_KEY = Object.fromEntries(IMPORT_FIELDS.map(f => [f.key, f]));

// Lowercase, no accents, punctuation as spaces: "Preço (R$)" → "preco r".
export function normalizeText(s){
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Header spellings per field. A header that equals one of these maps with
// high confidence; one that contains one of the multi-word ones, medium.
const HEADER_SYNONYMS = {
  name: ['name', 'item', 'item name', 'title', 'product', 'product name', 'listing title', 'nome', 'produto', 'titulo', 'nome do item', 'nome do produto', 'peca', 'nombre', 'articulo', 'producto'],
  brand: ['brand', 'marca', 'designer', 'label'],
  category: ['category', 'categoria', 'department', 'departamento'],
  size: ['size', 'tamanho', 'talla', 'tam', 'tamano'],
  color: ['color', 'colour', 'cor', 'colores'],
  condition: ['condition', 'cond', 'condicao', 'estado', 'condicion', 'estado de conservacao'],
  status: ['status', 'situacao', 'situacion', 'stage', 'etapa'],
  cost: ['cost', 'cost price', 'purchase price', 'paid', 'price paid', 'cogs', 'buy price', 'unit cost', 'custo', 'preco de compra', 'valor pago', 'pago', 'costo', 'precio de compra'],
  listPrice: ['list price', 'price', 'asking price', 'listing price', 'listed price', 'retail price', 'preco', 'preco anunciado', 'preco de anuncio', 'valor', 'valor anunciado', 'precio', 'precio de lista'],
  soldPrice: ['sold price', 'sale price', 'sold for', 'selling price', 'sold amount', 'preco de venda', 'valor vendido', 'valor de venda', 'vendido por', 'precio de venta', 'precio vendido'],
  soldAt: ['date sold', 'sold date', 'sale date', 'sold on date', 'data da venda', 'data de venda', 'data venda', 'vendido em', 'fecha de venta', 'fecha venta'],
  soldPlatform: ['sold on', 'platform sold', 'sold platform', 'sold via', 'sold where', 'marketplace', 'plataforma de venda', 'onde vendeu', 'plataforma venta'],
  feesTotal: ['fees', 'fee', 'platform fees', 'platform fee', 'selling fees', 'taxas', 'taxa', 'comissao', 'tarifas', 'comision', 'tarifa'],
  shippingCost: ['shipping', 'shipping cost', 'shipping paid', 'postage', 'frete', 'envio', 'costo de envio', 'custo de envio'],
  otherCosts: ['other costs', 'other cost', 'extra costs', 'outros custos', 'otros costos'],
  createdAt: ['date added', 'date listed', 'added', 'date', 'listed date', 'acquired', 'date acquired', 'purchase date', 'data', 'data de cadastro', 'data cadastro', 'data de compra', 'fecha', 'fecha de compra'],
  listedPlatforms: ['listed on', 'platforms', 'platform', 'channels', 'anunciado em', 'plataformas', 'plataforma', 'publicado en'],
  legacyCode: ['sku', 'code', 'item code', 'item id', 'id', 'item number', 'item no', 'tag', 'codigo', 'cod', 'ref', 'referencia', 'codigo do item', 'etiqueta'],
  quantity: ['qty', 'quantity', 'quantidade', 'qtd', 'qtde', 'cantidad', 'units', 'unidades'],
  source: ['source', 'sourced from', 'sourced', 'bought at', 'origem', 'fonte', 'fornecedor', 'comprado em', 'proveedor', 'origen'],
  storageBox: ['box', 'bin', 'location', 'storage', 'storage box', 'shelf', 'caixa', 'local', 'localizacao', 'prateleira', 'caja', 'ubicacion'],
  notes: ['notes', 'note', 'comments', 'comment', 'observacoes', 'observacao', 'obs', 'notas', 'comentarios'],
  weight: ['weight', 'weight lb', 'weight lbs', 'weight oz', 'lbs', 'peso', 'peso lb'],
  length: ['length', 'length in', 'comprimento', 'largo'],
  width: ['width', 'width in', 'largura', 'ancho'],
  height: ['height', 'height in', 'altura', 'alto'],
};
// Columns that are computed by the app and must never be imported over it.
const IGNORED_HEADERS = ['net profit', 'profit', 'projected profit', 'lucro', 'lucro liquido', 'ganancia', 'margin', 'margem', 'days in catalog', 'days to sell', 'photo count', 'dias'];

// One suggestion per column: { field: key | null, confidence: 'high' |
// 'medium' | null }. Each field is used by at most one column (the first,
// best match wins), so "Price" and "Sold Price" don't both fill listPrice.
export function suggestMapping(headers){
  const norm = headers.map(normalizeText);
  const out = norm.map(() => ({ field: null, confidence: null }));
  const taken = new Set();
  const assign = (i, field, confidence) => { out[i] = { field, confidence }; taken.add(field); };
  // Exact matches first, then "contains" matches.
  norm.forEach((h, i) => {
    if (!h || IGNORED_HEADERS.includes(h)) return;
    const field = Object.keys(HEADER_SYNONYMS).find(k => !taken.has(k) && HEADER_SYNONYMS[k].includes(h));
    if (field) assign(i, field, 'high');
  });
  norm.forEach((h, i) => {
    if (!h || out[i].field || IGNORED_HEADERS.some(x => h.includes(x))) return;
    let best = null;
    for (const k of Object.keys(HEADER_SYNONYMS)){
      if (taken.has(k)) continue;
      for (const syn of HEADER_SYNONYMS[k]){
        if (syn.includes(' ') || syn.length >= 4){
          const re = new RegExp(`(^| )${syn}( |$)`);
          if (re.test(h) && (!best || syn.length > best.len)) best = { k, len: syn.length };
        }
      }
    }
    if (best) assign(i, best.k, 'medium');
  });
  return out;
}

// ---------- Values ----------

// "$1,234.50", "R$ 1.234,50", "12,5", 12.5 → number; '' → null; junk → NaN.
export function parseMoney(v){
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  let s = String(v).trim();
  if (!s || s === '-' || s === '—') return null;
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s.replace(/^[^\d-]+/, ''));
  s = s.replace(/[^\d.,]/g, '');
  if (!s) return NaN;
  const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0){
    const dec = lastDot > lastComma ? '.' : ',';
    s = s.split(dec === '.' ? ',' : '.').join('').replace(dec, '.');
  } else if (lastComma >= 0){
    const after = s.length - lastComma - 1;
    s = (after === 3 && s.indexOf(',') === lastComma && s.length > 4) ? s.replace(',', '') : s.replace(/,/g, '.');
    if ((s.match(/\./g) || []).length > 1) return NaN;
  } else if ((s.match(/\./g) || []).length > 1){
    s = s.replace(/\./g, '');
  }
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return NaN;
  return neg ? -n : n;
}

// Which order "03/04/2025" uses, from every date-like string in a column:
// a first part over 12 means day first; a second part over 12, month first.
// Defaults to month first (US).
export function detectDateOrder(values){
  let dmy = false, mdy = false;
  values.forEach(v => {
    const m = typeof v === 'string' && v.trim().match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
    if (!m) return;
    if (+m[1] > 12) dmy = true;
    if (+m[2] > 12) mdy = true;
  });
  if (dmy && !mdy) return 'dmy';
  return 'mdy';
}

// A cell → local-time ms at noon of that day (so time zones never move the
// day), null when blank, NaN when it can't be read. `order` is 'mdy' or 'dmy'.
export function parseDate(v, order = 'mdy'){
  if (v === null || v === undefined || v === '') return null;
  const atNoon = (y, m, d) => {
    const t = new Date(y, m - 1, d, 12).getTime();
    const back = new Date(t);
    return back.getFullYear() === y && back.getMonth() === m - 1 && back.getDate() === d ? t : NaN;
  };
  if (v instanceof Date) return isNaN(v.getTime()) ? NaN : atNoon(v.getFullYear(), v.getMonth() + 1, v.getDate());
  if (typeof v === 'number'){
    if (v > 20000 && v < 80000){
      const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
      return atNoon(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    return NaN;
  }
  const s = String(v).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/);
  if (m) return atNoon(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
  if (m){
    let y = +m[3];
    if (y < 100) y += y < 70 ? 2000 : 1900;
    const [a, b] = [+m[1], +m[2]];
    return order === 'dmy' ? atNoon(y, b, a) : atNoon(y, a, b);
  }
  const t = Date.parse(s);
  if (!isNaN(t)){ const d = new Date(t); return atNoon(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
  return NaN;
}

// ---------- Value words → app keys ----------

const STATUS_WORDS = {
  vendido: ['sold', 'vendido', 'vendida', 'vendidos', 'yes', 'y', 'sim', 's', 'si', 'true', 'x', 'done', 'shipped', 'enviado', 'entregue', 'delivered'],
  anunciado: ['listed', 'active', 'live', 'for sale', 'on sale', 'anunciado', 'anunciada', 'ativo', 'ativa', 'a venda', 'publicado', 'publicada', 'en venta', 'activo', 'listing'],
  catalogado: ['in stock', 'stock', 'inventory', 'available', 'unlisted', 'not listed', 'draft', 'catalogado', 'catalogada', 'estoque', 'em estoque', 'disponivel', 'nao', 'no', 'n', 'false', 'inventario', 'disponible', 'pending', 'pendente', 'to list', 'a anunciar'],
};
const CONDITION_WORDS = {
  novo_etiqueta: ['nwt', 'new with tags', 'new with tag', 'brand new with tags', 'novo com etiqueta', 'nova com etiqueta', 'novo c etiqueta', 'nuevo con etiqueta', 'nuevo con etiquetas', 'bnwt'],
  novo_sem_etiqueta: ['nwot', 'new without tags', 'new', 'brand new', 'novo', 'nova', 'novo sem etiqueta', 'nuevo', 'nuevo sin etiqueta', 'nib', 'new in box'],
  excelente: ['euc', 'excellent', 'excellent used condition', 'like new', 'excelente', 'seminovo', 'seminova', 'como nuevo', 'mint'],
  bom: ['vguc', 'guc', 'good', 'very good', 'good used condition', 'used', 'pre owned', 'preowned', 'bom', 'boa', 'muito bom', 'usado', 'usada', 'bueno', 'buena', 'muy bueno'],
  aceitavel: ['fair', 'acceptable', 'ok', 'aceitavel', 'regular', 'razoavel', 'aceptable'],
  defeito: ['poor', 'damaged', 'flawed', 'for parts', 'as is', 'as-is', 'defeito', 'com defeito', 'danificado', 'defectuoso', 'para piezas'],
};
const PLATFORM_WORDS = {
  ebay: ['ebay', 'e bay'],
  poshmark: ['poshmark', 'posh'],
  mercari: ['mercari'],
  depop: ['depop'],
  vinted: ['vinted'],
};

function lookup(words, raw){
  const n = normalizeText(raw);
  if (!n) return null;
  for (const [key, list] of Object.entries(words)){
    if (list.map(normalizeText).includes(n)) return key;
  }
  return null;
}

// Splits "eBay, Poshmark / Mercari" into its parts.
export function splitList(v){
  return String(v ?? '').split(/[,;\/|+&]| and | e | y /i).map(s => s.trim()).filter(Boolean);
}

// The distinct spellings of each kind in the mapped columns, with the
// app key each one maps to (null when unknown). `platformKeys` are the
// business's platforms (built-in and custom) by key and label, so a custom
// platform's own name maps too.
export function suggestValueMap(rows, mapping, platformKeys = []){
  const out = { status: {}, condition: {}, platform: {} };
  const col = (field) => mapping.findIndex(m => m && m.field === field);
  const add = (kind, raw, key) => {
    const r = String(raw ?? '').trim();
    if (!r || r in out[kind]) return;
    out[kind][r] = key;
  };
  const platformKey = (raw) => {
    const n = normalizeText(raw);
    const custom = platformKeys.find(p => normalizeText(p.key) === n || normalizeText(p.label) === n);
    return custom ? custom.key : lookup(PLATFORM_WORDS, raw);
  };
  const statusCol = col('status'), condCol = col('condition'), soldOnCol = col('soldPlatform'), listedCol = col('listedPlatforms');
  rows.forEach(r => {
    if (statusCol >= 0) add('status', r[statusCol], lookup(STATUS_WORDS, r[statusCol]));
    if (condCol >= 0) add('condition', r[condCol], lookup(CONDITION_WORDS, r[condCol]));
    if (soldOnCol >= 0) add('platform', r[soldOnCol], platformKey(r[soldOnCol]));
    if (listedCol >= 0) splitList(r[listedCol]).forEach(p => add('platform', p, platformKey(p)));
  });
  return out;
}

// ---------- Rows → items ----------

function text(v){
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).replace(/\s+/g, ' ').trim();
}
function num(v){
  const n = parseMoney(v);
  return n === null ? null : n;
}
// Item fields are saved as strings when the item form saves them as strings.
const asField = (n) => (n === null || Number.isNaN(n) ? '' : String(Math.round(n * 100) / 100));

export function computeImportNetProfit({ price, cost, fee, shippingCost, otherCosts }){
  return price - (cost || 0) - (fee || 0) - (shippingCost || 0) - (otherCosts || 0);
}

// The app's own spelling of a category ("shoes" → "Shoes"); a new one is
// kept as written; blank → "Other".
function matchCategory(raw, categories){
  if (!raw) return 'Other';
  const n = normalizeText(raw);
  return categories.find(c => normalizeText(c) === n) || raw;
}

// A key to find the same item already in the catalog: its code (legacy or
// app), else name + size + price.
export function normCode(c){
  return String(c ?? '').trim().replace(/^#/, '').replace(/\s+/g, '').toLowerCase();
}
function nameKey(name, size, price){
  return `${normalizeText(name)}|${normalizeText(size)}|${price === null || Number.isNaN(price) ? '' : Number(price).toFixed(2)}`;
}
export function catalogIndex(catalog){
  const codes = new Map(), names = new Map();
  catalog.forEach(i => {
    [i.legacyCode, i.productCode].forEach(c => { const k = normCode(c); if (k && !codes.has(k)) codes.set(k, i); });
    const nk = nameKey(i.name, i.size, parseFloat(i.listPrice));
    if (normalizeText(i.name) && !names.has(nk)) names.set(nk, i);
  });
  return { codes, names };
}

// Every data row (after the header) as { row, cells, items, errors,
// warnings, duplicateOf, empty }. `opts`:
//   mapping       one { field } per column (suggestMapping or the review);
//   valueMap      { status, condition, platform } raw → key;
//   dateOrder     'mdy' | 'dmy';
//   fee(platform, price)  the business's fee estimate;
//   catalog       the items already in the app (duplicates);
//   categories    the app's category names, to match their spelling;
//   now           ms, for items without a date.
export function buildImportRows(rows, { mapping, valueMap = { status: {}, condition: {}, platform: {} }, dateOrder = 'mdy', fee = () => 0, catalog = [], categories = [], now = Date.now() } = {}){
  const idx = catalogIndex(catalog);
  const colOf = {};
  mapping.forEach((m, i) => { if (m && m.field && !(m.field in colOf)) colOf[m.field] = i; });
  const cell = (r, f) => (f in colOf ? r[colOf[f]] : undefined);
  const mapValue = (kind, raw) => {
    const r = String(raw ?? '').trim();
    if (!r) return null;
    return r in valueMap[kind] ? valueMap[kind][r] : null;
  };

  return rows.map((r, n) => {
    const out = { row: n + 2, cells: r, items: [], errors: [], warnings: [], duplicateOf: null, empty: false };
    const mapped = Object.keys(colOf).map(f => text(cell(r, f)));
    if (!mapped.some(Boolean)){ out.empty = true; return out; }

    const money = (f) => {
      const raw = cell(r, f);
      const v = num(raw);
      if (Number.isNaN(v)){ out.errors.push(`${FIELD_BY_KEY[f].label}: "${text(raw)}" isn't a number`); return null; }
      if (v !== null && v < 0){ out.errors.push(`${FIELD_BY_KEY[f].label} can't be negative`); return null; }
      return v;
    };
    const date = (f) => {
      const raw = cell(r, f);
      const t = parseDate(raw, dateOrder);
      if (Number.isNaN(t)){ out.errors.push(`${FIELD_BY_KEY[f].label}: "${text(raw)}" isn't a date`); return null; }
      if (t !== null && t > now + 86400000){ out.warnings.push(`${FIELD_BY_KEY[f].label} is in the future`); }
      return t;
    };

    const cost = money('cost'), listPrice = money('listPrice'), soldPriceRaw = money('soldPrice');
    const feesRaw = money('feesTotal'), shipping = money('shippingCost'), other = money('otherCosts');
    const soldAtRaw = date('soldAt'), createdAtRaw = date('createdAt');
    const dims = {};
    ['weight', 'length', 'width', 'height'].forEach(f => {
      const v = num(cell(r, f));
      if (Number.isNaN(v)){ out.warnings.push(`${FIELD_BY_KEY[f].label}: "${text(cell(r, f))}" ignored`); dims[f] = ''; }
      else dims[f] = asField(v);
    });

    // Status: the mapped word, else sold when there's a sale price or date.
    let status = mapValue('status', cell(r, 'status'));
    if (text(cell(r, 'status')) && !status) out.warnings.push(`Status "${text(cell(r, 'status'))}" not recognized; set from the other columns`);
    if (!status) status = (soldPriceRaw || soldAtRaw) ? 'vendido' : 'catalogado';

    const listed = [...new Set(splitList(cell(r, 'listedPlatforms')).map(p => mapValue('platform', p)).filter(Boolean))];
    if (status === 'anunciado' && !listed.length) out.warnings.push('Listed, but no platform given');

    let condition = mapValue('condition', cell(r, 'condition')) || '';
    if (text(cell(r, 'condition')) && !condition) out.warnings.push(`Condition "${text(cell(r, 'condition'))}" not recognized; left empty`);

    let name = text(cell(r, 'name'));
    if (!name){
      name = [text(cell(r, 'brand')), text(cell(r, 'category'))].filter(Boolean).join(' ') || `Imported item (row ${out.row})`;
      out.warnings.push('No name; one was made from the other columns');
    }

    let qty = 1;
    const qRaw = cell(r, 'quantity');
    if (text(qRaw)){
      const q = num(qRaw);
      if (!Number.isInteger(q) || q < 1){ out.warnings.push(`Quantity "${text(qRaw)}" isn't a whole number; 1 used`); }
      else if (q > MAX_QTY_PER_ROW){ qty = MAX_QTY_PER_ROW; out.warnings.push(`Quantity capped at ${MAX_QTY_PER_ROW}`); }
      else qty = q;
    }

    const base = {
      name,
      brand: text(cell(r, 'brand')),
      category: matchCategory(text(cell(r, 'category')), categories),
      size: text(cell(r, 'size')),
      color: text(cell(r, 'color')),
      condition,
      cost: asField(cost),
      listPrice: asField(listPrice),
      ...dims,
      notes: text(cell(r, 'notes')),
      source: text(cell(r, 'source')),
      storageBox: text(cell(r, 'storageBox')),
      legacyCode: text(cell(r, 'legacyCode')),
      listedPlatforms: listed,
      status,
      createdAt: createdAtRaw || soldAtRaw || now,
    };

    if (status === 'vendido'){
      const soldPrice = soldPriceRaw ?? listPrice;
      if (soldPrice === null) out.warnings.push('Sold, but no sale price; recorded as $0');
      let soldPlatform = mapValue('platform', cell(r, 'soldPlatform'));
      if (text(cell(r, 'soldPlatform')) && !soldPlatform) out.warnings.push(`Platform "${text(cell(r, 'soldPlatform'))}" not recognized; "Other" used`);
      if (!soldPlatform) soldPlatform = listed.length === 1 ? listed[0] : 'outra';
      const price = soldPrice || 0;
      const feesEstimated = feesRaw === null;
      const feesTotal = feesEstimated ? (fee(soldPlatform, price) || 0) : feesRaw;
      if (!soldAtRaw) out.warnings.push('Sold, but no sale date; the date added is used');
      Object.assign(base, {
        soldPrice: price,
        soldPlatform,
        soldAt: soldAtRaw || createdAtRaw || now,
        feesTotal,
        feesEstimated,
        shippingCost: shipping || 0,
        otherCosts: other || 0,
        netProfit: computeImportNetProfit({ price, cost: cost || 0, fee: feesTotal, shippingCost: shipping || 0, otherCosts: other || 0 }),
      });
    }

    // Possible duplicate of an item already in the app.
    const byCode = normCode(base.legacyCode) && idx.codes.get(normCode(base.legacyCode));
    const byName = idx.names.get(nameKey(base.name, base.size, listPrice));
    const dup = byCode || byName;
    if (dup) out.duplicateOf = { id: dup.id, name: dup.name || '', code: dup.productCode || '', by: byCode ? 'code' : 'name' };

    for (let k = 0; k < qty; k++) out.items.push({ ...base });
    return out;
  });
}

// What the preview's totals show. `skip` is the set of row numbers the
// person chose to skip (duplicates); rows with errors are never imported.
export function importTotals(built, skip = new Set()){
  const t = { rows: 0, empty: 0, errors: 0, duplicates: 0, skipped: 0, items: 0, inStock: 0, listed: 0, sold: 0, stockValue: 0, salesRevenue: 0, feesEstimated: 0, warnings: 0 };
  built.forEach(b => {
    if (b.empty){ t.empty++; return; }
    t.rows++;
    if (b.warnings.length) t.warnings++;
    if (b.duplicateOf) t.duplicates++;
    if (b.errors.length){ t.errors++; return; }
    if (skip.has(b.row)){ t.skipped++; return; }
    b.items.forEach(i => {
      t.items++;
      if (i.status === 'vendido'){ t.sold++; t.salesRevenue += i.soldPrice || 0; if (i.feesEstimated) t.feesEstimated++; }
      else {
        if (i.status === 'anunciado') t.listed++;
        t.inStock++;
        t.stockValue += parseFloat(i.listPrice) || 0;
      }
    });
  });
  return t;
}

// The items to save, in sheet order, each tagged with its row.
export function itemsToImport(built, skip = new Set()){
  const out = [];
  built.forEach(b => {
    if (b.empty || b.errors.length || skip.has(b.row)) return;
    b.items.forEach((i, k) => out.push({ ...i, importRow: b.row, importCopy: b.items.length > 1 ? k + 1 : null }));
  });
  return out;
}

// The header row: the first row with at least two non-empty text cells.
export function findHeaderRow(aoa){
  for (let i = 0; i < Math.min(aoa.length, 20); i++){
    const cells = (aoa[i] || []).filter(c => typeof c === 'string' && c.trim());
    if (cells.length >= 2) return i;
  }
  return 0;
}

// The documents to save: each item with its id, app code, the import's id
// and file name, and the fields an item saved from the form always has.
// `codes` comes from one counter reservation (one per item, as decided:
// every piece gets its own label); `newId()` makes item ids; `prepFor(item)`
// is the business's auto-prep rule.
export function buildImportDocs(list, { codes, importId, fileName = '', importedAt = Date.now(), newId, prepFor = () => 'ready' }){
  return list.map((i, k) => {
    const doc = {
      ...i,
      id: newId(),
      productCode: codes[k],
      importId,
      importFile: fileName,
      importedAt,
      photos: [],
      gender: '',
      clothingType: '',
      freeShipping: false,
      measurements: null,
      ebayListingId: null, ebayListingUrl: null, ebayOfferId: null, ebaySku: null, ebayListedAt: null,
      ebayPublishError: null, hostedPhotoUrls: null,
      ebayCategoryId: null, ebayCategoryPath: null, ebayValidConditions: null, ebayAspects: {},
      listingTitle: '', listingDescription: '', listingStyleTags: [], listingIsAi: false,
      aiAnalysis: null, aiFacts: null,
    };
    doc.prep = doc.status === 'catalogado' ? prepFor(doc) : 'ready';
    if (doc.importCopy === null) delete doc.importCopy;
    return doc;
  });
}

// The imports in the catalog, newest first: { importId, fileName,
// importedAt, count } — what the Import screen lists for "Undo".
export function importsInCatalog(items){
  const by = new Map();
  items.forEach(i => {
    if (!i.importId) return;
    const e = by.get(i.importId) || { importId: i.importId, fileName: i.importFile || '', importedAt: i.importedAt || 0, count: 0 };
    e.count++;
    by.set(i.importId, e);
  });
  return [...by.values()].sort((a, b) => b.importedAt - a.importedAt);
}
