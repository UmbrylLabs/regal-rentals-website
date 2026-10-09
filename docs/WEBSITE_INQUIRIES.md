# Regal Rentals website quote form

The single-page public site now submits directly to a Cloudflare Pages Function:
\`POST /api/public/inquiry\`. A successful response is returned **only after the
request is stored** in D1. This does not create a booking or hold inventory.

## Storage and admin
- Uses existing \`DB\` Cloudflare Pages D1 binding.
- New tables are created with \`CREATE TABLE IF NOT EXISTS\` when first accessed
  (for deployments that cannot immediately run a migration).
- Also apply \`migrations/0005_website_quote_inquiries.sql\` to production D1 to
  create the associated indexes and keep schema migration history consistent:
  \`npx wrangler d1 migrations apply regal-rentals --remote\`
- Authorized owners can view inquiries at \`https://admin.regal.rentals/\` →
  **Website Inquiries**, mark contacted, archive, or reply via email.
- Admin API is protected by existing Cloudflare Access JWT verification. This
  does not expose customer personal information on the public hostname.

## Email alerts (optional, must be configured)
The form **saves inquiries without an email provider**. To also have each inquiry
emailed to \`bookings@regal.rentals\`, configure a verified sending domain at
Resend, then add secret \`RESEND_API_KEY\` to your Cloudflare Pages project's
production environment. Optionally configure:
- \`REGAL_FROM_EMAIL\`, e.g. \`Regal Rentals <notifications@regal.rentals>\`
- \`REGAL_NOTIFY_EMAIL\`, defaults to \`bookings@regal.rentals\`.

The \`regal.rentals\` sender must be verified by the mail provider before messages
can be delivered. Email notifications are best-effort; if they fail, the lead
remains in the protected admin dashboard. If you want automatic email alerts,
**test a real submission and receipt before advertising**.

## Abuse protection
- Inputs are validated and bound to parameterized D1 statements.
- Same-origin enforcement, honeypot, and per-IP hashed rate limits: six inquiries
  per rolling calendar hour. Incoming IP is never stored verbatim in the inbox.
- Additionally configure Cloudflare WAF rate limiting on
  \`POST /api/public/inquiry\` (e.g. 6/hour/IP). Add Turnstile if abuse becomes a
  problem. Do not rely solely on the honeypot.
- Because leads contain personal information, review D1 access and retention.

## Deployment and verification
The site is deployed through the project's own Cloudflare Pages integration.
Merging GitHub code **does not prove** that Cloudflare has deployed it.
To verify:
1. Confirm production branch is \`main\` and \`DB\` is bound on the deployed
   Cloudflare Pages project.
2. Confirm the public homepage shows the new equipment cards and **Send quote request**.
3. Submit a real test inquiry. Confirm a green response **with a reference ID**.
4. Open private admin → Website Inquiries and confirm the test is present.
5. If Resend is configured, confirm the notification arrived at the mailbox.
6. Confirm admin/booking/signing/payment routes still function.
