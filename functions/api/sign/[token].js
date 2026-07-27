import {
  cleanText,
  clientIp,
  json,
  randomId,
  readJson,
  safeErrorResponse,
  sha256
} from '../../_lib/http.js';

function normalizeStrokes(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new Error('INVALID_SIGNATURE');
  }
  let points = 0;
  return value.map((stroke) => {
    if (!Array.isArray(stroke) || stroke.length < 2 || stroke.length > 2000) {
      throw new Error('INVALID_SIGNATURE');
    }
    return stroke.map((point) => {
      points += 1;
      if (points > 5000 || !Array.isArray(point) || point.length !== 2) {
        throw new Error('INVALID_SIGNATURE');
      }
      const x = Number(point[0]);
      const y = Number(point[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 600 || y < 0 || y > 200) {
        throw new Error('INVALID_SIGNATURE');
      }
      return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
    });
  });
}

function strokesToSvg(strokes) {
  const paths = strokes.map((stroke) => {
    const [first, ...rest] = stroke;
    const data = [`M ${first[0]} ${first[1]}`]
      .concat(rest.map((point) => `L ${point[0]} ${point[1]}`))
      .join(' ');
    return `<path d="${data}" fill="none" stroke="#24192c" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200" viewBox="0 0 600 200" role="img" aria-label="Electronic signature">${paths}</svg>`;
}

function agreementSecurity(html) {
  const source = String(html || '');
  const depositMatch = source.match(/data-security-deposit-cents="(\d+)"/);
  return {
    required: /data-customer-security-choice="required"/.test(source),
    depositCents: depositMatch ? Number(depositMatch[1]) : 0
  };
}

function selectedSecurity(consentText) {
  const match = String(consentText || '').match(/\[PAYMENT_SECURITY:(credit_card|debit_card|cash|card_on_file|security_deposit):(\d+)\]/);
  return match ? { method: match[1], depositCents: Number(match[2]) } : { method: null, depositCents: 0 };
}

function securityDescription(method, depositCents) {
  const amount = (Number(depositCents) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  if (method === 'credit_card' || method === 'card_on_file') return 'Credit Card — no refundable deposit; card securely stored on file';
  if (method === 'debit_card') return `Debit Card — Refundable Security Deposit (${amount})`;
  if (method === 'cash') return `Cash — Refundable Security Deposit (${amount})`;
  if (method === 'security_deposit') return `Refundable Security Deposit (${amount})`;
  return '';
}

function applicableDeposit(method, calculatedDepositCents) {
  return ['debit_card', 'cash', 'security_deposit'].includes(method) ? Number(calculatedDepositCents) : 0;
}

async function lookup(env, token) {
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT
       sr.token_hash, sr.booking_id, sr.signer_name, sr.signer_email,
       sr.agreement_version, sr.agreement_html, sr.agreement_sha256,
       sr.expires_at, sr.viewed_at, sr.signed_at, sr.voided_at,
       b.booking_number, b.status,
       s.typed_name AS signed_typed_name,
       s.signature_svg,
       s.consent_text,
       s.evidence_sha256
     FROM signing_requests sr
     JOIN bookings b ON b.id = sr.booking_id
     LEFT JOIN signatures s ON s.signing_token_hash = sr.token_hash
     WHERE sr.token_hash = ?1`
  ).bind(tokenHash).first();
  return { tokenHash, row };
}

export async function onRequestGet(context) {
  try {
    const token = cleanText(context.params.token, 200);
    const { tokenHash, row } = await lookup(context.env, token);
    if (!row) {
      return json({ ok: false, error: { code: 'NOT_FOUND', message: 'Signing request not found.' } }, 404);
    }
    const now = Math.floor(Date.now() / 1000);
    if (row.voided_at) {
      return json({ ok: false, error: { code: 'VOIDED', message: 'This agreement has been voided.' } }, 410);
    }
    if (Number(row.expires_at) <= now && !row.signed_at) {
      return json({ ok: false, error: { code: 'EXPIRED', message: 'This signing link has expired.' } }, 410);
    }

    if (!row.viewed_at) {
      await context.env.DB.prepare(
        'UPDATE signing_requests SET viewed_at = ?1 WHERE token_hash = ?2 AND viewed_at IS NULL'
      ).bind(now, tokenHash).run();
    }

    const requiredSecurity = agreementSecurity(row.agreement_html);
    const signedSecurity = selectedSecurity(row.consent_text);
    return json({
      ok: true,
      agreement: {
        bookingNumber: row.booking_number,
        signerName: row.signer_name,
        signerEmail: row.signer_email,
        version: Number(row.agreement_version),
        html: row.agreement_html,
        sha256: row.agreement_sha256,
        expiresAt: Number(row.expires_at),
        signedAt: row.signed_at == null ? null : Number(row.signed_at),
        paymentSecurity: {
          required: requiredSecurity.required,
          depositCents: requiredSecurity.depositCents,
          selectedMethod: signedSecurity.method
        },
        signature: row.signed_at ? {
          typedName: row.signed_typed_name,
          svg: row.signature_svg,
          consentText: row.consent_text,
          evidenceSha256: row.evidence_sha256
        } : null
      }
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function onRequestPost(context) {
  try {
    const token = cleanText(context.params.token, 200);
    const { tokenHash, row } = await lookup(context.env, token);
    if (!row) {
      return json({ ok: false, error: { code: 'NOT_FOUND', message: 'Signing request not found.' } }, 404);
    }
    const now = Math.floor(Date.now() / 1000);
    if (row.voided_at) {
      return json({ ok: false, error: { code: 'VOIDED', message: 'This agreement has been voided.' } }, 410);
    }
    if (row.signed_at) {
      return json({ ok: false, error: { code: 'ALREADY_SIGNED', message: 'This agreement has already been signed.' } }, 409);
    }
    if (Number(row.expires_at) <= now) {
      return json({ ok: false, error: { code: 'EXPIRED', message: 'This signing link has expired.' } }, 410);
    }

    const body = await readJson(context.request, 250_000);
    if (body.consent !== true) {
      return json({ ok: false, error: { code: 'CONSENT_REQUIRED', message: 'Electronic signature consent is required.' } }, 400);
    }
    const typedName = cleanText(body.typedName, 150);
    if (typedName.length < 2) {
      return json({ ok: false, error: { code: 'NAME_REQUIRED', message: 'Enter your legal name.' } }, 400);
    }

    const requiredSecurity = agreementSecurity(row.agreement_html);
    const requestedMethod = cleanText(body.paymentSecurityMethod, 40);
    const validMethod = ['credit_card', 'debit_card', 'cash', 'card_on_file', 'security_deposit'].includes(requestedMethod)
      ? requestedMethod
      : null;
    if (requiredSecurity.required && !validMethod) {
      return json({
        ok: false,
        error: { code: 'PAYMENT_SECURITY_REQUIRED', message: 'Choose Credit Card, Debit Card, or Cash.' }
      }, 400);
    }

    const depositCents = validMethod ? applicableDeposit(validMethod, requiredSecurity.depositCents) : 0;
    const strokes = normalizeStrokes(body.signatureStrokes);
    const signatureSvg = strokesToSvg(strokes);
    const securityText = validMethod
      ? ` Payment method and security selected: ${securityDescription(validMethod, depositCents)}. [PAYMENT_SECURITY:${validMethod}:${depositCents}]`
      : '';
    const consentText = `I reviewed this agreement, consent to conduct this transaction electronically, and intend my electronic signature to be legally binding.${securityText}`;
    const ip = clientIp(context.request);
    const userAgent = String(context.request.headers.get('user-agent') || '').slice(0, 500);
    const evidenceSha256 = await sha256(JSON.stringify({
      agreementSha256: row.agreement_sha256,
      bookingId: row.booking_id,
      agreementVersion: row.agreement_version,
      typedName,
      signatureSvg,
      consentText,
      paymentSecurityMethod: validMethod,
      securityDepositCents: depositCents,
      signedAt: now,
      ip,
      userAgent
    }));

    try {
      await context.env.DB.batch([
        context.env.DB.prepare(
          `UPDATE signing_requests
           SET signed_at = ?1
           WHERE token_hash = ?2
             AND signed_at IS NULL
             AND voided_at IS NULL
             AND expires_at > ?1`
        ).bind(now, tokenHash),
        context.env.DB.prepare(
          `INSERT INTO signatures (
             id, signing_token_hash, typed_name, signature_svg, consent_text,
             signer_ip, user_agent, signed_at, evidence_sha256
           ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
        ).bind(
          randomId(),
          tokenHash,
          typedName,
          signatureSvg,
          consentText,
          ip,
          userAgent,
          now,
          evidenceSha256
        ),
        context.env.DB.prepare(
          `INSERT INTO audit_log (
             id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at
           ) VALUES (?1, NULL, 'agreement.sign', 'booking', ?2, ?3, ?4)`
        ).bind(
          randomId(),
          row.booking_id,
          JSON.stringify({
            agreementVersion: Number(row.agreement_version),
            agreementSha256: row.agreement_sha256,
            evidenceSha256,
            signerEmail: row.signer_email,
            paymentSecurityMethod: validMethod,
            securityDepositCents: depositCents
          }),
          now
        )
      ]);
    } catch (error) {
      if (String(error?.message || '').toLowerCase().includes('unique')) {
        return json({ ok: false, error: { code: 'ALREADY_SIGNED', message: 'This agreement has already been signed.' } }, 409);
      }
      throw error;
    }

    return json({
      ok: true,
      signedAt: now,
      evidenceSha256,
      signatureSvg,
      typedName,
      paymentSecurityMethod: validMethod,
      securityDepositCents: depositCents,
      message: 'Agreement signed successfully.'
    }, 201);
  } catch (error) {
    if (String(error?.message) === 'INVALID_SIGNATURE') {
      return json({ ok: false, error: { code: 'INVALID_SIGNATURE', message: 'Please draw your signature again.' } }, 400);
    }
    return safeErrorResponse(error);
  }
}
