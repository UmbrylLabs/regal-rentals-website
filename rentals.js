(() => {
  const form = document.getElementById('availability-form');
  if (!form) return;

  const subtotalEl = document.getElementById('quote-subtotal');
  const messageEl = document.getElementById('availability-message');
  const dateInput = document.getElementById('event-date');
  const emptyState = document.getElementById('selected-rentals-empty');

  const inventory = {
    chairs: {
      max: 60,
      price: 3.5,
      input: document.getElementById('chair-quantity'),
      row: document.querySelector('[data-quote-row="chairs"]'),
      addButton: document.querySelector('[data-add-item="chairs"]'),
      singular: 'chair',
      plural: 'chairs'
    },
    tables: {
      max: 8,
      price: 16,
      input: document.getElementById('table-quantity'),
      row: document.querySelector('[data-quote-row="tables"]'),
      addButton: document.querySelector('[data-add-item="tables"]'),
      singular: 'table',
      plural: 'tables'
    }
  };

  const selectedItems = new Set();

  const clampQuantity = (itemKey) => {
    const item = inventory[itemKey];
    const parsed = Number.parseInt(item.input.value || '1', 10);
    const quantity = Math.min(item.max, Math.max(1, Number.isFinite(parsed) ? parsed : 1));
    item.input.value = String(quantity);
    return quantity;
  };

  const updateStepButtons = (itemKey) => {
    const item = inventory[itemKey];
    const quantity = clampQuantity(itemKey);
    const minusButton = item.row.querySelector('[data-step="-1"]');
    const plusButton = item.row.querySelector('[data-step="1"]');

    if (minusButton) minusButton.disabled = quantity <= 1;
    if (plusButton) plusButton.disabled = quantity >= item.max;
  };

  const selectedQuantity = (itemKey) => {
    if (!selectedItems.has(itemKey)) return 0;
    return clampQuantity(itemKey);
  };

  const updateSummary = () => {
    const chairs = selectedQuantity('chairs');
    const tables = selectedQuantity('tables');
    const subtotal = chairs * inventory.chairs.price + tables * inventory.tables.price;

    subtotalEl.textContent = subtotal.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD'
    });

    messageEl.className = '';

    if (selectedItems.size === 0) {
      messageEl.textContent = 'Add at least one rental item to begin your quote.';
      return;
    }

    if (!dateInput.value) {
      messageEl.textContent = 'Choose an event date to prepare your quote request.';
      return;
    }

    const requested = [];
    if (chairs > 0) requested.push(`${chairs} ${chairs === 1 ? inventory.chairs.singular : inventory.chairs.plural}`);
    if (tables > 0) requested.push(`${tables} ${tables === 1 ? inventory.tables.singular : inventory.tables.plural}`);

    messageEl.textContent = `Requested: ${requested.join(' and ')}. Final availability will be confirmed by Regal Rentals.`;
    messageEl.classList.add('availability-message--ready');
  };

  const addItemToQuote = (itemKey) => {
    const item = inventory[itemKey];
    if (!item || selectedItems.has(itemKey)) return;

    selectedItems.add(itemKey);
    item.input.value = '1';
    item.row.hidden = false;
    item.row.classList.add('is-selected');
    item.addButton.disabled = true;
    item.addButton.classList.add('is-added');
    item.addButton.textContent = 'Added to Quote ✓';
    emptyState.hidden = true;

    updateStepButtons(itemKey);
    updateSummary();
  };

  Object.entries(inventory).forEach(([itemKey, item]) => {
    item.row.hidden = true;
    item.row.classList.remove('is-selected');

    item.addButton.addEventListener('click', () => addItemToQuote(itemKey));

    item.input.addEventListener('input', () => {
      clampQuantity(itemKey);
      updateStepButtons(itemKey);
      updateSummary();
    });

    item.input.addEventListener('change', () => {
      clampQuantity(itemKey);
      updateStepButtons(itemKey);
      updateSummary();
    });
  });

  document.querySelectorAll('[data-step][data-item]').forEach((button) => {
    button.addEventListener('click', () => {
      const itemKey = button.dataset.item;
      const item = inventory[itemKey];
      if (!item || !selectedItems.has(itemKey)) return;

      const current = clampQuantity(itemKey);
      item.input.value = String(current + Number(button.dataset.step || 0));
      clampQuantity(itemKey);
      updateStepButtons(itemKey);
      updateSummary();
    });
  });

  dateInput.addEventListener('input', updateSummary);
  dateInput.addEventListener('change', updateSummary);

  const today = new Date();
  today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
  dateInput.min = today.toISOString().slice(0, 10);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    updateSummary();

    const chairs = selectedQuantity('chairs');
    const tables = selectedQuantity('tables');

    if (selectedItems.size === 0 || (chairs === 0 && tables === 0)) {
      messageEl.textContent = 'Add at least one chair or table before requesting a quote.';
      messageEl.className = 'availability-message--error';
      return;
    }

    if (!form.reportValidity()) return;

    const data = new FormData(form);
    const subtotal = chairs * inventory.chairs.price + tables * inventory.tables.price;
    const lines = [
      'Regal Rentals Quote Request',
      '',
      `Name: ${data.get('name') || ''}`,
      `Phone: ${data.get('phone') || ''}`,
      `Email: ${data.get('email') || ''}`,
      `Event date: ${data.get('eventDate') || ''}`,
      `Event time: ${data.get('eventStart') || ''} to ${data.get('eventEnd') || ''}`,
      `Service type: ${data.get('serviceType') || ''}`,
      `Event city: ${data.get('eventCity') || ''}`,
      '',
      `White resin folding chairs: ${chairs} at $3.50 each`,
      `60-inch round tables: ${tables} at $16 each`,
      `Estimated rental subtotal: $${subtotal.toFixed(2)}`,
      '',
      'Event notes:',
      `${data.get('notes') || ''}`,
      '',
      'This request does not reserve inventory. Regal Rentals will confirm availability and final pricing.'
    ];

    const subject = encodeURIComponent(`Regal Rentals quote request - ${data.get('eventDate') || 'event'}`);
    const body = encodeURIComponent(lines.join('\n'));
    window.location.href = `mailto:bookings@regal.rentals?subject=${subject}&body=${body}`;
  });

  emptyState.hidden = false;
  updateSummary();
})();
