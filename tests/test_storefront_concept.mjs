import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = p => fs.readFileSync(path.join(root,p),'utf8');
const html = read('index.html');
const css = read('regal-home-20261009.css');
const js = read('regal-storefront-v2.js');
assert.match(html,/viewport" content="width=device-width,initial-scale=1"/);
assert.match(html,/href="\/regal-home-20261009.css"/);
assert.match(html,/src="\/regal-storefront-v2.js"/);
assert.match(css,/@media\(max-width:760px\)/);
assert.match(css,/\.menu-open \.main-nav\{display:flex\}/);
assert.match(js,/fetch\('\/api\/public\/inquiry'/);
assert.match(js,/\/api\/public\/storefront/);
assert.match(html,/id="quote-cart"/);
assert.match(html,/id="storefront-products"/);
assert.match(html,/id="storefront-packages"/);
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
assert.match(headers,/img-src '[^']*self'[^;]*https:\/\/images\.pexels\.com/);
console.log('Mobile storefront and quote form compatibility checks passed.');
