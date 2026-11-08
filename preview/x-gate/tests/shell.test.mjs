import test, { beforeEach } from 'node:test';
import { mockFetch } from './mock-api.mjs';
beforeEach(() => { globalThis.fetch = mockFetch(); });
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import '../tools/register.mjs';
const THREE = await import('three');
const { PRESETS, createPresets, createSplitPresets, splitRegion, buildingPreset, sampleTrack, flightPoint, STATE_BY_PLACE, createCameraDirector, networkNodePreset, networkFocusPath } = await import('../src/app/camera.js');
const { PLACES, PORTAL, facingRotation } = await import('../src/kit/world.js');
const { routeHotspot, selectHit, hotspotAnchor } = await import('../src/app/shell/picking.js');
const { validSpaceModule, CATALOG } = await import('../src/app/shell/catalog.js');
const { default: base, completeStep } = await import('../src/app/spaces/base.js');
const { fallbackModule, mineIds, cardStartsCollapsed, isNetworkSplit } = await import('../src/app/index.js');

function insideEnvelope(point,id) {
  const p = new THREE.Vector3(...point).sub(new THREE.Vector3(...PLACES[id].position)).applyAxisAngle(new THREE.Vector3(0,1,0),-facingRotation(id));
  const e = PLACES[id].envelope;
  return p.y >= 0 && p.y <= e.height && (e.radius ? Math.hypot(p.x,p.z)<e.radius : Math.abs(p.x)<e.halfWidth && Math.abs(p.z)<e.halfDepth);
}
test('seven complete presets and mobile framing', () => {
  assert.deepEqual(Object.keys(PRESETS).sort(), ['BaseEntrance','BaseInterior','CityOverview','AgentNetwork','AgentHub','CoCreation','ValueCity'].sort());
  for (const mobile of [false,true]) for (const [name,p] of Object.entries(createPresets({},mobile))) {
    for (const key of ['position','lookAt']) { assert.equal(p[key].length,3); assert.ok(p[key].every(Number.isFinite)); }
    assert.ok(p.fov>20 && p.fov<90); assert.ok(p.transitionDuration>0); assert.equal(p.easing,'smoothstep');
    if (name !== 'BaseInterior') for (const id of Object.keys(PLACES)) assert.equal(insideEnvelope(p.position,id),false,`${name} inside ${id}`);
  }
  assert.deepEqual(PRESETS.BaseEntrance.position,[0,20,205]);
  assert.deepEqual(PRESETS.BaseEntrance.lookAt,[0,34,40]);
  assert.ok(createPresets({},true).BaseInterior.position[2]<44);
});
test('building presets follow live anchors, face each entrance, reserve right side', () => {
  for (const id of ['network','hub','cocreation','value']) {
    const a = new THREE.Vector3(...PLACES[id].position), b = a.clone().add(new THREE.Vector3(10,7,-20));
    const layout = Object.fromEntries(Object.entries(PLACES).map(([key,value])=>[key,{anchor:new THREE.Vector3(...value.position)}]));
    const shifted = Object.fromEntries(Object.entries(layout).map(([key,value])=>[key,{anchor:value.anchor.clone().add(new THREE.Vector3(10,7,-20))}]));
    const p = buildingPreset(id,a,false,undefined,1.6,layout), moved = buildingPreset(id,b,false,undefined,1.6,shifted);
    assert.deepEqual(moved.position.map((n,i)=>Math.round(n-p.position[i])),[10,7,-20]);
    assert.deepEqual(moved.lookAt.map((n,i)=>Math.round(n-p.lookAt[i])),[10,7,-20]);
    const front = new THREE.Vector3(Math.sin(facingRotation(id)),0,Math.cos(facingRotation(id)));
    const offset = new THREE.Vector3(...p.position).sub(a);
    assert.ok(Math.hypot(offset.x,offset.z)>=150); assert.ok(offset.dot(front)>0);
    assert.equal(p.lookAt[1],a.y+PLACES[id].envelope.height*.4);
    const camera = new THREE.PerspectiveCamera(p.fov,1440/900,.5,9000);
    camera.position.fromArray(p.position); camera.lookAt(...p.lookAt); camera.updateMatrixWorld(true);
    const center = a.clone(); center.y += PLACES[id].envelope.height*.4;
    assert.ok(center.project(camera).x<0,`${id} should appear left of center`);
  }
});
test('continuous zoom track is bounded and monotonically recedes through headquarters', () => {
  for (const mobile of [false,true]) {
    let lastZ=-Infinity,lastDistance=-Infinity;
    for (let n=0;n<=1000;n++) {
      const p=sampleTrack(n/1000,mobile), distance=new THREE.Vector3(...p.position).distanceTo(new THREE.Vector3(...p.lookAt));
      assert.ok(p.position[2]>=lastZ); assert.ok(distance>=lastDistance); lastZ=p.position[2]; lastDistance=distance;
    }
    assert.deepEqual(sampleTrack(-100,mobile),sampleTrack(0,mobile)); assert.deepEqual(sampleTrack(100,mobile),sampleTrack(1,mobile));
    const a=sampleTrack(.45-1e-7,mobile),b=sampleTrack(.45+1e-7,mobile);
    assert.ok(new THREE.Vector3(...a.position).distanceTo(new THREE.Vector3(...b.position))<.001);
  }
});
test('long-distance routes clear all declared building envelopes', () => {
  const entries=Object.entries(PRESETS).filter(([id])=>id!=='BaseInterior');
  for(const [from,a] of entries) for(const [to,b] of entries) {
    assert.deepEqual(flightPoint(a.position,b.position,0,400).toArray(),a.position);
    assert.deepEqual(flightPoint(a.position,b.position,1,400).toArray(),b.position);
    for(let n=0;n<=100;n++) for(const id of Object.keys(PLACES)) assert.equal(insideEnvelope(flightPoint(a.position,b.position,n/100,400).toArray(),id),false,`${from} -> ${to}, ${id}, t=${n/100}`);
  }
});
test('hotspot routes include portal, guides, sections and node references', () => {
  for(const id of Object.keys(CATALOG)) {
    assert.deepEqual(routeHotspot(id),{type:'fly',place:id});
    for(const s of CATALOG[id].sections) assert.deepEqual(routeHotspot(`${id}:${s.id}`),{type:'open',place:id,section:s.id});
  }
  assert.deepEqual(routeHotspot('base:portal'),{type:'interior',place:'base'});
  assert.deepEqual(routeHotspot('base:guide:hub'),{type:'fly',place:'hub'});
  assert.deepEqual(routeHotspot('network:agent:a3'),{type:'open',place:'network',section:'relations',ref:'a3'});
  assert.deepEqual(routeHotspot('network:human:lin-qi'),{type:'open',place:'network',section:'relations',ref:'lin-qi'});
  assert.deepEqual(routeHotspot('network:me'),{type:'open',place:'network',section:'relations',ref:'me'});
  for(const id of ['',null,'base:guide:bogus','network:agent:','hub:bogus','base:news:extra']) assert.equal(routeHotspot(id),null);
});
function mesh(id) { const m = new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshBasicMaterial()); m.userData.hotspot=id; return m; }
test('R4: HQ beacon and orbit open their sections and take priority over the building', () => {
  for (const [id,section] of [['base:beacon','news'],['base:orbit','guide']]) {
    assert.deepEqual(routeHotspot(id),{type:'open',place:'base',section});
    assert.equal(routeHotspot(`${id}:extra`),null);
    const main={object:mesh('base'),distance:5},hotspot={object:mesh(id),distance:15},wall={object:mesh(undefined),distance:10};
    assert.equal(selectHit([main,hotspot],[],'base'),hotspot);
    assert.equal(selectHit([main,hotspot],[],'network'),main);
    assert.equal(selectHit([main,hotspot],[wall],'base'),main);
    for (const hit of [main,hotspot,wall]) { hit.object.geometry.dispose();hit.object.material.dispose(); }
  }
});
test('picking honors node > section > main, hidden ancestors, distance and occlusion', () => {
  const main=mesh('network'), section=mesh('network:discover'), node=mesh('network:agent:a3');
  const hits=[{object:main,distance:2},{object:section,distance:5},{object:node,distance:7}];
  assert.equal(selectHit(hits,[],'network').object,node);
  assert.equal(selectHit(hits,[],'base').object,main);
  const wall=mesh(undefined);
  assert.equal(selectHit(hits,[{object:wall,distance:4}],'network').object,main);
  assert.equal(selectHit(hits.slice(1),[{object:wall,distance:4}],'network'),null);
  wall.material.transparent=true; wall.material.opacity=.1;
  assert.equal(selectHit(hits,[{object:wall,distance:1}],'network').object,node);
  const parent=new THREE.Group(); parent.add(node); parent.visible=false;
  assert.equal(selectHit(hits,[],'network').object,section);
});
test('real raycast rejects a hotspot behind a solid wall', () => {
  const hot=mesh('base:portal'); hot.material.visible=false; hot.position.z=-10;
  const wall=mesh(undefined); wall.position.z=-5;
  hot.updateMatrixWorld(); wall.updateMatrixWorld();
  const ray=new THREE.Raycaster(new THREE.Vector3(),new THREE.Vector3(0,0,-1));
  const hit=ray.intersectObject(hot);
  assert.ok(hit.length>0); assert.equal(selectHit(hit,ray.intersectObject(wall),'base'),null);
});
test('label anchors transform through the returned building group', () => {
  const root=new THREE.Group(); root.position.set(100,10,-30); root.rotation.y=Math.PI/2;
  const group=new THREE.Group(); group.position.y=3; root.add(group); root.updateMatrixWorld(true);
  const hot=mesh('network:skills'); hot.userData.anchor=new THREE.Vector3(0,2,5); group.add(hot);
  assert.ok(hotspotAnchor(hot,{network:{group}}).distanceTo(new THREE.Vector3(105,15,-30))<1e-8);
  assert.deepEqual(hot.userData.anchor.toArray(),[0,2,5]);
});
test('base interface and UI-only onboarding; mine IDs come from API state', () => {
  assert.equal(validSpaceModule(base,'base'),true);
  for(const id of Object.keys(CATALOG)) assert.equal(validSpaceModule(fallbackModule(id),id),true);
  assert.equal(validSpaceModule({...base,mount:null},'base'),false);
  const data={profile:{panda:'brand-blue',onboarded:[]},session:{status:'ok'},myAgents:{items:[{id:'a3'}]},graph:{following:['lu-yao']}};
  const store={get:k=>data[k],set:(k,v)=>data[k]=v};
  completeStep(store,'panda'); completeStep(store,'panda');
  assert.deepEqual(data.profile.onboarded,['panda']);
  assert.equal(data.profile.onboarded.includes('cocreation'),false);
  assert.deepEqual(mineIds(store),['me','a3','lu-yao']);
  assert.deepEqual(base.highlights(store),[]);
});

