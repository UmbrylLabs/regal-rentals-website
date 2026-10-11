// D1 stores standardized, small WebP thumbnails; this uses the existing DB binding.
// Product-photo uploads are limited to a single 1200x900 compressed image per item.
export const PHOTO_MAX_BYTES = 450000;
export const PHOTO_WIDTH = 1200;
export const PHOTO_HEIGHT = 900;

export function photoUrl(id,version) {
  return '/api/public/product-photo?id='+encodeURIComponent(id)+'&v='+encodeURIComponent(String(version));
}
export function isWebpImage(bytes) {
  return bytes.length >= 20 &&
    String.fromCharCode(...bytes.slice(0,4))==='RIFF' &&
    String.fromCharCode(...bytes.slice(8,12))==='WEBP' &&
    ['VP8 ','VP8L','VP8X'].includes(String.fromCharCode(...bytes.slice(12,16)));
}
export async function ensureProductPhotoTable(db) {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS storefront_product_photos ("+
    "product_id TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,"+
    "image_data BLOB NOT NULL, image_bytes INTEGER NOT NULL,"+
    "updated_at INTEGER NOT NULL DEFAULT (unixepoch()))"
  ).run();
}
export function normalizePhotoId(id) {
  const str=typeof id==='string'?id:'';
  return /^[a-z0-9][a-z0-9_-]{3,100}$/i.test(str)?str:null;
}
