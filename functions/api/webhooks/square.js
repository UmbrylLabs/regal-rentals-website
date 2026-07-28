import { cleanText, json } from '../../_lib/http.js';
import { paymentPurposeLabel, recordCompletedPayment } from '../../_lib/payments.js';
import {
  ensureSquareCustomer,
  saveSquareCardFromPayment,
  squareCardSummary
} from '../../_lib/square.js';

function decodeBase64(value) {
  try {
    const binary = atob(String(value || ''));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return new Uint8Array();
  }
}

async function validSquareSignature(request, rawBody, env) {
  const signatureKey = String(env.SQUARE_WEBHOOK_SIGNATURE_KEY || '');
  const notificationUrl = String(env.SQUARE_WEBHOOK_NOTIFICATION_URL || request.url);
  const signature = decodeBase64(request.headers.get('x-square-hmacsha256-signature'));
  if (!signatureKey || !notificationUrl || !signature.length) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(signatureKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  return crypto.subtle.verify(
    'HMAC',
    key,
    signature,
    new TextEncoder().encode(notificationUrl + rawBody)
  );
}

async function markEventProcessed(db, eventId, eventType) {
  await db.prepare(
    `INSERT OR IGNORE INTO square_webhook_events (event_id, event_type, processed_at)
     VALUES (?1, ?2, unixepoch())`
  ).bind(eventId, eventType).run();
}

async function paymentRequestForWebhook(db, payment) {
  const referenceId = cleanText(payment?.reference_id, 100);
  if (referenceId) {
    const request = await db.prepare(
      `SELECT pr.*, b.booking_number, b.customer_id,
              c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
       FROM payment_requests pr
       JOIN bookings b ON b.id = pr.booking_id
       JOIN customers c ON c.id = b.customer_id
       WHERE pr.id = ?1`
    ).bind(referenceId).first();
    if (request) return request;
  }
  if (payment?.id) {
    return db.prepare(
      `SELECT pr.*, b.booking_number, b.customer_id,
              c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
       FROM payment_requests pr
       JOIN bookings b ON b.id = pr.booking_id
       JOIN customers c ON c.id = b.customer_id
       WHERE pr.square_payment_id = ?1`
    ).bind(payment.id).first();
  }
  return null;
}

async function reconcileCompletedPayment(env, request, payment) {
  const existing = await env.DB.prepare(
    'SELECT id FROM booking_payments WHERE square_payment_id = ?1'
  ).bind(payment.id).first();
  if (existing) {
    await env.DB.prepare(
      `UPDATE payment_requests SET status = 'paid', square_payment_id = ?1,
              paid_at = COALESCE(paid_at, unixepoch()), failure_message = NULL, updated_at = unixepoch()
       WHERE id = ?2`
    ).bind(payment.id, request.id).run();
    return;
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
  let note = '';
  if (
    Number(request.require_card_on_file) === 1
    && request.card_consent_at
    && actualMethod === 'credit_card'
  ) {
    try {
      const squareCustomerId = await ensureSquareCustomer(env, {
        id: request.customer_id,
        name: request.customer_name,
        email: request.customer_email,
        phone: request.customer_phone
      });
      savedCard = await saveSquareCardFromPayment(env, {
        paymentId: payment.id,
        squareCustomerId,
        customerId: request.customer_id,
        cardholderName: request.cardholder_name || request.customer_name,
        idempotencyKey: `webhook-card-${request.id}`
      });
    } catch (error) {
      console.error('Square webhook card save failed', error);
      note = 'Payment completed, but automatic card-on-file storage needs staff review.';
    }
  }

  await recordCompletedPayment(env, {
    bookingId: request.booking_id,
    paymentRequestId: request.id,
    provider: 'square',
    purpose: request.purpose,
    amountCents: Number(payment?.amount_money?.amount || request.amount_cents),
    appliesToRental: Number(request.applies_to_rental) === 1,
    squarePaymentId: payment.id,
    squareReceiptUrl: cardSummary.receiptUrl,
    squareCardId: savedCard?.id || null,
    cardBrand: cardSummary.cardBrand,
    cardLast4: cardSummary.last4,
    cardType: cardSummary.cardType,
    expectedMethod,
    methodMismatch,
    note,
    paidAt: Math.floor(new Date(payment.created_at || Date.now()).getTime() / 1000)
  });
}

export async function onRequestPost(context) {
  const rawBody = await context.request.text();
  if (!await validSquareSignature(context.request, rawBody, context.env)) {
    return json({ ok: false, error: { code: 'INVALID_SIGNATURE', message: 'Invalid webhook signature.' } }, 403);
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, error: { code: 'INVALID_JSON', message: 'Invalid webhook body.' } }, 400);
  }

  const eventId = cleanText(event?.event_id, 200);
  const eventType = cleanText(event?.type, 100);
  if (!eventId || !eventType) return json({ ok: true });

  const duplicate = await context.env.DB.prepare(
    'SELECT event_id FROM square_webhook_events WHERE event_id = ?1'
  ).bind(eventId).first();
  if (duplicate) return json({ ok: true, duplicate: true });

  try {
    if (['payment.created', 'payment.updated'].includes(eventType)) {
      const payment = event?.data?.object?.payment;
      const request = await paymentRequestForWebhook(context.env.DB, payment);
      if (request && payment?.status === 'COMPLETED') {
        await reconcileCompletedPayment(context.env, request, payment);
      } else if (request && ['FAILED', 'CANCELED'].includes(payment?.status)) {
        await context.env.DB.prepare(
          `UPDATE payment_requests SET status = 'failed', failure_message = ?1, updated_at = unixepoch()
           WHERE id = ?2 AND status <> 'paid'`
        ).bind(`Square payment ${String(payment.status).toLowerCase()}.`, request.id).run();
      }
    }
    await markEventProcessed(context.env.DB, eventId, eventType);
    return json({ ok: true });
  } catch (error) {
    console.error(`Square webhook processing failed for ${paymentPurposeLabel(eventType)}`, error);
    return json({ ok: false, error: { code: 'WEBHOOK_PROCESSING_FAILED', message: 'Webhook processing failed.' } }, 500);
  }
}
