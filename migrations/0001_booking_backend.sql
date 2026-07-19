PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL DEFAULT 600000,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_seen_at INTEGER NOT NULL DEFAULT (unixepoch()),
  ip_hash TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS login_attempts (
  attempt_key TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  window_started_at INTEGER NOT NULL DEFAULT (unixepoch()),
  locked_until INTEGER
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  phone TEXT NOT NULL,
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  state TEXT DEFAULT 'CA',
  postal_code TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  quantity_owned INTEGER NOT NULL CHECK (quantity_owned >= 0),
  price_cents INTEGER CHECK (price_cents IS NULL OR price_cents >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  booking_number TEXT NOT NULL UNIQUE,
  idempotency_key TEXT UNIQUE,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  status TEXT NOT NULL CHECK (
    status IN (
      'inquiry', 'quote', 'hold', 'confirmed', 'paid', 'ready',
      'out', 'returned', 'completed', 'cancelled', 'expired'
    )
  ),
  event_start_at INTEGER NOT NULL,
  event_end_at INTEGER NOT NULL,
  block_start_at INTEGER NOT NULL,
  block_end_at INTEGER NOT NULL,
  hold_expires_at INTEGER,
  service_type TEXT NOT NULL CHECK (service_type IN ('delivery', 'pickup')),
  event_city TEXT NOT NULL,
  event_address TEXT,
  notes TEXT,
  subtotal_cents INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  created_by TEXT REFERENCES users(id),
  updated_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK (event_end_at > event_start_at),
  CHECK (block_end_at > block_start_at),
  CHECK (block_start_at <= event_start_at),
  CHECK (block_end_at >= event_end_at)
);
CREATE INDEX IF NOT EXISTS idx_bookings_window ON bookings(block_start_at, block_end_at);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_id);

