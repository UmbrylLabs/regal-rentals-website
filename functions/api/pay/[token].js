import { cleanText, json, readJson, safeErrorResponse } from '../../_lib/http.js';
import { expirePaymentRequestIfNeeded, loadPaymentRequestByToken, paymentPurposeLabel } from '../../_lib/payments.js';
import { claimPaymentAttempt, failPaymentAttempt, markPaymentUnknown, definitelyDeclined,
  PAYMENT_PENDING_MESSAGE } from '../../_lib/payment-attempts.js';
import { reconcileProcessorPayment } from '../../_lib/payment-processing.js';
import { createSquarePayment, ensureSquareCustomer, squareConfigured, squarePublicConfig } from '../../_lib/square.js';

const pending = () => json({ ok: true, pending: true, message: PAYMENT_PENDING_MESSAGE }, 202);

function publicError(error) {
  if (error?.message === 'SQUARE_NOT_CONFIGURED') return json({ ok: false, error: {
    code: 'SQUARE_NOT_CONFIGURED', message: 'Online payment is not active yet. Contact Regal Rentals.' } }, 503);
  if (definitelyDeclined(error)) return json({ ok: false, error: {
    code: 'CARD_DECLINED', message: cleanText(error.squareMessage, 500) || 'The card was declined. Try another card.' } }, 402);
  if (/idx_payment_attempts_active_booking|UNIQUE constraint failed: payment_attempts.booking_id/.test(String(error?.message))) {
    return pending();
  }
  return safeErrorResponse(error);
}

async function lookup(context) {
  const token = cleanText(context.params.token, 200);
  if (token.length < 30) return null;
  const found = await loadPaymentRequestByToken(context.env.DB, token);
  return found.request ? expirePaymentRequestIfNeeded(context.env.DB, found.request) : null;
}

export async function onRequestGet(context) {
  try {
    const request = await lookup(context);
    if (!request) return json({ ok: false, error: { code: 'NOT_FOUND', message: 'This payment link was not found.' } }, 404);
    return json({ ok: true, payment: {
      bookingNumber: request.booking_number, customerName: request.customer_name,
      customerEmail: request.customer_email, eventStartAt: Number(request.event_start_at),
      purpose: request.purpose, purposeLabel: paymentPurposeLabel(request.purpose),
      description: request.description, amountCents: Number(request.amount_cents), currency: request.currency,
      expectedMethod: request.expected_method, requireCardOnFile: Number(request.require_card_on_file) === 1,
      status: request.status, expiresAt: Number(request.expires_at), paidAt: request.paid_at,
      square: squarePublicConfig(context.env)
    } });
  } catch (error) { return publicError(error); }
}

export async function onRequestPost(context) {
  let attempt = null;
  let submitted = false;
  let processorPayment = null;
  try {
    if (!squareConfigured(context.env)) throw new Error('SQUARE_NOT_CONFIGURED');
    let request = await lookup(context);
    if (!request) return json({ ok: false, error: { code: 'NOT_FOUND', message: 'This payment link was not found.' } }, 404);
    if (request.status === 'paid') return json({ ok: false, error: {
      code: 'ALREADY_PAID', message: 'This payment has already been completed.' } }, 409);
    if (request.status === 'processing') return pending();
    if (!['open', 'failed'].includes(request.status)) throw new Error('BOOKING_NOT_PAYABLE');

    const body = await readJson(context.request, 50_000);
    const sourceId = cleanText(body.sourceId, 20_000);
    const cardholderName = cleanText(body.cardholderName || request.customer_name, 300);
    const cardOnFileConsent = body.cardOnFileConsent === true;
    if (!sourceId) return json({ ok: false, error: {
      code: 'CARD_TOKEN_REQUIRED', message: 'Enter valid card information.' } }, 400);
    if (Number(request.require_card_on_file) === 1 && !cardOnFileConsent) return json({ ok: false, error: {
      code: 'CARD_CONSENT_REQUIRED', message: 'Accept the credit-card storage authorization.' } }, 400);

    attempt = await claimPaymentAttempt(context.env.DB, request, { cardholderName, cardOnFileConsent });
    request = { ...request, cardholder_name: cardholderName,
      card_consent_at: cardOnFileConsent ? Math.floor(Date.now() / 1000) : null };
    const squareCustomerId = await ensureSquareCustomer(context.env, { id: request.customer_id,
      name: request.customer_name, email: request.customer_email, phone: request.customer_phone });
    submitted = true;
    processorPayment = await createSquarePayment(context.env, { sourceId, amountCents: request.amount_cents,
      idempotencyKey: attempt.idempotency_key, squareCustomerId, referenceId: attempt.id,
      note: `${paymentPurposeLabel(request.purpose)} · ${request.booking_number}` });
    await context.env.DB.prepare(`UPDATE payment_attempts SET square_payment_id = ?1,
      updated_at = unixepoch() WHERE id = ?2`).bind(processorPayment.id, attempt.id).run();
    const payment = await reconcileProcessorPayment(context.env, request, processorPayment, attempt);
    if (payment.status === 'processing') return pending();
    if (payment.status === 'failed') return json({ ok: false, error: {
      code: 'CARD_DECLINED', message: 'Square did not complete the payment. Try another card.' } }, 402);
    return json({ ok: true, payment }, 201);
  } catch (error) {
    if (attempt) {
      if (!submitted || definitelyDeclined(error)) {
        try { await failPaymentAttempt(context.env.DB, attempt, error.squareMessage || 'Payment could not be started.'); }
        catch (recordError) { console.error('Payment failure requires reconciliation', recordError?.message); return pending(); }
      } else {
        // An uncertain processor result must never enable another charge.
        try { await markPaymentUnknown(context.env.DB, attempt, processorPayment?.id); }
        catch (recordError) { console.error('Payment outcome pending', recordError?.message); }
        console.error('Payment needs reconciliation', error?.message);
        return pending();
      }
    }
    return publicError(error);
  }
}
