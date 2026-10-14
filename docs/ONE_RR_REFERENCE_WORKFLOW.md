# One Regal Rentals reference from inquiry to payment

When a customer submits a website inquiry, a unique RR reference is created,
such as `RR-20261014-1450-A7F2`. It identifies **the rental request**, not
the event date and not a Square-issued invoice.

## Workflow for the owner

1. Open **Admin → Website Inquiries**.
2. Select **Create booking** on a saved inquiry. This opens a prefilled admin
   booking form and carries forward the *same* RR reference.
3. Verify equipment quantities, dates including the new **rental end date**,
   availability, customer phone, pickup/delivery, and pricing. If an item name
   does not match active inventory exactly, select it manually. Website inquiry
   dates/times are customer preferences, not confirmed bookings.
4. Create the booking. The booking, signing agreement, private payment links
   and Square card payments use the **original RR number**. The inquiry displays
   **Open booking** instead of offering conversion again.
5. If you create a separate **Square invoice manually**, open the booking in
   Admin, click **Copy Square Invoice ID**, then paste into Square's custom
   invoice number field. Prefer a single invoice with payment schedule for
   deposits and balances; Square's card-payment receipts are separate from
   Square Invoices and keep their own provider IDs.

## Protection and limitations

- The server resolves the saved RR number itself from `website_inquiries.id`.
  A browser cannot arbitrarily choose or overwrite a customer-facing number.
  Only an authenticated admin can convert a website inquiry.
- The database's existing `bookings.booking_number UNIQUE` prevents a single
  inquiry from creating two bookings; the admin shows an existing booking link.
  No database migration or change to historical references is required.
- Normal bookings started from the admin form without an inquiry generate a new
  RR number using the current California creation timestamp.
- Square Payment API `reference_id` uses the booking number; the private payment
  request retains its own internal ID for idempotency.
- **This does not create or publish Square invoices automatically.** Existing
  payment links and payment processing stay in place to avoid duplicate
  billing. Square Invoices automation requires a separate designed
  Orders/Invoices workflow, not a change to receipt identifiers.
- Legacy historical website inquiries and bookings stay unchanged. Existing
  bookings without linked inquiries are not auto-merged.

## Verification

Run `node tests/test_linked_rental_reference.mjs` and the existing CI tests.
After deployment, check one test inquiry → Create booking → confirm the exact
same RR appears in the booking and agreement, including multi-day dates. Verify
that the second inquiry conversion offers Open booking, and the copy button
produces the correct number.
