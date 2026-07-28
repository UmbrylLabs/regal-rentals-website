PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS square_customers (
  customer_id TEXT PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  square_customer_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS square_cards (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  square_customer_id TEXT NOT NULL,
  card_brand TEXT,
  last_4 TEXT,
  card_type TEXT,
  exp_month INTEGER,
  exp_year INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_square_cards_customer ON square_cards(customer_id, enabled);

CREATE TABLE IF NOT EXISTS payment_requests (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('reservation', 'balance', 'security_deposit', 'custom')),
  description TEXT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  expected_method TEXT NOT NULL DEFAULT 'unspecified' CHECK (expected_method IN ('credit_card', 'debit_card', 'unspecified')),
  require_card_on_file INTEGER NOT NULL DEFAULT 0 CHECK (require_card_on_file IN (0, 1)),
  applies_to_rental INTEGER NOT NULL DEFAULT 1 CHECK (applies_to_rental IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'processing', 'paid', 'failed', 'cancelled', 'expired')),
  expires_at INTEGER NOT NULL,
  square_payment_id TEXT UNIQUE,
  paid_at INTEGER,
  failure_message TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_payment_requests_booking ON payment_requests(booking_id, created_at);
CREATE INDEX IF NOT EXISTS idx_payment_requests_expiry ON payment_requests(status, expires_at);

CREATE TABLE IF NOT EXISTS booking_payments (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  payment_request_id TEXT REFERENCES payment_requests(id) ON DELETE SET NULL,
  provider TEXT NOT NULL CHECK (provider IN ('square', 'cash', 'manual')),
  purpose TEXT NOT NULL CHECK (purpose IN ('reservation', 'balance', 'security_deposit', 'custom')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'failed', 'partially_refunded', 'refunded')),
  applies_to_rental INTEGER NOT NULL DEFAULT 1 CHECK (applies_to_rental IN (0, 1)),
  square_payment_id TEXT UNIQUE,
  square_receipt_url TEXT,
  square_card_id TEXT,
  card_brand TEXT,
  card_last_4 TEXT,
  card_type TEXT,
  expected_method TEXT,
  method_mismatch INTEGER NOT NULL DEFAULT 0 CHECK (method_mismatch IN (0, 1)),
  note TEXT,
  received_by TEXT REFERENCES users(id),
  paid_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_booking_payments_booking ON booking_payments(booking_id, paid_at);
CREATE INDEX IF NOT EXISTS idx_booking_payments_request ON booking_payments(payment_request_id);

CREATE TABLE IF NOT EXISTS square_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at INTEGER NOT NULL DEFAULT (unixepoch())
);
