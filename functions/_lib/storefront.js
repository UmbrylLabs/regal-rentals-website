// Storefront data lives beside the existing inventory/booking schema.
// Tables are created on demand for installations where migrations haven't run.
export async function ensureStorefrontTables(db) {
  await db.prepare("CREATE TABLE IF NOT EXISTS storefront_product_media ("+
    "product_id TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,"+
    "image_url TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL DEFAULT (unixepoch()))").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS storefront_packages ("+
    "id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',"+
    "image_url TEXT NOT NULL DEFAULT '', items_json TEXT NOT NULL DEFAULT '[]',"+
    "price_cents INTEGER, sort_order INTEGER NOT NULL DEFAULT 100,"+
    "active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),"+
    "created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()))").run();
}

export function validImageUrl(value) {
  if (value === '' || value == null) return '';
  if (typeof value !== 'string' || value.length > 900) throw new Error('INVALID_IMAGE');
  const str = value.trim();
  if (/^\/assets\/[a-zA-Z0-9/_-]+\.(?:png|jpe?g|webp|svg)$/i.test(str)) return str;
  try {
    const url = new URL(str);
    if (url.protocol === 'https:' && url.username === '' && url.password === '' &&
        !url.hostname.endsWith('.local') && !url.hostname.endsWith('.internal')) return url.href;
  } catch {}
  throw new Error('INVALID_IMAGE');
}

export async function availableProducts(db) {
  const rows = await db.prepare(
    "SELECT p.id,p.name,p.description,p.category,p.style,p.price_cents,p.quantity_owned,p.price_unit,p.sort_order,"+
    "COALESCE(m.image_url,'') AS image_url FROM products p LEFT JOIN storefront_product_media m ON m.product_id=p.id "+
    "WHERE p.active=1 ORDER BY p.sort_order,p.name"
  ).all();
  return (rows.results || []).map(p=>({
    id:p.id, name:p.name, description:p.description || '',category:p.category,
    style:p.style, priceCents:p.price_cents === null ? null:Number(p.price_cents),
    quantityOwned:Number(p.quantity_owned),priceUnit:p.price_unit,sortOrder:Number(p.sort_order),
    imageUrl:p.image_url || ''
  }));
}

export async function availablePackages(db) {
  const rows = await db.prepare(
    "SELECT id,name,description,image_url,items_json,price_cents,sort_order,active "+
    "FROM storefront_packages ORDER BY sort_order,name"
  ).all();
  return (rows.results || []).map(row=>({...row,
    priceCents:row.price_cents===null?null:Number(row.price_cents),
    sortOrder:Number(row.sort_order),active:Number(row.active),
    imageUrl:row.image_url || '',
    items:JSON.parse(row.items_json || '[]')
  }));
}
