import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TestD1, fixture, paymentLink, loadRoute, environment, request, squareServer } from './helpers/runtime.mjs';

async function setup(options = {}) {
  const db = new TestD1();
  fixture(db, options);
  const token = await paymentLink(db);
  const square = squareServer();
  const pay = await loadRoute('functions/api/pay/[token].js', square.fetch);
  const admin = await loadRoute('functions/api/admin/bookings/[id].js', square.fetch);
  const payments = await loadRoute('functions/api/admin/bookings/[id]/payments.js', square.fetch);
  const env = environment(db);
  return { db, square, token, env, pay,
    charge: () => pay.onRequestPost({ env, params: { token }, request: request('/api/pay/'+token,
      { sourceId: 'test-card-token', cardOnFileConsent: false }) }),
    patch: body => admin.onRequestPatch({ env, params: { id: 'booking' }, request: request('/admin', body, 'PATCH') }),
    action: body => payments.onRequestPost({ env, params: { id: 'booking' }, request: request('/admin/payments', body) }) };
}

test('post-event return and completion preserve agreed prices', async t => {
  const f = await setup({ status: 'out', start: Math.floor(Date.now()/1000) - 86400 }); t.after(() => f.db.close());
  f.db.sql.exec("UPDATE products SET price_cents = 300 WHERE id = 'chair'");
  assert.equal((await f.patch({ status: 'returned' })).status, 200);
  assert.equal((await f.patch({ status: 'completed' })).status, 200);
  assert.equal(f.db.sql.prepare("SELECT subtotal_cents FROM bookings WHERE id='booking'").get().subtotal_cents, 9000);
  assert.equal(f.db.sql.prepare("SELECT unit_price_cents FROM booking_items WHERE booking_id='booking'").get().unit_price_cents, 225);
});

test('stale staff edit is rejected without overwriting a new revision', async t => {
  const f = await setup({ status: 'confirmed' }); t.after(() => f.db.close());
  assert.equal((await f.patch({ notes: 'First edit', revision: 0 })).status, 200);
  const retry = await f.patch({ notes: 'Stale edit', revision: 0 });
  assert.equal(retry.status, 409);
  assert.equal(f.db.sql.prepare("SELECT notes FROM bookings WHERE id='booking'").get().notes, 'First edit');
});

test('conflicting amendment rolls back dates, items, price and agreement invalidation', async t => {
  const f = await setup({ status: 'confirmed' }); t.after(() => f.db.close());
  fixture(f.db, { id: 'other', status: 'confirmed', quantity: 60 });
  const before = f.db.sql.prepare("SELECT * FROM bookings WHERE id='booking'").get();
  const response = await f.patch({ items: [{ productId: 'chair', quantity: 41 }] });
  assert.equal(response.status, 409);
  assert.deepEqual(f.db.sql.prepare("SELECT * FROM bookings WHERE id='booking'").get(), before);
  assert.equal(f.db.sql.prepare("SELECT quantity FROM booking_items WHERE booking_id='booking'").get().quantity, 40);
});

for (const status of ['cancelled', 'expired', 'completed']) test(`${status} booking cannot charge an old open link`, async t => {
  const f = await setup({ status }); t.after(() => f.db.close());
  assert.equal((await f.charge()).status, 409);
  assert.equal(f.square.charges.length, 0);
});

test('elapsed hold cannot charge even before dashboard expiry cleanup', async t => {
  const f = await setup(); t.after(() => f.db.close());
  f.db.sql.exec("UPDATE bookings SET hold_expires_at=unixepoch()-1 WHERE id='booking'");
  assert.equal((await f.charge()).status, 409);
  assert.equal(f.square.charges.length, 0);
});

test('successful payment records once and atomically confirms its held inventory', async t => {
  const f = await setup(); t.after(() => f.db.close());
  const response = await f.charge();
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  assert.equal(f.db.sql.prepare("SELECT status FROM bookings WHERE id='booking'").get().status, 'confirmed');
  assert.equal((await f.charge()).status, 409);
  assert.equal(f.square.charges.length, 1);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) AS n FROM booking_payments').get().n, 1);
});

