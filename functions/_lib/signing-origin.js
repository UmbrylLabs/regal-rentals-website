export function resolvePublicSigningOrigin(requestUrl, configuredOrigin = '') {
  const configured = String(configuredOrigin || '').trim();
  if (configured) {
    const url = new URL(configured);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('INVALID_PUBLIC_SITE_ORIGIN');
    return url.origin;
  }

  const url = new URL(requestUrl);
  if (url.hostname.startsWith('admin.')) {
    url.hostname = url.hostname.slice('admin.'.length);
  }
  return url.origin;
}
