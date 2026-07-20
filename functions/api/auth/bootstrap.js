import { json } from '../../_lib/http.js';

export async function onRequestPost() {
  return json({
    ok: false,
    error: {
      code: 'ACCESS_MANAGED',
      message: 'Owner setup is now managed by the Regal Rentals Owners policy in Cloudflare Zero Trust.'
    }
  }, 410);
}
