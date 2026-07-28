(() => {
  const token = new URLSearchParams(location.search).get('token') || '';
  const loading = document.getElementById('payment-loading');
  const errorCard = document.getElementById('payment-error');
  const errorMessage = document.getElementById('payment-error-message');
  const paymentView = document.getElementById('payment-view');
  const successCard = document.getElementById('payment-success');
  const form = document.getElementById('square-payment-form');
  const submitButton = document.getElementById('submit-payment');
  const message = document.getElementById('payment-message');
  const consentRow = document.getElementById('card-consent-row');
  const consent = document.getElementById('card-on-file-consent');
  let paymentRequest = null;
  let squareCard = null;

  const money = (cents) => (Number(cents || 0) / 100).toLocaleString('en-US', {
    style: 'currency', currency: 'USD'
  });

  const formatDate = (epoch) => new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', dateStyle: 'long', timeStyle: 'short'
  }).format(new Date(Number(epoch) * 1000));

  const showError = (text) => {
    loading.hidden = true;
    paymentView.hidden = true;
    successCard.hidden = true;
    errorCard.hidden = false;
    errorMessage.textContent = text;
  };

  const showMessage = (text, type = '') => {
    message.textContent = text || '';
    message.className = `payment-message ${type}`.trim();
  };

  const splitName = (value) => {
    const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
    return {
      givenName: parts.length > 1 ? parts.slice(0, -1).join(' ') : (parts[0] || 'Customer'),
      familyName: parts.length > 1 ? parts.at(-1) : ''
    };
  };

  const loadSquareScript = (url) => new Promise((resolve, reject) => {
    if (window.Square) return resolve();
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Square payment form could not be loaded.'));
    document.head.appendChild(script);
  });

  const renderPayment = () => {
    document.getElementById('payment-booking').textContent = paymentRequest.bookingNumber;
    document.getElementById('payment-customer').textContent = paymentRequest.customerName;
    document.getElementById('payment-event').textContent = formatDate(paymentRequest.eventStartAt);
    document.getElementById('payment-purpose').textContent = paymentRequest.purposeLabel;
    document.getElementById('payment-amount').textContent = money(paymentRequest.amountCents);
    document.getElementById('payment-button-amount').textContent = money(paymentRequest.amountCents);
    document.getElementById('payment-description').textContent = paymentRequest.description || '';
    document.getElementById('cardholder-name').value = paymentRequest.customerName || '';

    const note = document.getElementById('payment-method-note');
    if (paymentRequest.expectedMethod === 'credit_card') {
      note.textContent = 'This booking is set for credit-card payment. No refundable security deposit is required, but the same credit card must be securely stored on file.';
      consentRow.hidden = false;
      consent.required = true;
    } else if (paymentRequest.expectedMethod === 'debit_card') {
      note.textContent = 'This booking is set for debit-card payment. The refundable security deposit required by the rental agreement is separate unless this request is specifically labeled as the security deposit.';
    } else {
      note.className = 'method-warning';
      note.textContent = 'Regal Rentals has not matched this link to a signed credit-card or debit-card selection. Contact Regal Rentals before paying if the expected method is unclear.';
    }
  };

  const initializeSquare = async () => {
    await loadSquareScript(paymentRequest.square.sdkUrl);
    if (!window.Square) throw new Error('Square payment form could not be initialized.');
    const payments = window.Square.payments(
      paymentRequest.square.applicationId,
      paymentRequest.square.locationId
    );
    squareCard = await payments.card();
    await squareCard.attach('#square-card-container');
    submitButton.disabled = false;
  };

  const showAlreadyPaid = () => {
    loading.hidden = true;
    paymentView.hidden = true;
    errorCard.hidden = true;
    successCard.hidden = false;
    document.getElementById('payment-success-message').textContent = 'This payment request has already been completed.';
  };

  const loadPayment = async () => {
    if (!token || token.length < 30) {
      showError('This payment link is invalid.');
      return;
    }
    try {
      const response = await fetch(`/api/pay/${encodeURIComponent(token)}`, {
        credentials: 'omit', headers: { Accept: 'application/json' }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || 'Payment request could not be loaded.');
      paymentRequest = data.payment;
      if (paymentRequest.status === 'paid') {
        showAlreadyPaid();
        return;
      }
      if (['cancelled', 'expired'].includes(paymentRequest.status)) {
        showError('This payment link is no longer active. Contact Regal Rentals for a new link.');
        return;
      }
      if (!paymentRequest.square?.configured) {
        showError('Online payment is not active yet. Contact Regal Rentals.');
        return;
      }
      renderPayment();
      loading.hidden = true;
      paymentView.hidden = false;
      await initializeSquare();
    } catch (error) {
      showError(error.message);
    }
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage('');
    if (!squareCard || !paymentRequest) return;
    if (paymentRequest.requireCardOnFile && !consent.checked) {
      showMessage('Review and accept the credit-card storage authorization.', 'error');
      consent.focus();
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = 'Processing securely…';
    try {
      const name = splitName(document.getElementById('cardholder-name').value);
      const verificationDetails = {
        amount: (Number(paymentRequest.amountCents) / 100).toFixed(2),
        currencyCode: 'USD',
        intent: paymentRequest.requireCardOnFile ? 'CHARGE_AND_STORE' : 'CHARGE',
        billingContact: {
          givenName: name.givenName,
          familyName: name.familyName,
          email: paymentRequest.customerEmail,
          countryCode: 'US'
        },
        customerInitiated: true,
        sellerKeyedIn: false
      };
      const tokenResult = await squareCard.tokenize(verificationDetails);
      if (tokenResult.status !== 'OK' || !tokenResult.token) {
        const detail = (tokenResult.errors || []).map((item) => item.message).filter(Boolean).join(' ');
        throw new Error(detail || 'Check the card information and try again.');
      }

      const response = await fetch(`/api/pay/${encodeURIComponent(token)}`, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId: tokenResult.token,
          cardholderName: document.getElementById('cardholder-name').value,
          cardOnFileConsent: consent.checked
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || 'The payment could not be completed.');

      paymentView.hidden = true;
      successCard.hidden = false;
      const payment = data.payment;
      const warnings = [];
      if (payment.methodMismatch) {
        warnings.push('The card type processed by Square did not match the payment method selected for the agreement. Regal Rentals will review the booking.');
      }
      if (payment.depositStillRequired) {
        warnings.push('Square identified the card as debit. The refundable 50% security deposit remains required unless this payment was specifically for that deposit.');
      }
      if (payment.cardSaveWarning) warnings.push(payment.cardSaveWarning);
      document.getElementById('payment-success-message').textContent = `${payment.purposeLabel} of ${money(payment.amountCents)} was received.`;
      document.getElementById('payment-success-details').innerHTML = [
        payment.cardBrand || payment.cardLast4 ? `<p><strong>Card:</strong> ${payment.cardBrand || 'Card'} ending ${payment.cardLast4 || '—'}</p>` : '',
        payment.cardOnFileSaved ? '<p><strong>Card on file:</strong> Securely saved with Square</p>' : '',
        ...warnings.map((warning) => `<p class="method-warning">${warning}</p>`)
      ].filter(Boolean).join('');
      const receipt = document.getElementById('square-receipt-link');
      if (payment.receiptUrl) {
        receipt.href = payment.receiptUrl;
        receipt.hidden = false;
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      showMessage(error.message, 'error');
      submitButton.disabled = false;
      submitButton.innerHTML = `Pay <span>${money(paymentRequest.amountCents)}</span>`;
    }
  });

  loadPayment();
})();
