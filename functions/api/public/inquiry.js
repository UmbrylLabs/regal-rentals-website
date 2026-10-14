import { assertSameOrigin, clientIp, json, normalizeEmail, randomId, readJson, safeErrorResponse, sha256 } from '../../_lib/http.js';
import { ensureInquiryTables } from '../../_lib/inquiries.js';
import { regalReference } from '../../_lib/reference.js';
import { ensureStorefrontTables, availableProducts, availablePackages } from '../../_lib/storefront.js';

const VALID_ITEMS = new Set([
  'White folding chairs', '60-inch round tables', '6-foot rectangle tables',
  '10x10 canopy', '10x20 canopy'
]);
const VALID_PACKAGES = new Set(['','Backyard Essentials','Party Ready','Shade & Serve','Custom rental']);
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const PREFERRED_TIME_RE = /^(?:0[8-9]|1[0-8]):00$/;

function preferredTimeLabel(value) {
  if (!value) return 'Flexible / Any time';
  const hour = Number(value.slice(0,2));
  return String(hour % 12 || 12) + ':00 ' + (hour < 12 ? 'AM' : 'PM');
}

function text(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function invalid(message) {
  return json({ ok: false, error: { code: 'VALIDATION_ERROR', message } }, 400);
}

async function sendNotification(context, lead) {
  const token = context.env.RESEND_API_KEY;
  if (!token) return; // Inquiry remains safely saved and visible in private admin.
  const body = [
    'New Regal Rentals quote request: ' + lead.reference,
    '',
    'Name: ' + lead.name,
    'Email: ' + lead.email,
    'Phone: ' + (lead.phone || 'Not provided'),
    (lead.has_rental_window ? 'Rental start: ' : 'Event date: ') + lead.event_date,
    'City: ' + lead.event_city,
    'Package: ' + (lead.package_name || 'Not selected'),
    'Equipment: ' + (lead.items.join(', ') || 'Not specified'),
    '',
    'Customer details:',
    lead.details || 'Not provided',
    '',
    'Review and reply from the private Regal Rentals Admin → Website Inquiries.'
  ].join('\n');
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: context.env.REGAL_FROM_EMAIL || 'Regal Rentals <notifications@regal.rentals>',
        to: [context.env.REGAL_NOTIFY_EMAIL || 'bookings@regal.rentals'],
        reply_to: lead.email,
        subject: 'New rental inquiry ' + lead.reference + ' · ' + lead.event_date,
        text: body
      })
    });
    if (!res.ok) {
      console.error('Quote notification email failed', res.status);
      return;
    }
    await context.env.DB.prepare('UPDATE website_inquiries SET email_sent = 1 WHERE id = ?1')
      .bind(lead.id).run();
  } catch (err) {
    console.error('Quote notification transport failed:', String(err?.message || 'unknown').slice(0, 120));
  }
}

