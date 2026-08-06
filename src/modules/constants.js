// Pure data constants used across the app — moved out of main.js's IIFE
// verbatim (no logic changes). Anything here must stay dependency-free
// (no reads of `items`/`appSettings`/DOM) so it's safe to import anywhere.

export const MAX_PHOTOS = 16;
export const MAX_PHOTO_DIM = 1600; // px, longest side after compression — matches eBay's own zoom recommendation
export const PHOTO_QUALITY = 0.85;

export const PLATFORM_FEES = {
  ebay: 0.1335,
  mercari: 0.10,
  poshmark: 0.20,
  vinted: 0.05,
  depop: 0.10,
  outra: 0.12
};

export const PLATFORM_LABEL = {
  ebay: '🛒 eBay', mercari: '📦 Mercari', poshmark: '👗 Poshmark', vinted: '♻️ Vinted', depop: '📸 Depop', outra: 'Other'
};
// Plain names (no emoji) for built-ins — used next to their real favicon
// in badges, where an emoji alongside a real logo would be redundant.
export const PLATFORM_NAME = {
  ebay: 'eBay', mercari: 'Mercari', poshmark: 'Poshmark', vinted: 'Vinted', depop: 'Depop', outra: 'Other'
};
// Official brand colors (researched, not guessed).
export const PLATFORM_COLOR = {
  ebay: '#E53238', mercari: '#5E6DF2', poshmark: '#7F0353', vinted: '#007782', depop: '#FF2300', outra: '#8A7E82'
};
// Official favicons — used instead of emoji on badges for the 5 built-in
// platforms. Deliberately NOT bundling full logo assets (trademark risk,
// especially given this may become a real product later); a favicon is a
// much lighter, lower-risk way to show a recognizable real icon. Custom
// platforms she adds herself have no favicon to fetch, so they keep the
// emoji/color-only badge style.
export const PLATFORM_FAVICON = {
  ebay: 'https://www.ebay.com/favicon.ico',
  mercari: 'https://www.mercari.com/favicon.ico',
  poshmark: 'https://poshmark.com/favicon.ico',
  vinted: 'https://www.vinted.com/favicon.ico',
  depop: 'https://www.depop.com/favicon.ico',
};

export const CONDITION_FACTOR = {
  novo_etiqueta: 1.0,
  novo_sem_etiqueta: 0.85,
  excelente: 0.70,
  bom: 0.55,
  aceitavel: 0.40,
  defeito: 0.22
};

export const CONDITION_LABEL = {
  novo_etiqueta: 'New with tags',
  novo_sem_etiqueta: 'New without tags',
  excelente: 'Excellent pre-owned condition',
  bom: 'Good pre-owned condition',
  aceitavel: 'Fair condition, priced accordingly',
  defeito: 'Sold as-is for parts or repair'
};

// Poshmark doesn't have a granular condition dropdown like eBay — sellers
// are expected to spell condition out in the description using these
// community-standard abbreviations (NWT/NWOT/EUC/VGUC/GUC).
export const LISTING_CONDITION_LABEL = {
  novo_etiqueta: 'NWT — New With Tags',
  novo_sem_etiqueta: 'NWOT — New Without Tags',
  excelente: 'EUC — Excellent Used Condition, no rips/stains/major flaws',
  bom: 'VGUC — Very Good Used Condition, minor flaws from gentle use',
  aceitavel: 'GUC — Good Used Condition, see notes for flaws',
  defeito: 'Flawed / sold as-is — see photos & notes for details'
};

// Poshmark's own fixed "Style Tags" vocabulary — she picks these by
// clicking them in Poshmark's UI while publishing (not free text), so the
// AI must only ever suggest tags that actually exist in this list.
export const POSHMARK_STYLE_TAGS = [
  '70s','80s','90s','Activewear','Animal Print','Athleisure','Avant Garde',
  'Baggy','Balletcore','Beach','Beaded','Bikercore','Blokecore','Bodycon','Bohemian','Bow','Bridal','Bridesmaid','Business Casual',
  'Cable Knit','Cashmere','Casual','Chunky','Collegiate','Colorblock','Colorful','Contemporary','Coord Sets','Coquette Girl','Corduroy','Cottagecore','Cozy','Crochet','Cropped','Cruelty-Free','Cut Out',
  'Denim','Distressed','DIY','Drop Waist',
  'Eclectic Grandpa','Embroidered',
  'Fall','Faux Fur','Feminine','Festival','Festive','Flannel','Flare','Floral','Formal','Fringe',
  'Gingham','Girlhoodcore','Gorpcore','Goth','Grunge',
  'Hand Knit','Handmade','Herringbone','Houndstooth',
  'Indie Sleeze',
  'Knit',
  'Lace','Leather','Leopard Print','Lightweight','Linen','Luxury',
  'Maximalism','Mesh','Metallic','Minimalist','Monochrome','Monogram','Moto',
  'Neon','Neutral','Nylon',
  'Office','Oversized',
  'Paisley','Party','Pastel','Patchwork','Peplum','Plaid','Platform','Pleated','Polka Dot','Preppy','Punk',
  'Quiet Luxury','Quilted',
  'Relaxed Fit','Resortwear','Retro','Rosette','Ruffle',
  'Satin','Sequins','Sheer','Sherpa','Silk','Sporty','Strapless','Streetwear','Stripes','Suede',
  'Tailored','Tennis Prep','Travel','Tropical','Tweed','Two-Tone',
  'Unisex','Upcycled','Utility',
  'Vacation','Vegan','Velour','Vintage',
  'Waterproof','Wedding','Western','Whimsigoth','Winter','Wool','Woven',
  'Y2K',
];

