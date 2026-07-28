import { cleanText, json, readJson, safeErrorResponse } from '../../_lib/http.js';
import {
  expirePaymentRequestIfNeeded,
  loadPaymentRequestByToken,
  paymentPurposeLabel,
  recordCompletedPayment
} from '../../_lib/payments.js';
import {
  createSquarePayment,
  ensureSquareCustomer,
  saveSquareCardFromPayment,
  squareCardSummary,
  squareConfigured,
  squarePublicConfig
} from '../../_lib/square.js';

function publicError(error) {
  const code = String(error?.message || '');
  if (code === 'SQUARE_NOT_CONFIGURED') {
    return json({ ok: false, error: { code, message: 'Online payment is not active yet. Contact Regal Rentals.' } }, 503);
  }
  if (code === 'SQUARE_API_ERROR') {
    return json({
      ok: false,
      error: { code, message: cleanText(error.squareMessage, 500) || 'The card could not be processed.' }
    }, 402);
  }
  return safeErrorResponse(error);
}

function publicPaymentRequest(request, env) {
  return {
    bookingNumber: request.booking_number,
    customerName: request.customer_name,
    customerEmail: request.customer_email,
    eventStartAt: Number(request.event_start_at),
    purpose: request.purpose,
    purposeLabel: paymentPurposeLabel(request.purpose),
    description: request.description,
    amountCents: Number(request.amount_cents),
    currency: request.currency,
    expectedMethod: request.expected_method,
    requireCardOnFile: Number(request.require_card_on_file) === 1,
    status: request.status,
    expiresAt: Number(request.expires_at),
    paidAt: request.paid_at == null ? null : Number(request.paid_at),
    square: squarePublicConfig(env)
  };
}

export async function onRequestGet(context) {
  try {
    const token = cleanText(context.params.token, 200);
    if (!token || token.length < 30) {
      return json({ ok: false, error: { code: 'INVALID_LINK', message: 'This payment link is invalid.' } }, 404);
    }
    const found = await loadPaymentRequestByToken(context.env.DB, token);
    if (!found.request) {
      return json({ ok: false, error: { code: 'NOT_FOUND', message: 'This payment request was not found.' } }, 404);
    }
    const request = await expirePaymentRequestIfNeeded(context.env.DB, found.request);
    return json({ ok: true, payment: publicPaymentRequest(request, context.env) });
  } catch (error) {
    return publicError(error);
  }
}

