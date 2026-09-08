import { json, cleanText } from './http.js';

export async function readCatalogImage(request) {
  const max = 4 * 1024 * 1024;
  if (Number(request.headers.get('content-length')) > max) throw new Error('IMAGE_TOO_LARGE');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('INVALID_IMAGE');
  const chunks = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); throw new Error('IMAGE_TOO_LARGE'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const starts = prefix => prefix.every((value, index) => bytes[index] === value);
  const ascii = (a, b) => new TextDecoder().decode(bytes.slice(a, b));
  const type = starts([0xff, 0xd8, 0xff]) ? 'image/jpeg'
    : starts([137, 80, 78, 71, 13, 10, 26, 10]) ? 'image/png'
      : ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP' ? 'image/webp' : null;
  if (!type || size < 16) throw new Error('INVALID_IMAGE');
  return { bytes, type, extension: type.split('/')[1] };
}

export const catalogImageUrl = product => product.image_key
  ? `/api/public/product-images/${encodeURIComponent(product.id)}?v=${encodeURIComponent(product.image_key.split('/').pop())}` : null;

export async function catalogImageResponse(context, privateView = false) {
  const id = cleanText(context.params.id, 80);
  const product = await context.env.DB.prepare(`SELECT id, image_key FROM products WHERE id = ?1 ${privateView ? '' : 'AND active = 1'}`).bind(id).first();
  if (!product?.image_key || !/^[a-zA-Z0-9_-]+$/.test(id) || !product.image_key.startsWith(`catalog/${id}/`) || !context.env.BOOKING_FILES) {
    return json({ ok: false, error: { message: 'Photo not found.' } }, 404);
  }
  const object = await context.env.BOOKING_FILES.get(product.image_key);
  const type = object?.httpMetadata?.contentType;
  if (!object || !['image/jpeg', 'image/png', 'image/webp'].includes(type)) return new Response(null, { status: 404 });
  return new Response(object.body, { headers: {
    'Content-Type': type, 'X-Content-Type-Options': 'nosniff',
    'Cache-Control': privateView ? 'no-store' : 'public, max-age=60',
    'Content-Security-Policy': "default-src 'none'; sandbox"
  } });
}
