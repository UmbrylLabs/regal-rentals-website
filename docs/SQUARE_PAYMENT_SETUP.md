# Regal Rentals Square payment setup

The Square payment system is installed in the website but intentionally remains inactive until the D1 migration, Square credentials, and webhook are configured. Never commit Square access tokens or webhook signature keys to GitHub.

## What the payment system provides

- private payment links created from a booking
- Square-hosted credit/debit card entry through the Web Payments SDK
- 50% reservation-payment links
- remaining-balance links
- 50% refundable security-deposit links
- secure credit-card-on-file consent and Square card storage
- debit-card detection and deposit reminders
- cash-payment recording in the admin booking record
- payment receipts, payment history, saved-card summaries, and audit entries
- booking status changes to `confirmed` after a partial rental payment and `paid` after the rental subtotal is fully paid
- Square webhook signature validation and payment reconciliation

Regal Rentals never receives or stores a complete card number or card security code. Square returns one-time payment tokens and non-sensitive card summaries such as brand, type, and last four digits.

## 1. Apply the D1 migration

From the repository directory on a computer with Node.js and Wrangler available:

```bash
npm install
npx wrangler d1 migrations apply regal-rentals --remote
```

This applies `migrations/0004_square_payments.sql` to the existing `regal-rentals` D1 database. Apply migrations to the preview database first when preview and production use separate databases.

## 2. Create a Square application

1. Sign in to the Square Developer Dashboard.
2. Create an application for Regal Rentals.
3. Begin in Sandbox.
4. Open the application credentials and record:
   - Sandbox Application ID
   - Sandbox Access Token
   - Sandbox Location ID
5. Do not put the access token in website JavaScript, GitHub, or a normal text environment variable visible to the browser.

## 3. Add Cloudflare Pages variables

Open the Regal Rentals Pages project and add these to both Preview and Production as appropriate.

### Plain environment variables

```text
SQUARE_ENVIRONMENT=sandbox
SQUARE_APPLICATION_ID=<sandbox application id>
SQUARE_LOCATION_ID=<sandbox location id>
PUBLIC_SITE_ORIGIN=https://regal.rentals
```

### Encrypted secrets

```text
SQUARE_ACCESS_TOKEN=<sandbox access token>
SQUARE_WEBHOOK_SIGNATURE_KEY=<Square webhook signature key>
```

### Exact webhook URL variable

```text
SQUARE_WEBHOOK_NOTIFICATION_URL=https://regal.rentals/api/webhooks/square
```

The value of `SQUARE_WEBHOOK_NOTIFICATION_URL` must exactly match the notification URL entered in Square, including protocol, hostname, path, and trailing-slash choice.

Redeploy the Pages project after saving the variables.

## 4. Configure the Square webhook

In the Square Developer Dashboard:

1. Open the Regal Rentals application.
2. Open Webhooks.
3. Add this notification URL:

```text
https://regal.rentals/api/webhooks/square
```

4. Subscribe to:
   - `payment.created`
   - `payment.updated`
5. Copy the webhook signature key into the encrypted Cloudflare secret `SQUARE_WEBHOOK_SIGNATURE_KEY`.
6. Confirm the exact URL is also stored in `SQUARE_WEBHOOK_NOTIFICATION_URL`.

## 5. Test in Sandbox

1. Open a test booking in the Regal Rentals admin dashboard.
2. Sign a Version 2.5 agreement and select Credit Card or Debit Card.
3. Open **Payments & Security**.
4. Create a 50% reservation-payment link.
5. Open the link in a private browser window.
6. Use a Square Sandbox test card.
7. Confirm:
   - the payment completes once
   - the Square receipt link appears
   - the booking records the payment
   - the booking moves to `confirmed` after a partial rental payment
   - a credit-card booking records card-on-file consent and shows the saved card summary
   - a debit card does not get treated as the no-deposit credit-card option
   - the refundable security deposit remains separate from rental payments
8. Test a declined Sandbox card and confirm the link can be retried without creating a duplicate completed payment.
9. Test recording cash and confirm it appears separately from Square payments.

Do not use a real card while `SQUARE_ENVIRONMENT=sandbox`.

## 6. Switch to Production

After Sandbox testing succeeds:

1. Replace the Sandbox Application ID, Location ID, and Access Token with Production values.
2. Set:

```text
SQUARE_ENVIRONMENT=production
```

3. Create or update the Production webhook using the same production notification URL.
4. Replace the webhook signature key with the Production subscription key.
5. Redeploy.
6. Complete a small real-card transaction and refund it from Square to verify the production connection before sending a customer payment link.

## Operational rules

- Never type card details into the Regal Rentals admin dashboard on behalf of a customer.
- Send the customer the private payment link so the customer enters the card into Square's hosted fields.
- Do not mark a booking paid solely from a screenshot or customer claim; rely on the completed payment record or Square Dashboard.
- For credit-card bookings, do not release equipment unless the booking shows that the card was successfully saved on file.
- For debit-card or cash bookings, collect the separate refundable deposit equal to 50% of the rental subtotal before equipment release.
- A security deposit is tracked separately and does not reduce the rental balance.
- Count cash in front of the customer and provide a receipt before selecting **Record Cash**.

## Cloudflare variables reference

| Name | Type | Browser-visible | Required |
|---|---|---:|---:|
| `SQUARE_ENVIRONMENT` | variable | no | yes |
| `SQUARE_APPLICATION_ID` | variable | yes, by design | yes |
| `SQUARE_LOCATION_ID` | variable | yes, by design | yes |
| `SQUARE_ACCESS_TOKEN` | encrypted secret | never | yes |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | encrypted secret | never | yes for webhook verification |
| `SQUARE_WEBHOOK_NOTIFICATION_URL` | variable | no | yes for webhook verification |
| `PUBLIC_SITE_ORIGIN` | variable | no | yes for correct customer links |
