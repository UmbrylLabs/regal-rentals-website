(() => {
  const button = document.querySelector('[data-panel="website-inquiries"]');
  const refresh = document.querySelector('#refresh-website-inquiries');
  const container = document.querySelector('#website-inquiries-list');
  const count = document.querySelector('#website-inquiries-count');
  if (!button || !container) return;

  const escapeHtml = value => String(value ?? '')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#39;');
  const safeDate = value => {
    const time = Number(value) * 1000;
    if (!Number.isFinite(time)) return '';
    return new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Los_Angeles'}).format(new Date(time));
  };
  let inquiries = [];

  const show = () => {
    if (!inquiries.length) {
      container.innerHTML = '<p class="inquiry-empty">No website inquiries yet.</p>';
      count.textContent = '0 inquiries';
      return;
    }
    const newCount = inquiries.filter(x => x.status === 'new').length;
    count.textContent = String(newCount) + ' new / ' + String(inquiries.length) + ' total';
    container.innerHTML = inquiries.map(lead => {
      const items = Array.isArray(lead.items) ? lead.items : [];
      const mailSubject = encodeURIComponent('Regal Rentals — Your event on ' + lead.event_date);
      const mailBody = encodeURIComponent('Hi ' + lead.name + ',\n\nThanks for contacting Regal Rentals about your event.\n\n');
      const mailHref = 'mailto:' + encodeURIComponent(lead.email) + '?subject=' + mailSubject + '&body=' + mailBody;
      return '<article class="inquiry-card">' +
        '<div class="inquiry-card__heading"><div><strong>' + escapeHtml(lead.name) + '</strong><span class="inquiry-badge inquiry-badge--' + escapeHtml(lead.status) + '">' + escapeHtml(lead.status) + '</span>' +
        '<p>' + escapeHtml(lead.reference) + ' · ' + escapeHtml(safeDate(lead.created_at)) + '</p></div><span>' + (lead.email_sent ? 'Email alert sent' : 'Saved in dashboard') + '</span></div>' +
        '<dl class="inquiry-facts"><div><dt>Event</dt><dd>' + escapeHtml(lead.event_date) + ' · ' + escapeHtml(lead.event_city) + '</dd></div>' +
        '<div><dt>Package</dt><dd>' + escapeHtml(lead.package_name || 'Custom / not chosen') + '</dd></div>' +
        '<div><dt>Equipment</dt><dd>' + escapeHtml(items.join(', ') || 'Not specified') + '</dd></div>' +
        '<div><dt>Contact</dt><dd><a href="' + escapeHtml(mailHref) + '">' + escapeHtml(lead.email) + '</a>' +
        (lead.phone ? ' · ' + escapeHtml(lead.phone) : '') + '</dd></div></dl>' +
        (lead.details ? '<p class="inquiry-details">' + escapeHtml(lead.details) + '</p>' : '') +
        '<div class="inquiry-actions"><a class="button button--secondary" href="' + escapeHtml(mailHref) + '">Reply by email</a>' +
        (lead.status !== 'contacted' ? '<button class="button" type="button" data-inquiry-action="contacted" data-inquiry-id="' + escapeHtml(lead.id) + '">Mark contacted</button>' : '') +
        (lead.status !== 'archived' ? '<button class="button button--quiet" type="button" data-inquiry-action="archived" data-inquiry-id="' + escapeHtml(lead.id) + '">Archive</button>' : '<button class="button button--quiet" type="button" data-inquiry-action="new" data-inquiry-id="' + escapeHtml(lead.id) + '">Reopen</button>') +
        '</div></article>';
    }).join('');
  };

  const load = async () => {
    container.textContent = 'Loading website inquiries…';
    try {
      const res = await fetch('/api/admin/inquiries',{credentials:'same-origin',cache:'no-store'});
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error?.message || 'Could not load website inquiries.');
      inquiries = data.inquiries || [];
      show();
    } catch(err) {
      container.textContent = String(err.message || 'Unable to load inquiries.');
    }
  };
  button.addEventListener('click',load);
  refresh?.addEventListener('click',load);
  container.addEventListener('click',async event => {
    const btn = event.target.closest('[data-inquiry-action]');
    if (!btn) return;
    const id = btn.dataset.inquiryId;
    const status = btn.dataset.inquiryAction;
    btn.disabled = true;
    try {
      const res = await fetch('/api/admin/inquiries',{
        method:'PATCH',credentials:'same-origin',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({id,status})
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error?.message || 'Could not update the inquiry.');
      await load();
    } catch(err) {
      alert(String(err.message || 'Unable to save.'));
      btn.disabled = false;
    }
  });
})();
