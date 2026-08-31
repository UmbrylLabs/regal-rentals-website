import {
  bookingDetail,
  isBlockingStatus,
  loadProducts,
  normalizeItems,
  normalizeStatus,
  validateEpochWindow
} from '../../../_lib/booking.js';
import { protectMutation, requireAdmin } from '../../../_lib/auth.js';
import { cleanText, json, randomId, readJson, safeErrorResponse } from '../../../_lib/http.js';
import { DEFAULT_HOLD_SECONDS, inventoryBlockWindow } from '../../../_lib/inventory-policy.js';

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
    const { start: eventStart, end: eventEnd } = validateEpochWindow(
      body.eventStartAt ?? existing.event_start_at,
      body.eventEndAt ?? existing.event_end_at
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
    const requestedHoldExpiry = Number(body.holdExpiresAt || existing.hold_expires_at || 0);
    const holdExpiresAt = status === 'hold'
      ? Math.max(requestedHoldExpiry, now + DEFAULT_HOLD_SECONDS)
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
    const itemsChanged = JSON.stringify(normalizedExistingItems) !== JSON.stringify(normalizedRequestedItems);
    const windowChanged = eventStart !== Number(existing.event_start_at)
      || eventEnd !== Number(existing.event_end_at)
      || blockStart !== Number(existing.block_start_at)
      || blockEnd !== Number(existing.block_end_at);
    const existingBlocksInventory = isBlockingStatus(
      existing.status,
      existing.hold_expires_at
    );

    if (existingBlocksInventory && (itemsChanged || windowChanged)) {
      return json({
        ok: false,
        error: {
          code: 'RELEASE_BEFORE_EDIT',
          message: 'Cancel or expire this reservation before changing its dates or rental items, then reactivate it after reviewing availability.'
        }
      }, 409);
    }

    const productMap = await loadProducts(context.env.DB, items);
    let subtotal = 0;
    for (const item of items) {
      const price = productMap.get(item.productId).price_cents;
      if (price != null) subtotal += Number(price) * item.quantity;
    }

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

    const statements = [];
    if (existingBlocksInventory) {
      statements.push(updateStatement);
    } else {
      statements.push(
        context.env.DB.prepare('DELETE FROM booking_items WHERE booking_id = ?1').bind(existing.id)
      );
      for (const item of items) {
        const product = productMap.get(item.productId);
        statements.push(
          context.env.DB.prepare(
            `INSERT INTO booking_items (
              booking_id, product_id, quantity, unit_price_cents
            ) VALUES (?1, ?2, ?3, ?4)`
          ).bind(existing.id, item.productId, item.quantity, product.price_cents)
        );
      }
      statements.push(updateStatement);
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
        JSON.stringify({ status, eventStart, eventEnd, blockStart, blockEnd, holdExpiresAt, items }),
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
