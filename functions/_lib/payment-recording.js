import { recordCompletedPayment } from './payments.js';

async function existingSquarePayment(env, input) {
  if (!input.squarePaymentId) return null;
  const existing = await env.DB.prepare(
    'SELECT id FROM booking_payments WHERE square_payment_id = ?1'
  ).bind(input.squarePaymentId).first();
  if (!existing) return null;
  if (input.paymentRequestId) {
    await env.DB.prepare(
      `UPDATE payment_requests SET status = 'paid', square_payment_id = ?1,
              paid_at = COALESCE(paid_at, ?2), failure_message = NULL, updated_at = ?2
       WHERE id = ?3`
    ).bind(
      input.squarePaymentId,
      Number(input.paidAt || Math.floor(Date.now() / 1000)),
      input.paymentRequestId
    ).run();
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