function cameraWorld(reducedMotion=false) {
  globalThis.window=new EventTarget();
  const queries=new Map(); globalThis.matchMedia=q=>{if(!queries.has(q))queries.set(q,Object.assign(new EventTarget(),{matches:q.includes('reduced')?reducedMotion:false}));return queries.get(q);};
  const canvas=Object.assign(new EventTarget(),{style:{},clientWidth:1440,clientHeight:900,ownerDocument:new EventTarget(),getRootNode(){return this.ownerDocument;}});
  const callbacks=new Set(),scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(45,1.6,.5,9000);
  const places={}; for(const [id,p] of Object.entries(PLACES)) {const group=new THREE.Group();group.position.fromArray(p.position);scene.add(group);places[id]={anchor:group.position.clone(),group,interior:new THREE.Group()};}
  let shadow=null;
  return {camera,canvas,scene,places,mobile:false,reducedMotion,env:{focusShadow:(p,r)=>shadow={p,r}},onFrame:cb=>{callbacks.add(cb);return()=>callbacks.delete(cb);},tick(n=120){for(let i=0;i<n;i++)for(const cb of callbacks)cb(i/60,1/60);},queries,get shadow(){return shadow;},get frameCount(){return callbacks.size;}};
}
test('camera transitions interrupt from current state and reduced motion snaps', async () => {
  const world=cameraWorld(), director=createCameraDirector(world);
  const first=director.go('AgentNetwork'); world.tick(25); const interrupted=world.camera.position.clone();
  const second=director.go('AgentHub'); assert.ok(world.camera.position.equals(interrupted));
  assert.equal(await first,false); world.tick(180); assert.equal(await second,true);
  assert.ok(world.camera.position.distanceTo(new THREE.Vector3(...PRESETS.AgentHub.position))<1e-8);
  assert.equal(world.shadow.r,200); director.dispose(); assert.equal(world.frameCount,0);
  const reduced=cameraWorld(true), d=createCameraDirector(reduced);
  assert.equal(await d.go('ValueCity'),true); assert.deepEqual(reduced.camera.position.toArray(),PRESETS.ValueCity.position);
  d.dispose();
});
test('R4: hall is visible from both home views and through the 260m portal boundary', async () => {
  for (const mobile of [false,true]) {
    const world=cameraWorld(true);world.mobile=mobile;
    const d=createCameraDirector(world),base=world.places.base;
    world.tick(1);assert.equal(base.interior.visible,true,`${mobile?'mobile':'desktop'} home`);
    base.group.position.set(30,12,-40);base.group.rotation.y=.6;
    const portal=base.group.localToWorld(new THREE.Vector3(0,PORTAL.height/2,PORTAL.z));
    for (const [distance,visible] of [[150,true],[200,true],[259.99,true],[260,true],[260.01,false]]) {
      world.camera.position.copy(portal).add(new THREE.Vector3(0,0,distance));
      world.tick(1);assert.equal(base.interior.visible,visible,`distance ${distance}`);
    }
    await d.go('BaseInterior');
    world.camera.position.copy(portal).add(new THREE.Vector3(0,0,300));
    world.tick(1);assert.equal(base.interior.visible,true,'interior state stays visible');
    d.dispose();
  }
});
test('wheel reaches orbit, reverses smoothly, observes limits and exits interior', async () => {
  const world=cameraWorld(),d=createCameraDirector(world);
  d.zoom(1e5); world.tick(240); assert.equal(d.state,'CityOverview'); assert.equal(world.controls.enabled,true);
  d.zoom(1e6); world.tick(240); assert.ok(world.camera.position.distanceTo(world.controls.target)<=1100.001);
  assert.equal(world.controls.minDistance,320);
  d.zoom(-1e5); world.tick(240); assert.equal(d.state,'BaseEntrance'); assert.ok(world.camera.position.z<820);
  d.zoom(-1e5); world.tick(240); assert.deepEqual(world.camera.position.toArray(),PRESETS.BaseEntrance.position);
  let promise=d.go('BaseInterior'); world.tick(120); assert.equal(await promise,true);
  assert.equal(world.controls.enabled,false); assert.equal(world.places.base.interior.visible,true);
  d.setBlocked(true); const position=world.camera.position.clone(); d.zoom(50); world.tick(10); assert.ok(world.camera.position.equals(position));
  d.setBlocked(false); d.zoom(30); world.tick(180); assert.equal(d.state,'BaseEntrance');
  d.dispose();
});
test('frozen HTML integration remains exact and all shared components exist', async () => {
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),css=await readFile(new URL('../style.css',import.meta.url),'utf8');
  assert.ok(html.includes('<canvas id="world" aria-label="X-GATE 智能体新世界三维场景"></canvas>'));
  assert.equal(/https?:\/\/.*three/.test(html),false,'Three is served by the local build');
  assert.ok(html.includes('<script type="module" src="src/main.js"></script>'));
  for(const name of ['btn','chip','field','card','grid','list','row','tag','empty','search','tabs','stat','avatar']) assert.ok(css.includes(`.x-${name}`),name);
  assert.ok(html.includes('src/app/spaces/spaces.css')); assert.ok(css.includes('prefers-reduced-motion')); assert.ok(css.includes('max-width: 760px'));
  assert.equal(css.includes('.sp-network-'),false,'SHELL CSS must not own APPS network selectors');
});

