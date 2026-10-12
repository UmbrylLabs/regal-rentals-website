import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const full=fs.readFileSync(new URL('../assets/regal-official-shield.webp',import.meta.url));
assert.ok(full.length>2000&&full.length<150000);
assert.equal(full.toString('ascii',0,4),'RIFF');
assert.equal(full.toString('ascii',8,12),'WEBP');
const small=read('assets/regal-compact-rr.svg');
assert.match(small,/viewBox="0 0 512 512"/);
assert.match(small,/Regal Rentals crown RR shield/);
assert.doesNotMatch(small,/<script|onload=|<foreignObject/i);
for(const path of ['index.html','admin/index.html','pay.html','sign.html','rentals.html']){
  const html=read(path);
  assert.match(html,/regal-compact-rr\.svg/,path+' needs small-use shield');
  assert.match(html,/rel="icon" href="\/?assets\/regal-compact-rr\.svg" type="image\/svg\+xml"/,
    path+' needs simplified favicon');
}
assert.match(read('index.html'),/class="brand-regal">Regal</);
assert.match(read('index.html'),/class="brand-rentals">Rentals</);
assert.match(read('index.html'),/href="\/regal-identity-v2\.css"/);
assert.match(read('admin/index.html'),/class="login-card"[\s\S]*?\/assets\/regal-official-shield\.webp/,
  'Login retains full master where it is large enough to see');
assert.match(read('404.html'),/regal-official-shield\.webp/,
  'large logo remains the approved full shield');
assert.match(read('rentals.html'),/class="inventory-hero__watermark" src="assets\/regal-official-shield\.webp"/);
assert.match(read('regal-identity-v2.css'),/brand-rentals/);
console.log('Full master logo retained; simplified shield and readable wordmark used at small sizes.');
