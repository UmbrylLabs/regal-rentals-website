import { createSession, hashPassword, protectMutation, normalizeLoginEmail } from '../../_lib/auth.js';
import { cleanText, json, randomId, readJson, safeErrorResponse } from '../../_lib/http.js';

export async function onRequestPost(context) {
  try {
    protectMutation(context.request);
    const suppliedToken = context.request.headers.get('X-Bootstrap-Token') || '';

    if (!context.env.BOOTSTRAP_TOKEN) {
      return json({
        ok: false,
        error: {
          code: 'BOOTSTRAP_NOT_CONFIGURED',
          message: 'The bootstrap secret is not configured for this deployment.'
        }
      }, 503);
    }

    if (suppliedToken !== context.env.BOOTSTRAP_TOKEN) {
      return json({
        ok: false,
        error: {
          code: 'BOOTSTRAP_MISMATCH',
          message: 'The bootstrap token does not match the secret configured for this deployment.'
        }
      }, 403);
    }

    if (!context.env.DB || typeof context.env.DB.prepare !== 'function') {
      return json({
        ok: false,
        error: {
          code: 'DATABASE_NOT_BOUND',
          message: 'The D1 database is not connected to this preview deployment. Add the DB binding under Preview settings and redeploy.'
        }
      }, 503);
    }

    let count;
    try {
      count = await context.env.DB.prepare('SELECT COUNT(*) AS count FROM users').first();
    } catch (error) {
      console.error('Owner bootstrap database check failed', error);
      return json({
        ok: false,
        error: {
          code: 'DATABASE_NOT_READY',
          message: 'The preview database is connected, but its booking tables are unavailable. Confirm DB points to regal-rentals and that both migrations were executed.'
        }
      }, 503);
    }

    if (Number(count?.count || 0) > 0) {
      return json({ ok: false, error: { code: 'ALREADY_INITIALIZED', message: 'An owner account already exists.' } }, 409);
    }

    const body = await readJson(context.request);
    const email = normalizeLoginEmail(body.email);
    const displayName = cleanText(body.displayName, 150);
    if (displayName.length < 2) {
      return json({ ok: false, error: { code: 'INVALID_NAME', message: 'Enter a display name.' } }, 400);
    }

    let credentials;
    try {
      credentials = await hashPassword(body.password, context.env);
    } catch (error) {
      if (String(error?.message) === 'PASSWORD_REQUIREMENTS') throw error;
      console.error('Owner bootstrap password hashing failed', error);
      return json({
        ok: false,
        error: {
          code: 'PASSWORD_HASH_FAILED',
          message: 'Cloudflare could not securely process the password. Check Functions logs for the bootstrap request.'
        }
      }, 500);
    }

    const userId = randomId();
    const now = Math.floor(Date.now() / 1000);

    try {
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
    } catch (error) {
      console.error('Owner bootstrap database write failed', error);
      if (String(error?.message || '').toLowerCase().includes('unique')) {
        return json({ ok: false, error: { code: 'ALREADY_INITIALIZED', message: 'An owner account already exists.' } }, 409);
      }
      return json({
        ok: false,
        error: {
          code: 'OWNER_WRITE_FAILED',
          message: 'The owner account could not be saved to D1. Confirm both migrations were executed on the database connected to Preview.'
        }
      }, 500);
    }

    try {
      const session = await createSession(context.env, context.request, userId);
      return json(
        { ok: true, user: { id: userId, email, displayName, role: 'owner' } },
        201,
        { 'Set-Cookie': session.cookie }
      );
    } catch (error) {
      console.error('Owner bootstrap session creation failed', error);
      return json({
        ok: false,
        error: {
          code: 'SESSION_CREATE_FAILED',
          message: 'The owner account was created, but the login session failed. Open the admin login page and sign in with the account you just created.'
        }
      }, 500);
    }
  } catch (error) {
    if (String(error?.message) === 'PASSWORD_REQUIREMENTS') {
      return json({
        ok: false,
        error: { code: 'PASSWORD_REQUIREMENTS', message: 'Use a password between 12 and 128 characters.' }
      }, 400);
    }
    return safeErrorResponse(error);
  }
}
