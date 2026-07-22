(() => {
  const previousFetch = globalThis.fetch.bind(globalThis);
  const state = {
    booking: null,
    files: [],
    configured: null,
    loading: false
  };
  const bookingEndpoint = /^\/api\/admin\/bookings\/([^/]+)$/;

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const formatDate = (epoch) => {
    if (!epoch) return 'Not recorded';
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(Number(epoch) * 1000));
  };

  const formatBytes = (value) => {
    const bytes = Number(value || 0);
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  globalThis.fetch = async (input, init = {}) => {
    const response = await previousFetch(input, init);
    try {
      const rawUrl = typeof input === 'string' ? input : input?.url;
      const url = new URL(rawUrl, globalThis.location.origin);
      const method = String(init.method || (typeof input !== 'string' ? input?.method : '') || 'GET').toUpperCase();
      if (response.ok && bookingEndpoint.test(url.pathname) && ['GET', 'PATCH'].includes(method)) {
        response.clone().json().then((data) => {
          if (!data.booking) return;
          const changed = state.booking?.id !== data.booking.id;
          state.booking = data.booking;
          if (changed) {
            state.files = [];
            state.configured = null;
          }
          queueMicrotask(() => ensureDocumentsSection(changed));
        }).catch(() => {});
      }
    } catch {
      // Primary admin requests remain untouched if document enhancement inspection fails.
    }
    return response;
  };

  const agreementsMarkup = () => {
    const agreements = [...(state.booking?.signingRequests || [])]
      .sort((left, right) => Number(right.agreement_version) - Number(left.agreement_version));
    if (!agreements.length) {
      return '<p class="booking-documents-empty">No agreements have been created for this booking.</p>';
    }

    return agreements.map((agreement) => {
      const version = Number(agreement.agreement_version);
      const signed = Boolean(agreement.signed_at);
      const voided = Boolean(agreement.voided_at);
      const status = voided
        ? `Voided ${formatDate(agreement.voided_at)}`
        : signed
          ? `Signed ${formatDate(agreement.signed_at)}`
          : `Awaiting signature · expires ${formatDate(agreement.expires_at)}`;
      const label = signed ? 'View Signed Agreement' : 'View Agreement Draft';
      const href = `/api/admin/bookings/${encodeURIComponent(state.booking.id)}/agreements/${version}`;
      return `<article class="booking-document-row">
        <div class="booking-document-icon" aria-hidden="true">${signed ? '✓' : '✎'}</div>
        <div class="booking-document-copy">
          <strong>Rental Agreement · Version ${version}</strong>
          <span>${escapeHtml(status)}</span>
        </div>
        <a class="button button--secondary" href="${escapeHtml(href)}" target="_blank" rel="noopener">${label}</a>
      </article>`;
    }).join('');
  };

  const fileCardsMarkup = () => {
    if (state.configured === false) {
      return `<div class="booking-storage-notice">
        <strong>Private photo storage needs to be connected.</strong>
        <p>The agreement viewer is ready. Photo uploads will activate after the Cloudflare R2 binding <code>BOOKING_FILES</code> is added.</p>
      </div>`;
    }
    if (state.loading && !state.files.length) {
      return '<p class="booking-documents-empty">Loading booking photos and files…</p>';
    }
    if (!state.files.length) {
      return '<p class="booking-documents-empty">No delivery, pickup, damage, or other photos have been uploaded.</p>';
    }

    return state.files.map((file) => {
      const preview = file.isImage
        ? `<a class="booking-file-preview" href="${escapeHtml(file.viewUrl)}" target="_blank" rel="noopener"><img src="${escapeHtml(file.viewUrl)}" alt="${escapeHtml(file.originalName)}" loading="lazy" /></a>`
        : `<a class="booking-file-preview booking-file-preview--document" href="${escapeHtml(file.viewUrl)}" target="_blank" rel="noopener" aria-label="View ${escapeHtml(file.originalName)}">PDF</a>`;
      return `<article class="booking-file-card">
        ${preview}
        <div class="booking-file-card__body">
          <span class="booking-file-category">${escapeHtml(file.categoryLabel)}</span>
          <strong>${escapeHtml(file.originalName)}</strong>
          <small>${escapeHtml(formatBytes(file.sizeBytes))} · ${escapeHtml(formatDate(file.uploadedAt))}</small>
          ${file.note ? `<p>${escapeHtml(file.note)}</p>` : ''}
          <div class="booking-file-actions">
            <a class="button button--quiet" href="${escapeHtml(file.viewUrl)}" target="_blank" rel="noopener">View</a>
            <button class="button button--danger" type="button" data-delete-booking-file="${escapeHtml(file.id)}" data-file-name="${escapeHtml(file.originalName)}">Delete</button>
          </div>
        </div>
      </article>`;
    }).join('');
  };

  const renderAgreements = () => {
    const target = document.getElementById('booking-agreement-list');
    if (target) target.innerHTML = agreementsMarkup();
  };

  const renderFiles = () => {
    const target = document.getElementById('booking-file-list');
    if (target) target.innerHTML = fileCardsMarkup();
    const form = document.getElementById('booking-file-upload-form');
    if (form) {
      const disabled = state.configured !== true;
      Array.from(form.elements).forEach((element) => { element.disabled = disabled; });
    }
    document.querySelectorAll('[data-delete-booking-file]').forEach((button) => {
      button.addEventListener('click', () => deleteFile(button.dataset.deleteBookingFile, button.dataset.fileName));
    });
  };

  const showUploadMessage = (text, type = '') => {
    const message = document.getElementById('booking-file-message');
    if (!message) return;
    message.textContent = text;
    message.className = `message ${type}`.trim();
  };

  const loadFiles = async () => {
    if (!state.booking || state.loading) return;
    state.loading = true;
    renderFiles();
    try {
      const response = await previousFetch(`/api/admin/bookings/${encodeURIComponent(state.booking.id)}/files`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error?.message || 'Booking files could not be loaded.');
      state.configured = data.configured === true;
      state.files = data.files || [];
    } catch (error) {
      state.configured = false;
      showUploadMessage(error.message, 'error');
    } finally {
      state.loading = false;
      renderFiles();
    }
  };

  const uploadFile = async (event) => {
    event.preventDefault();
    if (!state.booking || state.configured !== true) return;
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Uploading…';
    showUploadMessage('Uploading securely…');
    try {
      const response = await previousFetch(`/api/admin/bookings/${encodeURIComponent(state.booking.id)}/files`, {
        method: 'POST',
        credentials: 'same-origin',
        body: new FormData(form)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error?.message || 'The file could not be uploaded.');
      form.reset();
      state.files.unshift(data.file);
      renderFiles();
      showUploadMessage('File uploaded and attached to this booking.', 'success');
    } catch (error) {
      showUploadMessage(error.message, 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Upload to Booking';
    }
  };

  const deleteFile = async (fileId, fileName) => {
    if (!state.booking || !fileId) return;
    if (!confirm(`Permanently delete “${fileName || 'this file'}” from the booking?`)) return;
    showUploadMessage('Deleting file…');
    try {
      const response = await previousFetch(`/api/admin/bookings/${encodeURIComponent(state.booking.id)}/files/${encodeURIComponent(fileId)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error?.message || 'The file could not be deleted.');
      state.files = state.files.filter((file) => file.id !== fileId);
      renderFiles();
      showUploadMessage('File deleted.', 'success');
    } catch (error) {
      showUploadMessage(error.message, 'error');
    }
  };

  function ensureDocumentsSection(forceLoad = false) {
    const detail = document.getElementById('booking-detail');
    if (!detail || !state.booking) return;
    let section = document.getElementById('booking-documents-card');
    if (!section) {
      section = document.createElement('section');
      section.className = 'card booking-documents-card';
      section.id = 'booking-documents-card';
      section.innerHTML = `
        <div class="booking-documents-heading">
          <div><p class="eyebrow">Booking record</p><h3>Documents &amp; Photos</h3></div>
          <p>Signed agreements and condition records stay attached to this booking.</p>
        </div>
        <div class="booking-documents-group">
          <h4>Agreements</h4>
          <div id="booking-agreement-list"></div>
        </div>
        <div class="booking-documents-group">
          <div class="booking-documents-group__heading"><h4>Photos &amp; Files</h4><span>Private · staff access only</span></div>
          <form class="booking-file-upload" id="booking-file-upload-form">
            <label>Category<select name="category" required>
              <option value="delivery">Delivery / Drop-off</option>
              <option value="pickup">Pickup / Return</option>
              <option value="damage">Damage / Condition</option>
              <option value="other">Other</option>
            </select></label>
            <label>Photo or PDF<input name="file" type="file" accept="image/*,application/pdf" required /></label>
            <label class="booking-file-note">Note<input name="note" maxlength="500" placeholder="Front-left condition, missing chair, setup complete, etc." /></label>
            <button class="button" type="submit">Upload to Booking</button>
          </form>
          <p class="message" id="booking-file-message" aria-live="polite"></p>
          <div class="booking-file-grid" id="booking-file-list"></div>
        </div>`;
      detail.appendChild(section);
      document.getElementById('booking-file-upload-form')?.addEventListener('submit', uploadFile);
      renderAgreements();
      renderFiles();
      loadFiles();
      return;
    }

    renderAgreements();
    if (forceLoad) loadFiles();
  }

  const initialize = () => {
    const detail = document.getElementById('booking-detail');
    if (detail) {
      new MutationObserver(() => ensureDocumentsSection(false))
        .observe(detail, { childList: true, subtree: false });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();
