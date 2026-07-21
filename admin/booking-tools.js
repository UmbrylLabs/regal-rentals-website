(() => {
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const toolState = {
    user: null,
    currentBooking: null,
    filter: 'active',
    search: ''
  };

  const bookingEndpoint = /^\/api\/admin\/bookings\/([^/]+)$/;

  globalThis.fetch = async (input, init = {}) => {
    const response = await nativeFetch(input, init);
    try {
      const rawUrl = typeof input === 'string' ? input : input?.url;
      const url = new URL(rawUrl, globalThis.location.origin);
      const method = String(init.method || (typeof input !== 'string' ? input?.method : '') || 'GET').toUpperCase();

      if (response.ok && url.pathname === '/api/auth/me' && method === 'GET') {
        response.clone().json().then((data) => {
          toolState.user = data.user || null;
          syncDeleteButton();
        }).catch(() => {});
      }

      if (response.ok && bookingEndpoint.test(url.pathname) && ['GET', 'PATCH'].includes(method)) {
        response.clone().json().then((data) => {
          if (data.booking) toolState.currentBooking = data.booking;
          syncDeleteButton();
        }).catch(() => {});
      }
    } catch {
      // The primary admin request remains untouched if enhancement inspection fails.
    }
    return response;
  };

  const bookingGroup = (status) => {
    if (status === 'completed') return 'completed';
    if (['cancelled', 'expired'].includes(status)) return 'cancelled';
    return 'active';
  };

  const bookingRows = () => Array.from(
    document.querySelectorAll('#bookings-table-body tr')
  ).filter((row) => row.querySelector('.status'));

  const applyBookingFilters = () => {
    const rows = bookingRows();
    const counts = { active: 0, completed: 0, cancelled: 0, all: rows.length };
    let visible = 0;

    rows.forEach((row) => {
      const status = String(row.querySelector('.status')?.textContent || '').trim().toLowerCase();
      const group = bookingGroup(status);
      counts[group] += 1;
      const matchesGroup = toolState.filter === 'all' || toolState.filter === group;
      const matchesSearch = !toolState.search || row.textContent.toLowerCase().includes(toolState.search);
      row.hidden = !(matchesGroup && matchesSearch);
      if (!row.hidden) visible += 1;
    });

    Object.entries(counts).forEach(([name, count]) => {
      const target = document.querySelector(`[data-booking-count="${name}"]`);
      if (target) target.textContent = String(count);
    });

    const summary = document.getElementById('booking-filter-summary');
    if (summary) {
      const groupLabel = {
        active: 'active bookings',
        completed: 'completed bookings',
        cancelled: 'canceled or expired bookings',
        all: 'bookings'
      }[toolState.filter];
      summary.textContent = toolState.search
        ? `Showing ${visible} matching ${groupLabel}.`
        : `Showing ${visible} ${groupLabel}.`;
    }
  };

  const setBookingFilter = (filter) => {
    toolState.filter = filter;
    document.querySelectorAll('[data-booking-filter]').forEach((button) => {
      const selected = button.dataset.bookingFilter === filter;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
    applyBookingFilters();
  };

  const showDetailMessage = (text, type = '') => {
    const message = document.getElementById('detail-message');
    if (!message) return;
    message.textContent = text;
    message.className = `message ${type}`.trim();
  };

  const deleteTestBooking = async () => {
    const booking = toolState.currentBooking;
    if (!booking) return;
    const typed = globalThis.prompt(
      `Permanently delete test booking ${booking.booking_number}?\n\nType the complete booking number to confirm.`
    );
    if (typed !== booking.booking_number) {
      if (typed !== null) showDetailMessage('Booking number did not match. Nothing was deleted.', 'error');
      return;
    }

    const button = document.getElementById('delete-test-booking');
    if (button) {
      button.disabled = true;
      button.textContent = 'Deleting…';
    }
    showDetailMessage('Permanently deleting the test booking…');

    try {
      const response = await nativeFetch(`/api/admin/bookings/${encodeURIComponent(booking.id)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error?.message || 'The booking could not be deleted.');

      toolState.currentBooking = null;
      document.querySelector('[data-open-panel="bookings"]')?.click();
      document.getElementById('refresh-bookings')?.click();
    } catch (error) {
      showDetailMessage(error.message, 'error');
      if (button) {
        button.disabled = false;
        button.textContent = 'Delete Test Booking';
      }
    }
  };

  const syncDeleteButton = () => {
    const actions = document.querySelector('#booking-detail .detail-actions');
    const existingButton = document.getElementById('delete-test-booking');
    const booking = toolState.currentBooking;
    const canShow = actions
      && toolState.user?.role === 'owner'
      && booking
      && ['cancelled', 'expired'].includes(booking.status);

    if (!canShow) {
      existingButton?.remove();
      return;
    }
    if (existingButton) return;

    const button = document.createElement('button');
    button.className = 'button button--danger';
    button.id = 'delete-test-booking';
    button.type = 'button';
    button.textContent = 'Delete Test Booking';
    button.addEventListener('click', deleteTestBooking);
    actions.appendChild(button);
  };

  const initialize = () => {
    document.querySelectorAll('[data-booking-filter]').forEach((button) => {
      button.addEventListener('click', () => setBookingFilter(button.dataset.bookingFilter));
    });

    const search = document.getElementById('booking-search');
    search?.addEventListener('input', () => {
      toolState.search = search.value.trim().toLowerCase();
      applyBookingFilters();
    });

    const tableBody = document.getElementById('bookings-table-body');
    if (tableBody) {
      new MutationObserver(applyBookingFilters).observe(tableBody, { childList: true });
    }

    const detail = document.getElementById('booking-detail');
    if (detail) {
      new MutationObserver(syncDeleteButton).observe(detail, { childList: true, subtree: true });
    }

    applyBookingFilters();
    syncDeleteButton();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();
