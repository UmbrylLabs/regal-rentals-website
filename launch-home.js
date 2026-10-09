(() => {
  const menu = document.querySelector('.menu-toggle');
  const nav = document.querySelector('#main-nav');
  const year = document.querySelector('#year');
  const form = document.querySelector('#quote-form');
  const dateInput = form?.elements.namedItem('date');
  const status = document.querySelector('#form-status');
  const packageSelect = document.querySelector('#package-select');

  if (year) year.textContent = String(new Date().getFullYear());

  function closeMenu() {
    document.body.classList.remove('menu-open');
    if (menu) menu.setAttribute('aria-expanded', 'false');
  }

  if (menu) {
    menu.addEventListener('click', () => {
      const open = document.body.classList.toggle('menu-open');
      menu.setAttribute('aria-expanded', String(open));
    });
  }

  nav?.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
  });

  // Use the visitor's local date, not UTC, to avoid hiding today's date in
  // late-afternoon time zones.
  function localToday() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return [now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate())].join('-');
  }
  if (dateInput) dateInput.min = localToday();

  document.querySelectorAll('[data-item]').forEach((link) => {
    link.addEventListener('click', () => {
      const label = link.dataset.item;
      const match = [...(form?.querySelectorAll('input[name="item"]') || [])]
        .find((input) => {
          const selected = input.value.toLowerCase().replace(/[^a-z0-9]/g, '');
          const requested = label.toLowerCase().replace(/[^a-z0-9]/g, '');
          return selected === requested || selected.includes(requested) || requested.includes(selected);
        });
      if (match) match.checked = true;
      if (packageSelect && !packageSelect.value) packageSelect.value = 'Custom rental / individual items';
    });
  });

  document.querySelectorAll('[data-package]').forEach((link) => {
    link.addEventListener('click', () => {
      if (packageSelect) packageSelect.value = link.dataset.package;
    });
  });

  if (!form) return;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (form.elements.namedItem('website')?.value) return;

    if (dateInput) dateInput.min = localToday();
    if (!form.reportValidity()) return;

    const data = new FormData(form);
    const values = (name) => String(data.get(name) || '').trim();
    const items = data.getAll('item').map(String);
    const details = [
      'Regal Rentals — Event Rental Quote Request',
      '',
      'Customer:',
      'Name: ' + values('name'),
      'Email: ' + values('email'),
      'Phone: ' + (values('phone') || 'Not provided'),
      '',
      'Event:',
      'Date: ' + values('date'),
      'City: ' + values('city'),
      'Package: ' + (values('package') || 'Not selected'),
      'Requested items: ' + (items.length ? items.join(', ') : 'Please advise'),
      '',
      'Additional details:',
      values('details') || 'None provided',
      '',
      'Sent from the Regal Rentals website quote form.'
    ];

    const subject = 'Rental quote request — ' + values('date');
    const emailHref = 'mailto:bookings@regal.rentals?subject=' +
      encodeURIComponent(subject) + '&body=' + encodeURIComponent(details.join('\n'));
    if (status) {
      status.textContent = 'Your email app will open with your request prepared. Please press Send there; this form has not sent anything yet.';
    }

    // No customer reservation, inventory hold, or payment is created by this
    // quote form. Booking and agreement workflows remain private.
    window.location.href = emailHref;
  });
})();
