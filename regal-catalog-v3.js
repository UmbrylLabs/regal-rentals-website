(() => {
  const form=document.querySelector('#quote-form');
  const menuButton=document.querySelector('.menu-toggle');
  const nav=document.querySelector('#main-nav');
  const productGrid=document.querySelector('#storefront-products');
  const packageGrid=document.querySelector('#storefront-packages');
  const cartNode=document.querySelector('#quote-cart-items');
  const cartCount=document.querySelector('#quote-cart-count');
  const cartSubtotal=document.querySelector('#quote-cart-subtotal');
  const cartSubtotalLabel=document.querySelector('#quote-cart-subtotal-label');
  const cartTotal=document.querySelector('#quote-cart-total');
  const packageSelect=document.querySelector('#package-select');
  const status=document.querySelector('#form-status');
  const success=document.querySelector('#form-success');
  const reference=document.querySelector('#form-reference');
  const submitButton=form?.querySelector('[type="submit"]');
  const date=form?.elements.namedItem('date');
  const endDate=form?.elements.namedItem('endDate');
  const startTime=form?.elements.namedItem('startTime');
  const endTime=form?.elements.namedItem('endTime');
  const startTimeLabel=document.querySelector('#rental-start-time-label');
  const endTimeLabel=document.querySelector('#rental-end-time-label');
  const serviceDelivery=document.querySelector('#service-delivery');
  const serviceCustomerPickup=document.querySelector('#service-customer-pickup');
  const serviceSetupTeardown=document.querySelector('#service-setup-teardown');
  const serviceSetupWrap=document.querySelector('#service-setup-wrap');
  const serviceHelp=document.querySelector('#quote-services-help');
  const addressWrap=document.querySelector('#delivery-address-wrap');
  const deliveryAddress=document.querySelector('#delivery-address');
  const rentalDateHelp=document.querySelector('#rental-date-help');

  const catalogFilters=document.querySelector('.catalog-chips');
  const catalogEquipment=document.querySelector('#catalog-equipment-group');
  const catalogPackages=document.querySelector('#packages');
  const catalogEmpty=document.querySelector('#catalog-empty');
  const catalogTitle=document.querySelector('#catalog-view-title');
  const catalogStatus=document.querySelector('#catalog-status');
  const catalogQuoteCount=document.querySelector('#catalog-quote-count');
  const catalogQuoteTotal=document.querySelector('#catalog-quote-total');
  const mobileQuoteBar=document.querySelector('#mobile-quote-bar');
  const mobileQuoteCount=document.querySelector('#mobile-quote-count');
  const mobileQuoteTotal=document.querySelector('#mobile-quote-total');
  let activeCategory='all';

  function productCategory(product) {
    const main=String(product.name||'')+' '+String(product.style||'');
    if (/chairs?|seating/i.test(main)) return 'chairs';
    if (/tables?|round-table|rectangle-table/i.test(main)) return 'tables';
    if (/canop(?:y|ies)|tents?|shade|gazebo/i.test(main)) return 'canopies';
    const fallback=String(product.category||'');
    if (/seating|chairs?/i.test(fallback) && !/tables?/i.test(fallback)) return 'chairs';
    if (/tables?/i.test(fallback) && !/chairs?/i.test(fallback)) return 'tables';
    if (/canop(?:y|ies)|tents?|shade/i.test(fallback)) return 'canopies';
    return 'more';
  }
  const categoryTitles={all:'All rentals',packages:'Event packages',chairs:'Folding chairs',tables:'Tables for every gathering',canopies:'Outdoor canopies',more:'More rentals'};

  function cardCategory(card) {
    if(card.dataset.category) return card.dataset.category;
    return productCategory({name:card.querySelector('h3')?.textContent||'',style:'',category:''});
  }

  function applyCatalogFilter() {
    if(!catalogFilters)return;
    const cards=[...(productGrid?.querySelectorAll('.product-card')||[])];
    const packageCards=[...(packageGrid?.querySelectorAll('.package-card')||[])];
    const categories=cards.map(cardCategory);
    const counts={
      all:cards.length+packageCards.length,
      packages:packageCards.length,
      chairs:categories.filter(x=>x==='chairs').length,
      tables:categories.filter(x=>x==='tables').length,
      canopies:categories.filter(x=>x==='canopies').length,
      more:categories.filter(x=>x==='more').length
    };
    catalogFilters.querySelectorAll('[data-catalog-filter]').forEach(button=>{
      const group=button.dataset.catalogFilter;
      const selected=group===activeCategory;
      button.classList.toggle('is-selected',selected);
      button.setAttribute('aria-pressed',String(selected));
      if(group==='more')button.hidden=!counts.more;
      const badge=button.querySelector('[data-filter-count]');
      if(badge)badge.textContent=String(counts[group]||0);
    });
    let shown=0;
    cards.forEach(card=>{
      const match=activeCategory==='all'||cardCategory(card)===activeCategory;
      card.hidden=!match; if(match)shown++;
    });
    const showPackages=activeCategory==='all'||activeCategory==='packages';
    if(showPackages)shown+=packageCards.length;
    if(catalogPackages)catalogPackages.hidden=!showPackages||packageCards.length===0;
    if(catalogEquipment)catalogEquipment.hidden=activeCategory==='packages'||cards.every(card=>card.hidden);
    if(catalogEmpty)catalogEmpty.hidden=shown>0;
    if(catalogTitle)catalogTitle.textContent=categoryTitles[activeCategory]||'Rentals';
    if(catalogStatus)catalogStatus.textContent=shown+' '+(shown===1?'option':'options')+' to explore';
  }
  // Prices come from the published storefront. Quote-priced items remain unpriced here.
  function getCartSummary(){
    const selected=[...cart].map(([id,quantity])=>({product:products.find(p=>p.id===id),id,quantity}))
      .filter(x=>x.product);
    let subtotalCents=0,pricedItems=0,customItems=0;
    for(const {product,quantity} of selected){
      const cents=product.priceCents;
      if(cents===null||cents===undefined||!Number.isSafeInteger(Number(cents))||Number(cents)<0){
        customItems++;
      }else{
        subtotalCents+=Number(cents)*quantity;
        pricedItems++;
      }
    }
    return {selected,units:selected.reduce((sum,item)=>sum+item.quantity,0),
      subtotalCents,pricedItems,customItems};
  }
  function updateQuoteShortcuts(summary=getCartSummary()){
    const distinct=summary.selected.length;
    const hasItems=distinct>0;
    const amount=summary.pricedItems?money(summary.subtotalCents):'';
    const compact=summary.customItems
      ? (summary.pricedItems?'Est. '+amount+' + custom':'Custom quote')
      : 'Est. '+amount;
    if(catalogQuoteCount)catalogQuoteCount.textContent=String(distinct);
    if(catalogQuoteTotal){
      catalogQuoteTotal.hidden=!hasItems;
      catalogQuoteTotal.textContent=hasItems?compact:'';
    }
    if(mobileQuoteBar)mobileQuoteBar.hidden=!hasItems;
    if(mobileQuoteCount)mobileQuoteCount.textContent=distinct+' '+(distinct===1?'item':'items');
    if(mobileQuoteTotal){
      mobileQuoteTotal.hidden=!hasItems;
      mobileQuoteTotal.textContent=hasItems?compact:'';
    }
    if(cartCount)cartCount.textContent=hasItems
      ? String(summary.units)+' unit'+(summary.units===1?'':'s')+' selected'
      : 'No items yet';
    if(cartSubtotal)cartSubtotal.hidden=!hasItems;
    if(cartSubtotalLabel)cartSubtotalLabel.textContent=chosenPackage
      ? 'Estimated item subtotal (before package pricing)'
      : 'Estimated equipment subtotal';
    if(cartTotal)cartTotal.textContent=!hasItems?''
      : (summary.pricedItems?amount+(summary.customItems?' + custom quote':''):'Price by quote');
  }

  let products=[],packages=[],loaded=false,chosenPackage=null;
  const cart=new Map();
  // Quantities are requests, not stock allocations. Owner confirms at booking.
  const MAX_REQUEST_QTY=1000000;
  const qtyChoices=[1,2,4,6,8,10,20,50,100];
  const validQty=value=>Number.isSafeInteger(Number(value))&&Number(value)>=1&&Number(value)<=MAX_REQUEST_QTY;
  const qtyOptions=value=>qtyChoices.map(q=>'<option value="'+q+'"'+(Number(value)===q?' selected':'')+'>'+q+'</option>').join('')+
    '<option value="custom"'+(qtyChoices.includes(Number(value))?'':' selected')+'>Custom…</option>';

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
    return '/assets/regal-official-shield.webp';
  };
  const safePhoto=(value, fallback)=>{
    if(typeof value !=='string')return fallback;
    if(/^\/assets\/[a-zA-Z0-9/_-]+\.(png|jpeg|jpg|webp|svg)$/i.test(value))return value;
    if(/^\/api\/public\/product-photo\?id=[a-z0-9_-]{4,101}&v=[0-9]{10,16}$/i.test(value))return value;
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
  if(!form)return;
  function syncRentalDates() {
    if(date)date.min=today();
    if(!endDate)return;
    endDate.min=date?.value && date.value>today()?date.value:today();
    endDate.setCustomValidity(endDate.value && date?.value && endDate.value<date.value
      ? 'Rental end date must be on or after the start date.' : '');
    syncRentalTimes();
  }
  function syncRentalTimes(){
    if(!endTime)return;
    const sameDay=date?.value && endDate?.value && date.value===endDate.value;
    const start=startTime?.value, end=endTime.value;
    endTime.setCustomValidity(sameDay && start && end && end<=start
      ? 'For a same-day rental, the end time must be later than the start time.' : '');
  }
  function syncServices(source='') {
    if(!serviceDelivery || !serviceCustomerPickup || !serviceSetupTeardown)return;
    // These are presented as checkboxes, but only one fulfillment method is
    // allowed. A setup request is never preserved after switching to pickup.
    if(source==='delivery' && serviceDelivery.checked)serviceCustomerPickup.checked=false;
    if(source==='pickup' && serviceCustomerPickup.checked)serviceDelivery.checked=false;
    const delivery=serviceDelivery.checked;
    const pickup=serviceCustomerPickup.checked;
    if(!delivery){
      serviceSetupTeardown.checked=false;
      if(deliveryAddress)deliveryAddress.value='';
    }
    if(serviceSetupWrap)serviceSetupWrap.hidden=!delivery;
    serviceSetupTeardown.disabled=!delivery;
    if(addressWrap)addressWrap.hidden=!delivery;
    if(deliveryAddress)deliveryAddress.disabled=!delivery;
    serviceDelivery.setCustomValidity(!delivery && !pickup
      ? 'Please select delivery or customer pickup.' : '');
    if(serviceHelp)serviceHelp.textContent=delivery
      ? 'Delivery & collection selected. Setup & teardown is available as an optional extra.'
      : pickup
        ? 'Customer pickup & return selected. Delivery and setup services are not included.'
        : 'Please select delivery or customer pickup to continue.';
    if(startTimeLabel)startTimeLabel.textContent=delivery
      ? 'Preferred Delivery Time (optional)'
      : pickup ? 'Preferred Customer Pickup Time (optional)' : 'Preferred Start Time (optional)';
    if(endTimeLabel)endTimeLabel.textContent=delivery
      ? 'Preferred Collection Time (optional)'
      : pickup ? 'Preferred Return Time (optional)' : 'Preferred End Time (optional)';
    if(rentalDateHelp)rentalDateHelp.textContent=delivery
      ? 'Start: requested delivery date. End: requested collection date. Times are preferences and confirmed with your quote.'
      : pickup
        ? 'Start: customer pickup date. End: customer return date. Times are preferences and confirmed with your quote.'
        : 'Select delivery or customer pickup below. Dates and times are preferences confirmed with your quote.';
  }
  date?.addEventListener('change',syncRentalDates);
  endDate?.addEventListener('change',syncRentalDates);
  startTime?.addEventListener('change',syncRentalTimes);
  endTime?.addEventListener('change',syncRentalTimes);
  serviceDelivery?.addEventListener('change',()=>syncServices('delivery'));
  serviceCustomerPickup?.addEventListener('change',()=>syncServices('pickup'));
  serviceSetupTeardown?.addEventListener('change',()=>syncServices());
  syncRentalDates();
  syncServices();

  function renderCart() {
    const summary=getCartSummary();
    updateQuoteShortcuts(summary);
    cartNode.innerHTML=summary.selected.length?summary.selected.map(({id,product,quantity})=>
      '<div class="quote-line" data-cart-id="'+esc(id)+'"><div class="quote-line__title"><strong>'+
      esc(product.name)+'</strong><span>'+esc(product.priceCents===null?'Custom quote':money(product.priceCents)+' each')+
      '</span></div><div class="quote-line__actions"><label>Qty <input aria-label="Quantity for '+
      esc(product.name)+'" type="number" min="1" step="1" inputmode="numeric" value="'+
      quantity+'" data-cart-qty="'+esc(id)+'"></label><button type="button" data-cart-remove="'+
      esc(id)+'" aria-label="Remove '+esc(product.name)+'">Remove</button></div></div>'
    ).join(''):'<p>Select items or a package above to get started.</p>';
  }
  function addItem(id,quantity=1) {
    const product=products.find(p=>p.id===id);
    if(!product)return;
    const next=(cart.get(id)||0)+quantity;
    if(!validQty(next))return;
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
      '<article class="product-card" data-category="'+esc(productCategory(p))+'"><div class="product-card__image"><img loading="lazy" src="'+
      esc(safePhoto(p.imageUrl,assetFor(p)))+'" alt="'+esc(p.name)+'" width="420" height="290"></div>'+
      '<div class="product-card__details"><h3>'+esc(p.name)+'</h3><p>'+
      esc(p.description||'Ask us about this rental for your event.')+'</p>'+
      '<span class="availability-note">'+(p.priceCents===null?'Price on request':esc(money(p.priceCents)))+
      ' · Availability confirmed by quote</span>'+
      '<div class="product-quantity"><label for="qty-'+esc(p.id)+'">Quantity</label>'+
      '<select data-quantity-preset="'+esc(p.id)+'" aria-label="Quick quantity for '+esc(p.name)+'">'+qtyOptions(1)+'</select>'+
      '<input id="qty-'+esc(p.id)+'" type="number" min="1" step="1" inputmode="numeric" value="1" data-product-quantity="'+esc(p.id)+'" aria-label="Type quantity for '+esc(p.name)+'"></div>'+
      '<button class="add-to-quote" type="button" data-product-add="'+esc(p.id)+'">Add to Quote <span aria-hidden="true">→</span></button></div></article>'
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
      // One-time navigation transfer from the standalone 3D planner. Keep it
      // in the quote form until a successful inquiry so refresh is recoverable.
      if(new URLSearchParams(location.search).get('planner')==='1'){
        try{
          const transfer=JSON.parse(sessionStorage.getItem('regal-planner-quote-v1')||'null');
          if(transfer?.v===1&&Array.isArray(transfer.items)){
            cart.clear();chosenPackage=null;
            for(const line of transfer.items){
              const product=products.find(p=>p.id===line.productId);
              const q=Number(line.quantity);
              if(product&&validQty(q))cart.set(product.id,q);
            }
            if(cart.size){
              const details=form.elements.namedItem('details');
              const link=String(transfer.layoutUrl||'');
              const validLink=link.startsWith(location.origin+'/planner#design=') && link.length<2220;
              const description='3D event layout: '+(validLink?link:'See customer-exported layout file (link too large to include).')+
                '\nPlanned lawn: '+Number(transfer.width||0)+' × '+Number(transfer.length||0)+' ft. Chairs: '+Number(transfer.seats||0)+'.';
              if(details&&description.length<=2500)details.value=description;
              renderCart();
              setStatus('Your 3D layout items were added. Enter your event details to send this quote request.');
            }else{
              setStatus('The planned equipment is no longer published. Please choose currently listed rentals.',true);
            }
          }
        }catch(error){setStatus('Unable to recover this planner layout. Please return to the planner and try again.',true);}
      }
      applyCatalogFilter();
      document.querySelector('#equipment-interest')?.setAttribute('hidden','');
      if(!cart.size)setStatus('Select equipment or a package above, adjust quantities, and send your request.');
    }catch(err){
      // Existing static cards and quote form remain usable if D1 is temporarily down.
      setStatus('Live inventory could not load. You can still request a custom quote below.',true);
    }
  };
  productGrid?.addEventListener('change',event=>{
    const preset=event.target.closest('[data-quantity-preset]');
    if(!preset)return;
    const input=[...productGrid.querySelectorAll('[data-product-quantity]')].find(x=>x.dataset.productQuantity===preset.dataset.quantityPreset);
    if(!input)return;
    if(preset.value!=='custom')input.value=preset.value;
    else {input.focus();input.select();}
  });
  productGrid?.addEventListener('input',event=>{
    const field=event.target.closest('[data-product-quantity]');
    if(!field)return;
    const preset=[...productGrid.querySelectorAll('[data-quantity-preset]')].find(x=>x.dataset.quantityPreset===field.dataset.productQuantity);
    if(preset)preset.value=qtyChoices.includes(Number(field.value))?field.value:'custom';
  });
  productGrid?.addEventListener('click',event=>{
    const btn=event.target.closest('[data-product-add]');
    if(!btn)return;
    const input=[...productGrid.querySelectorAll('[data-product-quantity]')].find(x=>x.dataset.productQuantity===btn.dataset.productAdd);
    const quantity=Number(input?.value||1);
    if(!validQty(quantity)){
      setStatus('Enter a valid whole-number quantity before adding this item.',true);
      input?.focus();return;
    }
    addItem(btn.dataset.productAdd,quantity);
    btn.textContent='Added — Add more →';
    setStatus('Added '+quantity+' item(s) to your quote list. Final quantities are confirmed before booking.');
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
    if(!validQty(n))return;
    cart.set(p.id,n);updateQuoteShortcuts();
  });
  cartNode?.addEventListener('change',event=>{
    const input=event.target.closest('[data-cart-qty]');if(!input)return;
    const p=products.find(x=>x.id===input.dataset.cartQty);if(!p)return;
    const n=validQty(input.value)?Number(input.value):(cart.get(p.id)||1);
    cart.set(p.id,n);renderCart();
  });
  cartNode?.addEventListener('click',event=>{
    const btn=event.target.closest('[data-cart-remove]');if(!btn)return;
    cart.delete(btn.dataset.cartRemove);
    if(!cart.size){chosenPackage=null;if(packageSelect)packageSelect.value='';}
    renderCart();
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
    syncRentalDates();
    syncServices();
    success.hidden=true;submitButton.hidden=false;
    setStatus('Select equipment or a package and send your request.');
    form.elements.name.focus();
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    syncRentalDates();
    syncServices();
    if(!form.reportValidity()||submitButton.disabled)return;
    // A quote with no equipment cannot populate a booking. Stop it before
    // submission instead of showing a misleading successful request.
    const selectedInFallback=[...form.querySelectorAll('[name="item"]:checked')].length > 0;
    const selectedPackageInFallback=!!packageSelect?.value;
    if(loaded ? (!cart.size && !chosenPackage) : (!selectedInFallback && !selectedPackageInFallback)){
      setStatus('Please add at least one rental item or package before requesting a quote.',true);
      document.querySelector('#form-status')?.scrollIntoView({behavior:'smooth',block:'center'});
      return;
    }
    const fields=new FormData(form);
    const payload={
      name:String(fields.get('name')||'').trim(),
      email:String(fields.get('email')||'').trim(),
      phone:String(fields.get('phone')||'').trim(),
      date:String(fields.get('date')||''),
      startTime:String(fields.get('startTime')||''),
      endDate:String(fields.get('endDate')||''),
      endTime:String(fields.get('endTime')||''),
      city:String(fields.get('city')||'').trim(),
      delivery:!!serviceDelivery?.checked,
      customerPickup:!!serviceCustomerPickup?.checked,
      setup:!!serviceDelivery?.checked && !!serviceSetupTeardown?.checked,
      teardown:!!serviceDelivery?.checked && !!serviceSetupTeardown?.checked,
      deliveryAddress:serviceDelivery?.checked?String(fields.get('deliveryAddress')||'').trim():'',
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
      try{sessionStorage.removeItem('regal-planner-quote-v1');}catch{}
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
  catalogFilters?.addEventListener('click',event=>{
    const chip=event.target.closest('[data-catalog-filter]');
    if(!chip)return;
    activeCategory=chip.dataset.catalogFilter;
    applyCatalogFilter();
  });
  document.querySelector('[data-catalog-reset]')?.addEventListener('click',()=>{
    activeCategory='all';applyCatalogFilter();
  });
  document.querySelectorAll('.main-nav a[href="#packages"]').forEach(link=>{
    link.addEventListener('click',()=>{activeCategory='packages';applyCatalogFilter();});
  });
  document.querySelectorAll('.main-nav a[href="#equipment"],.hero__actions a[href="#equipment"]').forEach(link=>{
    link.addEventListener('click',()=>{activeCategory='all';applyCatalogFilter();});
  });
  applyCatalogFilter();
  updateQuoteShortcuts();
  load();
})();
