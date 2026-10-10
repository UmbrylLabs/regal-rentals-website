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
  function renderSelectItems(selected=[]) {
    const map=new Map(selected.map(i=>[i.productId,Number(i.quantity)]));
    const active=products.filter(p=>Number(p.active)&&Number(p.quantity_owned)>0);
    productsNode.innerHTML=active.length?active.map(p=>
      '<label class="package-product-option"><span><strong>'+esc(p.name)+'</strong><small>Owned: '+
      Number(p.quantity_owned)+' · '+esc(p.sku)+'</small></span><input data-package-product-id="'+esc(p.id)+
      '" type="number" min="0" max="'+Number(p.quantity_owned)+'" step="1" value="'+
      Math.min(Number(p.quantity_owned),map.get(p.id)||0)+'"></label>'
    ).join(''):'<p>No active equipment. Add inventory before creating a published package.</p>';
  }
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
    const items=[...productsNode.querySelectorAll('[data-package-product-id]')].map(input=>({
      productId:input.dataset.packageProductId,quantity:Number(input.value||0)
    })).filter(x=>x.quantity>0);
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
