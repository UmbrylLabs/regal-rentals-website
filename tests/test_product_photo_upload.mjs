import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validImageUrl } from '../functions/_lib/storefront.js';
import { photoUrl, isWebpImage, normalizePhotoId, PHOTO_MAX_BYTES,
  PHOTO_WIDTH, PHOTO_HEIGHT } from '../functions/_lib/product-photo.js';
import { onRequestGet } from '../functions/api/public/product-photo.js';

assert.equal(PHOTO_WIDTH,1200);
assert.equal(PHOTO_HEIGHT,900);
assert.equal(PHOTO_MAX_BYTES,450000);
const itemId='white-chairs-1234abcd';
const url=photoUrl(itemId,1760000000000);
assert.equal(validImageUrl(url),url);
assert.throws(()=>validImageUrl('/api/admin/product-photo?id='+itemId));
assert.throws(()=>validImageUrl('/api/public/product-photo?id='+itemId+'&v=123&url=http://evil.example'));
assert.throws(()=>validImageUrl('data:image/svg+xml,<svg/>'));
assert.equal(normalizePhotoId(itemId),itemId);
assert.equal(normalizePhotoId('../bad'),null);
assert.equal(normalizePhotoId(''),null);

const fakeWebp=Uint8Array.from([82,73,70,70,0,0,0,0,87,69,66,80,86,80,56,32,...Array(80).fill(0)]);
assert.equal(isWebpImage(fakeWebp),true);
assert.equal(isWebpImage(Uint8Array.from([82,73,70,70])),false);
assert.equal(isWebpImage(Uint8Array.from([60,115,118,103,62])),false);
const statements=[];
const db={prepare(sql){statements.push(sql);return{
  bind(){return this},
  async run(){return {meta:{changes:1}}},
  async first(){return {image_data:Array.from(fakeWebp),image_bytes:fakeWebp.length}}
};}};
const req=new Request('https://regal.rentals/api/public/product-photo?id='+itemId);
const response=await onRequestGet({request:req,env:{DB:db}});
assert.equal(response.status,200);
assert.equal(response.headers.get('content-type'),'image/webp');
assert.equal(response.headers.get('x-content-type-options'),'nosniff');
assert.deepEqual(new Uint8Array(await response.arrayBuffer()),fakeWebp);
const missing=await onRequestGet({request:new Request('https://regal.rentals/api/public/product-photo?id=bad%2Fpath'),env:{DB:db}});
assert.equal(missing.status,404);
assert.ok(statements.some(x=>x.includes('CREATE TABLE IF NOT EXISTS storefront_product_photos')));

const upload=fs.readFileSync(new URL('../functions/api/admin/product-photo.js',import.meta.url),'utf8');
assert.match(upload,/protectMutation\(context\.request\)/);
assert.match(upload,/requireAdmin\(context\.env,context\.request\)/);
assert.match(upload,/context\.request\.arrayBuffer\(\)/);
assert.match(upload,/PHOTO_MAX_BYTES/);
assert.match(upload,/isWebpImage\(data\)/);
assert.match(upload,/context\.env\.DB\.batch/);
assert.match(upload,/product\.photo_upload/);

const html=fs.readFileSync(new URL('../admin/index.html',import.meta.url),'utf8');
const photoJS=fs.readFileSync(new URL('../admin/product-photo-upload.js',import.meta.url),'utf8');
const adminJS=fs.readFileSync(new URL('../admin/admin.js',import.meta.url),'utf8');
const catalogJS=fs.readFileSync(new URL('../regal-catalog-v3.js',import.meta.url),'utf8');
for(const id of ['product-photo-file','product-photo-fit','product-photo-preview','product-photo-preview-box','product-photo-info']) {
  assert.ok(html.includes('id="'+id+'"'),'Missing photo editor field '+id);
}
assert.ok(html.indexOf('product-photo-upload.js')<html.indexOf('admin/admin.js'),'Image handler must initialize before admin.js');
assert.match(photoJS,/WIDTH = 1200, HEIGHT = 900/);
assert.match(photoJS,/canvas\.toBlob\(resolve, 'image\/webp'/);
assert.match(photoJS,/ctx\.fillStyle = '#ffffff'/);
assert.match(photoJS,/ctx\.drawImage/);
assert.match(photoJS,/method: 'POST'/);
assert.match(photoJS,/const state = \(\) => pending/);
assert.match(adminJS,/RegalProductPhotos\.upload\(id\)/);
assert.match(adminJS,/const id = editing \? payload\.id : result\.product\?\.id/);
assert.match(catalogJS,/\/api\\\/public\\\/product-photo/);

console.log('Inventory photo optimization, serving, upload security, and editor integration passed.');
