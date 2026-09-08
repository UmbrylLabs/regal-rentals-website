import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';

export const root = resolve(import.meta.dirname, '../..');
export class TestD1 {
  constructor() {
    this.sql = new DatabaseSync(':memory:');
    this.sql.exec('PRAGMA foreign_keys = ON');
    for (const name of readdirSync(resolve(root, 'migrations')).filter(n => n.endsWith('.sql')).sort()) {
      this.sql.exec(readFileSync(resolve(root, 'migrations', name), 'utf8'));
    }
  }
  prepare(sql) {
    const indices = [];
    const converted = sql.replace(/\?(\d+)/g, (_, index) => { indices.push(Number(index) - 1); return '?'; });
    const owner = this;
    return {
      sql, values: [],
      bind(...values) { this.values = values; return this; },
      execute(kind = 'run') {
        if (owner.failOnce?.(sql)) { owner.failOnce = null; throw new Error('SIMULATED_DATABASE_FAILURE'); }
        const stmt = owner.sql.prepare(converted);
        const args = indices.length ? indices.map(i => this.values[i]) : this.values;
        if (kind === 'all') return { results: stmt.all(...args), success: true };
        if (kind === 'first') return stmt.get(...args) || null;
        const result = stmt.run(...args);
        return { meta: { changes: Number(result.changes) }, success: true };
      },
      async run() { return this.execute(); },
      async all() { return this.execute('all'); },
      async first(column) { const result = this.execute('first'); return column ? result?.[column] ?? null : result; }
    };
  }
  async batch(statements) {
    this.sql.exec('BEGIN');
    try { const result = statements.map(stmt => stmt.execute()); this.sql.exec('COMMIT'); return result; }
    catch (error) { this.sql.exec('ROLLBACK'); throw error; }
  }
  close() { this.sql.close(); }
}

// Authentication is simulated at the local test boundary. The unchanged route
// and all business/database modules execute against a real SQLite database.
export async function loadRoute(file, fetchImpl = async () => { throw new Error('TEST_NETWORK_FORBIDDEN'); }) {
  const context = createContext({ Request, Response, Headers, URL, URLSearchParams,
    TextEncoder, TextDecoder, crypto, Date, AbortSignal, atob, btoa, structuredClone,
    console: { log() {}, error() {} }, fetch: fetchImpl });
  const modules = new Map();
  const getModule = path => {
    if (modules.has(path)) return modules.get(path);
    let mod;
    if (path === resolve(root, 'functions/_lib/auth.js')) {
      mod = new SyntheticModule(['protectMutation', 'requireAdmin'], function () {
        this.setExport('protectMutation', () => {});
        this.setExport('requireAdmin', async () => ({ id: 'test-owner', role: 'owner' }));
      }, { context, identifier: path });
    } else mod = new SourceTextModule(readFileSync(path, 'utf8'), { context, identifier: path });
    modules.set(path, mod);
    return mod;
  };
  const mod = getModule(resolve(root, file));
  await mod.link((specifier, reference) => getModule(resolve(dirname(reference.identifier), specifier)));
  await mod.evaluate();
  return mod.namespace;
}

export function fixture(db, { id = 'booking', status = 'hold', start = Math.floor(Date.now() / 1000) + 86400, quantity = 40 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  db.sql.exec(`INSERT OR IGNORE INTO users (id,email,display_name,password_hash,password_salt,role)
    VALUES ('test-owner','owner@example.invalid','Test owner','unused','unused','owner');
    INSERT OR IGNORE INTO customers (id,name,email,phone)
    VALUES ('customer','Test customer','customer@example.invalid','5550000000');
    INSERT OR IGNORE INTO products (id,sku,name,category,quantity_owned,price_cents)
    VALUES ('chair','TEST-CHAIR','Chair','Tables & Chairs',100,225);`);
  db.sql.prepare(`INSERT INTO bookings (id,booking_number,customer_id,status,event_start_at,event_end_at,
    block_start_at,block_end_at,hold_expires_at,service_type,event_city,subtotal_cents)
    VALUES (?,?,'customer',?,?,?,?,?,?,'delivery','Folsom',?)`)
    .run(id, 'RR-'+id, status, start, start + 21600, start - 14400, start + 64800, now + 3600, quantity * 225);
  db.sql.prepare(`INSERT INTO booking_items (booking_id,product_id,quantity,unit_price_cents)
    VALUES (?,'chair',?,225)`).run(id, quantity);
  return { id, start, now };
}

export async function paymentLink(db, { id = 'request', bookingId = 'booking', amount = 4500, purpose = 'reservation' } = {}) {
  const token = 'test-only-payment-token-' + id.padEnd(36, 'x');
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))).toString('hex');
  db.sql.prepare(`INSERT INTO payment_requests (id,token_hash,booking_id,purpose,amount_cents,
    expected_method,applies_to_rental,expires_at,created_by,booking_revision)
    VALUES (?,?,?,?,?,'unspecified',?,unixepoch()+86400,'test-owner',?)`)
    .run(id, hash, bookingId, purpose, amount, purpose === 'security_deposit' ? 0 : 1,
      db.sql.prepare('SELECT revision FROM bookings WHERE id=?').get(bookingId).revision);
  return token;
}

export function squareServer() {
  const state = { charges: [], refunds: [], onCharge: null };
  state.fetch = async (url, options = {}) => {
    if (!String(url).startsWith('https://connect.squareupsandbox.com/')) throw new Error('TEST_NETWORK_FORBIDDEN');
    const path = new URL(url).pathname;
    const body = options.body ? JSON.parse(options.body) : {};
    if (path === '/v2/customers') return Response.json({ customer: { id: 'sq-customer' } });
    if (path === '/v2/payments' && options.method === 'POST') {
      if (state.onCharge) return state.onCharge(body);
      const payment = { id: 'sq-payment-'+(state.charges.length+1), status: 'COMPLETED',
        reference_id: body.reference_id, amount_money: body.amount_money,
        location_id: 'test-location', created_at: new Date().toISOString(),
        card_details: { card: { card_type: 'CREDIT', card_brand: 'VISA', last_4: '0000' } } };
      state.charges.push({ ...payment, idempotency_key: body.idempotency_key });
      return Response.json({ payment });
    }
    if (path === '/v2/payments') return Response.json({ payments: state.charges });
    if (path.startsWith('/v2/payments/')) return Response.json({ payment: state.charges.find(p => p.id === path.split('/').at(-1)) });
    if (path === '/v2/refunds') {
      let refund = state.refunds.find(r => r.key === body.idempotency_key);
      if (!refund) { refund = { id: 'sq-refund-'+(state.refunds.length+1), status: 'COMPLETED',
        location_id: 'test-location', payment_id: body.payment_id, amount_money: body.amount_money,
        reason: body.reason, key: body.idempotency_key }; state.refunds.push(refund); }
      return Response.json({ refund });
    }
    if (path.startsWith('/v2/refunds/')) return Response.json({ refund: state.refunds.find(r => r.id === path.split('/').at(-1)) });
    throw new Error('UNEXPECTED_TEST_PROCESSOR_REQUEST '+path);
  };
  return state;
}

export const environment = DB => ({ DB, SQUARE_ENVIRONMENT: 'sandbox', SQUARE_ACCESS_TOKEN: 'test-token',
  SQUARE_APPLICATION_ID: 'test-app', SQUARE_LOCATION_ID: 'test-location' });
export const request = (url, body, method = 'POST') => new Request('https://example.invalid'+url,
  { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
