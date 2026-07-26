(() => {
  const securityScript = document.createElement('script');
  securityScript.src = '/admin/agreement-security.js?v=20260726-1';
  securityScript.async = false;
  document.head.appendChild(securityScript);

  const form = document.getElementById('booking-form');
  if (!form) return;

  const applyDefaults = () => {
    const before = form.elements.bufferBefore;
    const after = form.elements.bufferAfter;
    if (before && (before.value === '' || before.value === '120')) before.value = '240';
    if (after && (after.value === '' || after.value === '120')) after.value = '720';
  };

  applyDefaults();
  form.addEventListener('reset', () => queueMicrotask(applyDefaults));
})();
