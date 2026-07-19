import {
  assertSameOrigin,
  clientIp,
  getCookie,
  normalizeEmail,
  randomToken,
  sha256
} from './http.js';

export const SESSION_COOKIE = '__Host-regal_session';
const PASSWORD_ITERATIONS = 600000;
const SESSION_SECONDS = 60 * 60 * 10;
const LOGIN_WINDOW_SECONDS = 15 * 60;
const LOGIN_LOCK_SECONDS = 15 * 60;
const MAX_LOGIN_FAILURES = 5;

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function passwordMaterial(password, pepper) {
  return new TextEncoder().encode(`${password}\u0000${pepper || ''}`);
}

export function validatePassword(password) {
  const value = String(password || '');
  if (value.length < 12 || value.length > 128) {
    throw new Error('PASSWORD_REQUIREMENTS');
  }
  return value;
}

export async function hashPassword(password, env, salt = null, iterations = PASSWORD_ITERATIONS) {
  const checked = validatePassword(password);
  const saltBytes = salt
    ? Uint8Array.from(atob(salt), (char) => char.charCodeAt(0))
    : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw',
    await passwordMaterial(checked, env.PASSWORD_PEPPER),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations },
    key,
    256
  );
  return {
    hash: bytesToHex(new Uint8Array(bits)),
    salt: btoa(String.fromCharCode(...saltBytes)),
    iterations
  };
}

export async function verifyPassword(password, user, env) {
  try {
    const derived = await hashPassword(
      password,
      env,
      user.password_salt,
      Number(user.password_iterations)
    );
    const left = new TextEncoder().encode(derived.hash);
    const right = new TextEncoder().encode(user.password_hash);
    if (left.byteLength !== right.byteLength) return false;
    return crypto.subtle.timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

function sessionCookie(value, maxAge = SESSION_SECONDS) {
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Strict`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict`;
}

export async function createSession(env, request, userId) {
  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const ipHash = await sha256(`${clientIp(request)}|${env.IP_HASH_PEPPER || ''}`);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO sessions (
      token_hash, user_id, expires_at, created_at, last_seen_at, ip_hash, user_agent
    ) VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6)`
  ).bind(
    tokenHash,
    userId,
    now + SESSION_SECONDS,
    now,
    ipHash,
    String(request.headers.get('user-agent') || '').slice(0, 500)
  ).run();
  return { token, cookie: sessionCookie(token), expiresAt: now + SESSION_SECONDS };
}

export async function destroySession(env, request) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return;
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?1')
    .bind(await sha256(token))
    .run();
}

export async function currentUser(env, request) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const now = Math.floor(Date.now() / 1000);
  const user = await env.DB.prepare(
    `SELECT u.id, u.email, u.display_name, u.role
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?1
       AND s.expires_at > ?2
       AND u.is_active = 1`
  ).bind(tokenHash, now).first();
  if (!user) return null;

  await env.DB.prepare(
    'UPDATE sessions SET last_seen_at = ?1 WHERE token_hash = ?2'
  ).bind(now, tokenHash).run();
  return user;
}

export async function requireAdmin(env, request) {
  const user = await currentUser(env, request);
  if (!user) throw new Error('UNAUTHORIZED');
  if (!['owner', 'admin'].includes(user.role)) throw new Error('FORBIDDEN');
  return user;
}

async function attemptKey(request, email, env) {
  return sha256(`${clientIp(request)}|${normalizeEmail(email)}|${env.LOGIN_RATE_PEPPER || ''}`);
}

export async function assertLoginAllowed(env, request, email) {
  const key = await attemptKey(request, email, env);
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(
    'SELECT failures, window_started_at, locked_until FROM login_attempts WHERE attempt_key = ?1'
  ).bind(key).first();
  if (row?.locked_until && Number(row.locked_until) > now) {
    const error = new Error('LOGIN_LOCKED');
    error.retryAfter = Number(row.locked_until) - now;
    throw error;
  }
  return key;
}

export async function recordLoginFailure(env, key) {
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(
    'SELECT failures, window_started_at FROM login_attempts WHERE attempt_key = ?1'
  ).bind(key).first();

  let failures = 1;
  let windowStart = now;
  if (row && now - Number(row.window_started_at) <= LOGIN_WINDOW_SECONDS) {
    failures = Number(row.failures) + 1;
    windowStart = Number(row.window_started_at);
  }
  const lockedUntil = failures >= MAX_LOGIN_FAILURES ? now + LOGIN_LOCK_SECONDS : null;

  await env.DB.prepare(
    `INSERT INTO login_attempts (attempt_key, failures, window_started_at, locked_until)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(attempt_key) DO UPDATE SET
       failures = excluded.failures,
       window_started_at = excluded.window_started_at,
       locked_until = excluded.locked_until`
  ).bind(key, failures, windowStart, lockedUntil).run();
}

export async function clearLoginFailures(env, key) {
  await env.DB.prepare('DELETE FROM login_attempts WHERE attempt_key = ?1').bind(key).run();
}

export function protectMutation(request) {
  assertSameOrigin(request);
}

export function normalizeLoginEmail(value) {
  const email = normalizeEmail(value);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error('INVALID_CREDENTIALS');
  }
  return email;
}
