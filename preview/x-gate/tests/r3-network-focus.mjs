// 本地Three几何/射线验证，不创建WebGL renderer，不代替浏览器实渲。
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {kit} from '../src/kit/kit.js';
import {createMaterials} from '../src/kit/materials.js';
import {PLACES,facingRotation} from '../src/kit/world.js';
import {graph,neighbors,loadNetwork,setNetworkGraph} from '../src/app/data/network.js';
import {build} from '../src/buildings/network.js';
import {networkNodePreset,networkFocusPath} from '../src/app/camera.js';
import {selectHit} from '../src/app/shell/picking.js';
import {mockFetch, payloads} from './mock-api.mjs';
// Six API-backed fixture nodes exercise a visible two-hop chain and unrelated nodes.
const fetchData=mockFetch();
globalThis.fetch=(url,init)=>url==='/api/agentchat/agents'
  ? Promise.resolve(new Response(JSON.stringify({data:{...payloads['/agentchat/agents'],items:[...payloads['/agentchat/agents'].items,
    {id:'extra-0',name:'测试独立节点 A'},{id:'extra-1',name:'测试独立节点 B'}]},meta:{}})))
  : fetchData(url,init);
setNetworkGraph(await loadNetwork());
assert.ok(graph.nodes.length>=4);assert.ok(graph.relations.length>=3);
for (const quality of ['high','low']) {
  const built=build({THREE,kit,mats:createMaterials(),quality,reducedMotion:true,renderer:null,scene:new THREE.Scene(),camera:new THREE.PerspectiveCamera(),pmrem:null});
  const root=new THREE.Group();root.position.fromArray(PLACES.network.position);root.rotation.y=facingRotation('network');root.add(built.group);
  const hotspots=built.setGraph(graph);root.updateMatrixWorld(true);
  const world={hotspots,places:{network:{...built,anchor:root.position.clone(),bounds:kit.visibleBounds(built.group)}}};
  const meshes=[];root.traverse(o=>{if(o.isMesh&&!o.userData.hotspot)meshes.push(o);});
  for (const mobile of [false,true]) {
    world.camera=new THREE.PerspectiveCamera(45,mobile?390/844:1440/900,.5,9000);
    world.canvas={clientWidth:mobile?390:1440,clientHeight:mobile?844:900};
    let visible=0,outside=0,pathSamples=0;const distances=new Set(),fail=[];
    let relatedInFrame=0;const fovs=new Set();
    const poses=hotspots.map(h=>networkNodePreset(world,h.userData.nodeId,mobile));
    hotspots.forEach((h,i)=>{
      const p=poses[i];assert.ok(p,`${h.userData.nodeId}: missing pose`);
      const node=new THREE.Vector3(...p.lookAt),pos=new THREE.Vector3(...p.position),distance=pos.distanceTo(node);
      assert.ok(distance>=(mobile?120:60)-1e-8&&distance<=(mobile?144:90)+1e-8);distances.add(+distance.toFixed(2));fovs.add(+p.fov.toFixed(2));
      if(!world.places.network.bounds.containsPoint(pos))outside++;
      const ray=new THREE.Raycaster(pos,node.clone().sub(pos).normalize());
      const picked=selectHit(ray.intersectObjects(hotspots),ray.intersectObjects(meshes),'network');
      if(picked?.object===h)visible++;else fail.push(h.userData.nodeId);
      const camera=new THREE.PerspectiveCamera(p.fov,mobile?390/844:1.6,.5,9000),height=1000,width=camera.aspect*height;
      camera.position.copy(pos);camera.lookAt(node);camera.setViewOffset(width,height,p.frameOffset[0]*width,p.frameOffset[1]*height,width,height);camera.updateMatrixWorld(true);
      const projected=node.clone().project(camera);
      assert.ok(mobile ? Math.abs((1-projected.y)/2-.225)<1e-8&&Math.abs(projected.x)<.01 : projected.x<-.4&&Math.abs(projected.y)<.01);
      if (mobile) {
        assert.ok(p.fov>=65&&p.fov<=135,`${h.userData.nodeId}: mobile fov ${p.fov}`);assert.deepEqual(p.frameOffset,[0,.275],`${h.userData.nodeId}: mobile frameOffset`);
        const related=new Set([h.userData.nodeId,...neighbors(h.userData.nodeId)]);
        for(const id of [...related])for(const next of neighbors(id))related.add(next);
        for(const neighbor of hotspots.filter(n=>related.has(n.userData.nodeId))) {
          const point=world.places.network.group.localToWorld(neighbor.userData.anchor.clone()).project(camera);
          const x=(point.x+1)/2,y=(1-point.y)/2;
          assert.ok(point.z>=-1&&point.z<=1&&x>=.05&&x<=.95&&y>=.06&&y<=.45-64/844-.025,`${h.userData.nodeId} -> ${neighbor.userData.nodeId}: clipped (${x},${y})`);
          relatedInFrame++;
        }
        if(h.userData.nodeId==='a-zhuiguang') {
          const visibleRelated=hotspots.filter(n=>related.has(n.userData.nodeId)).filter(n=>{
            const target=world.places.network.group.localToWorld(n.userData.anchor.clone());
            const ray=new THREE.Raycaster(pos,target.sub(pos).normalize());
            return selectHit(ray.intersectObjects(hotspots),ray.intersectObjects(meshes),'network')?.object===n;
          }).map(n=>n.userData.nodeId);
          const direct=neighbors('a-zhuiguang');
          const chain=direct.filter(id=>visibleRelated.includes(id)).flatMap(id=>neighbors(id).filter(next=>next!=='a-zhuiguang'&&!direct.includes(next)&&visibleRelated.includes(next)).map(next=>['a-zhuiguang',id,next]))[0];
          assert.ok(chain,'selected node and an unobscured two-hop chain must be visible');
          console.log(JSON.stringify({quality,selected:'a-zhuiguang',distanceMeters:+distance.toFixed(2),fov:+p.fov.toFixed(2),screen:[+(projected.x/2+.5).toFixed(3),+(.5-projected.y/2).toFixed(3)],twoHopIncludingSelected:related.size,rayVisibleRelated:visibleRelated.length,visibleTwoHopChain:chain}));
        }
      } else {
        assert.equal(p.fov,60,`${h.userData.nodeId}: desktop fov`);assert.deepEqual(p.frameOffset,[.22,0],`${h.userData.nodeId}: desktop frameOffset`);
      }
      // 逐节点绕行至下一个节点，核验中间态在建筑包围盒外。
      const path=networkFocusPath(world,pos,poses[(i+1)%poses.length].position);
      for(let n=0;n<=40;n++){assert.equal(world.places.network.bounds.containsPoint(path(n/40)),false,`${h.userData.nodeId}: path inside network`);pathSamples++;}
    });
    console.log(JSON.stringify({quality,viewport:mobile?'390x844':'1440x900',nodes:hotspots.length,distancesMeters:[...distances],fovRange:[Math.min(...fovs),Math.max(...fovs)],relatedInFrame,outsideBounds:outside,centerRayVisible:visible,pathSamples,blocked:fail}));
    assert.equal(outside,hotspots.length);assert.deepEqual(fail,[]);
  }
  built.dispose();
}