export async function onRequestPost(context) {
  try {
    assertSameOrigin(context.request);
    if (!context.env.DB) {
      return json({ ok:false, error:{code:'NOT_READY', message:'Our online quote service is temporarily unavailable.'} },503);
    }
    const body = await readJson(context.request, 15000);
    // Common invisible bot trap. No side effects or notifications.
    if (body.website) return invalid('Please check the form and try again.');
    const name = text(body.name,120);
    const email = normalizeEmail(body.email);
    const phone = text(body.phone,35);
    const eventDate = text(body.date,10);
    const hasRentalWindow=['endDate','delivery','customerPickup','setup','teardown','deliveryAddress']
      .some(key=>Object.prototype.hasOwnProperty.call(body,key));
    const endDate = text(body.endDate,10);
    const startTime = typeof body.startTime === 'string' ? body.startTime.trim() : '';
    const endTime = typeof body.endTime === 'string' ? body.endTime.trim() : '';
    const deliveryAddress = text(body.deliveryAddress,240);
    const delivery = body.delivery === true;
    const customerPickup = body.customerPickup === true;
    const setup = body.setup === true;
    const teardown = body.teardown === true;
    const city = text(body.city,120);
    const packageName = text(body.package,80);
    const details = text(body.details,2500);
    let items = Array.isArray(body.items) ? [...new Set(body.items)] : [];
    const packageId = typeof body.packageId === 'string' ? body.packageId : '';
    const selectedItems = Array.isArray(body.selectedItems) ? body.selectedItems : [];
    let verifiedPackageName = packageName;

    if (name.length < 2) return invalid('Please enter your name.');
    if (email.length > 180 || !EMAIL_RE.test(email)) return invalid('Please enter a valid email address.');
    if (city.length < 2) return invalid('Please enter the event city.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)
      || !Number.isFinite(Date.parse(eventDate + 'T12:00:00Z'))
      || new Date(eventDate+'T12:00:00Z').toISOString().slice(0,10) !== eventDate) {
      return invalid('Please enter a valid event date.');
    }
    if (hasRentalWindow) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)
        || !Number.isFinite(Date.parse(endDate+'T12:00:00Z'))
        || new Date(endDate+'T12:00:00Z').toISOString().slice(0,10) !== endDate) {
        return invalid('Please select a valid rental end date.');
      }
      if (endDate < eventDate) return invalid('Rental end date must be on or after the start date.');
      if ((body.startTime !== undefined && typeof body.startTime !== 'string')
        || (body.endTime !== undefined && typeof body.endTime !== 'string')
        || (startTime && !PREFERRED_TIME_RE.test(startTime))
        || (endTime && !PREFERRED_TIME_RE.test(endTime))) {
        return invalid('Please choose valid preferred rental times.');
      }
      if (eventDate === endDate && startTime && endTime && endTime <= startTime) {
        return invalid('For a same-day rental, the preferred end time must be later than the start time.');
      }
      if (typeof body.delivery !== 'boolean' || typeof body.setup !== 'boolean'
        || typeof body.teardown !== 'boolean') {
        return invalid('Please select valid delivery and setup options.');
      }
      // Current storefront explicitly sends a customer-pickup flag; require
      // exactly one fulfillment choice, even for crafted HTTP requests.
      // Older clients without this field retain the prior delivery=false mode.
      if (Object.prototype.hasOwnProperty.call(body,'customerPickup')) {
        if (typeof body.customerPickup !== 'boolean' || delivery === customerPickup) {
          return invalid('Please choose either delivery or customer pickup, not both.');
        }
      }
      if ((setup || teardown) && !delivery) {
        return invalid('Delivery & collection is required for setup or teardown.');
      }
      if (body.deliveryAddress !== undefined && typeof body.deliveryAddress !== 'string') {
        return invalid('Please enter a valid delivery location.');
      }
    }
    if (!packageId && !VALID_PACKAGES.has(packageName)) return invalid('Choose a valid package.');
    if (items.length > 5 || items.some(value => !VALID_ITEMS.has(value))) return invalid('Select valid rental equipment.');

    if (selectedItems.length || packageId) {
      if (selectedItems.length > 30 || !Array.isArray(selectedItems)) return invalid('Please check the selected equipment.');
      await ensureStorefrontTables(context.env.DB);
      const [products, packages] = await Promise.all([
        availableProducts(context.env.DB), availablePackages(context.env.DB)
      ]);
      const productMap = new Map(products.filter(p => p.quantityOwned > 0).map(p => [p.id,p]));
      let verifiedPackage = null;
      if (packageId) {
        verifiedPackage = packages.find(pkg => pkg.active && pkg.id === packageId);
        if (!verifiedPackage || !verifiedPackage.items.every(line => productMap.has(line.productId) && Number.isInteger(line.quantity) && line.quantity > 0 && line.quantity <= 1000000)) {
          return invalid('That package is no longer available. Please refresh the page.');
        }
        verifiedPackageName = verifiedPackage.name;
      }
      const chosen = selectedItems.length ? selectedItems : (verifiedPackage?.items || []);
      const ids = new Set();
      const labels = [];
      for (const item of chosen) {
        const product = item && productMap.get(item.productId);
        const quantity = Number(item?.quantity);
        if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 1000000 || ids.has(item.productId)) {
          return invalid('Choose an active rental item and a positive whole-number quantity.');
        }
        ids.add(item.productId);
        labels.push(String(quantity) + ' × ' + product.name);
      }
      items = labels;
    }
    // Do not save an empty quote that the owner cannot turn into a rental.
    if (!items.length) return invalid('Please select at least one rental item or package.');
    await ensureInquiryTables(context.env.DB);

    // Limit repeat requests before writing PII. The full IP is never stored.
    const hash = await sha256((clientIp(context.request) || 'unknown') + '|' + (context.env.IP_HASH_PEPPER || 'regal-inquiry'));
    const bucket = Math.floor(Date.now() / 3600000);
    const rate = await context.env.DB.prepare(
      'INSERT INTO website_inquiry_rate(ip_hash,hour_bucket,submissions) VALUES (?1,?2,1) ' +
      'ON CONFLICT(ip_hash,hour_bucket) DO UPDATE SET submissions=submissions+1 WHERE submissions<6'
    ).bind(hash,bucket).run();
    if (!rate.meta?.changes) return json({ok:false,error:{code:'RATE_LIMIT',message:'Too many requests. Please try again later.'}},429);

    const id = randomId();
    const reference = regalReference(id);
    // Store rental logistics alongside notes so existing D1 databases and admin views
    // display every requested service without waiting on a schema migration.
    const storedDetails = hasRentalWindow ? [
      'RENTAL DATES & SERVICES',
      'Rental start ('+(delivery?'Regal delivery':'customer pickup')+'): '+eventDate,
      'Preferred '+(delivery?'delivery':'customer pickup')+' time: '+preferredTimeLabel(startTime),
      'Rental end ('+(delivery?'Regal collection':'customer return')+'): '+endDate,
      'Preferred '+(delivery?'collection':'return')+' time: '+preferredTimeLabel(endTime),
      'Delivery & pickup by Regal Rentals: '+(delivery?'Requested':'No — customer pickup and return requested'),
      ...(setup===teardown
        ? ['Equipment setup & teardown: '+(setup?'Requested':'Not requested')]
        : ['Equipment setup: '+(setup?'Requested':'Not requested'),
           'Equipment teardown: '+(teardown?'Requested':'Not requested')]),
      ...(delivery && deliveryAddress?['Delivery address / venue: '+deliveryAddress]:[]),
      '',
      'EVENT DETAILS',
      details || 'Not provided'
    ].join('\n') : details;
    const lead = {id,reference,name,email,phone,event_date:eventDate,event_city:city,package_name:verifiedPackageName,items,details:storedDetails,has_rental_window:hasRentalWindow};
    await context.env.DB.prepare(
      'INSERT INTO website_inquiries (id, reference, name, email, phone, event_date, event_city, package_name, items_json, details) ' +
      'VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)'
    ).bind(id,reference,name,email,phone,eventDate,city,verifiedPackageName,JSON.stringify(items),storedDetails).run();

    // Notification is best-effort. The saved inquiry is the source of truth.
    if (context.env.RESEND_API_KEY) context.waitUntil(sendNotification(context,lead));
    return json({ok:true,reference,message:'Your request was received. We will follow up by email.'},201);
  } catch(err) {
    return safeErrorResponse(err);
  }
}
