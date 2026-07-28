import { cleanText, randomId, randomToken, sha256 } from './http.js';

const PURPOSES = new Set(['reservation', 'balance', 'security_deposit', 'custom']);
const EXPECTED_METHODS = new Set(['credit_card', 'debit_card', 'unspecified']);

export const paymentPurposeLabel = (purpose) => ({
  reservation: 'Reservation payment',
  balance: 'Rental balance',
  security_deposit: 'Refundable security deposit',
  custom: 'Custom payment'
}[purpose] || 'Payment');

export function normalizePaymentPurpose(value) {
  const purpose = cleanText(value, 40).toLowerCase();
  if (!PURPOSES.has(purpose)) throw new Error('INVALID_PAYMENT_PURPOSE');
  return purpose;
}

export function normalizeExpectedMethod(value) {
  const method = cleanText(value || 'unspecified', 40).toLowerCase();
  if (!EXPECTED_METHODS.has(method)) throw new Error('INVALID_PAYMENT_METHOD');
  return method;
}

export function parseSignedPaymentMethod(consentText) {
  const match = String(consentText || '').match(/\[PAYMENT_SECURITY:(credit_card|debit_card|cash|card_on_file|security_deposit):(\d+)\]/);
  const raw = match?.[1] || null;
  const method = raw === 'card_on_file' ? 'credit_card'
    : raw === 'security_deposit' ? 'debit_card'
      : raw;
  return {
    method,
    depositCents: match ? Number(match[2]) : 0
  };
}

export async function latestSignedPaymentMethod(db, bookingId) {
  const row = await db.prepare(
    `SELECT s.consent_text
     FROM signatures s
     JOIN signing_requests sr ON sr.token_hash = s.signing_token_hash
     WHERE sr.booking_id = ?1 AND sr.signed_at IS NOT NULL AND sr.voided_at IS NULL
     ORDER BY sr.agreement_version DESC
     LIMIT 1`
  ).bind(bookingId).first();
  return parseSignedPaymentMethod(row?.consent_text);
}

