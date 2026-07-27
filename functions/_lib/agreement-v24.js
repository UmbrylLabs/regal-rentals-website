import { buildModularAgreementHtml, determineAgreementModules } from './agreement-v23.js';
import { cleanText, normalizeEmail, sha256 } from './http.js';

const AGREEMENT_VERSION = '2.5';
const MANUAL_REVIEW_SUBTOTAL_CENTS = 150000;

const money = (cents) => (Number(cents) / 100).toLocaleString('en-US', {
  style: 'currency',
  currency: 'USD'
});

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

export function calculateSecurityDeposit(booking) {
  const items = Array.isArray(booking?.items) ? booking.items : [];
  const subtotalCents = Math.max(0, Math.round(Number(booking?.subtotal_cents || 0)));
  const amountCents = Math.round(subtotalCents / 2);
  const hasUnpricedItems = items.some((item) => item.unit_price_cents == null);
  return {
    amountCents,
    hasUnpricedItems,
    requiresManualReview: subtotalCents > MANUAL_REVIEW_SUBTOTAL_CENTS || hasUnpricedItems
  };
}

function paymentSecurityTerms(deposit) {
  const manualReview = deposit.requiresManualReview
    ? '<p class="agreement-note"><strong>Staff review:</strong> Because this booking exceeds $1,500 or contains an item without final pricing, Regal Rentals must review final pricing and payment completion before equipment release. Any required debit-card or cash deposit remains exactly 50% of the final confirmed rental subtotal.</p>'
    : '';
  return `<section class="payment-security-terms" data-payment-security-options="payment-method">
    <h2>Payment Method and Security Requirement</h2>
    <p>Before signing, Customer must identify the method that will be used to pay the rental balance. The payment method determines the required payment security and becomes part of the signed agreement.</p>
    <div class="payment-security-terms-grid">
      <div><h3>Credit Card</h3><p>No refundable security deposit is required. The same valid credit card used for payment must be securely saved on file before equipment release. Customer authorizes documented additional charges permitted by this Agreement and Schedule A, including damage, theft, missing items, excessive cleaning, late return, and retrieval charges.</p></div>
      <div><h3>Debit Card or Cash</h3><p>A refundable security deposit of ${escapeHtml(money(deposit.amountCents))}, equal to exactly 50% of the confirmed rental subtotal, is required before equipment release. The deposit may be applied to documented amounts due and does not limit Customer responsibility. Regal Rentals will initiate return of any remaining balance within three business days after return and inspection; the customer’s bank may take additional time to post a debit-card refund.</p></div>
    </div>
    <p>The deposit has no minimum or maximum and is calculated as exactly 50% of the final confirmed rental subtotal, rounded to the nearest cent only when necessary. If the confirmed subtotal changes, the deposit changes to remain 50% of that subtotal. A stored credit card or refundable deposit is payment security, not a damage waiver.</p>
    <p>Choosing a payment method in the signing form records the contractual selection. It does not itself store a card or collect funds; payment and the applicable security requirement must also be completed through Regal Rentals’ secure payment process.</p>
    ${manualReview}
  </section>`;
}

