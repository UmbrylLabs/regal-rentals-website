/* Regal Rentals Design Studio — progressive WebGL renderer.
   The original 2D canvas remains the fallback for unsupported/offline browsers. */
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js';

const canvas = document.getElementById('scene-3d');
if (canvas) {
  try {
    const renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, alpha: false, preserveDrawingBuffer: true,
      powerPreference: 'default'
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.4;
    renderer.setClearColor(0xe2eade, 1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe6ede3);
    scene.fog = new THREE.Fog(0xe6ede3, 165, 320);
    const camera = new THREE.PerspectiveCamera(38.58, 1, 0.1, 700);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x6b805e, 2.25));
    const sunlight = new THREE.DirectionalLight(0xfff4dc, 2.45);
    sunlight.position.set(-40, 78, 55);
    sunlight.castShadow = true;
    sunlight.shadow.mapSize.set(1024, 1024);
    sunlight.shadow.camera.left = -110;
    sunlight.shadow.camera.right = 110;
    sunlight.shadow.camera.top = 110;
    sunlight.shadow.camera.bottom = -110;
    sunlight.shadow.camera.far = 270;
    sunlight.shadow.bias = -0.0004;
    sunlight.shadow.normalBias = 0.025;
    scene.add(sunlight);

    const material = (color, roughness = 0.84, metalness = 0) =>
      new THREE.MeshStandardMaterial({color, roughness, metalness});
    const white = material(0xfffcf6);
    const plastic = material(0xf6f4ee);
    const sideWhite = material(0xecebe4);
    const metal = material(0xb5b9b6, 0.39, 0.53);
    const darkMetal = material(0x949b98, 0.46, 0.49);
    const turf = material(0x91b17d);
    const outerTurf = material(0x849e72);
    const bark = material(0x82654c);
    const leaf = [material(0x668a5f), material(0x789e6b), material(0x537c56)];
    const roofA = new THREE.MeshStandardMaterial({color: 0xfffdf5, side: THREE.DoubleSide, roughness: 0.94});
    const roofB = new THREE.MeshStandardMaterial({color: 0xf1f0e9, side: THREE.DoubleSide, roughness: 0.94});
    const rimGold = new THREE.LineBasicMaterial({color: 0xd9bb79, transparent: true, opacity: 0.87});
    const boxes = new Map();
    const cylinders = new Map();
    const getBox = (w,h,d) => {
      const key = [w,h,d].join(':');
      if (!boxes.has(key)) boxes.set(key, new THREE.BoxGeometry(w,h,d));
      return boxes.get(key);
    };
    const getCylinder = (radiusTop,radiusBottom,height,segments=18) => {
      const key = [radiusTop,radiusBottom,height,segments].join(':');
      if (!cylinders.has(key)) cylinders.set(key, new THREE.CylinderGeometry(radiusTop,radiusBottom,height,segments));
      return cylinders.get(key);
    };
    function box(parent,w,h,d,mat,x=0,y=0,z=0,shadow=false) {
      const mesh = new THREE.Mesh(getBox(w,h,d),mat);
      mesh.position.set(x,y,z);
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    }
    function cylinder(parent,top,bottom,height,mat,x=0,y=0,z=0,segments=18,shadow=false) {
      const mesh = new THREE.Mesh(getCylinder(top,bottom,height,segments),mat);
      mesh.position.set(x,y,z);
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    }
    function roofTriangle(parent, coords, mat) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(coords.flat(),3));
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry,mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
    }
    function makeCanopy(group,w,d) {
      const edge=7.25, height=9.75;
      for (const x of [-w/2+.16,w/2-.16]) for(const z of [-d/2+.16,d/2-.16]){
        box(group,.18,edge,.18,metal,x,edge/2,z);
        box(group,.37,.17,.37,darkMetal,x,edge-.08,z);
        box(group,.36,.045,.36,darkMetal,x,.04,z);
      }
      for (const z of [-d/2,d/2])box(group,w,.31,.12,sideWhite,0,edge-.16,z,true);
      for (const x of [-w/2,w/2])box(group,.12,.31,d,white,x,edge-.16,0,true);
      if(Math.max(w,d)/Math.min(w,d) > 1.35) {
        if(d>w){
          for(const x of [-w/2,w/2]){
            const p1=[x,edge,-d/2],p2=[x,edge,d/2],p3=[0,height,d/2],p4=[0,height,-d/2];
            roofTriangle(group,[p1,p2,p3,p1,p3,p4],x<0?roofA:roofB);
          }
        }else{
          for(const z of [-d/2,d/2]){
            const p1=[-w/2,edge,z],p2=[w/2,edge,z],p3=[w/2,height,0],p4=[-w/2,height,0];
            roofTriangle(group,[p1,p2,p3,p1,p3,p4],z<0?roofA:roofB);
          }
        }
      }else {
        const pts=[[-w/2,edge,-d/2],[w/2,edge,-d/2],[w/2,edge,d/2],[-w/2,edge,d/2]];
        for(let i=0;i<4;i++)roofTriangle(group,[pts[i],pts[(i+1)%4],[0,height,0]],i%2?roofA:roofB);
      }
    }
    // Photo-matched DuraMax-style white folding chair. Rounded plastic
    // backrest and seat, painted metal tubes, crossed legs and end caps.
    // Retain the 2D planner's dimensions for saved layouts/collision checks.
    const chairMolds = new Map();
    const chairPaint = material(0xe9ebea, 0.61, 0.18);
    const chairFeet = material(0xc6c8c5, 0.94);
    const chairUnitUp = new THREE.Vector3(0,1,0);
    function chairTube(group,a,b,radius=.042,mat=chairPaint) {
      const delta=new THREE.Vector3(b[0]-a[0],b[1]-a[1],b[2]-a[2]);
      const length=delta.length();
      if(length<.001)return;
      // Shared cylinder geometry reduces memory for 100+ chair layouts.
      const tube=new THREE.Mesh(getCylinder(radius,radius,1,10),mat);
      tube.position.set((a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2);
      tube.quaternion.setFromUnitVectors(chairUnitUp,delta.multiplyScalar(1/length));
      tube.scale.y=length;
      group.add(tube);
      return tube;
    }
    function chairMoldGeometry(w,d) {
      const id=w.toFixed(3)+':'+d.toFixed(3);
      if(chairMolds.has(id))return chairMolds.get(id);
      // Seat plan: slightly tapered at the back with a rounded front edge.
      const halfW=w*.45,front=d*.38,rear=d*.34;
      const rounding=Math.min(.19,halfW*.25);
      // Shape Y maps to minus world Z after rotation.
      const seatShape=new THREE.Shape();
      seatShape.moveTo(-halfW+.07,rear);
      seatShape.lineTo(halfW-.07,rear);
      seatShape.quadraticCurveTo(halfW,rear,halfW,rear-.09);
      seatShape.lineTo(halfW,-front+rounding);
      seatShape.quadraticCurveTo(halfW,-front,halfW-rounding,-front);
      seatShape.lineTo(-halfW+rounding,-front);
      seatShape.quadraticCurveTo(-halfW,-front,-halfW,-front+rounding);
      seatShape.lineTo(-halfW,rear-.09);
      seatShape.quadraticCurveTo(-halfW,rear,-halfW+.07,rear);
      const seatGeometry=new THREE.ExtrudeGeometry(seatShape,{
        depth:.115,steps:1,curveSegments:5,
        bevelEnabled:true,bevelThickness:.013,bevelSize:.018,bevelSegments:2
      });
      seatGeometry.rotateX(-Math.PI/2);
      // Backrest curves at the top, corners and the bottom scallop.
      const backWidth=w*.90,halfBack=backWidth/2;
      const backShape=new THREE.Shape();
      backShape.moveTo(-halfBack+.12,-.30);
      backShape.quadraticCurveTo(-halfBack,-.28,-halfBack,-.16);
      backShape.lineTo(-halfBack+.02,.20);
      backShape.quadraticCurveTo(-halfBack+.02,.31,-halfBack+.18,.34);
      backShape.quadraticCurveTo(0,.405,halfBack-.18,.34);
      backShape.quadraticCurveTo(halfBack-.02,.31,halfBack-.02,.20);
      backShape.lineTo(halfBack,-.16);
      backShape.quadraticCurveTo(halfBack,-.28,halfBack-.12,-.30);
      backShape.quadraticCurveTo(0,-.355,-halfBack+.12,-.30);
      const backGeometry=new THREE.ExtrudeGeometry(backShape,{
        depth:.067,steps:1,curveSegments:6,
        bevelEnabled:true,bevelThickness:.012,bevelSize:.017,bevelSegments:2
      });
      chairMolds.set(id,{seatGeometry,backGeometry});
      return {seatGeometry,backGeometry};
    }
    function makeChair(group,w,d) {
      const {seatGeometry,backGeometry}=chairMoldGeometry(w,d);
      const halfFrame=w*.355,halfRear=w*.345;
      const zFront=d*.405,zBack=-d*.405;
      const seat=new THREE.Mesh(seatGeometry,white);
      seat.position.y=1.49;
      seat.castShadow=true;seat.receiveShadow=true;
      group.add(seat);
      const back=new THREE.Mesh(backGeometry,plastic);
      back.position.set(0,2.47,-d*.37);
      back.rotation.x=-.15;
      back.castShadow=true;back.receiveShadow=true;
      group.add(back);
      for(const sign of [-1,1]){
        const x=sign*halfFrame,rx=sign*halfRear;
        // Main tubular uprights extend through the seat to front feet.
        const frontFoot=[x,.065,zFront];
        const seatHinge=[x,1.50,-d*.065];
        const backTop=[x,2.81,-d*.45];
        chairTube(group,frontFoot,seatHinge,.043);
        chairTube(group,seatHinge,backTop,.043);
        // Hinged legs angle back to create the characteristic side X.
        const rearFoot=[rx,.065,zBack];
        const rearHinge=[rx,1.51,d*.23];
        chairTube(group,rearFoot,rearHinge,.041);
        chairTube(group,[x,1.46,-d*.30],[x,1.46,d*.33],.033);
        // Rubber/polymer end caps on each foot.
        chairTube(group,[x,.025,zFront],[x,.14,zFront-.016],.056,chairFeet);
        chairTube(group,[rx,.025,zBack],[rx,.14,zBack+.016],.056,chairFeet);
        chairTube(group,[x,1.41,d*.11],[rx,.69,-d*.20],.030,darkMetal);
        const hinge=cylinder(group,.072,.072,.045,darkMetal,x,1.44,d*.18,12);
        hinge.rotation.z=Math.PI/2;
      }
      // Cross rails give a legible, accurate silhouette even in grouped rows.
      chairTube(group,[-halfFrame,.45,d*.265],[halfFrame,.45,d*.265],.032);
      chairTube(group,[-halfRear,.35,-d*.29],[halfRear,.35,-d*.29],.032);
      chairTube(group,[-halfFrame,1.42,-d*.23],[halfFrame,1.42,-d*.23],.025);
    }
    function makeRound(group,w) {
      cylinder(group,.115,.115,2.4,metal,0,1.2,0,12);
      cylinder(group,.75,.75,.10,darkMetal,0,.09,0,24);
      cylinder(group,w/2,w/2,.18,white,0,2.5,0,40,true);
      cylinder(group,w/2,w/2,.055,sideWhite,0,2.41,0,40);
    }
    function makeRectangle(group,w,d) {
      for(const x of [-w/2+.45,w/2-.45])
        for(const z of [-d/2+.33,d/2-.33])
          box(group,.12,2.37,.12,metal,x,1.185,z);
      box(group,w,.20,d,white,0,2.45,0,true);
      box(group,w,.10,d,sideWhite,0,2.35,0);
    }

    const groundGroup=new THREE.Group();
    scene.add(groundGroup);
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(450,450), outerTurf);
    outer.rotation.x=-Math.PI/2;
    outer.position.y=-.16;
    outer.receiveShadow=true;
    scene.add(outer);
    const plot=new THREE.Mesh(new THREE.PlaneGeometry(60,50),turf);
    plot.rotation.x=-Math.PI/2;plot.receiveShadow=true;groundGroup.add(plot);
    let plotGrid=null, border=null;
    let currentSize='';
    const grove=new THREE.Group();scene.add(grove);
    const trunkGeometry=getCylinder(.64,.82,5.6,8);
    const coneGeometry=[
      getCylinder(0,4.4,6.5,8),
      getCylinder(0,3.7,5.8,8),
      getCylinder(0,3.0,5.3,8)
    ];
    for (let i=0;i<4;i++){
      const tree=new THREE.Group();
      const stem=new THREE.Mesh(trunkGeometry,bark);stem.position.y=2.8;tree.add(stem);
      for(let j=0;j<3;j++){
        const cone=new THREE.Mesh(coneGeometry[j],leaf[(i+j)%3]);
        cone.position.y=5.2+j*2.1;cone.castShadow=false;tree.add(cone);
      }
      grove.add(tree);
    }
    function rebuildLawn(width,length){
      const key=width+'x'+length;
      if(key===currentSize)return;
      currentSize=key;
      plot.geometry.dispose();
      plot.geometry=new THREE.PlaneGeometry(width,length);
      if(plotGrid){groundGroup.remove(plotGrid);plotGrid.geometry.dispose();}
      if(border){groundGroup.remove(border);border.geometry.dispose();}
      const lines=[];
      for(let x=-width/2;x<=width/2+.001;x+=5) lines.push(x,.035,-length/2,x,.035,length/2);
      for(let z=-length/2;z<=length/2+.001;z+=5) lines.push(-width/2,.035,z,width/2,.035,z);
      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.Float32BufferAttribute(lines,3));
      plotGrid=new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:0xdaebca,transparent:true,opacity:.43}));
      groundGroup.add(plotGrid);
      const corners=[
        -width/2,.045,-length/2, width/2,.045,-length/2, width/2,.045,length/2,
        -width/2,.045,length/2,-width/2,.045,-length/2
      ];
      const edgeGeometry=new THREE.BufferGeometry();
      edgeGeometry.setAttribute('position',new THREE.Float32BufferAttribute(corners,3));
      border=new THREE.Line(edgeGeometry,rimGold);groundGroup.add(border);
      [[-width/2-14,-length/2-13],[width/2+13,-length/2-15],[-width/2-14,length/2+12],[width/2+14,length/2+14]]
        .forEach((pos,i)=>grove.children[i].position.set(pos[0],0,pos[1]));
      sunlight.shadow.camera.left=-Math.max(width,length)*1.5;
      sunlight.shadow.camera.right=Math.max(width,length)*1.5;
      sunlight.shadow.camera.top=Math.max(width,length)*1.5;
      sunlight.shadow.camera.bottom=-Math.max(width,length)*1.5;
      sunlight.shadow.camera.updateProjectionMatrix();
    }

    const models=new Map();
    function makeModel(o){
      const group=new THREE.Group();
      const w=Math.max(.5,Number(o.w)||2),d=Math.max(.5,Number(o.d)||2);
      if(o.kind==='canopy')makeCanopy(group,w,d);
      else if(o.kind==='chair')makeChair(group,w,d);
      else if(o.kind==='round')makeRound(group,w);
      else makeRectangle(group,w,d);
      const overlay=new THREE.Mesh(
        new THREE.PlaneGeometry(w+.26,d+.26),
        new THREE.MeshBasicMaterial({color:0xd7a458,transparent:true,opacity:.19,depthWrite:false,side:THREE.DoubleSide})
      );
      overlay.rotation.x=-Math.PI/2;
      overlay.position.y=.075;
      overlay.visible=false;
      overlay.renderOrder=2;
      group.add(overlay);
      const rim=new THREE.LineSegments(
        new THREE.EdgesGeometry(getBox(w,.012,d)),
        new THREE.LineBasicMaterial({color:0xc49342,transparent:true,opacity:.94,depthTest:false})
      );
      rim.position.y=.088;rim.visible=false;rim.renderOrder=3;group.add(rim);
      scene.add(group);
      return {group,overlay,rim,kind:o.kind,w,d};
    }
    let lastW=0,lastH=0;
    function paint(data){
      if(!canvas.isConnected)return;
      const rect=canvas.getBoundingClientRect();
      const w=Math.max(220,Math.round(rect.width)),h=Math.max(220,Math.round(rect.height));
      if(w!==lastW||h!==lastH){
        lastW=w;lastH=h;
        renderer.setPixelRatio(Math.min(devicePixelRatio||1,w<720?1.5:2));
        renderer.setSize(w,h,false);
        camera.aspect=w/h;camera.updateProjectionMatrix();
      }
      rebuildLawn(data.width,data.length);
      const seen=new Set();
      for(const o of data.items){
        seen.add(o.key);
        let entry=models.get(o.key);
        if(!entry||entry.kind!==o.kind||entry.w!==o.w||entry.d!==o.d){
          if(entry){scene.remove(entry.group);entry.group.traverse(node=>{
            if(node===entry.overlay)node.geometry.dispose();
            if(node===entry.rim)node.geometry.dispose();
          });}
          entry=makeModel(o);models.set(o.key,entry);
        }
        entry.group.position.set(o.x,0,o.z);
        entry.group.rotation.y=-o.r*Math.PI/180;
        entry.overlay.visible=!!o.selected;
        entry.rim.visible=!!(o.selected||o.bad);
        entry.rim.material.color.setHex(o.bad?0xc54e46:0xc49342);
      }
      for(const [key,entry] of models){
        if(!seen.has(key)){scene.remove(entry.group);entry.overlay.geometry.dispose();entry.rim.geometry.dispose();models.delete(key);}
      }
      const v=data.view,cos=Math.cos(v.elev);
      camera.position.set(
        v.cx+Math.sin(v.yaw)*cos*v.dist,
        Math.max(.7,Math.sin(v.elev)*v.dist),
        v.cz+Math.cos(v.yaw)*cos*v.dist
      );
      camera.lookAt(v.cx,0,v.cz);
      renderer.render(scene,camera);
    }
    canvas.addEventListener('webglcontextlost',event=>{
      event.preventDefault();
      window.Regal3D=null;
      canvas.hidden=true;
      window.dispatchEvent(new Event('regal3dchange'));
    },{once:true});
    window.Regal3D={
      ready:true,
      render:paint,
      toBlob(callback){renderer.domElement.toBlob(callback,'image/png');}
    };
    window.dispatchEvent(new Event('regal3dchange'));
  }catch(error){
    canvas.hidden=true;
    // Software rendering remains available if WebGL cannot initialize.
  }
}
