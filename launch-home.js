(() => {
  const form = document.querySelector('#quote-form');
  const menuButton = document.querySelector('.menu-button');
  const nav = document.querySelector('#nav');
  const date = form?.elements.namedItem('date');
  const status = document.querySelector('#form-status');
  const submitButton = form?.querySelector('[type="submit"]');
  const success = document.querySelector('#form-success');
  const reference = document.querySelector('#form-reference');
  const packageSelect = document.querySelector('#package-select');

  const today = () => {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return [d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate())].join('-');
  };
  const year = document.querySelector('#year');
  if (year) year.textContent = String(new Date().getFullYear());
  if (date) date.min = today();

  const closeMenu = () => {
    document.body.classList.remove('menu-open');
    menuButton?.setAttribute('aria-expanded','false');
  };
  menuButton?.addEventListener('click', () => {
    const opened = document.body.classList.toggle('menu-open');
    menuButton.setAttribute('aria-expanded', String(opened));
  });
  nav?.querySelectorAll('a').forEach(a => a.addEventListener('click', closeMenu));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });

  const cleanKey = text => text.toLowerCase().replace(/[^a-z0-9]/g,'');
  document.querySelectorAll('[data-item]').forEach(link => {
    link.addEventListener('click', () => {
      const key = cleanKey(link.dataset.item);
      const checkbox = Array.from(form?.querySelectorAll('[name="item"]') || [])
        .find(input => cleanKey(input.value) === key);
      if (checkbox) checkbox.checked = true;
      if (packageSelect && !packageSelect.value) packageSelect.value = 'Custom rental';
    });
  });
  document.querySelectorAll('[data-package]').forEach(link => {
    link.addEventListener('click', () => { if (packageSelect) packageSelect.value = link.dataset.package; });
  });

  if (!form) return;
  const setStatus = (message, error = false) => {
    status.textContent = message;
    status.classList.toggle('form-status--error', error);
  };
  document.querySelector('#new-inquiry')?.addEventListener('click', () => {
    form.reset();
    form.querySelectorAll('input,select,textarea,button').forEach(element => { element.disabled = false; });
    date.min = today();
    success.hidden = true;
    submitButton.hidden = false;
    setStatus("Your request goes directly to Regal Rentals. We'll confirm availability and get back to you.");
    form.elements.name.focus();
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (date) date.min = today();
    if (!form.reportValidity()) return;
    if (submitButton.disabled) return;
    const fields = new FormData(form);
    const payload = {
      name: String(fields.get('name') || '').trim(),
      email: String(fields.get('email') || '').trim(),
      date: String(fields.get('date') || ''),
      city: String(fields.get('city') || '').trim(),
      phone: String(fields.get('phone') || '').trim(),
      package: String(fields.get('package') || '').trim(),
      items: fields.getAll('item').map(String),
      details: String(fields.get('details') || '').trim(),
      website: String(fields.get('website') || '')
    };
    const labels = submitButton.querySelector('span:first-child');
    const original = labels?.textContent;
    submitButton.disabled = true;
    if (labels) labels.textContent = 'Sending request…';
    setStatus('Submitting your request securely…');

    try {
      const response = await fetch('/api/public/inquiry', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data?.error?.message || 'We could not submit your request. Please try again.');
      if (reference) reference.textContent = data.reference || 'Received';
      success.hidden = false;
      submitButton.hidden = true;
      form.querySelectorAll('input,select,textarea').forEach(element => { element.disabled = true; });
      setStatus('Your request was submitted successfully.');
      success.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (error) {
      setStatus(String(error.message || 'Request failed.') + ' If the issue continues, email bookings@regal.rentals.', true);
    } finally {
      submitButton.disabled = false;
      if (labels) labels.textContent = original;
    }
  });
})();