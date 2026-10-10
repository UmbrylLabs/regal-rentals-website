(() => {
  const tab=document.querySelector('[data-panel="packages"]');
  const form=document.querySelector('#storefront-package-form');
  const listing=document.querySelector('#storefront-packages-list');
  const productsNode=document.querySelector('#storefront-package-products');
  const listMsg=document.querySelector('#storefront-package-list-message');
  const msg=document.querySelector('#storefront-package-message');
  if(!tab||!form)return;
  let packages=[],products=[];
  const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#39;');
  const money=c=>c==null?'Quote only':(Number(c)/100).toLocaleString('en-US',{style:'currency',currency:'USD'});
  const api=async(path,options={})=>{
    const res=await fetch(path,{credentials:'same-origin',headers:{'Content-Type':'application/json'},...options});
    const body=await res.json();
    if(!res.ok||!body.ok)throw Error(body?.error?.message||'Request failed');
    return body;
  };
  const inventorySelect=document.querySelector('#package-inventory-select');
  const inventoryQty=document.querySelector('#package-inventory-add-qty');
  const inventoryAdd=document.querySelector('#add-package-inventory-item');
  const selectedItems=new Map();
  const validQty=value=>Number.isSafeInteger(Number(value))&&Number(value)>=1&&Number(value)<=1000000;

  function renderInventoryOptions(){
    const remaining=products.filter(p=>Number(p.active)&&!selectedItems.has(p.id));
    inventorySelect.innerHTML='<option value="">Choose an inventory item…</option>'+
      remaining.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+' (owned: '+
        Number(p.quantity_owned)+')</option>').join('');
    inventorySelect.disabled=!remaining.length;
    inventoryAdd.disabled=!remaining.length;
  }
  function renderSelectedItems(){
    if(!selectedItems.size) {
      productsNode.innerHTML='<p class="message">No equipment added yet. Select an item above and click Add Item.</p>';
    } else {
      productsNode.innerHTML=[...selectedItems].map(([id,qty])=>{
        const p=products.find(item=>item.id===id);
        const name=p?.name||'Inventory item no longer found';
        const detail=p?(Number(p.active)?'Owned: '+Number(p.quantity_owned):'Archived · remove to publish'):'No longer in inventory';
        return '<div class="package-product-option" data-package-line="'+esc(id)+'">'+
          '<span><strong>'+esc(name)+'</strong><small>'+esc(detail)+'</small></span>'+
          '<label>Qty <input aria-label="Quantity of '+esc(name)+'" data-package-product-id="'+esc(id)+
          '" type="number" min="1" step="1" inputmode="numeric" value="'+qty+'"></label>'+
          '<button type="button" class="button button--quiet" data-package-item-remove="'+esc(id)+'" aria-label="Remove '+esc(name)+'">Remove</button>'+
          '</div>';
      }).join('');
    }
    renderInventoryOptions();
  }
  function renderSelectItems(selected=[]){
    selectedItems.clear();
    for(const item of selected) {
      if(item.productId && validQty(item.quantity)) selectedItems.set(item.productId,Number(item.quantity));
    }
    renderSelectedItems();
  }
  inventoryAdd.addEventListener('click',()=>{
    const id=inventorySelect.value;
    const product=products.find(p=>p.id===id&&Number(p.active));
    if(!product){msg.textContent='Choose an item from Inventory first.';return;}
    if(!validQty(inventoryQty.value)){
      msg.textContent='Enter a positive whole-number quantity.';inventoryQty.focus();return;
    }
    selectedItems.set(id,Number(inventoryQty.value));
    msg.textContent='';
    inventoryQty.value='1';
    renderSelectedItems();
  });
  productsNode.addEventListener('click',event=>{
    const button=event.target.closest('[data-package-item-remove]');
    if(!button)return;
    selectedItems.delete(button.dataset.packageItemRemove);
    renderSelectedItems();
  });
  productsNode.addEventListener('change',event=>{
    const input=event.target.closest('[data-package-product-id]');
    if(!input)return;
    if(validQty(input.value)){
      selectedItems.set(input.dataset.packageProductId,Number(input.value));
      msg.textContent='';
    } else {
      msg.textContent='Package quantities must be positive whole numbers.';
      input.focus();
    }
  });
  const renderList=()=>{
    listing.innerHTML=packages.length?packages.map(p=>{
      const contents=(p.items||[]).map(line=>{
        const prod=products.find(x=>x.id===line.productId);
        return String(Number(line.quantity))+' × '+(prod?.name||'Unavailable inventory item');
      }).join(', ')||'No items selected';
      return '<article class="package-admin-card"><div><strong>'+esc(p.name)+'</strong>'+
        '<span class="package-state '+(p.active?'package-state--live':'')+'">'+(p.active?'Published':'Draft')+'</span></div>'+
        '<p>'+esc(p.description||'No description')+'</p><p>'+esc(contents)+'</p><p><b>'+
        esc(money(p.priceCents))+'</b> · Display order '+Number(p.sortOrder)+'</p>'+
        '<div class="package-admin-actions"><button type="button" class="button button--secondary" data-package-edit="'+esc(p.id)+'">Edit</button>'+
        (p.active?'<button type="button" class="button button--quiet" data-package-unpublish="'+esc(p.id)+'">Unpublish</button>':'')+
        '</div></article>';
    }).join(''):'<div class="card">No packages yet. Click “Add Package” to create one.</div>';
  };
  const load=async()=>{
    listMsg.textContent='Loading packages…';
    try{
      const [catalog,results]=await Promise.all([api('/api/admin/products'),api('/api/admin/packages')]);
      products=catalog.products||[];packages=results.packages||[];
      listMsg.textContent='Published packages update the homepage automatically when customers open or refresh it.';
      renderList();
    }catch(e){listMsg.textContent=e.message;}
  };
  const edit=p=>{
    form.reset();
    form.elements.id.value=p?.id||'';
    form.elements.name.value=p?.name||'';
    form.elements.description.value=p?.description||'';
    form.elements.imageUrl.value=p?.imageUrl||'';
    form.elements.price.value=p?.priceCents==null?'':(Number(p.priceCents)/100).toFixed(2);
    form.elements.sortOrder.value=String(p?.sortOrder??100);
    form.elements.active.checked=Boolean(p?.active);
    renderSelectItems(p?.items||[]);
    document.querySelector('#storefront-package-form-title').textContent=p?'Edit Package':'Add Package';
    msg.textContent='';
    form.hidden=false;
    form.scrollIntoView({behavior:'smooth',block:'start'});
  };
  document.querySelector('#new-storefront-package').addEventListener('click',()=>edit(null));
  document.querySelector('#cancel-storefront-package').addEventListener('click',()=>{form.hidden=true;});
  tab.addEventListener('click',load);
  listing.addEventListener('click',async event=>{
    const editButton=event.target.closest('[data-package-edit]');
    if(editButton){edit(packages.find(p=>p.id===editButton.dataset.packageEdit));return;}
    const unpublish=event.target.closest('[data-package-unpublish]');
    if(!unpublish)return;
    if(!confirm('Hide this package from the public website?'))return;
    unpublish.disabled=true;
    try{
      await api('/api/admin/packages',{method:'DELETE',body:JSON.stringify({id:unpublish.dataset.packageUnpublish})});
      await load();
    }catch(e){listMsg.textContent=e.message;unpublish.disabled=false;}
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(!form.reportValidity())return;
    const inputs=[...productsNode.querySelectorAll('[data-package-product-id]')];
    if(inputs.some(input=>!validQty(input.value))){
      msg.textContent='Please enter a positive whole-number quantity for each included item.';
      inputs.find(input=>!validQty(input.value))?.focus();
      return;
    }
    const items=inputs.map(input=>({
      productId:input.dataset.packageProductId,quantity:Number(input.value)
    }));
    if(form.elements.active.checked&&!items.length){
      msg.textContent='Select at least one inventory item before publishing.';return;
    }
    const price=String(form.elements.price.value).trim();
    const payload={
      id:form.elements.id.value||undefined,
      name:form.elements.name.value,
      description:form.elements.description.value,
      imageUrl:form.elements.imageUrl.value,
      sortOrder:Number(form.elements.sortOrder.value),
      priceCents:price===''?null:Math.round(Number(price)*100),
      items,active:form.elements.active.checked
    };
    const save=document.querySelector('#save-storefront-package');
    save.disabled=true;msg.textContent='Saving package…';
    try{
      await api('/api/admin/packages',{method:payload.id?'PATCH':'POST',body:JSON.stringify(payload)});
      form.hidden=true;msg.textContent='';await load();
    }catch(e){msg.textContent=e.message;}
    finally{save.disabled=false;}
  });
})();
