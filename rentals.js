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
      cardInput: document.getElementById('chair-card-quantity'),
      quoteInput: document.getElementById('chair-quantity'),
      row: document.querySelector('[data-quote-row="chairs"]'),
      addButton: document.querySelector('[data-add-item="chairs"]'),
      removeButton: document.querySelector('[data-remove-item="chairs"]'),
      addLabel: 'Add Chairs to Quote',
      updateLabel: 'Update Chair Quantity',
      singular: 'chair',
      plural: 'chairs'
    },
    tables: {
      max: 8,
      price: 16,
      cardInput: document.getElementById('table-card-quantity'),
      quoteInput: document.getElementById('table-quantity'),
      row: document.querySelector('[data-quote-row="tables"]'),
      addButton: document.querySelector('[data-add-item="tables"]'),
      removeButton: document.querySelector('[data-remove-item="tables"]'),
      addLabel: 'Add Tables to Quote',
      updateLabel: 'Update Table Quantity',
      singular: 'table',
      plural: 'tables'
    }
  };

  const selectedItems = new Set();

  const clampInput = (input, max) => {
    const parsed = Number.parseInt(input.value || '1', 10);
    const quantity = Math.min(max, Math.max(1, Number.isFinite(parsed) ? parsed : 1));
    input.value = String(quantity);
    return quantity;
  };

  const updateStepButtons = (itemKey) => {
    const item = inventory[itemKey];
    const cardQuantity = clampInput(item.cardInput, item.max);
    const quoteQuantity = clampInput(item.quoteInput, item.max);

    const cardMinus = document.querySelector(`[data-card-step="-1"][data-item="${itemKey}"]`);
    const cardPlus = document.querySelector(`[data-card-step="1"][data-item="${itemKey}"]`);
    const quoteMinus = document.querySelector(`[data-quote-step="-1"][data-item="${itemKey}"]`);
    const quotePlus = document.querySelector(`[data-quote-step="1"][data-item="${itemKey}"]`);

    if (cardMinus) cardMinus.disabled = cardQuantity <= 1;
    if (cardPlus) cardPlus.disabled = cardQuantity >= item.max;
    if (quoteMinus) quoteMinus.disabled = quoteQuantity <= 1;
    if (quotePlus) quotePlus.disabled = quoteQuantity >= item.max;
  };

  const selectedQuantity = (itemKey) => {
    if (!selectedItems.has(itemKey)) return 0;
    return clampInput(inventory[itemKey].quoteInput, inventory[itemKey].max);
  };

  const updateEmptyState = () => {
    emptyState.hidden = selectedItems.size > 0;
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

  const addOrUpdateItem = (itemKey) => {
    const item = inventory[itemKey];
    if (!item) return;

    const quantity = clampInput(item.cardInput, item.max);
    selectedItems.add(itemKey);
    item.quoteInput.value = String(quantity);
    item.row.hidden = false;
    item.row.classList.add('is-selected');
    item.addButton.classList.add('is-added');
    item.addButton.textContent = item.updateLabel;

    updateEmptyState();
    updateStepButtons(itemKey);
    updateSummary();
  };

  const removeItem = (itemKey) => {
    const item = inventory[itemKey];
    if (!item || !selectedItems.has(itemKey)) return;

    selectedItems.delete(itemKey);
    item.row.hidden = true;
    item.row.classList.remove('is-selected');
    item.cardInput.value = '1';
    item.quoteInput.value = '1';
    item.addButton.classList.remove('is-added');
    item.addButton.textContent = item.addLabel;

    updateEmptyState();
    updateStepButtons(itemKey);
    updateSummary();
  };

  Object.entries(inventory).forEach(([itemKey, item]) => {
    item.row.hidden = true;
    item.row.classList.remove('is-selected');
    item.addButton.textContent = item.addLabel;

    item.addButton.addEventListener('click', () => addOrUpdateItem(itemKey));
    item.removeButton.addEventListener('click', () => removeItem(itemKey));

    item.cardInput.addEventListener('input', () => {
      clampInput(item.cardInput, item.max);
      updateStepButtons(itemKey);
    });

    item.cardInput.addEventListener('change', () => {
      clampInput(item.cardInput, item.max);
      updateStepButtons(itemKey);
    });

    item.quoteInput.addEventListener('input', () => {
      const quantity = clampInput(item.quoteInput, item.max);
      item.cardInput.value = String(quantity);
      updateStepButtons(itemKey);
      updateSummary();
    });

    item.quoteInput.addEventListener('change', () => {
      const quantity = clampInput(item.quoteInput, item.max);
      item.cardInput.value = String(quantity);
      updateStepButtons(itemKey);
      updateSummary();
    });

    updateStepButtons(itemKey);
  });

  document.querySelectorAll('[data-card-step][data-item]').forEach((button) => {
    button.addEventListener('click', () => {
      const itemKey = button.dataset.item;
      const item = inventory[itemKey];
      if (!item) return;

      const current = clampInput(item.cardInput, item.max);
      item.cardInput.value = String(current + Number(button.dataset.cardStep || 0));
      clampInput(item.cardInput, item.max);
      updateStepButtons(itemKey);
    });
  });

  document.querySelectorAll('[data-quote-step][data-item]').forEach((button) => {
    button.addEventListener('click', () => {
      const itemKey = button.dataset.item;
      const item = inventory[itemKey];
      if (!item || !selectedItems.has(itemKey)) return;

      const current = clampInput(item.quoteInput, item.max);
      item.quoteInput.value = String(current + Number(button.dataset.quoteStep || 0));
      const quantity = clampInput(item.quoteInput, item.max);
      item.cardInput.value = String(quantity);
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
    const itemLines = [];
    if (chairs > 0) itemLines.push(`White resin folding chairs: ${chairs} at $3.50 each`);
    if (tables > 0) itemLines.push(`60-inch round tables: ${tables} at $16 each`);

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
      ...itemLines,
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

  updateEmptyState();
  updateSummary();
})();
