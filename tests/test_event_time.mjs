import assert from 'node:assert/strict';

await import('../event-time.js');

const { pacificEpoch, timeZone } = globalThis.RegalEventTime;
assert.equal(timeZone, 'America/Los_Angeles');
assert.equal(
  pacificEpoch('2026-08-31', '14:00'),
  Math.floor(Date.UTC(2026, 7, 31, 21, 0, 0) / 1000),
  'Summer event times use Pacific Daylight Time'
);
assert.equal(
  pacificEpoch('2026-12-15', '14:00'),
  Math.floor(Date.UTC(2026, 11, 15, 22, 0, 0) / 1000),
  'Winter event times use Pacific Standard Time'
);
assert.equal(pacificEpoch('2026-03-08', '02:30'), null, 'Nonexistent DST times are rejected');
assert.equal(pacificEpoch('', ''), null);

console.log('Pacific event-time tests passed.');
