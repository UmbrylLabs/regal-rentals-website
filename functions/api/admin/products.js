import { protectMutation, requireAdmin } from '../../_lib/auth.js';
import { cleanText, json, randomId, readJson, safeErrorResponse } from '../../_lib/http.js';

const CATEGORIES = new Set([
  'Tables & Chairs',
  'Tents & Shade',
  'Backyard Games',
  'Mini Golf',
  'Photo Booths & Guestbooks',
  'Audio & Visual',
  'Decor & Event Extras',
  'Other'
]);

const STYLES = new Set([
  'round-table', 'rectangle-table', 'chair', 'canopy', 'tent', 'game',
  'mini-golf', 'photo-booth', 'audio', 'visual', 'lighting', 'decor', 'other'
]);

const PRICE_UNITS = new Set([
  'each', 'per chair', 'per table', 'per canopy', 'per tent',
  'per game', 'per set', 'per package', 'per event'
]);

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'rental-item';
}

function normalizeProduct(body, existing = {}) {
  const name = cleanText(body.name ?? existing.name, 200);
  const category = cleanText(body.category ?? existing.category, 100);
  const style = cleanText(body.style ?? existing.style ?? 'other', 50).toLowerCase();
  const description = cleanText(body.description ?? existing.description ?? '', 1000);
  const priceUnit = cleanText(body.priceUnit ?? existing.price_unit ?? 'each', 50).toLowerCase();
  const quantityOwned = Number(body.quantityOwned ?? existing.quantity_owned ?? 0);
  const sortOrder = Number(body.sortOrder ?? existing.sort_order ?? 100);
  const active = body.active == null ? Number(existing.active ?? 1) : (body.active ? 1 : 0);
  const rawPrice = body.priceCents === undefined ? existing.price_cents : body.priceCents;
  const priceCents = rawPrice === null || rawPrice === '' ? null : Number(rawPrice);

  if (name.length < 2) throw new Error('INVALID_PRODUCT_NAME');
  if (!CATEGORIES.has(category)) throw new Error('INVALID_CATEGORY');
  if (!STYLES.has(style)) throw new Error('INVALID_STYLE');
  if (!PRICE_UNITS.has(priceUnit)) throw new Error('INVALID_PRICE_UNIT');
  if (!Number.isInteger(quantityOwned) || quantityOwned < 0 || quantityOwned > 100000) throw new Error('INVALID_QUANTITY');
  if (priceCents !== null && (!Number.isInteger(priceCents) || priceCents < 0 || priceCents > 100000000)) throw new Error('INVALID_PRICE');
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 100000) throw new Error('INVALID_SORT_ORDER');

  return { name, category, style, description, priceUnit, quantityOwned, priceCents, sortOrder, active };
}

function validationResponse(error) {
  const code = String(error?.message || '');
  const messages = {
    INVALID_PRODUCT_NAME: 'Enter an item name.',
    INVALID_CATEGORY: 'Choose a valid category.',
    INVALID_STYLE: 'Choose a valid item style.',
    INVALID_PRICE_UNIT: 'Choose a valid pricing unit.',
    INVALID_QUANTITY: 'Enter a valid owned quantity.',
    INVALID_PRICE: 'Enter a valid rental price.',
    INVALID_SORT_ORDER: 'Enter a valid display order.'
  };
  return messages[code]
    ? json({ ok: false, error: { code, message: messages[code] } }, 400)
    : null;
}

