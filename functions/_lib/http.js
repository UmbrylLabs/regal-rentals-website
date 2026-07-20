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
