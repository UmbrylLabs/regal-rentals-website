export const DEFAULT_BUFFER_BEFORE_MINUTES = 4 * 60;
export const DEFAULT_BUFFER_AFTER_MINUTES = 12 * 60;
export const DEFAULT_HOLD_SECONDS = 24 * 60 * 60;

function normalizeBuffer(value, fallback) {
  const minutes = value === undefined || value === null || value === ''
    ? fallback
    : Number(value);
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440) {
    throw new Error('INVALID_BUFFER');
  }
  return Math.round(minutes);
}

export function inventoryBlockWindow(
  eventStartAt,
  eventEndAt,
  bufferBeforeMinutes = DEFAULT_BUFFER_BEFORE_MINUTES,
  bufferAfterMinutes = DEFAULT_BUFFER_AFTER_MINUTES
) {
  const eventStart = Number(eventStartAt);
  const eventEnd = Number(eventEndAt);
  if (!Number.isInteger(eventStart) || !Number.isInteger(eventEnd) || eventEnd <= eventStart) {
    throw new Error('INVALID_TIME_WINDOW');
  }

  const beforeMinutes = normalizeBuffer(bufferBeforeMinutes, DEFAULT_BUFFER_BEFORE_MINUTES);
  const afterMinutes = normalizeBuffer(bufferAfterMinutes, DEFAULT_BUFFER_AFTER_MINUTES);
  return {
    eventStartAt: eventStart,
    eventEndAt: eventEnd,
    blockStartAt: eventStart - beforeMinutes * 60,
    blockEndAt: eventEnd + afterMinutes * 60,
    bufferBeforeMinutes: beforeMinutes,
    bufferAfterMinutes: afterMinutes
  };
}

export function publicInventoryPolicy() {
  return {
    bufferBeforeMinutes: DEFAULT_BUFFER_BEFORE_MINUTES,
    bufferAfterMinutes: DEFAULT_BUFFER_AFTER_MINUTES,
    holdSeconds: DEFAULT_HOLD_SECONDS
  };
}
