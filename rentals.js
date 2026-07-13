(() => {
  const form = document.getElementById('availability-form');
  if (!form) return;

  const chairInput = document.getElementById('chair-quantity');
  const tableInput = document.getElementById('table-quantity');
  const subtotalEl = document.getElementById('quote-subtotal');
  const messageEl = document.getElementById('availability-message');
  const dateInput = document.getElementById('event-date');

  const inventory = {
    chairs: { max: 60, price: 3.5 },
    tables: { max: 8, price: 16 }
  };

  const clamp = (input) => {
    const min = Number(input.min || 0);
    const max = Number(input.max || 9999);
    const value = Number.parseInt(input.value || '0', 10);
    input.value = Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));
  };

  const updateSummary = () => {
    clamp(chairInput);
    clamp(tableInput);

    const chairs = Number(chairInput.value);
    const tables = Number(tableInput.value);
    const subtotal = chairs * inventory.chairs.price + tables * inventory.tables.price;

    subtotalEl.textContent = subtotal.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD'
    });

    messageEl.className = '';
    if (chairs === 0 && tables === 0) {
      messageEl.textContent = 'Select at least one rental item to continue.';
      return;
    }

    const date = dateInput.value;
    if (!date) {
      messageEl.textContent = 'Choose an event date to prepare your quote request.';
      return;
    }

    messageEl.textContent = `Requested: ${chairs} chair${chairs === 1 ? '' : 's'} and ${tables} table${tables === 1 ? '' : 's'}. Final availability will be confirmed by Regal Rentals.`;
    messageEl.classList.add('availability-message--ready');
  };

  document.querySelectorAll('[data-step]').forEach((button) => {
    button.addEventListener('click', () => {
      const target = document.getElementById(button.dataset.target);
      if (!target) return;
      target.value = Number(target.value || 0) + Number(button.dataset.step || 0);
      updateSummary();
    });
  });

  [chairInput, tableInput, dateInput].forEach((input) => {
    input.addEventListener('input', updateSummary);
    input.addEventListener('change', updateSummary);
  });

  const today = new Date();
  today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
  dateInput.min = today.toISOString().slice(0, 10);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    updateSummary();

    const chairs = Number(chairInput.value);
    const tables = Number(tableInput.value);

    if (chairs === 0 && tables === 0) {
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

  updateSummary();
})();