# Regal Rentals release readiness — September 8, 2026

This release extends draft PR #28. Production has not been migrated or deployed as part of this work. Keep the PR in draft and search indexing disabled until the acceptance gates below pass.

## Implemented

| Area | Result |
| --- | --- |
| Booking changes | Return and completion work after an event. Date, quantity and price amendments are atomic: a conflict rolls back the entire change. Existing unit prices are preserved unless staff deliberately edits them. A revision check prevents an older screen overwriting another staff member's changes. |
| Quote totals | Staff can finalize unit prices, delivery, setup, teardown, discounts, other charges and tax. The agreement and rental balance use the same quote total. Tax and the refundable security deposit remain separate. No tax rate or automatic delivery fee is assumed. |
| Agreement validity | Changed items, prices, dates, service or location void previous signing links. A new agreement supersedes older versions. Agreement creation checks the booking revision to reject stale terms. Archived evidence remains accessible to staff. |
| Payment recovery | Every charge has a durable attempt and stable Square idempotency key. An uncertain outcome disables retries and protects the reservation until a signed webhook or read-only Square reconciliation resolves it. A missing processor search result does not release the hold. |
| Payment links | Canceled, expired and completed bookings cannot collect a new payment. Links for temporary holds expire with the hold. Server and database checks prevent rental payments above the current balance. |
| Refunds | Owners can issue full or partial Square refunds and record cash already returned. Pending refunds reserve the refundable amount. The ledger tracks net payments and security held. Refund webhooks reconcile changes made in Square, including events arriving before the original payment record. Refunds do not cancel bookings. |
| Equipment release | Moving to Ready or Out requires final item prices, a current signature, a paid rental balance and the appropriate saved credit card or refundable security deposit. Staff still inspect equipment and verify event logistics. |
| Admin overview | Full-history search by number, customer, email, phone or city; 50-row pages; accurate global totals; overdue-return, pending-payment and return-inspection alerts. |
| Product photos | Staff can upload JPEG, PNG or WebP images, edit their descriptions, or remove them. The browser resizes uploads to at most 1600 px and the server checks format and size. Public image routes only serve active catalog products under the catalog prefix; booking documents remain private. Replaced originals are retained for recovery. |
| Customer forms | Homepage Browse links open the actual rental catalog. General inquiries are stored in the admin inbox. Rentals support separate start and return dates, Pacific time, an actual hold-expiry confirmation and duplicate-request protection. |
| Notifications | Inquiry and quote receipts are saved atomically with their records. An optional Resend sender processes the queue after submissions; the admin can inspect and process queued messages. Sending defaults to disabled. Provider acceptance is distinguished from delivery. |
| Abuse controls | Honeypots and atomic per-hour limits: five new submissions per email and twenty per Cloudflare client IP, separately for quote and inquiry endpoints. Valid retries return the original result. These are basic controls, not a complete bot defense. |

The prior PR's optimized WebP logos, accessibility fixes, consolidated four-hour preparation / twelve-hour cleaning buffers and noindex settings are retained.

## Deployment order

1. Verify the current Pages project, protected admin hostname, D1 binding and private R2 binding. Do not create a replacement database or weaken Cloudflare Access. Older setup documents describe the initial installation, not an existing production upgrade.
2. Verify preview has its own D1 database, R2 storage and Square Sandbox credentials. Never run test holds, refunds or migrations against the production database merely to make a branch preview work. Set preview `PUBLIC_SITE_ORIGIN` and Square webhook URL to the preview host, so test links remain in preview.
3. Back up the existing database and confirm a restoration procedure before any production migration.
4. Apply migrations **0005_payment_recovery.sql** and **0006_operations.sql**, after the existing 0001–0004 migrations, to the isolated preview database. Do not rerun initial inventory seed statements manually.
5. Deploy the branch to preview, retaining Cloudflare Access for admin routes. Complete the browser and Sandbox tests below.
6. After approval and acceptance, apply the same migrations to production and deploy the reviewed commit. A build success by itself does not prove the database migrations or account bindings are ready.
7. Complete one controlled real booking, charge and refund before opening online payments broadly. Keep indexing off until the soft launch succeeds.

## Square setup and payment operations

Use `docs/SQUARE_PAYMENT_SETUP.md` for credentials and exact webhook configuration. Subscribe to `payment.created`, `payment.updated`, `refund.created` and `refund.updated`.