test('departing the interior routes through the doorway before the elevated flight', async () => {
  const world=cameraWorld(),d=createCameraDirector(world);
  const entered=d.go('BaseInterior');world.tick(120);await entered;
  const trip=d.go('AgentNetwork');world.tick(120);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(d.state,'AgentNetwork');
  for(let n=0;n<120;n++){world.tick(1);for(const id of Object.keys(PLACES))assert.equal(insideEnvelope(world.camera.position.toArray(),id),false,`interior departure crossed ${id}`);}
  assert.equal(await trip,true);d.dispose();
});

test('shell lifecycle: messages preserve camera; section switches dispose; navigation closes overlays', async () => {
  const {installDOM}=await import('./dom-fixture.mjs');const doc=installDOM();
  const world=cameraWorld(true);world.hotspots=[];world.setHotspots=(_id,list)=>{world.hotspots=list;};world.setIdle=v=>{world.idle=v;};
  const {store}=await import('../src/app/store.js');store.reset();
  const {mount}=await import('../src/app/index.js');const api=mount(world);
  const settle=async()=>{await new Promise(resolve=>setTimeout(resolve,30));};await settle();
  assert.equal(doc.getElementById('x-navigation').children.length,6);
  assert.equal(doc.getElementById('x-space-card').hidden,false);
  assert.equal(doc.getElementById('x-card-details').hidden,true);
  assert.equal(doc.getElementById('x-card-toggle').getAttribute('aria-expanded'),'false');
  doc.getElementById('x-card-toggle').click();
  assert.equal(doc.getElementById('x-card-details').hidden,false);
  doc.getElementById('x-card-toggle').click();
  assert.equal(doc.getElementById('x-card-details').hidden,true);
  doc.getElementById('x-space-card').firstChild.children[1].click();await settle();
  assert.equal(api.section,'start');assert.ok(!world.idle);assert.equal(doc.getElementById('x-workbench').hidden,false);assert.equal(doc.getElementById('x-workbench').dataset.place,'base');
  const selected=doc.getElementById('x-content').textContent;assert.ok(selected.includes('选熊猫配色'));
  await api.open('brand');const content=doc.getElementById('x-content').textContent;
  store.set('profile',{...store.get('profile'),panda:'mint'});assert.equal(doc.getElementById('x-content').textContent,content,'old section subscription must be cleaned');
  assert.equal(doc.getElementById('x-unread').textContent,'3');
  const before=world.camera.position.clone();doc.getElementById('x-message-nav').click();assert.ok(world.camera.position.equals(before));
  await settle();
  assert.equal(store.get('notifications').items[0].read_at,null);assert.equal(doc.getElementById('x-unread').hidden,false);
  assert.ok(doc.getElementById('x-messages-content').textContent.includes('<script>server title</script>'));
  assert.equal(doc.getElementById('x-messages-content').querySelector('script'),null);
  doc.getElementById('x-messages-close').click();assert.equal(doc.getElementById('x-workbench').hidden,false);assert.ok(!world.idle);
  doc.getElementById('x-workbench-close').click();assert.ok(!world.idle);assert.equal(doc.getElementById('x-space-card').hidden,false);
  await api.open('brand');doc.getElementById('x-navigation').children[0].click();await settle();
  assert.equal(doc.getElementById('x-workbench').hidden,true);assert.equal(api.director.state,'BaseEntrance');
  api.dispose();api.dispose();assert.equal(world.frameCount,0);assert.equal(world.idle,false);assert.equal(doc.getElementById('x-app').hidden,true);
});

