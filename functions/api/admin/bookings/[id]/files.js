import { protectMutation, requireAdmin } from '../../../../_lib/auth.js';
import {
  bookingFileCategoryLabel,
  bookingFileKey,
  bookingFilePrefix,
  normalizeBookingFileCategory,
  sanitizeBookingFilename,
  validateBookingFile
} from '../../../../_lib/booking-files.js';
import { cleanText, json, randomId, safeErrorResponse } from '../../../../_lib/http.js';

async function ensureBooking(db, id) {
  return db.prepare('SELECT id, booking_number FROM bookings WHERE id = ?1').bind(id).first();
}

async function listObjects(bucket, prefix) {
  const objects = [];
  let cursor;
  do {
    const page = await bucket.list({
      prefix,
      cursor,
      limit: 1000,
      include: ['httpMetadata', 'customMetadata']
    });
    objects.push(...(page.objects || []));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return objects;
}

function fileDto(bookingId, object) {
  const metadata = object.customMetadata || {};
  const contentType = object.httpMetadata?.contentType || metadata.contentType || 'application/octet-stream';
  return {
    id: metadata.fileId || '',
    category: metadata.category || 'other',
    categoryLabel: bookingFileCategoryLabel(metadata.category),
    originalName: metadata.originalName || object.key.split('/').pop() || 'Booking file',
    contentType,
    isImage: contentType.startsWith('image/'),
    sizeBytes: Number(object.size || 0),
    note: metadata.note || '',
    uploadedAt: Number(metadata.uploadedAt || 0),
    uploadedBy: metadata.uploadedBy || '',
    viewUrl: `/api/admin/bookings/${encodeURIComponent(bookingId)}/files/${encodeURIComponent(metadata.fileId || '')}`
  };
}

function fileErrorResponse(error) {
  const code = String(error?.message || '');
  const errors = {
    FILE_REQUIRED: ['Choose a photo or PDF to upload.', 400],
    INVALID_FILE_CATEGORY: ['Choose a valid document category.', 400],
    UNSUPPORTED_FILE_TYPE: ['Only photos and PDF files can be uploaded.', 415],
    FILE_TOO_LARGE: ['Files must be 15 MB or smaller.', 413],
    INVALID_BOOKING_ID: ['Booking not found.', 404]
  };
  if (errors[code]) return json({ ok: false, error: { code, message: errors[code][0] } }, errors[code][1]);
  return safeErrorResponse(error);
}

export async function onRequestGet(context) {
  try {
    await requireAdmin(context.env, context.request);
    const booking = await ensureBooking(context.env.DB, context.params.id);
    if (!booking) return json({ ok: false, error: { code: 'NOT_FOUND', message: 'Booking not found.' } }, 404);
    if (!context.env.BOOKING_FILES) {
      return json({ ok: true, configured: false, files: [] });
    }

    const objects = await listObjects(context.env.BOOKING_FILES, bookingFilePrefix(booking.id));
    const files = objects
      .map((object) => fileDto(booking.id, object))
      .filter((file) => file.id)
      .sort((left, right) => right.uploadedAt - left.uploadedAt);
    return json({ ok: true, configured: true, files });
  } catch (error) {
    return fileErrorResponse(error);
  }
}

export async function onRequestPost(context) {
  try {
    protectMutation(context.request);
    const user = await requireAdmin(context.env, context.request);
    const booking = await ensureBooking(context.env.DB, context.params.id);
    if (!booking) return json({ ok: false, error: { code: 'NOT_FOUND', message: 'Booking not found.' } }, 404);
    if (!context.env.BOOKING_FILES) {
      return json({
        ok: false,
        error: {
          code: 'FILE_STORAGE_NOT_CONFIGURED',
          message: 'Private photo storage is not configured yet.'
        }
      }, 503);
    }

    const form = await context.request.formData();
    const file = form.get('file');
    const category = normalizeBookingFileCategory(form.get('category'));
    const note = cleanText(form.get('note'), 500);
    const { type, size } = validateBookingFile(file);
    const fileId = randomId();
    const originalName = sanitizeBookingFilename(file.name);
    const uploadedAt = Math.floor(Date.now() / 1000);
    const key = bookingFileKey(booking.id, category, fileId, originalName);

    await context.env.BOOKING_FILES.put(key, await file.arrayBuffer(), {
      httpMetadata: {
        contentType: type,
        contentDisposition: `inline; filename="${originalName.replaceAll('"', '')}"`
      },
      customMetadata: {
        fileId,
        bookingId: booking.id,
        bookingNumber: booking.booking_number,
        category,
        originalName,
        contentType: type,
        note,
        uploadedBy: user.email || user.display_name || user.id,
        uploadedAt: String(uploadedAt)
      }
    });

    try {
      await context.env.DB.prepare(
        `INSERT INTO audit_log (
           id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at
         ) VALUES (?1, ?2, 'booking.file.upload', 'booking', ?3, ?4, ?5)`
      ).bind(
        randomId(),
        user.id,
        booking.id,
        JSON.stringify({ fileId, category, originalName, contentType: type, sizeBytes: size }),
        uploadedAt
      ).run();
    } catch (auditError) {
      console.error('Booking file audit entry failed', auditError);
    }

    return json({
      ok: true,
      configured: true,
      file: {
        id: fileId,
        category,
        categoryLabel: bookingFileCategoryLabel(category),
        originalName,
        contentType: type,
        isImage: type.startsWith('image/'),
        sizeBytes: size,
        note,
        uploadedAt,
        uploadedBy: user.email || user.display_name || user.id,
        viewUrl: `/api/admin/bookings/${encodeURIComponent(booking.id)}/files/${encodeURIComponent(fileId)}`
      }
    }, 201);
  } catch (error) {
    return fileErrorResponse(error);
  }
}
