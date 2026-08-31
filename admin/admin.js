(() => {
  const state = { user: null, bookings: [], products: [], availability: new Map(), currentBooking: null, users: [] };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const loginView = $('#login-view');
  const dashboardView = $('#dashboard-view');
  const loginMessage = $('#login-message');
  const bookingForm = $('#booking-form');
  const bookingMessage = $('#booking-message');
  const productForm = $('#product-form');
  const productMessage = $('#product-message');

  const styleIcons = {
    'round-table': '◯', 'rectangle-table': '▭', chair: '♜', canopy: '⌂', tent: '△',
    game: '★', 'mini-golf': '⚑', 'photo-booth': '◉', audio: '♫', visual: '▣',
    lighting: '✦', decor: '❖', other: '◆'
  };

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

  const api = async (path, options = {}) => {
    const response = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    let data;
    try { data = await response.json(); }
    catch { data = { ok: false, error: { message: 'The server returned an invalid response.' } }; }
    if (!response.ok) {
      const error = new Error(data?.error?.message || 'Request failed.');
      error.code = data?.error?.code;
      error.status = response.status;
      throw error;
    }
    return data;
  };

  const showMessage = (element, message, type = '') => {
    if (!element) return;
    element.textContent = message || '';
    element.className = `message ${type}`.trim();
  };

  const formatDate = (epoch) => new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short'
  }).format(new Date(Number(epoch) * 1000));

  const money = (cents) => cents == null
    ? 'Pricing pending'
    : (Number(cents) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

  const openPanel = (name) => {
    $$('[data-panel-view]').forEach((panel) => { panel.hidden = panel.dataset.panelView !== name; });
    $$('.nav-button').forEach((button) => button.classList.toggle('is-active', button.dataset.panel === name));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const bookingWindow = () => {
    const data = new FormData(bookingForm);
    const eventStartAt = RegalEventTime.pacificEpoch(data.get('eventDate'), data.get('eventStart'));
    const eventEndAt = RegalEventTime.pacificEpoch(data.get('eventDate'), data.get('eventEnd'));
    if (!eventStartAt || !eventEndAt || eventEndAt <= eventStartAt) {
      throw new Error('Choose a valid date, start time, and end time in Pacific Time.');
    }
    const before = Number(data.get('bufferBefore') || 0);
    const after = Number(data.get('bufferAfter') || 0);
    return { eventStartAt, eventEndAt, bufferBeforeMinutes: before, bufferAfterMinutes: after };
  };

  const selectedItems = () => $$('.product-option', $('#booking-product-picker'))
    .map((card) => ({ productId: card.dataset.productId, quantity: Number($('input[type="number"]', card).value || 0) }))
    .filter((item) => Number.isInteger(item.quantity) && item.quantity > 0);

  const renderProductPicker = () => {
    const picker = $('#booking-product-picker');
    const activeProducts = state.products.filter((product) => Number(product.active) === 1);
    if (!activeProducts.length) {
      picker.innerHTML = '<p>No active rental items are available. Add an item in Inventory first.</p>';
      return;
    }
    picker.innerHTML = activeProducts.map((product) => {
      const available = state.availability.has(product.id)
        ? state.availability.get(product.id)
        : Number(product.quantity_owned);
      return `<div class="product-option${available < 1 ? ' is-unavailable' : ''}" data-product-id="${escapeHtml(product.id)}">
        <h4>${escapeHtml(product.name)}</h4>
        <p>${escapeHtml(product.category)} · ${escapeHtml(money(product.price_cents))} · ${available} available</p>
        <label>Quantity<input type="number" min="0" max="${available}" value="0" inputmode="numeric" ${available < 1 ? 'disabled' : ''} /></label>
      </div>`;
    }).join('');
  };

  const loadProducts = async () => {
    const data = await api('/api/admin/products');
    state.products = data.products || [];
    renderProductPicker();
    renderInventory();
  };

  const loadBookings = async () => {
    const data = await api('/api/admin/bookings?limit=200');
    state.bookings = data.bookings || [];
    renderBookings();
    renderOverview();
  };

  const renderOverview = () => {
    const now = Math.floor(Date.now() / 1000);
    const active = state.bookings.filter((booking) => ['hold', 'confirmed', 'paid', 'ready', 'out', 'returned'].includes(booking.status));
    const upcoming = state.bookings.filter((booking) => Number(booking.event_end_at) >= now && !['completed', 'cancelled', 'expired'].includes(booking.status)).slice(0, 8);
    const inquiries = state.bookings.filter((booking) => booking.status === 'inquiry').length;
    const onRent = state.bookings.filter((booking) => booking.status === 'out').length;
    $('#stat-grid').innerHTML = [['Upcoming', upcoming.length], ['Active reservations', active.length], ['New inquiries', inquiries], ['Out on rental', onRent]]
      .map(([label, value]) => `<div class="stat"><strong>${value}</strong><span>${escapeHtml(label)}</span></div>`).join('');
    const list = $('#upcoming-list');
    if (!upcoming.length) { list.innerHTML = '<p>No upcoming bookings yet.</p>'; return; }
    list.innerHTML = upcoming.map((booking) => `<div class="upcoming-row"><div><strong>${escapeHtml(booking.booking_number)} · ${escapeHtml(booking.customer_name)}</strong><p>${escapeHtml(formatDate(booking.event_start_at))} · ${escapeHtml(booking.event_city)}</p></div><button class="button button--quiet" type="button" data-view-booking="${escapeHtml(booking.id)}">Open</button></div>`).join('');
    $$('[data-view-booking]', list).forEach((button) => button.addEventListener('click', () => openBooking(button.dataset.viewBooking)));
  };

  const renderBookings = () => {
    const tbody = $('#bookings-table-body');
    if (!state.bookings.length) { tbody.innerHTML = '<tr><td colspan="6">No bookings found.</td></tr>'; return; }
    tbody.innerHTML = state.bookings.map((booking) => `<tr><td><strong>${escapeHtml(booking.booking_number)}</strong></td><td>${escapeHtml(booking.customer_name)}</td><td>${escapeHtml(formatDate(booking.event_start_at))}<br><small>${escapeHtml(booking.event_city)}</small></td><td><span class="status status--${escapeHtml(booking.status)}">${escapeHtml(booking.status)}</span></td><td>${Number(booking.total_units)}</td><td><button class="button button--quiet" type="button" data-view-booking="${escapeHtml(booking.id)}">Open</button></td></tr>`).join('');
    $$('[data-view-booking]', tbody).forEach((button) => button.addEventListener('click', () => openBooking(button.dataset.viewBooking)));
  };

  const renderInventory = () => {
    const list = $('#inventory-list');
    const active = state.products.filter((product) => Number(product.active) === 1);
    const archived = state.products.length - active.length;
    const units = active.reduce((total, product) => total + Number(product.quantity_owned || 0), 0);
    $('#catalog-summary').innerHTML = [
      ['Public items', active.length], ['Owned units', units], ['Archived items', archived]
    ].map(([label, value]) => `<div class="catalog-stat"><strong>${value}</strong><span>${escapeHtml(label)}</span></div>`).join('');

    if (!state.products.length) {
      list.innerHTML = '<div class="catalog-empty"><h3>No rental items yet</h3><p>Add your first item and it will become available to the booking system and public catalog.</p></div>';
      return;
    }

    list.innerHTML = state.products.map((product) => {
      const isActive = Number(product.active) === 1;
      return `<article class="inventory-card-admin${isActive ? '' : ' is-archived'}" data-product-card="${escapeHtml(product.id)}">
        <div class="inventory-card-admin__top">
          <div class="inventory-card-admin__identity">
            <span class="inventory-style-icon" aria-hidden="true">${escapeHtml(styleIcons[product.style] || styleIcons.other)}</span>
            <div><h3>${escapeHtml(product.name)}</h3><p>${escapeHtml(product.sku)} · ${escapeHtml(product.category)}</p></div>
          </div>
          <div class="inventory-card-admin__badges">
            <span class="catalog-badge">${escapeHtml(String(product.style || 'other').replaceAll('-', ' '))}</span>
            <span class="catalog-badge ${isActive ? 'catalog-badge--active' : 'catalog-badge--archived'}">${isActive ? 'On website' : 'Archived'}</span>
          </div>
        </div>
        <div class="inventory-card-admin__meta">
          <div class="inventory-meta"><span>Owned</span><strong>${Number(product.quantity_owned)}</strong></div>
          <div class="inventory-meta"><span>Rental price</span><strong>${escapeHtml(money(product.price_cents))}</strong></div>
          <div class="inventory-meta"><span>Price label</span><strong>${escapeHtml(product.price_unit || 'each')}</strong></div>
          <div class="inventory-meta"><span>Display order</span><strong>${Number(product.sort_order || 100)}</strong></div>
        </div>
        <p class="inventory-card-admin__description">${escapeHtml(product.description || 'No public description yet.')}</p>
        <div class="inventory-card-admin__actions">
          <button class="button button--secondary" type="button" data-edit-product="${escapeHtml(product.id)}">Edit</button>
          ${isActive
            ? `<button class="button button--danger" type="button" data-archive-product="${escapeHtml(product.id)}">Remove from Site</button>`
            : `<button class="button button--success" type="button" data-restore-product="${escapeHtml(product.id)}">Restore to Site</button>`}
        </div>
      </article>`;
    }).join('');

    $$('[data-edit-product]', list).forEach((button) => button.addEventListener('click', () => editProduct(button.dataset.editProduct)));
    $$('[data-archive-product]', list).forEach((button) => button.addEventListener('click', () => archiveProduct(button.dataset.archiveProduct)));
    $$('[data-restore-product]', list).forEach((button) => button.addEventListener('click', () => restoreProduct(button.dataset.restoreProduct)));
  };

  const resetProductForm = () => {
    productForm.reset();
    productForm.elements.id.value = '';
    productForm.elements.quantityOwned.value = '1';
    productForm.elements.sortOrder.value = '100';
    productForm.elements.active.checked = true;
    $('#product-form-eyebrow').textContent = 'New catalog item';
    $('#product-form-title').textContent = 'Add Rental Item';
    showMessage(productMessage, '');
  };

  const showProductForm = (editing = false) => {
    productForm.hidden = false;
    if (!editing) resetProductForm();
    productForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const editProduct = (id) => {
    const product = state.products.find((item) => item.id === id);
    if (!product) return;
    resetProductForm();
    productForm.elements.id.value = product.id;
    productForm.elements.name.value = product.name || '';
    productForm.elements.sku.value = product.sku || '';
    productForm.elements.category.value = product.category || 'Other';
    productForm.elements.style.value = product.style || 'other';
    productForm.elements.quantityOwned.value = String(Number(product.quantity_owned || 0));
    productForm.elements.price.value = product.price_cents == null ? '' : (Number(product.price_cents) / 100).toFixed(2);
    productForm.elements.priceUnit.value = product.price_unit || 'each';
    productForm.elements.sortOrder.value = String(Number(product.sort_order || 100));
    productForm.elements.description.value = product.description || '';
    productForm.elements.active.checked = Number(product.active) === 1;
    $('#product-form-eyebrow').textContent = 'Editing catalog item';
    $('#product-form-title').textContent = product.name;
    showProductForm(true);
  };

  const productPayload = () => {
    const data = new FormData(productForm);
    const price = String(data.get('price') || '').trim();
    return {
      id: data.get('id') || undefined,
      name: data.get('name'), sku: data.get('sku'), category: data.get('category'), style: data.get('style'),
      quantityOwned: Number(data.get('quantityOwned')), priceCents: price === '' ? null : Math.round(Number(price) * 100),
      priceUnit: data.get('priceUnit'), sortOrder: Number(data.get('sortOrder') || 100),
      description: data.get('description'), active: data.get('active') === 'on'
    };
  };

  const saveCatalogProduct = async (event) => {
    event.preventDefault();
    showMessage(productMessage, 'Saving rental item…');
    try {
      const payload = productPayload();
      const editing = Boolean(payload.id);
      await api('/api/admin/products', { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
      await loadProducts();
      showMessage(productMessage, 'Rental item saved. The public catalog will update automatically.', 'success');
      setTimeout(() => { productForm.hidden = true; resetProductForm(); }, 650);
    } catch (error) {
      showMessage(productMessage, error.message, 'error');
    }
  };

  const archiveProduct = async (id) => {
    const product = state.products.find((item) => item.id === id);
    if (!product || !confirm(`Remove “${product.name}” from the public site? Booking history will be preserved.`)) return;
    try {
      await api('/api/admin/products', { method: 'DELETE', body: JSON.stringify({ id }) });
      await loadProducts();
    } catch (error) { alert(error.message); }
  };

  const restoreProduct = async (id) => {
    const product = state.products.find((item) => item.id === id);
    if (!product) return;
    try {
      await api('/api/admin/products', { method: 'PATCH', body: JSON.stringify({ id, active: true }) });
      await loadProducts();
    } catch (error) { alert(error.message); }
  };

  const checkAvailability = async () => {
    const message = $('#booking-availability-message');
    try {
      const windowData = bookingWindow();
      message.textContent = 'Checking exact availability…';
      const params = new URLSearchParams({
        eventStartAt: String(windowData.eventStartAt),
        eventEndAt: String(windowData.eventEndAt),
        bufferBeforeMinutes: String(windowData.bufferBeforeMinutes),
        bufferAfterMinutes: String(windowData.bufferAfterMinutes)
      });
      const data = await api(`/api/public/availability?${params}`, { headers: {} });
      state.availability = new Map(data.products.map((product) => [product.id, Number(product.quantityAvailable)]));
      renderProductPicker();
      message.textContent = 'Availability checked. Quantities are limited to what is free for this full event and buffer window.';
    } catch (error) { message.textContent = error.message; }
  };

  const createBooking = async (event) => {
    event.preventDefault();
    showMessage(bookingMessage, 'Creating booking…');
    try {
      const data = new FormData(bookingForm);
      const windowData = bookingWindow();
      const items = selectedItems();
      if (!items.length) throw new Error('Add at least one rental item.');
      const status = data.get('status');
      const result = await api('/api/admin/bookings', {
        method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          customer: { name: data.get('customerName'), email: data.get('customerEmail'), phone: data.get('customerPhone') },
          items, status, eventStartAt: windowData.eventStartAt, eventEndAt: windowData.eventEndAt,
          bufferBeforeMinutes: Number(data.get('bufferBefore')), bufferAfterMinutes: Number(data.get('bufferAfter')),
          serviceType: data.get('serviceType'), eventCity: data.get('eventCity'), eventAddress: data.get('eventAddress'), notes: data.get('notes')
        })
      });
      showMessage(bookingMessage, `Created ${result.booking.bookingNumber}.`, 'success');
      bookingForm.reset();
      bookingForm.elements.eventStart.value = '14:00';
      bookingForm.elements.eventEnd.value = '20:00';
      bookingForm.elements.bufferBefore.value = '240';
      bookingForm.elements.bufferAfter.value = '720';
      state.availability.clear();
      renderProductPicker();
      await loadBookings();
      setTimeout(() => openBooking(result.booking.id), 400);
    } catch (error) { showMessage(bookingMessage, error.message, 'error'); }
  };

  const openBooking = async (id) => {
    try {
      const data = await api(`/api/admin/bookings/${encodeURIComponent(id)}`);
      state.currentBooking = data.booking;
      renderBookingDetail();
      openPanel('booking-detail');
    } catch (error) { alert(error.message); }
  };

  const renderBookingDetail = () => {
    const booking = state.currentBooking;
    const latestSigning = (booking.signingRequests || [])[0];
    $('#booking-detail').innerHTML = `<div class="panel-heading"><div><p class="eyebrow">${escapeHtml(booking.booking_number)}</p><h2>${escapeHtml(booking.customer_name)}</h2></div><span class="status status--${escapeHtml(booking.status)}">${escapeHtml(booking.status)}</span></div><div class="booking-summary"><div class="card"><h3>Event</h3><p><strong>Starts:</strong> ${escapeHtml(formatDate(booking.event_start_at))}</p><p><strong>Ends:</strong> ${escapeHtml(formatDate(booking.event_end_at))}</p><p><strong>Inventory blocked:</strong> ${escapeHtml(formatDate(booking.block_start_at))} through ${escapeHtml(formatDate(booking.block_end_at))}</p><p><strong>Service:</strong> ${escapeHtml(booking.service_type)} · ${escapeHtml(booking.event_city)}</p></div><div class="card"><h3>Customer</h3><p>${escapeHtml(booking.customer_name)}</p><p>${escapeHtml(booking.customer_email)}</p><p>${escapeHtml(booking.customer_phone)}</p><p><strong>Known subtotal:</strong> ${escapeHtml(money(booking.subtotal_cents))}</p></div></div><div class="card" style="margin-top:20px"><h3>Rental items</h3><ul class="item-list">${booking.items.map((item) => `<li>${Number(item.quantity)} × ${escapeHtml(item.name)} — ${escapeHtml(money(item.unit_price_cents))}</li>`).join('')}</ul><div class="detail-actions"><label>Status<select id="detail-status">${['inquiry','quote','hold','confirmed','paid','ready','out','returned','completed','cancelled','expired'].map((status) => `<option value="${status}" ${booking.status === status ? 'selected' : ''}>${status}</option>`).join('')}</select></label><button class="button" id="save-booking-status" type="button">Save Status</button><button class="button button--secondary" id="create-signing-link" type="button">Create Signing Link</button></div><p class="message" id="detail-message"></p><div class="signing-link-box" id="signing-link-box" ${latestSigning ? '' : 'hidden'}>${latestSigning ? `Latest agreement: version ${Number(latestSigning.agreement_version)} · ${latestSigning.signed_at ? `signed ${escapeHtml(formatDate(latestSigning.signed_at))}` : `expires ${escapeHtml(formatDate(latestSigning.expires_at))}`}` : ''}</div></div>`;
    $('#save-booking-status').addEventListener('click', saveBookingStatus);
    $('#create-signing-link').addEventListener('click', createSigningLink);
  };

  const saveBookingStatus = async () => {
    const message = $('#detail-message');
    showMessage(message, 'Saving…');
    try {
      const booking = state.currentBooking;
      const data = await api(`/api/admin/bookings/${encodeURIComponent(booking.id)}`, { method: 'PATCH', body: JSON.stringify({ status: $('#detail-status').value }) });
      state.currentBooking = data.booking;
      await loadBookings();
      renderBookingDetail();
    } catch (error) { showMessage(message, error.message, 'error'); }
  };

  const createSigningLink = async () => {
    const message = $('#detail-message');
    showMessage(message, 'Creating secure signing link…');
    try {
      const booking = state.currentBooking;
      const data = await api(`/api/admin/bookings/${encodeURIComponent(booking.id)}/signing-link`, { method: 'POST', body: '{}' });
      const box = $('#signing-link-box');
      box.hidden = false;
      box.innerHTML = `<strong>Signing link created</strong><p><a href="${escapeHtml(data.signingRequest.signingUrl)}" target="_blank" rel="noopener">${escapeHtml(data.signingRequest.signingUrl)}</a></p><button class="button button--quiet" id="copy-signing-link" type="button">Copy Link</button>`;
      $('#copy-signing-link').addEventListener('click', async () => {
        await navigator.clipboard.writeText(data.signingRequest.signingUrl);
        showMessage(message, 'Signing link copied.', 'success');
      });
      showMessage(message, 'Send this private link only to the customer.', 'success');
    } catch (error) { showMessage(message, error.message, 'error'); }
  };

  const loadUsers = async () => {
    if (state.user?.role !== 'owner') return;
    const data = await api('/api/admin/users');
    state.users = data.users || [];
    $('#users-list').innerHTML = state.users.map((user) => `<div class="upcoming-row"><div><strong>${escapeHtml(user.display_name)}</strong><p>${escapeHtml(user.email)} · ${escapeHtml(user.role)} · ${user.is_active ? 'active' : 'disabled'}</p></div></div>`).join('') || '<p>No Access users have opened the dashboard yet.</p>';
  };

  const showDashboard = async (user) => {
    state.user = user;
    loginView.hidden = true;
    dashboardView.hidden = false;
    $('#current-user').textContent = user.displayName || user.email;
    if (user.role === 'owner') $('#users-nav').hidden = false;
    await Promise.all([loadProducts(), loadBookings(), loadUsers()]);
  };

  const checkSession = async () => {
    try {
      const data = await api('/api/auth/me', { headers: {} });
      await showDashboard(data.user);
    } catch (error) {
      loginView.hidden = false;
      dashboardView.hidden = true;
      showMessage(loginMessage, error.message, 'error');
    }
  };

  $('#logout-button').addEventListener('click', () => { location.href = '/cdn-cgi/access/logout'; });
  $$('.nav-button').forEach((button) => button.addEventListener('click', () => openPanel(button.dataset.panel)));
  $$('[data-open-panel]').forEach((button) => button.addEventListener('click', () => openPanel(button.dataset.openPanel)));
  $('#refresh-bookings').addEventListener('click', loadBookings);
  $('#check-booking-availability').addEventListener('click', checkAvailability);
  $('#new-product-button').addEventListener('click', () => showProductForm(false));
  $('#cancel-product-button').addEventListener('click', () => { productForm.hidden = true; resetProductForm(); });
  productForm.addEventListener('submit', saveCatalogProduct);
  bookingForm.addEventListener('submit', createBooking);
  const today = new Date();
  today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
  bookingForm.elements.eventDate.min = today.toISOString().slice(0, 10);
  checkSession();
})();
