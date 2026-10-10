import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const js = fs.readFileSync(new URL('../admin/storefront-packages.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../admin/index.html', import.meta.url), 'utf8');

for (const id of [
  'package-inventory-select','package-inventory-search','package-inventory-browser',
  'package-inventory-status','refresh-package-inventory','package-inventory-add-qty',
  'add-package-inventory-item','storefront-package-products'
]) assert.ok(html.includes('id="' + id + '"'), 'Missing editor element: ' + id);

function element() {
  return {
    events:{},dataset:{},value:'',textContent:'',innerHTML:'',hidden:false,disabled:false,
    addEventListener(type,fn){this.events[type]=fn;},
    focus(){},scrollIntoView(){},reset(){},
    replaceChildren(...nodes){this.options=nodes;this.value='';},
    querySelector(){return null},
    querySelectorAll(){return []}
  };
}
const ids = [
  '[data-panel="packages"]','#storefront-package-form','#storefront-packages-list',
  '#storefront-package-products','#storefront-package-list-message',
  '#storefront-package-message','#package-inventory-select','#package-inventory-add-qty',
  '#add-package-inventory-item','#new-storefront-package','#save-storefront-package',
  '#package-inventory-browser','#package-inventory-status','#package-inventory-search',
  '#refresh-package-inventory','#storefront-package-form-title',
  '#cancel-storefront-package'
];
const nodes = Object.fromEntries(ids.map(id=>[id,element()]));
const fields = Object.fromEntries(['id','name','description','imageUrl','price','sortOrder','active']
  .map(name=>[name,element()]));
fields.sortOrder.value='100';
nodes['#storefront-package-form'].querySelector = selector => {
  const match = selector.match(/^\[name="(.+)"\]$/);
  return fields[match?.[1]] || null;
};
nodes['#storefront-package-form'].reportValidity=()=>true;
nodes['#package-inventory-add-qty'].value='1';

let saved=null;
const products = [{
  id:'chairs-1',sku:'CHAIRS_001',name:'White Folding Chairs',
  category:'Tables & Chairs',quantity_owned:100,active:1
}];
const fetched=[];
const fetch=async (url,opts={})=>{
  fetched.push(url);
  if(url.endsWith('/products')) return {ok:true,json:async()=>({ok:true,products})};
  if(url.endsWith('/packages') && opts.method==='POST'){
    saved=JSON.parse(opts.body);
    return {ok:true,json:async()=>({ok:true,id:'package-1'})};
  }
  if(url.endsWith('/packages'))return {ok:true,json:async()=>({ok:true,packages:[]})};
  throw Error('Unexpected fetch ' + url);
};
const document={
  querySelector:selector=>nodes[selector]||null,
  createElement:tag=>({value:'',textContent:'',tag}),
};
vm.runInNewContext(js,{document,fetch,confirm:()=>true,console});

const addPackage = nodes['#new-storefront-package'];
assert.equal(typeof addPackage.events.click,'function');
await addPackage.events.click();
const picker=nodes['#package-inventory-select'];
const browser=nodes['#package-inventory-browser'];
assert.equal(picker.options.length,2,'One active item must produce a real native option');
assert.equal(picker.options[1].value,'chairs-1');
assert.match(picker.options[1].textContent,/White Folding Chairs/);
assert.match(browser.innerHTML,/White Folding Chairs/,'Active item must appear in visible list');
assert.match(browser.innerHTML,/data-package-pick="chairs-1"/);
assert.equal(nodes['#storefront-package-form'].hidden,false);
assert.match(nodes['#package-inventory-status'].textContent,/1 inventory item available/);

const button=nodes['#package-inventory-browser'];
assert.equal(typeof button.events.click,'function','Quick-add inventory list must be wired');
button.events.click({target:{closest:selector=>
  selector==='[data-package-pick]'?{dataset:{packagePick:'chairs-1'}}:null
}});
assert.match(nodes['#storefront-package-products'].innerHTML,/White Folding Chairs/);
assert.match(nodes['#storefront-package-products'].innerHTML,/value="1"/);
assert.match(nodes['#package-inventory-status'].textContent,/already included/);

console.log('Package editor renders a single active inventory item in native select and visible list; one-tap add works.');
