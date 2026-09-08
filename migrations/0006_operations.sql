PRAGMA foreign_keys = ON;
ALTER TABLE products ADD COLUMN image_key TEXT;
ALTER TABLE products ADD COLUMN image_alt TEXT NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN charges_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE bookings ADD COLUMN tax_cents INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0);
ALTER TABLE bookings ADD COLUMN request_hash TEXT;
ALTER TABLE signing_requests ADD COLUMN booking_revision INTEGER;
ALTER TABLE payment_requests ADD COLUMN booking_revision INTEGER;
ALTER TABLE booking_payments ADD COLUMN cash_key TEXT;
CREATE UNIQUE INDEX idx_booking_payments_cash_key ON booking_payments(cash_key) WHERE cash_key IS NOT NULL;
CREATE INDEX idx_bookings_event_start ON bookings(event_start_at, id);

CREATE TRIGGER signing_requests_require_current_booking BEFORE INSERT ON signing_requests
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM bookings b WHERE b.id=NEW.booking_id
    AND b.status NOT IN ('cancelled','expired','completed')
    AND NEW.booking_revision=b.revision) THEN RAISE(ABORT,'AGREEMENT_NOT_CURRENT') END;
END;

CREATE TRIGGER payment_requests_require_current_booking BEFORE INSERT ON payment_requests
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM bookings b WHERE b.id=NEW.booking_id
    AND NEW.booking_revision=b.revision) THEN RAISE(ABORT,'STALE_BOOKING') END;
END;

CREATE TRIGGER bookings_invalidate_city_links AFTER UPDATE OF event_city ON bookings
WHEN NEW.event_city <> OLD.event_city
BEGIN
  UPDATE payment_requests SET status='cancelled', updated_at=unixepoch() WHERE booking_id=NEW.id AND status IN ('open','failed');
  UPDATE signing_requests SET voided_at=COALESCE(voided_at,unixepoch()) WHERE booking_id=NEW.id;
END;

DROP TRIGGER payment_attempts_require_live_reservation;
CREATE TRIGGER payment_attempts_require_live_reservation BEFORE INSERT ON payment_attempts
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM payment_requests pr JOIN bookings b ON b.id = pr.booking_id
    WHERE pr.id = NEW.payment_request_id AND b.id = NEW.booking_id
      AND pr.status IN ('open', 'failed') AND pr.expires_at > unixepoch()
      AND (b.status IN ('confirmed', 'paid', 'ready', 'out', 'returned')
        OR (b.status = 'hold' AND b.hold_expires_at > unixepoch() AND pr.applies_to_rental = 1))
      AND (pr.applies_to_rental = 0 OR pr.amount_cents <= b.subtotal_cents + b.tax_cents - (
        SELECT COALESCE(SUM(amount_cents - refunded_cents), 0) FROM booking_payments
        WHERE booking_id = b.id AND applies_to_rental = 1 AND status IN ('completed', 'partially_refunded')))
  ) THEN RAISE(ABORT, 'BOOKING_NOT_PAYABLE') END;
END;

CREATE TRIGGER cash_payments_require_live_reservation BEFORE INSERT ON booking_payments
WHEN NEW.provider = 'cash'
BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM payment_attempts WHERE booking_id = NEW.booking_id
    AND status IN ('processing', 'unknown')) THEN RAISE(ABORT, 'PAYMENT_PROCESSING') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM bookings b WHERE b.id = NEW.booking_id
    AND (b.status IN ('confirmed', 'paid', 'ready', 'out', 'returned')
      OR (b.status = 'hold' AND b.hold_expires_at > unixepoch() AND NEW.applies_to_rental = 1)))
    THEN RAISE(ABORT, 'BOOKING_NOT_PAYABLE') END;
  SELECT CASE WHEN NEW.applies_to_rental = 1 AND NEW.amount_cents > (
    SELECT b.subtotal_cents + b.tax_cents - COALESCE((SELECT SUM(amount_cents - refunded_cents)
      FROM booking_payments WHERE booking_id = b.id AND applies_to_rental = 1
        AND status IN ('completed', 'partially_refunded')), 0)
    FROM bookings b WHERE b.id = NEW.booking_id)
    THEN RAISE(ABORT, 'PAYMENT_EXCEEDS_BALANCE') END;
END;

CREATE TABLE inquiries (
  id TEXT PRIMARY KEY,
  request_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  event_date TEXT,
  event_city TEXT,
  event_type TEXT,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'closed')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_inquiries_status_created ON inquiries(status, created_at);

