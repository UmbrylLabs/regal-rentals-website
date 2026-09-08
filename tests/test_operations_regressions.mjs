import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TestD1, fixture, loadRoute, environment, request, paymentLink, squareServer } from './helpers/runtime.mjs';
import { createCustomerChoiceSigningRequest } from '../functions/_lib/agreement-v24.js';
import { notificationStatements } from '../functions/_lib/notifications.js';

const adminContext = (db, id, body, method='POST') => ({ env: environment(db), params: { id }, request: request('/admin', body, method) });

test('amending a quote carries service charges and tax through agreement, payment and balance', async t => {
  const db = new TestD1(); t.after(() => db.close()); fixture(db, { status: 'confirmed' });
  const admin = await loadRoute('functions/api/admin/bookings/[id].js');
  const staleToken = await paymentLink(db);
  const oldAgreement = await createCustomerChoiceSigningRequest({ DB: db }, 'booking', { id: 'test-owner' });
  const response = await admin.onRequestPatch(adminContext(db, 'booking', { revision: 0,
    items: [{ productId: 'chair', quantity: 40, unitPriceCents: 250 }],
    charges: [{ type: 'delivery', description: 'Delivery', amountCents: 4000 },
      { type: 'discount', description: 'Package discount', amountCents: -1000 },
      { type: 'tax', description: 'Quoted tax', amountCents: 1100 }] }, 'PATCH'));
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const booking = (await response.json()).booking;
  assert.equal(booking.subtotal_cents, 13000); assert.equal(booking.tax_cents, 1100);
  assert.equal(db.sql.prepare('SELECT status FROM payment_requests').get().status, 'cancelled');
  const sign = await loadRoute('functions/api/sign/[token].js');
  assert.equal((await sign.onRequestGet({ env: { DB: db }, params: { token: oldAgreement.token }, request: new Request('https://example.invalid/sign') })).status, 410);
  const agreement = await createCustomerChoiceSigningRequest({ DB: db }, 'booking', { id: 'test-owner' });
  const html = db.sql.prepare('SELECT agreement_html FROM signing_requests WHERE agreement_version=?').get(agreement.version).agreement_html;
  assert.match(html, /\$141\.00/); assert.match(html, /Package discount/); assert.match(html, /\$65\.00/);
  const token = await paymentLink(db, { id: 'full', amount: 14100 });
  const square = squareServer(), pay = await loadRoute('functions/api/pay/[token].js', square.fetch);
  assert.equal((await pay.onRequestPost({ env: environment(db), params: { token }, request: request('/pay', { sourceId: 'test-only', cardOnFileConsent: false }) })).status, 201);
  assert.equal(square.charges[0].amount_money.amount, 14100);
  assert.equal(db.sql.prepare("SELECT status FROM bookings WHERE id='booking'").get().status, 'paid');
  assert.equal((await pay.onRequestPost({ env: environment(db), params: { token: staleToken }, request: request('/pay', { sourceId: 'test-only' }) })).status, 409);
});

test('cash receipt retries are idempotent and cannot exceed the rental balance', async t => {
  const db = new TestD1(); t.after(() => db.close()); fixture(db);
  const route = await loadRoute('functions/api/admin/bookings/[id]/payments.js');
  const body = { action: 'record_cash', purpose: 'balance', amountCents: 9000, cashKey: crypto.randomUUID() };
  const first = await route.onRequestPost(adminContext(db, 'booking', body));
  const second = await route.onRequestPost(adminContext(db, 'booking', body));
  assert.equal(first.status, 201); assert.deepEqual(await first.json(), await second.json());
  assert.equal(db.sql.prepare('SELECT COUNT(*) AS n FROM booking_payments').get().n, 1);
  assert.equal((await route.onRequestPost(adminContext(db, 'booking', { ...body, cashKey: crypto.randomUUID(), amountCents: 1 }))).status, 409);
  assert.equal((await route.onRequestPost(adminContext(db, 'booking', { ...body, amountCents: 8000 }))).status, 409);
});

