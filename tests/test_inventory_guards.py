import sqlite3
import tempfile
import threading
import time
import unittest
from pathlib import Path

SCHEMA = Path(__file__).resolve().parents[1] / "migrations" / "0001_booking_backend.sql"
NOW = int(time.time())


def connect(path=":memory:"):
    db = sqlite3.connect(path, timeout=10, check_same_thread=False)
    db.execute("PRAGMA foreign_keys = ON")
    db.executescript(SCHEMA.read_text())
    return db


def add_customer(db, customer_id):
    db.execute(
        "INSERT INTO customers (id, name, email, phone) VALUES (?, ?, ?, ?)",
        (customer_id, customer_id, f"{customer_id}@example.com", "9165550100"),
    )


def add_booking(db, booking_id, customer_id, status, start_at, end_at,
                product_id="round-table-60", quantity=1, hold_expires_at=None):
    db.execute(
        """INSERT INTO bookings (
             id, booking_number, customer_id, status,
             event_start_at, event_end_at, block_start_at, block_end_at,
             hold_expires_at, service_type, event_city
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'delivery', 'Folsom')""",
        (booking_id, booking_id, customer_id, status, start_at, end_at,
         start_at, end_at, hold_expires_at),
    )
    db.execute(
        """INSERT INTO booking_items (
             booking_id, product_id, quantity, unit_price_cents
           ) VALUES (?, ?, ?, 1600)""",
        (booking_id, product_id, quantity),
    )


class InventoryGuardTests(unittest.TestCase):
    def setUp(self):
        self.db = connect()
        add_customer(self.db, "c1")
        add_customer(self.db, "c2")
        add_customer(self.db, "c3")

    def tearDown(self):
        self.db.close()

    def test_overlapping_reservations_cannot_exceed_owned_quantity(self):
        add_booking(self.db, "b1", "c1", "confirmed", NOW + 1000, NOW + 5000, quantity=2)
        with self.assertRaisesRegex(sqlite3.IntegrityError, "INVENTORY_CONFLICT"):
            add_booking(self.db, "b2", "c2", "confirmed", NOW + 2000, NOW + 4000, quantity=2)

    def test_overlap_within_capacity_is_allowed(self):
        add_booking(self.db, "b1", "c1", "confirmed", NOW + 1000, NOW + 5000, quantity=2)
        add_booking(self.db, "b2", "c2", "confirmed", NOW + 2000, NOW + 4000, quantity=1)
        self.assertEqual(self.db.execute("SELECT SUM(quantity) FROM booking_items").fetchone()[0], 3)

    def test_adjacent_reservations_do_not_overlap(self):
        add_booking(self.db, "b1", "c1", "confirmed", NOW + 1000, NOW + 2000, quantity=3)
        add_booking(self.db, "b2", "c2", "confirmed", NOW + 2000, NOW + 3000, quantity=3)

    def test_expired_hold_does_not_block_inventory(self):
        add_booking(self.db, "b1", "c1", "hold", NOW + 1000, NOW + 5000,
                    quantity=3, hold_expires_at=NOW - 1)
        add_booking(self.db, "b2", "c2", "confirmed", NOW + 2000, NOW + 4000, quantity=3)

    def test_unexpired_hold_blocks_inventory(self):
        add_booking(self.db, "b1", "c1", "hold", NOW + 1000, NOW + 5000,
                    quantity=3, hold_expires_at=NOW + 1800)
        with self.assertRaisesRegex(sqlite3.IntegrityError, "INVENTORY_CONFLICT"):
            add_booking(self.db, "b2", "c2", "confirmed", NOW + 2000, NOW + 4000, quantity=1)

    def test_quote_activation_rechecks_inventory(self):
        add_booking(self.db, "confirmed", "c1", "confirmed", NOW + 1000, NOW + 5000, quantity=2)
        add_booking(self.db, "quote", "c2", "quote", NOW + 2000, NOW + 4000, quantity=2)
        with self.assertRaisesRegex(sqlite3.IntegrityError, "INVENTORY_CONFLICT"):
            self.db.execute("UPDATE bookings SET status = 'confirmed' WHERE id = 'quote'")

    def test_moving_booking_into_conflict_is_blocked(self):
        add_booking(self.db, "b1", "c1", "confirmed", NOW + 1000, NOW + 3000, quantity=3)
        add_booking(self.db, "b2", "c2", "confirmed", NOW + 4000, NOW + 6000, quantity=3)
        with self.assertRaisesRegex(sqlite3.IntegrityError, "INVENTORY_CONFLICT"):
            self.db.execute(
                """UPDATE bookings
                   SET block_start_at = ?, block_end_at = ?,
                       event_start_at = ?, event_end_at = ?
                   WHERE id = 'b2'""",
                (NOW + 2000, NOW + 5000, NOW + 2000, NOW + 5000),
            )

    def test_inventory_cannot_be_reduced_below_active_reservations(self):
        add_booking(self.db, "b1", "c1", "confirmed", NOW + 1000, NOW + 5000, quantity=3)
        with self.assertRaisesRegex(sqlite3.IntegrityError, "ACTIVE_RESERVATIONS_EXCEED_NEW_QUANTITY"):
            self.db.execute("UPDATE products SET quantity_owned = 2 WHERE id = 'round-table-60'")

    def test_cancelled_booking_releases_inventory(self):
        add_booking(self.db, "b1", "c1", "confirmed", NOW + 1000, NOW + 5000, quantity=3)
        self.db.execute("UPDATE bookings SET status = 'cancelled' WHERE id = 'b1'")
        add_booking(self.db, "b2", "c2", "confirmed", NOW + 2000, NOW + 4000, quantity=3)

    def test_two_simultaneous_activations_only_allow_one(self):
        with tempfile.NamedTemporaryFile(suffix=".sqlite") as file:
            setup = connect(file.name)
            add_customer(setup, "x1")
            add_customer(setup, "x2")
            add_booking(setup, "q1", "x1", "quote", NOW + 1000, NOW + 5000, quantity=2)
            add_booking(setup, "q2", "x2", "quote", NOW + 1000, NOW + 5000, quantity=2)
            setup.commit()
            setup.close()
            barrier = threading.Barrier(2)
            results = []
            lock = threading.Lock()

            def activate(booking_id):
                db = connect(file.name)
                try:
                    barrier.wait()
                    db.execute("BEGIN IMMEDIATE")
                    db.execute("UPDATE bookings SET status = 'confirmed' WHERE id = ?", (booking_id,))
                    db.commit()
                    outcome = "confirmed"
                except sqlite3.IntegrityError as error:
                    db.rollback()
                    outcome = str(error)
                finally:
                    db.close()
                with lock:
                    results.append(outcome)

            first = threading.Thread(target=activate, args=("q1",))
            second = threading.Thread(target=activate, args=("q2",))
            first.start(); second.start(); first.join(); second.join()
            self.assertEqual(results.count("confirmed"), 1)
            self.assertEqual(sum("INVENTORY_CONFLICT" in result for result in results), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
