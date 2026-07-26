import assert from 'node:assert/strict';
import {
  buildCustomerChoiceAgreementHtml,
  calculateSecurityDeposit
} from '../functions/_lib/agreement-v24.js';

const booking = (subtotalCents, items) => ({
  booking_number: 'RR-TEST-SECURITY',
  customer_name: 'Test Customer',
  customer_email: 'test@example.com',
  customer_phone: '555-555-0100',
  event_start_at: 1785531600,
  event_end_at: 1785553200,
  service_type: 'delivery',
  event_city: 'Cameron Park',
  event_address: 'Test Address',
  subtotal_cents: subtotalCents,
  items
});

const tableItem = {
  product_id: 'table', quantity: 1, unit_price_cents: 10000,
  name: '6 Foot Folding Table', category: 'Tables & Chairs', style: 'rectangle-table',
  sku: 'TABLE-6', description: ''
};
const projectorItem = {
  product_id: 'projector', quantity: 1, unit_price_cents: 25000,
  name: 'Event Projector', category: 'Audio & Visual', style: 'visual',
  sku: 'PROJECTOR', description: ''
};

assert.equal(calculateSecurityDeposit(booking(10000, [tableItem])).amountCents, 15000);
assert.equal(calculateSecurityDeposit(booking(25000, [tableItem])).amountCents, 15000);
assert.equal(calculateSecurityDeposit(booking(40000, [tableItem])).amountCents, 20000);
assert.equal(calculateSecurityDeposit(booking(25000, [projectorItem])).amountCents, 30000);
assert.equal(calculateSecurityDeposit(booking(200000, [projectorItem])).amountCents, 75000);
assert.equal(calculateSecurityDeposit(booking(200000, [projectorItem])).requiresManualReview, true);

const agreement = buildCustomerChoiceAgreementHtml(booking(25000, [projectorItem]));
assert.match(agreement, /data-agreement-version="2\.4"/);
assert.match(agreement, /data-customer-security-choice="required"/);
assert.match(agreement, /data-security-deposit-cents="30000"/);
assert.match(agreement, /Payment Security Options — Customer Must Choose One/);
assert.match(agreement, /Card on File/);
assert.match(agreement, /Refundable Security Deposit — \$300\.00/);
assert.match(agreement, /50% of the known rental subtotal/);
assert.match(agreement, /does not limit Customer responsibility/);
assert.doesNotMatch(agreement, /selected by Regal Rentals, not the customer/i);

console.log('Customer payment-security tests passed.');