function projectBox(box,preset,aspect) {
  const camera=new THREE.PerspectiveCamera(preset.fov,aspect,.5,9000);
  camera.position.fromArray(preset.position);camera.lookAt(...preset.lookAt);camera.updateMatrixWorld(true);
  const points=[];
  for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])points.push(new THREE.Vector3(x,y,z).project(camera));
  return {height:(Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y)))/2,minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x))};
}
test('R2: live bounds determine 60-65% desktop height, 40% target and at least 150m distance', () => {
  const places={};
  for(const id of ['network','hub','cocreation','value']) {
    const anchor=new THREE.Vector3(...PLACES[id].position),h=PLACES[id].envelope.height+20;
    places[id]={anchor,bounds:new THREE.Box3(anchor.clone().add(new THREE.Vector3(-55,-5,-55)),anchor.clone().add(new THREE.Vector3(55,h,55)))};
  }
  const presets=createPresets(places,false,1.6);
  for(const [id,place] of Object.entries(places)) {
    const p=presets[STATE_BY_PLACE[id]],v=projectBox(place.bounds,p,1.6);
    assert.ok(v.height>=.60&&v.height<=.65,`${id}: ${v.height}`);
    assert.ok(v.minX>=-.941&&v.maxX<=.201,`${id}: left 60% frame`);
    assert.equal(p.lookAt[1],place.bounds.min.y+(place.bounds.max.y-place.bounds.min.y)*.4);
    assert.ok(Math.hypot(p.position[0]-place.anchor.x,p.position[2]-place.anchor.z)>=150);
    assert.equal(place.bounds.containsPoint(new THREE.Vector3(...p.position)),false);
    const bigger=place.bounds.clone();bigger.max.y+=100;
    const grown=buildingPreset(id,place.anchor,false,bigger,1.6,places);
    assert.ok(new THREE.Vector3(...grown.position).distanceTo(place.anchor)>new THREE.Vector3(...p.position).distanceTo(place.anchor));
    const mobile=buildingPreset(id,place.anchor,true,place.bounds,390/844,places),m=projectBox(place.bounds,mobile,390/844);
    assert.ok(m.height<=.65&&m.minX>=-.941&&m.maxX<=.941);
  }
});
function wheelEvent(delta) {return Object.assign(new Event('wheel',{cancelable:true}),{deltaY:delta,deltaMode:0});}
test('R2: regular wheel uses 16 notches; large input is proportional and frame-bounded', () => {
  const world=cameraWorld(),d=createCameraDirector(world);
  for(let i=0;i<15;i++){world.canvas.dispatchEvent(wheelEvent(100));world.tick(120);assert.equal(d.state,'BaseEntrance',`premature overview after ${i+1}`);}
  world.canvas.dispatchEvent(wheelEvent(100));world.tick(240);assert.equal(d.state,'CityOverview');
  assert.ok(world.camera.position.distanceTo(new THREE.Vector3(0,560,820))<.01);
  world.canvas.dispatchEvent(wheelEvent(400));world.tick(120);assert.ok(world.camera.position.distanceTo(world.controls.target)<=1100.001);
  d.dispose();
  const burst=cameraWorld(),b=createCameraDirector(burst);for(let i=0;i<6;i++)burst.canvas.dispatchEvent(wheelEvent(400));
  let last=burst.camera.position.z;
  for(let i=0;i<300;i++){burst.tick(1);assert.ok(Math.abs(burst.camera.position.z-last)<20,'single frame rail jump');last=burst.camera.position.z;}
  assert.equal(b.state,'CityOverview');assert.ok(burst.camera.position.distanceTo(burst.controls.target)<=1100.001);assert.ok(burst.camera.position.y<570);b.dispose();
  const one=cameraWorld(),o=createCameraDirector(one);one.canvas.dispatchEvent(wheelEvent(400));one.tick(240);const point=one.camera.position.clone();o.dispose();
  const four=cameraWorld(),f=createCameraDirector(four);for(let i=0;i<4;i++)four.canvas.dispatchEvent(wheelEvent(100));four.tick(240);
  assert.ok(four.camera.position.distanceTo(point)<.001);f.dispose();
});
test('R2: card defaults collapse homepage/mobile and expand desktop destinations', () => {
  for(const place of Object.keys(CATALOG))for(const mobile of [false,true]) {
    const state=STATE_BY_PLACE[place];assert.equal(cardStartsCollapsed(place,mobile,state),mobile||place==='base');
  }
  assert.equal(cardStartsCollapsed('base',false,'BaseInterior'),false);
});
test('R2: destination card folds on mobile resize, preserves primary action and toggle', async () => {
  const {installDOM}=await import('./dom-fixture.mjs');const doc=installDOM(),world=cameraWorld(true);
  world.hotspots=[];world.setHotspots=()=>{};world.setIdle=v=>{world.idle=v;};
  const {mount}=await import('../src/app/index.js');const api=mount(world);await new Promise(resolve=>setTimeout(resolve,30));
  // 导航只到建筑；工作台 DOM 不在本夹具验证范围。
  doc.getElementById('x-navigation').children[1].click();await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(doc.getElementById('x-card-details').hidden,false);
  const mq=world.queries.get('(max-width: 760px)');mq.matches=true;mq.dispatchEvent(new Event('change'));
  assert.equal(doc.getElementById('x-card-details').hidden,true);
  const header=doc.getElementById('x-space-card').firstChild;
  assert.equal(header.children[1].textContent,'连接 Agent');assert.equal(header.children[1].hidden,false);
  doc.getElementById('x-card-toggle').click();assert.equal(doc.getElementById('x-card-details').hidden,false);
  doc.getElementById('x-card-toggle').click();assert.equal(doc.getElementById('x-card-details').hidden,true);
  doc.getElementById('x-navigation').children[0].click();await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(doc.getElementById('x-card-details').hidden,true);
  api.dispose();
});

