(() => {
  const previousFetch = globalThis.fetch.bind(globalThis);
  const state = { booking: null, data: null, loading: false };
  const bookingEndpoint = /^\/api\/admin\/bookings\/([^/]+)$/;

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

  const money = (cents) => (Number(cents || 0) / 100).toLocaleString('en-US', {
    style: 'currency', currency: 'USD'
  });

  const formatDate = (epoch) => epoch ? new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short'
  }).format(new Date(Number(epoch) * 1000)) : 'Not recorded';

  const purposeLabel = (purpose) => ({
    reservation: 'Reservation payment', balance: 'Rental balance',
    security_deposit: 'Refundable security deposit', custom: 'Custom payment'
  }[purpose] || 'Payment');

  const methodLabel = (method) => ({
    credit_card: 'Credit card', debit_card: 'Debit card', cash: 'Cash', unspecified: 'Not specified'
  }[method] || 'Not selected');

  globalThis.fetch = async (input, init = {}) => {
    const response = await previousFetch(input, init);
    try {
      const rawUrl = typeof input === 'string' ? input : input?.url;
      const url = new URL(rawUrl, globalThis.location.origin);
      const method = String(init.method || (typeof input !== 'string' ? input?.method : '') || 'GET').toUpperCase();
      if (response.ok && bookingEndpoint.test(url.pathname) && ['GET', 'PATCH'].includes(method)) {
        response.clone().json().then((data) => {
          if (!data.booking) return;
          const changed = state.booking?.id !== data.booking.id;
          state.booking = data.booking;
          if (changed) state.data = null;
          queueMicrotask(() => ensurePaymentSection(changed));
        }).catch(() => {});
      }
    } catch {
      // Core admin requests remain untouched if payment enhancement inspection fails.
    }
    return response;
  };

  const showMessage = (text, type = '') => {
    const element = document.getElementById('booking-payment-message');
    if (!element) return;
    element.textContent = text || '';
    element.className = `message ${type}`.trim();
  };

  const paymentSummaryMarkup = () => {
    const summary = state.data?.summary || {};
    return `<div class="payment-stat-grid">
      <div><span>Rental subtotal</span><strong>${escapeHtml(money(summary.subtotalCents))}</strong></div>
      <div><span>Rental payments</span><strong>${escapeHtml(money(summary.rentalPaidCents))}</strong></div>
      <div><span>Rental balance</span><strong>${escapeHtml(money(summary.rentalBalanceCents))}</strong></div>
      <div><span>Security held</span><strong>${escapeHtml(money(summary.securityHeldCents))}</strong></div>
    </div>`;
  };

  const requestsMarkup = () => {
    const requests = state.data?.requests || [];
    if (!requests.length) return '<p class="payment-empty">No payment links have been created.</p>';
    return requests.map((request) => `<article class="payment-record">
      <div><strong>${escapeHtml(purposeLabel(request.purpose))} · ${escapeHtml(money(request.amount_cents))}</strong>
        <span>${escapeHtml(methodLabel(request.expected_method))} · ${escapeHtml(request.status)} · expires ${escapeHtml(formatDate(request.expires_at))}</span>
        ${request.failure_message ? `<small>${escapeHtml(request.failure_message)}</small>` : ''}
      </div>
      ${['open', 'failed'].includes(request.status)
        ? `<button class="button button--danger" type="button" data-cancel-payment-request="${escapeHtml(request.id)}">Cancel</button>`
        : ''}
    </article>`).join('');
  };

  const paymentsMarkup = () => {
    const payments = state.data?.payments || [];
    if (!payments.length) return '<p class="payment-empty">No payments have been recorded.</p>';
    return payments.map((payment) => `<article class="payment-record payment-record--completed">
      <div><strong>${escapeHtml(purposeLabel(payment.purpose))} · ${escapeHtml(money(payment.amount_cents))}</strong>
        <span>${escapeHtml(payment.provider)} · ${escapeHtml(formatDate(payment.paid_at))}${payment.card_last_4 ? ` · ${escapeHtml(payment.card_brand || 'Card')} ending ${escapeHtml(payment.card_last_4)}` : ''}</span>
        ${Number(payment.method_mismatch) === 1 ? '<small class="payment-warning">Card type did not match the agreement selection.</small>' : ''}
        ${payment.note ? `<small>${escapeHtml(payment.note)}</small>` : ''}
      </div>
      ${payment.square_receipt_url ? `<a class="button button--quiet" href="${escapeHtml(payment.square_receipt_url)}" target="_blank" rel="noopener">Receipt</a>` : ''}
    </article>`).join('');
  };

  const savedCardsMarkup = () => {
    const cards = state.data?.savedCards || [];
    if (!cards.length) return '<p class="payment-empty">No card is currently stored on file.</p>';
    return cards.map((card) => `<div class="saved-card-row"><strong>${escapeHtml(card.card_brand || 'Card')} ending ${escapeHtml(card.last_4 || '—')}</strong><span>${escapeHtml(card.card_type || '')} · expires ${String(card.exp_month || '').padStart(2, '0')}/${escapeHtml(card.exp_year || '')}</span></div>`).join('');
  };

  const render = () => {
    const root = document.getElementById('booking-payment-manager');
    if (!root || !state.data) return;
    const signed = state.data.signedPaymentMethod || {};
    const configuredNotice = state.data.configured
      ? `<div class="payment-config payment-config--ready"><strong>Square ${escapeHtml(state.data.environment)} is connected.</strong><span>Online payment links can process cards after the database migration is applied.</span></div>`
      : `<div class="payment-config"><strong>Square credentials still need to be connected.</strong><span>The payment system is installed, but online links stay disabled until the Cloudflare variables and migration are added. Cash can still be recorded afterward.</span></div>`;

    root.innerHTML = `<div class="booking-payments-heading"><div><p class="eyebrow">Payments</p><h3>Payments & Security</h3></div><p>Signed method: <strong>${escapeHtml(methodLabel(signed.method))}</strong>${signed.depositCents ? ` · deposit ${escapeHtml(money(signed.depositCents))}` : ''}</p></div>
      ${configuredNotice}
      ${paymentSummaryMarkup()}
      <div class="payment-manager-grid">
        <form id="create-payment-request-form" class="payment-manager-form">
          <h4>Create Online Payment Link</h4>
          <label>Purpose<select name="purpose"><option value="reservation">50% reservation payment</option><option value="balance">Remaining rental balance</option><option value="security_deposit">50% refundable security deposit</option><option value="custom">Custom payment</option></select></label>
          <label>Amount<input name="amount" type="number" min="0.01" step="0.01" required /></label>
          <label>Expected card type<select name="expectedMethod"><option value="auto">Use signed agreement</option><option value="credit_card">Credit card — save card on file</option><option value="debit_card">Debit card — no card storage</option><option value="unspecified">Not specified</option></select></label>
          <label>Link expires<select name="expiresDays"><option value="3">3 days</option><option value="7" selected>7 days</option><option value="14">14 days</option><option value="30">30 days</option></select></label>
          <label class="payment-full">Description<input name="description" maxlength="500" placeholder="Optional note shown to customer" /></label>
          <button class="button" type="submit" ${state.data.configured ? '' : 'disabled'}>Create Payment Link</button>
        </form>
        <form id="record-cash-form" class="payment-manager-form">
          <h4>Record Cash Received</h4>
          <label>Purpose<select name="purpose"><option value="reservation">Reservation payment</option><option value="balance">Rental balance</option><option value="security_deposit">Refundable security deposit</option><option value="custom">Custom payment</option></select></label>
          <label>Amount<input name="amount" type="number" min="0.01" step="0.01" required /></label>
          <label class="payment-full">Receipt note<input name="note" maxlength="1000" value="Cash received and counted in person." /></label>
          <button class="button button--secondary" type="submit">Record Cash</button>
        </form>
      </div>
      <div class="payment-link-result" id="payment-link-result" hidden></div>
      <p class="message" id="booking-payment-message" aria-live="polite"></p>
      <div class="payment-record-columns"><section><h4>Payment Requests</h4><div id="payment-request-list">${requestsMarkup()}</div></section><section><h4>Completed Payments</h4><div id="booking-payment-list">${paymentsMarkup()}</div></section></div>
      <section class="saved-cards-section"><h4>Cards Stored Securely by Square</h4>${savedCardsMarkup()}</section>`;

    const createForm = document.getElementById('create-payment-request-form');
    const cashForm = document.getElementById('record-cash-form');
    const purpose = createForm.elements.purpose;
    const amount = createForm.elements.amount;
    const setDefaultAmount = () => {
      const selected = purpose.value;
      const summary = state.data.summary;
      const cents = selected === 'reservation' || selected === 'security_deposit'
        ? Math.round(Number(summary.subtotalCents || 0) / 2)
        : selected === 'balance' ? Number(summary.rentalBalanceCents || 0) : 0;
      amount.value = cents > 0 ? (cents / 100).toFixed(2) : '';
    };
    purpose.addEventListener('change', setDefaultAmount);
    setDefaultAmount();
    cashForm.elements.amount.value = (Math.round(Number(state.data.summary.subtotalCents || 0) / 2) / 100).toFixed(2);
    createForm.addEventListener('submit', createPaymentRequest);
    cashForm.addEventListener('submit', recordCash);
    document.querySelectorAll('[data-cancel-payment-request]').forEach((button) => {
      button.addEventListener('click', () => cancelRequest(button.dataset.cancelPaymentRequest));
    });
  };

  const loadPayments = async () => {
    if (!state.booking || state.loading) return;
    state.loading = true;
    try {
      const response = await previousFetch(`/api/admin/bookings/${encodeURIComponent(state.booking.id)}/payments`, {
        credentials: 'same-origin', headers: { Accept: 'application/json' }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error?.message || 'Payments could not be loaded.');
      state.data = data;
      render();
    } catch (error) {
      const root = document.getElementById('booking-payment-manager');
      if (root) root.innerHTML = `<div class="payment-config"><strong>Payment setup is not active yet.</strong><span>${escapeHtml(error.message)}</span></div>`;
    } finally {
      state.loading = false;
    }
  };

  const ensurePaymentSection = (reload = false) => {
    const detail = document.getElementById('booking-detail');
    if (!detail || !state.booking) return;
    let root = document.getElementById('booking-payment-manager');
    if (!root) {
      root = document.createElement('section');
      root.id = 'booking-payment-manager';
      root.className = 'card booking-payment-card';
      detail.appendChild(root);
    }
    if (reload || !state.data) loadPayments();
    else render();
  };

  const postAction = async (body) => {
    const response = await previousFetch(`/api/admin/bookings/${encodeURIComponent(state.booking.id)}/payments`, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error?.message || 'Payment action failed.');
    return data;
  };

  const createPaymentRequest = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    showMessage('Creating secure payment link…');
    try {
      const values = new FormData(form);
      const data = await postAction({
        action: 'create_request', purpose: values.get('purpose'),
        amountCents: Math.round(Number(values.get('amount')) * 100),
        expectedMethod: values.get('expectedMethod'), expiresDays: Number(values.get('expiresDays')),
        description: values.get('description')
      });
      const result = document.getElementById('payment-link-result');
      result.hidden = false;
      result.innerHTML = `<strong>Payment link created</strong><a href="${escapeHtml(data.paymentRequest.paymentUrl)}" target="_blank" rel="noopener">${escapeHtml(data.paymentRequest.paymentUrl)}</a><button class="button button--quiet" id="copy-payment-link" type="button">Copy Link</button>`;
      document.getElementById('copy-payment-link').addEventListener('click', async () => {
        await navigator.clipboard.writeText(data.paymentRequest.paymentUrl);
        showMessage('Payment link copied.', 'success');
      });
      showMessage('Send the private link to the customer.', 'success');
      await loadPayments();
    } catch (error) {
      showMessage(error.message, 'error');
    } finally {
      button.disabled = !state.data?.configured;
    }
  };

  const recordCash = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    if (!confirm(`Record ${values.get('amount')} in cash as received? Count the cash and issue a receipt before confirming.`)) return;
    showMessage('Recording cash payment…');
    try {
      await postAction({
        action: 'record_cash', purpose: values.get('purpose'),
        amountCents: Math.round(Number(values.get('amount')) * 100), note: values.get('note')
      });
      showMessage('Cash payment recorded. Keep the signed or printed receipt with the booking record.', 'success');
      state.data = null;
      await loadPayments();
    } catch (error) {
      showMessage(error.message, 'error');
    }
  };

  const cancelRequest = async (requestId) => {
    if (!confirm('Cancel this payment link? It will no longer accept payment.')) return;
    try {
      await postAction({ action: 'cancel_request', requestId });
      state.data = null;
      await loadPayments();
    } catch (error) {
      showMessage(error.message, 'error');
    }
  };
})();
