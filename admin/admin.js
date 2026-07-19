(() => {
  const state = { user: null, bookings: [], products: [], availability: new Map(), currentBooking: null, users: [] };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const loginView = $('#login-view');
  const dashboardView = $('#dashboard-view');
  const loginForm = $('#login-form');
  const loginMessage = $('#login-message');
  const bookingForm = $('#booking-form');
  const bookingMessage = $('#booking-message');

  const escapeHtml = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const api = async (path, options = {}) => {
    const response = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
    let data;
    try { data = await response.json(); } catch { data = { ok: false, error: { message: 'The server returned an invalid response.' } }; }
    if (!response.ok) { const error = new Error(data?.error?.message || 'Request failed.'); error.code = data?.error?.code; error.status = response.status; throw error; }
    return data;
  };
  const showMessage = (element, message, type = '') => { element.textContent = message || ''; element.className = `message ${type}`.trim(); };
  const localEpoch = (date, time) => { if (!date || !time) return null; const parsed = new Date(`${date}T${time}:00`); const epoch = Math.floor(parsed.getTime() / 1000); return Number.isFinite(epoch) ? epoch : null; };
  const formatDate = (epoch) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(Number(epoch) * 1000));
  const money = (cents) => cents == null ? 'Pricing pending' : (Number(cents) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

  const openPanel = (name) => {
    $$('[data-panel-view]').forEach((panel) => { panel.hidden = panel.dataset.panelView !== name; });
    $$('.nav-button').forEach((button) => button.classList.toggle('is-active', button.dataset.panel === name));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const bookingWindow = () => {
    const data = new FormData(bookingForm);
    const eventStartAt = localEpoch(data.get('eventDate'), data.get('eventStart'));
    const eventEndAt = localEpoch(data.get('eventDate'), data.get('eventEnd'));
    if (!eventStartAt || !eventEndAt || eventEndAt <= eventStartAt) throw new Error('Choose a valid date, start time, and end time.');
    const before = Number(data.get('bufferBefore') || 0);
    const after = Number(data.get('bufferAfter') || 0);
    return { eventStartAt, eventEndAt, blockStartAt: eventStartAt - before * 60, blockEndAt: eventEndAt + after * 60 };
  };

  const selectedItems = () => $$('.product-option', $('#booking-product-picker')).map((card) => ({ productId: card.dataset.productId, quantity: Number($('input[type="number"]', card).value || 0) })).filter((item) => Number.isInteger(item.quantity) && item.quantity > 0);

  const renderProductPicker = () => {
    const picker = $('#booking-product-picker');
    picker.innerHTML = '';
    for (const product of state.products) {
      const available = state.availability.has(product.id) ? state.availability.get(product.id) : Number(product.quantity_owned);
      const card = document.createElement('div');
      card.className = `product-option${available < 1 ? ' is-unavailable' : ''}`;
      card.dataset.productId = product.id;
      card.innerHTML = `<h4>${escapeHtml(product.name)}</h4><p>${escapeHtml(money(product.price_cents))} · ${available} available for selected window</p><label>Quantity<input type="number" min="0" max="${available}" value="0" inputmode="numeric" ${available < 1 ? 'disabled' : ''} /></label>`;
      picker.appendChild(card);
    }
  };

  const loadProducts = async () => { const data = await api('/api/admin/products'); state.products = data.products || []; renderProductPicker(); renderInventory(); };
  const loadBookings = async () => { const data = await api('/api/admin/bookings?limit=200'); state.bookings = data.bookings || []; renderBookings(); renderOverview(); };

  const renderOverview = () => {
    const now = Math.floor(Date.now() / 1000);
    const active = state.bookings.filter((booking) => ['hold', 'confirmed', 'paid', 'ready', 'out', 'returned'].includes(booking.status));
    const upcoming = state.bookings.filter((booking) => Number(booking.event_end_at) >= now && !['completed', 'cancelled', 'expired'].includes(booking.status)).slice(0, 8);
    const inquiries = state.bookings.filter((booking) => booking.status === 'inquiry').length;
    const onRent = state.bookings.filter((booking) => booking.status === 'out').length;
    $('#stat-grid').innerHTML = [['Upcoming', upcoming.length], ['Active reservations', active.length], ['New inquiries', inquiries], ['Out on rental', onRent]].map(([label, value]) => `<div class="stat"><strong>${value}</strong><span>${escapeHtml(label)}</span></div>`).join('');
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
    if (!state.products.length) { list.innerHTML = '<p>No products found.</p>'; return; }
    list.innerHTML = state.products.map((product) => `<form class="inventory-row" data-product-form="${escapeHtml(product.id)}"><div><h3>${escapeHtml(product.name)}</h3><p>${escapeHtml(product.sku)} · ${escapeHtml(product.category)}</p></div><label>Owned<input name="quantityOwned" type="number" min="0" value="${Number(product.quantity_owned)}" required /></label><label>Price<input name="price" type="number" min="0" step="0.01" value="${product.price_cents == null ? '' : (Number(product.price_cents) / 100).toFixed(2)}" placeholder="Pending" /></label><button class="button" type="submit">Save</button></form>`).join('');
    $$('[data-product-form]', list).forEach((form) => form.addEventListener('submit', saveProduct));
  };

  const saveProduct = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const price = String(data.get('price') || '').trim();
    try {
      await api('/api/admin/products', { method: 'PATCH', body: JSON.stringify({ id: form.dataset.productForm, quantityOwned: Number(data.get('quantityOwned')), priceCents: price === '' ? null : Math.round(Number(price) * 100) }) });
      await loadProducts();
    } catch (error) { alert(error.message); }
  };

  const checkAvailability = async () => {
    const message = $('#booking-availability-message');
    try {
      const windowData = bookingWindow();
      message.textContent = 'Checking exact availability…';
      const data = await api(`/api/public/availability?startAt=${windowData.blockStartAt}&endAt=${windowData.blockEndAt}`, { headers: {} });
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
      const result = await api('/api/admin/bookings', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ customer: { name: data.get('customerName'), email: data.get('customerEmail'), phone: data.get('customerPhone') }, items, status, eventStartAt: windowData.eventStartAt, eventEndAt: windowData.eventEndAt, bufferBeforeMinutes: Number(data.get('bufferBefore')), bufferAfterMinutes: Number(data.get('bufferAfter')), holdExpiresAt: status === 'hold' ? Math.floor(Date.now() / 1000) + 1800 : null, serviceType: data.get('serviceType'), eventCity: data.get('eventCity'), eventAddress: data.get('eventAddress'), notes: data.get('notes') }) });
      showMessage(bookingMessage, `Created ${result.booking.bookingNumber}.`, 'success');
      bookingForm.reset();
      bookingForm.elements.eventStart.value = '14:00'; bookingForm.elements.eventEnd.value = '20:00'; bookingForm.elements.bufferBefore.value = '120'; bookingForm.elements.bufferAfter.value = '120';
      state.availability.clear(); renderProductPicker(); await loadBookings(); setTimeout(() => openBooking(result.booking.id), 400);
    } catch (error) { showMessage(bookingMessage, error.message, 'error'); }
  };

  const openBooking = async (id) => {
    try { const data = await api(`/api/admin/bookings/${encodeURIComponent(id)}`); state.currentBooking = data.booking; renderBookingDetail(); openPanel('booking-detail'); }
    catch (error) { alert(error.message); }
  };

  const renderBookingDetail = () => {
    const booking = state.currentBooking;
    const latestSigning = (booking.signingRequests || [])[0];
    $('#booking-detail').innerHTML = `<div class="panel-heading"><div><p class="eyebrow">${escapeHtml(booking.booking_number)}</p><h2>${escapeHtml(booking.customer_name)}</h2></div><span class="status status--${escapeHtml(booking.status)}">${escapeHtml(booking.status)}</span></div><div class="booking-summary"><div class="card"><h3>Event</h3><p><strong>Starts:</strong> ${escapeHtml(formatDate(booking.event_start_at))}</p><p><strong>Ends:</strong> ${escapeHtml(formatDate(booking.event_end_at))}</p><p><strong>Inventory blocked:</strong> ${escapeHtml(formatDate(booking.block_start_at))} through ${escapeHtml(formatDate(booking.block_end_at))}</p><p><strong>Service:</strong> ${escapeHtml(booking.service_type)} · ${escapeHtml(booking.event_city)}</p></div><div class="card"><h3>Customer</h3><p>${escapeHtml(booking.customer_name)}</p><p>${escapeHtml(booking.customer_email)}</p><p>${escapeHtml(booking.customer_phone)}</p><p><strong>Known subtotal:</strong> ${escapeHtml(money(booking.subtotal_cents))}</p></div></div><div class="card" style="margin-top:20px"><h3>Rental items</h3><ul class="item-list">${booking.items.map((item) => `<li>${Number(item.quantity)} × ${escapeHtml(item.name)} — ${escapeHtml(money(item.unit_price_cents))}</li>`).join('')}</ul><div class="detail-actions"><label>Status<select id="detail-status">${['inquiry','quote','hold','confirmed','paid','ready','out','returned','completed','cancelled','expired'].map((status) => `<option value="${status}" ${booking.status === status ? 'selected' : ''}>${status}</option>`).join('')}</select></label><button class="button" id="save-booking-status" type="button">Save Status</button><button class="button button--secondary" id="create-signing-link" type="button">Create Signing Link</button></div><p class="message" id="detail-message"></p><div class="signing-link-box" id="signing-link-box" ${latestSigning ? '' : 'hidden'}>${latestSigning ? `Latest agreement: version ${Number(latestSigning.agreement_version)} · ${latestSigning.signed_at ? `signed ${escapeHtml(formatDate(latestSigning.signed_at))}` : `expires ${escapeHtml(formatDate(latestSigning.expires_at))}`}` : ''}</div></div>`;
    $('#save-booking-status').addEventListener('click', saveBookingStatus);
    $('#create-signing-link').addEventListener('click', createSigningLink);
  };

  const saveBookingStatus = async () => {
    const message = $('#detail-message'); showMessage(message, 'Saving…');
    try { const booking = state.currentBooking; const data = await api(`/api/admin/bookings/${encodeURIComponent(booking.id)}`, { method: 'PATCH', body: JSON.stringify({ status: $('#detail-status').value }) }); state.currentBooking = data.booking; await loadBookings(); renderBookingDetail(); }
    catch (error) { showMessage(message, error.message, 'error'); }
  };

  const createSigningLink = async () => {
    const message = $('#detail-message'); showMessage(message, 'Creating secure signing link…');
    try {
      const booking = state.currentBooking;
      const data = await api(`/api/admin/bookings/${encodeURIComponent(booking.id)}/signing-link`, { method: 'POST', body: '{}' });
      const box = $('#signing-link-box'); box.hidden = false;
      box.innerHTML = `<strong>Signing link created</strong><p><a href="${escapeHtml(data.signingRequest.signingUrl)}" target="_blank" rel="noopener">${escapeHtml(data.signingRequest.signingUrl)}</a></p><button class="button button--quiet" id="copy-signing-link" type="button">Copy Link</button>`;
      $('#copy-signing-link').addEventListener('click', async () => { await navigator.clipboard.writeText(data.signingRequest.signingUrl); showMessage(message, 'Signing link copied.', 'success'); });
      showMessage(message, 'Send this private link only to the customer.', 'success');
    } catch (error) { showMessage(message, error.message, 'error'); }
  };

  const loadUsers = async () => {
    if (state.user?.role !== 'owner') return;
    const data = await api('/api/admin/users'); state.users = data.users || [];
    $('#users-list').innerHTML = state.users.map((user) => `<div class="upcoming-row"><div><strong>${escapeHtml(user.display_name)}</strong><p>${escapeHtml(user.email)} · ${escapeHtml(user.role)} · ${user.is_active ? 'active' : 'disabled'}</p></div></div>`).join('') || '<p>No users found.</p>';
  };

  const createUser = async (event) => {
    event.preventDefault(); const form = event.currentTarget; const message = $('#user-message'); showMessage(message, 'Creating account…'); const data = new FormData(form);
    try { await api('/api/admin/users', { method: 'POST', body: JSON.stringify({ displayName: data.get('displayName'), email: data.get('email'), password: data.get('password') }) }); form.reset(); showMessage(message, 'Admin account created.', 'success'); await loadUsers(); }
    catch (error) { showMessage(message, error.message, 'error'); }
  };

  const showDashboard = async (user) => { state.user = user; loginView.hidden = true; dashboardView.hidden = false; $('#current-user').textContent = user.displayName || user.email; if (user.role === 'owner') $('#users-nav').hidden = false; await Promise.all([loadProducts(), loadBookings(), loadUsers()]); };
  const checkSession = async () => { try { const data = await api('/api/auth/me', { headers: {} }); await showDashboard(data.user); } catch { loginView.hidden = false; dashboardView.hidden = true; } };

  loginForm.addEventListener('submit', async (event) => { event.preventDefault(); showMessage(loginMessage, 'Signing in…'); try { const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: $('#login-email').value, password: $('#login-password').value }) }); showMessage(loginMessage, ''); await showDashboard(data.user); } catch (error) { showMessage(loginMessage, error.message, 'error'); } });
  $('#logout-button').addEventListener('click', async () => { try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); } finally { location.reload(); } });
  $$('.nav-button').forEach((button) => button.addEventListener('click', () => openPanel(button.dataset.panel)));
  $$('[data-open-panel]').forEach((button) => button.addEventListener('click', () => openPanel(button.dataset.openPanel)));
  $('#refresh-bookings').addEventListener('click', loadBookings);
  $('#check-booking-availability').addEventListener('click', checkAvailability);
  bookingForm.addEventListener('submit', createBooking);
  $('#user-form')?.addEventListener('submit', createUser);
  const today = new Date(); today.setMinutes(today.getMinutes() - today.getTimezoneOffset()); bookingForm.elements.eventDate.min = today.toISOString().slice(0, 10);
  checkSession();
})();