export async function paymentSummary(db, bookingId, subtotalCents = null) {
  const totals = await db.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN status IN ('completed', 'partially_refunded') AND applies_to_rental = 1 THEN amount_cents ELSE 0 END), 0) AS rental_paid_cents,
       COALESCE(SUM(CASE WHEN status IN ('completed', 'partially_refunded') AND purpose = 'security_deposit' THEN amount_cents ELSE 0 END), 0) AS security_held_cents
     FROM booking_payments
     WHERE booking_id = ?1`
  ).bind(bookingId).first();
  const subtotal = Math.max(0, Number(subtotalCents || 0));
  const rentalPaid = Math.max(0, Number(totals?.rental_paid_cents || 0));
  return {
    subtotalCents: subtotal,
    rentalPaidCents: rentalPaid,
    rentalBalanceCents: Math.max(0, subtotal - rentalPaid),
    securityHeldCents: Math.max(0, Number(totals?.security_held_cents || 0))
  };
}

export async function loadBookingForPayment(db, bookingId) {
  return db.prepare(
    `SELECT
       b.id, b.booking_number, b.status, b.subtotal_cents, b.event_start_at, b.event_end_at,
       b.customer_id, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
     FROM bookings b
     JOIN customers c ON c.id = b.customer_id
     WHERE b.id = ?1`
  ).bind(bookingId).first();
}

function defaultPaymentAmount(purpose, booking, summary) {
  if (purpose === 'reservation') return Math.max(1, Math.round(Number(booking.subtotal_cents || 0) / 2));
  if (purpose === 'balance') return Math.max(1, Number(summary.rentalBalanceCents || 0));
  if (purpose === 'security_deposit') return Math.max(1, Math.round(Number(booking.subtotal_cents || 0) / 2));
  return 0;
}

export async function createPaymentRequest(env, bookingId, user, input = {}) {
  const booking = await loadBookingForPayment(env.DB, bookingId);
  if (!booking) throw new Error('BOOKING_NOT_FOUND');
  if (['cancelled', 'expired', 'completed'].includes(booking.status)) throw new Error('BOOKING_NOT_PAYABLE');

  const purpose = normalizePaymentPurpose(input.purpose || 'reservation');
  const summary = await paymentSummary(env.DB, booking.id, booking.subtotal_cents);
  const signed = await latestSignedPaymentMethod(env.DB, booking.id);
  const requestedMethod = cleanText(input.expectedMethod || 'auto', 40).toLowerCase();
  const expectedMethod = requestedMethod === 'auto'
    ? (['credit_card', 'debit_card'].includes(signed.method) ? signed.method : 'unspecified')
    : normalizeExpectedMethod(requestedMethod);
  const defaultAmount = defaultPaymentAmount(purpose, booking, summary);
  const amountCents = input.amountCents == null || input.amountCents === ''
    ? defaultAmount
    : Math.round(Number(input.amountCents));
  if (!Number.isInteger(amountCents) || amountCents < 1 || amountCents > 10_000_000) {
    throw new Error('INVALID_PAYMENT_AMOUNT');
  }
  if (purpose === 'balance' && summary.rentalBalanceCents < 1) throw new Error('NO_RENTAL_BALANCE');

  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const id = randomId();
  const now = Math.floor(Date.now() / 1000);
  const expiresDays = Math.min(30, Math.max(1, Number(input.expiresDays || 7)));
  const expiresAt = now + Math.round(expiresDays * 24 * 60 * 60);
  const appliesToRental = purpose !== 'security_deposit' && input.appliesToRental !== false;
  const requireCardOnFile = expectedMethod === 'credit_card';
  const description = cleanText(input.description, 500)
    || `${paymentPurposeLabel(purpose)} for ${booking.booking_number}`;

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO payment_requests (
         id, token_hash, booking_id, purpose, description, amount_cents, currency,
         expected_method, require_card_on_file, applies_to_rental, status,
         expires_at, created_by, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'USD', ?7, ?8, ?9, 'open', ?10, ?11, ?12, ?12)`
    ).bind(
      id, tokenHash, booking.id, purpose, description, amountCents,
      expectedMethod, requireCardOnFile ? 1 : 0, appliesToRental ? 1 : 0,
      expiresAt, user.id, now
    ),
    env.DB.prepare(
      `INSERT INTO audit_log (
         id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at
       ) VALUES (?1, ?2, 'payment.request_create', 'booking', ?3, ?4, ?5)`
    ).bind(
      randomId(), user.id, booking.id,
      JSON.stringify({ paymentRequestId: id, purpose, amountCents, expectedMethod, expiresAt }),
      now
    )
  ]);

  return {
    id,
    token,
    purpose,
    amountCents,
    expectedMethod,
    requireCardOnFile,
    expiresAt,
    paymentUrl: `${input.origin || ''}/pay.html?token=${encodeURIComponent(token)}`
  };
}

export async function listBookingPayments(db, bookingId) {
  const requests = await db.prepare(
    `SELECT id, purpose, description, amount_cents, expected_method, require_card_on_file,
            applies_to_rental, status, expires_at, square_payment_id, paid_at,
            failure_message, created_at
     FROM payment_requests
     WHERE booking_id = ?1
     ORDER BY created_at DESC`
  ).bind(bookingId).all();
  const payments = await db.prepare(
    `SELECT id, payment_request_id, provider, purpose, amount_cents, status,
            applies_to_rental, square_payment_id, square_receipt_url, square_card_id,
            card_brand, card_last_4, card_type, expected_method, method_mismatch,
            note, paid_at, created_at
     FROM booking_payments
     WHERE booking_id = ?1
     ORDER BY paid_at DESC, created_at DESC`
  ).bind(bookingId).all();
  return { requests: requests.results || [], payments: payments.results || [] };
}

export async function loadPaymentRequestByToken(db, rawToken) {
  const tokenHash = await sha256(rawToken);
  const request = await db.prepare(
    `SELECT
       pr.*,
       b.booking_number, b.status AS booking_status, b.subtotal_cents,
       b.event_start_at, b.event_end_at, b.customer_id,
       c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
     FROM payment_requests pr
     JOIN bookings b ON b.id = pr.booking_id
     JOIN customers c ON c.id = b.customer_id
     WHERE pr.token_hash = ?1`
  ).bind(tokenHash).first();
  return { tokenHash, request };
}

