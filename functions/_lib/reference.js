// Customer-facing Regal Rentals reference numbers use the time the record
// was CREATED (not the event date), expressed in California local time.
// A short random UUID-derived suffix distinguishes requests within the same minute.
// Stable internal database UUIDs remain unchanged.
const CALIFORNIA = 'America/Los_Angeles';
const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CALIFORNIA,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});

export function regalReference(id, instant = new Date()) {
  const suffix = String(id ?? '').replace(/-/g, '').slice(0, 4).toUpperCase();
  if (!/^[A-F0-9]{4}$/.test(suffix)) throw new Error('INVALID_REFERENCE_ID');
  const parts = Object.fromEntries(
    formatter.formatToParts(instant).map(({ type, value }) => [type, value])
  );
  return `RR-${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}-${suffix}`;
}
