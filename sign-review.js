(() => {
  const agreement = document.getElementById('agreement-content');
  const form = document.getElementById('signature-form');
  const summaryPayment = document.getElementById('key-summary-payment');
  const proofHost = document.getElementById('signed-proof-host');

  if (!agreement || !form || !summaryPayment || !proofHost) return;

  const money = (cents) => (Number(cents || 0) / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD'
  });

  const agreementDetails = () => {
    const article = agreement.querySelector('.agreement');
    return {
      customerChoiceRequired: article?.dataset.customerSecurityChoice === 'required',
      depositCents: Number(article?.dataset.securityDepositCents || 0)
    };
  };

  const updatePaymentSummary = () => {
    const details = agreementDetails();
    const selected = form.querySelector('input[name="paymentSecurityMethod"]:checked')?.value || '';

    if (!details.customerChoiceRequired) {
      summaryPayment.textContent = 'Refer to the Payment Security entry in the complete agreement for the requirements that apply to this agreement version.';
      return;
    }

    if (selected === 'credit_card') {
      summaryPayment.textContent = 'Credit card selected: no refundable security deposit. The same valid credit card used for payment must be securely stored on file.';
      return;
    }

    if (selected === 'debit_card') {
      summaryPayment.textContent = `Debit card selected: a refundable deposit of ${money(details.depositCents)}, equal to 50% of the rental subtotal, is required before equipment release.`;
      return;
    }

    if (selected === 'cash') {
      summaryPayment.textContent = `Cash selected: a refundable deposit of ${money(details.depositCents)}, equal to 50% of the rental subtotal, is required before equipment release.`;
      return;
    }

    summaryPayment.textContent = `Credit card requires a securely stored card with no refundable deposit. Debit card or cash requires a refundable deposit of ${money(details.depositCents)}, equal to 50% of the rental subtotal.`;
  };

  const moveSignatureProof = () => {
    const proof = agreement.querySelector('#signed-proof');
    if (proof) proofHost.appendChild(proof);
  };

  form.addEventListener('change', (event) => {
    if (event.target?.name === 'paymentSecurityMethod') updatePaymentSummary();
  });

  const observer = new MutationObserver(() => {
    updatePaymentSummary();
    moveSignatureProof();
  });

  observer.observe(agreement, { childList: true, subtree: true });
  updatePaymentSummary();
})();
