import { cleanText } from './http.js';

export function normalizeCharges(input) {
  if (!Array.isArray(input) || input.length > 30) throw new Error('INVALID_CHARGES');
  const types = new Set(['delivery', 'setup', 'teardown', 'discount', 'tax', 'other']);
  return input.map(charge => {
    const type = cleanText(charge?.type, 30);
    const description = cleanText(charge?.description, 200);
    const amountCents = Number(charge?.amountCents);
    if (!types.has(type) || !description || !Number.isSafeInteger(amountCents)
      || Math.abs(amountCents) > 10_000_000 || (type === 'discount' ? amountCents >= 0 : amountCents < 0)) {
      throw new Error('INVALID_CHARGES');
    }
    return { type, description, amountCents };
  });
}

export function invoiceAmounts(items, charges = []) {
  const itemSubtotalCents = items.reduce((sum, item) => sum + Number(item.unit_price_cents || 0) * Number(item.quantity), 0);
  const taxCents = charges.filter(c => c.type === 'tax').reduce((sum, c) => sum + c.amountCents, 0);
  const subtotalCents = itemSubtotalCents + charges.filter(c => c.type !== 'tax').reduce((sum, c) => sum + c.amountCents, 0);
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents < 0 || subtotalCents + taxCents > 100_000_000) throw new Error('INVALID_CHARGES');
  return { itemSubtotalCents, subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}
