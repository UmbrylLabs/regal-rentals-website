import { requireAdmin } from '../../_lib/auth.js';
import { json, safeErrorResponse } from '../../_lib/http.js';

export async function onRequestGet(context) {
  try {
    const user = await requireAdmin(context.env, context.request);
    if (user.role !== 'owner') throw new Error('FORBIDDEN');
    const result = await context.env.DB.prepare(
      `SELECT id, email, display_name, role, is_active, created_at, updated_at
       FROM users ORDER BY created_at`
    ).all();
    return json({ ok: true, users: result.results || [] });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function onRequestPost() {
  return json({
    ok: false,
    error: {
      code: 'ACCESS_MANAGED',
      message: 'Add administrators to the Regal Rentals Owners policy in Cloudflare Zero Trust.'
    }
  }, 405, { Allow: 'GET' });
}