export function buildCustomerChoiceAgreementHtml(booking) {
  const deposit = calculateSecurityDeposit(booking);
  let html = buildModularAgreementHtml(booking, {});

  html = html
    .replace('data-agreement-version="2.3"', `data-agreement-version="${AGREEMENT_VERSION}" data-customer-security-choice="required" data-security-deposit-cents="${deposit.amountCents}" data-security-manual-review="${deposit.requiresManualReview ? 'true' : 'false'}"`)
    .replace('Customer Use Version 2.3', `Customer Use Version ${AGREEMENT_VERSION}`)
    .replace('<dd>Version 2.3</dd>', `<dd>Version ${AGREEMENT_VERSION}</dd>`)
    .replace('Version 2.3 · Generated specifically for', `Version ${AGREEMENT_VERSION} · Generated specifically for`)
    .replace('No equipment will be released until the Agreement is accepted and the payment-security method designated by Regal Rentals is completed.', 'No equipment will be released until the Agreement is accepted and the payment requirement associated with Customer’s selected payment method is completed.')
    .replace('Regal Rentals will designate card on file or security deposit before equipment release', `Credit card payment requires a valid card securely saved on file with no deposit; debit-card or cash payment requires a refundable deposit of ${money(deposit.amountCents)}`)
    .replace('Regal Rentals will designate either CARD ON FILE or SECURITY DEPOSIT before equipment release. This is selected by Regal Rentals, not the customer.', `Customer must select the intended payment method before signing. CREDIT CARD payment requires the same valid credit card to be securely saved on file and does not require a refundable deposit. DEBIT CARD or CASH payment requires a refundable security deposit of ${money(deposit.amountCents)}, equal to 50% of the confirmed rental subtotal.`)
    .replace('If CARD ON FILE is designated, Customer authorizes scheduled charges and documented additional charges permitted by this Agreement and Schedule A. If SECURITY DEPOSIT is designated, Regal Rentals may apply it to documented amounts due and invoice any remaining balance.', 'If Customer selects CREDIT CARD, Customer authorizes scheduled charges and documented additional charges permitted by this Agreement and Schedule A, and the same valid credit card must be securely saved on file. If Customer selects DEBIT CARD or CASH, Customer must pay the refundable security deposit shown in the Booking Summary; Regal Rentals may apply it to documented amounts due and invoice any remaining balance.')
    .replace('understands Regal Rentals selects the payment-security method;', 'selected the intended payment method and understands the corresponding card-on-file or 50% refundable-deposit requirement;')
    .replace('</section><div class="included-modules">', `</section>${paymentSecurityTerms(deposit)}<div class="included-modules">`);

  return html;
}

async function loadBooking(db, bookingId) {
  const booking = await db.prepare(
    `SELECT b.*, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
     FROM bookings b JOIN customers c ON c.id = b.customer_id WHERE b.id = ?1`
  ).bind(bookingId).first();
  if (!booking) return null;
  const result = await db.prepare(
    `SELECT bi.product_id, bi.quantity, bi.unit_price_cents,
            p.name, p.sku, p.category, p.style, p.description
     FROM booking_items bi JOIN products p ON p.id = bi.product_id
     WHERE bi.booking_id = ?1 ORDER BY p.category, p.sort_order, p.name`
  ).bind(bookingId).all();
  booking.items = result.results || [];
  return booking;
}

export async function createCustomerChoiceSigningRequest(env, bookingId, user, input = {}) {
  const booking = await loadBooking(env.DB, bookingId);
  if (!booking) throw new Error('BOOKING_NOT_FOUND');

  const latest = await env.DB.prepare(
    'SELECT COALESCE(MAX(agreement_version), 0) AS version FROM signing_requests WHERE booking_id = ?1'
  ).bind(booking.id).first();
  const version = Number(latest?.version || 0) + 1;
  const signerName = cleanText(input.signerName || booking.customer_name, 150);
  const signerEmail = normalizeEmail(input.signerEmail || booking.customer_email);
  if (!signerName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signerEmail)) throw new Error('INVALID_SIGNER');

  const agreementHtml = buildCustomerChoiceAgreementHtml(booking);
  const agreementSha256 = await sha256(agreementHtml);
  const rawToken = crypto.getRandomValues(new Uint8Array(32));
  const token = Array.from(rawToken, (byte) => byte.toString(16).padStart(2, '0')).join('');
  const tokenHash = await sha256(token);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + Math.min(
    60 * 60 * 24 * 30,
    Math.max(60 * 60, Number(input.expiresInSeconds || 60 * 60 * 24 * 7))
  );

  await env.DB.prepare(
    `INSERT INTO signing_requests (
       token_hash, booking_id, signer_name, signer_email, agreement_version,
       agreement_html, agreement_sha256, expires_at, created_by, created_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
  ).bind(
    tokenHash, booking.id, signerName, signerEmail, version,
    agreementHtml, agreementSha256, expiresAt, user.id, now
  ).run();

  const deposit = calculateSecurityDeposit(booking);
  return {
    token,
    expiresAt,
    version,
    modules: determineAgreementModules(booking.items),
    securityDepositCents: deposit.amountCents,
    requiresManualReview: deposit.requiresManualReview,
    signingUrl: `${input.origin || ''}/sign.html?token=${encodeURIComponent(token)}`
  };
}
