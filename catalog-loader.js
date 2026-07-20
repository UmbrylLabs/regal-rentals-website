(() => {
  const cryptoObject = globalThis.crypto || {};
  if (typeof cryptoObject.randomUUID !== 'function') {
    cryptoObject.randomUUID = () => {
      const bytes = new Uint8Array(16);
      if (typeof cryptoObject.getRandomValues === 'function') {
        cryptoObject.getRandomValues(bytes);
      } else {
        for (let index = 0; index < bytes.length; index += 1) {
          bytes[index] = Math.floor(Math.random() * 256);
        }
      }
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
      return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
    };
  }

  if (!globalThis.CSS) globalThis.CSS = {};
  if (typeof globalThis.CSS.escape !== 'function') {
    globalThis.CSS.escape = (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
  }

  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init = {}) => {
    const rawUrl = typeof input === 'string' ? input : input?.url;
    if (rawUrl && (rawUrl.includes('/api/public/catalog') || rawUrl.includes('/api/public/availability'))) {
      const url = new URL(rawUrl, globalThis.location.origin);
      url.searchParams.set('_catalogRefresh', String(Date.now()));
      const nextInit = { ...init, cache: 'no-store', headers: { ...(init.headers || {}), 'Cache-Control': 'no-cache' } };
      return originalFetch(url.toString(), nextInit);
    }
    return originalFetch(input, init);
  };

  const script = document.createElement('script');
  script.src = `/rentals.js?v=20260721-5`;
  script.defer = true;
  script.onerror = () => {
    const grid = document.querySelector('#available-inventory .inventory-grid');
    if (grid) grid.innerHTML = '<div class="catalog-load-state"><h3>Catalog could not load</h3><p>Please refresh the page or contact Regal Rentals.</p></div>';
  };
  document.body.appendChild(script);
})();
