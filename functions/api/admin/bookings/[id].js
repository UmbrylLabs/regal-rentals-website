import {
  bookingDetail,
  loadProducts,
  normalizeItems,
  normalizeStatus,
  validateEpochWindow
} from '../../../_lib/booking.js';
import { protectMutation, requireAdmin } from '../../../_lib/auth.js';
import { cleanText, json, randomId, readJson, safeErrorResponse } from '../../../_lib/http.js';
import { DEFAULT_HOLD_SECONDS, inventoryBlockWindow } from '../../../_lib/inventory-policy.js';
import { normalizeCharges, invoiceAmounts } from '../../../_lib/invoice.js';
import { bookingPaymentStatusStatement } from '../../../_lib/payments.js';

export async function onRequestGet(context) {
  try {
    await requireAdmin(context.env, context.request);
    const booking = await bookingDetail(context.env.DB, context.params.id);
    if (!booking) {
      return json({ ok: false, error: { code: 'NOT_FOUND', message: 'Booking not found.' } }, 404);
    }
    return json({ ok: true, booking });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function onRequestPatch(context) {
  try {
    protectMutation(context.request);
    const user = await requireAdmin(context.env, context.request);
    const existing = await bookingDetail(context.env.DB, context.params.id);
    if (!existing) {
      return json({ ok: false, error: { code: 'NOT_FOUND', message: 'Booking not found.' } }, 404);
    }

    const body = await readJson(context.request);
    const status = normalizeStatus(body.status ?? existing.status);
    const datesChanged = Number(body.eventStartAt ?? existing.event_start_at) !== Number(existing.event_start_at)
      || Number(body.eventEndAt ?? existing.event_end_at) !== Number(existing.event_end_at);
    const { start: eventStart, end: eventEnd } = validateEpochWindow(
      body.eventStartAt ?? existing.event_start_at,
      body.eventEndAt ?? existing.event_end_at,
      { allowPast: !datesChanged && (status === existing.status || !['inquiry', 'quote', 'hold', 'confirmed'].includes(status)) }
    );
    let blockWindow;
    try {
      blockWindow = inventoryBlockWindow(
        eventStart,
        eventEnd,
        body.bufferBeforeMinutes ?? Math.round((existing.event_start_at - existing.block_start_at) / 60),
        body.bufferAfterMinutes ?? Math.round((existing.block_end_at - existing.event_end_at) / 60)
      );
    } catch (error) {
      if (String(error?.message || '') !== 'INVALID_BUFFER') throw error;
      return json({ ok: false, error: { code: 'INVALID_BUFFER', message: 'Enter a valid inventory buffer.' } }, 400);
    }
    const { blockStartAt: blockStart, blockEndAt: blockEnd } = blockWindow;
    const now = Math.floor(Date.now() / 1000);
    const requestedHoldExpiry = Number(body.holdExpiresAt ?? existing.hold_expires_at ?? (now + DEFAULT_HOLD_SECONDS));
    const holdExpiresAt = status === 'hold'
      ? (existing.status === 'hold' && body.holdExpiresAt == null
        ? existing.hold_expires_at : Math.max(requestedHoldExpiry, now + DEFAULT_HOLD_SECONDS))
      : null;

    const items = body.items ? normalizeItems(body.items) : existing.items.map((item) => ({
      productId: item.product_id,
      quantity: Number(item.quantity)
    }));
    const normalizedExistingItems = existing.items
      .map((item) => ({ productId: item.product_id, quantity: Number(item.quantity) }))
      .sort((left, right) => left.productId.localeCompare(right.productId));
    const normalizedRequestedItems = [...items]
      .sort((left, right) => left.productId.localeCompare(right.productId));
    const priceOverrides = new Map();
    for (const item of body.items || []) {
      if (item.unitPriceCents === undefined) continue;
      const cents = item.unitPriceCents === null ? null : Number(item.unitPriceCents);
      if (cents !== null && (!Number.isSafeInteger(cents) || cents < 0 || cents > 100000000)) throw new Error('INVALID_CHARGES');
      priceOverrides.set(item.productId, cents);
    }
    const pricesChanged = existing.items.some(item => priceOverrides.has(item.product_id) && priceOverrides.get(item.product_id) !== item.unit_price_cents);
    const itemsChanged = pricesChanged || JSON.stringify(normalizedExistingItems) !== JSON.stringify(normalizedRequestedItems);

    const productMap = itemsChanged ? await loadProducts(context.env.DB, items) : null;
    const agreedPrices = new Map(existing.items.map(item => [item.product_id, item.unit_price_cents]));
    const priceFor = item => priceOverrides.has(item.productId) ? priceOverrides.get(item.productId) : agreedPrices.has(item.productId)
      ? agreedPrices.get(item.productId) : productMap.get(item.productId).price_cents;
    const charges = normalizeCharges(body.charges ?? JSON.parse(existing.charges_json || '[]'));
    const totals = invoiceAmounts(items.map(item => ({ quantity: item.quantity, unit_price_cents: priceFor(item) })), charges);
    const subtotal = itemsChanged || body.charges !== undefined ? totals.subtotalCents : Number(existing.subtotal_cents);

    const serviceType = body.serviceType ?? existing.service_type;
    if (!['delivery', 'pickup'].includes(serviceType)) {
      return json({ ok: false, error: { code: 'INVALID_SERVICE_TYPE', message: 'Choose delivery or pickup.' } }, 400);
    }
    const eventCity = cleanText(body.eventCity ?? existing.event_city, 150);
    if (!eventCity) {
      return json({ ok: false, error: { code: 'INVALID_EVENT_CITY', message: 'Enter the event city.' } }, 400);
    }

    const updateStatement = context.env.DB.prepare(
      `UPDATE bookings SET
         status = ?1,
         event_start_at = ?2,
         event_end_at = ?3,
         block_start_at = ?4,
         block_end_at = ?5,
         hold_expires_at = ?6,
         service_type = ?7,
         event_city = ?8,
         event_address = ?9,
         notes = ?10,
         subtotal_cents = ?11,
         updated_by = ?12,
         updated_at = ?13
       WHERE id = ?14`
    ).bind(
      status,
      eventStart,
      eventEnd,
      blockStart,
      blockEnd,
      holdExpiresAt,
      serviceType,
      eventCity,
      cleanText(body.eventAddress ?? existing.event_address, 500) || null,
      cleanText(body.notes ?? existing.notes, 4000) || null,
      subtotal,
      user.id,
      now,
      existing.id
    );

    const expectedRevision = Number(body.revision ?? existing.revision ?? 0);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new Error('STALE_BOOKING');
    const statements = [context.env.DB.prepare(
      `UPDATE bookings SET revision = CASE WHEN revision = ?1 THEN revision + 1 ELSE -1 END WHERE id = ?2`
    ).bind(expectedRevision, existing.id)];
    if (body.charges !== undefined) statements.push(context.env.DB.prepare(
      `UPDATE bookings SET charges_json = ?1, tax_cents = ?2 WHERE id = ?3`
    ).bind(JSON.stringify(charges), totals.taxCents, existing.id));
    if (itemsChanged) {
      // D1 batch is atomic: replacement items and the final activation either
      // all succeed or leave the original reservation intact.
      statements.push(context.env.DB.prepare(
        `UPDATE bookings SET status = 'quote', updated_by = ?1 WHERE id = ?2`
      ).bind(user.id, existing.id));
      statements.push(
        context.env.DB.prepare('DELETE FROM booking_items WHERE booking_id = ?1').bind(existing.id)
      );
      for (const item of items) {
        statements.push(
          context.env.DB.prepare(
            `INSERT INTO booking_items (
              booking_id, product_id, quantity, unit_price_cents
            ) VALUES (?1, ?2, ?3, ?4)`
          ).bind(existing.id, item.productId, item.quantity, priceFor(item))
        );
      }
      statements.push(context.env.DB.prepare(
        `UPDATE signing_requests SET voided_at = COALESCE(voided_at, ?1) WHERE booking_id = ?2`
      ).bind(now, existing.id));
      statements.push(context.env.DB.prepare(
        `UPDATE payment_requests SET status = 'cancelled', updated_at = ?1 WHERE booking_id = ?2 AND status IN ('open', 'failed')`
      ).bind(now, existing.id));
    }
    statements.push(updateStatement);
    if (['paid','confirmed'].includes(status) && (itemsChanged || body.charges !== undefined)) {
      statements.push(bookingPaymentStatusStatement(context.env.DB, existing.id));
    }

    statements.push(
      context.env.DB.prepare(
        `INSERT INTO audit_log (
          id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at
        ) VALUES (?1, ?2, 'booking.update', 'booking', ?3, ?4, ?5)`
      ).bind(
        randomId(),
        user.id,
        existing.id,
        JSON.stringify({ status, eventStart, eventEnd, blockStart, blockEnd, holdExpiresAt, items, charges, subtotalCents: subtotal, taxCents: totals.taxCents }),
        now
      )
    );

    await context.env.DB.batch(statements);
    const booking = await bookingDetail(context.env.DB, existing.id);
    return json({ ok: true, booking });
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

export async function onRequestDelete(context) {
  try {
    protectMutation(context.request);
    const user = await requireAdmin(context.env, context.request);
    if (user.role !== 'owner') {
      return json({
        ok: false,
        error: { code: 'FORBIDDEN', message: 'Only an owner can permanently delete a test booking.' }
      }, 403);
    }

    const booking = await bookingDetail(context.env.DB, context.params.id);
    if (!booking) {
      return json({ ok: false, error: { code: 'NOT_FOUND', message: 'Booking not found.' } }, 404);
    }
    if (!['cancelled', 'expired'].includes(booking.status)) {
      return json({
        ok: false,
        error: {
          code: 'CANCEL_BEFORE_DELETE',
          message: 'Only cancelled or expired test bookings can be deleted.'
        }
      }, 409);
    }

    const protection = await context.env.DB.prepare(
      `SELECT
         (SELECT COUNT(*)
          FROM signatures s
          JOIN signing_requests sr ON sr.token_hash = s.signing_token_hash
          WHERE sr.booking_id = ?1) AS signed_count,
         (SELECT COUNT(*)
          FROM booking_status_history
          WHERE booking_id = ?1
            AND new_status IN ('confirmed', 'paid', 'ready', 'out', 'returned', 'completed')) AS protected_status_count,
         (SELECT COUNT(*)
          FROM bookings
          WHERE customer_id = ?2 AND id <> ?1) AS other_booking_count`
    ).bind(booking.id, booking.customer_id).first();

    if (Number(protection?.signed_count || 0) > 0 || Number(protection?.protected_status_count || 0) > 0) {
      return json({
        ok: false,
        error: {
          code: 'BOOKING_RECORD_PROTECTED',
          message: 'This booking has a signature or real rental history and must be retained as a business record.'
        }
      }, 409);
    }

    const deleteCustomer = Number(protection?.other_booking_count || 0) === 0;
    const now = Math.floor(Date.now() / 1000);
    const statements = [
      context.env.DB.prepare(
        `DELETE FROM signatures
         WHERE signing_token_hash IN (
           SELECT token_hash FROM signing_requests WHERE booking_id = ?1
         )`
      ).bind(booking.id),
      context.env.DB.prepare('DELETE FROM signing_requests WHERE booking_id = ?1').bind(booking.id),
      context.env.DB.prepare('DELETE FROM bookings WHERE id = ?1').bind(booking.id)
    ];

    if (deleteCustomer) {
      statements.push(
        context.env.DB.prepare('DELETE FROM customers WHERE id = ?1').bind(booking.customer_id)
      );
    }

    statements.push(
      context.env.DB.prepare(
        `INSERT INTO audit_log (
          id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at
        ) VALUES (?1, ?2, 'booking.delete_test', 'booking', ?3, ?4, ?5)`
      ).bind(
        randomId(),
        user.id,
        booking.id,
        JSON.stringify({
          bookingNumber: booking.booking_number,
          status: booking.status,
          customerDeleted: deleteCustomer
        }),
        now
      )
    );

    await context.env.DB.batch(statements);
    return json({
      ok: true,
      deleted: { id: booking.id, bookingNumber: booking.booking_number },
      customerDeleted: deleteCustomer
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
