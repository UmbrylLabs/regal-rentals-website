import { createBooking } from '../../../_lib/booking.js';
import { protectMutation, requireAdmin } from '../../../_lib/auth.js';
import { json, readJson, safeErrorResponse } from '../../../_lib/http.js';

export async function onRequestGet(context) {
  try {
    await requireAdmin(context.env, context.request);
    const url = new URL(context.request.url);
    const status = String(url.searchParams.get('status') || '').trim();
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 100)));
    const params = [];
    let where = '';
    if (status) {
      where = 'WHERE b.status = ?1';
      params.push(status);
    }

    const result = await context.env.DB.prepare(
      `SELECT
         b.id, b.booking_number, b.status, b.event_start_at, b.event_end_at,
         b.block_start_at, b.block_end_at, b.hold_expires_at, b.service_type,
         b.event_city, b.subtotal_cents, b.created_at, b.updated_at,
         c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone,
         COALESCE(SUM(bi.quantity), 0) AS total_units
       FROM bookings b
       JOIN customers c ON c.id = b.customer_id
       LEFT JOIN booking_items bi ON bi.booking_id = b.id
       ${where}
       GROUP BY b.id
       ORDER BY b.event_start_at ASC
       LIMIT ${limit}`
    ).bind(...params).all();

    return json({ ok: true, bookings: result.results || [] });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function onRequestPost(context) {
  try {
    protectMutation(context.request);
    const user = await requireAdmin(context.env, context.request);
    const body = await readJson(context.request);
    const result = await createBooking(context.env, context.request, body, user.id);
    return json({ ok: true, duplicate: result.duplicate, booking: result.booking }, 201);
  } catch (error) {
    return safeErrorResponse(error);
  }
}
