import { protectMutation, requireAdmin } from '../../_lib/auth.js';
import { json, readJson, safeErrorResponse } from '../../_lib/http.js';
import { ensureInquiryTables, INQUIRY_STATUSES } from '../../_lib/inquiries.js';

export async function onRequestGet(context) {
  try {
    await requireAdmin(context.env, context.request);
    await ensureInquiryTables(context.env.DB);
    const rows = await context.env.DB.prepare(
      'SELECT wi.id,wi.reference,wi.name,wi.email,wi.phone,wi.event_date,wi.event_city,wi.package_name,wi.items_json,wi.details,wi.status,wi.email_sent,wi.created_at,wi.updated_at, ' +
      'b.id AS booking_id, b.status AS booking_status ' +
      'FROM website_inquiries wi LEFT JOIN bookings b ON b.booking_number = wi.reference ' +
      'ORDER BY wi.created_at DESC LIMIT 250'
    ).all();
    return json({ok:true,inquiries:(rows.results || []).map(row => ({
      ...row,
      items:(() => {try {return JSON.parse(row.items_json || '[]');} catch {return [];}})()
    }))});
  } catch(err) {
    return safeErrorResponse(err);
  }
}

export async function onRequestPatch(context) {
  try {
    protectMutation(context.request);
    await requireAdmin(context.env, context.request);
    const body = await readJson(context.request);
    const id = typeof body.id === 'string' ? body.id : '';
    const status = typeof body.status === 'string' ? body.status : '';
    if (!/^[a-z0-9-]{36}$/i.test(id) || !INQUIRY_STATUSES.includes(status)) {
      return json({ok:false,error:{code:'VALIDATION_ERROR',message:'Invalid inquiry status update.'}},400);
    }
    await ensureInquiryTables(context.env.DB);
    const updated = await context.env.DB.prepare(
      'UPDATE website_inquiries SET status=?1,updated_at=unixepoch() WHERE id=?2'
    ).bind(status,id).run();
    if (!updated.meta?.changes) return json({ok:false,error:{code:'NOT_FOUND',message:'Inquiry not found.'}},404);
    return json({ok:true});
  } catch(err) {
    return safeErrorResponse(err);
  }
}
