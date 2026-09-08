(() => {
  const body = document.body;
  const navToggle = document.querySelector('.nav-toggle');
  const navLinks = document.querySelectorAll('.site-nav a');
  const year = document.getElementById('year');

  if (year) year.textContent = new Date().getFullYear();

  if (navToggle) {
    navToggle.addEventListener('click', () => {
      const open = body.classList.toggle('nav-open');
      navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  navLinks.forEach((link) => {
    link.addEventListener('click', () => {
      body.classList.remove('nav-open');
      if (navToggle) navToggle.setAttribute('aria-expanded', 'false');
    });
  });

  const revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.14, rootMargin: '0px 0px -60px 0px' });

    revealEls.forEach((el, index) => {
      el.style.transitionDelay = `${Math.min(index % 5, 4) * 70}ms`;
      observer.observe(el);
    });
  } else {
    revealEls.forEach((el) => el.classList.add('visible'));
  }

  const carousel = document.getElementById('rental-carousel');
  const prev = document.querySelector('.carousel-btn--prev');
  const next = document.querySelector('.carousel-btn--next');

  const scrollCarousel = (direction) => {
    if (!carousel) return;
    const amount = Math.max(280, Math.floor(carousel.clientWidth * 0.82));
    carousel.scrollBy({ left: direction * amount, behavior: 'smooth' });
  };

  if (prev) prev.addEventListener('click', () => scrollCarousel(-1));
  if (next) next.addEventListener('click', () => scrollCarousel(1));

  const escapeHtml = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  if (carousel) fetch('/api/public/catalog').then(async response => {
    if (!response.ok) throw new Error('Catalog unavailable');
    const data = await response.json();
    carousel.innerHTML = (data.products || []).slice(0, 6).map(product => `<article class="coming-card">
      <div class="coming-card__photo">${product.imageUrl ? `<img src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.imageAlt || product.name)}" width="480" height="360" loading="lazy">` : '<span>Photo being added</span>'}</div>
      <h3>${escapeHtml(product.name)}</h3><p>${escapeHtml(product.description)}</p><a href="/rentals">Check dates and quantities →</a></article>`).join('') || '<p>Catalog updates are in progress. Contact us with your event details.</p>';
  }).catch(() => { carousel.innerHTML = '<p>The catalog could not load. <a href="/rentals">Open Browse Rentals</a> to try again.</p>'; });

  const quoteForm = document.getElementById('quote-form');
  if (quoteForm) {
    const date = quoteForm.elements.date;
    date.min = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    quoteForm.addEventListener('submit', async event => {
      event.preventDefault();
      const button = quoteForm.querySelector('[type="submit"]'), message = document.getElementById('inquiry-message');
      if (button.disabled) return;
      button.disabled = true; message.textContent = 'Saving your inquiry…';
      const key = sessionStorage.getItem('regal-inquiry-key') || crypto.randomUUID();
      sessionStorage.setItem('regal-inquiry-key', key);
      try {
        const response = await fetch('/api/public/inquiries', { method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
          body: JSON.stringify(Object.fromEntries(new FormData(quoteForm))) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || 'Your inquiry could not be saved.');
        message.textContent = `Inquiry received. Reference: ${data.inquiryId}. We’ll review your details and follow up. This does not reserve equipment.`;
        button.textContent = 'Inquiry received'; sessionStorage.removeItem('regal-inquiry-key');
      } catch (error) {
        message.textContent = error.message + ' You can also email bookings@regal.rentals.';
        button.disabled = false;
      }
    });
  }
})();
