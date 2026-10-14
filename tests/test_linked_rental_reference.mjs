import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createBooking } from '../functions/_lib/booking.js';

const inquiryId='11111111-2222-4333-8444-555555555555';
const reference='RR-20261014-1450-A7F2';
const product={
 id:'white_chair',sku:'CHAIR-WHITE',name:'White Folding Chair',
 category:'Tables & Chairs',style:'chair',description:'',price_unit:'each',
 quantity_owned:100,price_cents:200,active:1,sort_order:1
};
const saved=[];
const db={
 prepare(sql){
   const statement={
     args:[],
     bind(...values){this.args=values;return this},
     async run(){return {meta:{changes:1}}},
     async all(){
       if(sql.includes('FROM products p'))return {results:[{...product,quantity_available:100}]};
       if(sql.includes('FROM products\n'))return {results:[product]};
       throw Error('Unexpected query: '+sql);
     },
     async first(){
       if(sql.includes('WHERE idempotency_key'))return null;
       if(sql.includes('FROM website_inquiries'))return {id:inquiryId,reference};
       if(sql.includes('FROM bookings WHERE booking_number'))return saved.find(row=>row.number===this.args[0])||null;
       throw Error('Unexpected first query: '+sql);
     }
   };
   return statement;
 },
 async batch(statements){
   const booking=statements.find(x=>x && String(x.args?.[1]||'').startsWith('RR-'));
   assert.ok(booking,'Booking insert stores a visible reference');
   saved.push({id:booking.args[0],number:booking.args[1]});
   return statements.map(()=>({success:true}));
 }
};
const request=new Request('https://regal.rentals/api/admin/bookings',{method:'POST'});
const input={
 customer:{name:'Example Renter',email:'renter@example.com',phone:'9165551234'},
 websiteInquiryId:inquiryId,
 items:[{productId:'white_chair',quantity:8}],
 status:'quote',
 eventStartAt:Math.floor(new Date('2030-12-11T20:00:00Z').getTime()/1000),
 eventEndAt:Math.floor(new Date('2030-12-12T20:00:00Z').getTime()/1000),
 bufferBeforeMinutes:120,bufferAfterMinutes:120,
 serviceType:'delivery',eventCity:'Folsom'
};
const created=await createBooking({DB:db},request,input,'admin-user-1');
assert.equal(created.booking.bookingNumber,reference);
assert.equal(saved[0].number,reference,'Booking stores exact lead number');
assert.equal(created.duplicate,false);
await assert.rejects(createBooking({DB:db},request,input,'admin-user-1'),/INQUIRY_ALREADY_BOOKED/);
await assert.rejects(
 createBooking({DB:{...db,batch(){throw Error('Should never persist');}}},request,{...input,websiteInquiryId:inquiryId},null),
 /INQUIRY_CONVERSION_REQUIRES_ADMIN/
);
// Independent bookings still generate their own date-based number.
const standalone=await createBooking({DB:db},request,{...input,websiteInquiryId:''},null);
assert.match(standalone.booking.bookingNumber,/^RR-\d{8}-\d{4}-[A-F0-9]{4}$/);
assert.notEqual(standalone.booking.bookingNumber,reference);
const adminJS=fs.readFileSync(new URL('../admin/admin.js',import.meta.url),'utf8');
const inquiryUI=fs.readFileSync(new URL('../admin/website-inquiries.js',import.meta.url),'utf8');
const inquiryApi=fs.readFileSync(new URL('../functions/api/admin/inquiries.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../admin/index.html',import.meta.url),'utf8');
const pay=fs.readFileSync(new URL('../functions/api/pay/[token].js',import.meta.url),'utf8');
assert.match(inquiryApi,/b\.id AS booking_id/);
assert.match(inquiryUI,/data-inquiry-convert/);
assert.match(inquiryUI,/regal:convert-inquiry/);
assert.match(inquiryUI,/data-inquiry-open-booking/);
assert.match(adminJS,/websiteInquiryId: data\.get\('websiteInquiryId'\)/);
assert.match(adminJS,/regal:convert-inquiry/);
assert.match(adminJS,/eventEndDate/);
assert.match(html,/name="eventEndDate"/);
assert.match(adminJS,/Copy Square Invoice ID/);
assert.match(pay,/referenceId: request\.booking_number/);
assert.doesNotMatch(pay,/referenceId: request\.id/);
console.log('Lead-to-booking reference, duplicate safeguards, admin conversion, dates and Square payment reference passed.');
