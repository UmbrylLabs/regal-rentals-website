import { hashPassword, protectMutation, requireAdmin, normalizeLoginEmail } from '../../_lib/auth.js';
import { cleanText, json, randomId, readJson, safeErrorResponse } from '../../_lib/http.js';

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

export async function onRequestPost(context) {
  try {
    protectMutation(context.request);
    const owner = await requireAdmin(context.env, context.request);
    if (owner.role !== 'owner') throw new Error('FORBIDDEN');
    const body = await readJson(context.request);
    const email = normalizeLoginEmail(body.email);
    const displayName = cleanText(body.displayName, 150);
    if (displayName.length < 2) {
      return json({ ok: false, error: { code: 'INVALID_NAME', message: 'Enter a display name.' } }, 400);
    }
    const credentials = await hashPassword(body.password, context.env);
    const id = randomId();
    const now = Math.floor(Date.now() / 1000);
    await context.env.DB.batch([
      context.env.DB.prepare(
        `INSERT INTO users (
          id, email, display_name, password_hash, password_salt,
          password_iterations, role, is_active, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'admin', 1, ?7, ?7)`
      ).bind(
        id,
        email,
        displayName,
        credentials.hash,
        credentials.salt,
        credentials.iterations,
        now
      ),
      context.env.DB.prepare(
        `INSERT INTO audit_log (
          id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at
        ) VALUES (?1, ?2, 'user.create', 'user', ?3, ?4, ?5)`
      ).bind(
        randomId(),
        owner.id,
        id,
        JSON.stringify({ email, role: 'admin' }),
        now
      )
    ]);
    return json({
      ok: true,
      user: { id, email, displayName, role: 'admin', isActive: true }
    }, 201);
  } catch (error) {
    if (String(error?.message) === 'PASSWORD_REQUIREMENTS') {
      return json({
        ok: false,
        error: { code: 'PASSWORD_REQUIREMENTS', message: 'Use a password between 12 and 128 characters.' }
      }, 400);
    }
    if (String(error?.message || '').toLowerCase().includes('unique')) {
      return json({ ok: false, error: { code: 'EMAIL_EXISTS', message: 'That email already has an account.' } }, 409);
    }
    return safeErrorResponse(error);
  }
}
