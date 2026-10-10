# Regal Rentals dynamic homepage (items, packages & quote list)

## Inventory
Open the existing private dashboard at \`https://admin.regal.rentals/\` and select
**Inventory**. Add or edit an item:
- Name, description, category, style
- Quantity owned and rental price (price can be blank for custom quotes)
- Optional image URL (HTTPS or \`/assets/…\` asset) — upload the photograph
  to a hosted location first; this editor does not currently upload photos.
- Toggle **Show this item on the public rental website**.

Active items with a quantity above zero appear on \`regal.rentals\` after refresh.
The site uses the same inventory records as your booking backend.

## Packages
Open **Packages** → **Add Package**.
- Add name, description, optional image URL, optional package price.
- Select product quantities from the *actual* inventory.
- Check **Publish this package on the public homepage** and Save.
- A draft stays private. An unpublished package disappears from the homepage.
- Existing three sample package cards remain on the website until the first
  package is published, so the initial page is not left empty during setup.
  Once one or more real packages are published, they replace the samples.

Published packages can only include active products with enough owned units.
A bundle is hidden automatically if a later inventory edit makes its contents
unavailable. This does **not** place a date-based inventory hold.

## Customer quote list
The homepage's **Add to Quote** buttons add one unit each time they're clicked.
A package replaces the current selection with its included inventory, and
customers can then add more equipment. The quote area shows all items, allows
quantity adjustments up to owned stock, and provides Remove buttons.

The request posts to existing \`POST /api/public/inquiry\`. The server verifies
every selected product ID and quantity against D1, resolves package names from
the database, and saves human-readable quantities in the existing private
**Website Inquiries** dashboard. A quote request is **not** a booking or
an inventory hold. Dates and final charges are still confirmed manually.

The public catalog loads fresh on each new page visit (no caching) via
\`GET /api/public/storefront\`. Customers already on the page need to refresh
after you publish a change.

## Deployment
- Apply \`migrations/0006_dynamic_storefront.sql\` to D1 for recorded schema
  history/indexes. The API can create required tables lazily on first use.
- Keep the existing production Cloudflare Pages \`DB\` binding and Cloudflare
  Access protections for \`admin.regal.rentals\`.
- After Cloudflare deploys, test adding a draft item, publishing it,
  creating a package, removing a published item, and requesting a quote with
  quantities. Check the exact item quantities in **Website Inquiries**.
- Do not treat a GitHub merge or passing CI as proof of a live production
  end-to-end test.
