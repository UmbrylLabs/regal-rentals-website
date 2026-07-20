(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const availableFilter = $('#available-now-filter');
  const categoryCards = $$('[data-category-availability]');
  const categoryEmpty = $('#category-empty');
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

  const inventory = {
    roundTables: {
      productId: 'round-table-60', owned: 3, max: 3, price: 16,
      cardInput: $('#round-table-card-quantity'), quoteInput: $('#round-table-quantity'),
      row: $('[data-quote-row="roundTables"]'), card: $('[data-inventory-item="roundTables"]'),
      badge: $('#round-tables-availability'), addButton: $('[data-add-item="roundTables"]'),
      removeButton: $('[data-remove-item="roundTables"]'), singular: '60-inch round table', plural: '60-inch round tables'
    },
    rectangleTables: {
      productId: 'rectangle-table-6', owned: 2, max: 2, price: 14,
      cardInput: $('#rectangle-table-card-quantity'), quoteInput: $('#rectangle-table-quantity'),
      row: $('[data-quote-row="rectangleTables"]'), card: $('[data-inventory-item="rectangleTables"]'),
      badge: $('#rectangle-tables-availability'), addButton: $('[data-add-item="rectangleTables"]'),
      removeButton: $('[data-remove-item="rectangleTables"]'), singular: '6-foot rectangular table', plural: '6-foot rectangular tables'
    },
    canopy: {
      productId: 'canopy-10x10', owned: 1, max: 1, price: null,
      cardInput: $('#canopy-card-quantity'), quoteInput: $('#canopy-quantity'),
      row: $('[data-quote-row="canopy"]'), card: $('[data-inventory-item="canopy"]'),
      badge: $('#canopy-availability'), addButton: $('[data-add-item="canopy"]'),
      removeButton: $('[data-remove-item="canopy"]'), singular: '10×10 pop-up canopy', plural: '10×10 pop-up canopies'
    }
  };

  const selectedItems = new Set();
  let availabilityWindowKey = null;
  let submitKey = crypto.randomUUID();

  const setMessage = (element, text, className = '') => {
    if (!element) return;
    element.textContent = text;
    element.className = className;
  };

  const localEpoch = (date, time) => {
    if (!date || !time) return null;
    const parsed = new Date(`${date}T${time}:00`);
    const epoch = Math.floor(parsed.getTime() / 1000);
    return Number.isFinite(epoch) ? epoch : null;
  };

  const eventWindow = () => {
    const startAt = localEpoch(eventDate.value, eventStart.value);
    const endAt = localEpoch(eventDate.value, eventEnd.value);
    if (!startAt || !endAt || endAt <= startAt) throw new Error('Choose a valid same-day event start and end time.');
    return {
      eventStartAt: startAt,
      eventEndAt: endAt,
      blockStartAt: startAt - 120 * 60,
      blockEndAt: endAt + 120 * 60,
      key: `${startAt}:${endAt}`
    };
  };

  const updateCategoryFilter = () => {
    if (!availableFilter) return;
    let visible = 0;
    categoryCards.forEach((card) => {
      const hidden = availableFilter.checked && card.dataset.categoryAvailability !== 'available';
      card.hidden = hidden;
      if (!hidden) visible += 1;
    });
    if (categoryEmpty) categoryEmpty.hidden = visible > 0;
  };

  const clamp = (input, max, allowZero = false) => {
    const minimum = allowZero ? 0 : 1;
    const parsed = Number.parseInt(input.value || String(minimum), 10);
    const value = Math.min(max, Math.max(minimum, Number.isFinite(parsed) ? parsed : minimum));
    input.value = String(value);
    return value;
  };

  const updateButtons = (key) => {
    const item = inventory[key];
    const unavailable = item.max < 1;
    const cardQuantity = unavailable ? 0 : clamp(item.cardInput, item.max);
    const quoteQuantity = unavailable ? 0 : clamp(item.quoteInput, item.max);
    item.cardInput.disabled = unavailable;
    item.addButton.disabled = unavailable;
    item.addButton.textContent = unavailable ? 'Unavailable for Date' : (selectedItems.has(key) ? 'Update Quantity' : 'Add to Quote');
    [
      [`[data-card-step="-1"][data-item="${key}"]`, cardQuantity <= 1 || unavailable],
      [`[data-card-step="1"][data-item="${key}"]`, cardQuantity >= item.max || unavailable],
      [`[data-quote-step="-1"][data-item="${key}"]`, quoteQuantity <= 1 || unavailable],
      [`[data-quote-step="1"][data-item="${key}"]`, quoteQuantity >= item.max || unavailable]
    ].forEach(([selector, disabled]) => { const button = $(selector); if (button) button.disabled = disabled; });
  };

  const removeItem = (key, preserveCardQuantity = false) => {
    const item = inventory[key];
    selectedItems.delete(key);
    item.row.hidden = true;
    item.addButton.classList.remove('is-added');
    if (!preserveCardQuantity) item.cardInput.value = item.max > 0 ? '1' : '0';
    item.quoteInput.value = item.max > 0 ? '1' : '0';
    updateButtons(key);
    updateQuote();
  };

  const addItem = (key) => {
    const item = inventory[key];
    if (item.max < 1) return;
    const quantity = clamp(item.cardInput, item.max);
    selectedItems.add(key);
    item.quoteInput.value = String(quantity);
    item.row.hidden = false;
    item.addButton.classList.add('is-added');
    updateButtons(key);
    updateQuote();
  };

  const selectedQuantity = (key) => selectedItems.has(key) ? clamp(inventory[key].quoteInput, inventory[key].max) : 0;

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
    selectedItems.forEach((key) => {
      const item = inventory[key];
      const quantity = selectedQuantity(key);
      if (item.price == null) unpriced = true; else subtotal += item.price * quantity;
      names.push(`${quantity} ${quantity === 1 ? item.singular : item.plural}`);
    });
    subtotalEl.textContent = `${subtotal.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}${unpriced ? '*' : ''}`;
    emptyState.hidden = selectedItems.size > 0;
    if (!selectedItems.size) setMessage(summaryMessage, 'Add at least one rental item to begin your quote.');
    else if (!eventDate.value) setMessage(summaryMessage, 'Choose an event date to prepare your request.');
    else setMessage(summaryMessage, `Requested: ${names.join(', ')}.${unpriced ? ' Canopy pricing will be confirmed separately.' : ''}`, 'availability-message--ready');
    updateMobileCta();
  };

  const syncQuickToQuote = () => { eventDate.value = quickDate.value; eventStart.value = quickStart.value; eventEnd.value = quickEnd.value; availabilityWindowKey = null; updateQuote(); };
  const syncQuoteToQuick = () => { quickDate.value = eventDate.value; quickStart.value = eventStart.value; quickEnd.value = eventEnd.value; availabilityWindowKey = null; updateMobileCta(); };

  const applyAvailability = (products, key) => {
    const map = new Map(products.map((product) => [product.id, product]));
    Object.entries(inventory).forEach(([itemKey, item]) => {
      const product = map.get(item.productId);
      item.max = product ? Number(product.quantityAvailable) : 0;
      item.owned = product ? Number(product.quantityOwned) : item.owned;
      item.cardInput.max = String(item.max);
      item.quoteInput.max = String(item.max);
      if (item.max < 1) {
        item.badge.textContent = 'Unavailable';
        item.card?.classList.add('inventory-card--unavailable');
        if (selectedItems.has(itemKey)) removeItem(itemKey, true);
        item.cardInput.value = '0'; item.quoteInput.value = '0';
      } else {
        item.badge.textContent = `${item.max} available for your date`;
        item.card?.classList.remove('inventory-card--unavailable');
        if (Number(item.cardInput.value) < 1) item.cardInput.value = '1';
        if (Number(item.quoteInput.value) < 1) item.quoteInput.value = '1';
        clamp(item.cardInput, item.max); clamp(item.quoteInput, item.max);
      }
      const description = $('span', item.row);
      if (description) description.textContent = `${item.price == null ? 'Pricing to be confirmed' : `$${item.price} each`} · Maximum ${item.max} for this date`;
      updateButtons(itemKey);
    });
    availabilityWindowKey = key;
    updateQuote();
  };

  const checkAvailability = async (scroll = true) => {
    const windowData = eventWindow();
    setMessage(quickMessage, 'Checking live inventory…', 'date-check-message');
    const response = await fetch(`/api/public/availability?startAt=${windowData.blockStartAt}&endAt=${windowData.blockEndAt}`, { headers: { Accept: 'application/json' } });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || 'Availability could not be checked.');
    applyAvailability(data.products || [], windowData.key);
    const displayDate = new Date(`${eventDate.value}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    setMessage(quickMessage, `Live availability shown for ${displayDate}, ${eventStart.value}–${eventEnd.value}. A two-hour preparation and return buffer is included.`, 'date-check-message date-check-message--ready');
    if (scroll) $('#available-inventory')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return windowData;
  };

  availableFilter?.addEventListener('change', updateCategoryFilter);
  updateCategoryFilter();
  Object.entries(inventory).forEach(([key, item]) => {
    item.row.hidden = true;
    item.addButton.addEventListener('click', () => addItem(key));
    item.removeButton.addEventListener('click', () => removeItem(key));
    item.cardInput.addEventListener('input', () => updateButtons(key));
    item.quoteInput.addEventListener('input', () => { const quantity = clamp(item.quoteInput, item.max); item.cardInput.value = String(quantity); updateButtons(key); updateQuote(); });
    updateButtons(key);
  });

  $$('[data-card-step][data-item]').forEach((button) => button.addEventListener('click', () => {
    const item = inventory[button.dataset.item];
    if (!item || item.max < 1) return;
    item.cardInput.value = String(clamp(item.cardInput, item.max) + Number(button.dataset.cardStep || 0));
    clamp(item.cardInput, item.max); updateButtons(button.dataset.item);
  }));
  $$('[data-quote-step][data-item]').forEach((button) => button.addEventListener('click', () => {
    const key = button.dataset.item; const item = inventory[key];
    if (!item || !selectedItems.has(key) || item.max < 1) return;
    item.quoteInput.value = String(clamp(item.quoteInput, item.max) + Number(button.dataset.quoteStep || 0));
    const quantity = clamp(item.quoteInput, item.max); item.cardInput.value = String(quantity); updateButtons(key); updateQuote();
  }));

  const today = new Date(); today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
  const minimumDate = today.toISOString().slice(0, 10); eventDate.min = minimumDate; quickDate.min = minimumDate;
  quickForm?.addEventListener('submit', async (event) => { event.preventDefault(); if (!quickForm.reportValidity()) return; syncQuickToQuote(); try { await checkAvailability(true); } catch (error) { setMessage(quickMessage, error.message, 'date-check-message date-check-message--error'); } });
  eventDate.addEventListener('change', syncQuoteToQuick); eventStart.addEventListener('change', syncQuoteToQuick); eventEnd.addEventListener('change', syncQuoteToQuick);

  form.addEventListener('submit', async (event) => {
    event.preventDefault(); updateQuote();
    if (!selectedItems.size) { setMessage(summaryMessage, 'Add at least one rental item before requesting a quote.', 'availability-message--error'); return; }
    if (!form.reportValidity()) return;
    const button = $('button[type="submit"]', form); button.disabled = true; const originalLabel = button.innerHTML; button.textContent = 'Sending Request…';
    try {
      const windowData = eventWindow();
      if (availabilityWindowKey !== windowData.key) await checkAvailability(false);
      const data = new FormData(form);
      const items = Array.from(selectedItems, (key) => ({ productId: inventory[key].productId, quantity: selectedQuantity(key) }));
      const response = await fetch('/api/public/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': submitKey },
        body: JSON.stringify({ idempotencyKey: submitKey, customer: { name: data.get('name'), email: data.get('email'), phone: data.get('phone') }, items, eventStartAt: windowData.eventStartAt, eventEndAt: windowData.eventEndAt, bufferBeforeMinutes: 120, bufferAfterMinutes: 120, serviceType: data.get('serviceType'), eventCity: data.get('eventCity'), notes: data.get('notes') })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error?.message || 'Your request could not be submitted.');
      setMessage(summaryMessage, `Request ${result.booking.bookingNumber} was received. Regal Rentals will contact you to confirm the reservation.`, 'availability-message--ready');
      submitKey = crypto.randomUUID(); button.textContent = 'Request Received';
    } catch (error) {
      setMessage(summaryMessage, error.message, 'availability-message--error');
      button.disabled = false; button.innerHTML = originalLabel;
    }
  });

  updateQuote();
})();
