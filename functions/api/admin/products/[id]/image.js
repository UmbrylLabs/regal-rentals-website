import { protectMutation, requireAdmin } from '../../../../_lib/auth.js';
import { cleanText, json, randomId, safeErrorResponse } from '../../../../_lib/http.js';
import { readCatalogImage, catalogImageResponse } from '../../../../_lib/catalog-images.js';

export async function onRequestGet(context) {
  try { await requireAdmin(context.env, context.request); return await catalogImageResponse(context, true); }
  catch (error) { return safeErrorResponse(error); }
}

async function mutate(context, remove) {
  let newKey;
  try {
    protectMutation(context.request);
    const user = await requireAdmin(context.env, context.request);
    const product = await context.env.DB.prepare('SELECT id, image_key FROM products WHERE id = ?1').bind(context.params.id).first();
    if (!product || !/^[a-zA-Z0-9_-]+$/.test(product.id)) return json({ ok: false, error: { message: 'Product not found.' } }, 404);
    const bucket = context.env.BOOKING_FILES;
    if (!bucket) return json({ ok: false, error: { message: 'Photo storage needs to be connected.' } }, 503);
    let alt = '';
    if (!remove) {
      const image = await readCatalogImage(context.request);
      alt = cleanText(new URL(context.request.url).searchParams.get('alt'), 300);
      newKey = `catalog/${product.id}/${randomId()}.${image.extension}`;
      await bucket.put(newKey, image.bytes, { httpMetadata: { contentType: image.type } });
    }
    // Keep old objects for recovery. The DB pointer is the only public route to a photo.
    await context.env.DB.batch([
      context.env.DB.prepare('UPDATE products SET image_key = ?1, image_alt = ?2, updated_at = unixepoch() WHERE id = ?3').bind(newKey || null, alt, product.id),
      context.env.DB.prepare(`INSERT INTO audit_log (id, actor_user_id, action, entity_type, entity_id, metadata_json)
        VALUES (?1, ?2, ?3, 'product', ?4, ?5)`).bind(randomId(), user.id, remove ? 'product.photo.remove' : 'product.photo.upload', product.id, JSON.stringify({ previousKey: product.image_key, imageKey: newKey || null }))
    ]);
    return json({ ok: true });
  } catch (error) {
    // A database timeout can have an unknown commit result; retain the uploaded
    // object so a committed catalog pointer never points to a deleted photo.
    return safeErrorResponse(error);
  }
}
export const onRequestPost = context => mutate(context, false);
export const onRequestDelete = context => mutate(context, true);
