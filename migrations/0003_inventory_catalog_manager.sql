ALTER TABLE products ADD COLUMN style TEXT NOT NULL DEFAULT 'other';
ALTER TABLE products ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN price_unit TEXT NOT NULL DEFAULT 'each';
ALTER TABLE products ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 100;

UPDATE products
SET style = 'round-table',
    description = 'A banquet-size round table that typically seats eight guests comfortably.',
    price_unit = 'per table',
    sort_order = 10
WHERE id = 'round-table-60';

UPDATE products
SET style = 'rectangle-table',
    description = 'A versatile commercial folding table for dining, gifts, food service, or event displays.',
    price_unit = 'per table',
    sort_order = 20
WHERE id = 'rectangle-table-6';

UPDATE products
SET style = 'canopy',
    description = 'Compact shade coverage for backyard parties, vendor areas, food stations, and small events.',
    price_unit = 'per canopy',
    sort_order = 30
WHERE id = 'canopy-10x10';

CREATE INDEX IF NOT EXISTS idx_products_catalog
ON products(active, category, sort_order, name);
