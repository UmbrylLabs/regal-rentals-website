# Admin: packages and permanent deletion

## Build packages from inventory
1. Sign in at https://admin.regal.rentals.
2. Choose **Packages** → **Add Package**.
3. Wait for the inventory and package data to load (the Add Package button will wait).
4. Choose an existing Inventory item from the dropdown, enter how many the
   package includes and press **Add Item**.
5. Repeat, or adjust/remove included items. Set the name, optional description,
   photo URL and price, then **Save Package**.
6. Check **Publish this package** only when ready to show it on the public site.

The package editor refreshes the inventory from the same backend used by the
Inventory tab every time you open or edit a package. It reports errors in the
dashboard instead of silently offering an empty picker.

## Permanently delete an inventory item
1. Choose **Inventory**.
2. On a live item choose **Remove from Site** (archive), which is reversible.
3. Archived items show **Restore to Site**, and owners also see **Delete
   Permanently**.
4. Click **Delete Permanently** and type the item's exact SKU to confirm.

This action is intentionally irreversible and is only allowed when:
- The item is already archived.
- No current or historical booking item references the inventory record.
- No draft or published package includes the item.
- The authenticated user has the **owner** role and types the exact SKU.

To delete an item referenced in a package, edit the package and remove that item,
then retry. If a booking has used the item, keep it archived; deleting it would
break booking history. Audit logs retain the deletion event for recordkeeping.

The public quote process can still accept requested quantities greater than owned
inventory; booking protections remain unchanged.

## Production checks
After deployment verify:
- Inventory loads in Packages immediately after switching tabs and clicking Add.
- A newly created inventory item appears in the Add from Inventory dropdown.
- A package containing two different inventory items saves, reloads, and
  publishes to the website without losing quantities.
- An unused archived test item can be permanently deleted after typing its SKU.
- An item referenced by a saved package is blocked, and an item referenced by
  booking history is blocked.
- Cloudflare Pages, the production D1 binding, and Access policies remain active.

A successful GitHub action or deployment check is not the same as a completed live
browser transaction.
