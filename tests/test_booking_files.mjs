import assert from 'node:assert/strict';
import {
  bookingFileKey,
  bookingFilePrefix,
  normalizeBookingFileCategory,
  sanitizeBookingFilename,
  validateBookingFile
} from '../functions/_lib/booking-files.js';

assert.equal(normalizeBookingFileCategory(' Delivery '), 'delivery');
assert.equal(normalizeBookingFileCategory('pickup'), 'pickup');
assert.throws(() => normalizeBookingFileCategory('public'), /INVALID_FILE_CATEGORY/);

assert.equal(sanitizeBookingFilename('../../Drop Off Photo 1.jpg'), 'Drop-Off-Photo-1.jpg');
assert.equal(sanitizeBookingFilename(''), 'booking-file');
assert.equal(bookingFilePrefix('booking_123'), 'bookings/booking_123/');
assert.equal(
  bookingFileKey('booking_123', 'damage', 'file-456', 'chair / damage.jpg'),
  'bookings/booking_123/damage/file-456-chair-damage.jpg'
);
assert.throws(() => bookingFilePrefix('../booking'), /INVALID_BOOKING_ID/);

const validImage = {
  type: 'image/jpeg',
  size: 250_000,
  arrayBuffer: async () => new ArrayBuffer(0)
};
assert.deepEqual(validateBookingFile(validImage), { type: 'image/jpeg', size: 250_000 });
assert.deepEqual(
  validateBookingFile({ ...validImage, type: 'application/pdf' }),
  { type: 'application/pdf', size: 250_000 }
);
assert.throws(
  () => validateBookingFile({ ...validImage, type: 'text/html' }),
  /UNSUPPORTED_FILE_TYPE/
);
assert.throws(
  () => validateBookingFile({ ...validImage, size: 16 * 1024 * 1024 }),
  /FILE_TOO_LARGE/
);

console.log('Booking file validation tests passed.');
