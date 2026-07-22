# Private booking photo storage

The booking detail page can display signed agreements immediately from D1. Delivery, pickup, damage, and other photos/PDFs use a private Cloudflare R2 bucket.

## Create and bind the bucket

In Cloudflare Dashboard:

1. Open **Storage & Databases → R2 Object Storage**.
2. Create a private bucket named `regal-rentals-booking-files`.
3. Open the **regal-rentals-website** Pages project.
4. Open **Settings → Functions → R2 bucket bindings**.
5. Add a binding named exactly `BOOKING_FILES`.
6. Select `regal-rentals-booking-files`.
7. Add the binding to both Preview and Production, then redeploy.

Do not enable a public development URL or custom public domain for this bucket. Files are streamed only through Cloudflare Access-protected admin endpoints.

## Supported records

- Delivery / Drop-off photos
- Pickup / Return photos
- Damage / Condition photos
- Other photos or PDFs

Files are limited to 15 MB each. Filenames are sanitized, object keys are isolated by booking ID, and upload/deletion actions are written to the audit log. No D1 migration is required.