export async function expirePaymentRequestIfNeeded(db, request) {
  if (!request || request.status !== 'open') return request;
  const now = Math.floor(Date.now() / 1000);
  if (Number(request.expires_at) > now) return request;
  await db.prepare(
    `UPDATE payment_requests SET status = 'expired', updated_at = ?1
     WHERE id = ?2 AND status = 'open'`
  ).bind(now, request.id).run();
  return { ...request, status: 'expired' };
}

export async function recordCompletedPayment(env, input) {
  const now = Number(input.paidAt || Math.floor(Date.now() / 1000));
  const paymentId = randomId();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO booking_payments (
         id, booking_id, payment_request_id, provider, purpose, amount_cents, currency,
         status, applies_to_rental, square_payment_id, square_receipt_url, square_card_id,
         card_brand, card_last_4, card_type, expected_method, method_mismatch,
         note, received_by, paid_at, created_at, updated_at
       ) VALUES (
         ?1, ?2, ?3, ?4, ?5, ?6, 'USD',
         'completed', ?7, ?8, ?9, ?10,
         ?11, ?12, ?13, ?14, ?15,
         ?16, ?17, ?18, ?18, ?18
       )`
    ).bind(
      paymentId,
      input.bookingId,
      input.paymentRequestId || null,
      input.provider,
      input.purpose,
      input.amountCents,
      input.appliesToRental ? 1 : 0,
      input.squarePaymentId || null,
      input.squareReceiptUrl || null,
      input.squareCardId || null,
      input.cardBrand || null,
      input.cardLast4 || null,
      input.cardType || null,
      input.expectedMethod || null,
      input.methodMismatch ? 1 : 0,
      cleanText(input.note, 1000) || null,
      input.receivedBy || null,
      now
    ),
    ...(input.paymentRequestId ? [
      env.DB.prepare(
        `UPDATE payment_requests SET status = 'paid', square_payment_id = ?1,
                paid_at = ?2, failure_message = NULL, updated_at = ?2
         WHERE id = ?3`
      ).bind(input.squarePaymentId || null, now, input.paymentRequestId)
    ] : []),
    env.DB.prepare(
      `INSERT INTO audit_log (
         id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at
       ) VALUES (?1, ?2, 'payment.complete', 'booking', ?3, ?4, ?5)`
    ).bind(
      randomId(), input.receivedBy || null, input.bookingId,
      JSON.stringify({
        paymentId,
        paymentRequestId: input.paymentRequestId || null,
        provider: input.provider,
        purpose: input.purpose,
        amountCents: input.amountCents,
        squarePaymentId: input.squarePaymentId || null,
        cardType: input.cardType || null,
        methodMismatch: Boolean(input.methodMismatch)
      }),
      now
    )
  ]);
  await updateBookingPaymentStatus(env.DB, input.bookingId);
  return paymentId;
}

export async function updateBookingPaymentStatus(db, bookingId) {
  const booking = await db.prepare('SELECT status, subtotal_cents FROM bookings WHERE id = ?1').bind(bookingId).first();
  if (!booking || ['cancelled', 'expired', 'completed', 'ready', 'out', 'returned'].includes(booking.status)) return;
  const summary = await paymentSummary(db, bookingId, booking.subtotal_cents);
  const nextStatus = summary.rentalPaidCents >= Number(booking.subtotal_cents || 0) && Number(booking.subtotal_cents || 0) > 0
    ? 'paid'
    : summary.rentalPaidCents > 0 && ['inquiry', 'quote', 'hold'].includes(booking.status)
      ? 'confirmed'
      : null;
  if (!nextStatus || nextStatus === booking.status) return;
  await db.prepare(
    `UPDATE bookings SET status = ?1, updated_at = unixepoch() WHERE id = ?2`
  ).bind(nextStatus, bookingId).run();
}
