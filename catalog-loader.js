(() => {
  const BUFFER_BEFORE_MINUTES = 4 * 60;
  const BUFFER_AFTER_MINUTES = 12 * 60;

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

  const selectedQuantities = new Map();
  const afterCurrentTask = typeof globalThis.queueMicrotask === 'function'
    ? globalThis.queueMicrotask.bind(globalThis)
    : (callback) => Promise.resolve().then(callback);

  const findQuantityInput = (productId) => {
    const escaped = globalThis.CSS.escape(productId);
    const quote = document.querySelector(`[data-quote-quantity="${escaped}"]`);
    const quoteRow = quote?.closest('[data-quote-product]');
    if (quote && quoteRow && !quoteRow.hidden) return quote;
    return document.querySelector(`[data-card-quantity="${escaped}"]`) || quote;
  };

  const rememberQuantity = (input) => {
    const productId = input?.dataset?.quoteQuantity || input?.dataset?.cardQuantity;
    const quantity = Number.parseInt(input?.value || '', 10);
    if (productId && Number.isFinite(quantity) && quantity > 0) selectedQuantities.set(productId, quantity);
  };

  document.addEventListener('input', (event) => {
    if (event.target.matches?.('[data-card-quantity], [data-quote-quantity]')) rememberQuantity(event.target);
  }, true);

  document.addEventListener('click', (event) => {
    const remove = event.target.closest?.('[data-remove-product]');
    if (remove) {
      selectedQuantities.delete(remove.dataset.removeProduct);
      return;
    }

    const control = event.target.closest?.('[data-card-step][data-product-id], [data-quote-step][data-product-id], [data-add-product]');
    if (!control) return;
    const productId = control.dataset.productId || control.dataset.addProduct;
    afterCurrentTask(() => rememberQuantity(findQuantityInput(productId)));
  }, true);

  const restoreSelectedQuantities = () => {
    selectedQuantities.forEach((remembered, productId) => {
      const escaped = globalThis.CSS.escape(productId);
      const quote = document.querySelector(`[data-quote-quantity="${escaped}"]`);
      const quoteRow = quote?.closest('[data-quote-product]');
      if (!quote || !quoteRow || quoteRow.hidden) return;

      const card = document.querySelector(`[data-card-quantity="${escaped}"]`);
      const maximum = Number.parseInt(quote.max || card?.max || '0', 10);
      if (!Number.isFinite(maximum) || maximum < 1) return;
      const quantity = Math.min(maximum, Math.max(1, remembered));
      const value = String(quantity);
      let changed = false;

      if (quote.value !== value) {
        quote.value = value;
        changed = true;
      }
      if (card && card.value !== value) card.value = value;
      if (changed) quote.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  const updateAvailabilityUi = () => {
    const quickMessage = document.getElementById('date-check-message');
    const availabilityReady = Boolean(
      quickMessage?.classList.contains('date-check-message--ready')
      || quickMessage?.textContent?.includes('Live availability shown for')
    );

    if (availabilityReady && quickMessage) {
      const bufferText = 'A four-hour preparation buffer and twelve-hour return/cleaning buffer are included.';
      const nextText = String(quickMessage.textContent || '')
        .replace(/A two-hour preparation and return buffer is included\.?/i, bufferText);
      if (nextText !== quickMessage.textContent) quickMessage.textContent = nextText;

      document.querySelectorAll('[data-product-badge]').forEach((badge) => {
        const productId = badge.dataset.productBadge;
        const input = document.querySelector(`[data-card-quantity="${globalThis.CSS.escape(productId)}"]`);
        const maximum = Number.parseInt(input?.max || '0', 10);
        const label = maximum > 0 ? `${maximum} available for your date` : 'Unavailable for your date';
        if (badge.textContent !== label) badge.textContent = label;
      });
    }

    const summary = document.getElementById('availability-message');
    if (
      summary?.textContent?.startsWith('Request ')
      && summary.textContent.includes('was received')
      && !summary.textContent.includes('temporarily held for 24 hours')
    ) {
      summary.textContent += ' The requested items are temporarily held for 24 hours while Regal Rentals reviews the order.';
    }
  };

  const observer = new MutationObserver(() => {
    restoreSelectedQuantities();
    updateAvailabilityUi();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  const localEpoch = (date, time) => {
    if (!date || !time) return null;
    const parsed = new Date(`${date}T${time}:00`);
    const epoch = Math.floor(parsed.getTime() / 1000);
    return Number.isFinite(epoch) ? epoch : null;
  };

  const applyAvailabilityWindow = (url) => {
    const date = document.getElementById('event-date')?.value || document.getElementById('quick-event-date')?.value;
    const startTime = document.getElementById('event-start')?.value || document.getElementById('quick-event-start')?.value;
    const endTime = document.getElementById('event-end')?.value || document.getElementById('quick-event-end')?.value;
    const eventStart = localEpoch(date, startTime);
    const eventEnd = localEpoch(date, endTime);
    if (eventStart && eventEnd && eventEnd > eventStart) {
      url.searchParams.set('startAt', String(eventStart - BUFFER_BEFORE_MINUTES * 60));
      url.searchParams.set('endAt', String(eventEnd + BUFFER_AFTER_MINUTES * 60));
    }
  };

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
    const isQuote = rawUrl && rawUrl.includes('/api/public/quote');

    // The server already queried D1 and embedded the current catalog in this page.
    // Reuse it immediately instead of making a second network and database request.
    if (isCatalog && bootstrapProducts.length) return Promise.resolve(embeddedCatalogResponse());

    if (isQuote && typeof init.body === 'string') {
      try {
        const payload = JSON.parse(init.body);
        payload.bufferBeforeMinutes = BUFFER_BEFORE_MINUTES;
        payload.bufferAfterMinutes = BUFFER_AFTER_MINUTES;
        if (Array.isArray(payload.items)) {
          payload.items = payload.items.map((item) => {
            const remembered = selectedQuantities.get(item.productId);
            if (!Number.isFinite(remembered)) return item;
            const inputElement = findQuantityInput(item.productId);
            const maximum = Number.parseInt(inputElement?.max || '0', 10);
            const quantity = Number.isFinite(maximum) && maximum > 0
              ? Math.min(maximum, Math.max(1, remembered))
              : Math.max(1, remembered);
            return { ...item, quantity };
          });
        }
        init = { ...init, body: JSON.stringify(payload) };
      } catch (error) {
        console.error('Quote details could not be prepared', error);
      }
    }

    if (!isCatalog && !isAvailability) return originalFetch(input, init);

    const url = new URL(rawUrl, globalThis.location.origin);
    if (isAvailability) applyAvailabilityWindow(url);
    url.searchParams.set('_catalogRefresh', String(Date.now()));
    return originalFetch(url.toString(), { ...init, cache: 'no-store' });
  };

  const script = document.createElement('script');
  script.src = '/rentals.js?v=20260721-10';
  script.async = true;
  script.onerror = () => {
    const grid = document.querySelector('#available-inventory .inventory-grid');
    if (grid && !grid.querySelector('[data-inventory-product]')) {
      grid.innerHTML = '<div class="catalog-load-state"><h3>Catalog could not load</h3><p>Please refresh the page or contact Regal Rentals.</p></div>';
    }
  };
  document.body.appendChild(script);
})();
