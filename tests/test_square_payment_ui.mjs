import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const payHtml = readFileSync(new URL('../pay.html', import.meta.url), 'utf8');
const payJs = readFileSync(new URL('../pay.js', import.meta.url), 'utf8');
const headers = readFileSync(new URL('../_headers', import.meta.url), 'utf8');
const adminHtml = readFileSync(new URL('../admin/index.html', import.meta.url), 'utf8');
const manager = readFileSync(new URL('../admin/payment-manager.js', import.meta.url), 'utf8');
const setup = readFileSync(new URL('../docs/SQUARE_PAYMENT_SETUP.md', import.meta.url), 'utf8');

assert.match(payHtml, /id="square-card-container"/);
assert.match(payHtml, /id="card-on-file-consent"/);
assert.match(payHtml, /Regal Rentals never receives or stores your complete card number/);
assert.match(payHtml, /Payments are processed securely by Square/);
assert.match(payJs, /window\.Square\.payments/);
assert.match(payJs, /paymentRequest\.requireCardOnFile \? 'CHARGE_AND_STORE' : 'CHARGE'/);
assert.match(payJs, /squareCard\.tokenize\(verificationDetails\)/);
assert.match(payJs, /cardOnFileConsent: consent\.checked/);
assert.match(payJs, /depositStillRequired/);
assert.doesNotMatch(payJs, /cardNumber|securityCode|\bcvv\b/i);

assert.match(adminHtml, /payment-manager\.css/);
assert.match(adminHtml, /payment-manager\.js/);
assert.match(manager, /Create Online Payment Link/);
assert.match(manager, /Record Cash Received/);
assert.match(manager, /50% reservation payment/);
assert.match(manager, /50% refundable security deposit/);
assert.match(manager, /state\.lastPaymentLink/);
assert.match(manager, /navigator\.clipboard\.writeText\(state\.lastPaymentLink\)/);

assert.match(headers, /script-src[^\n]*https:\/\/web\.squarecdn\.com[^\n]*https:\/\/sandbox\.web\.squarecdn\.com/);
assert.match(headers, /connect-src[^\n]*https:\/\/pci-connect\.squareup\.com[^\n]*https:\/\/pci-connect\.squareupsandbox\.com/);
assert.match(headers, /frame-src[^\n]*https:\/\/web\.squarecdn\.com[^\n]*https:\/\/sandbox\.web\.squarecdn\.com/);
assert.match(headers, /\/pay\.html[\s\S]*Cache-Control: no-store/);

assert.match(setup, /SQUARE_ACCESS_TOKEN/);
assert.match(setup, /SQUARE_WEBHOOK_SIGNATURE_KEY/);
assert.match(setup, /SQUARE_WEBHOOK_NOTIFICATION_URL=https:\/\/regal\.rentals\/api\/webhooks\/square/);
assert.match(setup, /npx wrangler d1 migrations apply regal-rentals --remote/);
assert.match(setup, /Never commit Square access tokens/);

console.log('Square payment customer and admin UI tests passed.');
