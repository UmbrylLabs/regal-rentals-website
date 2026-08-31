(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const form = $('#availability-form');
  if (!form) return;

  const quickForm = $('#availability-check-form');
  const quickDate = $('#quick-event-date');
  const quickStart = $('#quick-event-start');
  const quickEnd = $('#quick-event-end');
  const quickMessage = $('#date-check-message');
  const eventDate = $('#event-date');
  const eventStart = $('#event-start');
  const eventEnd = $('#event-end');
  const subtotalEl = $('#quote-subtotal');
  const summaryMessage = $('#availability-message');
  const emptyState = $('#selected-rentals-empty');
  const mobileCta = $('#mobile-availability-cta');
  const mobileCtaLabel = $('#mobile-availability-cta-label');
  const inventoryGrid = $('#available-inventory .inventory-grid');
  const categoryGrid = $('#category-grid');
  const categoryEmpty = $('#category-empty');
  const availableFilter = $('#available-now-filter');
  const selectedFieldset = $('#selected-rentals-fieldset');

  const categoryDefinitions = [
    ['Tables & Chairs', '♜', 'Tables, chairs, and seating arrangements for events of every size.'],
    ['Tents & Shade', '⌂', 'Canopies, tents, and shade equipment for outdoor events.'],
    ['Backyard Games', '★', 'Cornhole, giant games, tug-of-war, and outdoor entertainment.'],
    ['Mini Golf', '⚑', 'Portable mini golf experiences for parties, weddings, and corporate events.'],
    ['Photo Booths & Guestbooks', '◉', 'Photo, video, and audio guestbook experiences.'],
    ['Audio & Visual', '♫', 'PA systems, microphones, projectors, screens, karaoke, and lighting.'],
    ['Decor & Event Extras', '❖', 'Decor, event accents, and useful extras.'],
    ['Other', '◆', 'Additional event rental equipment.']
  ];

  const styleIcons = {
    'round-table': '◯', 'rectangle-table': '▭', chair: '♜', canopy: '⌂', tent: '△',
    game: '★', 'mini-golf': '⚑', 'photo-booth': '◉', audio: '♫', visual: '▣',
    lighting: '✦', decor: '❖', other: '◆'
  };

  const catalog = new Map();
  const selectedItems = new Set();
  const quantities = new Map();
  let availabilityWindowKey = null;
  const createSubmitKey = () => typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `quote-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let submitKey = createSubmitKey();

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

  const setMessage = (element, text, className = '') => {
    if (!element) return;
    element.textContent = text;
    element.className = className;
  };

  const money = (cents) => cents == null
    ? 'Pricing pending'
    : (Number(cents) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

  const eventWindow = () => {
    const startAt = RegalEventTime.pacificEpoch(eventDate.value, eventStart.value);
    const endAt = RegalEventTime.pacificEpoch(eventDate.value, eventEnd.value);
    if (!startAt || !endAt || endAt <= startAt) throw new Error('Choose a valid same-day event start and end time in Pacific Time.');
    return {
      eventStartAt: startAt,
      eventEndAt: endAt,
      key: `${startAt}:${endAt}`
    };
  };

  const selectorValue = (value) => String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');

  const boundedQuantity = (product, value = quantities.get(product.id)) => {
    const max = Number(product.max ?? product.quantityOwned ?? 0);
    const minimum = max > 0 ? 1 : 0;
    const parsed = Number.parseInt(value ?? minimum, 10);
    return Math.min(max, Math.max(minimum, Number.isFinite(parsed) ? parsed : minimum));
  };

  const rememberQuantity = (id, value) => {
    const product = catalog.get(id);
    if (!product) return 0;
    const quantity = boundedQuantity(product, value);
    quantities.set(id, quantity);
    return quantity;
  };

  const inputId = (productId, suffix) => `${String(productId).replace(/[^a-zA-Z0-9_-]/g, '-')}-${suffix}`;

  const renderCategories = () => {
    if (!categoryGrid) return;
    const counts = new Map();
    catalog.forEach((product) => counts.set(product.category, (counts.get(product.category) || 0) + 1));
    categoryGrid.dataset.catalogState = 'ready';
    categoryGrid.innerHTML = categoryDefinitions.map(([name, icon, description]) => {
      const count = counts.get(name) || 0;
      const available = count > 0;
      return `<article class="category-card reveal" data-category-availability="${available ? 'available' : 'coming'}">
        <div class="category-card__icon category-card__icon--dynamic" aria-hidden="true">${escapeHtml(icon)}</div>
        <span class="category-card__status${available ? ' category-card__status--available' : ''}">${available ? `${count} Available` : 'Coming Soon'}</span>
        <h3>${escapeHtml(name)}</h3>
        <p>${escapeHtml(description)}</p>
        ${available ? '<a href="#available-inventory">View Current Inventory <span aria-hidden="true">→</span></a>' : ''}
      </article>`;
    }).join('');
    updateCategoryFilter();
  };

  const updateCategoryFilter = () => {
    if (!availableFilter) return;
    let visible = 0;
    $$('[data-category-availability]', categoryGrid).forEach((card) => {
      const hidden = availableFilter.checked && card.dataset.categoryAvailability !== 'available';
      card.hidden = hidden;
      if (!hidden) visible += 1;
    });
    if (categoryEmpty) categoryEmpty.hidden = visible > 0;
  };

  const cardMarkup = (product) => {
    const max = Number(product.max ?? product.quantityOwned ?? 0);
    const unavailable = max < 1;
    const quantity = rememberQuantity(product.id, quantities.get(product.id));
    const priceText = product.priceCents == null ? 'Pricing soon' : money(product.priceCents);
    return `<article class="inventory-card reveal${unavailable ? ' inventory-card--unavailable' : ''}" data-inventory-product="${escapeHtml(product.id)}">
      <div class="inventory-card__visual inventory-card__visual--dynamic" aria-hidden="true">
        <div class="catalog-style-symbol">${escapeHtml(styleIcons[product.style] || styleIcons.other)}</div>
        <span class="inventory-card__badge" data-product-badge="${escapeHtml(product.id)}">${unavailable ? 'Unavailable' : `${max} in inventory`}</span>
      </div>
      <div class="inventory-card__body">
        <p class="inventory-card__kicker">${escapeHtml(product.category)}</p>
        <h3>${escapeHtml(product.name)}</h3>
        <p class="inventory-card__description">${escapeHtml(product.description || 'Contact Regal Rentals for item details.')}</p>
        <div class="inventory-card__meta${product.priceCents == null ? ' inventory-card__meta--text' : ''}"><strong>${escapeHtml(priceText)}</strong><span>${escapeHtml(product.priceUnit || 'each')}</span></div>
        <ul class="inventory-card__features"><li>${Number(product.quantityOwned)} total in current inventory</li><li>Live date-specific availability</li><li>Final reservation confirmed by Regal Rentals</li></ul>
        <div class="card-quote-control">
          <div class="quantity-control quantity-control--card" aria-label="${escapeHtml(product.name)} quantity selector">
            <button type="button" data-card-step="-1" data-product-id="${escapeHtml(product.id)}" aria-label="Remove one">−</button>
            <input id="${escapeHtml(inputId(product.id, 'card'))}" data-card-quantity="${escapeHtml(product.id)}" type="number" min="${unavailable ? 0 : 1}" max="${max}" value="${quantity}" inputmode="numeric" aria-label="${escapeHtml(product.name)} quantity to add" ${unavailable ? 'disabled' : ''} />
            <button type="button" data-card-step="1" data-product-id="${escapeHtml(product.id)}" aria-label="Add one">+</button>
          </div>
          <button class="btn btn--secondary add-to-quote-btn" type="button" data-add-product="${escapeHtml(product.id)}" ${unavailable ? 'disabled' : ''}>${unavailable ? 'Unavailable for Date' : 'Add to Quote'}</button>
        </div>
      </div>
    </article>`;
  };

  const renderInventory = () => {
    if (!inventoryGrid) return;
    const products = Array.from(catalog.values()).sort((a, b) => a.category.localeCompare(b.category) || Number(a.sortOrder || 100) - Number(b.sortOrder || 100) || a.name.localeCompare(b.name));
    inventoryGrid.dataset.catalogState = 'ready';
    inventoryGrid.innerHTML = products.length
      ? products.map(cardMarkup).join('')
      : '<div class="catalog-load-state"><h3>Inventory is being updated</h3><p>Please contact Regal Rentals for current rental options.</p></div>';
  };

  const renderQuoteRows = () => {
    $$('.quote-item-row', selectedFieldset).forEach((row) => row.remove());
    const fragment = document.createDocumentFragment();
    catalog.forEach((product) => {
      const row = document.createElement('div');
      row.className = 'quantity-row quote-item-row';
      row.dataset.quoteProduct = product.id;
      row.hidden = !selectedItems.has(product.id);
      const max = Number(product.max ?? product.quantityOwned ?? 0);
      const quantity = rememberQuantity(product.id, quantities.get(product.id));
      row.innerHTML = `<div><strong>${escapeHtml(product.name)}</strong><span data-quote-description="${escapeHtml(product.id)}">${escapeHtml(product.priceCents == null ? 'Pricing to be confirmed' : `${money(product.priceCents)} ${product.priceUnit || 'each'}`)} · Maximum ${max}</span></div>
        <div class="card-quote-control"><div class="quantity-control">
          <button type="button" data-quote-step="-1" data-product-id="${escapeHtml(product.id)}" aria-label="Remove one">−</button>
          <input id="${escapeHtml(inputId(product.id, 'quote'))}" data-quote-quantity="${escapeHtml(product.id)}" type="number" min="${max > 0 ? 1 : 0}" max="${max}" value="${quantity}" inputmode="numeric" aria-label="${escapeHtml(product.name)} quantity" />
          <button type="button" data-quote-step="1" data-product-id="${escapeHtml(product.id)}" aria-label="Add one">+</button>
        </div><button class="btn btn--secondary remove-from-quote-btn" type="button" data-remove-product="${escapeHtml(product.id)}">Remove from Quote</button></div>`;
      fragment.appendChild(row);
    });
    emptyState.after(fragment);
  };

  const clampInput = (input, max, allowZero = false) => {
    const minimum = allowZero ? 0 : 1;
    const parsed = Number.parseInt(input.value || String(minimum), 10);
    const value = Math.min(max, Math.max(minimum, Number.isFinite(parsed) ? parsed : minimum));
    input.value = String(value);
    return value;
  };

  const cardInput = (id) => $(`[data-card-quantity="${selectorValue(id)}"]`);
  const quoteInput = (id) => $(`[data-quote-quantity="${selectorValue(id)}"]`);
  const quoteRow = (id) => $(`[data-quote-product="${selectorValue(id)}"]`);

  const updateProductControls = (id) => {
    const product = catalog.get(id);
    if (!product) return;
    const max = Number(product.max ?? product.quantityOwned ?? 0);
    const value = rememberQuantity(id, quantities.get(id));
    const card = cardInput(id);
    const quote = quoteInput(id);
    if (card) card.value = String(value);
    if (quote) quote.value = String(value);
    const add = $(`[data-add-product="${selectorValue(id)}"]`);
    if (add) {
      add.disabled = max < 1;
      add.textContent = max < 1 ? 'Unavailable for Date' : (selectedItems.has(id) ? 'Update Quantity' : 'Add to Quote');
      add.classList.toggle('is-added', selectedItems.has(id));
    }
    $$(`[data-card-step][data-product-id="${selectorValue(id)}"]`).forEach((button) => {
      button.disabled = max < 1 || (Number(button.dataset.cardStep) < 0 ? value <= 1 : value >= max);
    });
    $$(`[data-quote-step][data-product-id="${selectorValue(id)}"]`).forEach((button) => {
      button.disabled = !selectedItems.has(id) || max < 1 || (Number(button.dataset.quoteStep) < 0 ? value <= 1 : value >= max);
    });
  };

  const selectedQuantity = (id) => {
    const product = catalog.get(id);
    if (!product || !selectedItems.has(id)) return 0;
    return rememberQuantity(id, quantities.get(id));
  };

  const updateMobileCta = () => {
    if (!mobileCta || !mobileCtaLabel) return;
    if (selectedItems.size) {
      mobileCta.href = '#quote-builder';
      mobileCtaLabel.textContent = `Review Quote (${selectedItems.size})`;
    } else if (eventDate.value) {
      mobileCta.href = '#available-inventory';
      mobileCtaLabel.textContent = 'Browse Rentals for Your Date';
    } else {
      mobileCta.href = '#availability-check';
      mobileCtaLabel.textContent = 'Check Date & Availability';
    }
  };

  const updateQuote = () => {
    let subtotal = 0;
    let unpriced = false;
    const names = [];
    selectedItems.forEach((id) => {
      const product = catalog.get(id);
      if (!product) return;
      const quantity = selectedQuantity(id);
      if (product.priceCents == null) unpriced = true;
      else subtotal += Number(product.priceCents) * quantity;
      names.push(`${quantity} × ${product.name}`);
    });
    subtotalEl.textContent = `${(subtotal / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}${unpriced ? '*' : ''}`;
    emptyState.hidden = selectedItems.size > 0;
    if (!selectedItems.size) setMessage(summaryMessage, 'Add at least one rental item to begin your quote.');
    else if (!eventDate.value) setMessage(summaryMessage, 'Choose an event date to prepare your request.');
    else setMessage(summaryMessage, `Requested: ${names.join(', ')}.${unpriced ? ' Some pricing will be confirmed separately.' : ''}`, 'availability-message--ready');
    updateMobileCta();
  };

  const addItem = (id) => {
    const product = catalog.get(id);
    if (!product || Number(product.max ?? product.quantityOwned) < 1) return;
    const source = cardInput(id);
    const quantity = clampInput(source, Number(product.max ?? product.quantityOwned));
    quantities.set(id, quantity);
    selectedItems.add(id);
    quoteRow(id).hidden = false;
    updateProductControls(id);
    updateQuote();
  };

  const removeItem = (id, preserveCardQuantity = false) => {
    const product = catalog.get(id);
    if (!product) return;
    selectedItems.delete(id);
    const row = quoteRow(id);
    if (row) row.hidden = true;
    const max = Number(product.max ?? product.quantityOwned ?? 0);
    if (!preserveCardQuantity) quantities.set(id, max > 0 ? 1 : 0);
    else rememberQuantity(id, quantities.get(id));
    updateProductControls(id);
    updateQuote();
  };

  const syncQuickToQuote = () => {
    eventDate.value = quickDate.value;
    eventStart.value = quickStart.value;
    eventEnd.value = quickEnd.value;
    availabilityWindowKey = null;
    updateQuote();
  };

  const syncQuoteToQuick = () => {
    quickDate.value = eventDate.value;
    quickStart.value = eventStart.value;
    quickEnd.value = eventEnd.value;
    availabilityWindowKey = null;
    updateMobileCta();
  };

  const applyAvailability = (products, key) => {
    const availability = new Map(products.map((product) => [product.id, product]));
    catalog.forEach((product, id) => {
      const available = availability.get(id);
      product.max = available ? Number(available.quantityAvailable) : 0;
      if (available) {
        product.quantityOwned = Number(available.quantityOwned);
        product.priceCents = available.priceCents;
        product.description = available.description || product.description;
        product.priceUnit = available.priceUnit || product.priceUnit;
      }
      rememberQuantity(id, quantities.get(id));
      if (product.max < 1) selectedItems.delete(id);
    });
    renderInventory();
    renderQuoteRows();
    selectedItems.forEach((id) => { const row = quoteRow(id); if (row) row.hidden = false; });
    catalog.forEach((_, id) => updateProductControls(id));
    availabilityWindowKey = key;
    updateQuote();
  };

  const checkAvailability = async (scroll = true) => {
    const windowData = eventWindow();
    setMessage(quickMessage, 'Checking live inventory…', 'date-check-message');
    const params = new URLSearchParams({
      eventStartAt: String(windowData.eventStartAt),
      eventEndAt: String(windowData.eventEndAt)
    });
    const response = await fetch(`/api/public/availability?${params}`, { headers: { Accept: 'application/json' } });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || 'Availability could not be checked.');
    applyAvailability(data.products || [], windowData.key);
    const displayDate = new Date(`${eventDate.value}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const beforeHours = Number(data.policy?.bufferBeforeMinutes ?? 240) / 60;
    const afterHours = Number(data.policy?.bufferAfterMinutes ?? 720) / 60;
    setMessage(quickMessage, `Live availability shown for ${displayDate}, ${eventStart.value}–${eventEnd.value}. A ${beforeHours}-hour preparation and ${afterHours}-hour return/cleaning buffer is included.`, 'date-check-message date-check-message--ready');
    if (scroll) $('#available-inventory')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return windowData;
  };

  const loadCatalog = async () => {
    try {
      const response = await fetch('/api/public/catalog', { headers: { Accept: 'application/json' } });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || 'Catalog could not be loaded.');
      catalog.clear();
      (data.products || []).forEach((product) => catalog.set(product.id, { ...product, max: Number(product.quantityOwned) }));
      renderCategories();
      renderInventory();
      renderQuoteRows();
      catalog.forEach((_, id) => updateProductControls(id));
      updateQuote();
    } catch (error) {
      if (inventoryGrid) {
        inventoryGrid.dataset.catalogState = 'ready';
        inventoryGrid.innerHTML = `<div class="catalog-load-state"><h3>Catalog temporarily unavailable</h3><p>${escapeHtml(error.message)}</p></div>`;
      }
      if (categoryGrid) {
        categoryGrid.dataset.catalogState = 'ready';
        categoryGrid.innerHTML = '<div class="catalog-load-state"><h3>Categories temporarily unavailable</h3><p>Please try again shortly.</p></div>';
      }
      setMessage(quickMessage, 'Live inventory is temporarily unavailable. Please contact Regal Rentals.', 'date-check-message date-check-message--error');
    }
  };

  availableFilter?.addEventListener('change', updateCategoryFilter);

  document.addEventListener('click', (event) => {
    const add = event.target.closest('[data-add-product]');
    if (add) { addItem(add.dataset.addProduct); return; }
    const remove = event.target.closest('[data-remove-product]');
    if (remove) { removeItem(remove.dataset.removeProduct); return; }
    const cardStep = event.target.closest('[data-card-step][data-product-id]');
    if (cardStep) {
      const id = cardStep.dataset.productId;
      const product = catalog.get(id);
      const input = cardInput(id);
      if (!product || !input) return;
      input.value = String(Number(input.value || 0) + Number(cardStep.dataset.cardStep || 0));
      quantities.set(id, clampInput(input, Number(product.max ?? product.quantityOwned)));
      updateProductControls(id);
      return;
    }
    const quoteStep = event.target.closest('[data-quote-step][data-product-id]');
    if (quoteStep) {
      const id = quoteStep.dataset.productId;
      const product = catalog.get(id);
      const input = quoteInput(id);
      if (!product || !input || !selectedItems.has(id)) return;
      input.value = String(Number(input.value || 0) + Number(quoteStep.dataset.quoteStep || 0));
      const quantity = clampInput(input, Number(product.max ?? product.quantityOwned));
      quantities.set(id, quantity);
      updateProductControls(id);
      updateQuote();
    }
  });

  document.addEventListener('input', (event) => {
    if (event.target.matches('[data-card-quantity]')) {
      const id = event.target.dataset.cardQuantity;
      const product = catalog.get(id);
      if (!product) return;
      quantities.set(id, clampInput(event.target, Number(product.max ?? product.quantityOwned)));
      updateProductControls(id);
    }
    if (event.target.matches('[data-quote-quantity]')) {
      const id = event.target.dataset.quoteQuantity;
      const product = catalog.get(id);
      if (!product) return;
      const quantity = clampInput(event.target, Number(product.max ?? product.quantityOwned));
      quantities.set(id, quantity);
      updateProductControls(id);
      updateQuote();
    }
  });

  const today = new Date();
  today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
  const minimumDate = today.toISOString().slice(0, 10);
  eventDate.min = minimumDate;
  quickDate.min = minimumDate;

  quickForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!quickForm.reportValidity()) return;
    syncQuickToQuote();
    try { await checkAvailability(true); }
    catch (error) { setMessage(quickMessage, error.message, 'date-check-message date-check-message--error'); }
  });

  eventDate.addEventListener('change', syncQuoteToQuick);
  eventStart.addEventListener('change', syncQuoteToQuick);
  eventEnd.addEventListener('change', syncQuoteToQuick);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    updateQuote();
    if (!selectedItems.size) {
      setMessage(summaryMessage, 'Add at least one rental item before requesting a quote.', 'availability-message--error');
      return;
    }
    if (!form.reportValidity()) return;
    const button = $('button[type="submit"]', form);
    button.disabled = true;
    const originalLabel = button.innerHTML;
    button.textContent = 'Sending Request…';
    try {
      const windowData = eventWindow();
      if (availabilityWindowKey !== windowData.key) await checkAvailability(false);
      if (!selectedItems.size) {
        throw new Error('Availability changed for the selected items. Please choose an available quantity and try again.');
      }
      const data = new FormData(form);
      const items = Array.from(selectedItems, (id) => ({ productId: id, quantity: selectedQuantity(id) }));
      const response = await fetch('/api/public/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': submitKey },
        body: JSON.stringify({
          idempotencyKey: submitKey,
          customer: { name: data.get('name'), email: data.get('email'), phone: data.get('phone') },
          items,
          eventStartAt: windowData.eventStartAt,
          eventEndAt: windowData.eventEndAt,
          serviceType: data.get('serviceType'),
          eventCity: data.get('eventCity'),
          notes: data.get('notes')
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error?.message || 'Your request could not be submitted.');
      setMessage(summaryMessage, `Request ${result.booking.bookingNumber} was received, and the selected equipment is held for 24 hours while Regal Rentals reviews it.`, 'availability-message--ready');
      submitKey = createSubmitKey();
      button.textContent = 'Request Received';
    } catch (error) {
      setMessage(summaryMessage, error.message, 'availability-message--error');
      button.disabled = false;
      button.innerHTML = originalLabel;
    }
  });

  loadCatalog();
})();
