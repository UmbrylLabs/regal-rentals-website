class RemoveOldCatalogScripts {
  element(element) {
    const src = String(element.getAttribute('src') || '');
    if (src.includes('rentals.js') || src.includes('catalog-loader.js')) element.remove();
  }
}

class InjectCurrentCatalogScript {
  element(element) {
    element.append(
      '<script src="/catalog-loader.js?v=20260721-5" defer></script>',
      { html: true }
    );
  }
}

export async function onRequest(context) {
  const response = await context.next();
  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.includes('text/html')) return response;

  const transformed = new HTMLRewriter()
    .on('script[src]', new RemoveOldCatalogScripts())
    .on('body', new InjectCurrentCatalogScript())
    .transform(response);

  const result = new Response(transformed.body, transformed);
  result.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  result.headers.set('Pragma', 'no-cache');
  result.headers.set('Expires', '0');
  return result;
}
