import { protectMutation, requireAdmin } from '../../_lib/auth.js';
import { cleanText, json, randomId, readJson, safeErrorResponse } from '../../_lib/http.js';

export async function onRequestGet(context) {
  try {
    await requireAdmin(context.env, context.request);
    const result = await context.env.DB.prepare(
      `SELECT id, sku, name, category, quantity_owned, price_cents, active, updated_at
       FROM products ORDER BY category, name`
    ).all();
    return json({ ok: true, products: result.results || [] });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function onRequestPatch(context) {
  try {
    protectMutation(context.request);
    const user = await requireAdmin(context.env, context.request);
    const body = await readJson(context.request);
    const id = cleanText(body.id, 80);
    const existing = await context.env.DB.prepare(
      'SELECT * FROM products WHERE id = ?1'
    ).bind(id).first();
    if (!existing) {
      return json({ ok: false, error: { code: 'NOT_FOUND', message: 'Product not found.' } }, 404);
    }

    const quantity = Number(body.quantityOwned ?? existing.quantity_owned);
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 100000) {
      return json({ ok: false, error: { code: 'INVALID_QUANTITY', message: 'Enter a valid inventory quantity.' } }, 400);
    }
    const active = body.active == null ? Number(existing.active) : (body.active ? 1 : 0);
    const priceCents = body.priceCents === undefined
      ? existing.price_cents
      : (body.priceCents === null ? null : Number(body.priceCents));
    if (priceCents !== null && (!Number.isInteger(priceCents) || priceCents < 0)) {
      return json({ ok: false, error: { code: 'INVALID_PRICE', message: 'Enter a valid price.' } }, 400);
    }

    const now = Math.floor(Date.now() / 1000);
    await context.env.DB.batch([
      context.env.DB.prepare(
        `UPDATE products SET
           name = ?1, category = ?2, quantity_owned = ?3,
           price_cents = ?4, active = ?5, updated_at = ?6
         WHERE id = ?7`
      ).bind(
        cleanText(body.name ?? existing.name, 200),
        cleanText(body.category ?? existing.category, 100),
        quantity,
        priceCents,
        active,
        now,
        id
      ),
      context.env.DB.prepare(
        `INSERT INTO audit_log (
          id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at
        ) VALUES (?1, ?2, 'product.update', 'product', ?3, ?4, ?5)`
      ).bind(
        randomId(),
        user.id,
        id,
        JSON.stringify({ quantityOwned: quantity, priceCents, active }),
        now
      )
    ]);

    return json({ ok: true });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
