const CATEGORY_DEFINITIONS = [
  ['Tables & Chairs', '♜', 'Tables, chairs, and seating arrangements for events of every size.'],
  ['Tents & Shade', '⌂', 'Canopies, tents, and shade equipment for outdoor events.'],
  ['Backyard Games', '★', 'Cornhole, giant games, tug-of-war, and outdoor entertainment.'],
  ['Mini Golf', '⚑', 'Portable mini golf experiences for parties, weddings, and corporate events.'],
  ['Photo Booths & Guestbooks', '◉', 'Photo, video, and audio guestbook experiences.'],
  ['Audio & Visual', '♫', 'PA systems, microphones, projectors, screens, karaoke, and lighting.'],
  ['Decor & Event Extras', '❖', 'Decor, event accents, and useful extras.'],
  ['Other', '◆', 'Additional event rental equipment.']
];

const STYLE_ICONS = {
  'round-table': '◯',
  'rectangle-table': '▭',
  chair: '♜',
  canopy: '⌂',
  tent: '△',
  game: '★',
  'mini-golf': '⚑',
  'photo-booth': '◉',
  audio: '♫',
  visual: '▣',
  lighting: '✦',
  decor: '❖',
  other: '◆'
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function money(cents) {
  if (cents == null) return 'Pricing soon';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(cents) / 100);
}

function publicProduct(row) {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    category: row.category,
    style: row.style,
    description: row.description,
    priceUnit: row.price_unit,
    quantityOwned: Number(row.quantity_owned),
    priceCents: row.price_cents == null ? null : Number(row.price_cents),
    sortOrder: Number(row.sort_order || 100)
  };
}

function renderCategories(products) {
  const counts = new Map();
  products.forEach((product) => counts.set(product.category, (counts.get(product.category) || 0) + 1));
  return CATEGORY_DEFINITIONS.map(([name, icon, description]) => {
    const count = counts.get(name) || 0;
    const available = count > 0;
    return `<article class="category-card" data-category-availability="${available ? 'available' : 'coming'}"${available ? '' : ' hidden'}>
      <div class="category-card__icon category-card__icon--dynamic" aria-hidden="true">${escapeHtml(icon)}</div>
      <span class="category-card__status${available ? ' category-card__status--available' : ''}">${available ? `${count} Available` : 'Coming Soon'}</span>
      <h3>${escapeHtml(name)}</h3>
      <p>${escapeHtml(description)}</p>
      ${available ? '<a href="#available-inventory">View Current Inventory <span aria-hidden="true">→</span></a>' : ''}
    </article>`;
  }).join('');
}

function renderInventory(products) {
  if (!products.length) {
    return '<div class="catalog-load-state"><h3>Inventory is being updated</h3><p>Please contact Regal Rentals for current rental options.</p></div>';
  }

  return products.map((product) => {
    const quantity = Number(product.quantityOwned || 0);
    const unavailable = quantity < 1;
    const priceText = product.priceCents == null ? 'Pricing soon' : money(product.priceCents);
    const symbol = STYLE_ICONS[product.style] || STYLE_ICONS.other;
    const inputId = `${String(product.id).replace(/[^a-zA-Z0-9_-]/g, '-')}-card`;
    return `<article class="inventory-card${unavailable ? ' inventory-card--unavailable' : ''}" data-inventory-product="${escapeHtml(product.id)}">
      <div class="inventory-card__visual inventory-card__visual--dynamic" aria-hidden="true">
        <div class="catalog-style-symbol">${escapeHtml(symbol)}</div>
        <span class="inventory-card__badge" data-product-badge="${escapeHtml(product.id)}">${unavailable ? 'Unavailable' : `${quantity} in inventory`}</span>
      </div>
      <div class="inventory-card__body">
        <p class="inventory-card__kicker">${escapeHtml(product.category)}</p>
        <h3>${escapeHtml(product.name)}</h3>
        <p class="inventory-card__description">${escapeHtml(product.description || 'Contact Regal Rentals for item details.')}</p>
        <div class="inventory-card__meta${product.priceCents == null ? ' inventory-card__meta--text' : ''}"><strong>${escapeHtml(priceText)}</strong><span>${escapeHtml(product.priceUnit || 'each')}</span></div>
        <ul class="inventory-card__features"><li>${quantity} total in current inventory</li><li>Live date-specific availability</li><li>Final reservation confirmed by Regal Rentals</li></ul>
        <div class="card-quote-control">
          <div class="quantity-control quantity-control--card" aria-label="${escapeHtml(product.name)} quantity selector">
            <button type="button" data-card-step="-1" data-product-id="${escapeHtml(product.id)}" aria-label="Remove one">−</button>
            <input id="${escapeHtml(inputId)}" data-card-quantity="${escapeHtml(product.id)}" type="number" min="${unavailable ? 0 : 1}" max="${quantity}" value="${unavailable ? 0 : 1}" inputmode="numeric" aria-label="${escapeHtml(product.name)} quantity to add" ${unavailable ? 'disabled' : ''} />
            <button type="button" data-card-step="1" data-product-id="${escapeHtml(product.id)}" aria-label="Add one">+</button>
          </div>
          <button class="btn btn--secondary add-to-quote-btn" type="button" data-add-product="${escapeHtml(product.id)}" ${unavailable ? 'disabled' : ''}>${unavailable ? 'Unavailable for Date' : 'Add to Quote'}</button>
        </div>
      </div>
    </article>`;
  }).join('');
}

class RemoveOldCatalogScripts {
  element(element) {
    const src = String(element.getAttribute('src') || '');
    if (src.includes('rentals.js') || src.includes('catalog-loader.js')) element.remove();
  }
}

class ReplaceHtml {
  constructor(html) {
    this.html = html;
  }

  element(element) {
    element.setInnerContent(this.html, { html: true });
  }
}

class InjectHeadAssets {
  element(element) {
    element.append('<link rel="stylesheet" href="/catalog-dynamic.css?v=20260721-7" />', { html: true });
  }
}

class InjectCatalogBootstrap {
  constructor(products) {
    this.products = products;
  }

  element(element) {
    const json = JSON.stringify({ ok: true, products: this.products }).replace(/</g, '\\u003c');
    element.append(
      `<script id="catalog-bootstrap" type="application/json">${json}</script><script src="/catalog-loader.js?v=20260721-8" defer></script>`,
      { html: true }
    );
  }
}

export async function onRequest(context) {
  let products = [];
  try {
    const result = await context.env.DB.prepare(
      `SELECT id, sku, name, category, style, description, price_unit,
              quantity_owned, price_cents, sort_order
       FROM products
       WHERE active = 1
       ORDER BY category, sort_order, name`
    ).all();
    products = (result.results || []).map(publicProduct);
  } catch (error) {
    console.error('Server catalog render failed', error);
  }

  const response = await context.next();
  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.includes('text/html')) return response;

  const transformed = new HTMLRewriter()
    .on('script[src]', new RemoveOldCatalogScripts())
    .on('head', new InjectHeadAssets())
    .on('#category-grid', new ReplaceHtml(renderCategories(products)))
    .on('#available-inventory .inventory-grid', new ReplaceHtml(renderInventory(products)))
    .on('body', new InjectCatalogBootstrap(products))
    .transform(response);

  const result = new Response(transformed.body, transformed);
  result.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  result.headers.set('Pragma', 'no-cache');
  result.headers.set('Expires', '0');
  result.headers.set('X-Regal-Catalog-Render', `server-${products.length}`);
  return result;
}