export const PREP_LABEL = {
  needs_wash: 'Needs wash', needs_repair: 'Needs repair', needs_photo: 'Needs photos', ready: 'Ready to list'
};

export const BASE_CATEGORY_VALUE = {
  'Clothing': 28, 'Shoes': 35, 'Accessories': 22, 'Electronics': 60,
  'Home & Decor': 25, 'Collectibles': 40, 'Toys': 18, 'Books': 12, 'Other': 20
};

// Category is a dropdown of presets + "Add new…", same model as Color and
// Clothing Type: picking "Add new…" reveals a text field, and whatever she
// types there gets injected as a real dropdown option (above "Add new…")
// the next time she opens the form, so she only ever types a given custom
// category once.
export const PRESET_CATEGORIES = Object.keys(BASE_CATEGORY_VALUE);

export const PRESET_COLORS = ['Black','White','Gray','Beige/Tan','Brown','Red','Pink','Orange','Yellow','Green','Blue','Purple','Gold','Silver','Multi-Color'];

export const PRESET_CLOTHING_TYPES = ['T-Shirt','Tank Top','Blouse','Sweater','Hoodie','Jeans','Pants','Shorts','Skirt','Dress','Jacket/Coat','Blazer','Activewear','Swimwear','Shoes','Bag','Accessory'];

// Standard size run for each clothing type, so the suggestion list isn't
// empty the very first time a type is used. Covers adult women's sizing
// (the primary inventory today) — tell Vitor if men's/kids' ranges are
// needed too and this table can grow per-gender.
export const PRESET_SIZES_BY_TYPE = {
  'T-Shirt':      ['XS','S','M','L','XL','XXL'],
  'Tank Top':     ['XS','S','M','L','XL','XXL'],
  'Blouse':       ['XS','S','M','L','XL','XXL'],
  'Sweater':      ['XS','S','M','L','XL','XXL'],
  'Hoodie':       ['XS','S','M','L','XL','XXL'],
  'Blazer':       ['XS','S','M','L','XL','XXL'],
  'Jacket/Coat':  ['XS','S','M','L','XL','XXL'],
  'Activewear':   ['XS','S','M','L','XL','XXL'],
  'Swimwear':     ['XS','S','M','L','XL','XXL'],
  'Jeans':        ['0','2','4','6','8','10','12','14','16','18','20'],
  'Pants':        ['0','2','4','6','8','10','12','14','16','18','20'],
  'Shorts':       ['0','2','4','6','8','10','12','14','16','18','20'],
  'Skirt':        ['0','2','4','6','8','10','12','14','16','18','20'],
  'Dress':        ['0','2','4','6','8','10','12','14','16','18','20'],
  'Shoes':        ['5','5.5','6','6.5','7','7.5','8','8.5','9','9.5','10','10.5','11'],
  'Bag':          ['One Size'],
  'Accessory':    ['One Size'],
};

export const DAILY_QUOTES = [
  "Somebody's closet clutter is somebody else's perfect find.",
  "Every tag you write is a tiny act of treasure hunting, in reverse.",
  "Today's pile is tomorrow's paycheck. One photo at a time.",
  "Thrifted doesn't mean tired — it means it found you twice.",
  "A good sorter sees inventory. A great one sees stories waiting to ship.",
  "Slow and steady fills the shelf. Today, just do one.",
  "The best closet is the one that turns over.",
  "Chaos, weighed and measured, is just a system in disguise.",
  "Nobody buys what they can't see. Light wins more than luck.",
  "Small stack today, smaller stack tomorrow.",
  "You're not behind. You're mid-sort.",
  "Every label you print is a little promise kept.",
  "Good bones sell themselves. Good photos help them along.",
  "A folded shirt and a fair price — that's the whole business.",
  "Patience smells like cedar and looks like a full rack.",
  "What didn't sell yesterday just needs a better light today.",
  "Cataloging is just love letters to your future buyer.",
  "The hanger remembers. So should the spreadsheet.",
  "One box at a time turns clutter into cash flow.",
  "You don't need to finish today. You need to start.",
  "Worn once, loved twice — that's the resale promise.",
  "Every measurement you log saves a future return.",
  "Steady hands, fair prices, happy closets.",
  "The pile shrinks the moment you stop staring at it.",
  "A great listing is just honesty with good lighting.",
  "Today's task: turn one maybe into one done.",
  "Stock doesn't sort itself, but it does reward whoever starts.",
  "Some days you list ten. Some days you list one. Both count.",
  "The tag says condition. The photo says character.",
  "Good inventory hygiene is just kindness to your future self."
];
