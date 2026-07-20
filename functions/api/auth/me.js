import { currentUser } from '../../_lib/auth.js';
import { json, safeErrorResponse } from '../../_lib/http.js';

export async function onRequestGet(context) {
  try {
    const user = await currentUser(context.env, context.request);
    if (!user) return json({ ok: false, user: null }, 401);
    return json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        role: user.role
      }
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
