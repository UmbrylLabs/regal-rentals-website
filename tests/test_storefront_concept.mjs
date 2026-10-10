import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = p => fs.readFileSync(path.join(root,p),'utf8');
const html = read('index.html');
const css = read('regal-home-20261009.css');
const js = read('regal-catalog-v3.js');
const catalogCss = read('regal-catalog-v3.css');
assert.match(html,/viewport" content="width=device-width,initial-scale=1"/);
assert.match(html,/href="\/regal-home-20261009.css"/);
assert.match(html,/src="\/regal-catalog-v3.js"/);
assert.match(html,/href="\/regal-catalog-v3.css"/);
assert.match(css,/@media\(max-width:760px\)/);
assert.match(css,/\.menu-open \.main-nav\{display:flex\}/);
assert.match(js,/fetch\('\/api\/public\/inquiry'/);
assert.match(js,/\/api\/public\/storefront/);
assert.match(js,/data-quantity-preset/);
assert.match(js,/data-product-quantity/);
assert.match(js,/qtyChoices=\[1,2,4,6,8,10,20,50,100\]/);
assert.doesNotMatch(js,/max="\"\+Number\(product\.quantityOwned\)/);
const adminPage=read('admin/index.html');
const packageEditor=read('admin/storefront-packages.js');
assert.match(adminPage,/id="package-inventory-select"/);
assert.match(adminPage,/id="add-package-inventory-item"/);
assert.match(adminPage,/id="package-inventory-add-qty"/);
assert.match(packageEditor,/selected\.set\(id, Number\(inventoryQty\.value\)\)/);
assert.match(packageEditor,/data-package-item-remove/);

assert.match(html,/id="quote-cart"/);
assert.match(html,/id="storefront-products"/);
assert.match(html,/id="storefront-packages"/);
assert.match(html,/id="catalog-equipment-group"/);
assert.match(html,/id="catalog-empty"/);
assert.match(html,/id="catalog-quote-count"/);
assert.match(html,/id="mobile-quote-bar"/);
assert.match(js,/function applyCatalogFilter\(\)/);
assert.match(js,/function productCategory\(product\)/);
assert.match(js,/activeCategory==='packages'/);
assert.match(js,/card\.hidden=!match/);
assert.match(js,/catalogQuoteCount\.textContent/);
assert.match(catalogCss,/\.catalog-chips \{/);
assert.match(catalogCss,/overflow-x:auto/);
assert.match(catalogCss,/\.mobile-quote-bar \{/);
assert.match(catalogCss,/position:fixed/);
for(const category of ['all','packages','chairs','tables','canopies']) {
 assert.ok(html.includes('data-catalog-filter="'+category+'"'),'Missing category filter: '+category);
}

assert.match(html,/id="quote-form"/);
assert.match(html,/id="form-success"/);
assert.match(html,/id="form-status"/);
assert.match(html,/id="form-reference"/);
assert.match(html,/id="new-inquiry"/);
assert.doesNotMatch(html,/href="tel:/);
assert.doesNotMatch(html,/href="https:\/\/admin\.regal\.rentals/);

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
assert.equal(ids.length,new Set(ids).size,'No duplicate IDs');
for (const [,id] of html.matchAll(/\bhref="#([^"]+)"/g)) {
 assert.ok(ids.includes(id),'Target for on-page anchor #'+id);
}
for (const [,ref] of html.matchAll(/(?:src|href)="\/(assets\/regal-[^"]+\.svg)"/g)) {
 assert.ok(fs.existsSync(path.join(root,ref)),'Referenced product SVG exists: '+ref);
}
for (const required of ['White folding chairs','60-inch round tables','6-foot rectangle tables','10x10 canopy','10x20 canopy']) {
 assert.ok(html.includes('value="'+required+'"'),'Quote form has '+required);
 assert.ok(html.includes('data-item="'+required+'"'),'Product card links to '+required);
}
for (const pkg of ['Backyard Essentials','Party Ready','Shade & Serve']) {
 assert.ok(html.includes('data-package="'+pkg+'"'),'Package link '+pkg);
 assert.ok(html.includes('<option>'+pkg.replace('&','&amp;')+'</option>'),'Form selects package '+pkg);
}
for (const src of ['assets/regal-chair.svg','assets/regal-round-table.svg','assets/regal-rectangle-table.svg','assets/regal-canopy-10.svg','assets/regal-canopy-20.svg']) {
 const svg = read(src);
 assert.match(svg,/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
 assert.match(svg,/<\/svg>$/);
 assert.doesNotMatch(svg,/<script/);
}
const headers=read('_headers');
assert.match(headers,/img-src '[^']*self'[^;]*https:/);
console.log('Mobile storefront and quote form compatibility checks passed.');
