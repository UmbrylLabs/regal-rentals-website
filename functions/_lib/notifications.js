import { randomId } from './http.js';

export const notificationsConfigured = env => env.EMAIL_ENABLED === 'true' && Boolean(env.RESEND_API_KEY && env.NOTIFICATION_FROM && env.NOTIFICATION_STAFF_EMAIL);

export function notificationStatements(env, { eventKey, bookingId = null, email, subject, text }) {
  const recipients = new Set([email, env.NOTIFICATION_STAFF_EMAIL || 'bookings@regal.rentals']);
  return [...recipients].map(recipient => env.DB.prepare(`INSERT INTO notification_outbox
    (id,event_key,booking_id,recipient,subject,body_text) VALUES (?1,?2,?3,?4,?5,?6)
    ON CONFLICT(event_key) DO NOTHING`).bind(randomId(), `${eventKey}:${recipient}`, bookingId, recipient, subject, text));
}

export async function flushNotifications(env, limit = 10) {
  if (!notificationsConfigured(env)) return { configured: false, accepted: 0 };
  const now = Math.floor(Date.now() / 1000);
  // Resend retains idempotency keys for 24 hours. Never retry an uncertain
  // delivery beyond that window, or send stale pre-launch receipts later.
  await env.DB.prepare(`UPDATE notification_outbox SET status='failed',
    last_error='Delivery needs review: check provider logs before sending again.'
    WHERE status IN ('pending','sending') AND ((first_attempt_at IS NOT NULL AND first_attempt_at < ?1)
      OR (first_attempt_at IS NULL AND created_at < ?2))`).bind(now - 23 * 3600, now - 86400).run();
  const rows = await env.DB.prepare(`SELECT id FROM notification_outbox WHERE
    (status='pending' AND next_attempt_at <= ?1) OR (status='sending' AND lease_until < ?1)
    ORDER BY created_at LIMIT ?2`).bind(now, Math.min(20, limit)).all();
  let accepted = 0;
  for (const { id } of rows.results || []) {
    const row = await env.DB.prepare(`UPDATE notification_outbox SET status='sending', attempts=attempts+1,
      lease_until=?2, first_attempt_at=COALESCE(first_attempt_at,?1), sender=COALESCE(sender,?3)
      WHERE id=?4 AND ((status='pending' AND next_attempt_at<=?1) OR (status='sending' AND lease_until<?1))
      RETURNING *`).bind(now, now + 120, env.NOTIFICATION_FROM, id).first();
    if (!row) continue;
    try {
      const response = await fetch('https://api.resend.com/emails', { method: 'POST',
        signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `regal-${row.id}` },
        body: JSON.stringify({ from: row.sender, to: [row.recipient], subject: row.subject, text: row.body_text }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.id) throw new Error('EMAIL_PROVIDER_' + response.status);
      await env.DB.prepare(`UPDATE notification_outbox SET status='sent', provider_id=?1, sent_at=unixepoch(),
        lease_until=NULL,last_error=NULL WHERE id=?2`).bind(result.id, row.id).run();
      accepted++;
    } catch (error) {
      await env.DB.prepare(`UPDATE notification_outbox SET status='pending', lease_until=NULL,
        next_attempt_at=?1, last_error=?2 WHERE id=?3 AND status='sending'`)
        .bind(now + Math.min(3600, 60 * 2 ** Math.min(row.attempts, 5)), 'Delivery not confirmed; queued for another check.', row.id).run();
    }
  }
  return { configured: true, accepted };
}

export function scheduleNotifications(context) {
  if (notificationsConfigured(context.env) && context.waitUntil) {
    context.waitUntil(flushNotifications(context.env).catch(error => console.error('Notification queue needs review', error?.message)));
  }
}
