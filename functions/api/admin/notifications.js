import { protectMutation, requireAdmin } from '../../_lib/auth.js';
import { json, safeErrorResponse } from '../../_lib/http.js';
import { flushNotifications, notificationsConfigured } from '../../_lib/notifications.js';
export async function onRequestGet(context) {
  try {
    await requireAdmin(context.env, context.request);
    const rows = await context.env.DB.prepare(`SELECT id,recipient,subject,status,attempts,last_error,created_at,sent_at
      FROM notification_outbox ORDER BY CASE WHEN status='failed' THEN 0 WHEN status IN ('pending','sending') THEN 1 ELSE 2 END, created_at DESC LIMIT 100`).all();
    const counts = await context.env.DB.prepare('SELECT status,COUNT(*) AS count FROM notification_outbox GROUP BY status').all();
    return json({ ok: true, configured: notificationsConfigured(context.env), notifications: rows.results || [], counts: counts.results || [] });
  } catch (error) { return safeErrorResponse(error); }
}
export async function onRequestPost(context) {
  try {
    protectMutation(context.request); await requireAdmin(context.env, context.request);
    return json({ ok: true, ...await flushNotifications(context.env) });
  } catch (error) { return safeErrorResponse(error); }
}
