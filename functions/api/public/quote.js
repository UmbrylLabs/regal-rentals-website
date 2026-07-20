import { createBooking } from '../../_lib/booking.js';
import { assertSameOrigin, json, readJson, safeErrorResponse } from '../../_lib/http.js';

export async function onRequestPost(context) {
  try {
    assertSameOrigin(context.request);
    const body = await readJson(context.request);
    body.status = 'inquiry';
    const result = await createBooking(context.env, context.request, body, null);
    return json({
      ok: true,
      duplicate: result.duplicate,
      booking: result.booking,
      message: 'Your request was received. Regal Rentals will confirm availability and final pricing.'
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
    return safeErrorResponse(error);
  }
}
