import { cleanText, json } from '../../_lib/http.js';
import { reconcileProcessorPayment } from '../../_lib/payment-processing.js';
import { reconcileSquareRefund } from '../../_lib/refunds.js';
import { squareRequest } from '../../_lib/square.js';

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

export async function paymentRequestForWebhook(db, payment) {
  if (!payment?.id) return { request: null, attempt: null };
  const attempt = await db.prepare(`SELECT * FROM payment_attempts
    WHERE id = ?1 OR square_payment_id = ?2 LIMIT 1`)
    .bind(cleanText(payment.reference_id, 100), payment.id).first();
  const request = await db.prepare(`SELECT pr.*, b.booking_number, b.customer_id,
      c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
    FROM payment_requests pr JOIN bookings b ON b.id = pr.booking_id
    JOIN customers c ON c.id = b.customer_id
    WHERE pr.id = ?1 OR pr.square_payment_id = ?2 LIMIT 1`)
    .bind(attempt?.payment_request_id || cleanText(payment.reference_id, 100), payment.id).first();
  return { request, attempt };
}

export async function onRequestPost(context) {
  const rawBody = await context.request.text();
  if (rawBody.length > 500_000) return json({ ok: false }, 413);
  if (!await validSquareSignature(context.request, rawBody, context.env)) {
    return json({ ok: false, error: { code: 'INVALID_SIGNATURE', message: 'Invalid webhook signature.' } }, 403);
  }
  let event;
  try { event = JSON.parse(rawBody); }
  catch { return json({ ok: false, error: { code: 'INVALID_JSON', message: 'Invalid webhook body.' } }, 400); }
  const eventId = cleanText(event?.event_id, 200);
  const eventType = cleanText(event?.type, 100);
  if (!eventId || !eventType) return json({ ok: true });
  const duplicate = await context.env.DB.prepare('SELECT event_id FROM square_webhook_events WHERE event_id = ?1')
    .bind(eventId).first();
  if (duplicate) return json({ ok: true, duplicate: true });
  try {
    if (['payment.created', 'payment.updated'].includes(eventType)) {
      const payment = event?.data?.object?.payment;
      const { request, attempt } = await paymentRequestForWebhook(context.env.DB, payment);
      if (request) await reconcileProcessorPayment(context.env, request, payment, attempt);
    } else if (['refund.created', 'refund.updated'].includes(eventType)) {
      const eventRefund = event?.data?.object?.refund;
      if (!eventRefund?.id) throw new Error('INVALID_REFUND_EVENT');
      // Query the current processor state so a late PENDING event cannot undo
      // a completed refund, and refunds arriving before payments can reconcile.
      const { refund } = await squareRequest(context.env, `/v2/refunds/${encodeURIComponent(eventRefund.id)}`);
      let result = await reconcileSquareRefund(context.env, refund);
      if (!result) {
        const { payment } = await squareRequest(context.env, `/v2/payments/${encodeURIComponent(refund.payment_id)}`);
        const { request, attempt } = await paymentRequestForWebhook(context.env.DB, payment);
        if (request) {
          await reconcileProcessorPayment(context.env, request, payment, attempt);
          result = await reconcileSquareRefund(context.env, refund);
          if (!result) throw new Error('REFUND_PAYMENT_NOT_RECORDED');
        }
      }
    }
    await markEventProcessed(context.env.DB, eventId, eventType);
    return json({ ok: true });
  } catch (error) {
    console.error('Square webhook processing failed', eventType, error?.message);
    return json({ ok: false, error: { code: 'WEBHOOK_PROCESSING_FAILED', message: 'Webhook processing failed.' } }, 500);
  }
}
