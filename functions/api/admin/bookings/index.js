import { createBooking } from '../../../_lib/booking.js';
import { protectMutation, requireAdmin } from '../../../_lib/auth.js';
import { json, readJson, safeErrorResponse } from '../../../_lib/http.js';
import { DEFAULT_HOLD_SECONDS } from '../../../_lib/inventory-policy.js';

export async function onRequestGet(context) {
  try {
    await requireAdmin(context.env, context.request);

    // Availability already ignores elapsed holds. Keep the admin status in sync when the dashboard loads.
    await context.env.DB.prepare(
      `UPDATE bookings
       SET status = 'expired', updated_at = unixepoch()
       WHERE status = 'hold'
         AND hold_expires_at IS NOT NULL
         AND hold_expires_at <= unixepoch()`
    ).run();

    const url = new URL(context.request.url);
    const status = String(url.searchParams.get('status') || '').trim();
    const boundedInt = (value, fallback, max) => /^\d+$/.test(value || '') ? Math.min(max, Number(value)) : fallback;
    const limit = Math.max(1, boundedInt(url.searchParams.get('limit'), 50, 100));
    const offset = boundedInt(url.searchParams.get('offset'), 0, 1000000);
    const group = url.searchParams.get('group') || 'all';
    const query = (url.searchParams.get('q') || '').trim().slice(0, 200);
    const params = [];
    const conditions = [];
    if (status) {
      conditions.push('b.status = ?1');
      params.push(status);
    }
    const groups = { active: "b.status NOT IN ('completed','cancelled','expired')",
      completed: "b.status = 'completed'", cancelled: "b.status IN ('cancelled','expired')" };
    if (groups[group]) conditions.push(groups[group]);
    if (query) {
      params.push('%' + query.replace(/[\\%_]/g, '\\$&') + '%');
      const p = '?' + params.length;
      conditions.push(`(b.booking_number LIKE ${p} ESCAPE '\\' OR c.name LIKE ${p} ESCAPE '\\'
        OR c.email LIKE ${p} ESCAPE '\\' OR c.phone LIKE ${p} ESCAPE '\\' OR b.event_city LIKE ${p} ESCAPE '\\')`);
    }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const result = await context.env.DB.prepare(
      `SELECT
         b.id, b.booking_number, b.status, b.event_start_at, b.event_end_at,
         b.block_start_at, b.block_end_at, b.hold_expires_at, b.service_type,
         b.event_city, b.subtotal_cents, b.tax_cents, b.created_at, b.updated_at,
         c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone,
         COALESCE(SUM(bi.quantity), 0) AS total_units
       FROM bookings b
       JOIN customers c ON c.id = b.customer_id
       LEFT JOIN booking_items bi ON bi.booking_id = b.id
       ${where}
       GROUP BY b.id
       ORDER BY ${group === 'active' ? "CASE WHEN b.status = 'out' AND b.event_end_at < unixepoch() THEN 0 ELSE 1 END, b.event_start_at ASC" : 'b.event_start_at DESC'}, b.id
       LIMIT ${limit} OFFSET ${offset}`
    ).bind(...params).all();
    const [total, counts, upcoming, attention] = await Promise.all([
      context.env.DB.prepare(`SELECT COUNT(*) AS total FROM bookings b JOIN customers c ON c.id=b.customer_id ${where}`).bind(...params).first(),
      context.env.DB.prepare(`SELECT COUNT(*) AS all_count,
        COALESCE(SUM(status NOT IN ('completed','cancelled','expired')),0) AS active,
        COALESCE(SUM(status='completed'),0) AS completed,
        COALESCE(SUM(status IN ('cancelled','expired')),0) AS cancelled,
        COALESCE(SUM(status IN ('hold','confirmed','paid','ready','out','returned')),0) AS reservations,
        COALESCE(SUM(status='inquiry'),0) AS inquiries,
        COALESCE(SUM(status='out'),0) AS on_rent,
        COALESCE(SUM(event_end_at >= unixepoch() AND status NOT IN ('completed','cancelled','expired')),0) AS upcoming
        FROM bookings`).first(),
      context.env.DB.prepare(`SELECT b.id,b.booking_number,b.event_start_at,b.event_city,c.name AS customer_name
        FROM bookings b JOIN customers c ON c.id=b.customer_id
        WHERE b.event_end_at >= unixepoch() AND b.status NOT IN ('completed','cancelled','expired')
        ORDER BY b.event_start_at,b.id LIMIT 8`).all(),
      context.env.DB.prepare(`SELECT b.id,b.booking_number,b.status,b.event_end_at,c.name AS customer_name,
        CASE WHEN EXISTS (SELECT 1 FROM payment_attempts WHERE booking_id=b.id AND status IN ('processing','unknown'))
          THEN 'Payment needs confirmation'
          WHEN b.status='out' THEN 'Overdue return' ELSE 'Return inspection needed' END AS reason
        FROM bookings b JOIN customers c ON c.id=b.customer_id
        WHERE (b.status='out' AND b.event_end_at < unixepoch()) OR b.status='returned'
          OR EXISTS (SELECT 1 FROM payment_attempts WHERE booking_id=b.id AND status IN ('processing','unknown'))
        ORDER BY b.event_end_at,b.id LIMIT 30`).all()
    ]);
    return json({ ok: true, bookings: result.results || [], total: total.total, limit, offset,
      counts: { ...counts, all: counts.all_count }, upcoming: upcoming.results || [], attention: attention.results || [] });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function onRequestPost(context) {
  try {
    protectMutation(context.request);
    const user = await requireAdmin(context.env, context.request);
    const body = await readJson(context.request);
    if (String(body.status || '').toLowerCase() === 'hold') {
      body.holdExpiresAt = Math.floor(Date.now() / 1000) + DEFAULT_HOLD_SECONDS;
    }
    const result = await createBooking(context.env, context.request, body, user.id);
    return json({ ok: true, duplicate: result.duplicate, booking: result.booking }, 201);
  } catch (error) {
    const code = String(error?.message || '');
    if (code.includes('INVENTORY_CONFLICT')) {
      return json({
        ok: false,
        error: {
          code: 'INVENTORY_CONFLICT',
          message: 'That inventory is no longer available for the selected date and time.'
        }
      }, 409);
    }
    return safeErrorResponse(error);
  }
}
