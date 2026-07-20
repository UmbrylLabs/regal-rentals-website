import {
  cleanText,
  normalizeEmail,
  randomId,
  sha256
} from './http.js';

const VALID_STATUSES = new Set([
  'inquiry', 'quote', 'hold', 'confirmed', 'paid', 'ready',
  'out', 'returned', 'completed', 'cancelled', 'expired'
]);

export function validateEpochWindow(startAt, endAt) {
  const start = Number(startAt);
  const end = Number(endAt);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) {
    throw new Error('INVALID_TIME_WINDOW');
  }
  if (start < now - 3600) throw new Error('EVENT_IN_PAST');
  if (end - start > 60 * 60 * 24 * 7) throw new Error('EVENT_WINDOW_TOO_LONG');
  return { start, end };
}

export function normalizeItems(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
    throw new Error('INVALID_ITEMS');
  }
  const merged = new Map();
  for (const input of items) {
    const productId = cleanText(input?.productId, 80);
    const quantity = Number(input?.quantity);
    if (!productId || !/^[a-zA-Z0-9_-]+$/.test(productId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 1000) {
      throw new Error('INVALID_ITEMS');
    }
    merged.set(productId, (merged.get(productId) || 0) + quantity);
  }
  return Array.from(merged, ([productId, quantity]) => ({ productId, quantity }));
}

export function normalizeCustomer(input) {
  const name = cleanText(input?.name, 150);
  const email = normalizeEmail(input?.email);
  const phone = cleanText(input?.phone, 50);
  if (name.length < 2) throw new Error('INVALID_CUSTOMER_NAME');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error('INVALID_CUSTOMER_EMAIL');
  }
  if (phone.length < 7) throw new Error('INVALID_CUSTOMER_PHONE');
  return { name, email, phone };
}

export function normalizeStatus(value, fallback = 'inquiry') {
  const status = cleanText(value || fallback, 30).toLowerCase();
  if (!VALID_STATUSES.has(status)) throw new Error('INVALID_STATUS');
  return status;
}

export function isBlockingStatus(status, holdExpiresAt = null, now = Math.floor(Date.now() / 1000)) {
  if (['confirmed', 'paid', 'ready', 'out', 'returned'].includes(status)) return true;
  return status === 'hold' && (!holdExpiresAt || Number(holdExpiresAt) > now);
}

export async function loadProducts(db, items) {
  const ids = items.map((item) => item.productId);
  const placeholders = ids.map((_, index) => `?${index + 1}`).join(', ');
  const result = await db.prepare(
    `SELECT id, sku, name, category, style, description, price_unit,
            quantity_owned, price_cents, active, sort_order
     FROM products
     WHERE id IN (${placeholders})`
  ).bind(...ids).all();
  const map = new Map((result.results || []).map((row) => [row.id, row]));
  if (map.size !== ids.length) throw new Error('PRODUCT_UNAVAILABLE');
  for (const item of items) {
    const product = map.get(item.productId);
    if (!product?.active || item.quantity > Number(product.quantity_owned)) {
      throw new Error('PRODUCT_UNAVAILABLE');
    }
  }
  return map;
}

export async function getAvailability(db, blockStartAt, blockEndAt) {
  const start = Number(blockStartAt);
  const end = Number(blockEndAt);
  if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) {
    throw new Error('INVALID_TIME_WINDOW');
  }
  if (end < Math.floor(Date.now() / 1000) - 3600) throw new Error('EVENT_IN_PAST');
  if (end - start > 60 * 60 * 24 * 9) throw new Error('EVENT_WINDOW_TOO_LONG');
  const result = await db.prepare(
    `SELECT
       p.id,
       p.sku,
       p.name,
       p.category,
       p.style,
       p.description,
       p.price_unit,
       p.quantity_owned,
       p.price_cents,
       p.sort_order,
       MAX(
         0,
         p.quantity_owned - COALESCE(SUM(
           CASE WHEN b.id IS NOT NULL THEN bi.quantity ELSE 0 END
         ), 0)
       ) AS quantity_available
     FROM products p
     LEFT JOIN booking_items bi ON bi.product_id = p.id
     LEFT JOIN bookings b ON b.id = bi.booking_id
       AND b.block_start_at < ?2
       AND b.block_end_at > ?1
       AND (
         b.status IN ('confirmed', 'paid', 'ready', 'out', 'returned')
         OR (
           b.status = 'hold'
           AND (b.hold_expires_at IS NULL OR b.hold_expires_at > unixepoch())
         )
       )
     WHERE p.active = 1
     GROUP BY p.id
     ORDER BY p.category, p.sort_order, p.name`
  ).bind(start, end).all();
  return result.results || [];
}

function bookingNumber() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
  return `RR-${date}-${random}`;
}

