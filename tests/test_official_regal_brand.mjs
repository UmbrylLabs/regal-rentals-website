import assert from 'node:assert/strict';
import fs from 'node:fs';

const root=new URL('../',import.meta.url);
const read=p=>fs.readFileSync(new URL(p,root),'utf8');
const logo=fs.readFileSync(new URL('assets/regal-official-shield.webp',root));
assert.ok(logo.length>2000 && logo.length<150000,'optimized approved shield asset is present');
assert.equal(logo.toString('ascii',0,4),'RIFF');
assert.equal(logo.toString('ascii',8,12),'WEBP');
assert.ok(['VP8 ','VP8L','VP8X'].includes(logo.toString('ascii',12,16)),'valid WebP chunk');

for(const path of ['index.html','admin/index.html','pay.html','sign.html','404.html','rentals.html']) {
  const html=read(path);
  assert.match(html,/regal-official-shield\.webp/,path+' must use approved shield');
  assert.doesNotMatch(html,/regal-shield-20261010\.webp/,path+' must not use retired shield');
  assert.doesNotMatch(html,/assets\/favicon\.png/,path+' must not use old favicon');
}
for(const path of ['index.html','admin/index.html','pay.html','sign.html','rentals.html']){
  const html=read(path);
  assert.match(html,/href=["']\/?assets\/regal-official-shield\.webp["']/,'favicon uses official art on '+path);
}
for(const path of ['regal-catalog-v3.js','regal-storefront-v2.js']) {
  const code=read(path);
  assert.match(code,/\/assets\/regal-official-shield\.webp/);
}
assert.ok(!fs.existsSync(new URL('assets/_tmp_official_logo_transfer.webp',root)),'no transfer artifact is deployed');
console.log('Official Regal Rentals logo references and image file passed.');
