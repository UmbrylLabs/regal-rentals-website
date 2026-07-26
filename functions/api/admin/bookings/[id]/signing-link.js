import { createCustomerChoiceSigningRequest } from '../../../../_lib/agreement-v24.js';
import { protectMutation, requireAdmin } from '../../../../_lib/auth.js';
import { json, readJson, safeErrorResponse } from '../../../../_lib/http.js';
import { resolvePublicSigningOrigin } from '../../../../_lib/signing-origin.js';

export async function onRequestPost(context) {
  try {
    protectMutation(context.request);
    const user = await requireAdmin(context.env, context.request);
    const body = await readJson(context.request);
    const origin = resolvePublicSigningOrigin(
      context.request.url,
      context.env.PUBLIC_SITE_ORIGIN
    );
    const request = await createCustomerChoiceSigningRequest(
      context.env,
      context.params.id,
      user,
      { ...body, origin }
    );
    return json({ ok: true, signingRequest: request }, 201);
  } catch (error) {
    return safeErrorResponse(error);
  }
}
