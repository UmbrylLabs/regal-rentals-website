import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DEFAULT_BUFFER_AFTER_MINUTES,
  DEFAULT_BUFFER_BEFORE_MINUTES,
  DEFAULT_HOLD_SECONDS,
  inventoryBlockWindow,
  publicInventoryPolicy
} from '../functions/_lib/inventory-policy.js';

assert.equal(DEFAULT_BUFFER_BEFORE_MINUTES, 240);
assert.equal(DEFAULT_BUFFER_AFTER_MINUTES, 720);
assert.equal(DEFAULT_HOLD_SECONDS, 86400);

const eventStartAt = 2_000_000_000;
const eventEndAt = eventStartAt + 6 * 60 * 60;
assert.deepEqual(inventoryBlockWindow(eventStartAt, eventEndAt), {
  eventStartAt,
  eventEndAt,
  blockStartAt: eventStartAt - 4 * 60 * 60,
  blockEndAt: eventEndAt + 12 * 60 * 60,
  bufferBeforeMinutes: 240,
  bufferAfterMinutes: 720
});
assert.deepEqual(publicInventoryPolicy(), {
  bufferBeforeMinutes: 240,
  bufferAfterMinutes: 720,
  holdSeconds: 86400
});
assert.throws(() => inventoryBlockWindow(eventStartAt, eventEndAt, -1, 720), /INVALID_BUFFER/);

const [rentalsClient, publicQuote, bookingLibrary, publicAvailability] = await Promise.all([
  readFile(new URL('../rentals.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/api/public/quote.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/_lib/booking.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/api/public/availability.js', import.meta.url), 'utf8')
]);
assert.match(rentalsClient, /eventStartAt/);
assert.match(rentalsClient, /eventEndAt/);
assert.doesNotMatch(rentalsClient, /bufferBeforeMinutes:\s*120/);
assert.doesNotMatch(rentalsClient, /bufferAfterMinutes:\s*120/);
assert.match(publicQuote, /DEFAULT_BUFFER_BEFORE_MINUTES/);
assert.match(publicQuote, /DEFAULT_BUFFER_AFTER_MINUTES/);
assert.match(publicAvailability, /inventoryBlockWindow/);
assert.ok(
  bookingLibrary.indexOf('SELECT id, booking_number, status FROM bookings WHERE idempotency_key')
    < bookingLibrary.indexOf('const productMap = await loadProducts'),
  'Retries must resolve before the booking hold is counted against itself'
);

console.log('Inventory policy tests passed.');
