// Sample business for the screenshot harness (tests/harness/). Invented
// pieces and numbers only: nothing here comes from a real seller's catalog.
// Dates are relative to the moment the harness starts, so the Home periods
// and the Finances months always have sales to show.

const DAY = 24 * 60 * 60 * 1000;
const BIZ = 'businesses/harness';

// Thumbnails for the pieces on the Pick list (the photos the Pick screen draws).
const PICK_PHOTOS = {
  '#0631': '/tests/harness/photos/pick-belt.webp',
  '#0648': '/tests/harness/photos/pick-bodysuit.webp',
  '#0662': '/tests/harness/photos/pick-pants.webp',
  '#0679': '/welcome/sample-photo-2.webp',
  '#0688': '/tests/harness/photos/pick-beanie.webp',
};

// [code, name, clothingType, brand, size, color, cost, listPrice, status,
//  platforms, box, createdDaysAgo, soldDaysAgo, soldPrice, fees, shipping]
const PIECES = [
  ['#0897', 'Linen midi skirt', 'Skirt', 'Madewell', 'S', 'Sage', 6, 24, 'vendido', ['poshmark'], 'B-12', 30, 4, 24, 4.8, 7.9],
  ['#0412', 'Cotton tee, white', 'Top', 'Uniqlo', 'M', 'White', 2, 12, 'vendido', ['ebay'], 'B-03', 28, 2, 12, 1.9, 5.5],
  ['#0455', 'Wool blazer, navy', 'Jacket', 'J.Crew', '8', 'Navy', 9, 38, 'vendido', ['poshmark'], 'B-07', 40, 9, 42, 8.4, 9.6],
  ['#0219', 'Silk scarf', 'Accessory', 'Hermès', 'One size', 'Blue', 14, 58, 'vendido', ['ebay'], 'B-01', 60, 12, 55, 11, 4.5],
  ['#0503', 'Denim jacket', 'Jacket', 'Levi’s', 'M', 'Mid wash', 5, 28, 'vendido', ['mercari'], 'B-07', 25, 6, 30, 3.9, 8.2],
  ['#0561', 'Pleated trousers', 'Pants', 'Banana Republic', '4', 'Camel', 4, 20, 'vendido', ['poshmark'], 'B-12', 22, 15, 20, 4, 7.9],
  ['#0590', 'Floral sundress', 'Dress', 'Anthropologie', 'S', 'Print', 7, 36, 'vendido', ['ebay'], 'B-03', 18, 1, 34, 6.1, 8.2],
  ['#0604', 'Ribbed cardigan', 'Sweater', 'Gap', 'L', 'Oatmeal', 3, 16, 'vendido', ['poshmark'], 'B-07', 15, 3, 16, 3.2, 7.9],
  ['#0631', 'Leather belt', 'Accessory', 'Coach', 'M', 'Brown', 8, 32, 'anunciado', ['poshmark'], 'B-01', 12, null, null, null, null],
  ['#0648', 'Striped button shirt', 'Top', 'Zara', 'M', 'Blue stripe', 2, 15, 'anunciado', ['poshmark'], 'B-03', 11, null, null, null, null],
  ['#0662', 'Corduroy wide-leg pants', 'Pants', 'Free People', '26', 'Rust', 6, 34, 'anunciado', ['ebay'], 'B-12', 9, null, null, null, null],
  ['#0679', 'Satin slip dress', 'Dress', 'Reformation', 'XS', 'Champagne', 10, 48, 'anunciado', ['poshmark', 'mercari'], 'B-07', 8, null, null, null, null],
  ['#0688', 'Knit beanie', 'Accessory', 'Muji', 'One size', 'Gray', 1, 9, 'anunciado', ['ebay'], 'B-01', 7, null, null, null, null],
  ['#0701', 'Cropped moto jacket', 'Jacket', 'AllSaints', 'S', 'Black', 12, 62, 'anunciado', ['ebay'], 'B-07', 6, null, null, null, null],
  ['#0715', 'Pinstripe waistcoat', 'Vest', 'Ted Baker', '40', 'Gray', 5, 26, 'anunciado', ['poshmark'], 'B-12', 5, null, null, null, null],
  ['#0722', 'Crochet tote bag', 'Bag', 'Sézane', 'One size', 'Natural', 4, 22, 'anunciado', ['depop'], 'B-01', 4, null, null, null, null],
  ['#0736', 'Puffer vest', 'Vest', 'Patagonia', 'M', 'Forest', 11, 44, 'anunciado', ['ebay', 'poshmark'], 'B-03', 3, null, null, null, null],
  ['#0744', 'Tweed mini skirt', 'Skirt', 'Kate Spade', '6', 'Cream', 7, 30, 'catalogado', [], 'B-12', 2, null, null, null, null],
  ['#0751', 'Graphic sweatshirt', 'Sweater', 'Urban Outfitters', 'L', 'Heather gray', 3, null, 'catalogado', [], 'B-07', 2, null, null, null, null],
  ['#0758', 'Wrap blouse', 'Top', 'Mango', 'S', 'Terracotta', 4, 18, 'catalogado', [], 'B-03', 1, null, null, null, null],
  ['#0763', 'Suede ankle boots', 'Shoes', 'Steve Madden', '8', 'Tan', 9, null, 'catalogado', [], 'B-01', 1, null, null, null, null],
  ['#0770', 'Ruffle hem maxi skirt', 'Skirt', 'Loft', 'M', 'Burgundy', 6, 28, 'catalogado', [], 'B-12', 1, null, null, null, null],
  ['#0774', 'Quilted jacket', 'Jacket', 'Lands’ End', 'L', 'Green', 8, 40, 'catalogado', [], 'B-07', 0, null, null, null, null],
  ['#0779', 'Athletic leggings', 'Pants', 'Lululemon', '6', 'Black', 5, 24, 'catalogado', [], 'B-03', 0, null, null, null, null],
  ['#0781', 'Denim mini skirt', 'Skirt', 'Abercrombie', '4', 'Indigo', 3, 16, 'catalogado', [], 'B-12', 0, null, null, null, null],
];

