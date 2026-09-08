import { cleanText, randomId } from './http.js';
import { squareRequest } from './square.js';

export const PAYMENT_PENDING_MESSAGE = 'Your payment result is being confirmed. Do not pay again. Refresh this page to check the result, or contact Regal Rentals.';

export function bookingCanCollect(booking, now = Math.floor(Date.now() / 1000)) {
  const status = booking.booking_status ?? booking.status;
  return ['confirmed', 'paid', 'ready', 'out', 'returned'].includes(status)
    || (status === 'hold' && Number(booking.hold_expires_at) > now);
}

export async function claimPaymentAttempt(db, request, { cardOnFileConsent, cardholderName }) {
  const id = randomId();
  const attempt = { id, payment_request_id: request.id, booking_id: request.booking_id,
    idempotency_key: id, original_hold_expires_at: request.hold_expires_at };
  await db.batch([
    db.prepare(`INSERT INTO payment_attempts
      (id, payment_request_id, booking_id, idempotency_key, status, original_hold_expires_at)
      VALUES (?1, ?2, ?3, ?1, 'processing', ?4)`)
      .bind(id, request.id, request.booking_id, request.hold_expires_at ?? null),
    db.prepare(`UPDATE payment_requests SET card_consent_at = ?1, cardholder_name = ?2
      WHERE id = ?3`).bind(cardOnFileConsent ? Math.floor(Date.now() / 1000) : null,
      cardholderName || null, request.id)
  ]);
  return attempt;
}

export async function failPaymentAttempt(db, attempt, message) {
  await db.batch([
    db.prepare(`UPDATE payment_attempts SET status = 'failed', failure_message = ?1,
      updated_at = unixepoch() WHERE id = ?2 AND status IN ('processing', 'unknown')`)
      .bind(cleanText(message, 500), attempt.id),
    db.prepare(`UPDATE payment_requests SET status = 'failed', failure_message = ?1,
      updated_at = unixepoch() WHERE id = ?2 AND status = 'processing'
      AND EXISTS (SELECT 1 FROM payment_attempts WHERE id = ?3 AND status = 'failed')
      AND NOT EXISTS (SELECT 1 FROM payment_attempts WHERE payment_request_id = ?2
        AND status IN ('processing', 'unknown', 'completed'))`)
      .bind(cleanText(message, 500), attempt.payment_request_id, attempt.id),
    db.prepare(`UPDATE bookings SET hold_expires_at = ?1,
      status = CASE WHEN ?1 <= unixepoch() THEN 'expired' ELSE 'hold' END,
      updated_at = unixepoch()
      WHERE id = ?2 AND status = 'hold' AND hold_expires_at IS NULL
      AND EXISTS (SELECT 1 FROM payment_attempts WHERE id = ?3 AND status = 'failed')
      AND NOT EXISTS (SELECT 1 FROM payment_attempts WHERE booking_id = ?2
        AND status IN ('processing', 'unknown'))`)
      .bind(attempt.original_hold_expires_at ?? 0, attempt.booking_id, attempt.id)
  ]);
}

export async function markPaymentUnknown(db, attempt, squarePaymentId = null) {
  await db.prepare(`UPDATE payment_attempts SET status = 'unknown',
    square_payment_id = COALESCE(?1, square_payment_id), failure_message = ?2,
    updated_at = unixepoch() WHERE id = ?3 AND status IN ('processing', 'unknown')`)
    .bind(squarePaymentId, PAYMENT_PENDING_MESSAGE, attempt.id).run();
}

export function definitelyDeclined(error) {
  const codes = new Set(['CARD_DECLINED', 'GENERIC_DECLINE', 'INSUFFICIENT_FUNDS',
    'CARD_EXPIRED', 'INVALID_CARD', 'INVALID_CARD_DATA', 'VERIFY_CVV_FAILURE',
    'VERIFY_AVS_FAILURE', 'CARD_NOT_SUPPORTED', 'CARD_TOKEN_EXPIRED',
    'PAYMENT_LIMIT_EXCEEDED', 'INVALID_LOCATION', 'UNAUTHORIZED', 'FORBIDDEN']);
  return error?.message === 'SQUARE_API_ERROR' && Number(error.status) < 500
    && error.squareErrors?.length > 0 && error.squareErrors.every(item => codes.has(item.code));
}

export function verifyProcessorPayment(env, request, payment, attempt = null) {
  if (!payment?.id || payment.location_id !== env.SQUARE_LOCATION_ID
    || payment.amount_money?.currency !== 'USD'
    || Number(payment.amount_money?.amount) !== Number(request.amount_cents)
    || ![request.id, attempt?.id].filter(Boolean).includes(payment.reference_id)) {
    throw new Error('PAYMENT_RECONCILIATION_MISMATCH');
  }
}

// Read only. A missing list result is never treated as proof of a failed charge.
export async function findProcessorPayment(env, request, attempt, suppliedId = null) {
  const paymentId = suppliedId || attempt?.square_payment_id || request.square_payment_id;
  if (paymentId) {
    return (await squareRequest(env, `/v2/payments/${encodeURIComponent(paymentId)}`)).payment;
  }
  const begin = Number(attempt?.created_at || request.created_at) - 60;
  const query = new URLSearchParams({ location_id: env.SQUARE_LOCATION_ID,
    begin_time: new Date(begin * 1000).toISOString(), limit: '100', sort_order: 'DESC' });
  for (let page = 0; page < 5; page++) {
    const result = await squareRequest(env, `/v2/payments?${query}`);
    const found = (result.payments || []).find(payment =>
      payment.reference_id === (attempt?.id || request.id));
    if (found) return found;
    if (!result.cursor) break;
    query.set('cursor', result.cursor);
  }
  return null;
}
