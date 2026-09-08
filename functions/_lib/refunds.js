import { cleanText, randomId } from './http.js';
import { squareRequest } from './square.js';
import { bookingPaymentStatusStatement } from './payments.js';

function refundTotalsStatement(db, paymentId) {
  return db.prepare(`UPDATE booking_payments SET refunded_cents = (
      SELECT COALESCE(SUM(amount_cents), 0) FROM booking_refunds
      WHERE booking_payment_id = ?1 AND status = 'completed'),
    status = CASE
      WHEN amount_cents <= (SELECT COALESCE(SUM(amount_cents), 0) FROM booking_refunds
        WHERE booking_payment_id = ?1 AND status = 'completed') THEN 'refunded'
      WHEN EXISTS (SELECT 1 FROM booking_refunds WHERE booking_payment_id = ?1
        AND status = 'completed') THEN 'partially_refunded' ELSE 'completed' END,
    updated_at = unixepoch() WHERE id = ?1`).bind(paymentId);
}

export async function reconcileSquareRefund(env, refund) {
  if (!refund?.id || refund.location_id !== env.SQUARE_LOCATION_ID
    || refund.amount_money?.currency !== 'USD') throw new Error('REFUND_RECONCILIATION_MISMATCH');
  const payment = await env.DB.prepare('SELECT * FROM booking_payments WHERE square_payment_id = ?1')
    .bind(refund.payment_id).first();
  if (!payment) return null;
  const status = String(refund.status || '').toLowerCase();
  if (!['pending', 'completed', 'failed', 'rejected'].includes(status)) throw new Error('INVALID_REFUND_STATUS');
  const amount = Number(refund.amount_money.amount);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > payment.amount_cents) throw new Error('INVALID_REFUND_AMOUNT');
  const marker = String(refund.reason || '').match(/\[RR:([a-f0-9-]{36})\]/i)?.[1];
  const existing = await env.DB.prepare(`SELECT * FROM booking_refunds
    WHERE square_refund_id = ?1 OR (id = ?2 AND booking_payment_id = ?3) LIMIT 1`)
    .bind(refund.id, marker || '', payment.id).first();
  if (existing && (existing.booking_payment_id !== payment.id || Number(existing.amount_cents) !== amount)) {
    throw new Error('REFUND_RECONCILIATION_MISMATCH');
  }
  const id = existing?.id || randomId();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO booking_refunds
      (id, booking_payment_id, square_refund_id, amount_cents, status, reason)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6)
      ON CONFLICT(id) DO UPDATE SET square_refund_id = excluded.square_refund_id,
        status = CASE WHEN booking_refunds.status = 'completed' THEN 'completed' ELSE excluded.status END,
        updated_at = unixepoch()`)
      .bind(id, payment.id, refund.id, amount, status, cleanText(refund.reason, 192)),
    refundTotalsStatement(env.DB, payment.id),
    bookingPaymentStatusStatement(env.DB, payment.booking_id)
  ]);
  return { id, status, amountCents: amount };
}

export async function requestBookingRefund(env, bookingId, user, input) {
  const refundId = cleanText(input.refundKey, 100);
  const amount = Number(input.amountCents);
  const reason = cleanText(input.reason, 130);
  if (!/^[a-f0-9-]{36}$/i.test(refundId) || !Number.isSafeInteger(amount) || amount <= 0 || !reason) {
    throw new Error('INVALID_REFUND_AMOUNT');
  }
  const payment = await env.DB.prepare(`SELECT * FROM booking_payments
    WHERE id = ?1 AND booking_id = ?2 AND status IN ('completed', 'partially_refunded')`)
    .bind(cleanText(input.paymentId, 100), bookingId).first();
  // Completed idempotent retries are allowed even when the payment is now fully refunded.
  const previous = await env.DB.prepare(`SELECT r.*, p.booking_id FROM booking_refunds r
    JOIN booking_payments p ON p.id = r.booking_payment_id WHERE r.id = ?1`).bind(refundId).first();
  if (previous) {
    if (previous.booking_id !== bookingId || previous.booking_payment_id !== input.paymentId
      || Number(previous.amount_cents) !== amount || previous.reason !== reason) throw new Error('REFUND_REQUEST_CHANGED');
    if (previous.status !== 'pending') return { id: previous.id, status: previous.status };
  }
  if (!payment) throw new Error('PAYMENT_NOT_REFUNDABLE');
  if (payment.provider === 'cash' && input.cashReturned !== true) throw new Error('CASH_REFUND_CONFIRMATION_REQUIRED');
  if (!['square', 'cash'].includes(payment.provider)) throw new Error('PAYMENT_NOT_REFUNDABLE');
  if (!previous) {
    const inserted = await env.DB.prepare(`INSERT INTO booking_refunds
      (id, booking_payment_id, amount_cents, status, reason, created_by)
      SELECT ?1, id, ?2, 'pending', ?3, ?4 FROM booking_payments
      WHERE id = ?5 AND ?2 <= amount_cents - (SELECT COALESCE(SUM(amount_cents), 0)
        FROM booking_refunds WHERE booking_payment_id = ?5 AND status IN ('pending', 'completed'))`)
      .bind(refundId, amount, reason, user.id, payment.id).run();
    if (!Number(inserted.meta?.changes)) throw new Error('REFUND_EXCEEDS_AVAILABLE');
  }
  if (payment.provider === 'square') {
    if (previous?.square_refund_id) {
      const current = await squareRequest(env, '/v2/refunds/' + encodeURIComponent(previous.square_refund_id));
      return reconcileSquareRefund(env, current.refund);
    }
    let result;
    try {
      result = await squareRequest(env, '/v2/refunds', { method: 'POST', body: {
        idempotency_key: refundId, payment_id: payment.square_payment_id,
        amount_money: { amount, currency: 'USD' }, reason: `${reason} [RR:${refundId}]`
      } });
    } catch (error) {
      // Retry the same refund key after timeouts; never create a replacement refund.
      if (error?.message === 'SQUARE_API_ERROR' && [400, 401, 403, 404, 422].includes(error.status)
        && !error.squareErrors?.some(item => item.code === 'IDEMPOTENCY_KEY_REUSED')) {
        await env.DB.prepare(`UPDATE booking_refunds SET status = 'failed', updated_at = unixepoch()
          WHERE id = ?1 AND status = 'pending' AND square_refund_id IS NULL`).bind(refundId).run();
        throw error;
      }
      return { id: refundId, status: 'pending', message: 'Refund result pending. Check Square or retry this same refund.' };
    }
    if (!result.refund) return { id: refundId, status: 'pending' };
    return reconcileSquareRefund(env, result.refund);
  }
  if (payment.provider !== 'cash') throw new Error('PAYMENT_NOT_REFUNDABLE');
  if (input.cashReturned !== true) throw new Error('CASH_REFUND_CONFIRMATION_REQUIRED');
  await env.DB.batch([
    env.DB.prepare(`UPDATE booking_refunds SET status = 'completed', updated_at = unixepoch() WHERE id = ?1`)
      .bind(refundId),
    refundTotalsStatement(env.DB, payment.id),
    bookingPaymentStatusStatement(env.DB, bookingId)
  ]);
  return { id: refundId, status: 'completed' };
}