test('database failure after charge blocks retries and reconciliation completes without another charge', async t => {
  const f = await setup(); t.after(() => f.db.close());
  f.db.failOnce = sql => sql.includes('INSERT INTO booking_payments');
  assert.equal((await f.charge()).status, 202);
  assert.equal((await f.charge()).status, 202);
  assert.equal(f.square.charges.length, 1);
  const attempt = f.db.sql.prepare('SELECT * FROM payment_attempts').get();
  assert.equal(attempt.status, 'unknown');
  assert.equal((await f.patch({ status: 'cancelled' })).status, 409);
  assert.throws(() => fixture(f.db, { id: 'competing', status: 'confirmed', quantity: 61 }), /INVENTORY_CONFLICT/);
  assert.equal((await f.action({ action: 'reconcile', attemptId: attempt.id })).status, 200);
  assert.equal(f.square.charges.length, 1);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) AS n FROM booking_payments').get().n, 1);
  assert.equal(f.db.sql.prepare("SELECT status FROM bookings WHERE id='booking'").get().status, 'confirmed');
});

test('two submissions racing around processor response produce one charge', async t => {
  const f = await setup(); t.after(() => f.db.close());
  let unblock, entered;
  const enteredPromise = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { unblock = resolve; });
  f.square.onCharge = async body => {
    entered(); await gate; f.square.onCharge = null;
    return f.square.fetch('https://connect.squareupsandbox.com/v2/payments', { method: 'POST', body: JSON.stringify(body) });
  };
  const first = f.charge(); await enteredPromise;
  assert.equal((await f.charge()).status, 202);
  unblock(); assert.equal((await first).status, 201);
  assert.equal(f.square.charges.length, 1);
});

test('definite decline unlocks the original hold and allows one new attempt', async t => {
  const f = await setup(); t.after(() => f.db.close());
  f.square.onCharge = () => Response.json({ errors: [{ code: 'CARD_DECLINED', detail: 'Declined' }] }, { status: 400 });
  assert.equal((await f.charge()).status, 402);
  assert.equal(f.db.sql.prepare('SELECT status FROM payment_attempts').get().status, 'failed');
  assert.ok(f.db.sql.prepare("SELECT hold_expires_at FROM bookings WHERE id='booking'").get().hold_expires_at > 0);
  f.square.onCharge = null;
  assert.equal((await f.charge()).status, 201);
});

test('partial and full refunds update net balance and idempotent retries do not refund twice', async t => {
  const f = await setup(); t.after(() => f.db.close());
  assert.equal((await f.charge()).status, 201);
  const payment = f.db.sql.prepare('SELECT * FROM booking_payments').get();
  const body = { action: 'refund', paymentId: payment.id, amountCents: 1500,
    reason: 'Test partial refund', refundKey: crypto.randomUUID() };
  let response = await f.action(body);
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.equal((await f.action(body)).status, 200);
  assert.equal(f.square.refunds.length, 1);
  assert.equal(f.db.sql.prepare('SELECT refunded_cents FROM booking_payments').get().refunded_cents, 1500);
  assert.equal((await f.action({ ...body, refundKey: crypto.randomUUID(), amountCents: 3000 })).status, 200);
  assert.equal(f.db.sql.prepare('SELECT status FROM booking_payments').get().status, 'refunded');
  assert.equal((await f.action({ ...body, refundKey: crypto.randomUUID(), amountCents: 1 })).status, 409);
});

