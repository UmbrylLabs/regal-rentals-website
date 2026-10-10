import assert from 'node:assert/strict';
import { validImageUrl } from '../functions/_lib/storefront.js';
import { onRequestGet as getStorefront } from '../functions/api/public/storefront.js';
import { onRequestPost as postInquiry } from '../functions/api/public/inquiry.js';

assert.equal(validImageUrl('/assets/table.webp'), '/assets/table.webp');
assert.equal(validImageUrl(''), '');
assert.throws(()=>validImageUrl('javascript:alert(1)'));
assert.throws(()=>validImageUrl('http://example.com/a.jpg'));

const rows={
 products:[
 {id:'chair-1',name:'White Chair',description:'Folding',category:'Tables & Chairs',style:'chair',price_cents:250,quantity_owned:100,price_unit:'per chair',sort_order:10,image_url:'/assets/regal-chair.svg'},
 {id:'table-1',name:'Round Table',description:'60 inch',category:'Tables & Chairs',style:'round-table',price_cents:null,quantity_owned:6,price_unit:'per table',sort_order:20,image_url:''}
 ],
 packages:[
 {id:'package-good',name:'Party Ready',description:'Bundle',image_url:'',items_json:'[{"productId":"chair-1","quantity":12},{"productId":"table-1","quantity":2}]',price_cents:null,sort_order:1,active:1},
 {id:'package-bad',name:'Unavailable',description:'Hidden',image_url:'',items_json:'[{"productId":"table-1","quantity":999}]',price_cents:null,sort_order:2,active:1},
 {id:'package-draft',name:'Draft',description:'Hidden',image_url:'',items_json:'[]',price_cents:null,sort_order:3,active:0}
 ]
};
function mockDb() {
 const calls=[];
 const db={prepare(sql){
   const st={
     args:[],
     bind(...args){this.args=args;return this;},
     async run(){calls.push({sql,args:this.args});return {meta:{changes:1}};},
     async all(){
       calls.push({sql,args:this.args});
       if(sql.includes('FROM storefront_packages'))return {results:rows.packages};
       if(sql.includes('FROM products p LEFT JOIN storefront_product_media'))return {results:rows.products};
       return {results:[]};
     }
   };
   return st;
 }};
 return {db,calls};
}
const {db,calls}=mockDb();
const response=await getStorefront({env:{DB:db}});
assert.equal(response.status,200);
const json=await response.json();
assert.equal(json.products.length,2);
assert.equal(json.packages.length,1);
assert.equal(json.packages[0].id,'package-good');
assert.equal(response.headers.get('cache-control'),'no-store, max-age=0');

async function submit(data) {
 const {db,calls}=mockDb();
 const req=new Request('https://regal.rentals/api/public/inquiry',{
   method:'POST',
   headers:{origin:'https://regal.rentals','content-type':'application/json','cf-connecting-ip':'198.51.100.7'},
   body:JSON.stringify(data)
 });
 const res=await postInquiry({request:req,env:{DB:db,IP_HASH_PEPPER:'test'},waitUntil(){}});
 return {res,json:await res.json(),calls};
}
const base={name:'Customer',email:'test@example.com',date:'2026-11-21',city:'Folsom',
  package:'',items:[],phone:'',details:'',website:''};
const ok=await submit({...base,packageId:'package-good',selectedItems:[
  {productId:'chair-1',quantity:17},{productId:'table-1',quantity:2}
]});
assert.equal(ok.res.status,201);
const write=ok.calls.find(x=>x.sql.includes('INSERT INTO website_inquiries ('));
assert.ok(write);
assert.deepEqual(JSON.parse(write.args[8]),['17 × White Chair','2 × Round Table']);
assert.equal(write.args[7],'Party Ready');

const tooMany=await submit({...base,selectedItems:[{productId:'table-1',quantity:7}]});
assert.equal(tooMany.res.status,400);
assert.equal(tooMany.calls.some(x=>x.sql.includes('INSERT INTO website_inquiries (')),false);
const badId=await submit({...base,selectedItems:[{productId:'invalid',quantity:1}]});
assert.equal(badId.res.status,400);
const badPkg=await submit({...base,packageId:'package-draft',selectedItems:[]});
assert.equal(badPkg.res.status,400);
const packageOnly=await submit({...base,packageId:'package-good',selectedItems:[]});
assert.equal(packageOnly.res.status,201);
assert.deepEqual(JSON.parse(packageOnly.calls.find(x=>x.sql.includes('INSERT INTO website_inquiries (')).args[8]),['12 × White Chair','2 × Round Table']);
console.log('Dynamic storefront and quote cart submission validation passed.');
