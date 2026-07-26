import assert from 'node:assert/strict';
import {
  buildModularAgreementHtml,
  determineAgreementModules
} from '../functions/_lib/agreement-v23.js';

const booking = {
  id: 'booking-test',
  booking_number: 'RR-TEST-001',
  customer_name: 'Test Customer',
  customer_email: 'test@example.com',
  customer_phone: '555-555-0100',
  event_start_at: 1785531600,
  event_end_at: 1785553200,
  service_type: 'delivery',
  event_city: 'Cameron Park',
  event_address: 'Test Address',
  subtotal_cents: 25000,
  items: [
    { product_id: 'chairs', quantity: 40, unit_price_cents: 250, name: 'White Folding Chair', category: 'Tables & Chairs', style: 'chair', sku: 'CHAIR-WHITE', description: '' },
    { product_id: 'canopy', quantity: 1, unit_price_cents: 10000, name: '10x10 Pop-Up Canopy', category: 'Tents & Shade', style: 'canopy', sku: 'CANOPY-10', description: '' },
    { product_id: 'golf', quantity: 1, unit_price_cents: 5000, name: 'Portable Mini Golf', category: 'Mini Golf', style: 'mini-golf', sku: 'GOLF-9', description: '' }
  ]
};

const modules = determineAgreementModules(booking.items);
assert.deepEqual(modules, ['furnishings', 'canopy', 'games']);

const html = buildModularAgreementHtml(booking, {
  paymentSecurityMethod: 'security_deposit',
  securityDepositCents: 15000
});

assert.match(html, /data-agreement-version="2\.3"/);
assert.match(html, /data-agreement-module="furnishings"/);
assert.match(html, /data-agreement-module="canopy"/);
assert.match(html, /data-agreement-module="games"/);
assert.doesNotMatch(html, /data-agreement-module="photo"/);
assert.doesNotMatch(html, /data-agreement-module="av"/);
assert.doesNotMatch(html, /data-agreement-module="connectivity"/);
assert.match(html, /Security deposit — designated by Regal Rentals \(\$150\.00\)/);
assert.match(html, /does not authorize bounce houses or other inflatables/i);
assert.match(html, /Release of Liability for Ordinary Negligence/i);

const audioGuestbookModules = determineAgreementModules([
  { name: 'Rotary Audio Guestbook', category: 'Photo Booths & Guestbooks', style: 'photo-booth' }
]);
assert.deepEqual(audioGuestbookModules, ['photo', 'av']);
assert.ok(audioGuestbookModules.includes('photo'), 'Audio guestbooks require the recording/privacy terms.');
assert.ok(audioGuestbookModules.includes('av'), 'Powered audio guestbooks also require the electrical/A-V terms.');

console.log('Modular agreement tests passed.');
