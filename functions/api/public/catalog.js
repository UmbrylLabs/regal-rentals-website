import { json, safeErrorResponse } from '../../_lib/http.js';

export async function onRequestGet(context) {
  try {
    const result = await context.env.DB.prepare(
      `SELECT id, sku, name, category, style, description, price_unit,
              quantity_owned, price_cents, sort_order
       FROM products
       WHERE active = 1
       ORDER BY category, sort_order, name`
    ).all();

    return json({
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
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0'
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
