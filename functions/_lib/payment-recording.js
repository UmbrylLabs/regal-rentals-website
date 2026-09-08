import { recordCompletedPayment, bookingPaymentStatusStatement } from './payments.js';

async function existingSquarePayment(env, input) {
  if (!input.squarePaymentId) return null;
  const existing = await env.DB.prepare(
    'SELECT id FROM booking_payments WHERE square_payment_id = ?1'
  ).bind(input.squarePaymentId).first();
  if (!existing) return null;
  if (input.paymentRequestId) {
    await env.DB.batch([
      ...(input.squareCardId ? [env.DB.prepare(`UPDATE booking_payments SET square_card_id=?1,
        note=CASE WHEN note='Payment succeeded, but card storage needs staff review before equipment release.' THEN NULL ELSE note END,
        updated_at=unixepoch() WHERE id=?2 AND booking_id=?3`).bind(input.squareCardId, existing.id, input.bookingId)] : []),
      ...(input.attemptId ? [env.DB.prepare(`UPDATE payment_attempts SET status = 'completed',
        square_payment_id = ?1, failure_message = NULL, updated_at = unixepoch() WHERE id = ?2`)
        .bind(input.squarePaymentId, input.attemptId)] : []),
      env.DB.prepare(
      `UPDATE payment_requests SET status = 'paid', square_payment_id = ?1,
              paid_at = COALESCE(paid_at, ?2), failure_message = NULL, updated_at = ?2
       WHERE id = ?3`
    ).bind(
      input.squarePaymentId,
      Number(input.paidAt || Math.floor(Date.now() / 1000)),
      input.paymentRequestId
      ), bookingPaymentStatusStatement(env.DB, input.bookingId)
    ]);
  }
  return existing.id;
}

export async function recordCompletedPaymentSafely(env, input) {
  const existing = await existingSquarePayment(env, input);
  if (existing) return existing;
  try {
    return await recordCompletedPayment(env, input);
  } catch (error) {
    const message = String(error?.message || '').toLowerCase();
    if (input.squarePaymentId && message.includes('unique')) {
      const raced = await existingSquarePayment(env, input);
      if (raced) return raced;
    }
    throw error;
  }
}