test('real signing, paid balance and security deposit gate equipment release', async t => {
  const db = new TestD1(); t.after(() => db.close()); fixture(db, { status: 'confirmed' });
  const admin = await loadRoute('functions/api/admin/bookings/[id].js');
  const payments = await loadRoute('functions/api/admin/bookings/[id]/payments.js');
  const sign = await loadRoute('functions/api/sign/[token].js');
  const change = status => admin.onRequestPatch(adminContext(db, 'booking', { status }, 'PATCH'));
  assert.equal((await change('ready')).status, 409);
  const agreement = await createCustomerChoiceSigningRequest({ DB: db }, 'booking', { id: 'test-owner' });
  const signed = await sign.onRequestPost({ env: { DB: db }, params: { token: agreement.token }, request: request('/sign', {
    consent: true, typedName: 'Test Customer', paymentSecurityMethod: 'cash', signatureStrokes: [[[10,10],[90,60],[150,30]]] }) });
  assert.equal(signed.status, 201, JSON.stringify(await signed.clone().json()));
  assert.equal((await payments.onRequestPost(adminContext(db, 'booking', { action: 'record_cash', purpose: 'balance', amountCents: 9000, cashKey: crypto.randomUUID() }))).status, 201);
  assert.equal((await change('ready')).status, 409, 'The balance alone does not satisfy the security deposit');
  assert.equal((await payments.onRequestPost(adminContext(db, 'booking', { action: 'record_cash', purpose: 'security_deposit', amountCents: 4500, cashKey: crypto.randomUUID() }))).status, 201);
  assert.equal((await change('ready')).status, 200); assert.equal((await change('out')).status, 200);
  const next = await createCustomerChoiceSigningRequest({ DB: db }, 'booking', { id: 'test-owner' });
  assert.ok(next.version > agreement.version);
  assert.equal(db.sql.prepare('SELECT agreement_ready FROM booking_release_checks').get().agreement_ready, 0);
});

test('an agreement generated against a stale booking revision is rejected', t => {
  const db = new TestD1(); t.after(() => db.close()); fixture(db, { status: 'confirmed' });
  db.sql.exec("UPDATE bookings SET revision=revision+1 WHERE id='booking'");
  assert.throws(() => db.sql.exec(`INSERT INTO signing_requests (token_hash,booking_id,signer_name,signer_email,agreement_version,agreement_html,agreement_sha256,expires_at,created_by,booking_revision)
    VALUES ('test-hash','booking','Test','test@example.invalid',1,'old terms','hash',unixepoch()+3600,'test-owner',0)`), /AGREEMENT_NOT_CURRENT/);
});

test('admin search and counts include records beyond the first 200 bookings', async t => {
  const db = new TestD1(); t.after(() => db.close());
  const now = Math.floor(Date.now()/1000);
  for (let index=0; index<215; index++) fixture(db, { id: 'old-'+index, status: 'completed', start: now - 86400*(index+1), quantity: 1 });
  for (let index=0; index<12; index++) fixture(db, { id: 'future-'+index, status: 'confirmed', start: now + 86400*(index+1), quantity: 1 });
  const route = await loadRoute('functions/api/admin/bookings/index.js');
  const get = query => route.onRequestGet({ env: { DB: db }, request: new Request('https://example.invalid/api/admin/bookings?'+query) }).then(r => r.json());
  const page = await get('group=active&limit=5');
  assert.equal(page.total, 12); assert.equal(page.bookings.length, 5);
  assert.equal(page.counts.upcoming, 12); assert.equal(page.upcoming.length, 8); assert.equal(page.counts.all, 227);
  const email = await get('group=all&q=customer%40example.invalid&offset=200&limit=50');
  assert.equal(email.total, 227); assert.equal(email.bookings.length, 27);
  const phone = await get('q=5550000000'); assert.equal(phone.total, 227);
  assert.equal((await get('q=%25')).total, 0, 'Search treats SQL wildcards literally');
});

