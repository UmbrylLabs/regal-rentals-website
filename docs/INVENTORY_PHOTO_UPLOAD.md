# Regal Rentals: inventory image uploads

## How to use
1. Open https://admin.regal.rentals → **Inventory** → **Edit** or **Add Rental Item**.
2. Select **Upload Photo**. Your phone camera/photo library or desktop file picker will open.
3. The browser makes a standardized **1200 × 900 (4:3)** image with a white background.
4. **Fit whole item** is the default: no object is cropped, and unused space is white. **Fill frame** is optional for a closer crop.
5. Review the preview and click **Save Rental Item**. The product is saved first, then the optimized photo is uploaded automatically.
6. The same optimized photo appears in Admin and on the public rental item card. Updates normally require a page refresh.

## Implementation
- Images are converted to WebP on the device, with metadata removed by canvas conversion.
- Images are compressed to under **450 KB** before upload; originals are not uploaded or stored.
- Protected endpoint: `POST /api/admin/product-photo?id=...` (Cloudflare Access required, same-origin mutation protection).
- Public same-origin image endpoint: `GET /api/public/product-photo?id=...&v=...`.
- Optimized bytes are stored in the existing D1 database in `storefront_product_photos`, one per inventory item. No new R2 binding or third-party photo account is required for this small inventory catalog.
- Production migration: `migrations/0007_product_photos.sql`. The handler creates its photo table on first use to work without a manual migration, but the migration should be tracked in the Cloudflare database workflow.
- Photo URLs are versioned to avoid stale images after replacement.
- The existing optional image URL field still works for products already hosted elsewhere.

## Important limits
- Browser must support WebP output; current Chrome on Android and modern browsers do.
- Original photo must be no larger than 20 MB.
- Optimized photo must be at most 450 KB. If it is still too large, the form displays an error and the original is not uploaded.
- This uses D1 because the current app already has that binding. If catalog imagery grows into hundreds of images, move photo storage to R2 rather than growing D1 indefinitely.
- Only photos intended for public use should be uploaded; the image-reading endpoint is public.

## Test after deployment
- Add a new inventory item with a phone photo and verify successful save.
- Confirm the photo card appears on regal.rentals in the new catalog (not a broken image icon).
- Edit the item to replace its photo; reload the site and confirm the photo changed.
- Try a landscape and portrait image: both should appear with the same dimensions.
- Confirm archived inventory and bookings still work.
- If an upload fails after saving, do not create a second item. Keep the form open, or edit the existing item and retry the image.

GitHub checks establish the source is safe to deploy. Real production image saving still requires an authenticated browser test.
