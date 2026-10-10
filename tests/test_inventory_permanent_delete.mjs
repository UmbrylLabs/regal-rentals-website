import assert from 'node:assert/strict';
import fs from 'node:fs';
import { productDeletionBlockers, deleteUnreferencedArchivedProduct } from '../functions/_lib/inventory-delete.js';

function mockDB({bookingItems=0, packageReferences=0, deleted=0}={}) {
  const seen=[];
  const db={prepare(sql){
    const st={
      bind(...params){this.params=params;return this;},
      async first() {
        seen.push({sql,params:this.params});
        if(sql.includes('FROM booking_items'))return {total:bookingItems};
        if(sql.includes('FROM storefront_packages'))return {total:packageReferences};
        throw Error('Unexpected select: '+sql);
      },
      async run(){
        seen.push({sql,params:this.params});
        return {meta:{changes:deleted}};
      }
    };
    return st;
  }};
  return {db,seen};
}

const empty=mockDB();
assert.deepEqual(await productDeletionBlockers(empty.db,'item1'),{bookingItems:0,packageReferences:0});
const referenced=mockDB({bookingItems:2,packageReferences:3});
assert.deepEqual(await productDeletionBlockers(referenced.db,'item2'),{bookingItems:2,packageReferences:3});

const safe=mockDB({deleted:1});
assert.equal(await deleteUnreferencedArchivedProduct(safe.db,'item3'),true);
const guardedDelete=safe.seen.find(x=>x.sql.startsWith('DELETE FROM products'));
assert.ok(guardedDelete,'A guarded delete statement must run');
assert.deepEqual(guardedDelete.params,['item3']);
assert.match(guardedDelete.sql,/active\s*=\s*0/);
assert.match(guardedDelete.sql,/NOT EXISTS\s*\(SELECT 1 FROM booking_items/i);
assert.match(guardedDelete.sql,/NOT EXISTS\s*\(SELECT 1 FROM storefront_packages/i);
assert.match(guardedDelete.sql,/json_each/);
assert.match(guardedDelete.sql,/productId/);
assert.equal(await deleteUnreferencedArchivedProduct(mockDB({deleted:0}).db,'item4'),false);

const api=fs.readFileSync(new URL('../functions/api/admin/products.js',import.meta.url),'utf8');
const admin=fs.readFileSync(new URL('../admin/admin.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../admin/index.html',import.meta.url),'utf8');
const editor=fs.readFileSync(new URL('../admin/storefront-packages.js',import.meta.url),'utf8');
assert.match(api,/body\.permanent\s*===\s*true/);
assert.match(api,/user\.role\s*!==\s*'owner'/);
assert.match(api,/body\.confirmSku\s*!==\s*existing\.sku/);
assert.match(api,/productDeletionBlockers/);
assert.match(api,/if\s*\(linked\.bookingItems\)/);
assert.match(api,/if\s*\(linked\.packageReferences\)/);
assert.match(admin,/data-permanent-delete-product/);
assert.match(admin,/confirmSku:\s*confirmation/);
assert.match(admin,/state\.user\?\.role\s*===\s*'owner'/);
assert.match(html,/storefront-packages\.js\?v=20261010-1/);
assert.match(editor,/await refresh\(\);\s*beginEdit\(\);/);
assert.match(editor,/inventoryAdd\.addEventListener\('click'/);
assert.match(editor,/selected\.set\(id,\s*Number\(inventoryQty\.value\)\)/);
assert.match(editor,/async function refresh\(\)/);
assert.match(editor,/el\s*=\s*name\s*=>\s*form\.querySelector/);
console.log('Inventory hard-delete protections and package picker regression checks passed.');
