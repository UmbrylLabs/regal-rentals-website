(() => {
  const $ = selector => document.querySelector(selector);
  let offset = 0, sequence = 0;
  const loadInquiries = async () => {
    const current = ++sequence;
    try {
      const data = await RegalAdmin.api(`/api/admin/inquiries?status=${$('#inquiry-status').value}&offset=${offset}`);
      if (current !== sequence) return;
      const esc = RegalAdmin.escapeHtml;
      $('#inquiry-list').innerHTML = data.inquiries.map(inquiry => `<article class="card"><h3>${esc(inquiry.name)}</h3><p>${esc(inquiry.email)} · ${esc(inquiry.phone)}</p><p>${esc(inquiry.event_date)} · ${esc(inquiry.event_city)} · ${esc(inquiry.event_type)}</p><p class="inquiry-details">${esc(inquiry.details)}</p><small>Reference: ${esc(inquiry.id)}</small><div class="detail-actions"><button type="button" class="button button--quiet" data-inquiry-id="${esc(inquiry.id)}" data-status="reviewed">Mark reviewed</button><button type="button" class="button button--quiet" data-inquiry-id="${esc(inquiry.id)}" data-status="closed">Close inquiry</button></div></article>`).join('') || '<p>No inquiries in this group.</p>';
      $('#inquiry-list-message').textContent = `${data.total} inquiries in this group${data.total ? ` · showing ${offset + 1}–${offset + data.inquiries.length}` : ''}.`;
      $('#inquiry-previous').disabled = offset === 0; $('#inquiry-next').disabled = offset + 50 >= data.total;
      document.querySelectorAll('[data-inquiry-id]').forEach(button => button.addEventListener('click', async () => {
        button.disabled = true;
        try { await RegalAdmin.api('/api/admin/inquiries', { method: 'PATCH', body: JSON.stringify({ id: button.dataset.inquiryId, status: button.dataset.status }) }); await loadInquiries(); }
        catch (error) { $('#inquiry-list-message').textContent = error.message; button.disabled = false; }
      }));
    } catch (error) { $('#inquiry-list-message').textContent = error.message; }
  };
  const loadNotifications = async () => {
    try {
      const data = await RegalAdmin.api('/api/admin/notifications'), esc = RegalAdmin.escapeHtml;
      $('#retry-notifications').disabled = !data.configured;
      $('#notification-status').textContent = (data.configured ? 'Email sending is enabled. ' : 'Email sending needs account setup. ') + data.counts.map(row => `${row.count} ${row.status === 'sent' ? 'accepted' : row.status}`).join(' · ');
      $('#notification-list').innerHTML = data.notifications.map(row => `<article class="payment-record"><div><strong>${esc(row.subject)}</strong><span>${esc(row.recipient)} · ${esc(row.status === 'sent' ? 'Accepted by provider' : row.status)}</span>${row.last_error ? `<small>${esc(row.last_error)}</small>` : ''}</div></article>`).join('') || '<p>No email notifications queued yet.</p>';
    } catch (error) { $('#notification-status').textContent = error.message; }
  };
  $('#refresh-inquiries').addEventListener('click', loadInquiries);
  $('#inquiry-status').addEventListener('change', () => { offset = 0; loadInquiries(); });
  $('#inquiry-previous').addEventListener('click', () => { offset = Math.max(0, offset - 50); loadInquiries(); });
  $('#inquiry-next').addEventListener('click', () => { offset += 50; loadInquiries(); });
  $('#refresh-notifications').addEventListener('click', loadNotifications);
  $('#retry-notifications').addEventListener('click', async event => {
    event.target.disabled = true;
    try { await RegalAdmin.api('/api/admin/notifications', { method: 'POST' }); await loadNotifications(); }
    catch (error) { $('#notification-status').textContent = error.message; event.target.disabled = false; }
  });
  document.addEventListener('regal:panel', event => {
    if (event.detail.name === 'inquiries') loadInquiries();
    if (event.detail.name === 'notifications') loadNotifications();
  });
})();