function nodeWorld(reduced = false) {
  const world=cameraWorld(reduced),p=world.places.network;
  p.group.rotation.y=facingRotation('network');
  p.bounds=new THREE.Box3(p.anchor.clone().add(new THREE.Vector3(-55,0,-55)),p.anchor.clone().add(new THREE.Vector3(55,140,55)));
  const nodes=[['agent','a-zheng',[34,70,-12]],['agent','a-zhuiguang',[-30,67,18]],['human','lu-yao',[27,24,15]],['me','me',[17,22,24]]];
  world.hotspots=nodes.map(([kind,id,position])=>{
    const h=mesh(kind==='me'?'network:me':`network:${kind}:${id}`);h.material.visible=false;
    h.userData.anchor=new THREE.Vector3(...position);h.userData.nodeId=id;h.position.fromArray(position);p.group.add(h);return h;
  });
  world.scene.updateMatrixWorld(true);world.canvas.getBoundingClientRect=()=>({left:0,top:0,width:1440,height:900});
  const highlights=[];p.highlight=id=>highlights.push(id);
  world.setHotspots=()=>{};world.setIdle=v=>{world.idle=v;};world.highlights=highlights;
  return world;
}
test('R3/R5: network close-ups use transformed anchors, desktop distance and wider mobile framing', () => {
  const world=nodeWorld();
  for(const mobile of [false,true])for(const h of world.hotspots) {
    world.camera.aspect=mobile?390/844:1.6;world.canvas.clientHeight=mobile?844:900;
    const p=networkNodePreset(world,h.userData.nodeId,mobile),node=hotspotAnchor(h,world.places),position=new THREE.Vector3(...p.position);
    assert.ok(position.distanceTo(node)>=(mobile?120:60)-1e-8&&position.distanceTo(node)<=(mobile?144:90)+1e-8);
    assert.ok(position.y>node.y);assert.equal(world.places.network.bounds.containsPoint(position),false);
    assert.ok(new THREE.Vector3(...p.lookAt).distanceTo(node)<1e-8);
    const aspect=mobile?390/844:1.6,camera=new THREE.PerspectiveCamera(p.fov,aspect,.5,9000);
    camera.position.copy(position);camera.lookAt(node);camera.setViewOffset(aspect*1000,1000,p.frameOffset[0]*aspect*1000,p.frameOffset[1]*1000,aspect*1000,1000);camera.updateMatrixWorld(true);
    const projected=node.clone().project(camera);
    if(mobile){assert.ok(Math.abs(projected.x)<1e-8);assert.ok(Math.abs((1-projected.y)/2-.225)<1e-8);}
    else {assert.ok(projected.x<-.4&&projected.x>-.5);assert.ok(Math.abs(projected.y)<1e-8);}
  }
  assert.equal(networkNodePreset(world,'missing'),null);
});
test('R5: mobile focus keeps its wider distance through controls, zoom, close and desktop resize', async () => {
  const world=nodeWorld(true);world.mobile=true;world.camera.aspect=390/844;
  world.canvas.clientWidth=390;world.canvas.clientHeight=844;
  const d=createCameraDirector(world);await d.go('AgentNetwork');d.setSplitView(true);await d.focusNode('a-zhuiguang');
  const distance=()=>world.camera.position.distanceTo(world.controls.target);
  assert.ok(Math.abs(distance()-120)<1e-8);assert.equal(world.controls.maxDistance,144);
  world.tick(1);assert.ok(Math.abs(distance()-120)<1e-8);
  d.zoom(400);world.tick(10);assert.ok(distance()>=120-1e-8&&distance()<=144+1e-8);
  d.setSplitView(false);world.tick(1);assert.equal(d.focusedNode,'a-zhuiguang');assert.ok(distance()>=120-1e-8);
  world.camera.aspect=1.6;world.canvas.clientWidth=1440;world.canvas.clientHeight=900;
  window.dispatchEvent(new Event('resize'));world.tick(1);
  assert.ok(distance()>=60-1e-8&&distance()<=90+1e-8);assert.equal(world.controls.maxDistance,90);assert.equal(world.camera.fov,60);
  d.dispose();
});
test('R3: focus flights avoid network bounds, interrupt cleanly and retain close-up after close', async () => {
  const world=nodeWorld(),d=createCameraDirector(world);
  const arrived=d.go('AgentNetwork');world.tick(150);await arrived;d.setSplitView(true);
  const first=d.focusNode('a-zheng');world.tick(25);const from=world.camera.position.clone();
  const second=d.focusNode('lu-yao');assert.ok(world.camera.position.equals(from));assert.equal(await first,false);
  for(let i=0;i<100;i++){world.tick(1);assert.equal(world.places.network.bounds.containsPoint(world.camera.position),false);}
  assert.equal(await second,true);assert.equal(d.focusedNode,'lu-yao');
  assert.ok(world.camera.view.enabled);const point=world.camera.position.clone();
  d.setSplitView(false);world.tick(100);assert.equal(d.focusedNode,'lu-yao');assert.equal(world.camera.view.enabled,false);
  assert.ok(world.camera.position.distanceTo(point)<.001);
  const unknown=await d.focusNode('missing');assert.equal(unknown,false);assert.equal(d.focusedNode,'lu-yao');
  const exit=d.go('AgentHub');world.tick(150);await exit;assert.equal(d.focusedNode,null);assert.equal(world.camera.view.enabled,false);d.dispose();
});
test('R3: homepage and wheel track share the new entrance on desktop and mobile', () => {
  for(const mobile of [false,true]) {
    const p=createPresets({},mobile).BaseEntrance,start=sampleTrack(0,mobile);
    assert.deepEqual(start.position,p.position);assert.deepEqual(start.lookAt,p.lookAt);
    assert.deepEqual(p.lookAt,[0,34,40]);assert.ok(p.position[2]>=(mobile?270:205));
    assert.ok(new THREE.Vector3(...sampleTrack(.0001,mobile).position).distanceTo(new THREE.Vector3(...p.position))<.2);
  }
  assert.equal(isNetworkSplit('network','relations'),true);assert.equal(isNetworkSplit('network','graph'),true);
  for(const section of ['skills','discover','cases'])assert.equal(isNetworkSplit('network',section),false);
  assert.equal(isNetworkSplit('hub','relations'),false);
});
test('R3: real APPS cleanup preserves selection; split remains interactive and 3D picks synchronize', async () => {
  const {installDOM}=await import('./dom-fixture.mjs');const doc=installDOM(),world=nodeWorld(true);
  const {mount}=await import('../src/app/index.js');const api=mount(world);
  const settle=()=>new Promise(resolve=>setTimeout(resolve,60));await settle();
  doc.getElementById('x-navigation').children[1].click();await settle();
  await api.open('relations','lu-yao');await settle();
  assert.equal(api.selectedNode,'lu-yao');assert.equal(world.highlights.at(-1),'lu-yao');
  assert.equal(doc.getElementById('x-workbench').dataset.place,'network');assert.equal(doc.getElementById('x-workbench').dataset.sync,'node');
  assert.ok(!world.idle);assert.equal(world.controls.enabled,true);
  assert.equal(doc.getElementById('x-content').textContent.includes('暂时无法打开'),false);
  const pos=world.camera.position.clone();doc.getElementById('x-message-nav').click();assert.ok(world.camera.position.equals(pos));
  doc.getElementById('x-messages-close').click();assert.equal(world.highlights.at(-1),'lu-yao');
  await api.open('relations','me');await settle();
  assert.equal(api.selectedNode,'me');assert.equal(world.highlights.at(-1),'me');
  await api.open('graph','a-zheng');await settle();assert.equal(api.selectedNode,'a-zheng');
  const selectedGraphNode=doc.getElementById('x-content').querySelector('.sp-network-node.sel');assert.ok(selectedGraphNode);
  selectedGraphNode.click();await settle();
  assert.equal(api.selectedNode,'a-zheng');assert.ok(doc.getElementById('x-content').querySelector('.sp-network-node.sel'));
  assert.equal(doc.getElementById('x-content').textContent.includes('暂时无法打开'),false);
  doc.getElementById('x-workbench-close').click();assert.equal(world.highlights.at(-1),'a-zheng');
  assert.equal(api.director.focusedNode,'a-zheng');
  // 真正经过拾取回调：在可见3D区域点另一个Agent，打开relations并传同一个ref。
  const hotspot=world.hotspots.find(h=>h.userData.nodeId==='a-zhuiguang');
  world.camera.updateMatrixWorld(true);const screen=hotspotAnchor(hotspot,world.places).project(world.camera);
  world.controls.enabled=false; // 夹具没有原生pointer capture；仅隔离OrbitControls的DOM适配。
  for(const type of ['pointerdown','pointerup'])world.canvas.dispatchEvent(Object.assign(new Event(type),{button:0,pointerId:11,pointerType:'mouse',clientX:(screen.x+1)*720,clientY:(1-screen.y)*450}));
  await settle();assert.equal(api.section,'relations');assert.equal(api.selectedNode,'a-zhuiguang');assert.equal(world.highlights.at(-1),'a-zhuiguang');
  const calls=world.highlights.length;doc.getElementById('x-workbench-close').click();assert.equal(world.highlights.length,calls);
  await api.open('skills','a-zheng');assert.equal(doc.getElementById('x-workbench').dataset.sync,undefined);assert.equal(world.controls.enabled,true,'docked panels leave the world interactive');
  doc.getElementById('x-workbench-close').click();assert.equal(world.highlights.at(-1),'a-zhuiguang');assert.equal(api.director.focusedNode,'a-zhuiguang');
  doc.getElementById('x-navigation').children[0].click();await settle();assert.equal(world.highlights.at(-1),null);assert.equal(api.selectedNode,null);
  api.dispose();
});

