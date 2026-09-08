import { sha256 } from './http.js';

export async function limitPublicSubmission(env, request, email, scope) {
  const now = Math.floor(Date.now() / 1000), window = Math.floor(now / 3600);
  // Trust only the address supplied by Cloudflare, never a forwarded-for value.
  const ip = request.headers.get('CF-Connecting-IP');
  const subjects = [[email.toLowerCase(), 5, 'email']];
  if (ip) subjects.push([ip, 20, 'ip']);
  for (const [subject, limit, kind] of subjects) {
    const key = `${scope}:${kind}:${window}:${await sha256(subject)}`;
    const result = await env.DB.prepare(`INSERT INTO public_request_limits (key,count,expires_at)
      VALUES (?1,1,?2) ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE count < ?3`)
      .bind(key, (window + 1) * 3600, limit).run();
    if (!Number(result.meta?.changes)) throw new Error('PUBLIC_RATE_LIMIT');
  }
  await env.DB.prepare('DELETE FROM public_request_limits WHERE expires_at < ?1').bind(now - 3600).run();
}