export async function createBooking(env, request, input, actorUserId = null) {
  const customer = normalizeCustomer(input.customer);
  const items = normalizeItems(input.items);
  const status = normalizeStatus(input.status, 'inquiry');
  const { start: eventStart, end: eventEnd } = validateEpochWindow(
    input.eventStartAt,
    input.eventEndAt
  );

  const beforeMinutes = Math.min(1440, Math.max(0, Number(input.bufferBeforeMinutes ?? 120)));
  const afterMinutes = Math.min(1440, Math.max(0, Number(input.bufferAfterMinutes ?? 120)));
  if (!Number.isFinite(beforeMinutes) || !Number.isFinite(afterMinutes)) {
    throw new Error('INVALID_BUFFER');
  }
  const blockStart = eventStart - Math.round(beforeMinutes * 60);
  const blockEnd = eventEnd + Math.round(afterMinutes * 60);

  const serviceType = cleanText(input.serviceType, 20);
  if (!['delivery', 'pickup'].includes(serviceType)) throw new Error('INVALID_SERVICE_TYPE');
  const eventCity = cleanText(input.eventCity, 150);
  if (!eventCity) throw new Error('INVALID_EVENT_CITY');

  const productMap = await loadProducts(env.DB, items);
  const availability = await getAvailability(env.DB, blockStart, blockEnd);
  const availabilityMap = new Map(availability.map((row) => [row.id, Number(row.quantity_available)]));
  for (const item of items) {
    if (item.quantity > (availabilityMap.get(item.productId) ?? 0)) {
      throw new Error('INVENTORY_CONFLICT');
    }
  }

  const customerId = randomId();
  const bookingId = randomId();
  const number = bookingNumber();
  const now = Math.floor(Date.now() / 1000);
  const holdExpiresAt = status === 'hold'
    ? Number(input.holdExpiresAt || now + 30 * 60)
    : null;
  const idempotencyKey = cleanText(
    input.idempotencyKey || request.headers.get('Idempotency-Key') || '',
    200
  ) || null;

  if (idempotencyKey) {
    const existing = await env.DB.prepare(
      'SELECT id, booking_number, status FROM bookings WHERE idempotency_key = ?1'
    ).bind(idempotencyKey).first();
    if (existing) return { booking: existing, duplicate: true };
  }

  let subtotalCents = 0;
  for (const item of items) {
    const price = productMap.get(item.productId).price_cents;
    if (price !== null && price !== undefined) subtotalCents += Number(price) * item.quantity;
  }

  const statements = [
    env.DB.prepare(
      `INSERT INTO customers (
        id, name, email, phone, city, state, notes, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, 'CA', ?6, ?7, ?7)`
    ).bind(
      customerId,
      customer.name,
      customer.email,
      customer.phone,
      eventCity,
      cleanText(input.customer?.notes, 2000) || null,
      now
    ),
    env.DB.prepare(
      `INSERT INTO bookings (
        id, booking_number, idempotency_key, customer_id, status,
        event_start_at, event_end_at, block_start_at, block_end_at,
        hold_expires_at, service_type, event_city, event_address, notes,
        subtotal_cents, created_by, updated_by, created_at, updated_at
      ) VALUES (
        ?1, ?2, ?3, ?4, ?5,
        ?6, ?7, ?8, ?9,
        ?10, ?11, ?12, ?13, ?14,
        ?15, ?16, ?16, ?17, ?17
      )`
    ).bind(
      bookingId,
      number,
      idempotencyKey,
      customerId,
      status,
      eventStart,
      eventEnd,
      blockStart,
      blockEnd,
      holdExpiresAt,
      serviceType,
      eventCity,
      cleanText(input.eventAddress, 500) || null,
      cleanText(input.notes, 4000) || null,
      subtotalCents,
      actorUserId,
      now
    )
  ];

  for (const item of items) {
    const product = productMap.get(item.productId);
    statements.push(
      env.DB.prepare(
        `INSERT INTO booking_items (
          booking_id, product_id, quantity, unit_price_cents
        ) VALUES (?1, ?2, ?3, ?4)`
      ).bind(
        bookingId,
        item.productId,
        item.quantity,
        product.price_cents
      )
    );
  }

  statements.push(
    env.DB.prepare(
      `INSERT INTO booking_status_history (
        id, booking_id, old_status, new_status, changed_by, note, created_at
      ) VALUES (?1, ?2, NULL, ?3, ?4, 'Booking created', ?5)`
    ).bind(randomId(), bookingId, status, actorUserId, now)
  );

  statements.push(
    env.DB.prepare(
      `INSERT INTO audit_log (
        id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at
      ) VALUES (?1, ?2, 'booking.create', 'booking', ?3, ?4, ?5)`
    ).bind(
      randomId(),
      actorUserId,
      bookingId,
      JSON.stringify({ bookingNumber: number, status, items }),
      now
    )
  );

  await env.DB.batch(statements);
  return {
    booking: {
      id: bookingId,
      bookingNumber: number,
      status,
      subtotalCents,
      holdExpiresAt
    },
    duplicate: false
  };
}

