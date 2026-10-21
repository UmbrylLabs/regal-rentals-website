(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const canvas = $('scene'), wrap = $('canvas-wrap'), ctx = canvas.getContext('2d');
  const LS_KEY = 'regal-planner-design-v1';
  const QUOTE_KEY = 'regal-planner-quote-v1';
  const clamp = (v,a,b) => Math.min(b,Math.max(a,v));
  const snap = n => Math.round(n * 2) / 2;
  const round = n => Math.round(n * 10) / 10;
  const money = cents => (cents / 100).toLocaleString('en-US',{style:'currency',currency:'USD'});
  const esc = s => String(s ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let width = 60, length = 50, products = [], catalogReady = false;
  let items = [], selected = null, activeFilter = 'all', serial = 0, dragging = null;
  let view = {yaw:0.64,elev:0.82,dist:94,cx:0,cz:0};
  let cw = 900, ch = 550, ratio = 1, dirty = true, toastTimer;
  const uid = () => 'p' + (++serial) + '-' + Date.now().toString(36);

  function classify(p) {
    const name = String(p.name || ''), style = String(p.style || ''), category = String(p.category || '');
    const text = name + ' ' + style + ' ' + category;
    if (/canop|tent|gazebo/i.test(text)) {
      const match = name.match(/(\d{1,3})\s*[x×]\s*(\d{1,3})/i);
      const w = match ? clamp(+match[1],5,60) : 10;
      const d = match ? clamp(+match[2],5,80) : 10;
      return {kind:'canopy',w,d,h:8.4,label:Math.round(w) + ' × ' + Math.round(d) + ' ft'};
    }
    if (/round[- ]?table|round\b/i.test(text) && /table/i.test(text)) return {kind:'round',w:5,d:5,h:2.5,label:'5 ft diameter'};
    if (/rectang|6[- ]?foot|6['′]|folding table|banquet table/i.test(text) && /table/i.test(text)) return {kind:'rectangle',w:6,d:2.5,h:2.5,label:'6 × 2.5 ft'};
    if (/chair|seating/i.test(text)) return {kind:'chair',w:1.65,d:1.7,h:2.8,label:'1.65 × 1.7 ft'};
    return null;
  }
  function decorate(raw) {
    const dims = classify(raw);
    if (!dims) return null;
    return Object.assign({}, raw, dims);
  }
  function productOf(item) { return products.find(p => p.id === item.pid); }
  function placedInfo(item) { return productOf(item) || {name:'Unavailable equipment',kind:'rectangle',w:4,d:3,h:2.5,priceCents:null}; }
  function countById() {
    const counts = new Map();
    items.forEach(o => counts.set(o.pid,(counts.get(o.pid) || 0) + 1));
    return counts;
  }
  function notify(message) {
    const el = $('toast');
    el.textContent = message; el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {el.hidden = true;},4200);
  }
  function saveLocal() {
    try {localStorage.setItem(LS_KEY,JSON.stringify(serialize()));} catch {}
  }
  function serialize() {
    return {v:1,w:width,l:length,o:items.map(o => [o.pid,round(o.x),round(o.z),o.r])};
  }
  function adopt(raw) {
    if (!raw || raw.v !== 1 || !Array.isArray(raw.o) || raw.o.length > 250 ||
      !Number.isFinite(+raw.w) || !Number.isFinite(+raw.l)) throw Error('Invalid design file.');
    const w = clamp(Math.round(+raw.w),20,200), l = clamp(Math.round(+raw.l),20,200);
    const restored = [];
    for (const a of raw.o) {
      if (!Array.isArray(a) || a.length !== 4 || !products.some(p => p.id === a[0])) continue;
      if (![a[1],a[2],a[3]].every(Number.isFinite)) continue;
      restored.push({key:uid(),pid:a[0],x:clamp(a[1],-200,200),z:clamp(a[2],-200,200),r:((a[3] % 360)+360)%360});
    }
    width = w;length = l; items = restored; selected = null;
    $('lawn-width').value = width; $('lawn-length').value = length;
    renderAll();saveLocal();
  }

  function catalogIcon(kind) {
    if (kind === 'canopy') return '<svg viewBox="0 0 40 36" aria-hidden="true"><path d="M4 16 20 4 36 16 M7 16h26M9 16v17m22-17v17M20 4v29M3 33h34"/></svg>';
    if (kind === 'chair') return '<svg viewBox="0 0 40 36" aria-hidden="true"><path d="M11 3v20h18V3M11 15h18M11 23l-2 10m20-10 2 10M11 22l-2-5m20 5 2-5"/></svg>';
    if (kind === 'round') return '<svg viewBox="0 0 40 36" aria-hidden="true"><ellipse cx="20" cy="12" rx="16" ry="7"/><path d="M20 19v13m-10 0h20M8 16l2 16m22-16-2 16"/></svg>';
    return '<svg viewBox="0 0 40 36" aria-hidden="true"><path d="m4 12 26-7 6 10-26 7Z M10 22v11m26-18v18M4 12v17m26-24v16"/></svg>';
  }
  function renderCatalog() {
    const shown = products.filter(p => activeFilter === 'all' || p.kind === activeFilter ||
      (activeFilter === 'table' && (p.kind === 'rectangle' || p.kind === 'round')));
    $('catalog').innerHTML = shown.map(p => '<div class="catalog-item"><div class="catalog-item-icon">' + catalogIcon(p.kind) +
      '</div><div class="catalog-item-body"><h3>' + esc(p.name) + '</h3><small>' + esc(p.label) +
      '</small><span class="catalog-price">' + (Number.isInteger(p.priceCents) ? money(p.priceCents) : 'Price by quote') +
      '</span></div><button type="button" class="catalog-add" data-add="' + esc(p.id) + '" aria-label="Add ' +
      esc(p.name) + ' to event">+</button></div>').join('') ||
      '<p class="empty-list">No published equipment in this category.</p>';
  }
  function updateCounts() {
    const counts = countById();
    let cents = 0, custom = 0, seats = 0;
    counts.forEach((n,id) => {
      const p = products.find(x => x.id === id);
      if (!p) return;
      if (p.kind === 'chair') seats += n;
      if (Number.isInteger(p.priceCents) && p.priceCents >= 0) cents += p.priceCents * n;
      else custom += n;
    });
    $('object-count').textContent = items.length + (items.length === 1 ? ' piece' : ' pieces');
    $('total-pieces').textContent = String(items.length);
    $('total-seats').textContent = String(seats);
    $('subtotal').textContent = money(cents) + (custom ? ' + custom' : '');
    $('custom-pricing').hidden = !custom;
    $('request-quote').disabled = $('request-quote-top').disabled = !catalogReady || items.length === 0;
    return counts;
  }
  function corners(o,p) {
    const a = o.r * Math.PI / 180, co = Math.cos(a), si = Math.sin(a);
    const hx = p.w/2, hz = p.d/2;
    return [[-hx,-hz],[hx,-hz],[hx,hz],[-hx,hz]].map(v => [o.x+v[0]*co-v[1]*si,o.z+v[0]*si+v[1]*co]);
  }
  function collide(a,b) {
    const pa=placedInfo(a),pb=placedInfo(b);
    if ((pa.kind === 'canopy') !== (pb.kind === 'canopy')) return false; // Equipment may sit beneath shade.
    const ca=corners(a,pa), cb=corners(b,pb);
    const axes=[];
    for (const poly of [ca,cb]) for (let i=0;i<2;i++) {
      const e=[poly[i+1][0]-poly[i][0],poly[i+1][1]-poly[i][1]];
      const norm=Math.hypot(e[0],e[1])||1;
      axes.push([-e[1]/norm,e[0]/norm]);
    }
    for (const [nx,nz] of axes) {
      const va=ca.map(v=>v[0]*nx+v[1]*nz),vb=cb.map(v=>v[0]*nx+v[1]*nz);
      if(Math.max(...va)<=Math.min(...vb)+.12 || Math.max(...vb)<=Math.min(...va)+.12) return false;
    }
    return true;
  }
  function isOutside(o) {return corners(o,placedInfo(o)).some(p=>Math.abs(p[0])>width/2+.01 || Math.abs(p[1])>length/2+.01);}
  function overlaps(o) {return items.some(x=>x!==o && collide(o,x));}
  function refreshWarnings(counts) {
    let collisions=0, outside=0;
    for(let i=0;i<items.length;i++){
      if(isOutside(items[i]))outside++;
      for(let j=i+1;j<items.length;j++)if(collide(items[i],items[j]))collisions++;
    }
    let stock=0;
    counts.forEach((n,id)=>{const p=products.find(x=>x.id===id);if(p&&Number.isInteger(p.quantityOwned)&&n>p.quantityOwned)stock++;});
    const notes=[];
    if(collisions)notes.push(collisions + ' possible equipment overlap' + (collisions===1?'':'s') + '.');
    if(outside)notes.push(outside + ' item' + (outside===1?' is':'s are') + ' beyond the lawn boundary.');
    if(stock)notes.push(stock + ' equipment type' + (stock===1?'':'s') + ' exceeds listed stock; Regal Rentals must confirm.');
    $('warning-box').hidden=!notes.length;
    $('warning-box').textContent=notes.join(' ');
    return {collisions,outside};
  }
  function renderSelection() {
    const el=$('selection-panel'), o=items.find(x=>x.key===selected);
    if(!o){el.innerHTML='<div class="selection-empty"><span class="selection-icon">✦</span><strong>Nothing selected</strong><p>Add equipment from the left or tap an item in the scene.</p></div>';return;}
    const p=placedInfo(o);
    el.innerHTML='<div class="selected-name">' + esc(p.name) + '</div><div class="selected-info">' +
      esc(p.label) + ' · Rotation ' + o.r + '°</div>' +
      '<div class="selected-controls"><button type="button" data-rotate="-15" aria-label="Rotate left 15 degrees">↶ −15°</button><button type="button" data-rotate="15" aria-label="Rotate right 15 degrees">↷ +15°</button></div>' +
      '<div class="position-fields"><label>Left / right (ft)<input type="number" id="selected-x" min="-200" max="200" step="0.5" value="' + o.x + '"></label>' +
      '<label>Front / back (ft)<input type="number" id="selected-z" min="-200" max="200" step="0.5" value="' + o.z + '"></label></div>' +
      '<div class="selection-actions"><button type="button" id="duplicate-item">Duplicate</button><button class="delete" type="button" id="delete-item">Remove</button></div>';
  }
  function renderList() {
    const list=$('object-list');
    if(!items.length){list.innerHTML='<p class="empty-list">Start by adding something from the catalog.</p>';return;}
    // Group identical equipment but retain individually selectable placements.
    list.innerHTML=items.map((o,i)=>'<button type="button" data-select="' + esc(o.key) + '" class="object-row' +
      (selected===o.key?' selected':'') + '"><span>' + (i+1) + '. ' + esc(placedInfo(o).name) +
      '</span><small>' + round(o.x) + ', ' + round(o.z) + ' ft</small></button>').join('');
  }
  function renderAll(){const counts=updateCounts();refreshWarnings(counts);renderSelection();renderList();dirty=true;}
  function choose(key){selected=key;renderAll();}
  function findSpot(p) {
    const step = Math.max(2,Math.min(p.w,p.d)+.7);
    const spots = [[0,0]];
    for(let ring=1;ring<=18;ring++) {
      for(let x=-ring;x<=ring;x++) for(let z=-ring;z<=ring;z++) {
        if(Math.max(Math.abs(x),Math.abs(z))!==ring)continue;
        spots.push([x*step,z*step]);
      }
    }
    for(const [x,z] of spots){
      const candidate={pid:p.id,x:snap(x),z:snap(z),r:0};
      if(!isOutside(candidate) && !overlaps(candidate))return [candidate.x,candidate.z];
    }
    return [0,0];
  }
  function add(id) {
    if(items.length>=200){notify('This layout has reached its 200-item limit.');return;}
    const p=products.find(x=>x.id===id);
    if(!p)return;
    const [x,z]=findSpot(p);
    const o={key:uid(),pid:id,x,z,r:0};
    items.push(o);selected=o.key;renderAll();saveLocal();
  }
  function removeSelected(){items=items.filter(x=>x.key!==selected);selected=null;renderAll();saveLocal();}
  function duplicate(){const o=items.find(x=>x.key===selected);if(!o)return;add(o.pid);}
  function rotate(n){const o=items.find(x=>x.key===selected);if(!o)return;o.r=(o.r+n+360)%360;renderAll();saveLocal();}

  // Project real 3D coordinates (x, height, depth in feet) through a perspective camera.
  function cameraBasis() {
    const {yaw,elev,dist,cx,cz}=view, sy=Math.sin(yaw),cy=Math.cos(yaw),se=Math.sin(elev),ce=Math.cos(elev);
    return {out:[sy*ce,se,cy*ce],right:[cy,0,-sy],up:[-sy*se,ce,-cy*se],pos:[cx+sy*ce*dist,se*dist,cz+cy*ce*dist],scale:ch*1.43};
  }
  let camera = cameraBasis();
  function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
  function project(x,y,z) {
    const d=[x-view.cx,y,z-view.cz],dep=view.dist-dot(d,camera.out);
    if(dep<=.05)return null;
    return {x:cw/2+dot(d,camera.right)*camera.scale/dep,y:ch/2-dot(d,camera.up)*camera.scale/dep,dep};
  }
  function onGround(px,py) {
    const u=(px-cw/2)/camera.scale, v=(ch/2-py)/camera.scale;
    const ray=[-camera.out[0]+camera.right[0]*u+camera.up[0]*v,
      -camera.out[1]+camera.right[1]*u+camera.up[1]*v,
      -camera.out[2]+camera.right[2]*u+camera.up[2]*v];
    if(ray[1]>=-.002)return null;
    const t=-camera.pos[1]/ray[1];
    return {x:camera.pos[0]+ray[0]*t,z:camera.pos[2]+ray[2]*t};
  }
  function path(points,fill,stroke,linewidth=1,alpha=1){
    const ps=points.map(p=>project(p[0],p[1],p[2]));
    if(ps.some(p=>!p))return;
    ctx.save();ctx.globalAlpha=alpha;ctx.beginPath();ctx.moveTo(ps[0].x,ps[0].y);
    for(let i=1;i<ps.length;i++)ctx.lineTo(ps[i].x,ps[i].y);
    ctx.closePath();
    if(fill){ctx.fillStyle=fill;ctx.fill();}
    if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=linewidth;ctx.stroke();}
    ctx.restore();
  }
  function line(a,b,color,width=1,alpha=1) {
    const p=project(...a),q=project(...b);if(!p||!q)return;
    ctx.save();ctx.globalAlpha=alpha;ctx.strokeStyle=color;ctx.lineWidth=width;
    ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();ctx.restore();
  }
  function worldPoint(o,dx,y,dz){
    const r=o.r*Math.PI/180,c=Math.cos(r),s=Math.sin(r);
    return [o.x+dx*c-dz*s,y,o.z+dx*s+dz*c];
  }
  // Painter-sorted faces keep tables, chairs and pop-up tents dimensionally consistent.
  const faces=[];
  function face(o,coords,color,stroke,alpha=1) {
    const points=coords.map(v=>worldPoint(o,...v));
    const depth=points.reduce((n,p)=>n+dot([p[0],p[1],p[2]],camera.out),0)/points.length;
    faces.push({points,color,stroke,alpha,depth});
  }
  function box(o,x,y,z,w,h,d,colors) {
    const a=x-w/2,b=x+w/2,t=y+h/2,bm=y-h/2,c=z-d/2,e=z+d/2;
    face(o,[[a,t,c],[b,t,c],[b,t,e],[a,t,e]],colors[0],'#00000012');
    face(o,[[a,bm,c],[a,t,c],[a,t,e],[a,bm,e]],colors[1]||colors[0],'#0000000b');
    face(o,[[b,bm,c],[b,t,c],[b,t,e],[b,bm,e]],colors[2]||colors[1]||colors[0],'#0000000b');
    face(o,[[a,bm,e],[b,bm,e],[b,t,e],[a,t,e]],colors[3]||colors[2]||colors[0],'#0000000b');
    face(o,[[a,bm,c],[b,bm,c],[b,t,c],[a,t,c]],colors[2]||colors[0],'#0000000b');
  }
  function generateModel(o) {
    const p=placedInfo(o), w=p.w,d=p.d;
    if(p.kind==='canopy'){
      const roof=7.2,peak=10.2;
      for(const x of [-w/2+.18,w/2-.18])for(const z of [-d/2+.18,d/2-.18]){
        box(o,x,roof/2,z,.20,roof,.20,['#f6f4ed','#a5aaa8','#777f7e']);
        box(o,x,roof-.15,z,.38,.14,.38,['#ddd6ca','#bcb7ad','#d0c8bb']);
      }
      face(o,[[-w/2,roof,-d/2],[w/2,roof,-d/2],[0,peak,0]],'#f6f3e9','#dedbd3',.94);
      face(o,[[w/2,roof,-d/2],[w/2,roof,d/2],[0,peak,0]],'#dedfdc','#c8cac6',.94);
      face(o,[[w/2,roof,d/2],[-w/2,roof,d/2],[0,peak,0]],'#ffffff','#d4d8d3',.92);
      face(o,[[-w/2,roof,d/2],[-w/2,roof,-d/2],[0,peak,0]],'#e8e7e0','#c8c9c3',.93);
      for(const x of [-w/2,w/2]){
        face(o,[[x,roof,-d/2],[x,roof,d/2],[x,roof-.6,d/2],[x,roof-.6,-d/2]],'#fffef8','#d5d1c8',.93);
      }
      for(const z of [-d/2,d/2]){
        face(o,[[-w/2,roof,z],[w/2,roof,z],[w/2,roof-.6,z],[-w/2,roof-.6,z]],'#f9f8f3','#d5d1c8',.95);
      }
    }else if(p.kind==='round'){
      box(o,0,1.35,0,.32,2.7,.32,['#adaaa2','#888981','#a0a39d']);
      for(let i=0;i<12;i++){
        const a=i*Math.PI/6,b=(i+1)*Math.PI/6;
        face(o,[[0,2.51,0],[w/2*Math.cos(a),2.51,d/2*Math.sin(a)],[w/2*Math.cos(b),2.51,d/2*Math.sin(b)]],
          i%2===0?'#fffefa':'#f3eee8','#e9e0d8');
        face(o,[[w/2*Math.cos(a),2.38,d/2*Math.sin(a)],[w/2*Math.cos(a),2.51,d/2*Math.sin(a)],
          [w/2*Math.cos(b),2.51,d/2*Math.sin(b)],[w/2*Math.cos(b),2.38,d/2*Math.sin(b)]],
          '#eee7df','#d8d1c9');
      }
    }else if(p.kind==='rectangle'){
      for(const x of [-w/2+.45,w/2-.45])for(const z of [-d/2+.27,d/2-.27])
        box(o,x,1.18,z,.16,2.36,.16,['#b2ada8','#91908d','#aba6a0']);
      box(o,0,2.43,0,w,.2,d,['#faf8f4','#ddd8d1','#e9e4dd']);
    }else if(p.kind==='chair'){
      const shade=['#fcfcfb','#dedddc','#e9e8e5'];
      for(const x of [-.62,.62])for(const z of [-.58,.58])
        box(o,x,.75,z,.13,1.5,.13,['#dcdedd','#a6aaa8','#bec2bf']);
      box(o,0,1.58,0,1.45,.18,1.42,shade);
      box(o,0,2.27,-.67,1.44,1.2,.16,shade);
    }
  }
  function drawTrees() {
    const positions=[[-width/2-11,-length/2-10],[width/2+13,-length/2-15],[-width/2-15,length/2+10],[width/2+12,length/2+14]];
    for(const [x,z] of positions){
      const tree={x,z,r:0};
      box(tree,0,3.2,0,1.4,6.4,1.4,['#917558','#745a43','#806247']);
      for(let layer=0;layer<3;layer++){
        const y=5.7+layer*2.1,r=4.8-layer*.65;
        for(let j=0;j<8;j++){
          const a=j*Math.PI/4,b=(j+1)*Math.PI/4;
          face(tree,[[r*Math.cos(a),y,r*Math.sin(a)],[r*Math.cos(b),y,r*Math.sin(b)],[0,y+3.8,0]],
            ['#5c8b61','#648f65','#709d72','#4f825b'][j%4],null,1);
        }
      }
    }
  }
  function paint() {
    dirty=false;
    camera=cameraBasis();
    ctx.clearRect(0,0,cw,ch);
    const gradient=ctx.createLinearGradient(0,0,0,ch);
    gradient.addColorStop(0,'#e8f0f1');gradient.addColorStop(1,'#cddfdd');
    ctx.fillStyle=gradient;ctx.fillRect(0,0,cw,ch);
    // Large background lawn and a distinct buildable plot.
    path([[-width/2-22,-.14,-length/2-22],[width/2+22,-.14,-length/2-22],[width/2+22,-.14,length/2+22],[-width/2-22,-.14,length/2+22]],'#9ebd9b',null);
    path([[-width/2,0,-length/2],[width/2,0,-length/2],[width/2,0,length/2],[-width/2,0,length/2]],'#bad5a7','#f9fbf5',2);
    for(let x=-width/2;x<=width/2+.01;x+=5)line([x,.02,-length/2],[x,.02,length/2],x%10===0?'#dceccd':'#d0e2c3',x%10===0?1.2:.7,.8);
    for(let z=-length/2;z<=length/2+.01;z+=5)line([-width/2,.02,z],[width/2,.02,z],z%10===0?'#dceccd':'#d0e2c3',z%10===0?1.2:.7,.8);
    // Draw subtle contact shadows to make placement legible.
    for(const o of items){
      const p=placedInfo(o), corners2=corners(o,p);
      path(corners2.map(v=>[v[0]+.5,.04,v[1]+.6]),'#456644',null,1,.17);
    }
    faces.length=0;
    drawTrees();
    for(const o of items)generateModel(o);
    faces.sort((a,b)=>b.depth-a.depth);
    for(const f of faces)path(f.points,f.color,f.stroke, .9,f.alpha);
    for(const o of items){
      const p=placedInfo(o), bounds=corners(o,p),bad=isOutside(o)||overlaps(o),active=o.key===selected;
      if(active||bad) {
        const poly=bounds.map(a=>[a[0],.10,a[1]]);
        path(poly,active?'#f3d57433':null,bad?'#dd5454':'#b88425',active?2.5:2,1);
      }
    }
    // Small scale marker in the upper left that tracks actual perspective.
    const a=project(-width/2,.05,length/2),b=project(-width/2+10,.05,length/2);
    if(a&&b&&Math.abs(a.x-b.x)<220){ctx.fillStyle='#59735c';ctx.font='bold 10px DM Sans,Arial';ctx.fillText('10 ft',Math.min(a.x,b.x),Math.max(35,Math.min(ch-12,a.y-8)));}
  }
  function resize() {
    const r=wrap.getBoundingClientRect();
    cw=Math.max(220,r.width);ch=Math.max(280,r.height);
    ratio=Math.min(window.devicePixelRatio||1,2);
    canvas.width=Math.round(cw*ratio);canvas.height=Math.round(ch*ratio);
    ctx.setTransform(ratio,0,0,ratio,0,0);dirty=true;paint();
  }
  function pointFromEvent(e){const r=canvas.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};}
  function inPoly(x,y,poly) {
    let inside=false;
    for(let i=0,j=poly.length-1;i<poly.length;j=i++){
      const a=poly[i],b=poly[j];
      if((a.y>y)!==(b.y>y) && x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)inside=!inside;
    }return inside;
  }
  function pick(x,y) {
    for(let i=items.length-1;i>=0;i--){
      const o=items[i],p=placedInfo(o),h=p.kind==='canopy'?7.5:p.kind==='chair'?1.55:2.5;
      const verts=corners(o,p).map(a=>project(a[0],h,a[1]));
      const ground=corners(o,p).map(a=>project(a[0],0,a[1]));
      if(verts.every(Boolean) && (inPoly(x,y,verts) || (ground.every(Boolean)&&inPoly(x,y,ground))))return o;
      const center=project(o.x,h,o.z);
      if(center&&Math.hypot(center.x-x,center.y-y)<Math.max(12,Math.min(34,25*94/view.dist)))return o;
    }return null;
  }
  canvas.addEventListener('pointerdown',e=>{
    if(e.button!==0)return;
    const pt=pointFromEvent(e),o=pick(pt.x,pt.y),g=onGround(pt.x,pt.y);
    if(o){
      choose(o.key);
      dragging={mode:'item',startX:pt.x,startY:pt.y,key:o.key,dx:o.x-(g?.x||o.x),dz:o.z-(g?.z||o.z)};
    }else{
      dragging={mode:'orbit',startX:pt.x,startY:pt.y,yaw:view.yaw,elev:view.elev};
      if(selected)choose(null);
    }
    canvas.setPointerCapture(e.pointerId);canvas.classList.add('dragging');
  });
  canvas.addEventListener('pointermove',e=>{
    if(!dragging)return;
    const pt=pointFromEvent(e);
    if(dragging.mode==='item'){
      const o=items.find(x=>x.key===dragging.key),g=onGround(pt.x,pt.y);
      if(o&&g){o.x=snap(g.x+dragging.dx);o.z=snap(g.z+dragging.dz);dirty=true;}
    }else{
      view.yaw=dragging.yaw+(pt.x-dragging.startX)*.009;
      view.elev=clamp(dragging.elev+(pt.y-dragging.startY)*.006,.28,1.55);
      dirty=true;
    }
  });
  function finishDrag(){
    if(!dragging)return;
    const wasItem=dragging.mode==='item';dragging=null;canvas.classList.remove('dragging');
    if(wasItem){renderAll();saveLocal();}
  }
  canvas.addEventListener('pointerup',finishDrag);
  canvas.addEventListener('pointercancel',finishDrag);
  canvas.addEventListener('lostpointercapture',finishDrag);
  canvas.addEventListener('wheel',e=>{e.preventDefault();view.dist=clamp(view.dist*Math.exp(e.deltaY*.0012),32,250);dirty=true;},{passive:false});
  canvas.addEventListener('keydown',e=>{
    const o=items.find(x=>x.key===selected);if(!o)return;
    const moves={ArrowLeft:[-.5,0],ArrowRight:[.5,0],ArrowUp:[0,-.5],ArrowDown:[0,.5]};
    if(moves[e.key]){e.preventDefault();o.x+=moves[e.key][0];o.z+=moves[e.key][1];renderAll();saveLocal();}
    if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();removeSelected();}
  });
  function setView(mode){
    view.yaw=mode==='top'?0:0.64;view.elev=mode==='top'?1.54:.82;view.dist=mode==='top'?86:94;
    for(const key of ['3d','top']){$('view-'+key).classList.toggle('active',key===mode);$('view-'+key).setAttribute('aria-pressed',String(key===mode));}
    $('scene-mode').textContent=(mode==='top'?'Top view':'Perspective')+' · 5 ft grid';dirty=true;
  }
  $('view-3d').addEventListener('click',()=>setView('3d'));
  $('view-top').addEventListener('click',()=>setView('top'));
  $('reset-camera').addEventListener('click',()=>{view.cx=0;view.cz=0;setView('3d');});
  $('zoom-in').addEventListener('click',()=>{view.dist=clamp(view.dist*.83,32,250);dirty=true;});
  $('zoom-out').addEventListener('click',()=>{view.dist=clamp(view.dist*1.2,32,250);dirty=true;});
  $('catalog').addEventListener('click',e=>{const id=e.target.closest('[data-add]')?.dataset.add;if(id)add(id);});
  $('equipment-categories').addEventListener('click',e=>{
    const btn=e.target.closest('[data-filter]');if(!btn)return;
    activeFilter=btn.dataset.filter;
    $('equipment-categories').querySelectorAll('[data-filter]').forEach(b=>{
      b.classList.toggle('active',b===btn);b.setAttribute('aria-pressed',String(b===btn));
    });renderCatalog();
  });
  $('selection-panel').addEventListener('click',e=>{
    const btn=e.target.closest('button');if(!btn)return;
    if(btn.dataset.rotate)rotate(Number(btn.dataset.rotate));
    if(btn.id==='delete-item')removeSelected();
    if(btn.id==='duplicate-item')duplicate();
  });
  $('selection-panel').addEventListener('change',e=>{
    const o=items.find(x=>x.key===selected);if(!o)return;
    if(e.target.id==='selected-x'||e.target.id==='selected-z'){
      const prop=e.target.id==='selected-x'?'x':'z';
      if(Number.isFinite(e.target.valueAsNumber))o[prop]=snap(clamp(e.target.valueAsNumber,-200,200));
      renderAll();saveLocal();
    }
  });
  $('object-list').addEventListener('click',e=>{const key=e.target.closest('[data-select]')?.dataset.select;if(key)choose(key);});
  for(const id of ['lawn-width','lawn-length'])$(id).addEventListener('change',()=>{
    const el=$(id),n=el.valueAsNumber;
    if(!Number.isFinite(n)){el.value=id==='lawn-width'?width:length;return;}
    if(id==='lawn-width')width=clamp(Math.round(n),20,200);else length=clamp(Math.round(n),20,200);
    el.value=id==='lawn-width'?width:length;renderAll();saveLocal();
  });
  $('clear-design').addEventListener('click',()=>{
    if(!items.length)return;
    if(!confirm('Clear every item from this event layout?'))return;
    items=[];selected=null;renderAll();saveLocal();
  });

  async function shareUrl() {
    const bytes=new TextEncoder().encode(JSON.stringify(serialize()));
    let data=bytes, prefix='b';
    if(typeof CompressionStream!=='undefined'){
      const stream=new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
      data=new Uint8Array(await new Response(stream).arrayBuffer());prefix='g';
    }
    let binary='';
    for(let i=0;i<data.length;i++)binary+=String.fromCharCode(data[i]);
    const encoded=btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    return location.origin+'/planner#design='+prefix+encoded;
  }
  async function readShared(encoded) {
    const mode=encoded[0];let str=encoded.slice(1).replace(/-/g,'+').replace(/_/g,'/');
    str+='='.repeat((4-str.length%4)%4);
    if(str.length>40000)throw Error('Shared layout is too large.');
    const raw=atob(str),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
    if(mode==='g'){
      if(typeof DecompressionStream==='undefined')throw Error('Your browser cannot open this compressed layout.');
      const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      return JSON.parse(await new Response(stream).text());
    }
    if(mode==='b')return JSON.parse(new TextDecoder().decode(bytes));
    throw Error('Unknown layout format.');
  }
  $('share-design').addEventListener('click',async()=>{
    try {
      const url=await shareUrl();
      if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(url);notify('Shareable layout link copied. Anyone with this link can view the design.');}
      else {window.prompt('Copy this shareable layout link:',url);}
    }catch(err){notify('Could not create the share link. Try exporting the plan.');}
  });
  function download(name,blob){
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
  }
  $('save-design').addEventListener('click',()=>{saveLocal();notify('Design saved on this device. Export a plan to keep a separate copy.');});
  $('export-json').addEventListener('click',()=>download('regal-event-layout.json',new Blob([JSON.stringify(serialize(),null,2)],{type:'application/json'})));
  $('export-image').addEventListener('click',()=>{paint();canvas.toBlob(blob=>{if(blob)download('regal-event-layout.png',blob);else notify('Could not save image.');},'image/png');});
  $('import-json').addEventListener('change',async e=>{
    const file=e.target.files?.[0];if(!file)return;
    try{if(file.size>200000)throw Error('File too large');adopt(JSON.parse(await file.text()));notify('Event layout imported.');}
    catch(err){notify('This file is not a supported Regal event layout.');}
    e.target.value='';
  });

  async function transferQuote(){
    if(!catalogReady||!items.length){notify('Add published equipment to your design first.');return;}
    try{
      const counts=[...countById()].map(([productId,quantity])=>({productId,quantity}));
      const url=await shareUrl();
      const payload={v:1,items:counts,layoutUrl:url,width,length,seats:items.filter(o=>placedInfo(o).kind==='chair').length};
      sessionStorage.setItem(QUOTE_KEY,JSON.stringify(payload));
      window.location.assign('/?planner=1#quote');
    }catch(err){notify('Could not transfer the layout. Check your browser storage settings.');}
  }
  $('request-quote').addEventListener('click',transferQuote);
  $('request-quote-top').addEventListener('click',transferQuote);

  async function initialize(){
    try{
      const response=await fetch('/api/public/storefront',{headers:{Accept:'application/json'},cache:'no-store'});
      const json=await response.json();
      if(!response.ok||!json.ok)throw Error('Live catalog unavailable');
      products=(Array.isArray(json.products)?json.products:[]).map(decorate).filter(Boolean);
      catalogReady=true;
      $('catalog-status').textContent=products.length?'Showing published rental inventory':'No published compatible equipment yet.';
    }catch(err){
      // Example models are for visualization only; quotes cannot be submitted without verified inventory IDs.
      products=[
        {id:'sample-chair',name:'White Folding Chair',style:'chair',priceCents:null,quantityOwned:0},
        {id:'sample-round',name:'60-inch Round Table',style:'round-table',priceCents:null,quantityOwned:0},
        {id:'sample-rect',name:'6-foot Rectangle Table',style:'rectangle-table',priceCents:null,quantityOwned:0},
        {id:'sample-10',name:'10×10 Pop-Up Canopy',style:'canopy',priceCents:null,quantityOwned:0},
        {id:'sample-20',name:'10×20 Pop-Up Canopy',style:'canopy',priceCents:null,quantityOwned:0}
      ].map(decorate).filter(Boolean);
      $('catalog-status').textContent='Preview mode · live catalog temporarily unavailable; quoting disabled.';
    }
    renderCatalog();
    let restored=false;
    if(location.hash.startsWith('#design=')){
      try{const data=await readShared(location.hash.slice(8));adopt(data);restored=true;notify('Shared event layout opened.');}
      catch(err){notify('Could not open the shared layout.');}
    }
    if(!restored){
      try{const raw=localStorage.getItem(LS_KEY);if(raw){adopt(JSON.parse(raw));restored=true;}}catch{}
    }
    renderAll();setView('3d');resize();
    // Rendering runs only when camera or scene changes, not on a continuous battery-draining loop.
    function frame(){if(dirty)paint();requestAnimationFrame(frame);}
    requestAnimationFrame(frame);
  }
  if(typeof ResizeObserver!=='undefined')new ResizeObserver(resize).observe(wrap);
  else window.addEventListener('resize',resize);
  initialize();
})();