test('quote idempotency returns the same confirmation fields, even when its hold uses all stock', async t => {
  const db = new TestD1(); t.after(() => db.close()); fixture(db, { id: 'seed', status: 'cancelled', quantity: 1 });
  const route = await loadRoute('functions/api/public/quote.js');
  const now = Math.floor(Date.now()/1000);
  const body = { customer: { name: 'Test Person', email: 'person@example.invalid', phone: '5550000000' },
    items: [{ productId: 'chair', quantity: 100 }], eventStartAt: now+172800,
    eventEndAt: now+194400, serviceType: 'delivery', eventCity: 'Folsom', idempotencyKey: crypto.randomUUID() };
  const post = () => route.onRequestPost({ env: { DB: db }, request: request('/api/public/quote', body) });
  const first = await post(), second = await post();
  assert.equal(first.status, 201, JSON.stringify(await first.clone().json()));
  assert.equal(second.status, 200, JSON.stringify(await second.clone().json()));
  assert.deepEqual((await first.json()).booking, (await second.json()).booking);
  const changed = await route.onRequestPost({ env: { DB: db }, request: request('/api/public/quote', { ...body, eventCity:'Cameron Park' }) });
  assert.equal(changed.status, 409);
});

async function signedWebhook(env, event, invalid = false) {
  const raw = JSON.stringify(event), url = 'https://example.invalid/api/webhooks/square';
  env.SQUARE_WEBHOOK_SIGNATURE_KEY = 'test-webhook-key'; env.SQUARE_WEBHOOK_NOTIFICATION_URL = url;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SQUARE_WEBHOOK_SIGNATURE_KEY), { name:'HMAC',hash:'SHA-256' }, false, ['sign']);
  const signature = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(url + raw))).toString('base64');
  return new Request(url, { method:'POST', headers: { 'x-square-hmacsha256-signature': invalid ? 'invalid' : signature }, body:raw });
}

test('signed payment webhook recovers an unrecorded charge and rejects forged callbacks', async t => {
  const f = await setup(); t.after(() => f.db.close());
  const webhook = await loadRoute('functions/api/webhooks/square.js', f.square.fetch);
  f.db.failOnce = sql => sql.includes('INSERT INTO booking_payments');
  assert.equal((await f.charge()).status, 202);
  const event = { event_id:'payment-event', type:'payment.updated', data:{ object:{ payment:f.square.charges[0] } } };
  assert.equal((await webhook.onRequestPost({ env:f.env, request:await signedWebhook(f.env,event,true) })).status, 403);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) AS n FROM booking_payments').get().n, 0);
  assert.equal((await webhook.onRequestPost({ env:f.env, request:await signedWebhook(f.env,event) })).status, 200);
  const duplicate = await webhook.onRequestPost({ env:f.env, request:await signedWebhook(f.env,event) });
  assert.equal((await duplicate.json()).duplicate, true);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) AS n FROM booking_payments').get().n, 1);
  assert.equal(f.square.charges.length, 1);
});

test('refund webhook arriving before payment recording reconciles both and ignores stale refund state', async t => {
  const f = await setup(); t.after(() => f.db.close());
  const webhook = await loadRoute('functions/api/webhooks/square.js', f.square.fetch);
  f.db.failOnce = sql => sql.includes('INSERT INTO booking_payments');
  assert.equal((await f.charge()).status, 202);
  const refund = { id:'external-refund', payment_id:f.square.charges[0].id, location_id:'test-location',
    amount_money:{ amount:1500,currency:'USD' }, status:'COMPLETED', reason:'Refund made in Square dashboard' };
  f.square.refunds.push(refund);
  const event = { event_id:'refund-first', type:'refund.created', data:{ object:{ refund:{ ...refund,status:'PENDING' } } } };
  let response = await webhook.onRequestPost({ env:f.env, request:await signedWebhook(f.env,event) });
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const payment = f.db.sql.prepare('SELECT * FROM booking_payments').get();
  assert.equal(payment.refunded_cents,1500); assert.equal(payment.status,'partially_refunded');
  response = await webhook.onRequestPost({ env:f.env, request:await signedWebhook(f.env,{ ...event,event_id:'late-pending' }) });
  assert.equal(response.status,200);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) AS n FROM booking_refunds').get().n,1);
  assert.equal(f.db.sql.prepare('SELECT refunded_cents FROM booking_payments').get().refunded_cents,1500);
  assert.equal(f.square.charges.length,1);
});
