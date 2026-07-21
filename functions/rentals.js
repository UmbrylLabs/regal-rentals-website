const BOOKING_NOTICE_HTML = '<strong>Temporary hold:</strong> Submitting a request places the selected equipment on a 24-hour hold for the chosen date and time. Regal Rentals will review pricing, delivery details, and the agreement before confirming the reservation.';
const LOADING_INVENTORY_HTML = '<div class="catalog-load-state" role="status" aria-live="polite"><h3>Loading current inventory…</h3><p>The page is ready while Regal Rentals checks the latest catalog.</p></div>';
const MOBILE_FIRST_PAINT_CSS = `<style id="rentals-mobile-first-paint">
  @media (max-width: 820px) {
    .inventory-hero__inner.reveal,
    .date-check-card.reveal {
      opacity: 1 !important;
      transform: none !important;
      transition: none !important;
    }

    .site-header {
      background: #fffaf0 !important;
      -webkit-backdrop-filter: none !important;
      backdrop-filter: none !important;
    }
  }
</style>`;

class RemoveOldCatalogScripts {
  element(element) {
    const src = String(element.getAttribute('src') || '');
    if (src.includes('rentals.js') || src.includes('catalog-loader.js')) element.remove();
  }
}

class DeferExternalFonts {
  element(element) {
    element.setAttribute('media', 'print');
    element.setAttribute('onload', "this.media='all'");
  }
}

class ReplaceHtml {
  constructor(html) {
    this.html = html;
  }

  element(element) {
    element.setInnerContent(this.html, { html: true });
  }
}

class InjectHeadAssets {
  element(element) {
    element.append(MOBILE_FIRST_PAINT_CSS, { html: true });
    element.append('<link rel="stylesheet" href="/catalog-dynamic.css?v=20260721-8" />', { html: true });
  }
}

class InjectCatalogLoader {
  element(element) {
    element.append('<script src="/catalog-loader.js?v=20260721-11" defer></script>', { html: true });
  }
}

export async function onRequest(context) {
  const startedAt = Date.now();

  // Keep the initial document independent of D1. The live catalog is loaded
  // after first paint by catalog-loader.js, just like any other page enhancement.
  const response = await context.next();
  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.includes('text/html')) return response;

  const transformed = new HTMLRewriter()
    .on('script[src]', new RemoveOldCatalogScripts())
    .on('link[href^="https://fonts.googleapis.com/"]', new DeferExternalFonts())
    .on('head', new InjectHeadAssets())
    .on('#available-inventory .inventory-grid', new ReplaceHtml(LOADING_INVENTORY_HTML))
    .on('.availability-notice', new ReplaceHtml(BOOKING_NOTICE_HTML))
    .on('body', new InjectCatalogLoader())
    .transform(response);

  const result = new Response(transformed.body, transformed);
  result.headers.set('Cache-Control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400');
  result.headers.set('CDN-Cache-Control', 'max-age=3600, stale-while-revalidate=86400');
  result.headers.set('X-Regal-Catalog-Render', 'client-after-first-paint');
  result.headers.set('Server-Timing', `shell;dur=${Date.now() - startedAt}`);
  return result;
}
