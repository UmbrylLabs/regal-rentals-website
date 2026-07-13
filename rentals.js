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
      button: document.querySelector('[data-add-item="chairs"]'),
      label: 'chair'
    },
    tables: {
      max: 8,
      price: 16,
      cardInput: document.getElementById('table-card-quantity'),
      quoteInput: document.getElementById('table-quantity'),
      row: document.querySelector('[data-quote-row="tables"]'),
      button: document.querySelector('[data-add-item="tables"]'),
      label: 'table'
    }
  };

  const selectedItems = new Set();

  const clamp = (input) => {
    const min = Number(input.min || 0);
    const max = Number(input.max || 9999);
    const parsed = Number.parseInt(input.value || String(min), 10);
    const value = Math.min(max, Math.max(min, Number.isFinite(parsed) ? parsed : min));
    input.value = value;
    return value;
  };

  const itemQuantity = (itemKey) => {
    if (!selectedItems.has(itemKey)) return 0;
    return clamp(inventory[itemKey].quoteInput);
  };

  const updateSelectedRows = () => {
    Object.entries(inventory).forEach(([itemKey, item]) => {
      item.row.hidden = !selectedItems.has(itemKey);
    });
    emptyState.hidden = selectedItems.size > 0;
  };

  const updateSummary = () => {
    const chairs = itemQuantity('chairs');
    const tables = itemQuantity('tables');
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
    if (chairs > 0) requested.push(`${chairs} chair${chairs === 1 ? '' : 's'}`);
    if (tables > 0) requested.push(`${tables} table${tables === 1 ? '' : 's'}`);

    messageEl.textContent = `Requested: ${requested.join(' and ')}. Final availability will be confirmed by Regal Rentals.`;
    messageEl.classList.add('availability-message--ready');
  };

  const syncFromInput = (input) => {
    const value = clamp(input);

    Object.entries(inventory).forEach(([itemKey, item]) => {
      if (input === item.cardInput && selectedItems.has(itemKey)) {
        item.quoteInput.value = value;
      }
      if (input === item.quoteInput) {
        item.cardInput.value = value;
      }
    });

    updateSummary();
  };

  document.querySelectorAll('[data-step]').forEach((button) => {
    button.addEventListener('click', () => {
      const target = document.getElementById(button.dataset.target);
      if (!target) return;
      target.value = Number(target.value || target.min || 0) + Number(button.dataset.step || 0);
      syncFromInput(target);
    });
  });

  Object.values(inventory).forEach((item) => {
    [item.cardInput, item.quoteInput].forEach((input) => {
      input.addEventListener('input', () => syncFromInput(input));
      input.addEventListener('change', () => syncFromInput(input));
    });

    item.button.addEventListener('click', () => {
      const itemKey = item.button.dataset.addItem;
      const quantity = clamp(item.cardInput);

      selectedItems.add(itemKey);
      item.quoteInput.value = quantity;
      item.button.classList.add('is-added');
      item.button.textContent = 'Added ✓';
      updateSelectedRows();
      updateSummary();

      window.setTimeout(() => {
        if (selectedItems.has(itemKey)) item.button.textContent = 'Update Quote';
      }, 900);
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

    const chairs = itemQuantity('chairs');
    const tables = itemQuantity('tables');

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

  updateSelectedRows();
  updateSummary();
})();
