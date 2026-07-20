import {
  assertSameOrigin,
  base64UrlDecode,
  clientIp,
  getCookie,
  normalizeEmail,
  randomId,
  randomToken,
  sha256
} from './http.js';

export const SESSION_COOKIE = '__Host-regal_session';
const PASSWORD_ITERATIONS = 220000;
const SESSION_SECONDS = 60 * 60 * 10;
const LOGIN_WINDOW_SECONDS = 15 * 60;
const LOGIN_LOCK_SECONDS = 15 * 60;
const MAX_LOGIN_FAILURES = 5;
const ADMIN_HOSTNAME = 'admin.regal.rentals';
const ACCESS_KEY_CACHE_SECONDS = 60 * 60;

let accessKeyCache = {
  issuer: '',
  expiresAt: 0,
  keys: new Map()
};

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
    { name: 'PBKDF2', hash: 'SHA-512', salt: saltBytes, iterations },
    key,
    256
  );
  return {
    hash: bytesToHex(new Uint8Array(bits)),
    salt: btoa(String.fromCharCode(...saltBytes)),
    iterations
  };
}

function constantTimeEqual(leftValue, rightValue) {
  const left = new TextEncoder().encode(String(leftValue));
  const right = new TextEncoder().encode(String(rightValue));
  const length = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left[index] || 0) ^ (right[index] || 0);
  }
  return mismatch === 0;
}

export async function verifyPassword(password, user, env) {
  try {
    const derived = await hashPassword(
      password,
      env,
      user.password_salt,
      Number(user.password_iterations)
    );
    return constantTimeEqual(derived.hash, user.password_hash);
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

function normalizeTeamDomain(value) {
  const trimmed = String(value || '').trim().replace(/\/+$/g, '');
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/i.test(trimmed)) {
    throw new Error('ACCESS_NOT_CONFIGURED');
  }
  return trimmed;
}

function decodeJwtJson(segment) {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlDecode(segment)));
  } catch {
    throw new Error('ACCESS_INVALID');
  }
}

function audienceMatches(actual, expected) {
  if (Array.isArray(actual)) return actual.includes(expected);
  return String(actual || '') === expected;
}

async function loadAccessKeys(issuer, forceRefresh = false) {
  const now = Math.floor(Date.now() / 1000);
  if (!forceRefresh && accessKeyCache.issuer === issuer && accessKeyCache.expiresAt > now) {
    return accessKeyCache.keys;
  }

  const response = await fetch(`${issuer}/cdn-cgi/access/certs`, {
    headers: { Accept: 'application/json' }
  });
  if (!response.ok) throw new Error('ACCESS_INVALID');
  const body = await response.json();
  if (!Array.isArray(body?.keys)) throw new Error('ACCESS_INVALID');

  const keys = new Map();
  for (const jwk of body.keys) {
    if (!jwk?.kid || jwk.kty !== 'RSA') continue;
    const key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
    keys.set(jwk.kid, key);
  }
  accessKeyCache = { issuer, expiresAt: now + ACCESS_KEY_CACHE_SECONDS, keys };
  return keys;
}

async function validateAccessIdentity(env, request) {
  const issuer = normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN);
  const expectedAudience = String(env.ACCESS_AUD || '').trim();
  if (!expectedAudience) throw new Error('ACCESS_NOT_CONFIGURED');

  const hostname = new URL(request.url).hostname.toLowerCase();
  if (hostname !== ADMIN_HOSTNAME) throw new Error('ACCESS_REQUIRED');

  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) throw new Error('ACCESS_REQUIRED');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('ACCESS_INVALID');

  const header = decodeJwtJson(parts[0]);
  const payload = decodeJwtJson(parts[1]);
  if (header.alg !== 'RS256' || !header.kid) throw new Error('ACCESS_INVALID');

  const now = Math.floor(Date.now() / 1000);
  if (String(payload.iss || '').replace(/\/+$/g, '') !== issuer) throw new Error('ACCESS_INVALID');
  if (!audienceMatches(payload.aud, expectedAudience)) throw new Error('ACCESS_INVALID');
  if (!Number.isFinite(Number(payload.exp)) || Number(payload.exp) <= now) throw new Error('ACCESS_INVALID');
  if (payload.nbf != null && Number(payload.nbf) > now + 30) throw new Error('ACCESS_INVALID');

  let keys = await loadAccessKeys(issuer);
  let key = keys.get(header.kid);
  if (!key) {
    keys = await loadAccessKeys(issuer, true);
    key = keys.get(header.kid);
  }
  if (!key) throw new Error('ACCESS_INVALID');

  const verified = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    base64UrlDecode(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  );
  if (!verified) throw new Error('ACCESS_INVALID');

  const email = normalizeEmail(payload.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('ACCESS_INVALID');
  return { email, subject: String(payload.sub || ''), payload };
}

function displayNameFromEmail(email) {
  const local = email.split('@')[0] || email;
  return local
    .split(/[._-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
    .slice(0, 150) || email;
}

async function accessUser(env, identity) {
  let user = await env.DB.prepare(
    `SELECT id, email, display_name, role, is_active
     FROM users WHERE email = ?1 COLLATE NOCASE`
  ).bind(identity.email).first();

  if (!user) {
    const id = randomId();
    const now = Math.floor(Date.now() / 1000);
    try {
      await env.DB.prepare(
        `INSERT INTO users (
          id, email, display_name, password_hash, password_salt,
          password_iterations, role, is_active, created_at, updated_at
        ) VALUES (?1, ?2, ?3, 'CLOUDFLARE_ACCESS_ONLY', 'CLOUDFLARE_ACCESS_ONLY', 1, 'owner', 1, ?4, ?4)`
      ).bind(id, identity.email, displayNameFromEmail(identity.email), now).run();
    } catch (error) {
      if (!String(error?.message || '').toLowerCase().includes('unique')) throw error;
    }
    user = await env.DB.prepare(
      `SELECT id, email, display_name, role, is_active
       FROM users WHERE email = ?1 COLLATE NOCASE`
    ).bind(identity.email).first();
  }

  if (!user || Number(user.is_active) !== 1) throw new Error('FORBIDDEN');
  return user;
}

export async function currentUser(env, request) {
  const identity = await validateAccessIdentity(env, request);
  return accessUser(env, identity);
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
