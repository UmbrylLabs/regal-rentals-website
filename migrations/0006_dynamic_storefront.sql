-- All existing bookings, inventory and payment tables are preserved.
CREATE TABLE IF NOT EXISTS storefront_product_media (
  product_id TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS storefront_packages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  items_json TEXT NOT NULL DEFAULT '[]',
  price_cents INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 100,
  active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_storefront_packages_public ON storefront_packages(active,sort_order);
