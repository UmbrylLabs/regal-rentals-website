import { protectMutation, requireAdmin } from '../../_lib/auth.js';
import { json, readJson, safeErrorResponse } from '../../_lib/http.js';
import { ensureInquiryTables, INQUIRY_STATUSES } from '../../_lib/inquiries.js';

export async function onRequestGet(context) {
  try {
    await requireAdmin(context.env, context.request);
    await ensureInquiryTables(context.env.DB);
    const rows = await context.env.DB.prepare(
      'SELECT id,reference,name,email,phone,event_date,event_city,package_name,items_json,details,status,email_sent,created_at,updated_at ' +
      'FROM website_inquiries ORDER BY created_at DESC LIMIT 250'
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
