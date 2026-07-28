import { cleanText } from './http.js';

export const SQUARE_API_VERSION = '2026-07-15';

export function squareEnvironment(env) {
  return String(env.SQUARE_ENVIRONMENT || 'sandbox').toLowerCase() === 'production'
    ? 'production'
    : 'sandbox';
}

export function squareConfigured(env) {
  return Boolean(
    env.SQUARE_ACCESS_TOKEN
    && env.SQUARE_APPLICATION_ID
    && env.SQUARE_LOCATION_ID
  );
}

export function squarePublicConfig(env) {
  const environment = squareEnvironment(env);
  return {
    configured: squareConfigured(env),
    environment,
    applicationId: cleanText(env.SQUARE_APPLICATION_ID, 200),
    locationId: cleanText(env.SQUARE_LOCATION_ID, 200),
    sdkUrl: environment === 'production'
      ? 'https://web.squarecdn.com/v1/square.js'
      : 'https://sandbox.web.squarecdn.com/v1/square.js'
  };
}

function squareBaseUrl(env) {
  return squareEnvironment(env) === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com';
}

function squareErrorMessage(data) {
  const errors = Array.isArray(data?.errors) ? data.errors : [];
  return errors
    .map((error) => cleanText(error?.detail || error?.code || 'Square request failed.', 300))
    .filter(Boolean)
    .join(' ')
    || 'Square request failed.';
}

export async function squareRequest(env, path, options = {}) {
  if (!squareConfigured(env)) throw new Error('SQUARE_NOT_CONFIGURED');
  const response = await fetch(`${squareBaseUrl(env)}${path}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
      'Square-Version': SQUARE_API_VERSION,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers || {})
    },
    body: options.body == null ? undefined : JSON.stringify(options.body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error('SQUARE_API_ERROR');
    error.squareMessage = squareErrorMessage(data);
    error.squareErrors = data?.errors || [];
    error.status = response.status;
    throw error;
  }
  return data;
}

function splitCustomerName(value) {
  const parts = cleanText(value, 300).split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { givenName: parts[0] || 'Customer', familyName: '' };
  return { givenName: parts.slice(0, -1).join(' '), familyName: parts.at(-1) };
}

export async function ensureSquareCustomer(env, customer) {
  const existing = await env.DB.prepare(
    'SELECT square_customer_id FROM square_customers WHERE customer_id = ?1'
  ).bind(customer.id).first();
  if (existing?.square_customer_id) return existing.square_customer_id;

  const name = splitCustomerName(customer.name);
  const result = await squareRequest(env, '/v2/customers', {
    method: 'POST',
    body: {
      idempotency_key: `regal-customer-${customer.id}`.slice(0, 45),
      given_name: name.givenName,
      family_name: name.familyName || undefined,
      email_address: customer.email || undefined,
      phone_number: customer.phone || undefined,
      reference_id: customer.id,
      note: 'Regal Rentals customer created by booking payment system'
    }
  });
  const squareCustomerId = result?.customer?.id;
  if (!squareCustomerId) throw new Error('SQUARE_CUSTOMER_CREATE_FAILED');
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO square_customers (customer_id, square_customer_id, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?3)
     ON CONFLICT(customer_id) DO UPDATE SET square_customer_id = excluded.square_customer_id, updated_at = excluded.updated_at`
  ).bind(customer.id, squareCustomerId, now).run();
  return squareCustomerId;
}

export async function createSquarePayment(env, input) {
  const body = {
    source_id: input.sourceId,
    idempotency_key: input.idempotencyKey,
    amount_money: { amount: Number(input.amountCents), currency: 'USD' },
    autocomplete: true,
    customer_id: input.squareCustomerId || undefined,
    location_id: env.SQUARE_LOCATION_ID,
    reference_id: input.referenceId,
    note: cleanText(input.note, 500) || undefined,
    verification_token: input.verificationToken || undefined
  };
  const result = await squareRequest(env, '/v2/payments', { method: 'POST', body });
  if (!result?.payment?.id) throw new Error('SQUARE_PAYMENT_CREATE_FAILED');
  return result.payment;
}

export async function saveSquareCardFromPayment(env, input) {
  const result = await squareRequest(env, '/v2/cards', {
    method: 'POST',
    body: {
      idempotency_key: input.idempotencyKey.slice(0, 45),
      source_id: input.paymentId,
      verification_token: input.verificationToken || undefined,
      card: {
        customer_id: input.squareCustomerId,
        cardholder_name: cleanText(input.cardholderName, 300),
        reference_id: input.customerId
      }
    }
  });
  const card = result?.card;
  if (!card?.id) throw new Error('SQUARE_CARD_SAVE_FAILED');
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO square_cards (
       id, customer_id, square_customer_id, card_brand, last_4, card_type,
       exp_month, exp_year, enabled, created_at, updated_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9, ?9)
     ON CONFLICT(id) DO UPDATE SET
       card_brand = excluded.card_brand,
       last_4 = excluded.last_4,
       card_type = excluded.card_type,
       exp_month = excluded.exp_month,
       exp_year = excluded.exp_year,
       enabled = 1,
       updated_at = excluded.updated_at`
  ).bind(
    card.id,
    input.customerId,
    input.squareCustomerId,
    card.card_brand || null,
    card.last_4 || null,
    card.card_type || null,
    card.exp_month || null,
    card.exp_year || null,
    now
  ).run();
  return card;
}

export function squareCardSummary(payment) {
  const card = payment?.card_details?.card || {};
  return {
    cardBrand: card.card_brand || null,
    last4: card.last_4 || null,
    cardType: card.card_type || null,
    receiptUrl: payment?.receipt_url || null
  };
}