CREATE TABLE IF NOT EXISTS booking_items (
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER CHECK (unit_price_cents IS NULL OR unit_price_cents >= 0),
  PRIMARY KEY (booking_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_booking_items_product ON booking_items(product_id);

CREATE TABLE IF NOT EXISTS booking_status_history (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT NOT NULL,
  changed_by TEXT REFERENCES users(id),
  note TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_booking_history_booking ON booking_status_history(booking_id, created_at);

CREATE TABLE IF NOT EXISTS signing_requests (
  token_hash TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  signer_name TEXT NOT NULL,
  signer_email TEXT NOT NULL COLLATE NOCASE,
  agreement_version INTEGER NOT NULL,
  agreement_html TEXT NOT NULL,
  agreement_sha256 TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  viewed_at INTEGER,
  signed_at INTEGER,
  voided_at INTEGER,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (booking_id, agreement_version)
);
CREATE INDEX IF NOT EXISTS idx_signing_booking ON signing_requests(booking_id);
CREATE INDEX IF NOT EXISTS idx_signing_expiry ON signing_requests(expires_at);

CREATE TABLE IF NOT EXISTS signatures (
  id TEXT PRIMARY KEY,
  signing_token_hash TEXT NOT NULL UNIQUE REFERENCES signing_requests(token_hash),
  typed_name TEXT NOT NULL,
  signature_svg TEXT NOT NULL,
  consent_text TEXT NOT NULL,
  signer_ip TEXT,
  user_agent TEXT,
  signed_at INTEGER NOT NULL,
  evidence_sha256 TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  metadata_json TEXT,
  ip_hash TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id, created_at);

-- Database-level inventory protection. These triggers are the final authority.
-- Blocking statuses: hold (only while unexpired), confirmed, paid, ready, out, returned.

CREATE TRIGGER IF NOT EXISTS booking_items_prevent_overbooking_insert
BEFORE INSERT ON booking_items
WHEN EXISTS (
  SELECT 1
  FROM bookings nb
  WHERE nb.id = NEW.booking_id
    AND (
      nb.status IN ('confirmed', 'paid', 'ready', 'out', 'returned')
      OR (nb.status = 'hold' AND (nb.hold_expires_at IS NULL OR nb.hold_expires_at > unixepoch()))
    )
)
BEGIN
  SELECT CASE
    WHEN (
      SELECT quantity_owned FROM products WHERE id = NEW.product_id AND active = 1
    ) IS NULL THEN RAISE(ABORT, 'PRODUCT_UNAVAILABLE')
    WHEN NEW.quantity + COALESCE((
      SELECT SUM(existing_item.quantity)
      FROM booking_items existing_item
      JOIN bookings existing_booking ON existing_booking.id = existing_item.booking_id
      JOIN bookings new_booking ON new_booking.id = NEW.booking_id
      WHERE existing_item.product_id = NEW.product_id
        AND existing_booking.id <> NEW.booking_id
        AND existing_booking.block_start_at < new_booking.block_end_at
        AND existing_booking.block_end_at > new_booking.block_start_at
        AND (
          existing_booking.status IN ('confirmed', 'paid', 'ready', 'out', 'returned')
          OR (
            existing_booking.status = 'hold'
            AND (
              existing_booking.hold_expires_at IS NULL
              OR existing_booking.hold_expires_at > unixepoch()
            )
          )
        )
    ), 0) > (
      SELECT quantity_owned FROM products WHERE id = NEW.product_id
    ) THEN RAISE(ABORT, 'INVENTORY_CONFLICT')
  END;
END;

CREATE TRIGGER IF NOT EXISTS booking_items_prevent_overbooking_update
BEFORE UPDATE OF product_id, quantity ON booking_items
WHEN EXISTS (
  SELECT 1
  FROM bookings nb
  WHERE nb.id = NEW.booking_id
    AND (
      nb.status IN ('confirmed', 'paid', 'ready', 'out', 'returned')
      OR (nb.status = 'hold' AND (nb.hold_expires_at IS NULL OR nb.hold_expires_at > unixepoch()))
    )
)
BEGIN
  SELECT CASE
    WHEN (
      SELECT quantity_owned FROM products WHERE id = NEW.product_id AND active = 1
    ) IS NULL THEN RAISE(ABORT, 'PRODUCT_UNAVAILABLE')
    WHEN NEW.quantity + COALESCE((
      SELECT SUM(existing_item.quantity)
      FROM booking_items existing_item
      JOIN bookings existing_booking ON existing_booking.id = existing_item.booking_id
      JOIN bookings new_booking ON new_booking.id = NEW.booking_id
      WHERE existing_item.product_id = NEW.product_id
        AND existing_booking.id <> NEW.booking_id
        AND existing_booking.block_start_at < new_booking.block_end_at
        AND existing_booking.block_end_at > new_booking.block_start_at
        AND (
          existing_booking.status IN ('confirmed', 'paid', 'ready', 'out', 'returned')
          OR (
            existing_booking.status = 'hold'
            AND (
              existing_booking.hold_expires_at IS NULL
              OR existing_booking.hold_expires_at > unixepoch()
            )
          )
        )
    ), 0) > (
      SELECT quantity_owned FROM products WHERE id = NEW.product_id
    ) THEN RAISE(ABORT, 'INVENTORY_CONFLICT')
  END;
END;

CREATE TRIGGER IF NOT EXISTS bookings_prevent_overbooking_on_activation
BEFORE UPDATE OF status, block_start_at, block_end_at, hold_expires_at ON bookings
WHEN (
  NEW.status IN ('confirmed', 'paid', 'ready', 'out', 'returned')
  OR (NEW.status = 'hold' AND (NEW.hold_expires_at IS NULL OR NEW.hold_expires_at > unixepoch()))
)
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM booking_items current_item
    JOIN products product ON product.id = current_item.product_id
    WHERE current_item.booking_id = NEW.id
      AND (
        product.active = 0
        OR current_item.quantity + COALESCE((
          SELECT SUM(existing_item.quantity)
          FROM booking_items existing_item
          JOIN bookings existing_booking ON existing_booking.id = existing_item.booking_id
          WHERE existing_item.product_id = current_item.product_id
            AND existing_booking.id <> NEW.id
            AND existing_booking.block_start_at < NEW.block_end_at
            AND existing_booking.block_end_at > NEW.block_start_at
            AND (
              existing_booking.status IN ('confirmed', 'paid', 'ready', 'out', 'returned')
              OR (
                existing_booking.status = 'hold'
                AND (
                  existing_booking.hold_expires_at IS NULL
                  OR existing_booking.hold_expires_at > unixepoch()
                )
              )
            )
        ), 0) > product.quantity_owned
      )
  ) THEN RAISE(ABORT, 'INVENTORY_CONFLICT') END;
END;

CREATE TRIGGER IF NOT EXISTS products_prevent_unsafe_quantity_reduction
BEFORE UPDATE OF quantity_owned, active ON products
WHEN NEW.quantity_owned < OLD.quantity_owned OR NEW.active = 0
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM bookings anchor_booking
    JOIN booking_items anchor_item ON anchor_item.booking_id = anchor_booking.id
    WHERE anchor_item.product_id = NEW.id
      AND (
        anchor_booking.status IN ('confirmed', 'paid', 'ready', 'out', 'returned')
        OR (
          anchor_booking.status = 'hold'
          AND (
            anchor_booking.hold_expires_at IS NULL
            OR anchor_booking.hold_expires_at > unixepoch()
          )
        )
      )
      AND (
        NEW.active = 0
        OR COALESCE((
          SELECT SUM(overlap_item.quantity)
          FROM booking_items overlap_item
          JOIN bookings overlap_booking ON overlap_booking.id = overlap_item.booking_id
          WHERE overlap_item.product_id = NEW.id
            AND overlap_booking.block_start_at < anchor_booking.block_end_at
            AND overlap_booking.block_end_at > anchor_booking.block_start_at
            AND (
              overlap_booking.status IN ('confirmed', 'paid', 'ready', 'out', 'returned')
              OR (
                overlap_booking.status = 'hold'
                AND (
                  overlap_booking.hold_expires_at IS NULL
                  OR overlap_booking.hold_expires_at > unixepoch()
                )
              )
            )
        ), 0) > NEW.quantity_owned
      )
  ) THEN RAISE(ABORT, 'ACTIVE_RESERVATIONS_EXCEED_NEW_QUANTITY') END;
END;

CREATE TRIGGER IF NOT EXISTS bookings_status_history
AFTER UPDATE OF status ON bookings
WHEN OLD.status <> NEW.status
BEGIN
  INSERT INTO booking_status_history (
    id, booking_id, old_status, new_status, changed_by, note, created_at
  ) VALUES (
    lower(hex(randomblob(16))),
    NEW.id,
    OLD.status,
    NEW.status,
    NEW.updated_by,
    'Status changed',
    unixepoch()
  );
END;

INSERT OR IGNORE INTO products (
  id, sku, name, category, quantity_owned, price_cents, active
) VALUES
  ('round-table-60', 'TABLE-ROUND-60', '60-Inch Round Table', 'Tables & Chairs', 3, 1600, 1),
  ('rectangle-table-6', 'TABLE-RECT-6', '6-Foot Rectangle Table', 'Tables & Chairs', 2, 1400, 1),
  ('canopy-10x10', 'CANOPY-10X10', '10×10 Pop-Up Canopy', 'Tents & Shade', 1, NULL, 1);
