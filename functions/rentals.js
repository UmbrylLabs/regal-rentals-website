export async function onRequest(context) {
  const startedAt = Date.now();
  const response = await context.next();
  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.includes('text/html')) return response;

  const result = new Response(response.body, response);
  result.headers.delete('Clear-Site-Data');
  result.headers.delete('Pragma');
  result.headers.delete('Expires');
  result.headers.set('Cache-Control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400');
  result.headers.set('CDN-Cache-Control', 'max-age=3600, stale-while-revalidate=86400');
  result.headers.set('X-Regal-Catalog-Render', 'client-after-first-paint');
  result.headers.set('X-Regal-Cache-Reset', 'disabled');
  result.headers.set('Server-Timing', `shell;dur=${Date.now() - startedAt}`);
  return result;
}
