import assert from 'node:assert/strict';
import fs from 'node:fs';
import { regalReference } from '../functions/_lib/reference.js';

const id='A7F2B456-1111-4111-8111-333333333333';
assert.equal(regalReference(id, new Date('2026-12-11T21:42:00Z')),
  'RR-20261211-1342-A7F2',
  'December reference uses California standard time');
assert.equal(regalReference(id, new Date('2026-07-11T20:42:00Z')),
  'RR-20260711-1342-A7F2',
  'July reference uses California daylight time');
assert.equal(regalReference(id, new Date('2027-01-01T07:59:00Z')),
  'RR-20261231-2359-A7F2',
  'Creation date changes at Pacific midnight, not UTC midnight');
assert.equal(regalReference('B4E39999-1111-4111-8111-333333333333',
  new Date('2026-12-11T21:42:00Z')), 'RR-20261211-1342-B4E3',
  'Two records created the same minute have distinct suffixes');
assert.equal(regalReference(id, new Date('2026-01-02T08:00:00Z')),
  'RR-20260102-0000-A7F2',
  'Midnight uses 00:00 on a 24-hour clock');

assert.throws(()=>regalReference('not-an-id'),/INVALID_REFERENCE_ID/);
const bookingCode=fs.readFileSync(new URL('../functions/_lib/booking.js',import.meta.url),'utf8');
const quoteCode=fs.readFileSync(new URL('../functions/api/public/inquiry.js',import.meta.url),'utf8');
assert.match(bookingCode,/regalReference\(bookingId, new Date\(now \* 1000\)\)/,
 'Bookings use the same standard for customer-visible numbers');
assert.match(quoteCode,/const reference = regalReference\(id\)/,
 'Website quote inquiries use the same standard');
assert.doesNotMatch(bookingCode,/function bookingNumber\(\)/,
 'Old date plus random booking generator is no longer used');
console.log('Regal Rentals RR reference: timezone, 24-hour time, uniqueness and integration passed.');
