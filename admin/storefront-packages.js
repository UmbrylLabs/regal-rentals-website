(() => {
  const tab = document.querySelector('[data-panel="packages"]');
  const form = document.querySelector('#storefront-package-form');
  const listing = document.querySelector('#storefront-packages-list');
  const rows = document.querySelector('#storefront-package-products');
  const notice = document.querySelector('#storefront-package-list-message');
  const message = document.querySelector('#storefront-package-message');
  const inventorySelect = document.querySelector('#package-inventory-select');
  const inventoryQty = document.querySelector('#package-inventory-add-qty');
  const inventoryAdd = document.querySelector('#add-package-inventory-item');
  const addPackage = document.querySelector('#new-storefront-package');
  const saveButton = document.querySelector('#save-storefront-package');

  if (!tab || !form || !listing || !inventorySelect || !inventoryAdd) return;

  let products = [];
  let packages = [];
  let loaded = false;
  let loading = null;
  const selected = new Map();
  const el = name => form.querySelector('[name="' + name + '"]');
  const esc = value => String(value ?? '').replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  const validQty = value => {
    if (String(value).trim() === '') return false;
    const n = Number(value);
    return Number.isSafeInteger(n) && n >= 1 && n <= 1000000;
  };
  const currency = cents => cents == null ? 'Quote only'
    : (Number(cents) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  const api = async (url, options = {}) => {
    const response = await fetch(url, {
      credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, ...options
    });
    let body;
    try { body = await response.json(); }
    catch { throw Error('Could not reach the rental database. Refresh and try again.'); }
    if (!response.ok || !body.ok) throw Error(body?.error?.message || 'Unable to save or load packages.');
    return body;
  };

  function renderList() {
    listing.innerHTML = packages.length ? packages.map(pkg => {
      const lines = (pkg.items || []).map(line => {
        const product = products.find(p => p.id === line.productId);
        return Number(line.quantity) + ' × ' + (product?.name || 'Item no longer in inventory');
      });
      return '<article class="package-admin-card">' +
        '<div><strong>' + esc(pkg.name) + '</strong><span class="package-state ' +
        (pkg.active ? 'package-state--live' : '') + '">' + (pkg.active ? 'Published' : 'Draft') + '</span></div>' +
        '<p>' + esc(pkg.description || 'No description') + '</p><p>' +
        esc(lines.join(', ') || 'No equipment added') + '</p><p><b>' +
        esc(currency(pkg.priceCents)) + '</b> · Display order ' + Number(pkg.sortOrder) + '</p>' +
        '<div class="package-admin-actions"><button class="button button--secondary" type="button" data-package-edit="' +
        esc(pkg.id) + '">Edit Package</button>' +
        (pkg.active ? '<button class="button button--quiet" type="button" data-package-unpublish="' +
        esc(pkg.id) + '">Unpublish</button>' : '') + '</div></article>';
    }).join('') : '<p class="message">No packages yet. Choose Add Package to build one using your inventory.</p>';
  }

  async function refresh() {
    // Share in-flight loads, so clicking Add Package right after opening the
    // tab can never open an empty picker before the inventory has arrived.
    if (loading) return loading;
    loading = (async () => {
      notice.textContent = 'Loading current inventory and packages…';
      const [catalog, result] = await Promise.all([
        api('/api/admin/products'), api('/api/admin/packages')
      ]);
      products = Array.isArray(catalog.products) ? catalog.products : [];
      packages = Array.isArray(result.packages) ? result.packages : [];
      loaded = true;
      notice.textContent = products.filter(p => Number(p.active)).length +
        ' active inventory items · ' + packages.length +
        ' packages. Published changes appear on the homepage after a refresh.';
      renderList();
      return true;
    })();
    try { return await loading; }
    catch (error) {
      loaded = false;
      notice.textContent = 'Could not load inventory or packages: ' + error.message;
      throw error;
    } finally { loading = null; }
  }

  function availableInventory() {
    return products.filter(p => Number(p.active) === 1 && !selected.has(p.id));
  }

  function renderPicker() {
    const options = availableInventory();
    inventorySelect.innerHTML = '<option value="">Choose an item from Inventory…</option>' +
      options.map(p => '<option value="' + esc(p.id) + '">' +
        esc(p.name) + ' (owned: ' + Number(p.quantity_owned) + ')</option>').join('');
    inventorySelect.disabled = !options.length;
    inventoryAdd.disabled = !options.length;
  }

  function renderRows() {
    if (!selected.size) {
      rows.innerHTML = '<p class="message">Nothing included yet. Choose an inventory item above and click Add Item.</p>';
    } else {
      rows.innerHTML = [...selected].map(([id, qty]) => {
        const product = products.find(p => p.id === id);
        const name = product?.name || 'Missing inventory item';
        const detail = !product ? 'Product deleted' :
          (Number(product.active) ? 'Owned: ' + Number(product.quantity_owned) : 'Archived — cannot publish');
        return '<div class="package-product-option" data-package-line="' + esc(id) + '">' +
          '<span><strong>' + esc(name) + '</strong><small>' + esc(detail) + '</small></span>' +
          '<label>Qty <input type="number" min="1" step="1" inputmode="numeric" data-package-product-id="' +
          esc(id) + '" value="' + qty + '" aria-label="Quantity of ' + esc(name) + '"></label>' +
          '<button type="button" class="button button--quiet" data-package-item-remove="' +
          esc(id) + '" aria-label="Remove ' + esc(name) + '">Remove</button></div>';
      }).join('');
    }
    renderPicker();
  }

  function beginEdit(pkg = null) {
    if (!loaded) return;
    form.reset();
    selected.clear();
    for (const item of pkg?.items || []) {
      if (item?.productId && validQty(item.quantity)) selected.set(item.productId, Number(item.quantity));
    }
    el('id').value = pkg?.id || '';
    el('name').value = pkg?.name || '';
    el('description').value = pkg?.description || '';
    el('imageUrl').value = pkg?.imageUrl || '';
    el('price').value = pkg?.priceCents == null ? '' : (Number(pkg.priceCents) / 100).toFixed(2);
    el('sortOrder').value = String(pkg?.sortOrder ?? 100);
    el('active').checked = Boolean(pkg?.active);
    document.querySelector('#storefront-package-form-title').textContent = pkg ? 'Edit Package' : 'Create Package';
    message.textContent = '';
    inventoryQty.value = '1';
    renderRows();
    form.hidden = false;
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  tab.addEventListener('click', () => { refresh().catch(() => {}); });
  addPackage.addEventListener('click', async () => {
    addPackage.disabled = true;
    try {
      // Always refresh; items added in the Inventory tab are now available
      // even without reloading the whole dashboard.
      await refresh();
      beginEdit();
    } catch (error) {
      notice.textContent = 'Unable to open package builder: ' + error.message;
    } finally { addPackage.disabled = false; }
  });
  document.querySelector('#cancel-storefront-package').addEventListener('click', () => {
    form.hidden = true;
    selected.clear();
  });

  inventoryAdd.addEventListener('click', () => {
    const id = inventorySelect.value;
    if (!id) { message.textContent = 'Choose an inventory item first.'; inventorySelect.focus(); return; }
    const product = products.find(p => p.id === id);
    if (!product || !Number(product.active)) {
      message.textContent = 'This item is no longer active in Inventory. Refresh and try again.';
      return;
    }
    if (!validQty(inventoryQty.value)) {
      message.textContent = 'Enter a positive whole-number quantity.';
      inventoryQty.focus();
      return;
    }
    selected.set(id, Number(inventoryQty.value));
    inventoryQty.value = '1';
    message.textContent = product.name + ' added to this package.';
    renderRows();
  });

  rows.addEventListener('input', event => {
    const field = event.target.closest('[data-package-product-id]');
    if (!field) return;
    if (validQty(field.value)) {
      selected.set(field.dataset.packageProductId, Number(field.value));
      message.textContent = '';
    }
  });
  rows.addEventListener('click', event => {
    const button = event.target.closest('[data-package-item-remove]');
    if (!button) return;
    selected.delete(button.dataset.packageItemRemove);
    renderRows();
  });

  listing.addEventListener('click', async event => {
    const editButton = event.target.closest('[data-package-edit]');
    const unpublish = event.target.closest('[data-package-unpublish]');
    if (editButton) {
      const id = editButton.dataset.packageEdit;
      try {
        await refresh();
        const pkg = packages.find(p => p.id === id);
        if (!pkg) throw Error('Package was not found after refreshing. Try again.');
        beginEdit(pkg);
      } catch (error) { notice.textContent = error.message; }
      return;
    }
    if (!unpublish || !confirm('Unpublish this package from the website?')) return;
    unpublish.disabled = true;
    try {
      await api('/api/admin/packages', {
        method: 'DELETE', body: JSON.stringify({ id: unpublish.dataset.packageUnpublish })
      });
      await refresh();
    } catch (error) {
      notice.textContent = error.message;
      unpublish.disabled = false;
    }
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const controls = [...rows.querySelectorAll('[data-package-product-id]')];
    const bad = controls.find(input => !validQty(input.value));
    if (bad) { message.textContent = 'Enter a positive whole-number quantity for each item.'; bad.focus(); return; }
    const items = controls.map(input => ({
      productId: input.dataset.packageProductId, quantity: Number(input.value)
    }));
    if (el('active').checked && !items.length) {
      message.textContent = 'Add at least one inventory item before publishing.';
      return;
    }
    const invalid = items.find(item => {
      const product = products.find(p => p.id === item.productId);
      return !product || (el('active').checked && !Number(product.active));
    });
    if (invalid) { message.textContent = 'One selected inventory item is no longer available. Remove it or save as a draft.'; return; }
    const price = el('price').value.trim();
    const payload = {
      id: el('id').value || undefined,
      name: el('name').value.trim(),
      description: el('description').value.trim(),
      imageUrl: el('imageUrl').value.trim(),
      sortOrder: Number(el('sortOrder').value),
      priceCents: price === '' ? null : Math.round(Number(price) * 100),
      active: el('active').checked,
      items
    };
    saveButton.disabled = true;
    message.textContent = 'Saving package…';
    try {
      await api('/api/admin/packages', {
        method: payload.id ? 'PATCH' : 'POST', body: JSON.stringify(payload)
      });
      form.hidden = true;
      selected.clear();
      await refresh();
      notice.textContent = 'Package saved. Published packages will appear on the website.';
    } catch (error) {
      message.textContent = 'Could not save package: ' + error.message;
    } finally { saveButton.disabled = false; }
  });
})();