- Create a hold or confirmed reservation before collecting money. On a hold, collect a rental reservation payment first; a separate security deposit follows confirmation.
- A pending/unknown card result appears under Payments & Security and in the overview. Use **Check Square payment**; supply the Square payment ID if a search cannot locate it. The action retrieves processor state and does not charge the card again.
- If Square cannot conclusively resolve an attempt, keep the record pending and investigate with Square. Do not delete the attempt, reset the request to open, or collect a replacement payment.
- If card storage failed after a successful charge, use **Retry card storage** in Payments & Security and verify that storage is recovered before release. Do not use another charge merely to retry card storage.
- Refund using the existing pending refund's **Check / retry** action. Do not create a replacement refund after a timeout. Refunds change net balances; booking cancellation is a separate inventory decision.
- Canceled bookings with payment or attempt history cannot be deleted as test records.
- Cash entries use stable receipt keys. Review history after an interrupted submission before recording additional cash. Refund cash only after physically returning it.

## Optional email connection

Email is prepared but not activated. Configure a verified sender in Resend and these server-side settings:

| Setting | Purpose |
| --- | --- |
| `EMAIL_ENABLED=true` | Explicitly enables delivery; absent or false disables it. |
| `RESEND_API_KEY` | Encrypted secret, restricted to sending for the verified domain. |
| `NOTIFICATION_FROM` | Verified customer-facing sender, for example `Regal Rentals <bookings@regal.rentals>`. |
| `NOTIFICATION_STAFF_EMAIL` | Destination for staff alerts. Set to the actual monitored Regal Rentals inbox. |

Finish sender-domain DNS verification and delivery testing before enabling email. These settings are separate from the email used to register the Square account. No account, subscription or email was created or sent during implementation.

Messages are queued in `notification_outbox`. Delivery attempts use a lease and a stable provider idempotency key. Resend retains those keys for 24 hours, so uncertain attempts pause after 23 hours for manual review; unattempted receipts older than one day are also held for review instead of sending stale hold information. See the [Resend send API](https://resend.com/docs/api-reference/emails/send-email) and [idempotency documentation](https://resend.com/docs/dashboard/emails/idempotency-keys).

This release processes the queue on new public submissions and through the admin button. A scheduled queue consumer, delivery/bounce monitoring and independent error alerts still need operational configuration. “Accepted” means the provider accepted the email, not that the customer received it.

## Verification performed

- Existing twelve SQLite inventory tests, including simultaneous activation and exact buffer boundaries.
- Twenty-four new route-level scenarios using all migrations in real in-memory SQLite, with fake processor/email boundaries. They cover interrupted charges, concurrent submissions, signed webhook validation, refund ordering, cash idempotency, invoice totals, actual agreement signing, release checks, full-history search, stored inquiries, rate limits, email recovery and public/private image isolation.
- Existing agreement, signing, Square, file, event-time and frontend contract checks.
- JavaScript syntax checks and diff whitespace checks.

Run the complete suite with `npm test` (Node 22.13+ and Python 3) and syntax checks with `npm run check:js`. The route tests do not contact Square, send email, modify production or bypass production authentication. They simulate an owner only at the local test boundary.

## Acceptance gates still requiring account access

- [ ] Confirm preview/production database separation, apply migrations to preview, and verify backups/restoration.
- [ ] Complete the authenticated desktop and mobile admin walkthrough. The local visual preview was unavailable for this Wrangler-based project; no fresh browser-render or performance claim is made for these new screens.
- [ ] Test customer start/return dates, quantity refresh, rejection, submission, confirmation and general inquiry flows on Android and iPhone.
- [ ] Exercise booking amendments, stale staff edits, cancellation, expiry, documents, photos, and completed/returned statuses through the UI.
- [ ] Run Square Sandbox payments with credit and debit cards, a decline, a timeout, card storage, partial/full refunds and out-of-order webhooks; then one approved small live transaction and refund.
- [ ] Connect and verify email sending; test receipt, staff alert, retry, provider acceptance and actual inbox delivery.
- [ ] Configure Cloudflare abuse protection and independent errors/availability/payment/notification alerts.
- [ ] Verify inventory quantities, product images, prices, taxes, delivery charges, service areas, final policies and release workflow against the real business.
- [ ] Complete a controlled soft launch. Only then enable customer-page indexing and begin SEO.

Outstanding operational features include a full dispatch calendar, maintenance/unavailable inventory, automatic handling of overdue stock, scheduled reminders, delivery-rate automation and a customer self-service portal. The new attention list flags overdue equipment; it does not prove equipment has physically returned or automatically extend every stock block. Staff must inspect returns and manage affected reservations.
