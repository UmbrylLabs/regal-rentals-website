import { requireAdmin } from '../../../../../_lib/auth.js';
import { safeErrorResponse } from '../../../../../_lib/http.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDateTime(epoch) {
  if (!epoch) return 'Not recorded';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    dateStyle: 'long',
    timeStyle: 'short'
  }).format(new Date(Number(epoch) * 1000));
}

export async function onRequestGet(context) {
  try {
    await requireAdmin(context.env, context.request);
    const version = Number(context.params.version);
    if (!Number.isInteger(version) || version < 1) {
      return new Response('Agreement not found.', { status: 404 });
    }

    const row = await context.env.DB.prepare(
      `SELECT
         sr.agreement_version, sr.agreement_html, sr.agreement_sha256,
         sr.signer_name, sr.signer_email, sr.expires_at, sr.viewed_at,
         sr.signed_at, sr.voided_at,
         b.booking_number,
         s.typed_name, s.signature_svg, s.evidence_sha256,
         s.signed_at AS signature_signed_at
       FROM signing_requests sr
       JOIN bookings b ON b.id = sr.booking_id
       LEFT JOIN signatures s ON s.signing_token_hash = sr.token_hash
       WHERE sr.booking_id = ?1 AND sr.agreement_version = ?2`
    ).bind(context.params.id, version).first();

    if (!row) return new Response('Agreement not found.', { status: 404 });

    const signed = Boolean(row.signed_at && row.signature_svg);
    const statusText = row.voided_at
      ? `Voided ${formatDateTime(row.voided_at)}`
      : signed
        ? `Signed ${formatDateTime(row.signature_signed_at || row.signed_at)}`
        : `Awaiting signature · expires ${formatDateTime(row.expires_at)}`;

    const signatureSection = signed ? `
      <section class="signature-proof">
        <h2>Electronic Signature</h2>
        <div class="stored-signature">${row.signature_svg}</div>
        <p><strong>Signed by:</strong> ${escapeHtml(row.typed_name)}</p>
        <p><strong>Signed:</strong> ${escapeHtml(formatDateTime(row.signature_signed_at || row.signed_at))}</p>
        <p><strong>Evidence reference:</strong> <code>${escapeHtml(row.evidence_sha256)}</code></p>
      </section>` : `
      <section class="pending-notice">
        <strong>This agreement has not been signed yet.</strong>
        <p>The document below is the exact version sent to ${escapeHtml(row.signer_name)}.</p>
      </section>`;

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(row.booking_number)} Agreement v${version}</title>
  <meta name="robots" content="noindex, nofollow" />
  <style>
    :root{--purple:#26063f;--gold:#c9982e;--cream:#fffaf0;--line:#e8dac0;--ink:#24192c;--muted:#6f6377}
    *{box-sizing:border-box}body{margin:0;background:#f6f0e5;color:var(--ink);font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.55}.toolbar{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 20px;background:rgba(255,250,240,.97);border-bottom:1px solid var(--line)}.toolbar strong{color:var(--purple)}.toolbar span{display:block;color:var(--muted);font-size:13px}.toolbar button{border:0;border-radius:10px;padding:11px 16px;background:var(--purple);color:#fff;font:inherit;font-weight:800;cursor:pointer}.page{width:min(900px,calc(100% - 28px));margin:28px auto;padding:42px;background:#fff;border:1px solid var(--line);border-radius:20px;box-shadow:0 18px 50px rgba(38,6,63,.1)}.agreement h1,.agreement h2,.signature-proof h2{color:var(--purple);font-family:Georgia,serif}.agreement h1{font-size:34px}.agreement h2,.signature-proof h2{margin-top:28px}.agreement-note{padding:14px;background:var(--cream);border:1px solid var(--line);border-radius:12px}.signature-proof,.pending-notice{margin-top:32px;padding:22px;background:var(--cream);border:1px solid var(--line);border-radius:16px}.stored-signature{max-width:620px;padding:12px;background:#fff;border:1px solid var(--line);border-radius:12px}.stored-signature svg{width:100%;height:auto}.signature-proof code{overflow-wrap:anywhere}.document-hash{margin-top:28px;color:var(--muted);font-size:12px;overflow-wrap:anywhere}@media(max-width:620px){.toolbar{align-items:flex-start;flex-direction:column}.toolbar button{width:100%}.page{padding:24px 20px}.agreement h1{font-size:28px}}@media print{body{background:#fff}.toolbar{display:none}.page{width:100%;margin:0;padding:0;border:0;box-shadow:none}.agreement-note{display:none}}
  </style>
</head>
<body>
  <header class="toolbar">
    <div><strong>${escapeHtml(row.booking_number)} · Agreement version ${version}</strong><span>${escapeHtml(statusText)}</span></div>
    <button type="button" onclick="window.print()">Print / Save PDF</button>
  </header>
  <main class="page">
    ${row.agreement_html}
    ${signatureSection}
    <p class="document-hash"><strong>Agreement verification:</strong> ${escapeHtml(row.agreement_sha256)}</p>
  </main>
</body>
</html>`;

    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
      }
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
