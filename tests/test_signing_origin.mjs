import assert from 'node:assert/strict';
import { resolvePublicSigningOrigin } from '../functions/_lib/signing-origin.js';

assert.equal(
  resolvePublicSigningOrigin('https://admin.regal.rentals/api/admin/bookings/booking-1/signing-link'),
  'https://regal.rentals'
);

assert.equal(
  resolvePublicSigningOrigin('https://preview.regal-rentals-website.pages.dev/api/admin/bookings/booking-1/signing-link'),
  'https://preview.regal-rentals-website.pages.dev'
);

assert.equal(
  resolvePublicSigningOrigin(
    'https://admin.regal.rentals/api/admin/bookings/booking-1/signing-link',
    'https://www.regal.rentals/sign.html'
  ),
  'https://www.regal.rentals'
);

assert.throws(
  () => resolvePublicSigningOrigin('https://admin.regal.rentals/example', 'javascript:alert(1)'),
  /INVALID_PUBLIC_SITE_ORIGIN/
);

console.log('Public signing origin tests passed.');
