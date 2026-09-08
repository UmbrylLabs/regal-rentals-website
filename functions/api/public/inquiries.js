import { assertSameOrigin, cleanText, json, normalizeEmail, randomId, readJson, safeErrorResponse, sha256 } from '../../_lib/http.js';
import { limitPublicSubmission } from '../../_lib/public-submissions.js';
import { notificationStatements, scheduleNotifications } from '../../_lib/notifications.js';

export async function onRequestPost(context) {
  try {
    assertSameOrigin(context.request);
    const body = await readJson(context.request, 12000);
    if (body.website) throw new Error('INVALID_INQUIRY');
    const key = cleanText(context.request.headers.get('Idempotency-Key'), 100);
    const name = cleanText(body.name, 150), email = normalizeEmail(body.email);
    const phone = cleanText(body.phone, 50), date = cleanText(body.date, 10);
    const city = cleanText(body.city, 150), eventType = cleanText(body.eventType, 150), details = cleanText(body.details, 4000);
    if (!/^[a-zA-Z0-9_-]{16,100}$/.test(key) || name.length < 2 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      || (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))))) throw new Error('INVALID_INQUIRY');
    const requestKey = await sha256(key + ':' + email);
    const existing = await context.env.DB.prepare('SELECT id FROM inquiries WHERE request_key=?1').bind(requestKey).first();
    if (existing) return json({ ok: true, inquiryId: existing.id, duplicate: true });
    await limitPublicSubmission(context.env, context.request, email, 'inquiry');
    const id = randomId();
    try {
      await context.env.DB.batch([
        context.env.DB.prepare(`INSERT INTO inquiries (id,request_key,name,email,phone,event_date,event_city,event_type,details)
          VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`).bind(id, requestKey, name, email, phone, date, city, eventType, details),
        ...notificationStatements(context.env, { eventKey: 'inquiry:' + id, email, subject: 'Regal Rentals inquiry received',
          text: `We received your inquiry. Reference: ${id}\nName: ${name}\nEvent: ${date || 'Date to be arranged'} · ${city}\nType: ${eventType}\n\n${details}\n\nAn inquiry does not reserve equipment. Regal Rentals will follow up. For live availability and a rental request, visit https://regal.rentals/rentals.` })
      ]);
    } catch (error) {
      const duplicate = await context.env.DB.prepare('SELECT id FROM inquiries WHERE request_key=?1').bind(requestKey).first();
      if (duplicate) return json({ ok: true, inquiryId: duplicate.id, duplicate: true });
      throw error;
    }
    scheduleNotifications(context);
    return json({ ok: true, inquiryId: id }, 201);
  } catch (error) { return safeErrorResponse(error); }
}
