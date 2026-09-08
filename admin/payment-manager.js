(() => {
  const previousFetch = globalThis.fetch.bind(globalThis);
  const state = { booking: null, data: null, loading: false, lastPaymentLink: '' };


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

  document.addEventListener('regal:booking', event => {
    const changed = state.booking?.id !== event.detail.booking.id;
    state.booking = event.detail.booking;
    state.data = null;
    if (changed) state.lastPaymentLink = '';
    ensurePaymentSection(true);
  });

  const showMessage = (text, type = '') => {
    const element = document.getElementById('booking-payment-message');
    if (!element) return;
    element.textContent = text || '';
    element.className = `message ${type}`.trim();
  };

  const paymentSummaryMarkup = () => {
    const summary = state.data?.summary || {};
    return `<div class="payment-stat-grid">
      <div><span>Quote total</span><strong>${escapeHtml(money(summary.subtotalCents))}</strong></div>
      <div><span>Net rental payments</span><strong>${escapeHtml(money(summary.rentalPaidCents))}</strong></div>
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
        ${Number(payment.refunded_cents) ? `<small>Refunded: ${escapeHtml(money(payment.refunded_cents))} · net ${escapeHtml(money(payment.amount_cents - payment.refunded_cents))}</small>` : ''}
        ${Number(payment.method_mismatch) === 1 ? '<small class="payment-warning">Card type did not match the agreement selection.</small>' : ''}
        ${payment.note ? `<small>${escapeHtml(payment.note)}</small>` : ''}
      </div>
      ${state.data.canRefund && Number(payment.amount_cents) > Number(payment.refunded_cents) && ['square','cash'].includes(payment.provider) ? `<button class="button button--quiet" type="button" data-refund-payment="${escapeHtml(payment.id)}">Refund</button>` : ''}
      ${payment.square_receipt_url ? `<a class="button button--quiet" href="${escapeHtml(payment.square_receipt_url)}" target="_blank" rel="noopener">Receipt</a>` : ''}
    </article>`).join('');
  };

  const savedCardsMarkup = () => {
    const cards = state.data?.savedCards || [];
    if (!cards.length) return '<p class="payment-empty">No card is currently stored on file.</p>';
    return cards.map((card) => `<div class="saved-card-row"><strong>${escapeHtml(card.card_brand || 'Card')} ending ${escapeHtml(card.last_4 || '—')}</strong><span>${escapeHtml(card.card_type || '')} · expires ${String(card.exp_month || '').padStart(2, '0')}/${escapeHtml(card.exp_year || '')}</span></div>`).join('');
  };

  const paymentLinkMarkup = () => state.lastPaymentLink
    ? `<div class="payment-link-result" id="payment-link-result"><strong>Payment link created</strong><a href="${escapeHtml(state.lastPaymentLink)}" target="_blank" rel="noopener">${escapeHtml(state.lastPaymentLink)}</a><button class="button button--quiet" id="copy-payment-link" type="button">Copy Link</button></div>`
    : '<div class="payment-link-result" id="payment-link-result" hidden></div>';

  const recoveryMarkup = () => (state.data.attempts || []).map(attempt => `<div class="payment-config"><strong>${attempt.status === 'completed' ? 'Payment received; card storage needs review' : 'Payment result needs confirmation'}</strong><span>${attempt.status === 'completed' ? 'Retry card storage using the recorded payment and customer consent. This does not charge the card again.' : 'The reservation stays protected while this is resolved. Do not collect a replacement payment.'}</span><label>Square payment ID, if available<input data-square-id="${escapeHtml(attempt.id)}" value="${escapeHtml(attempt.square_payment_id || '')}" autocomplete="off"></label><button type="button" class="button button--secondary" data-reconcile-payment="${escapeHtml(attempt.id)}">${attempt.status === 'completed' ? 'Retry card storage' : 'Check Square payment'}</button></div>`).join('');

  const refundsMarkup = () => (state.data.refunds || []).map(refund => `<article class="payment-record"><div><strong>${escapeHtml(money(refund.amount_cents))} · ${escapeHtml(refund.status)}</strong><span>${escapeHtml(refund.reason || '')} · ${escapeHtml(formatDate(refund.created_at))}</span>${refund.square_refund_id ? `<small>Square refund: ${escapeHtml(refund.square_refund_id)}</small>` : ''}</div>${state.data.canRefund && refund.status === 'pending' ? `<button type="button" class="button button--quiet" data-retry-refund="${escapeHtml(refund.id)}">Check / retry this refund</button>` : ''}</article>`).join('') || '<p class="payment-empty">No refunds recorded.</p>';

  const reconcilePayment = async button => {
    button.disabled = true;
    try {
      const data = await postAction({ action: 'reconcile', attemptId: button.dataset.reconcilePayment,
        squarePaymentId: document.querySelector(`[data-square-id="${button.dataset.reconcilePayment}"]`).value.trim() });
      await loadPayments();
      showMessage(data.pending || data.payment?.status === 'processing' ? 'Square has not confirmed a final result. Keep this reservation on hold and check the Square dashboard.' : data.payment?.cardSaveWarning || 'Payment result updated from Square.', data.pending || data.payment?.cardSaveWarning ? '' : 'success');
      await RegalAdmin.refreshBookings();
    } catch (error) { showMessage(error.message, 'error'); }
    finally { button.disabled = false; }
  };

  const showRefundForm = paymentId => {
    const payment = state.data.payments.find(payment => payment.id === paymentId);
    const pending = (state.data.refunds || []).filter(refund => refund.booking_payment_id === paymentId && refund.status === 'pending').reduce((sum, refund) => sum + refund.amount_cents, 0);
    const available = payment.amount_cents - payment.refunded_cents - pending;
    const root = document.getElementById('refund-form-container'); root.hidden = false;
    if (available <= 0) { root.textContent = 'All remaining funds are already being refunded. Check the pending refund below.'; return; }
    root.innerHTML = `<form class="payment-manager-form"><h4>${payment.provider === 'cash' ? 'Record cash returned' : 'Refund through Square'}</h4><label>Refund amount<input name="amount" type="number" min="0.01" max="${(available / 100).toFixed(2)}" step="0.01" value="${(available / 100).toFixed(2)}" required></label><label>Reason<input name="reason" maxlength="130" required></label>${payment.provider === 'cash' ? '<label><input type="checkbox" name="cashReturned" required> I have returned this cash to the customer.</label>' : ''}<p>Refunding money does not cancel this booking or release its inventory. Cancel the booking separately if needed.</p><button class="button button--danger" type="submit">${payment.provider === 'cash' ? 'Record cash refund' : 'Issue refund'}</button><p class="message" aria-live="polite"></p></form>`;
    root.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const refundKey = crypto.randomUUID();
    root.querySelector('form').addEventListener('submit', async event => {
      event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('[type="submit"]');
      const values = new FormData(form);
      if (!confirm(`Refund $${Number(values.get('amount')).toFixed(2)} for ${state.booking.booking_number}?`)) return;
      button.disabled = true;
      try {
        const data = await postAction({ action: 'refund', paymentId, refundKey, reason: values.get('reason'), amountCents: Math.round(Number(values.get('amount')) * 100), cashReturned: values.get('cashReturned') === 'on' });
        await loadPayments();
        showMessage(data.refund.status === 'pending' ? 'Refund pending. Use its existing Check / retry button until Square confirms the result.' : 'Refund recorded.', 'success');
        await RegalAdmin.refreshBookings();
      } catch (error) { form.querySelector('.message').textContent = error.message + ' Refresh payment history before starting another refund.'; }
      finally { button.disabled = false; }
    });
  };

  const retryRefund = async button => {
    const refund = state.data.refunds.find(refund => refund.id === button.dataset.retryRefund);
    const payment = state.data.payments.find(payment => payment.id === refund.booking_payment_id);
    if (payment?.provider === 'cash' && !confirm('Confirm this cash has already been returned. This only completes the existing refund record.')) return;
    button.disabled = true;
    try {
      const data = await postAction({ action: 'refund', paymentId: refund.booking_payment_id, refundKey: refund.id,
        amountCents: refund.amount_cents, reason: refund.reason, cashReturned: payment?.provider === 'cash' });
      await loadPayments(); showMessage(`Refund ${data.refund.status}.`, 'success'); await RegalAdmin.refreshBookings();
    } catch (error) { showMessage(error.message, 'error'); }
    finally { button.disabled = false; }
  };

  const defaultAmountCents = (purpose) => {
    const summary = state.data?.summary || {};
    if (purpose === 'security_deposit') return Math.round(Number(state.data?.booking?.subtotal_cents || 0) / 2);
    if (purpose === 'reservation') return Math.min(Number(summary.rentalBalanceCents || 0), Math.round(Number(summary.subtotalCents || 0) / 2));
    if (purpose === 'balance') return Number(summary.rentalBalanceCents || 0);
    return 0;
  };

  const render = () => {
    const root = document.getElementById('booking-payment-manager');
    if (!root || !state.data) return;
    const signed = state.data.signedPaymentMethod || {};
    const configuredNotice = state.data.configured
      ? `<div class="payment-config payment-config--ready"><strong>Square ${escapeHtml(state.data.environment)} is connected.</strong><span>Verify the complete booking, payment and refund flow before accepting public payments.</span></div>`
      : `<div class="payment-config"><strong>Square credentials still need to be connected.</strong><span>Online payment links will be available after account setup. Received cash can be recorded below.</span></div>`;

    root.innerHTML = `<div class="booking-payments-heading"><div><p class="eyebrow">Payments</p><h3>Payments & Security</h3></div><p>Signed method: <strong>${escapeHtml(methodLabel(signed.method))}</strong>${signed.depositCents ? ` · deposit ${escapeHtml(money(signed.depositCents))}` : ''}</p></div>
      ${configuredNotice}
      ${paymentSummaryMarkup()}
      ${recoveryMarkup()}
      <div class="payment-config"><strong>Before equipment release</strong><span>${[['pricing_ready','Final pricing'],['agreement_ready','Current signed agreement'],['balance_ready','Rental balance paid'],['security_ready','Card on file or refundable deposit']].map(([key,label]) => `${state.data.releaseChecks?.[key] ? '✓' : 'Pending:'} ${label}`).join(' · ')}</span><span>Mark Ready only after checking the equipment, event details and delivery arrangements.</span></div>
      <div class="payment-manager-grid">
        <form id="create-payment-request-form" class="payment-manager-form">
          <h4>Create Online Payment Link</h4>
          <label>Purpose<select name="purpose"><option value="reservation">50% reservation payment</option><option value="balance">Remaining rental balance</option><option value="security_deposit">50% refundable security deposit</option><option value="custom">Custom payment</option></select></label>
          <label>Amount<input name="amount" type="number" min="0.01" step="0.01" required /></label>
          <label>Expected card type<select name="expectedMethod"><option value="auto">Use signed agreement</option><option value="credit_card">Credit card — save card on file</option><option value="debit_card">Debit card — no card storage</option><option value="unspecified">Not specified</option></select></label>
          <label>Maximum link lifetime<select name="expiresDays"><option value="3">3 days</option><option value="7" selected>7 days</option><option value="14">14 days</option><option value="30">30 days</option></select></label><p class="payment-full">A link for a temporary hold expires when that hold ends. Collect the rental reservation payment before a separate security deposit.</p>
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
      ${paymentLinkMarkup()}
      <p class="message" id="booking-payment-message" aria-live="polite"></p>
      <div class="payment-record-columns"><section><h4>Payment Requests</h4><div id="payment-request-list">${requestsMarkup()}</div></section><section><h4>Completed Payments</h4><div id="booking-payment-list">${paymentsMarkup()}</div></section></div>
      <section id="refund-form-container" hidden></section>
      <section><h4>Refund history</h4>${refundsMarkup()}</section>
      <section class="saved-cards-section"><h4>Cards Stored Securely by Square</h4>${savedCardsMarkup()}</section>`;

    root.querySelectorAll('[data-refund-payment]').forEach(button => button.addEventListener('click', () => showRefundForm(button.dataset.refundPayment)));
    root.querySelectorAll('[data-retry-refund]').forEach(button => button.addEventListener('click', () => retryRefund(button)));
    root.querySelectorAll('[data-reconcile-payment]').forEach(button => button.addEventListener('click', () => reconcilePayment(button)));
    const createForm = document.getElementById('create-payment-request-form');
    const cashForm = document.getElementById('record-cash-form');
    const setFormAmount = (form) => {
      const cents = defaultAmountCents(form.elements.purpose.value);
      form.elements.amount.value = cents > 0 ? (cents / 100).toFixed(2) : '';
    };
    createForm.elements.purpose.addEventListener('change', () => setFormAmount(createForm));
    cashForm.elements.purpose.addEventListener('change', () => setFormAmount(cashForm));
    setFormAmount(createForm);
    setFormAmount(cashForm);
    createForm.addEventListener('submit', createPaymentRequest);
    cashForm.addEventListener('submit', recordCash);
    document.querySelectorAll('[data-cancel-payment-request]').forEach((button) => {
      button.addEventListener('click', () => cancelRequest(button.dataset.cancelPaymentRequest));
    });
    const copyButton = document.getElementById('copy-payment-link');
    if (copyButton) {
      copyButton.addEventListener('click', async () => {
        await navigator.clipboard.writeText(state.lastPaymentLink);
        showMessage('Payment link copied.', 'success');
      });
    }
  };

  const loadPayments = async () => {
    if (!state.booking) return;
    const bookingId = state.booking.id;
    const sequence = state.loadSequence = (state.loadSequence || 0) + 1;
    state.loading = true;
    try {
      const response = await previousFetch(`/api/admin/bookings/${encodeURIComponent(state.booking.id)}/payments`, {
        credentials: 'same-origin', headers: { Accept: 'application/json' }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error?.message || 'Payments could not be loaded.');
      if (sequence !== state.loadSequence || state.booking.id !== bookingId) return;
      state.data = data;
      const cashStorageKey = 'regal-cash-' + bookingId;
      const previousCashKey = sessionStorage.getItem(cashStorageKey);
      const recoveredCash = previousCashKey && data.payments.some(payment => payment.cash_key === previousCashKey);
      if (recoveredCash) sessionStorage.removeItem(cashStorageKey);
      render();
      if (recoveredCash) showMessage('Your previous cash entry is confirmed in the payment history. Record Cash only for additional money received.', 'success');
    } catch (error) {
      if (sequence !== state.loadSequence) return;
      const root = document.getElementById('booking-payment-manager');
      if (root) root.innerHTML = `<div class="payment-config"><strong>Payment setup is not active yet.</strong><span>${escapeHtml(error.message)}</span></div>`;
    } finally {
      if (sequence === state.loadSequence) state.loading = false;
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
      state.lastPaymentLink = data.paymentRequest.paymentUrl;
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
    const button = form.querySelector('[type="submit"]');
    if (button.disabled) return;
    if (!confirm(`Record ${values.get('amount')} in cash as received? Count the cash and issue a receipt before confirming.`)) return;
    button.disabled = true;
    const storageKey = 'regal-cash-' + state.booking.id;
    const stored = sessionStorage.getItem(storageKey);
    const cashKey = stored || crypto.randomUUID();
    sessionStorage.setItem(storageKey, cashKey);
    showMessage('Recording cash payment…');
    try {
      await postAction({
        action: 'record_cash', cashKey, purpose: values.get('purpose'),
        amountCents: Math.round(Number(values.get('amount')) * 100), note: values.get('note')
      });
      state.lastPaymentLink = '';
      sessionStorage.removeItem(storageKey);
      showMessage('Cash payment recorded. Keep the signed or printed receipt with the booking record.', 'success');
      state.data = null;
      await loadPayments();
      await RegalAdmin.openBooking(state.booking.id); await RegalAdmin.refreshBookings();
    } catch (error) {
      showMessage(error.message + ' Retry the same details if the result is uncertain.', 'error');
    } finally { button.disabled = false; }
  };

  const cancelRequest = async (requestId) => {
    if (!confirm('Cancel this payment link? It will no longer accept payment.')) return;
    try {
      await postAction({ action: 'cancel_request', requestId });
      state.lastPaymentLink = '';
      state.data = null;
      await loadPayments();
    } catch (error) {
      showMessage(error.message, 'error');
    }
  };
})();
