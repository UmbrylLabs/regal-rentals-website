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
assert.match(accepted.json.reference,/^RR-[A-F0-9]{8}$/);
assert.equal(accepted.calls.filter(c=>c.sql.includes('INSERT INTO website_inquiries (')).length,1);
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
console.log('Website inquiry API: validation, rate limit, origin and persistence checks passed.');
