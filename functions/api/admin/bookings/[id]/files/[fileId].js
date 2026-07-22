import { protectMutation, requireAdmin } from '../../../../../_lib/auth.js';
import { bookingFilePrefix } from '../../../../../_lib/booking-files.js';
import { json, randomId, safeErrorResponse } from '../../../../../_lib/http.js';

async function ensureBooking(db, id) {
  return db.prepare('SELECT id, booking_number FROM bookings WHERE id = ?1').bind(id).first();
}

async function findObject(bucket, bookingId, fileId) {
  let cursor;
  do {
    const page = await bucket.list({
      prefix: bookingFilePrefix(bookingId),
      cursor,
      limit: 1000,
      include: ['httpMetadata', 'customMetadata']
    });
    const match = (page.objects || []).find(
      (object) => object.customMetadata?.fileId === fileId
    );
    if (match) return match;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return null;
}

function notConfigured() {
  return json({
    ok: false,
    error: {
      code: 'FILE_STORAGE_NOT_CONFIGURED',
      message: 'Private photo storage is not configured yet.'
    }
  }, 503);
}

export async function onRequestGet(context) {
  try {
    await requireAdmin(context.env, context.request);
    const booking = await ensureBooking(context.env.DB, context.params.id);
    if (!booking) return new Response('Booking not found.', { status: 404 });
    if (!context.env.BOOKING_FILES) return notConfigured();

    const listed = await findObject(
      context.env.BOOKING_FILES,
      booking.id,
      String(context.params.fileId || '')
    );
    if (!listed) return new Response('File not found.', { status: 404 });

    const object = await context.env.BOOKING_FILES.get(listed.key);
    if (!object) return new Response('File not found.', { status: 404 });
    const metadata = object.customMetadata || listed.customMetadata || {};
    const contentType = object.httpMetadata?.contentType
      || listed.httpMetadata?.contentType
      || metadata.contentType
      || 'application/octet-stream';
    const originalName = String(metadata.originalName || 'booking-file').replaceAll('"', '');
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('Content-Type', contentType);
    headers.set('Content-Disposition', `inline; filename="${originalName}"`);
    headers.set('Cache-Control', 'private, no-store');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('ETag', object.httpEtag);
    return new Response(object.body, { headers });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function onRequestDelete(context) {
  try {
    protectMutation(context.request);
    const user = await requireAdmin(context.env, context.request);
    const booking = await ensureBooking(context.env.DB, context.params.id);
    if (!booking) return json({ ok: false, error: { code: 'NOT_FOUND', message: 'Booking not found.' } }, 404);
    if (!context.env.BOOKING_FILES) return notConfigured();

    const fileId = String(context.params.fileId || '');
    const listed = await findObject(context.env.BOOKING_FILES, booking.id, fileId);
    if (!listed) return json({ ok: false, error: { code: 'NOT_FOUND', message: 'File not found.' } }, 404);
    await context.env.BOOKING_FILES.delete(listed.key);

    try {
      await context.env.DB.prepare(
        `INSERT INTO audit_log (
           id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at
         ) VALUES (?1, ?2, 'booking.file.delete', 'booking', ?3, ?4, ?5)`
      ).bind(
        randomId(),
        user.id,
        booking.id,
        JSON.stringify({
          fileId,
          category: listed.customMetadata?.category || 'other',
          originalName: listed.customMetadata?.originalName || ''
        }),
        Math.floor(Date.now() / 1000)
      ).run();
    } catch (auditError) {
      console.error('Booking file deletion audit entry failed', auditError);
    }

    return json({ ok: true, deleted: true });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
