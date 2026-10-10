(() => {
  const form=document.querySelector('#quote-form');
  const menuButton=document.querySelector('.menu-toggle');
  const nav=document.querySelector('#main-nav');
  const productGrid=document.querySelector('#storefront-products');
  const packageGrid=document.querySelector('#storefront-packages');
  const cartNode=document.querySelector('#quote-cart-items');
  const cartCount=document.querySelector('#quote-cart-count');
  const packageSelect=document.querySelector('#package-select');
  const status=document.querySelector('#form-status');
  const success=document.querySelector('#form-success');
  const reference=document.querySelector('#form-reference');
  const submitButton=form?.querySelector('[type="submit"]');
  const date=form?.elements.namedItem('date');
  let products=[],packages=[],loaded=false,chosenPackage=null;
  const cart=new Map();

  const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#39;');
  const today=()=>{
    const d=new Date(),pad=x=>String(x).padStart(2,'0');
    return [d.getFullYear(),pad(d.getMonth()+1),pad(d.getDate())].join('-');
  };
  const money=c=>c===null?'Price by quote':(Number(c)/100).toLocaleString('en-US',{style:'currency',currency:'USD'});
  const assetFor=p=>{
    const s=String(p.style||'').toLowerCase();
    if(s==='chair')return '/assets/regal-chair.svg';
    if(s==='round-table')return '/assets/regal-round-table.svg';
    if(s==='rectangle-table')return '/assets/regal-rectangle-table.svg';
    if(s==='canopy'||s==='tent')return /10\s*[x×]\s*20/i.test(p.name)?'/assets/regal-canopy-20.svg':'/assets/regal-canopy-10.svg';
    return '/assets/regal-shield.png';
  };
  const safePhoto=(value, fallback)=>{
    if(typeof value !=='string')return fallback;
    if(/^\/assets\/[a-zA-Z0-9/_-]+\.(png|jpeg|jpg|webp|svg)$/i.test(value))return value;
    try {const u=new URL(value);if(u.protocol==='https:'&&!u.username&&!u.password)return u.href;}catch{}
    return fallback;
  };
  const setStatus=(msg,error=false)=>{
    if(!status)return;status.textContent=msg;status.classList.toggle('form-status--error',error);
  };
  const closeMenu=()=>{
    document.body.classList.remove('menu-open');
    menuButton?.setAttribute('aria-expanded','false');
  };
  menuButton?.addEventListener('click',()=>{
    const open=document.body.classList.toggle('menu-open');
    menuButton.setAttribute('aria-expanded',String(open));
    menuButton.setAttribute('aria-label',open?'Close menu':'Open menu');
  });
  nav?.querySelectorAll('a').forEach(a=>a.addEventListener('click',closeMenu));
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenu();});
  const year=document.querySelector('#year');if(year)year.textContent=String(new Date().getFullYear());
  if(date)date.min=today();
  if(!form)return;

  function renderCart() {
    const selected=[...cart].map(([id,quantity])=>({product:products.find(p=>p.id===id),id,quantity}))
      .filter(x=>x.product);
    const units=selected.reduce((sum,item)=>sum+item.quantity,0);
    cartCount.textContent=selected.length?String(units)+' unit'+(units===1?'':'s')+' selected':'No items yet';
    cartNode.innerHTML=selected.length?selected.map(({id,product,quantity})=>
      '<div class="quote-line" data-cart-id="'+esc(id)+'"><div class="quote-line__title"><strong>'+
      esc(product.name)+'</strong><span>'+esc(product.priceCents===null?'Custom quote':money(product.priceCents)+' each')+
      '</span></div><div class="quote-line__actions"><label>Qty <input aria-label="Quantity for '+
      esc(product.name)+'" type="number" min="1" max="'+Number(product.quantityOwned)+'" step="1" value="'+
      quantity+'" data-cart-qty="'+esc(id)+'"></label><button type="button" data-cart-remove="'+
      esc(id)+'" aria-label="Remove '+esc(product.name)+'">Remove</button></div></div>'
    ).join(''):'<p>Select items or a package above to get started.</p>';
  }
  function addItem(id,quantity=1) {
    const product=products.find(p=>p.id===id);
    if(!product)return;
    const next=Math.min(product.quantityOwned,(cart.get(id)||0)+quantity);
    if(next<1)return;
    cart.set(id,next);renderCart();
  }
  function choosePackage(pkg) {
    if(!pkg)return;
    // Choosing a bundle replaces the previous selection to avoid silently
    // counting two bundles; additional individual items can be added afterward.
    cart.clear();
    for(const item of pkg.items) addItem(item.productId,item.quantity);
    chosenPackage=pkg;
    if(packageSelect)packageSelect.value=pkg.id;
    renderCart();
  }
  function renderProducts() {
    if(!productGrid)return;
    productGrid.innerHTML=products.map(p=>
      '<article class="product-card"><div class="product-card__image"><img loading="lazy" src="'+
      esc(safePhoto(p.imageUrl,assetFor(p)))+'" alt="'+esc(p.name)+'" width="420" height="290"></div>'+
      '<div class="product-card__details"><h3>'+esc(p.name)+'</h3><p>'+
      esc(p.description||'Ask us about this rental for your event.')+'</p>'+
      '<span class="availability-note">'+(p.priceCents===null?'Price on request':esc(money(p.priceCents)))+
      ' · '+Number(p.quantityOwned)+' owned</span><button class="add-to-quote" type="button" data-product-add="'+
      esc(p.id)+'">Add to Quote <span aria-hidden="true">→</span></button></div></article>'
    ).join('');
    if(!products.length)productGrid.innerHTML='<p>No rental items are currently published. Contact us about upcoming availability.</p>';
  }
  function renderPackages() {
    if(!packageGrid)return;
    // Retain the launch example packages until the owner publishes the first
    // real configured bundle through admin.
    if(!packages.length)return;
    packageGrid.innerHTML=packages.map(pkg=>{
      const lines=pkg.items.map(item=>{
        const p=products.find(x=>x.id===item.productId);
        return Number(item.quantity)+' × '+(p?.name||'Equipment');
      });
      return '<article class="package-card"><div class="package-card__picture"><img loading="lazy" src="'+
        esc(safePhoto(pkg.imageUrl,'/assets/regal-canopy-20.svg'))+'" alt="'+esc(pkg.name)+'" width="420" height="260"></div>'+
        '<div class="package-card__body"><span class="package-card__label">'+
        esc(pkg.priceCents===null?'PERSONALIZED QUOTE':money(pkg.priceCents))+'</span><h3>'+esc(pkg.name)+'</h3>'+
        (pkg.description?'<p class="package-card__description">'+esc(pkg.description)+'</p>':'')+
        '<ul>'+lines.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>'+
        '<button type="button" class="package-to-quote" data-package-add="'+esc(pkg.id)+
        '">Add Package to Quote <span aria-hidden="true">→</span></button></div></article>';
    }).join('');
    if(packageSelect){
      packageSelect.innerHTML='<option value="">Custom rental / no package</option>'+
        packages.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>').join('');
    }
  }
  const load=async()=>{
    try {
      const res=await fetch('/api/public/storefront',{headers:{Accept:'application/json'},cache:'no-store'});
      const data=await res.json();
      if(!res.ok||!data.ok)throw Error('Unable to refresh the current rental catalog');
      products=Array.isArray(data.products)?data.products:[];
      packages=Array.isArray(data.packages)?data.packages:[];
      loaded=true;
      renderProducts();renderPackages();renderCart();
      document.querySelector('#equipment-interest')?.setAttribute('hidden','');
      setStatus('Select equipment or a package above, adjust quantities, and send your request.');
    }catch(err){
      // Existing static cards and quote form remain usable if D1 is temporarily down.
      setStatus('Live inventory could not load. You can still request a custom quote below.',true);
    }
  };
  productGrid?.addEventListener('click',event=>{
    const btn=event.target.closest('[data-product-add]');
    if(!btn)return;addItem(btn.dataset.productAdd);
    btn.textContent='Added — Add one more →';
    setStatus('Added to your quote list. Adjust quantities below if needed.');
  });
  packageGrid?.addEventListener('click',event=>{
    const btn=event.target.closest('[data-package-add]');
    if(!btn)return;
    choosePackage(packages.find(p=>p.id===btn.dataset.packageAdd));
    setStatus('Package added. You can adjust equipment quantities before sending.');
  });
  cartNode?.addEventListener('input',event=>{
    const input=event.target.closest('[data-cart-qty]');if(!input)return;
    const p=products.find(x=>x.id===input.dataset.cartQty);
    if(!p)return;
    const n=Number(input.value);
    if(!Number.isInteger(n)||n<1||n>p.quantityOwned)return;
    cart.set(p.id,n);cartCount.textContent=String([...cart.values()].reduce((a,b)=>a+b,0))+' units selected';
  });
  cartNode?.addEventListener('change',event=>{
    const input=event.target.closest('[data-cart-qty]');if(!input)return;
    const p=products.find(x=>x.id===input.dataset.cartQty);if(!p)return;
    const n=Math.min(p.quantityOwned,Math.max(1,Number(input.value)||1));
    cart.set(p.id,n);renderCart();
  });
  cartNode?.addEventListener('click',event=>{
    const btn=event.target.closest('[data-cart-remove]');if(!btn)return;
    cart.delete(btn.dataset.cartRemove);renderCart();
  });
  packageSelect?.addEventListener('change',()=>{
    if(!loaded)return;
    const pkg=packages.find(p=>p.id===packageSelect.value);
    if(pkg)choosePackage(pkg);
    else chosenPackage=null;
  });
  document.querySelector('#new-inquiry')?.addEventListener('click',()=>{
    form.reset();cart.clear();chosenPackage=null;renderCart();
    form.querySelectorAll('input,select,textarea').forEach(e=>e.disabled=false);
    if(date)date.min=today();
    success.hidden=true;submitButton.hidden=false;
    setStatus('Select equipment or a package and send your request.');
    form.elements.name.focus();
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(date)date.min=today();
    if(!form.reportValidity()||submitButton.disabled)return;
    const fields=new FormData(form);
    const payload={
      name:String(fields.get('name')||'').trim(),
      email:String(fields.get('email')||'').trim(),
      phone:String(fields.get('phone')||'').trim(),
      date:String(fields.get('date')||''),
      city:String(fields.get('city')||'').trim(),
      package:loaded&&packages.length?'':String(fields.get('package')||''),
      packageId:loaded&&chosenPackage?chosenPackage.id:'',
      items:loaded?[]:fields.getAll('item').map(String),
      selectedItems:loaded?[...cart].map(([productId,quantity])=>({productId,quantity})):[],
      details:String(fields.get('details')||'').trim(),
      website:String(fields.get('website')||'')
    };
    const label=submitButton.querySelector('span:first-child');
    const oldLabel=label?.textContent;
    submitButton.disabled=true;if(label)label.textContent='Sending request…';
    setStatus('Submitting your quote request…');
    try{
      const res=await fetch('/api/public/inquiry',{
        method:'POST',credentials:'same-origin',
        headers:{'Content-Type':'application/json',Accept:'application/json'},
        body:JSON.stringify(payload)
      });
      const data=await res.json();
      if(!res.ok||!data.ok)throw Error(data?.error?.message||'Could not send your inquiry.');
      reference.textContent=data.reference||'Received';
      success.hidden=false;submitButton.hidden=true;
      form.querySelectorAll('input,select,textarea').forEach(e=>e.disabled=true);
      setStatus('Your quote request was received.');
      success.scrollIntoView({behavior:'smooth',block:'nearest'});
    }catch(err){
      setStatus(String(err.message||'Request failed')+' Please try again or email bookings@regal.rentals.',true);
    }finally{
      submitButton.disabled=false;if(label)label.textContent=oldLabel;
    }
  });
  // Fallback launch cards still respond to clicks while the catalog is loading.
  document.querySelectorAll('#storefront-products [data-item]').forEach(link=>{
    link.addEventListener('click',()=>{
      const target=[...form.querySelectorAll('[name="item"]')].find(el=>el.value===link.dataset.item);
      if(target)target.checked=true;
    });
  });
  document.querySelectorAll('#storefront-packages [data-package]').forEach(link=>{
    link.addEventListener('click',()=>{
      if((!loaded||!packages.length)&&packageSelect)packageSelect.value=link.dataset.package;
    });
  });
  load();
})();
