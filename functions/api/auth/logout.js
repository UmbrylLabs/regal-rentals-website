import { clearSessionCookie, destroySession, protectMutation } from '../../_lib/auth.js';
import { json, safeErrorResponse } from '../../_lib/http.js';

export async function onRequestPost(context) {
  try {
    protectMutation(context.request);
    await destroySession(context.env, context.request);
    return json({ ok: true }, 200, {
      'Set-Cookie': clearSessionCookie(),
      'Clear-Site-Data': '"cache", "cookies", "storage"'
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
