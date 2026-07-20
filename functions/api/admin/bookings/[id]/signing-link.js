import { bookingDetail, createSigningRequest } from '../../../../_lib/booking.js';
import { protectMutation, requireAdmin } from '../../../../_lib/auth.js';
import { json, readJson, safeErrorResponse } from '../../../../_lib/http.js';

export async function onRequestPost(context) {
  try {
    protectMutation(context.request);
    const user = await requireAdmin(context.env, context.request);
    const booking = await bookingDetail(context.env.DB, context.params.id);
    if (!booking) {
      return json({ ok: false, error: { code: 'NOT_FOUND', message: 'Booking not found.' } }, 404);
    }
    const body = await readJson(context.request);
    const origin = new URL(context.request.url).origin;
    const request = await createSigningRequest(context.env, booking, user, { ...body, origin });
    return json({ ok: true, signingRequest: request }, 201);
  } catch (error) {
    return safeErrorResponse(error);
  }
}
