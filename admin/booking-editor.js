(() => {
  const localParts = epoch => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date(epoch * 1000)).map(part => [part.type, part.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
  };
  document.addEventListener('regal:booking', event => {
    const { booking, products } = event.detail;
    const { escapeHtml: esc, money } = RegalAdmin;
    const start = localParts(booking.event_start_at), end = localParts(booking.event_end_at);
    const selected = new Map(booking.items.map(item => [item.product_id, item]));
    const choices = products.filter(product => Number(product.active) || selected.has(product.id));
    let charges = JSON.parse(booking.charges_json || '[]');
    const section = document.createElement('section');
    section.className = 'card booking-editor';
    section.innerHTML = `<details><summary><strong>Edit event, items & quote</strong></summary>
      <p>Dates, quantities and prices are saved together. A conflict leaves the original reservation in place. Changed terms require a new agreement and payment link.</p>
      <form class="form-stack" id="edit-booking-form"><div class="form-grid">
        <label>Start date<input name="startDate" type="date" value="${start.date}" required></label>
        <label>Start time (Pacific)<input name="startTime" type="time" value="${start.time}" required></label>
        <label>Return date<input name="endDate" type="date" value="${end.date}" required></label>
        <label>Return time (Pacific)<input name="endTime" type="time" value="${end.time}" required></label>
        <label>Service<select name="serviceType"><option value="delivery" ${booking.service_type === 'delivery' ? 'selected' : ''}>Delivery</option><option value="pickup" ${booking.service_type === 'pickup' ? 'selected' : ''}>Customer pickup</option></select></label>
        <label>City<input name="eventCity" value="${esc(booking.event_city)}" required></label>
        <label class="full">Address<input name="eventAddress" value="${esc(booking.event_address)}"></label>
        <label class="full">Staff notes<textarea name="notes" rows="3">${esc(booking.notes)}</textarea></label>
      </div><h4>Rental quantities and agreed unit prices</h4><div class="product-picker">
      ${choices.map(product => { const item = selected.get(product.id); const price = item ? item.unit_price_cents : product.price_cents; return `<div class="product-option" data-edit-item="${esc(product.id)}"><h4>${esc(product.name)}</h4><label>Quantity<input data-quantity type="number" min="0" max="100000" step="1" value="${item?.quantity || 0}" required></label><label>Unit price ($)<input data-price type="number" min="0" step="0.01" value="${price == null ? '' : (price / 100).toFixed(2)}" placeholder="Pricing pending"></label></div>`; }).join('')}
      </div><h4>Delivery, services, discounts & tax</h4><p>Enter the charges and tax for this confirmed quote. Discounts reduce the subtotal; refundable security deposits are recorded separately in Payments.</p>
      <div id="quote-charges"></div><button class="button button--quiet" type="button" id="add-quote-charge">Add charge</button>
      <p id="quote-preview" aria-live="polite"></p><button class="button" type="submit">Save booking changes</button>
      <p class="message" id="edit-booking-message" aria-live="polite"></p></form></details>`;
    document.getElementById('booking-detail').appendChild(section);
    const form = section.querySelector('form');
    const readCharges = () => Array.from(section.querySelectorAll('[data-charge-row]')).map(row => ({
      type: row.querySelector('[data-type]').value, description: row.querySelector('[data-description]').value,
      amountCents: Math.round(Number(row.querySelector('[data-amount]').value) * 100)
    }));
    const readItems = () => Array.from(section.querySelectorAll('[data-edit-item]')).map(row => ({
      productId: row.dataset.editItem, quantity: Number(row.querySelector('[data-quantity]').value),
      unitPriceCents: row.querySelector('[data-price]').value === '' ? null : Math.round(Number(row.querySelector('[data-price]').value) * 100)
    })).filter(item => item.quantity > 0);
    const preview = () => {
      const items = readItems(), list = readCharges();
      const total = items.reduce((sum, item) => sum + item.quantity * (item.unitPriceCents || 0), 0) + list.reduce((sum, charge) => sum + charge.amountCents, 0);
      section.querySelector('#quote-preview').textContent = `Quote total: ${money(total)}${items.some(item => item.unitPriceCents == null) ? ' · contains items with pending pricing' : ''}`;
    };
    const renderCharges = () => {
      section.querySelector('#quote-charges').innerHTML = charges.map((charge, index) => `<div class="form-grid quote-charge" data-charge-row>
        <label>Type<select data-type>${['delivery','setup','teardown','discount','tax','other'].map(type => `<option ${type === charge.type ? 'selected' : ''}>${type}</option>`).join('')}</select></label>
        <label>Description<input data-description value="${esc(charge.description)}" maxlength="200" required></label>
        <label>Amount ($)<input data-amount type="number" step="0.01" value="${(charge.amountCents / 100).toFixed(2)}" required></label>
        <button type="button" class="button button--quiet" data-remove-charge="${index}">Remove charge</button></div>`).join('');
      section.querySelectorAll('[data-remove-charge]').forEach(button => button.addEventListener('click', () => {
        charges = readCharges(); charges.splice(Number(button.dataset.removeCharge), 1); renderCharges(); preview();
      }));
    };
    section.querySelector('#add-quote-charge').addEventListener('click', () => {
      charges = readCharges(); if (charges.length >= 30) return;
      charges.push({ type: 'delivery', description: '', amountCents: 0 }); renderCharges();
    });
    form.addEventListener('input', preview);
    form.addEventListener('submit', async event => {
      event.preventDefault(); const button = form.querySelector('[type="submit"]'); button.disabled = true;
      const message = section.querySelector('#edit-booking-message');
      try {
        const data = new FormData(form);
        const eventStartAt = RegalEventTime.pacificEpoch(data.get('startDate'), data.get('startTime'));
        const eventEndAt = RegalEventTime.pacificEpoch(data.get('endDate'), data.get('endTime'));
        if (!eventStartAt || !eventEndAt || eventEndAt <= eventStartAt) throw new Error('Choose a valid start and return time in Pacific Time.');
        const items = readItems(); if (!items.length) throw new Error('Keep at least one rental item.');
        await RegalAdmin.api(`/api/admin/bookings/${encodeURIComponent(booking.id)}`, { method: 'PATCH', body: JSON.stringify({
          revision: booking.revision, eventStartAt, eventEndAt, items, charges: readCharges(),
          serviceType: data.get('serviceType'), eventCity: data.get('eventCity'), eventAddress: data.get('eventAddress'), notes: data.get('notes')
        }) });
        await RegalAdmin.openBooking(booking.id); await RegalAdmin.refreshBookings();
      } catch (error) { RegalAdmin.showMessage(message, error.message, 'error'); }
      finally { button.disabled = false; }
    });
    renderCharges(); preview();
  });
})();
