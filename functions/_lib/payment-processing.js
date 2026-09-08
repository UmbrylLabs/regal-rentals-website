import { recordCompletedPaymentSafely } from './payment-recording.js';
import { ensureSquareCustomer, saveSquareCardFromPayment, squareCardSummary } from './square.js';
import { failPaymentAttempt, verifyProcessorPayment } from './payment-attempts.js';
import { paymentPurposeLabel } from './payments.js';

export async function reconcileProcessorPayment(env, request, payment, attempt = null) {
  verifyProcessorPayment(env, request, payment, attempt);
  if (['FAILED', 'CANCELED'].includes(payment.status)) {
    if (attempt) await failPaymentAttempt(env.DB, attempt, 'Square did not complete this payment.');
    return { status: 'failed' };
  }
  if (payment.status !== 'COMPLETED') return { status: 'processing' };

  const card = squareCardSummary(payment);
  const actualMethod = card.cardType === 'CREDIT' ? 'credit_card'
    : card.cardType === 'DEBIT' ? 'debit_card' : 'unknown';
  const methodMismatch = request.expected_method !== 'unspecified'
    && actualMethod !== 'unknown' && request.expected_method !== actualMethod;
  let savedCard = null;
  let cardSaveWarning = '';
  if (Number(request.require_card_on_file) === 1 && actualMethod === 'credit_card' && request.card_consent_at) {
    try {
      const customerId = await ensureSquareCustomer(env, { id: request.customer_id,
        name: request.customer_name, email: request.customer_email, phone: request.customer_phone });
      savedCard = await saveSquareCardFromPayment(env, { paymentId: payment.id,
        squareCustomerId: customerId, customerId: request.customer_id,
        cardholderName: request.cardholder_name || request.customer_name,
        idempotencyKey: `card-${attempt?.id || request.id}`.slice(0, 45) });
    } catch (error) {
      console.error('Card storage needs review after successful payment', error?.message);
      cardSaveWarning = 'Payment succeeded, but card storage needs staff review before equipment release.';
    }
  }
  await recordCompletedPaymentSafely(env, { bookingId: request.booking_id,
    paymentRequestId: request.id, attemptId: attempt?.id, provider: 'square',
    purpose: request.purpose, amountCents: Number(payment.amount_money.amount),
    appliesToRental: Number(request.applies_to_rental) === 1,
    squarePaymentId: payment.id, squareReceiptUrl: card.receiptUrl, squareCardId: savedCard?.id,
    cardBrand: card.cardBrand, cardLast4: card.last4, cardType: card.cardType,
    expectedMethod: request.expected_method, methodMismatch, note: cardSaveWarning,
    paidAt: Math.floor(new Date(payment.created_at || Date.now()).getTime() / 1000) });
  return { status: 'paid', amountCents: Number(payment.amount_money.amount),
    purposeLabel: paymentPurposeLabel(request.purpose), receiptUrl: card.receiptUrl,
    cardBrand: card.cardBrand, cardLast4: card.last4, cardType: card.cardType, actualMethod,
    expectedMethod: request.expected_method, methodMismatch, cardOnFileSaved: Boolean(savedCard),
    cardSaveWarning, depositStillRequired: actualMethod === 'debit_card' && request.purpose !== 'security_deposit' };
}
