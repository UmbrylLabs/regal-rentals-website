import { createBooking } from '../../_lib/booking.js';
import { assertSameOrigin, json, readJson, safeErrorResponse } from '../../_lib/http.js';

const HOLD_SECONDS = 24 * 60 * 60;
const BUFFER_BEFORE_MINUTES = 4 * 60;
const BUFFER_AFTER_MINUTES = 12 * 60;

export async function onRequestPost(context) {
  try {
    assertSameOrigin(context.request);
    const body = await readJson(context.request);
    const now = Math.floor(Date.now() / 1000);

    // A submitted request immediately reserves the requested inventory while it is reviewed.
    body.status = 'hold';
    body.holdExpiresAt = now + HOLD_SECONDS;
    body.bufferBeforeMinutes = BUFFER_BEFORE_MINUTES;
    body.bufferAfterMinutes = BUFFER_AFTER_MINUTES;

    const result = await createBooking(context.env, context.request, body, null);
    return json({
      ok: true,
      duplicate: result.duplicate,
      booking: result.booking,
      message: 'Your items are temporarily held for 24 hours while Regal Rentals reviews the request.'
    }, result.duplicate ? 200 : 201);
  } catch (error) {
    const code = String(error?.message || '');
    const validationCodes = new Set([
      'INVALID_TIME_WINDOW', 'EVENT_IN_PAST', 'EVENT_WINDOW_TOO_LONG',
      'INVALID_ITEMS', 'INVALID_CUSTOMER_NAME', 'INVALID_CUSTOMER_EMAIL',
      'INVALID_CUSTOMER_PHONE', 'INVALID_SERVICE_TYPE', 'INVALID_EVENT_CITY',
      'INVALID_BUFFER', 'PRODUCT_UNAVAILABLE'
    ]);
    if (validationCodes.has(code)) {
      return json({ ok: false, error: { code, message: 'Please review the event and contact information.' } }, 400);
    }
    if (code.includes('INVENTORY_CONFLICT')) {
      return json({
        ok: false,
        error: {
          code: 'INVENTORY_CONFLICT',
          message: 'Availability changed while you were submitting. Please check the date again and adjust the requested quantity.'
        }
      }, 409);
    }
    return safeErrorResponse(error);
  }
}
