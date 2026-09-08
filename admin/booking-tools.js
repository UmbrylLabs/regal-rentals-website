(() => {
  document.addEventListener('regal:booking', event => {
    const { booking, user } = event.detail;
    const actions = document.querySelector('#booking-detail .detail-actions');
    if (!actions || user?.role !== 'owner' || !['cancelled', 'expired'].includes(booking.status)) return;
    const button = document.createElement('button');
    button.className = 'button button--danger'; button.type = 'button';
    button.textContent = 'Delete Test Booking';
    button.addEventListener('click', async () => {
      if (prompt(`Permanently delete test booking ${booking.booking_number}? Type its complete booking number to confirm.`) !== booking.booking_number) return;
      button.disabled = true;
      try {
        await RegalAdmin.api(`/api/admin/bookings/${encodeURIComponent(booking.id)}`, { method: 'DELETE' });
        document.querySelector('[data-open-panel="bookings"]').click();
        await RegalAdmin.refreshBookings();
      } catch (error) { RegalAdmin.showMessage(document.getElementById('detail-message'), error.message, 'error'); button.disabled = false; }
    });
    actions.appendChild(button);
  });
})();
