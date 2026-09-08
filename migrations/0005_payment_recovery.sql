PRAGMA foreign_keys = ON;

ALTER TABLE bookings ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0);

-- One durable attempt per processor submission. Unknown results remain locked
-- until a signed webhook or an explicit processor reconciliation resolves them.
CREATE TABLE payment_attempts (
  id TEXT PRIMARY KEY,
  payment_request_id TEXT NOT NULL REFERENCES payment_requests(id),
  booking_id TEXT NOT NULL REFERENCES bookings(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('processing', 'unknown', 'completed', 'failed')),
  square_payment_id TEXT UNIQUE,
  original_hold_expires_at INTEGER,
  failure_message TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX idx_payment_attempts_active_booking ON payment_attempts(booking_id)
  WHERE status IN ('processing', 'unknown');
CREATE INDEX idx_payment_attempts_request ON payment_attempts(payment_request_id, created_at);

CREATE TABLE booking_refunds (
  id TEXT PRIMARY KEY,
  booking_payment_id TEXT NOT NULL REFERENCES booking_payments(id),
  square_refund_id TEXT UNIQUE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed', 'rejected')),
  reason TEXT,
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_booking_refunds_payment ON booking_refunds(booking_payment_id, status);
ALTER TABLE booking_payments ADD COLUMN refunded_cents INTEGER NOT NULL DEFAULT 0
  CHECK (refunded_cents >= 0 AND refunded_cents <= amount_cents);

-- Reject an obsolete link before any external charge. Only an existing live
-- reservation can collect online payments; quotes must be held/confirmed first.
CREATE TRIGGER payment_attempts_require_live_reservation
BEFORE INSERT ON payment_attempts
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM payment_requests pr JOIN bookings b ON b.id = pr.booking_id
    WHERE pr.id = NEW.payment_request_id AND b.id = NEW.booking_id
      AND pr.status IN ('open', 'failed') AND pr.expires_at > unixepoch()
      AND (b.status IN ('confirmed', 'paid', 'ready', 'out', 'returned')
        OR (b.status = 'hold' AND b.hold_expires_at > unixepoch() AND pr.applies_to_rental = 1))
      AND (pr.applies_to_rental = 0 OR pr.amount_cents <= b.subtotal_cents - (
        SELECT COALESCE(SUM(amount_cents - refunded_cents), 0) FROM booking_payments
        WHERE booking_id = b.id AND applies_to_rental = 1 AND status IN ('completed', 'partially_refunded')))
  ) THEN RAISE(ABORT, 'BOOKING_NOT_PAYABLE') END;
END;

CREATE TRIGGER payment_attempts_claim_reservation
AFTER INSERT ON payment_attempts
BEGIN
  UPDATE payment_requests SET status = 'processing', failure_message = NULL,
    updated_at = unixepoch() WHERE id = NEW.payment_request_id;
  -- Existing capacity triggers check this claim inside the same transaction.
  UPDATE bookings SET hold_expires_at = NULL
    WHERE id = NEW.booking_id AND status = 'hold';
END;

CREATE TRIGGER bookings_protect_processing_payment
BEFORE UPDATE ON bookings
WHEN EXISTS (SELECT 1 FROM payment_attempts pa WHERE pa.booking_id = OLD.id
  AND pa.status IN ('processing', 'unknown'))
AND (NEW.status <> OLD.status OR NEW.event_start_at <> OLD.event_start_at
  OR NEW.event_end_at <> OLD.event_end_at OR NEW.block_start_at <> OLD.block_start_at
  OR NEW.block_end_at <> OLD.block_end_at OR NEW.subtotal_cents <> OLD.subtotal_cents
  OR NEW.service_type <> OLD.service_type OR NEW.event_address IS NOT OLD.event_address
  OR NEW.event_city <> OLD.event_city
  OR (OLD.hold_expires_at IS NULL AND NEW.hold_expires_at IS NOT NULL))
BEGIN
  SELECT RAISE(ABORT, 'PAYMENT_PROCESSING');
END;

CREATE TRIGGER booking_items_protect_payment_insert BEFORE INSERT ON booking_items
WHEN EXISTS (SELECT 1 FROM payment_attempts WHERE booking_id = NEW.booking_id
  AND status IN ('processing', 'unknown'))
BEGIN SELECT RAISE(ABORT, 'PAYMENT_PROCESSING'); END;
CREATE TRIGGER booking_items_protect_payment_update BEFORE UPDATE ON booking_items
WHEN EXISTS (SELECT 1 FROM payment_attempts WHERE booking_id IN (OLD.booking_id, NEW.booking_id)
  AND status IN ('processing', 'unknown'))
BEGIN SELECT RAISE(ABORT, 'PAYMENT_PROCESSING'); END;
CREATE TRIGGER booking_items_protect_payment_delete BEFORE DELETE ON booking_items
WHEN EXISTS (SELECT 1 FROM payment_attempts WHERE booking_id = OLD.booking_id
  AND status IN ('processing', 'unknown'))
BEGIN SELECT RAISE(ABORT, 'PAYMENT_PROCESSING'); END;

CREATE TRIGGER bookings_retain_payment_history BEFORE DELETE ON bookings
WHEN EXISTS (SELECT 1 FROM booking_payments WHERE booking_id = OLD.id)
  OR EXISTS (SELECT 1 FROM payment_attempts WHERE booking_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'BOOKING_RECORD_PROTECTED'); END;

CREATE TRIGGER bookings_invalidate_obsolete_links AFTER UPDATE ON bookings
WHEN NEW.status IN ('cancelled', 'expired') OR NEW.event_start_at <> OLD.event_start_at
  OR NEW.event_end_at <> OLD.event_end_at OR NEW.subtotal_cents <> OLD.subtotal_cents
  OR NEW.service_type <> OLD.service_type OR NEW.event_address IS NOT OLD.event_address
BEGIN
  UPDATE payment_requests SET status = 'cancelled', updated_at = unixepoch()
    WHERE booking_id = NEW.id AND status IN ('open', 'failed');
  UPDATE signing_requests SET voided_at = COALESCE(voided_at, unixepoch())
    WHERE booking_id = NEW.id;
END;

CREATE TRIGGER signing_requests_supersede_previous AFTER INSERT ON signing_requests
BEGIN
  UPDATE signing_requests SET voided_at = COALESCE(voided_at, unixepoch())
    WHERE booking_id = NEW.booking_id AND agreement_version < NEW.agreement_version;
END;

CREATE TRIGGER signatures_require_current_agreement BEFORE INSERT ON signatures
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM signing_requests sr JOIN bookings b ON b.id = sr.booking_id
    WHERE sr.token_hash = NEW.signing_token_hash AND sr.voided_at IS NULL
      AND sr.expires_at > unixepoch()
      AND b.status NOT IN ('cancelled', 'expired', 'completed')
      AND sr.agreement_version = (SELECT MAX(agreement_version) FROM signing_requests
        WHERE booking_id = sr.booking_id)
  ) THEN RAISE(ABORT, 'AGREEMENT_NOT_CURRENT') END;
END;
