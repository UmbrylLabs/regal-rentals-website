import { protectMutation, requireAdmin } from '../../_lib/auth.js';
import { cleanText, json, readJson, safeErrorResponse } from '../../_lib/http.js';
export async function onRequestGet(context) {
  try {
    await requireAdmin(context.env, context.request);
    const url = new URL(context.request.url);
    const offset = Math.max(0, Math.min(1000000, Number(url.searchParams.get('offset')) || 0));
    const status = url.searchParams.get('status') || 'new';
    const rows = await context.env.DB.prepare('SELECT * FROM inquiries WHERE status=?1 ORDER BY created_at DESC,id LIMIT 50 OFFSET ?2').bind(status, offset).all();
    const count = await context.env.DB.prepare('SELECT COUNT(*) AS total FROM inquiries WHERE status=?1').bind(status).first();
    return json({ ok: true, inquiries: rows.results || [], total: count.total });
  } catch (error) { return safeErrorResponse(error); }
}
export async function onRequestPatch(context) {
  try {
    protectMutation(context.request); await requireAdmin(context.env, context.request);
    const body = await readJson(context.request);
    if (!['new','reviewed','closed'].includes(body.status)) throw new Error('INVALID_INQUIRY');
    await context.env.DB.prepare('UPDATE inquiries SET status=?1 WHERE id=?2').bind(body.status, cleanText(body.id, 100)).run();
    return json({ ok: true });
  } catch (error) { return safeErrorResponse(error); }
}
