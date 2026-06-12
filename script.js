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

  const quoteForm = document.getElementById('quote-form');
  if (quoteForm) {
    quoteForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = new FormData(quoteForm);
      const lines = [
        'Regal Rentals Launch / Future Quote Request',
        '',
        `Name: ${data.get('name') || ''}`,
        `Phone: ${data.get('phone') || ''}`,
        `Email: ${data.get('email') || ''}`,
        `Event date: ${data.get('date') || ''}`,
        `Event city: ${data.get('city') || ''}`,
        `Event type: ${data.get('eventType') || ''}`,
        '',
        'Event details:',
        `${data.get('details') || ''}`,
        '',
        'Note: Website currently says Regal Rentals is launching soon and not accepting confirmed online bookings yet.'
      ];
      const subject = encodeURIComponent('Regal Rentals Launch / Future Quote Request');
      const body = encodeURIComponent(lines.join('\n'));
      window.location.href = `mailto:bookings@regal.rentals?subject=${subject}&body=${body}`;
    });
  }
})();