test('R6: empty relations opens roster; picking me from the 3D graph passes explicit ref and opens my detail', async () => {
  const {installDOM}=await import('./dom-fixture.mjs');const doc=installDOM(),world=nodeWorld(true);
  const {default:network}=await import('../src/app/spaces/network.js');const original=network.mount,refs=[];
  network.mount=function(root,ctx){refs.push({section:ctx.section,ref:ctx.ref});return original.call(this,root,ctx);};
  let api;
  try {
    const {mount}=await import('../src/app/index.js');api=mount(world);
    const settle=()=>new Promise(resolve=>setTimeout(resolve,60));await settle();
    await api.fly('network','relations');await settle();
    assert.deepEqual(refs.at(-1),{section:'relations',ref:null});assert.equal(api.selectedNode,null);
    assert.ok(doc.getElementById('x-content').querySelector('.sp-network-rel')&&!doc.getElementById('x-content').querySelector('.sp-network-detail').textContent,'no ref: roster, not a detail');
    await api.open('graph','a-zheng');await settle();await api.director.focusNode('me');
    assert.equal(api.section,'graph');assert.equal(api.selectedNode,'a-zheng');
    const hotspot=world.hotspots.find(h=>h.userData.hotspot==='network:me');
    world.camera.updateMatrixWorld(true);const point=hotspotAnchor(hotspot,world.places).project(world.camera);
    assert.ok(Math.abs(point.x)<1&&Math.abs(point.y)<1);
    world.controls.enabled=false; // 夹具不支持原生 pointer capture；仍经过真实射线与路由。
    for(const type of ['pointerdown','pointerup'])world.canvas.dispatchEvent(Object.assign(new Event(type),{button:0,pointerId:12,pointerType:'mouse',clientX:(point.x+1)*720,clientY:(1-point.y)*450}));
    await settle();
    assert.deepEqual(refs.at(-1),{section:'relations',ref:'me'});
    assert.equal(api.section,'relations');assert.equal(api.selectedNode,'me');assert.equal(world.highlights.at(-1),'me');
    assert.ok(doc.getElementById('x-content').querySelector('.sp-network-detail'),'explicit me must render detail, not roster');
    const strip=doc.getElementById('x-content').querySelector('.sp-network-rel');assert.ok(strip);
    assert.equal(strip.querySelector('[aria-selected="true"]').dataset.nodeId,'me');
    assert.equal(doc.getElementById('x-content').querySelector('.sp-network-bar'),null,'detail replaces the roster toolbar');
  } finally { api?.dispose();network.mount=original; }
});

