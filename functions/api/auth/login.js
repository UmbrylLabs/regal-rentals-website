import { json } from '../../_lib/http.js';

export async function onRequestPost() {
  return json({
    ok: false,
    error: {
      code: 'ACCESS_MANAGED',
      message: 'Password login has been replaced by Cloudflare Access. Open https://admin.regal.rentals/.'
    }
  }, 410);
}
