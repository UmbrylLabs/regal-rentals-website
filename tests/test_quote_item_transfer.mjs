import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('../admin/admin.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../admin/index.html',import.meta.url),'utf8');
const inquiryApi=fs.readFileSync(new URL('../functions/api/public/inquiry.js',import.meta.url),'utf8');
const quoteJS=fs.readFileSync(new URL('../regal-catalog-v3.js',import.meta.url),'utf8');

assert.match(html,/id="booking-inquiry-equipment"/);
assert.match(html,/Equipment requested by customer/);
assert.match(quoteJS,/Please add at least one rental item or package before requesting a quote/);
assert.match(inquiryApi,/if \(!items\.length\) return invalid\('Please select at least one rental item or package\.'/);
assert.match(js,/Needs manual selection or quantity adjustment/);
assert.match(js,/No equipment was selected on this website quote request/);
assert.match(js,/Array\.from\(document\.querySelectorAll\('#booking-product-picker \.product-option'\)\)/);

// Exercise the actual render function to ensure Check Availability doesn't
// reset a quote's selected quantity back to zero.
const start=js.indexOf('  const renderProductPicker =');
const end=js.indexOf('  const loadProducts =',start);
assert.ok(start>=0&&end>start);
const picker={innerHTML:'',querySelectorAll(){return this.cards||[];}};
const input={value:'8',max:'100'};
const card={dataset:{productId:'chair-1'},querySelector(){return input;}};
picker.cards=[card];
const state={availability:new Map(),products:[{
 id:'chair-1',name:'White plastic folding chair',active:1,
 quantity_owned:100,category:'Tables & Chairs',price_cents:250
}]};
const escapeHtml=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const $=(selector,root)=>selector==='#booking-product-picker'?picker:(selector==='input[type="number"]' && root===card?input:null);
const render=new Function('state','$','escapeHtml','money',
 js.slice(start,end)+'\nreturn renderProductPicker;'
)(state,$,escapeHtml,()=>'$2.50');
render();
assert.match(picker.innerHTML,/value="8"/,'Existing quantity is preserved');
state.availability.set('chair-1',5);
render();
assert.match(picker.innerHTML,/value="8"/);
assert.match(picker.innerHTML,/Requested 8 but only 5 available/);
render(true);
assert.match(picker.innerHTML,/value="0"/,'Fresh booking clears old quantities');

// Exercise the real inquiry conversion handler with a recognized item,
// then with a historical inquiry containing no items.
const begin=js.indexOf('  const parsePreferredTime =');
const stop=js.indexOf('  const showDashboard =',begin);
assert.ok(begin>=0&&stop>begin);
const callbacks=new Map();
const windowMock={addEventListener(n,cb){callbacks.set(n,cb)}};
const fields=Object.fromEntries([
 'websiteInquiryId','customerName','customerEmail','customerPhone',
 'eventCity','eventDate','eventEndDate','serviceType',
 'eventStart','eventEnd','eventAddress','notes'
].map(key=>[key,{value:''}]));
const form={elements:fields,reset(){
 for(const field of Object.values(fields))field.value='';
}};
const summary={hidden:true,innerHTML:''};
const equipmentList={innerHTML:''};
const bookingSource={hidden:true,textContent:''};
const availabilityPicker={querySelectorAll(){return [card]}};
const elements={
 '#booking-inquiry-equipment':summary,
 '#booking-inquiry-equipment-list':equipmentList,
 '#booking-source':bookingSource,
 '#booking-product-picker':availabilityPicker
};
const fakeDocument={querySelectorAll(){return [card]}};
let opened='';
new Function('window','bookingForm','state','renderProductPicker','$',
 'document','escapeHtml','showMessage','bookingMessage','openPanel',
 js.slice(begin,stop)
)(windowMock,form,state,()=>{input.value='0';},sel=>elements[sel],
 fakeDocument,escapeHtml,()=>{}, {},name=>{opened=name;});
const convert=callbacks.get('regal:convert-inquiry');
assert.equal(typeof convert,'function');
const base={
 id:'11111111-2222-4333-8444-555555555555',
 reference:'RR-20261014-1553-67F5',
 name:'Test Renter',email:'customer@example.com',phone:'9165550100',
 event_city:'Cameron Park',event_date:'2026-10-23',
 details:'RENTAL DATES & SERVICES\nRental start (customer pickup): 2026-10-23\nRental end (customer return): 2026-10-23'
};
convert({detail:{...base,items:['8 × White plastic folding chair']}});
assert.equal(fields.websiteInquiryId.value,base.id);
assert.equal(input.value,'8','Quantity from website quote is automatically filled');
assert.match(equipmentList.innerHTML,/8 × White plastic folding chair/);
assert.match(equipmentList.innerHTML,/Quantity filled below/);
assert.match(fields.notes.value,/CUSTOMER REQUESTED EQUIPMENT/);
assert.equal(opened,'new-booking');
convert({detail:{...base,items:[]}});
assert.equal(input.value,'0');
assert.match(equipmentList.innerHTML,/No equipment was selected/);
assert.match(bookingSource.textContent,/did not select any equipment/);
assert.equal(summary.hidden,false);
console.log('Inquiry items are visible, quantities transfer, availability checks preserve selection, and empty quotes are explicit.');
