import {
  assertLoginAllowed,
  clearLoginFailures,
  createSession,
  normalizeLoginEmail,
  protectMutation,
  recordLoginFailure,
  verifyPassword
} from '../../_lib/auth.js';
import { json, readJson, safeErrorResponse } from '../../_lib/http.js';

export async function onRequestPost(context) {
  try {
    protectMutation(context.request);
    const body = await readJson(context.request);
    const email = normalizeLoginEmail(body.email);
    const key = await assertLoginAllowed(context.env, context.request, email);

    const user = await context.env.DB.prepare(
      `SELECT id, email, display_name, password_hash, password_salt,
              password_iterations, role, is_active
       FROM users WHERE email = ?1 COLLATE NOCASE`
    ).bind(email).first();

    const valid = user?.is_active && await verifyPassword(body.password, user, context.env);
    if (!valid) {
      await recordLoginFailure(context.env, key);
      return json({
        ok: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' }
      }, 401);
    }

    await clearLoginFailures(context.env, key);
    const session = await createSession(context.env, context.request, user.id);
    return json(
      {
        ok: true,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          role: user.role
        }
      },
      200,
      { 'Set-Cookie': session.cookie }
    );
  } catch (error) {
    if (String(error?.message) === 'LOGIN_LOCKED') {
      return json({
        ok: false,
        error: {
          code: 'LOGIN_LOCKED',
          message: 'Too many attempts. Try again later.',
          retryAfter: error.retryAfter
        }
      }, 429, { 'Retry-After': String(error.retryAfter || 900) });
    }
    if (String(error?.message) === 'INVALID_CREDENTIALS') {
      return json({
        ok: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' }
      }, 401);
    }
    return safeErrorResponse(error);
  }
}
