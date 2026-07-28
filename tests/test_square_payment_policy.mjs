import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalizeExpectedMethod,
  normalizePaymentPurpose,
  parseSignedPaymentMethod,
  paymentPurposeLabel
} from '../functions/_lib/payments.js';
import { squareEnvironment, squarePublicConfig } from '../functions/_lib/square.js';

assert.deepEqual(
  parseSignedPaymentMethod('Accepted. [PAYMENT_SECURITY:credit_card:0]'),
  { method: 'credit_card', depositCents: 0 }
);
assert.deepEqual(
  parseSignedPaymentMethod('Accepted. [PAYMENT_SECURITY:debit_card:12500]'),
  { method: 'debit_card', depositCents: 12500 }
);
assert.deepEqual(
  parseSignedPaymentMethod('Accepted. [PAYMENT_SECURITY:cash:12500]'),
  { method: 'cash', depositCents: 12500 }
);
assert.equal(normalizePaymentPurpose(' Reservation '), 'reservation');
assert.equal(normalizePaymentPurpose('security_deposit'), 'security_deposit');
assert.equal(normalizeExpectedMethod('credit_card'), 'credit_card');
assert.equal(paymentPurposeLabel('balance'), 'Rental balance');
assert.throws(() => normalizePaymentPurpose('chargeback'), /INVALID_PAYMENT_PURPOSE/);
assert.throws(() => normalizeExpectedMethod('cash'), /INVALID_PAYMENT_METHOD/);

assert.equal(squareEnvironment({ SQUARE_ENVIRONMENT: 'production' }), 'production');
assert.equal(squareEnvironment({ SQUARE_ENVIRONMENT: 'sandbox' }), 'sandbox');
assert.equal(squarePublicConfig({}).configured, false);
const sandboxConfig = squarePublicConfig({
  SQUARE_ENVIRONMENT: 'sandbox',
  SQUARE_ACCESS_TOKEN: 'secret',
  SQUARE_APPLICATION_ID: 'app',
  SQUARE_LOCATION_ID: 'location'
});
assert.equal(sandboxConfig.configured, true);
assert.match(sandboxConfig.sdkUrl, /sandbox\.web\.squarecdn\.com/);
assert.equal('accessToken' in sandboxConfig, false);

const migration = readFileSync(new URL('../migrations/0004_square_payments.sql', import.meta.url), 'utf8');
const squareLib = readFileSync(new URL('../functions/_lib/square.js', import.meta.url), 'utf8');
const paymentEndpoint = readFileSync(new URL('../functions/api/pay/[token].js', import.meta.url), 'utf8');
const webhook = readFileSync(new URL('../functions/api/webhooks/square.js', import.meta.url), 'utf8');
const recording = readFileSync(new URL('../functions/_lib/payment-recording.js', import.meta.url), 'utf8');

assert.match(migration, /CREATE TABLE IF NOT EXISTS payment_requests/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS booking_payments/);
assert.match(migration, /card_consent_at INTEGER/);
assert.match(migration, /square_payment_id TEXT UNIQUE/);
assert.doesNotMatch(migration, /card_number|security_code|\bcvv\b/i);
assert.match(squareLib, /\/v2\/payments/);
assert.match(squareLib, /\/v2\/cards/);
assert.match(squareLib, /Authorization: `Bearer \$\{env\.SQUARE_ACCESS_TOKEN\}`/);
assert.doesNotMatch(squareLib, /SQUARE_ACCESS_TOKEN.*squarePublicConfig[\s\S]*return.*SQUARE_ACCESS_TOKEN/i);
assert.match(paymentEndpoint, /cardOnFileConsent/);
assert.match(paymentEndpoint, /actualMethod === 'credit_card'/);
assert.match(paymentEndpoint, /depositStillRequired/);
assert.match(paymentEndpoint, /recordCompletedPaymentSafely/);
assert.match(webhook, /x-square-hmacsha256-signature/i);
assert.match(webhook, /notificationUrl \+ rawBody/);
assert.match(webhook, /recordCompletedPaymentSafely/);
assert.match(recording, /WHERE square_payment_id = \?1/);
assert.match(recording, /message\.includes\('unique'\)/);

console.log('Square payment policy and storage tests passed.');
