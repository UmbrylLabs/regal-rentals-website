import { getAvailability } from '../../_lib/booking.js';
import { json, safeErrorResponse } from '../../_lib/http.js';

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const startAt = Number(url.searchParams.get('startAt'));
    const endAt = Number(url.searchParams.get('endAt'));
    const products = await getAvailability(context.env.DB, startAt, endAt);
    return json({
      ok: true,
      checkedAt: Math.floor(Date.now() / 1000),
      startAt,
      endAt,
      products: products.map((product) => ({
        id: product.id,
        sku: product.sku,
        name: product.name,
        category: product.category,
        style: product.style,
        description: product.description,
        priceUnit: product.price_unit,
        sortOrder: Number(product.sort_order || 100),
        quantityOwned: Number(product.quantity_owned),
        quantityAvailable: Number(product.quantity_available),
        priceCents: product.price_cents == null ? null : Number(product.price_cents)
      }))
    });
  } catch (error) {
    const code = String(error?.message || '');
    if (['INVALID_TIME_WINDOW', 'EVENT_IN_PAST', 'EVENT_WINDOW_TOO_LONG'].includes(code)) {
      return json({ ok: false, error: { code, message: 'Choose a valid future event window.' } }, 400);
    }
    return safeErrorResponse(error);
  }
}
