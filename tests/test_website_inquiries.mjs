import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/public/inquiry.js';

function mockDB({denyRate=false}={}) {
  const calls = [];
  const db = {
    prepare(sql) {
      const statement = {
        bind(...args) { this.args = args; return this; },
        async run() {
          calls.push({sql,args:this.args||[]});
          return {meta:{changes:denyRate && sql.includes('website_inquiry_rate(ip_hash') ? 0 : 1}};
        }
      };
      return statement;
    }
  };
  return {db,calls};
}
const valid = {
  name:'Test Customer',
  email:'Test@Example.com',
  date:'2026-11-21',
  city:'Cameron Park',
  package:'Backyard Essentials',
  items:['White folding chairs','60-inch round tables'],
  phone:'',
  details:'Interested in delivery.',
  website:''
};
async function submit(body, {origin='https://regal.rentals',denyRate=false}={}) {
  const {db,calls}=mockDB({denyRate});
  const request = new Request('https://regal.rentals/api/public/inquiry',{
    method:'POST',
    headers:{Origin:origin,'content-type':'application/json','cf-connecting-ip':'203.0.113.11'},
    body:JSON.stringify(body)
  });
  const response = await onRequestPost({
    request,
    env:{DB:db,IP_HASH_PEPPER:'test-pepper'},
    waitUntil(){throw Error('Email notification not configured');}
  });
  return {status:response.status,json:await response.json(),calls};
}
const accepted=await submit(valid);
assert.equal(accepted.status,201);
assert.equal(accepted.json.ok,true);
assert.match(accepted.json.reference,/^RR-\d{8}-\d{4}-[A-F0-9]{4}$/);
const savedRef=accepted.calls.find(c=>c.sql.includes('INSERT INTO website_inquiries (')).args[1];
assert.equal(savedRef,accepted.json.reference,'Customer and admin must see the same saved reference');
const another=await submit(valid);
assert.notEqual(accepted.json.reference,another.json.reference,'Consecutive quote inquiries get unique references');
assert.equal(accepted.calls.filter(c=>c.sql.includes('INSERT INTO website_inquiries (')).length,1);
const emptyEquipment=await submit({...valid,items:[],package:'',selectedItems:[],packageId:''});
assert.equal(emptyEquipment.status,400,'Requests cannot omit equipment entirely');
assert.match(emptyEquipment.json.error.message,/select at least one rental item or package/i);
assert.equal(emptyEquipment.calls.some(c=>c.sql.includes('INSERT INTO website_inquiries (')),false);
const badEmail=await submit({...valid,email:'not-an-email'});
assert.equal(badEmail.status,400);
assert.equal(badEmail.calls.length,0);
const crossOrigin=await submit(valid,{origin:'https://evil.example'});
assert.equal(crossOrigin.status,403);
assert.equal(crossOrigin.calls.length,0);
const honeypot=await submit({...valid,website:'spam'});
assert.equal(honeypot.status,400);
assert.equal(honeypot.calls.length,0);
const repeated=await submit(valid,{denyRate:true});
assert.equal(repeated.status,429);
assert.equal(repeated.calls.some(c=>c.sql.includes('INSERT INTO website_inquiries (')),false);
const invalidItems=await submit({...valid,items:['unapproved expensive product']});
assert.equal(invalidItems.status,400);
const invalidDate=await submit({...valid,date:'2026-02-30'});
assert.equal(invalidDate.status,400);
// New requests capture both dates and enforce delivery for setup/teardown.
const withServices={...valid,endDate:'2026-11-23',startTime:'10:00',endTime:'17:00',
  delivery:true,setup:true,teardown:true,
  deliveryAddress:'123 Celebration Way, Folsom'};
const serviceResult=await submit(withServices);
assert.equal(serviceResult.status,201);
const serviceWrite=serviceResult.calls.find(c=>c.sql.includes('INSERT INTO website_inquiries ('));
assert.ok(serviceWrite);
assert.equal(serviceWrite.args[5],'2026-11-21');
assert.match(serviceWrite.args[9],/Rental start \(Regal delivery\): 2026-11-21/);
assert.match(serviceWrite.args[9],/Rental end \(Regal collection\): 2026-11-23/);
assert.match(serviceWrite.args[9],/Preferred delivery time: 10:00 AM/);
assert.match(serviceWrite.args[9],/Preferred collection time: 5:00 PM/);
assert.match(serviceWrite.args[9],/Equipment setup & teardown: Requested/);
assert.match(serviceWrite.args[9],/123 Celebration Way, Folsom/);
const selfPickup=await submit({...withServices,delivery:false,setup:false,teardown:false,
  deliveryAddress:''});
assert.equal(selfPickup.status,201);
assert.match(selfPickup.calls.find(c=>c.sql.includes('INSERT INTO website_inquiries (')).args[9],
  /customer pickup and return requested/);
assert.match(selfPickup.calls.find(c=>c.sql.includes('INSERT INTO website_inquiries (')).args[9],
  /Equipment setup & teardown: Not requested/);
assert.match(selfPickup.calls.find(c=>c.sql.includes('INSERT INTO website_inquiries (')).args[9],
  /Preferred customer pickup time: 10:00 AM/);
assert.match(selfPickup.calls.find(c=>c.sql.includes('INSERT INTO website_inquiries (')).args[9],
  /Preferred return time: 5:00 PM/);
const flexible=await submit({...withServices,startTime:'',endTime:''});
assert.equal(flexible.status,201);
assert.match(flexible.calls.find(c=>c.sql.includes('INSERT INTO website_inquiries (')).args[9],
  /Preferred delivery time: Flexible \/ Any time/);
const sameDay=await submit({...withServices,endDate:withServices.date});
assert.equal(sameDay.status,201);
const sameDayWrongOrder=await submit({...withServices,endDate:withServices.date,startTime:'17:00',endTime:'10:00'});
assert.equal(sameDayWrongOrder.status,400);
const sameDaySameTime=await submit({...withServices,endDate:withServices.date,startTime:'10:00',endTime:'10:00'});
assert.equal(sameDaySameTime.status,400);
const sameDayFlexible=await submit({...withServices,endDate:withServices.date,startTime:'',endTime:'08:00'});
assert.equal(sameDayFlexible.status,201);
const invalidTime=await submit({...withServices,startTime:'20:00'});
assert.equal(invalidTime.status,400);
const invalidMinute=await submit({...withServices,endTime:'10:30'});
assert.equal(invalidMinute.status,400);
const invalidTimeType=await submit({...withServices,startTime:1000});
assert.equal(invalidTimeType.status,400);
const badEnd=await submit({...withServices,endDate:'2026-11-20'});
assert.equal(badEnd.status,400);
const impossibleEnd=await submit({...withServices,endDate:'2026-02-30'});
assert.equal(impossibleEnd.status,400);
const noEnd=await submit({...withServices,endDate:''});
assert.equal(noEnd.status,400);
const conflictingServices=await submit({...withServices,delivery:false});
assert.equal(conflictingServices.status,400);
const invalidServiceType=await submit({...withServices,delivery:'true'});
assert.equal(invalidServiceType.status,400);
console.log('Website inquiry API: validation, rate limit, origin and persistence checks passed.');
