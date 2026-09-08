const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff'
};

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...headers }
  });
}

export function fail(message, status = 400, code = 'BAD_REQUEST', details = undefined) {
  return json({ ok: false, error: { code, message, details } }, status);
}

export async function readJson(request, maxBytes = 100_000) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > maxBytes) throw new Error('PAYLOAD_TOO_LARGE');
  const text = await request.text();
  if (text.length > maxBytes) throw new Error('PAYLOAD_TOO_LARGE');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('INVALID_JSON');
  }
}

export function getCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for') || '';
}

export function requestOriginMatches(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  return origin === new URL(request.url).origin;
}

export function assertSameOrigin(request) {
  if (!requestOriginMatches(request)) {
    const error = new Error('CROSS_SITE_REQUEST_BLOCKED');
    error.status = 403;
    throw error;
  }
}

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function cleanText(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

export function randomId() {
  return crypto.randomUUID();
}

export function randomToken(bytes = 32) {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return base64UrlEncode(buffer);
}

export function base64UrlEncode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlDecode(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function sha256(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function safeErrorResponse(error) {
  const message = String(error?.message || error || 'UNKNOWN_ERROR');
  const known = {
    IDEMPOTENCY_KEY_REQUIRED: ['Refresh this form before submitting.', 400],
    INVALID_IMAGE: ['Choose a JPEG, PNG, or WebP photograph.', 415],
    IMAGE_TOO_LARGE: ['The optimized photo must be 4 MB or smaller.', 413],
    INVALID_INQUIRY: ['Please review your name, email and event details.', 400],
    PUBLIC_RATE_LIMIT: ['Too many requests. Please try again in an hour or contact Regal Rentals.', 429],
    RELEASE_NOT_READY: ['Before marking ready or out, finalize pricing, obtain the current signed agreement, collect the rental balance and complete the card-on-file or security-deposit requirement. Review Payments & Security.', 409],
    IDEMPOTENCY_MISMATCH: ['This retry contains different payment details. Refresh the payment history first.', 409],
    EVENT_IN_PAST: ['Choose a future event date.', 400],
    INVALID_TIME_WINDOW: ['The return time must be after the start time.', 400],
    EVENT_WINDOW_TOO_LONG: ['Choose a rental period of seven days or less.', 400],
    PAYMENT_PROCESSING: ['A payment is being confirmed. Check its result before changing this booking.', 409],
    BOOKING_NOT_PAYABLE: ['This reservation is not open for payment. Contact Regal Rentals.', 409],
    STALE_BOOKING: ['This booking changed in another session. Refresh it before saving.', 409],
    AGREEMENT_NOT_CURRENT: ['This agreement is no longer current. Request a new signing link.', 410],
    BOOKING_RECORD_PROTECTED: ['This booking has payment or rental history and must be retained.', 409],
    PAYMENT_EXCEEDS_BALANCE: ['This payment is greater than the remaining rental balance.', 409],
    INVALID_REFUND_AMOUNT: ['Enter a valid refund amount and reason.', 400],
    INVALID_CHARGES: ['Review the quote charges. Discounts must be negative and the subtotal cannot be negative.', 400],
    REFUND_EXCEEDS_AVAILABLE: ['The refund exceeds the remaining refundable amount, including pending refunds.', 409],
    REFUND_REQUEST_CHANGED: ['This refund attempt has different details. Refresh the payment history.', 409],
    PAYMENT_NOT_REFUNDABLE: ['This payment is not available for refund.', 409],
    CASH_REFUND_CONFIRMATION_REQUIRED: ['Confirm the cash was returned to the customer.', 400],
    PAYMENT_ATTEMPT_NOT_FOUND: ['Payment attempt not found.', 404],
    PAYMENT_RECONCILIATION_MISMATCH: ['That Square payment does not match this booking payment request.', 409]
  };
  if (/CHECK constraint failed: revision/.test(message)) return fail(known.STALE_BOOKING[0], 409, 'STALE_BOOKING');
  for (const [code, [text, status]] of Object.entries(known)) {
    if (message.includes(code)) return fail(text, status, code);
  }
  if (message.includes('INVENTORY_CONFLICT')) {
    return fail(
      'That inventory was reserved by another booking. Refresh availability and choose a different quantity or time.',
      409,
      'INVENTORY_CONFLICT'
    );
  }
  if (message.includes('ACTIVE_RESERVATIONS_EXCEED_NEW_QUANTITY')) {
    return fail('Inventory cannot be reduced below active reservations.', 409, 'ACTIVE_RESERVATIONS');
  }
  if (message.includes('PRODUCT_UNAVAILABLE')) {
    return fail('One of the requested products is unavailable.', 409, 'PRODUCT_UNAVAILABLE');
  }
  if (message === 'PAYLOAD_TOO_LARGE') return fail('Request is too large.', 413, message);
  if (message === 'INVALID_JSON') return fail('Invalid JSON request.', 400, message);
  if (message === 'CROSS_SITE_REQUEST_BLOCKED') return fail('Cross-site request blocked.', 403, message);
  if (message === 'ACCESS_NOT_CONFIGURED') {
    return fail('Cloudflare Access is not fully configured for this deployment.', 503, message);
  }
  if (message === 'ACCESS_REQUIRED') {
    return fail('Open the admin dashboard through admin.regal.rentals and sign in with Cloudflare Access.', 401, message);
  }
  if (message === 'ACCESS_INVALID') {
    return fail('Cloudflare Access could not verify this session. Sign out and sign in again.', 403, message);
  }
  if (message === 'UNAUTHORIZED') return fail('Sign in required.', 401, message);
  if (message === 'FORBIDDEN') return fail('You do not have permission.', 403, message);
  console.error(error);
  return fail('The server could not complete the request.', 500, 'SERVER_ERROR');
}
