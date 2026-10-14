import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const full=fs.readFileSync(new URL('../assets/regal-official-shield.webp',import.meta.url));
assert.ok(full.length>2000&&full.length<150000);
assert.equal(full.toString('ascii',0,4),'RIFF');
assert.equal(full.toString('ascii',8,12),'WEBP');

// The compact crest was updated after this test was first written. Check
// the actual current viewBox and accessible brand name, not retired dimensions.
const small=read('assets/regal-compact-rr.svg');
assert.match(small,/viewBox="0 0 490 600"/);
assert.match(small,/Regal Rentals crown shield with RR monogram/);
assert.doesNotMatch(small,/<script|onload=|<foreignObject/i);
for(const path of ['index.html','admin/index.html','pay.html','sign.html','rentals.html']){
  const html=read(path);
  assert.match(html,/regal-compact-rr\.svg/,path+' should offer the recognizable RR compact icon');
  assert.match(html,/rel="icon" href="\/?assets\/regal-compact-rr\.svg(?:\?[^"]*)?" type="image\/svg\+xml"/,
    path+' must retain the official crest favicon');
}
const homepage=read('index.html');
assert.match(homepage,/site-brand__shield/);
assert.match(homepage,/site-brand__wordmark/);
assert.match(homepage,/regal-wordmark-footer-gold-20261013\.svg/);
assert.match(read('admin/index.html'),/regal-compact-rr\.svg/);
assert.match(read('404.html'),/regal-official-shield\.webp/,
  'full detailed master stays available on larger promotional placements');
assert.match(read('rentals.html'),/class="inventory-hero__watermark" src="assets\/regal-compact-rr\.svg/);
console.log('Approved Regal identity and active compact shield references passed.');