test('R3 addendum: tabs are one horizontal strip, keyboard-scrollable, on every width', async () => {
  const {installDOM}=await import('./dom-fixture.mjs');const doc=installDOM(),world=nodeWorld(true);
  world.mobile=true;world.camera.aspect=390/844;
  const mq=globalThis.matchMedia('(max-width: 760px)');mq.matches=true;
  const {mount}=await import('../src/app/index.js');const api=mount(world);
  await new Promise(resolve=>setTimeout(resolve,30));await api.fly('cocreation','members');
  const tabs=doc.getElementById('x-sections');
  assert.equal(doc.getElementById('x-content').textContent.includes('暂时无法打开'),false);
  assert.equal(tabs.getAttribute('aria-orientation'),'horizontal');
  assert.equal(tabs.children[0].textContent,'成员与创作者');
  tabs.children[0].focus();tabs.dispatchEvent(Object.assign(new Event('keydown',{cancelable:true}),{key:'End'}));
  assert.equal(doc.activeElement,tabs.children.at(-1));assert.equal(doc.activeElement.lastScrollOptions.inline,'nearest');
  tabs.dispatchEvent(Object.assign(new Event('keydown',{cancelable:true}),{key:'ArrowRight'}));assert.equal(doc.activeElement,tabs.children[0]);
  await api.open('recruit');assert.equal(tabs.querySelector('[aria-selected="true"]').lastScrollOptions.inline,'nearest');
  await api.fly('network','relations');assert.equal(tabs.getAttribute('aria-orientation'),'horizontal');
  assert.equal(doc.getElementById('x-workbench').dataset.place,'network');
  mq.matches=false;mq.dispatchEvent(new Event('change'));assert.equal(tabs.getAttribute('aria-orientation'),'horizontal');
  api.dispose();
  const css=await readFile(new URL('../style.css',import.meta.url),'utf8');
  assert.ok(css.includes('overflow-x: auto; overflow-y: hidden'));
  assert.ok(css.includes('min-height: 44px; padding: 8px 14px'));
  assert.ok(css.includes('white-space: nowrap'));
  assert.ok(css.includes('--x-drawer: 62dvh'));assert.ok(css.includes('.x-workbench[data-sync="node"] { --x-drawer: 55dvh; }'));
});

