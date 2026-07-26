(() => {
  const previousFetch = globalThis.fetch.bind(globalThis);
  const signingEndpoint = /^\/api\/admin\/bookings\/[^/]+\/signing-link$/;

  const ensureStyles = () => {
    if (document.getElementById('agreement-security-styles')) return;
    const style = document.createElement('style');
    style.id = 'agreement-security-styles';
    style.textContent = `
      .agreement-security-dialog{width:min(92vw,560px);border:0;border-radius:20px;padding:0;box-shadow:0 26px 80px rgba(38,6,63,.28);color:#24192c}
      .agreement-security-dialog::backdrop{background:rgba(25,11,36,.62);backdrop-filter:blur(3px)}
      .agreement-security-dialog form{padding:26px;display:grid;gap:18px}
      .agreement-security-dialog h2{margin:0;color:#26063f;font-family:Georgia,serif}
      .agreement-security-dialog p{margin:0;color:#6f6377}
      .agreement-security-options{display:grid;grid-template-columns:1fr 1fr;gap:12px}
      .agreement-security-option{display:grid;gap:6px;padding:16px;border:2px solid #e8dac0;border-radius:14px;background:#fff;cursor:pointer}
      .agreement-security-option:has(input:checked){border-color:#c9982e;background:#fffaf0}
      .agreement-security-option input{accent-color:#26063f}
      .agreement-security-option strong{color:#26063f}
      .agreement-security-deposit{display:grid;gap:7px;font-weight:800;color:#26063f}
      .agreement-security-deposit input{padding:12px;border:1px solid #d9ccb4;border-radius:10px;font:inherit}
      .agreement-security-actions{display:flex;justify-content:flex-end;gap:10px}
      .agreement-security-actions button{border:0;border-radius:10px;padding:12px 16px;font:inherit;font-weight:900;cursor:pointer}
      .agreement-security-cancel{background:#f2ebdf;color:#26063f}.agreement-security-continue{background:#26063f;color:#fff}
      @media(max-width:560px){.agreement-security-options{grid-template-columns:1fr}.agreement-security-actions{flex-direction:column-reverse}.agreement-security-actions button{width:100%}}
    `;
    document.head.appendChild(style);
  };

  const choosePaymentSecurity = () => new Promise((resolve, reject) => {
    ensureStyles();
    const dialog = document.createElement('dialog');
    dialog.className = 'agreement-security-dialog';
    dialog.innerHTML = `
      <form method="dialog">
        <div><h2>Choose Payment Security</h2><p>This is an internal Regal Rentals selection. The customer cannot change it.</p></div>
        <div class="agreement-security-options">
          <label class="agreement-security-option"><span><input type="radio" name="security" value="card_on_file" checked /> <strong>Card on File</strong></span><small>Authorize documented additional charges under the agreement.</small></label>
          <label class="agreement-security-option"><span><input type="radio" name="security" value="security_deposit" /> <strong>Security Deposit</strong></span><small>Apply documented charges against a collected deposit.</small></label>
        </div>
        <label class="agreement-security-deposit" hidden>Security deposit amount ($)<input name="deposit" type="number" min="0" step="0.01" inputmode="decimal" value="100.00" /></label>
        <div class="agreement-security-actions"><button class="agreement-security-cancel" type="button">Cancel</button><button class="agreement-security-continue" type="submit">Create Signing Link</button></div>
      </form>`;
    document.body.appendChild(dialog);
    const depositLabel = dialog.querySelector('.agreement-security-deposit');
    const syncDeposit = () => { depositLabel.hidden = dialog.querySelector('input[name="security"]:checked').value !== 'security_deposit'; };
    dialog.querySelectorAll('input[name="security"]').forEach((input) => input.addEventListener('change', syncDeposit));
    dialog.querySelector('.agreement-security-cancel').addEventListener('click', () => dialog.close('cancel'));
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); dialog.close('cancel'); });
    dialog.addEventListener('close', () => {
      const result = dialog.returnValue;
      if (result === 'cancel') {
        dialog.remove();
        reject(new Error('Signing link creation canceled.'));
      }
    });
    dialog.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault();
      const paymentSecurityMethod = dialog.querySelector('input[name="security"]:checked').value;
      const amount = Number(dialog.querySelector('input[name="deposit"]').value || 0);
      if (paymentSecurityMethod === 'security_deposit' && (!Number.isFinite(amount) || amount < 0)) return;
      dialog.returnValue = 'submitted';
      dialog.close();
      dialog.remove();
      resolve({
        paymentSecurityMethod,
        ...(paymentSecurityMethod === 'security_deposit' ? { securityDepositCents: Math.round(amount * 100) } : {})
      });
    });
    syncDeposit();
    dialog.showModal();
  });

  globalThis.fetch = async (input, init = {}) => {
    const rawUrl = typeof input === 'string' ? input : input?.url;
    const url = new URL(rawUrl, globalThis.location.origin);
    const method = String(init.method || (typeof input !== 'string' ? input?.method : '') || 'GET').toUpperCase();
    if (method === 'POST' && signingEndpoint.test(url.pathname)) {
      let body = {};
      try { body = JSON.parse(String(init.body || '{}')); } catch { body = {}; }
      if (!body.paymentSecurityMethod) {
        const security = await choosePaymentSecurity();
        init = { ...init, body: JSON.stringify({ ...body, ...security }) };
      }
    }
    return previousFetch(input, init);
  };
})();
