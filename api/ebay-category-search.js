// /api/ebay-category-search.js — free-text eBay category search
// Proxies eBay's Taxonomy API (get_category_suggestions) so the app can offer
// a live "find the right category" search for ANY product type (books,
// antiques, appliances, clothing, etc). This replaces guessing at category
// IDs with a real lookup against eBay's actual category tree.
//
// POST body: { access_token, query }
// Returns: { success, suggestions: [{ id, name, path }] }

const EBAY_SANDBOX = process.env.EBAY_SANDBOX === 'true';
const API_BASE = EBAY_SANDBOX
  ? 'https://api.sandbox.ebay.com'
  : 'https://api.ebay.com';
const CATEGORY_TREE_ID = '0'; // eBay's default/shared tree ID for EBAY_US

export default async (req, res) => {
  if (req.method !== 'POST'){
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try{
    const { access_token, query } = req.body || {};
    if (!access_token) return res.status(400).json({ error: 'Missing access_token' });
    const q = (query || '').trim();
    if (!q) return res.status(400).json({ error: 'Missing query' });

    const url = `${API_BASE}/commerce/taxonomy/v1/category_tree/${CATEGORY_TREE_ID}/get_category_suggestions?q=${encodeURIComponent(q)}`;
    const r = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
      }
    });
    const text = await r.text();
    let data;
    try{ data = JSON.parse(text); }catch(e){ data = { raw: text }; }

    if (!r.ok){
      return res.status(r.status).json({ error: 'eBay category search failed', detail: data });
    }

    const suggestions = (data.categorySuggestions || []).map(s => {
      // Ancestors come ordered leaf-to-root; reverse to build a readable
      // root -> leaf path (e.g. "Clothing, Shoes & Accessories > Women > Skirts").
      const ancestors = (s.categoryTreeNodeAncestors || [])
        .map(a => a.categoryName)
        .filter(Boolean)
        .reverse();
      const leafName = s.category?.categoryName || '';
      const path = [...ancestors, leafName].filter(Boolean).join(' > ');
      return {
        id: s.category?.categoryId || null,
        name: leafName,
        path,
      };
    }).filter(s => s.id);

    return res.status(200).json({ success: true, suggestions });
  }catch(e){
    console.error('Category search error:', e);
    return res.status(500).json({ error: 'Category search failed', detail: String(e) });
  }
};
