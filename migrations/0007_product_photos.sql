-- Standardized product photo uploads (1200x900 WebP) stored within existing D1.
-- One optimized photo per inventory item; records cascade on permitted hard deletion.
CREATE TABLE IF NOT EXISTS storefront_product_photos (
  product_id TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  image_data BLOB NOT NULL,
  image_bytes INTEGER NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
