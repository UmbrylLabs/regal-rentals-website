import { createSession, hashPassword, protectMutation, normalizeLoginEmail } from '../../_lib/auth.js';
import { cleanText, json, randomId, readJson, safeErrorResponse } from '../../_lib/http.js';

export async function onRequestPost(context) {
  try {
    protectMutation(context.request);
    const suppliedToken = context.request.headers.get('X-Bootstrap-Token') || '';
    if (!context.env.BOOTSTRAP_TOKEN || suppliedToken !== context.env.BOOTSTRAP_TOKEN) {
      return json({ ok: false, error: { code: 'BOOTSTRAP_DENIED', message: 'Bootstrap denied.' } }, 403);
    }

    const count = await context.env.DB.prepare('SELECT COUNT(*) AS count FROM users').first();
    if (Number(count?.count || 0) > 0) {
      return json({ ok: false, error: { code: 'ALREADY_INITIALIZED', message: 'An owner account already exists.' } }, 409);
    }

    const body = await readJson(context.request);
    const email = normalizeLoginEmail(body.email);
    const displayName = cleanText(body.displayName, 150);
    if (displayName.length < 2) {
      return json({ ok: false, error: { code: 'INVALID_NAME', message: 'Enter a display name.' } }, 400);
    }
    const credentials = await hashPassword(body.password, context.env);
    const userId = randomId();
    const now = Math.floor(Date.now() / 1000);

    await context.env.DB.batch([
      context.env.DB.prepare(
        `INSERT INTO system_state (key, value, updated_at)
         VALUES ('owner_bootstrapped', ?1, ?2)`
      ).bind(userId, now),
      context.env.DB.prepare(
        `INSERT INTO users (
          id, email, display_name, password_hash, password_salt,
          password_iterations, role, is_active, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'owner', 1, ?7, ?7)`
      ).bind(
        userId,
        email,
        displayName,
        credentials.hash,
        credentials.salt,
        credentials.iterations,
        now
      )
    ]);

    const session = await createSession(context.env, context.request, userId);
    return json(
      { ok: true, user: { id: userId, email, displayName, role: 'owner' } },
      201,
      { 'Set-Cookie': session.cookie }
    );
  } catch (error) {
    if (String(error?.message) === 'PASSWORD_REQUIREMENTS') {
      return json({
        ok: false,
        error: { code: 'PASSWORD_REQUIREMENTS', message: 'Use a password between 12 and 128 characters.' }
      }, 400);
    }
    if (String(error?.message || '').toLowerCase().includes('unique')) {
      return json({ ok: false, error: { code: 'ALREADY_INITIALIZED', message: 'An owner account already exists.' } }, 409);
    }
    return safeErrorResponse(error);
  }
}