export async function onRequestPost(context) {
  try {
    if (!squareConfigured(context.env)) throw new Error('SQUARE_NOT_CONFIGURED');
    const token = cleanText(context.params.token, 200);
    const found = await loadPaymentRequestByToken(context.env.DB, token);
    if (!found.request) {
      return json({ ok: false, error: { code: 'NOT_FOUND', message: 'This payment request was not found.' } }, 404);
    }
    let request = await expirePaymentRequestIfNeeded(context.env.DB, found.request);
    if (request.status === 'paid') {
      return json({ ok: false, error: { code: 'ALREADY_PAID', message: 'This payment has already been completed.' } }, 409);
    }
    if (['cancelled', 'expired'].includes(request.status)) {
      return json({ ok: false, error: { code: 'PAYMENT_UNAVAILABLE', message: 'This payment link is no longer active.' } }, 410);
    }
    if (request.status === 'processing') {
      return json({ ok: false, error: { code: 'PAYMENT_PROCESSING', message: 'This payment is already processing. Do not submit it again.' } }, 409);
    }

    const body = await readJson(context.request, 50_000);
    const sourceId = cleanText(body.sourceId, 20_000);
    const cardholderName = cleanText(body.cardholderName || request.customer_name, 300);
    const cardOnFileConsent = body.cardOnFileConsent === true;
    if (!sourceId) {
      return json({ ok: false, error: { code: 'CARD_TOKEN_REQUIRED', message: 'Enter valid card information.' } }, 400);
    }
    if (Number(request.require_card_on_file) === 1 && !cardOnFileConsent) {
      return json({
        ok: false,
        error: { code: 'CARD_CONSENT_REQUIRED', message: 'Consent to securely save the credit card is required for this booking.' }
      }, 400);
    }

    const now = Math.floor(Date.now() / 1000);
    const claim = await context.env.DB.prepare(
      `UPDATE payment_requests SET status = 'processing', failure_message = NULL, updated_at = ?1
       WHERE id = ?2 AND status IN ('open', 'failed') AND expires_at > ?1`
    ).bind(now, request.id).run();
    if (!Number(claim?.meta?.changes || 0)) {
      return json({ ok: false, error: { code: 'PAYMENT_NOT_AVAILABLE', message: 'This payment cannot be processed right now.' } }, 409);
    }
    request = { ...request, status: 'processing', updated_at: now };

    try {
      const customer = {
        id: request.customer_id,
        name: request.customer_name,
        email: request.customer_email,
        phone: request.customer_phone
      };
      const squareCustomerId = await ensureSquareCustomer(context.env, customer);
      const payment = await createSquarePayment(context.env, {
        sourceId,
        amountCents: request.amount_cents,
        idempotencyKey: `${request.id}-${now}`.slice(0, 45),
        squareCustomerId,
        referenceId: request.id,
        note: `${paymentPurposeLabel(request.purpose)} · ${request.booking_number}`
      });
      if (payment.status !== 'COMPLETED') {
        throw Object.assign(new Error('SQUARE_API_ERROR'), { squareMessage: `Square returned payment status ${payment.status || 'unknown'}.` });
      }

      const cardSummary = squareCardSummary(payment);
      const actualMethod = String(cardSummary.cardType || '').toUpperCase() === 'CREDIT'
        ? 'credit_card'
        : String(cardSummary.cardType || '').toUpperCase() === 'DEBIT'
          ? 'debit_card'
          : 'unknown';
      const expectedMethod = request.expected_method;
      const methodMismatch = expectedMethod !== 'unspecified'
        && actualMethod !== 'unknown'
        && expectedMethod !== actualMethod;

      let savedCard = null;
      let cardSaveWarning = '';
      if (Number(request.require_card_on_file) === 1 && actualMethod === 'credit_card' && cardOnFileConsent) {
        try {
          savedCard = await saveSquareCardFromPayment(context.env, {
            paymentId: payment.id,
            squareCustomerId,
            customerId: request.customer_id,
            cardholderName,
            idempotencyKey: `card-${request.id}-${now}`
          });
        } catch (cardError) {
          console.error('Square card-on-file save failed after completed payment', cardError);
          cardSaveWarning = 'Payment succeeded, but the card could not be saved on file. Regal Rentals will contact you before equipment release.';
        }
      }

      await recordCompletedPayment(context.env, {
        bookingId: request.booking_id,
        paymentRequestId: request.id,
        provider: 'square',
        purpose: request.purpose,
        amountCents: Number(request.amount_cents),
        appliesToRental: Number(request.applies_to_rental) === 1,
        squarePaymentId: payment.id,
        squareReceiptUrl: cardSummary.receiptUrl,
        squareCardId: savedCard?.id || null,
        cardBrand: cardSummary.cardBrand,
        cardLast4: cardSummary.last4,
        cardType: cardSummary.cardType,
        expectedMethod,
        methodMismatch,
        note: cardSaveWarning || null,
        paidAt: Math.floor(new Date(payment.created_at || Date.now()).getTime() / 1000)
      });

      const depositStillRequired = actualMethod === 'debit_card' && request.purpose !== 'security_deposit';
      return json({
        ok: true,
        payment: {
          amountCents: Number(request.amount_cents),
          purposeLabel: paymentPurposeLabel(request.purpose),
          receiptUrl: cardSummary.receiptUrl,
          cardBrand: cardSummary.cardBrand,
          cardLast4: cardSummary.last4,
          cardType: cardSummary.cardType,
          actualMethod,
          expectedMethod,
          methodMismatch,
          cardOnFileSaved: Boolean(savedCard?.id),
          cardSaveWarning,
          depositStillRequired
        }
      }, 201);
    } catch (error) {
      await context.env.DB.prepare(
        `UPDATE payment_requests SET status = 'failed', failure_message = ?1, updated_at = unixepoch()
         WHERE id = ?2 AND status = 'processing'`
      ).bind(cleanText(error.squareMessage || 'Card payment failed.', 500), request.id).run();
      throw error;
    }
  } catch (error) {
    return publicError(error);
  }
}