function dockedPlaces() {
  const places={};
  for(const id of ['network','hub','cocreation','value']){const a=new THREE.Vector3(...PLACES[id].position),e=PLACES[id].envelope;places[id]={anchor:a,bounds:new THREE.Box3(a.clone().add(new THREE.Vector3(-e.radius,0,-e.radius)),a.clone().add(new THREE.Vector3(e.radius,e.height,e.radius)))};}
  return places;
}
test('UI-R1: docked framing puts each building into the free region beside the panel', () => {
  const places=dockedPlaces();
  for(const [mobile,w,h] of [[false,1440,900],[false,1100,760],[true,390,844],[true,375,667]]) {
    const aspect=w/h,split=createSplitPresets(places,mobile,aspect,[w,h]),region=splitRegion(mobile,w,h);
    for(const [id,place] of Object.entries(places)) {
      const p=split[STATE_BY_PLACE[id]],camera=new THREE.PerspectiveCamera(p.fov,aspect,.5,9000),full=1000,fw=aspect*full;
      camera.position.fromArray(p.position);camera.lookAt(...p.lookAt);camera.setViewOffset(fw,full,p.frameOffset[0]*fw,p.frameOffset[1]*full,fw,full);camera.updateMatrixWorld(true);
      const pts=[];for(const x of [place.bounds.min.x,place.bounds.max.x])for(const y of [place.bounds.min.y,place.bounds.max.y])for(const z of [place.bounds.min.z,place.bounds.max.z])pts.push(new THREE.Vector3(x,y,z).project(camera));
      const xs=pts.map(q=>q.x),ys=pts.map(q=>q.y);
      assert.ok(pts.every(q=>q.z>=-1&&q.z<=1),`${id} ${w}x${h}: in front of camera`);
      assert.ok(Math.min(...xs)>=region.x[0]-1e-3&&Math.max(...xs)<=region.x[1]+1e-3,`${id} ${w}x${h}: x ${xs}`);
      assert.ok(Math.min(...ys)>=region.y[0]-1e-3&&Math.max(...ys)<=region.y[1]+1e-3,`${id} ${w}x${h}: y ${ys}`);
      assert.equal(place.bounds.containsPoint(new THREE.Vector3(...p.position)),false);
      assert.ok(p.frameOffset.every(Number.isFinite));
    }
  }
  assert.ok(splitRegion(false,1440,900).x[1]<-.08,'desktop building keeps 40px clear of a panel that starts at x=-0.033');
  assert.ok(splitRegion(true,390,844).y[0]>.39,'mobile band stays above the 62dvh drawer');
});
test('UI-R1: opening a section docks the frame, closing restores it; headquarters only shifts the frame', async () => {
  const world=cameraWorld(true),d=createCameraDirector(world),aspect=world.camera.aspect;
  const normal=createPresets(world.places,false,aspect),split=createSplitPresets(world.places,false,aspect,[1440,900],normal);
  await d.go('AgentHub');assert.ok(!world.camera.view?.enabled);
  assert.ok(world.camera.position.distanceTo(new THREE.Vector3(...normal.AgentHub.position))<1e-6);
  d.setSplitView(true);assert.equal(world.camera.view.enabled,true);assert.ok(world.camera.view.offsetX>0);
  assert.ok(world.camera.position.distanceTo(new THREE.Vector3(...split.AgentHub.position))<1e-6);
  d.setSplitView(false);assert.ok(!world.camera.view.enabled);
  assert.ok(world.camera.position.distanceTo(new THREE.Vector3(...normal.AgentHub.position))<1e-6);
  assert.equal(await d.go('CoCreation',{split:true}),true);
  assert.ok(world.camera.position.distanceTo(new THREE.Vector3(...split.CoCreation.position))<1e-6);assert.ok(world.camera.view.offsetX>0);
  await d.go('BaseEntrance',{split:false});assert.ok(!world.camera.view.enabled,'split:false on the way out clears the frame shift');
  const position=world.camera.position.clone();d.setSplitView(true);
  assert.ok(world.camera.position.equals(position),'headquarters keeps its camera');assert.ok(world.camera.view.offsetX>0,'and only shifts the frame');
  d.setSplitView(false);assert.ok(!world.camera.view.enabled);d.dispose();
});
test('UI-R1: space card is name + three entry cells + one primary; navigation uses line icons', async () => {
  const {installDOM}=await import('./dom-fixture.mjs');const doc=installDOM(),world=cameraWorld(true);
  world.hotspots=[];world.setHotspots=()=>{};world.setIdle=v=>{world.idle=v;};
  const {mount}=await import('../src/app/index.js');const api=mount(world);const settle=()=>new Promise(resolve=>setTimeout(resolve,60));await settle();
  const nav=doc.getElementById('x-navigation');
  for(const item of nav.children) assert.ok(item.querySelector('svg'),'nav item has an svg icon');
  for(const [index,id] of [[1,'network'],[2,'hub'],[3,'cocreation'],[4,'value']]) {
    nav.children[index].click();await settle();
    const card=doc.getElementById('x-space-card');assert.equal(card.dataset.place,id);
    const cells=card.querySelectorAll('.x-entry');assert.equal(cells.length,3);
    for(const cell of cells){assert.ok(cell.querySelector('svg'));assert.ok(cell.textContent.length>=2&&cell.textContent.length<=4,`${id}: ${cell.textContent}`);}
    assert.equal(card.querySelector('.x-tagline'),null);assert.equal(card.querySelector('.x-tag'),null);
    assert.equal(card.textContent.includes('示例'),false);
    cells[0].click();await settle();
    assert.equal(doc.getElementById('x-workbench').dataset.place,id);assert.equal(api.section,CATALOG[id].entries[0].section);
    assert.equal(doc.getElementById('x-workbench-title').textContent,CATALOG[id].title);
    doc.getElementById('x-workbench-close').click();
  }
  api.dispose();
});
test('UI-R1: CSS contract — world never filtered, four building colours, panel geometry and material', async () => {
  const css=await readFile(new URL('../style.css',import.meta.url),'utf8');
  assert.equal(/#world[^{]*\{[^}]*filter/.test(css),false);assert.equal(css.includes('x-overlay-open'),false);
  for(const [id,color] of [['network','#5fe8ff'],['hub','#2d5bff'],['cocreation','#8f82ff'],['value','#cfe9ff']])assert.ok(css.includes(`[data-place="${id}"] { --place: ${color};`),id);
  assert.ok(css.includes('--x-glass: rgba(6,14,30,.72)'));assert.ok(css.includes('--x-blur: 22px'));assert.ok(css.includes('--x-edge: rgba(150,210,255,.18)'));
  assert.ok(css.includes('top: 84px; right: 24px; bottom: 28px; width: min(760px,50vw)'));
  assert.ok(css.includes('polygon(18px 0, 100% 0, 100% 100%, 0 100%, 0 18px)'));assert.ok(css.includes('--x-motion: 260ms'));
  assert.ok(/prefers-reduced-motion[\s\S]*x-dock-fade/.test(css),'reduced motion keeps opacity only');
});
test('UI-R2: top bar keeps only the wordmark where a card or panel header already names the place', async () => {
  const {installDOM}=await import('./dom-fixture.mjs');const doc=installDOM(),world=cameraWorld(true);
  world.hotspots=[];world.setHotspots=()=>{};world.setIdle=v=>{world.idle=v;};
  const {mount}=await import('../src/app/index.js');const api=mount(world);const settle=()=>new Promise(resolve=>setTimeout(resolve,60));await settle();
  const where=doc.getElementById('x-location'),card=doc.getElementById('x-space-card'),nav=doc.getElementById('x-navigation');
  assert.equal(where.hidden,true,'headquarters card already says 中央总部');assert.equal(where.textContent,'');
  for(const [index,id] of [[1,'network'],[2,'hub'],[3,'cocreation'],[4,'value']]) {
    nav.children[index].click();await settle();
    assert.equal(where.hidden,true,id);assert.equal(where.textContent,'',id);assert.ok(card.textContent.includes(CATALOG[id].title),`${id}: card names the place`);
    card.querySelectorAll('.x-entry')[0].click();await settle();
    assert.equal(where.hidden,true,`${id} with panel`);assert.equal(doc.getElementById('x-workbench-title').textContent,CATALOG[id].title);
    assert.ok(doc.getElementById('x-announcer').textContent.length>0,'screen readers still get an announcement');
    doc.getElementById('x-workbench-close').click();
  }
  await api.director.go('CityOverview');assert.equal(where.hidden,false,'overview has no header, so it keeps a location');assert.equal(where.textContent,'价值之城');
  await api.director.go('BaseInterior');assert.equal(where.hidden,false);assert.equal(where.textContent,'迎宾大厅');
  api.dispose();
});
test('UI-R2: CSS centres a lone empty state in the content area without trapping it above the scroll edge', async () => {
  const css=await readFile(new URL('../style.css',import.meta.url),'utf8');
  assert.ok(css.includes('#x-content[data-solo-empty], #x-content[data-solo-empty] :has(.x-empty, .sp-cocreation-empty, .sp-value-empty) { display: flex; flex-direction: column; flex: 1; }'),'wrapper chain fills the area');
  assert.ok(css.includes('#x-content[data-solo-empty] :is(.x-empty, .sp-cocreation-empty, .sp-value-empty) { margin-block: auto; }'),'auto margins, not justify-content:center');
});
