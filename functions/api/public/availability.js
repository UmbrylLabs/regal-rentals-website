import { getAvailability, validateEpochWindow } from '../../_lib/booking.js';
import { json, safeErrorResponse } from '../../_lib/http.js';
import {
  DEFAULT_BUFFER_AFTER_MINUTES,
  DEFAULT_BUFFER_BEFORE_MINUTES,
  inventoryBlockWindow,
  publicInventoryPolicy
} from '../../_lib/inventory-policy.js';

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const hasEventWindow = url.searchParams.has('eventStartAt') || url.searchParams.has('eventEndAt');
    let window;

    if (hasEventWindow) {
      const { start, end } = validateEpochWindow(
        Number(url.searchParams.get('eventStartAt')),
        Number(url.searchParams.get('eventEndAt'))
      );
      window = inventoryBlockWindow(
        start,
        end,
        url.searchParams.has('bufferBeforeMinutes')
          ? Number(url.searchParams.get('bufferBeforeMinutes'))
          : DEFAULT_BUFFER_BEFORE_MINUTES,
        url.searchParams.has('bufferAfterMinutes')
          ? Number(url.searchParams.get('bufferAfterMinutes'))
          : DEFAULT_BUFFER_AFTER_MINUTES
      );
    } else {
      // Retain the original block-window parameters for older admin clients.
      const blockStartAt = Number(url.searchParams.get('startAt'));
      const blockEndAt = Number(url.searchParams.get('endAt'));
      window = {
        eventStartAt: null,
        eventEndAt: null,
        blockStartAt,
        blockEndAt,
        bufferBeforeMinutes: null,
        bufferAfterMinutes: null
      };
    }

    const products = await getAvailability(context.env.DB, window.blockStartAt, window.blockEndAt);
    return json({
      ok: true,
      checkedAt: Math.floor(Date.now() / 1000),
      startAt: window.blockStartAt,
      endAt: window.blockEndAt,
      window,
      policy: publicInventoryPolicy(),
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
    if (['INVALID_TIME_WINDOW', 'EVENT_IN_PAST', 'EVENT_WINDOW_TOO_LONG', 'INVALID_BUFFER'].includes(code)) {
      return json({ ok: false, error: { code, message: 'Choose a valid future event window.' } }, 400);
    }
    return safeErrorResponse(error);
  }
}
