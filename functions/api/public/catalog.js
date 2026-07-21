import { json, safeErrorResponse } from '../../_lib/http.js';

const EDGE_CACHE_SECONDS = 30;
const CATALOG_CACHE_VERSION = '20260721-1';

function cacheRequest(request) {
  const url = new URL(request.url);
  url.pathname = '/api/public/catalog';
  url.search = `?catalog=${CATALOG_CACHE_VERSION}`;
  return new Request(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' }
  });
}

export async function onRequestGet(context) {
  const startedAt = Date.now();
  try {
    const cache = globalThis.caches?.default;
    const key = cache ? cacheRequest(context.request) : null;

    if (cache && key) {
      const cached = await cache.match(key);
      if (cached) {
        const hit = new Response(cached.body, cached);
        hit.headers.set('X-Regal-Catalog-Cache', 'HIT');
        return hit;
      }
    }

    const databaseStartedAt = Date.now();
    const result = await context.env.DB.prepare(
      `SELECT id, sku, name, category, style, description, price_unit,
              quantity_owned, price_cents, sort_order
       FROM products
       WHERE active = 1
       ORDER BY category, sort_order, name`
    ).all();
    const databaseDuration = Date.now() - databaseStartedAt;

    const response = json({
      ok: true,
      products: (result.results || []).map((product) => ({
        id: product.id,
        sku: product.sku,
        name: product.name,
        category: product.category,
        style: product.style,
        description: product.description,
        priceUnit: product.price_unit,
        quantityOwned: Number(product.quantity_owned),
        priceCents: product.price_cents == null ? null : Number(product.price_cents),
        sortOrder: Number(product.sort_order || 100)
      }))
    }, 200, {
      'Cache-Control': `public, max-age=0, s-maxage=${EDGE_CACHE_SECONDS}, stale-while-revalidate=300`,
      'CDN-Cache-Control': `max-age=${EDGE_CACHE_SECONDS}, stale-while-revalidate=300`,
      'X-Regal-Catalog-Cache': cache ? 'MISS' : 'BYPASS',
      'Server-Timing': `d1;dur=${databaseDuration}, total;dur=${Date.now() - startedAt}`
    });

    if (cache && key) context.waitUntil(cache.put(key, response.clone()));
    return response;
  } catch (error) {
    return safeErrorResponse(error);
  }
}
