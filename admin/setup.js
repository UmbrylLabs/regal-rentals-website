(() => {
  const form = document.getElementById('setup-form');
  const message = document.getElementById('setup-message');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.textContent = 'Creating secure owner account…';
    message.className = 'message';
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    try {
      const response = await fetch('/api/auth/bootstrap', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Bootstrap-Token': document.getElementById('setup-token').value
        },
        body: JSON.stringify({
          displayName: document.getElementById('setup-name').value,
          email: document.getElementById('setup-email').value,
          password: document.getElementById('setup-password').value
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || 'Owner account could not be created.');
      message.textContent = 'Owner account created. Opening the dashboard…';
      message.className = 'message success';
      setTimeout(() => location.href = '/admin/', 700);
    } catch (error) {
      message.textContent = error.message;
      message.className = 'message error';
      button.disabled = false;
    }
  });
})();