test('homepage inquiries persist once, queue receipts, and limit repeated submissions', async t => {
  const db = new TestD1(); t.after(() => db.close());
  const route = await loadRoute('functions/api/public/inquiries.js');
  const key = crypto.randomUUID(), body = { name: 'Test inquiry', email: 'inquiry@example.invalid', details: 'Availability question' };
  const post = (id, extra={}) => route.onRequestPost({ env: { DB: db }, request: new Request('https://example.invalid/api/public/inquiries', { method: 'POST', headers: { 'Content-Type':'application/json', 'Idempotency-Key':id, 'CF-Connecting-IP':'192.0.2.1' }, body: JSON.stringify({ ...body, ...extra }) }) });
  const first = await post(key), duplicate = await post(key);
  assert.equal(first.status, 201); assert.equal(duplicate.status, 200);
  assert.equal((await first.json()).inquiryId, (await duplicate.json()).inquiryId);
  assert.equal(db.sql.prepare('SELECT COUNT(*) AS n FROM inquiries').get().n, 1);
  assert.equal(db.sql.prepare('SELECT COUNT(*) AS n FROM notification_outbox').get().n, 2);
  for (let index=0; index<4; index++) assert.equal((await post(crypto.randomUUID())).status, 201);
  assert.equal((await post(crypto.randomUUID())).status, 429);
  assert.equal((await post(key)).status, 200, 'A valid retry is not rate-limited');
  assert.equal((await post(crypto.randomUUID(), { website: 'spam' })).status, 400);
});

test('email timeout recovery uses the same provider key and pauses outside its safe retry window', async t => {
  const db = new TestD1(); t.after(() => db.close());
  const env = { DB: db, EMAIL_ENABLED: 'true', RESEND_API_KEY: 'test-only', NOTIFICATION_FROM: 'Regal <sender@example.invalid>', NOTIFICATION_STAFF_EMAIL: 'staff@example.invalid' };
  await db.batch(notificationStatements(env, { eventKey: 'test-message', email: 'staff@example.invalid', subject: 'Test receipt', text: 'Synthetic local test.' }));
  const keys = [];
  const notifications = await loadRoute('functions/_lib/notifications.js', async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails'); keys.push(options.headers['Idempotency-Key']); return Response.json({ id:'test-email' });
  });
  assert.equal((await notifications.flushNotifications({ ...env, EMAIL_ENABLED:'false' })).configured, false);
  assert.equal(keys.length, 0);
  db.failOnce = sql => sql.includes("SET status='sent'");
  await notifications.flushNotifications(env);
  db.sql.exec('UPDATE notification_outbox SET next_attempt_at=0');
  await notifications.flushNotifications(env);
  assert.equal(keys.length, 2); assert.equal(keys[0], keys[1]);
  assert.equal(db.sql.prepare('SELECT status FROM notification_outbox').get().status, 'sent');
  db.sql.exec("UPDATE notification_outbox SET status='pending',next_attempt_at=0,first_attempt_at=unixepoch()-86400");
  await notifications.flushNotifications(env);
  assert.equal(keys.length, 2); assert.equal(db.sql.prepare('SELECT status FROM notification_outbox').get().status, 'failed');
});

test('public product photos cannot expose booking files or archived products', async t => {
  const db = new TestD1(); t.after(() => db.close()); fixture(db, { status: 'cancelled' });
  const objects = new Map(), bucket = { put: async (key, bytes, metadata) => objects.set(key, { bytes, ...metadata }), get: async key => { const object = objects.get(key); return object ? { ...object, body: object.bytes } : null; } };
  const upload = await loadRoute('functions/api/admin/products/[id]/image.js');
  const view = await loadRoute('functions/api/public/product-images/[id].js');
  const env = { DB: db, BOOKING_FILES: bucket };
  const post = bytes => upload.onRequestPost({ env, params: { id:'chair' }, request: new Request('https://example.invalid/api/admin/products/chair/image?alt=White%20chair', { method:'POST', body: bytes }) });
  assert.equal((await post('<svg onload="bad()"></svg>')).status, 415);
  const bytes = new Uint8Array(32); bytes.set([137,80,78,71,13,10,26,10]);
  assert.equal((await post(bytes)).status, 200);
  const get = () => view.onRequestGet({ env, params: { id:'chair' }, request:new Request('https://example.invalid/api/public/product-images/chair') });
  const response = await get(); assert.equal(response.status, 200); assert.equal(response.headers.get('Content-Type'), 'image/png');
  const validKey = db.sql.prepare("SELECT image_key FROM products WHERE id='chair'").get().image_key;
  db.sql.exec("UPDATE products SET image_key='bookings/booking/private.jpg' WHERE id='chair'");
  assert.equal((await get()).status, 404);
  db.sql.prepare("UPDATE products SET image_key=? WHERE id='chair'").run(validKey);
  db.sql.exec("UPDATE products SET active=0 WHERE id='chair'");
  assert.equal((await get()).status, 404);
});
