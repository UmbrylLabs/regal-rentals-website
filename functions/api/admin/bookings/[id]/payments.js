import { protectMutation, requireAdmin } from '../../../../_lib/auth.js';
import { cleanText, json, randomId, readJson, safeErrorResponse } from '../../../../_lib/http.js';
import {
  createPaymentRequest,
  latestSignedPaymentMethod,
  listBookingPayments,
  loadBookingForPayment,
  normalizePaymentPurpose,
  paymentSummary,
  recordCompletedPayment
} from '../../../../_lib/payments.js';
import { resolvePublicSigningOrigin } from '../../../../_lib/signing-origin.js';
import { squareConfigured, squareEnvironment } from '../../../../_lib/square.js';

function paymentError(error) {
  const code = String(error?.message || '');
  const known = {
    BOOKING_NOT_FOUND: ['Booking not found.', 404],
    BOOKING_NOT_PAYABLE: ['This booking is not open for payment.', 409],
    INVALID_PAYMENT_PURPOSE: ['Choose a valid payment purpose.', 400],
    INVALID_PAYMENT_METHOD: ['Choose credit card, debit card, or automatic detection from the signed agreement.', 400],
    INVALID_PAYMENT_AMOUNT: ['Enter a valid payment amount.', 400],
    NO_RENTAL_BALANCE: ['This booking has no remaining rental balance.', 409]
  };
  if (known[code]) return json({ ok: false, error: { code, message: known[code][0] } }, known[code][1]);
  return safeErrorResponse(error);
}

export async function onRequestGet(context) {
  try {
    await requireAdmin(context.env, context.request);
    const booking = await loadBookingForPayment(context.env.DB, context.params.id);
    if (!booking) return json({ ok: false, error: { code: 'NOT_FOUND', message: 'Booking not found.' } }, 404);
    const records = await listBookingPayments(context.env.DB, booking.id);
    const summary = await paymentSummary(context.env.DB, booking.id, booking.subtotal_cents);
    const signedMethod = await latestSignedPaymentMethod(context.env.DB, booking.id);
    const savedCards = await context.env.DB.prepare(
      `SELECT id, card_brand, last_4, card_type, exp_month, exp_year, enabled, updated_at
       FROM square_cards WHERE customer_id = ?1 AND enabled = 1 ORDER BY updated_at DESC`
    ).bind(booking.customer_id).all();
    return json({
      ok: true,
      configured: squareConfigured(context.env),
      environment: squareEnvironment(context.env),
      booking,
      summary,
      signedPaymentMethod: signedMethod,
      requests: records.requests,
      payments: records.payments,
      savedCards: savedCards.results || []
    });
  } catch (error) {
    return paymentError(error);
  }
}

export async function onRequestPost(context) {
  try {
    protectMutation(context.request);
    const user = await requireAdmin(context.env, context.request);
    const body = await readJson(context.request);
    const action = cleanText(body.action, 40);
    const booking = await loadBookingForPayment(context.env.DB, context.params.id);
    if (!booking) throw new Error('BOOKING_NOT_FOUND');

    if (action === 'create_request') {
      const origin = resolvePublicSigningOrigin(context.request.url, context.env.PUBLIC_SITE_ORIGIN);
      const request = await createPaymentRequest(context.env, booking.id, user, {
        purpose: body.purpose,
        amountCents: body.amountCents,
        expectedMethod: body.expectedMethod,
        appliesToRental: body.appliesToRental,
        description: body.description,
        expiresDays: body.expiresDays,
        origin
      });
      return json({ ok: true, paymentRequest: request }, 201);
    }

    if (action === 'record_cash') {
      const purpose = normalizePaymentPurpose(body.purpose || 'reservation');
      const amountCents = Math.round(Number(body.amountCents));
      if (!Number.isInteger(amountCents) || amountCents < 1 || amountCents > 10_000_000) {
        throw new Error('INVALID_PAYMENT_AMOUNT');
      }
      const appliesToRental = purpose !== 'security_deposit' && body.appliesToRental !== false;
      const paymentId = await recordCompletedPayment(context.env, {
        bookingId: booking.id,
        provider: 'cash',
        purpose,
        amountCents,
        appliesToRental,
        note: cleanText(body.note, 1000) || 'Cash received and counted in person.',
        receivedBy: user.id
      });
      return json({ ok: true, paymentId }, 201);
    }

    if (action === 'cancel_request') {
      const requestId = cleanText(body.requestId, 100);
      const result = await context.env.DB.prepare(
        `UPDATE payment_requests SET status = 'cancelled', updated_at = unixepoch()
         WHERE id = ?1 AND booking_id = ?2 AND status IN ('open', 'failed')`
      ).bind(requestId, booking.id).run();
      if (!Number(result?.meta?.changes || 0)) {
        return json({ ok: false, error: { code: 'REQUEST_NOT_CANCELLABLE', message: 'That payment request cannot be cancelled.' } }, 409);
      }
      await context.env.DB.prepare(
        `INSERT INTO audit_log (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
         VALUES (?1, ?2, 'payment.request_cancel', 'booking', ?3, ?4, unixepoch())`
      ).bind(randomId(), user.id, booking.id, JSON.stringify({ requestId })).run();
      return json({ ok: true });
    }

    return json({ ok: false, error: { code: 'INVALID_ACTION', message: 'Choose a valid payment action.' } }, 400);
  } catch (error) {
    return paymentError(error);
  }
}
