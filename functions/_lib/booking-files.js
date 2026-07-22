const FILE_CATEGORIES = new Set(['delivery', 'pickup', 'damage', 'other']);
const MAX_FILE_BYTES = 15 * 1024 * 1024;

export function normalizeBookingFileCategory(value) {
  const category = String(value || '').trim().toLowerCase();
  if (!FILE_CATEGORIES.has(category)) throw new Error('INVALID_FILE_CATEGORY');
  return category;
}

export function sanitizeBookingFilename(value) {
  const fallback = 'booking-file';
  const cleaned = String(value || fallback)
    .normalize('NFKC')
    .replace(/[\\/\0\r\n\t]+/g, '-')
    .replace(/[^a-zA-Z0-9._ -]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 120);
  return cleaned || fallback;
}

export function validateBookingFile(file) {
  if (!file || typeof file.arrayBuffer !== 'function') throw new Error('FILE_REQUIRED');
  const type = String(file.type || '').toLowerCase();
  const allowed = type.startsWith('image/') || type === 'application/pdf';
  if (!allowed) throw new Error('UNSUPPORTED_FILE_TYPE');
  const size = Number(file.size || 0);
  if (!Number.isFinite(size) || size < 1) throw new Error('FILE_REQUIRED');
  if (size > MAX_FILE_BYTES) throw new Error('FILE_TOO_LARGE');
  return { type: type || 'application/octet-stream', size };
}

export function bookingFilePrefix(bookingId) {
  const id = String(bookingId || '').trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('INVALID_BOOKING_ID');
  return `bookings/${id}/`;
}

export function bookingFileKey(bookingId, category, fileId, originalName) {
  const safeCategory = normalizeBookingFileCategory(category);
  const safeFileId = String(fileId || '').trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(safeFileId)) throw new Error('INVALID_FILE_ID');
  return `${bookingFilePrefix(bookingId)}${safeCategory}/${safeFileId}-${sanitizeBookingFilename(originalName)}`;
}

export function bookingFileCategoryLabel(category) {
  return {
    delivery: 'Delivery / Drop-off',
    pickup: 'Pickup / Return',
    damage: 'Damage / Condition',
    other: 'Other'
  }[category] || 'Other';
}
