// Public quote inquiries are separate from reservations:
// no inventory is held until an owner explicitly creates a booking.
export async function ensureInquiryTables(db) {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS website_inquiries (" +
    "id TEXT PRIMARY KEY, reference TEXT NOT NULL UNIQUE, name TEXT NOT NULL, " +
    "email TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', event_date TEXT NOT NULL, " +
    "event_city TEXT NOT NULL, package_name TEXT NOT NULL DEFAULT '', items_json TEXT NOT NULL DEFAULT '[]', " +
    "details TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'new', " +
    "email_sent INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT (unixepoch()), " +
    "updated_at INTEGER NOT NULL DEFAULT (unixepoch())" +
    ")"
  ).run();
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS website_inquiry_rate (" +
    "ip_hash TEXT NOT NULL, hour_bucket INTEGER NOT NULL, submissions INTEGER NOT NULL DEFAULT 0, " +
    "PRIMARY KEY (ip_hash, hour_bucket))"
  ).run();
}

export const INQUIRY_STATUSES = ['new', 'contacted', 'archived'];