export async function bookingDetail(db, id) {
  const booking = await db.prepare(
    `SELECT
       b.*,
       c.name AS customer_name,
       c.email AS customer_email,
       c.phone AS customer_phone
     FROM bookings b
     JOIN customers c ON c.id = b.customer_id
     WHERE b.id = ?1`
  ).bind(id).first();
  if (!booking) return null;

  const items = await db.prepare(
    `SELECT
       bi.product_id,
       bi.quantity,
       bi.unit_price_cents,
       p.name,
       p.sku,
       p.quantity_owned
     FROM booking_items bi
     JOIN products p ON p.id = bi.product_id
     WHERE bi.booking_id = ?1
     ORDER BY p.name`
  ).bind(id).all();

  const signing = await db.prepare(
    `SELECT agreement_version, signer_name, signer_email, expires_at, viewed_at, signed_at, voided_at
     FROM signing_requests
     WHERE booking_id = ?1
     ORDER BY agreement_version DESC`
  ).bind(id).all();

  return {
    ...booking,
    items: items.results || [],
    signingRequests: signing.results || []
  };
}

export async function createSigningRequest(env, booking, user, input = {}) {
  if (!booking) throw new Error('BOOKING_NOT_FOUND');
  const latest = await env.DB.prepare(
    'SELECT COALESCE(MAX(agreement_version), 0) AS version FROM signing_requests WHERE booking_id = ?1'
  ).bind(booking.id).first();
  const version = Number(latest?.version || 0) + 1;

  const signerName = cleanText(input.signerName || booking.customer_name, 150);
  const signerEmail = normalizeEmail(input.signerEmail || booking.customer_email);
  if (!signerName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signerEmail)) {
    throw new Error('INVALID_SIGNER');
  }

  const agreementHtml = buildAgreementHtml(booking, version);
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
    tokenHash,
    booking.id,
    signerName,
    signerEmail,
    version,
    agreementHtml,
    agreementSha256,
    expiresAt,
    user.id,
    now
  ).run();

  return {
    token,
    expiresAt,
    version,
    signingUrl: `${input.origin || ''}/sign.html?token=${encodeURIComponent(token)}`
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDateTime(epoch) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    dateStyle: 'long',
    timeStyle: 'short'
  }).format(new Date(Number(epoch) * 1000));
}

export function buildAgreementHtml(booking, version) {
  const items = (booking.items || []).map((item) => {
    const price = item.unit_price_cents == null
      ? 'Pricing to be confirmed'
      : `$${(Number(item.unit_price_cents) / 100).toFixed(2)} each`;
    return `<li>${escapeHtml(item.quantity)} × ${escapeHtml(item.name)} — ${escapeHtml(price)}</li>`;
  }).join('');

  return `
    <article class="agreement">
      <h1>Regal Rentals Rental Agreement &amp; Liability Waiver</h1>
      <p><strong>Agreement version:</strong> ${version}</p>
      <p><strong>Booking:</strong> ${escapeHtml(booking.booking_number)}</p>
      <p><strong>Customer:</strong> ${escapeHtml(booking.customer_name)}</p>
      <p><strong>Event window:</strong> ${escapeHtml(formatDateTime(booking.event_start_at))} through ${escapeHtml(formatDateTime(booking.event_end_at))}</p>
      <p><strong>Service:</strong> ${escapeHtml(booking.service_type)} in ${escapeHtml(booking.event_city)}</p>
      <h2>Rental items</h2>
      <ul>${items}</ul>
      <h2>Customer responsibilities</h2>
      <p>The customer accepts responsibility for the rented equipment from delivery or pickup until Regal Rentals confirms its return. The customer agrees to use the equipment safely, keep it protected from misuse and weather, and return all items in substantially the same condition, ordinary wear excepted.</p>
      <h2>Loss and damage</h2>
      <p>The customer is responsible for missing equipment and damage beyond ordinary wear, subject to the written terms and documented condition of the equipment.</p>
      <h2>Cancellation and reservation</h2>
      <p>A quote request alone does not reserve inventory. A reservation becomes confirmed only after Regal Rentals accepts the booking and receives the required signed agreement and reservation payment.</p>
      <h2>Liability acknowledgement</h2>
      <p>The customer acknowledges that event equipment can create risks if used improperly and agrees to follow all provided instructions, restrictions, and safety requirements.</p>
      <p class="agreement-note"><strong>Important:</strong> This software preserves the exact agreement shown and its signing evidence. The legal language should be reviewed by a California attorney before production use.</p>
    </article>
  `.trim();
}
