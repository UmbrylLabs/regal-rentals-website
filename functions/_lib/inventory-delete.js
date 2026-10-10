// A hard delete is permitted only for an archived item with no linked
// booking history and no references from draft/published package definitions.
// The SQL predicates repeat the preflight checks to prevent a race.
export async function productDeletionBlockers(db, id) {
  const [bookings, packages] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS total FROM booking_items WHERE product_id = ?1').bind(id).first(),
    db.prepare(
      "SELECT COUNT(*) AS total FROM storefront_packages AS sp, json_each(sp.items_json) AS item " +
      "WHERE json_extract(item.value, '$.productId') = ?1"
    ).bind(id).first()
  ]);
  return {
    bookingItems: Number(bookings?.total || 0),
    packageReferences: Number(packages?.total || 0)
  };
}

export async function deleteUnreferencedArchivedProduct(db, id) {
  const result = await db.prepare(
    "DELETE FROM products WHERE id = ?1 AND active = 0 " +
    "AND NOT EXISTS (SELECT 1 FROM booking_items WHERE product_id = ?1) " +
    "AND NOT EXISTS (SELECT 1 FROM storefront_packages AS sp, json_each(sp.items_json) AS item " +
    "WHERE json_extract(item.value, '$.productId') = ?1)"
  ).bind(id).run();
  return Number(result.meta?.changes || 0) === 1;
}
