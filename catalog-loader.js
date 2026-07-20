(() => {
  const bootstrapNode = document.getElementById('catalog-bootstrap');
  let bootstrapProducts = [];
  try {
    const parsed = JSON.parse(bootstrapNode?.textContent || '{}');
    if (Array.isArray(parsed.products)) bootstrapProducts = parsed.products;
  } catch (error) {
    console.error('Catalog bootstrap could not be parsed', error);
  }

  const cryptoObject = globalThis.crypto || {};
  if (typeof cryptoObject.randomUUID !== 'function') {
    cryptoObject.randomUUID = () => {
      const bytes = new Uint8Array(16);
      if (typeof cryptoObject.getRandomValues === 'function') cryptoObject.getRandomValues(bytes);
      else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
      return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
    };
    if (!globalThis.crypto) globalThis.crypto = cryptoObject;
  }

  if (!globalThis.CSS) globalThis.CSS = {};
  if (typeof globalThis.CSS.escape !== 'function') {
    globalThis.CSS.escape = (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
  }

  const originalFetch = globalThis.fetch.bind(globalThis);
  const embeddedCatalogResponse = () => new Response(
    JSON.stringify({ ok: true, products: bootstrapProducts }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    }
  );

  globalThis.fetch = (input, init = {}) => {
    const rawUrl = typeof input === 'string' ? input : input?.url;
    const isCatalog = rawUrl && rawUrl.includes('/api/public/catalog');
    const isAvailability = rawUrl && rawUrl.includes('/api/public/availability');

    // The server already queried D1 and embedded the current catalog in this page.
    // Reuse it immediately instead of making a second network and database request.
    if (isCatalog && bootstrapProducts.length) return Promise.resolve(embeddedCatalogResponse());
    if (!isCatalog && !isAvailability) return originalFetch(input, init);

    const url = new URL(rawUrl, globalThis.location.origin);
    url.searchParams.set('_catalogRefresh', String(Date.now()));
    return originalFetch(url.toString(), { ...init, cache: 'no-store' });
  };

  const script = document.createElement('script');
  script.src = '/rentals.js?v=20260721-8';
  script.async = true;
  script.onerror = () => {
    const grid = document.querySelector('#available-inventory .inventory-grid');
    if (grid && !grid.querySelector('[data-inventory-product]')) {
      grid.innerHTML = '<div class="catalog-load-state"><h3>Catalog could not load</h3><p>Please refresh the page or contact Regal Rentals.</p></div>';
    }
  };
  document.body.appendChild(script);
})();