CREATE TABLE public_request_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 1,
  expires_at INTEGER NOT NULL
);

CREATE TABLE notification_outbox (
  id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL UNIQUE,
  booking_id TEXT REFERENCES bookings(id),
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER,
  next_attempt_at INTEGER NOT NULL DEFAULT (unixepoch()),
  first_attempt_at INTEGER,
  sender TEXT,
  provider_id TEXT,
  last_error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  sent_at INTEGER
);
CREATE INDEX idx_notification_outbox_queue ON notification_outbox(status, next_attempt_at);

CREATE VIEW booking_release_checks AS
SELECT b.id,
  NOT EXISTS (SELECT 1 FROM booking_items WHERE booking_id=b.id AND unit_price_cents IS NULL) AS pricing_ready,
  EXISTS (SELECT 1 FROM signing_requests sr JOIN signatures s ON s.signing_token_hash=sr.token_hash
    WHERE sr.booking_id=b.id AND sr.voided_at IS NULL AND sr.signed_at IS NOT NULL) AS agreement_ready,
  b.subtotal_cents + b.tax_cents <= COALESCE((SELECT SUM(amount_cents-refunded_cents) FROM booking_payments
    WHERE booking_id=b.id AND applies_to_rental=1 AND status IN ('completed','partially_refunded')),0) AS balance_ready,
  EXISTS (SELECT 1 FROM signing_requests sr JOIN signatures s ON s.signing_token_hash=sr.token_hash
    WHERE sr.booking_id=b.id AND sr.voided_at IS NULL AND sr.signed_at IS NOT NULL AND (
      ((instr(s.consent_text,'[PAYMENT_SECURITY:credit_card:') > 0 OR instr(s.consent_text,'[PAYMENT_SECURITY:card_on_file:') > 0)
        AND EXISTS (SELECT 1 FROM booking_payments p JOIN square_cards c ON c.id=p.square_card_id
          WHERE p.booking_id=b.id AND c.customer_id=b.customer_id AND c.enabled=1 AND c.card_type='CREDIT'
            AND c.exp_year*100+c.exp_month >= CAST(strftime('%Y','now') AS INTEGER)*100+CAST(strftime('%m','now') AS INTEGER)
            AND p.applies_to_rental=1 AND p.status IN ('completed','partially_refunded')))
      OR ((instr(s.consent_text,'[PAYMENT_SECURITY:debit_card:') > 0 OR instr(s.consent_text,'[PAYMENT_SECURITY:cash:') > 0 OR instr(s.consent_text,'[PAYMENT_SECURITY:security_deposit:') > 0)
        AND ROUND(b.subtotal_cents/2.0) <= COALESCE((SELECT SUM(amount_cents-refunded_cents) FROM booking_payments
          WHERE booking_id=b.id AND purpose='security_deposit' AND status IN ('completed','partially_refunded')),0))
    )) AS security_ready
FROM bookings b;

CREATE TRIGGER bookings_require_release_checks AFTER UPDATE OF status ON bookings
WHEN NEW.status IN ('ready','out') AND NEW.status <> OLD.status
BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM booking_release_checks WHERE id=NEW.id
    AND (pricing_ready=0 OR agreement_ready=0 OR balance_ready=0 OR security_ready=0))
    THEN RAISE(ABORT,'RELEASE_NOT_READY') END;
END;

CREATE TRIGGER bookings_protect_invoice_during_payment BEFORE UPDATE ON bookings
WHEN (NEW.tax_cents <> OLD.tax_cents OR NEW.charges_json <> OLD.charges_json)
  AND EXISTS (SELECT 1 FROM payment_attempts WHERE booking_id = OLD.id AND status IN ('processing', 'unknown'))
BEGIN SELECT RAISE(ABORT, 'PAYMENT_PROCESSING'); END;
CREATE TRIGGER bookings_invalidate_invoice_links AFTER UPDATE ON bookings
WHEN NEW.tax_cents <> OLD.tax_cents OR NEW.charges_json <> OLD.charges_json
BEGIN
  UPDATE payment_requests SET status = 'cancelled', updated_at = unixepoch()
    WHERE booking_id = NEW.id AND status IN ('open', 'failed');
  UPDATE signing_requests SET voided_at = COALESCE(voided_at, unixepoch()) WHERE booking_id = NEW.id;
END;
