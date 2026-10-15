import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// A syntax check cannot catch calling .forEach() on querySelector()'s
// single-element return. Execute startup with a small DOM and verify that
// authentication is reached rather than leaving the user at "Verifying…".
const source=fs.readFileSync(new URL('../admin/admin.js',import.meta.url),'utf8');
const makeNode=()=>({
  hidden:false,textContent:'',value:'',addEventListener(){},
  classList:{toggle(){},add(){},remove(){}}
});
const bookingForm=makeNode();
bookingForm.elements={eventDate:makeNode(),eventEndDate:makeNode()};
const nodes=new Map([
 ['#login-view',makeNode()],['#dashboard-view',makeNode()],
 ['#login-message',makeNode()],['#booking-form',bookingForm]
]);
const nav=[makeNode(),makeNode(),makeNode()];
const shortcut=[makeNode(),makeNode()];
const document={
  querySelector(selector){
    if(!nodes.has(selector))nodes.set(selector,makeNode());
    return nodes.get(selector);
  },
  querySelectorAll(selector){
    if(selector==='.nav-button')return nav;
    if(selector==='[data-open-panel]')return shortcut;
    return [];
  }
};
let fetched='';
const window={addEventListener(){}};
const context={document,window,Date,console,
  fetch:async path=>{fetched=path;return new Promise(()=>{});},
  location:{href:''},
  crypto:{randomUUID(){return 'test-uuid';}}
};
vm.runInNewContext(source,context,{filename:'admin.js',timeout:2500});
assert.equal(fetched,'/api/auth/me','Admin startup must reach Cloudflare session check');
assert.equal(bookingForm.elements.eventDate.min.length,10);
console.log('Admin startup reaches session verification with multiple navigation elements.');
