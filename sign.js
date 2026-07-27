(() => {
  const token = new URLSearchParams(location.search).get('token') || '';
  const loading = document.getElementById('loading-card');
  const errorCard = document.getElementById('error-card');
  const errorMessage = document.getElementById('error-message');
  const signingView = document.getElementById('signing-view');
  const successCard = document.getElementById('success-card');
  const form = document.getElementById('signature-form');
  const canvas = document.getElementById('signature-canvas');
  const context = canvas.getContext('2d');
  const paymentChoice = document.getElementById('payment-security-choice');
  const strokes = [];
  let activeStroke = null;
  let securityRequired = false;
  let securityDepositCents = 0;

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const money = (cents) => (Number(cents || 0) / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD'
  });

  const securityLabel = (method, depositCents) => {
    if (method === 'credit_card') return 'Credit Card — no refundable deposit; card securely stored on file';
    if (method === 'debit_card') return `Debit Card — refundable security deposit ${money(depositCents)}`;
    if (method === 'cash') return `Cash — refundable security deposit ${money(depositCents)}`;
    return '';
  };

  const showSignedAgreement = ({ typedName, signatureSvg, evidenceSha256, signedAt, paymentSecurityMethod, depositCents }) => {
    const agreement = document.getElementById('agreement-content');
    let proof = document.getElementById('signed-proof');
    if (!proof) {
      proof = document.createElement('section');
      proof.id = 'signed-proof';
      proof.className = 'signed-proof';
      agreement.appendChild(proof);
    }
    const signedDate = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      dateStyle: 'long',
      timeStyle: 'short'
    }).format(new Date(Number(signedAt) * 1000));
    const selectedSecurity = securityLabel(paymentSecurityMethod, depositCents);
    proof.innerHTML = `
      <h2>Electronic Signature</h2>
      <div class="stored-signature">${signatureSvg || ''}</div>
      <p><strong>Signed by:</strong> ${escapeHtml(typedName)}</p>
      <p><strong>Signed:</strong> ${escapeHtml(signedDate)}</p>
      ${selectedSecurity ? `<p><strong>Payment method and security:</strong> ${escapeHtml(selectedSecurity)}</p>` : ''}
      <p><strong>Evidence reference:</strong> <code>${escapeHtml(evidenceSha256)}</code></p>
    `;
  };

  const showError = (message) => {
    loading.hidden = true;
    signingView.hidden = true;
    successCard.hidden = true;
    errorCard.hidden = false;
    errorMessage.textContent = message;
  };

  const pointerPosition = (event) => {
    const rect = canvas.getBoundingClientRect();
    return [
      Math.max(0, Math.min(600, ((event.clientX - rect.left) / rect.width) * 600)),
      Math.max(0, Math.min(200, ((event.clientY - rect.top) / rect.height) * 200))
    ];
  };

  const drawSegment = (from, to) => {
    context.strokeStyle = '#24192c';
    context.lineWidth = 2.5;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    context.moveTo(from[0], from[1]);
    context.lineTo(to[0], to[1]);
    context.stroke();
  };

  canvas.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    activeStroke = [pointerPosition(event)];
    strokes.push(activeStroke);
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!activeStroke) return;
    event.preventDefault();
    const next = pointerPosition(event);
    const previous = activeStroke[activeStroke.length - 1];
    activeStroke.push(next);
    drawSegment(previous, next);
  });

  const finishStroke = (event) => {
    if (!activeStroke) return;
    event.preventDefault();
    if (activeStroke.length === 1) {
      const point = activeStroke[0];
      activeStroke.push([Math.min(600, point[0] + 0.1), Math.min(200, point[1] + 0.1)]);
    }
    activeStroke = null;
  };
  canvas.addEventListener('pointerup', finishStroke);
  canvas.addEventListener('pointercancel', finishStroke);

  document.getElementById('clear-signature').addEventListener('click', () => {
    strokes.length = 0;
    activeStroke = null;
    context.clearRect(0, 0, canvas.width, canvas.height);
  });

  const configurePaymentChoice = (security) => {
    securityRequired = security?.required === true;
    securityDepositCents = Number(security?.depositCents || 0);
    paymentChoice.hidden = !securityRequired;
    document.querySelectorAll('.security-deposit-amount').forEach((element) => {
      element.textContent = money(securityDepositCents);
    });
    if (security?.selectedMethod) {
      const selected = form.querySelector(`input[name="paymentSecurityMethod"][value="${CSS.escape(security.selectedMethod)}"]`);
      if (selected) selected.checked = true;
    }
  };

  const loadAgreement = async () => {
    if (!token || !/^[a-f0-9]{64}$/i.test(token)) {
      showError('This signing link is invalid.');
      return;
    }
    try {
      const response = await fetch(`/api/sign/${encodeURIComponent(token)}`, {
        credentials: 'omit',
        headers: { Accept: 'application/json' }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || 'Agreement could not be loaded.');
      loading.hidden = true;
      signingView.hidden = false;
      document.getElementById('sign-title').textContent = `Agreement ${data.agreement.bookingNumber}`;
      document.getElementById('sign-meta').textContent = `Prepared for ${data.agreement.signerName} · Version ${data.agreement.version}`;
      document.getElementById('typed-name').value = data.agreement.signerName;
      document.getElementById('agreement-content').innerHTML = data.agreement.html;
      configurePaymentChoice(data.agreement.paymentSecurity);
      if (data.agreement.signedAt && data.agreement.signature) {
        form.hidden = true;
        showSignedAgreement({
          typedName: data.agreement.signature.typedName,
          signatureSvg: data.agreement.signature.svg,
          evidenceSha256: data.agreement.signature.evidenceSha256,
          signedAt: data.agreement.signedAt,
          paymentSecurityMethod: data.agreement.paymentSecurity?.selectedMethod,
          depositCents: data.agreement.paymentSecurity?.depositCents
        });
        successCard.hidden = false;
        document.getElementById('evidence-hash').textContent = data.agreement.signature.evidenceSha256;
      }
    } catch (error) {
      showError(error.message);
    }
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = document.getElementById('signature-message');
    message.textContent = '';
    message.className = 'form-message';
    const selectedSecurity = form.querySelector('input[name="paymentSecurityMethod"]:checked')?.value || '';
    if (securityRequired && !selectedSecurity) {
      message.textContent = 'Choose Credit Card, Debit Card, or Cash.';
      message.classList.add('error');
      paymentChoice.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (!strokes.length) {
      message.textContent = 'Please draw your signature.';
      message.classList.add('error');
      return;
    }
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    button.textContent = 'Recording Signature…';
    try {
      const response = await fetch(`/api/sign/${encodeURIComponent(token)}`, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          typedName: document.getElementById('typed-name').value,
          consent: document.getElementById('signature-consent').checked,
          paymentSecurityMethod: selectedSecurity || undefined,
          signatureStrokes: strokes
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || 'Signature could not be recorded.');
      form.hidden = true;
      showSignedAgreement({
        typedName: data.typedName,
        signatureSvg: data.signatureSvg,
        evidenceSha256: data.evidenceSha256,
        signedAt: data.signedAt,
        paymentSecurityMethod: data.paymentSecurityMethod,
        depositCents: data.securityDepositCents
      });
      successCard.hidden = false;
      document.getElementById('evidence-hash').textContent = data.evidenceSha256;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      message.textContent = error.message;
      message.classList.add('error');
      button.disabled = false;
      button.textContent = 'Agree and Sign';
    }
  });

  document.getElementById('print-agreement').addEventListener('click', () => window.print());
  loadAgreement();
})();