// A larger sample catalog, so the Home numbers read as a busy business:
// 312 pieces in stock (168 cataloged, 144 listed) and 90 sales in the current month, from a fixed seed.
const ADJECTIVES = ['Linen', 'Cotton', 'Denim', 'Wool', 'Silk', 'Knit', 'Floral', 'Striped', 'Pleated', 'Corduroy'];
const KINDS = [['Skirt', 'Skirt', 'Madewell'], ['Top', 'Top', 'Uniqlo'], ['Dress', 'Dress', 'Anthropologie'], ['Jacket', 'Jacket', 'Levi\u2019s'],
  ['Pants', 'Pants', 'Gap'], ['Sweater', 'Sweater', 'J.Crew'], ['Bag', 'Accessory', 'Coach']];
const COLORS = ['Sage', 'Navy', 'White', 'Camel', 'Black', 'Rust', 'Cream', 'Olive', 'Blue', 'Burgundy'];
function seeded(seed){ let x = seed; return () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; }; }

function generatedPieces(){
  const rnd = seeded(20261022);
  const out = [];
  for (let k = 0; k < 402; k++){
    const [clothingType, category, brand] = KINDS[Math.floor(rnd() * KINDS.length)];
    const adj = ADJECTIVES[Math.floor(rnd() * ADJECTIVES.length)];
    const inStock = k < 312;
    const cost = Math.round((4 + rnd() * 12) * 100) / 100;
    const listPrice = Math.round(18 + rnd() * 50);
    const soldPrice = Math.round(30 + rnd() * 50);
    const fees = Math.round(soldPrice * 0.2 * 100) / 100;
    const shipping = Math.round((6 + rnd() * 4) * 100) / 100;
    const platforms = inStock ? (k % 3 === 0 ? ['ebay', 'poshmark'] : [k % 2 ? 'poshmark' : 'ebay']) : [k % 2 ? 'poshmark' : 'ebay'];
    const soldDays = inStock ? null : (k - 312) % 21;
    docsGenerated.push({
      id: 'gen' + String(k + 1).padStart(3, '0'),
      productCode: '#' + String(1000 + k),
      name: `${adj} ${clothingType.toLowerCase()}`,
      clothingType, category, brand,
      size: ['XS', 'S', 'M', 'L'][k % 4], color: COLORS[Math.floor(rnd() * COLORS.length)],
      cost, listPrice: inStock ? listPrice : soldPrice, status: inStock ? (k < 144 ? 'anunciado' : 'catalogado') : 'vendido',
      listedPlatforms: platforms, storageBox: 'B-' + String(1 + (k % 12)).padStart(2, '0'), photos: [],
      hostedPhotoUrls: null, condition: 'Excellent', createdAt: Date.now() - Math.floor(rnd() * 90) * DAY,
      ...(inStock ? {} : { soldAt: Date.now() - soldDays * DAY, soldPrice, soldPlatform: platforms[0], feesTotal: fees,
        shippingCost: shipping, otherCosts: 0, netProfit: Math.round((soldPrice - fees - shipping - cost) * 100) / 100 }),
    });
  }
  return out;
}
const docsGenerated = [];
generatedPieces();

export function sampleDocs(now = Date.now()){
  const docs = [];
  PIECES.forEach(([code, name, clothingType, brand, size, color, cost, listPrice, status, platforms, box,
    createdDays, soldDays, soldPrice, fees, shipping], i) => {
    const id = 'piece' + String(i + 1).padStart(2, '0');
    const sold = status === 'vendido';
    const soldAt = sold ? now - soldDays * DAY : null;
    const netProfit = sold ? Math.round((soldPrice - fees - shipping - cost) * 100) / 100 : null;
    docs.push([`${BIZ}/items/${id}`, {
      id, productCode: code, name, clothingType, category: 'Women', brand, size, color,
      cost, listPrice, status, listedPlatforms: platforms, storageBox: box, photos: PICK_PHOTOS[code] ? [PICK_PHOTOS[code]] : [],
      hostedPhotoUrls: null, condition: 'Excellent', createdAt: now - createdDays * DAY,
      ...(sold ? { soldAt, soldPrice, soldPlatform: platforms[0], feesTotal: fees, shippingCost: shipping, otherCosts: 0, netProfit } : {}),
      ...(i === 9 ? { ebayPublishError: { message: 'Missing item specifics: Brand', at: now - DAY } } : {}),
    }]);
  });
  docsGenerated.forEach(d => docs.push([`${BIZ}/items/${d.id}`, d]));
  docs.push([`users/harness-owner`, {
    email: 'owner@example.test', status: 'approved', role: 'owner', activeBizId: 'harness', createdAt: now - 90 * DAY,
  }]);
  docs.push([`businesses/harness`, { live: true, name: 'Sample Boutique' }]);
  docs.push([`${BIZ}/config/settings`, { storeName: 'Sample Boutique', theme: 'parcel' }]);
  return docs;
}
