import assert from 'node:assert/strict';
import fs from 'node:fs';
import {onRequestPost} from '../functions/api/public/inquiry.js';

// Exercise the actual UI synchronization function with checkbox-shaped objects
// so contradictory states and stale setup values cannot regress.
const source=fs.readFileSync(new URL('../regal-catalog-v3.js',import.meta.url),'utf8');
const start=source.indexOf('  function syncServices(');
const end=source.indexOf('  date?.addEventListener',start);
assert.ok(start>0&&end>start,'Quote services synchronization exists');
const fake=()=>({checked:false,hidden:false,disabled:false,value:'',textContent:'',validity:'',
  setCustomValidity(message){this.validity=message;}});
const delivery=fake(),pickup=fake(),setup=fake(),setupWrap=fake(),addressWrap=fake(),
  address=fake(),help=fake(),startLabel=fake(),endLabel=fake(),dateHelp=fake();
const syncServices=new Function(
 'serviceDelivery','serviceCustomerPickup','serviceSetupTeardown',
 'serviceSetupWrap','addressWrap','deliveryAddress','serviceHelp',
 'startTimeLabel','endTimeLabel','rentalDateHelp',
 source.slice(start,end)+'\nreturn syncServices;'
)(delivery,pickup,setup,setupWrap,addressWrap,address,help,startLabel,endLabel,dateHelp);

syncServices();
assert.equal(delivery.validity,'Please select delivery or customer pickup.');
assert.equal(setupWrap.hidden,true);
assert.equal(addressWrap.hidden,true);
assert.equal(setup.disabled,true);

delivery.checked=true;
syncServices('delivery');
assert.equal(pickup.checked,false);
assert.equal(delivery.validity,'');
assert.equal(setupWrap.hidden,false);
assert.equal(addressWrap.hidden,false);
assert.equal(setup.disabled,false);
assert.match(startLabel.textContent,/Delivery/);

setup.checked=true;
address.value='123 Event Road';
pickup.checked=true;
syncServices('pickup');
assert.equal(delivery.checked,false);
assert.equal(setup.checked,false,'Do not carry setup into customer pickup');
assert.equal(setupWrap.hidden,true);
assert.equal(setup.disabled,true);
assert.equal(addressWrap.hidden,true);
assert.equal(address.value,'','Old delivery address is cleared');
assert.equal(address.disabled,true);
assert.equal(delivery.validity,'');
assert.match(startLabel.textContent,/Customer Pickup/);
assert.match(endLabel.textContent,/Return/);

delivery.checked=true;
syncServices('delivery');
assert.equal(pickup.checked,false,'Selecting delivery automatically clears customer pickup');

delivery.checked=false;
syncServices('delivery');
assert.equal(delivery.validity,'Please select delivery or customer pickup.');
assert.equal(setup.checked,false);

const base={
 name:'Sample Renter',email:'test@example.org',city:'Folsom',
 date:'2099-07-03',endDate:'2099-07-04',
 deliveryAddress:'',setup:false,teardown:false,items:[],selectedItems:[],
 package:'',details:'',startTime:'',endTime:'',website:''
};
async function attempt(fields){
 const request=new Request('https://regal.rentals/api/public/inquiry',{
  method:'POST',headers:{'Content-Type':'application/json',Origin:'https://regal.rentals'},
  body:JSON.stringify({...base,...fields})
 });
 const res=await onRequestPost({request,env:{DB:{}},waitUntil(){}});
 return {status:res.status,body:await res.json()};
}
for(const fields of [
 {delivery:false,customerPickup:false},
 {delivery:true,customerPickup:true},
 {delivery:true,customerPickup:'true'}
]){
 const {status,body}=await attempt(fields);
 assert.equal(status,400);
 assert.match(body.error.message,/either delivery or customer pickup/);
}
{
 const {status,body}=await attempt({delivery:false,customerPickup:true,setup:true,teardown:true});
 assert.equal(status,400);
 assert.match(body.error.message,/required for setup/);
}
console.log('Quote delivery and customer pickup exclusivity, conditional setup, and API validation passed.');