export async function onRequestGet(context) {
  try {
    await requireAdmin(context.env, context.request);
    const result = await context.env.DB.prepare(
      `SELECT id, sku, name, category, style, description, price_unit,
              quantity_owned, price_cents, active, sort_order, updated_at
       FROM products
       ORDER BY active DESC, category, sort_order, name`
    ).all();
    return json({ ok: true, products: result.results || [] });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function onRequestPost(context) {
  try {
    protectMutation(context.request);
    const user = await requireAdmin(context.env, context.request);
    const body = await readJson(context.request);
    const product = normalizeProduct(body);
    const id = `${slugify(product.name)}-${randomId().slice(0, 8)}`;
    const requestedSku = cleanText(body.sku, 80).toUpperCase().replace(/[^A-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    const sku = requestedSku || `${slugify(product.name).replaceAll('-', '_').toUpperCase()}_${id.slice(-6).toUpperCase()}`;
    const now = Math.floor(Date.now() / 1000);

    await context.env.DB.batch([
      context.env.DB.prepare(
        `INSERT INTO products (
          id, sku, name, category, style, description, price_unit,
          quantity_owned, price_cents, active, sort_order, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)`
      ).bind(
        id, sku, product.name, product.category, product.style, product.description,
        product.priceUnit, product.quantityOwned, product.priceCents, product.active,
        product.sortOrder, now
      ),
      context.env.DB.prepare(
        `INSERT INTO audit_log (
          id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at
        ) VALUES (?1, ?2, 'product.create', 'product', ?3, ?4, ?5)`
      ).bind(randomId(), user.id, id, JSON.stringify({ sku, ...product }), now)
    ]);

    return json({ ok: true, product: { id, sku, ...product } }, 201);
  } catch (error) {
    const validation = validationResponse(error);
    if (validation) return validation;
    if (String(error?.message || '').toLowerCase().includes('unique')) {
      return json({ ok: false, error: { code: 'SKU_EXISTS', message: 'That SKU is already in use.' } }, 409);
    }
    return safeErrorResponse(error);
  }
}

export async function onRequestPatch(context) {
  try {
    protectMutation(context.request);
    const user = await requireAdmin(context.env, context.request);
    const body = await readJson(context.request);
    const id = cleanText(body.id, 80);
    const existing = await context.env.DB.prepare('SELECT * FROM products WHERE id = ?1').bind(id).first();
    if (!existing) return json({ ok: false, error: { code: 'NOT_FOUND', message: 'Product not found.' } }, 404);

    const product = normalizeProduct(body, existing);
    const skuInput = body.sku === undefined
      ? existing.sku
      : cleanText(body.sku, 80).toUpperCase().replace(/[^A-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    if (!skuInput) return json({ ok: false, error: { code: 'INVALID_SKU', message: 'Enter a valid SKU.' } }, 400);
    const now = Math.floor(Date.now() / 1000);

    await context.env.DB.batch([
      context.env.DB.prepare(
        `UPDATE products SET
           sku = ?1, name = ?2, category = ?3, style = ?4, description = ?5,
           price_unit = ?6, quantity_owned = ?7, price_cents = ?8,
           active = ?9, sort_order = ?10, updated_at = ?11
         WHERE id = ?12`
      ).bind(
        skuInput, product.name, product.category, product.style, product.description,
        product.priceUnit, product.quantityOwned, product.priceCents, product.active,
        product.sortOrder, now, id
      ),
      context.env.DB.prepare(
        `INSERT INTO audit_log (
          id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at
        ) VALUES (?1, ?2, 'product.update', 'product', ?3, ?4, ?5)`
      ).bind(randomId(), user.id, id, JSON.stringify({ sku: skuInput, ...product }), now)
    ]);

    return json({ ok: true });
  } catch (error) {
    const validation = validationResponse(error);
    if (validation) return validation;
    const message = String(error?.message || '');
    if (message.includes('ACTIVE_RESERVATIONS_EXCEED_NEW_QUANTITY')) {
      return json({ ok: false, error: { code: 'ACTIVE_RESERVATIONS', message: 'This change would conflict with an active reservation.' } }, 409);
    }
    if (message.toLowerCase().includes('unique')) {
      return json({ ok: false, error: { code: 'SKU_EXISTS', message: 'That SKU is already in use.' } }, 409);
    }
    return safeErrorResponse(error);
  }
}

export async function onRequestDelete(context) {
  try {
    protectMutation(context.request);
    const user = await requireAdmin(context.env, context.request);
    const body = await readJson(context.request);
    const id = cleanText(body.id, 80);
    const existing = await context.env.DB.prepare('SELECT id, name, active FROM products WHERE id = ?1').bind(id).first();
    if (!existing) return json({ ok: false, error: { code: 'NOT_FOUND', message: 'Product not found.' } }, 404);
    const now = Math.floor(Date.now() / 1000);

    await context.env.DB.batch([
      context.env.DB.prepare('UPDATE products SET active = 0, updated_at = ?1 WHERE id = ?2').bind(now, id),
      context.env.DB.prepare(
        `INSERT INTO audit_log (
          id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at
        ) VALUES (?1, ?2, 'product.archive', 'product', ?3, ?4, ?5)`
      ).bind(randomId(), user.id, id, JSON.stringify({ name: existing.name }), now)
    ]);

    return json({ ok: true });
  } catch (error) {
    if (String(error?.message || '').includes('ACTIVE_RESERVATIONS_EXCEED_NEW_QUANTITY')) {
      return json({ ok: false, error: { code: 'ACTIVE_RESERVATIONS', message: 'This item cannot be removed while it is part of an active reservation.' } }, 409);
    }
    return safeErrorResponse(error);
  }
}
