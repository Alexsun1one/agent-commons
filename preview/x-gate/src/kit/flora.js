// 用法：group.add(blossomTrees(ctx, [{x:0,y:0,z:0,scale:1}], {seed:7})); shrubs 同签名。
// points 也可为 [x,y,z,scale]；opts 支持 seed/scale/name。返回 InstancedMesh（花冠含枝干实例子网格），随 kit.disposeTree 释放。
import * as THREE from 'three';

function point(p, scale) {
  const q = Array.isArray(p) ? {x:p[0],y:p[1],z:p[2],scale:p[3]} : p;
  return {...q, x:q.x??0, y:q.y??0, z:q.z??0, scale:(q.scale??1)*scale};
}
function foliageMaterial(name) {
  const m = new THREE.MeshStandardMaterial({name,color:0xffffff,roughness:.87,metalness:0});
  m.onBeforeCompile = s => {
    s.vertexShader = 'varying vec3 vFloraSurface;\n' + s.vertexShader;
    s.vertexShader = s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vFloraSurface=position;');
    s.fragmentShader = 'varying vec3 vFloraSurface;\n' + s.fragmentShader;
    s.fragmentShader = s.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec3 cell=floor(vFloraSurface*38.0);
      float petal=fract(sin(dot(cell,vec3(12.9898,78.233,37.719)))*43758.5453);
      float cluster=.5+.5*sin(vFloraSurface.x*19.0+sin(vFloraSurface.z*23.0))*sin(vFloraSurface.y*21.0);
      diffuseColor.rgb*=.88+.12*cluster+.06*petal;`);
    s.fragmentShader = s.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float floraRim=pow(1.0-max(0.0,dot(normal,normalize(vViewPosition))),3.0);
      totalEmissiveRadiance+=diffuseColor.rgb*floraRim*.12;`);
  };
  m.customProgramCacheKey = () => 'flora-petal-rim-v2';
  return m;
}
function instances(kit, geo, mat, transforms, colors, name) {
  const mesh=kit.instanced(geo,mat,transforms,name);
  colors.forEach((color,i)=>mesh.setColorAt(i,color));
  mesh.castShadow=true;mesh.receiveShadow=true;mesh.frustumCulled=false;
  return mesh;
}
function clusterGeometry(hi,flower=false) {
  const g=flower?new THREE.SphereGeometry(1,hi?10:6,hi?6:3):hi?new THREE.SphereGeometry(1,6,4):new THREE.IcosahedronGeometry(1,0);
  const p=g.attributes.position;
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
    const r=1+.025*Math.sin(x*7+z*3)*Math.cos(y*6)+.015*Math.sin(z*11-y*4);
    p.setXYZ(i,x*r,y*r,z*r);
  }
  g.computeVertexNormals();
  if(flower) {
    const normal=g.attributes.normal,v=new THREE.Vector3();
    for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).normalize();normal.setXYZ(i,v.x,v.y,v.z);}
  }
  return g;
}
export function blossomTrees(ctx, points, opts={}) {
  const {kit}=ctx, hi=ctx.quality!=='low', rnd=kit.rng(opts.seed??73119), leaves=[], branches=[], colors=[], counts=[];
  const a=new THREE.Color(0x9678f2),c=new THREE.Color(0xdacbff),mint=new THREE.Color(0x74cdbd);
  const up=new THREE.Vector3(0,1,0),q=new THREE.Quaternion(),m=new THREE.Matrix4();
  const branch=(from,to,r)=>{const d=to.clone().sub(from);q.setFromUnitVectors(up,d.clone().normalize());m.compose(from.clone().add(to).multiplyScalar(.5),q,new THREE.Vector3(r,d.length(),r));branches.push(m.clone());};
  for(const entry of points){
    const p=point(entry,opts.scale??1),s=p.scale,h=(p.height??(5.2+rnd()*2))*s,fine=p.detail==='fine',n=fine?(hi?12:10):(p.crown?6:hi?6+Math.floor(rnd()*3):6),yaw=rnd()*Math.PI*2;
    counts.push(n);
    const foot=new THREE.Vector3(p.x,p.y,p.z),fork=foot.clone().add(new THREE.Vector3((rnd()-.5)*.5*s,h*.48,0));
    const middle=foot.clone().lerp(fork,.48).add(new THREE.Vector3(.15*s,0,-.12*s));
    branch(foot,middle,.13*s);branch(middle,fork,.10*s);
    for(let j=0;j<n;j++){
      const angle=yaw+j*2.399,reach=(p.crown?.4+Math.sqrt(j/n)*1.3:.65+Math.sqrt(j/n)*1.65)*s;
      const tip=new THREE.Vector3(p.x+Math.cos(angle)*reach,p.y+h*(.78+rnd()*.28),p.z+Math.sin(angle)*reach);
      branch(fork,tip,.055*s);
      const clusters=fine?3:1;
      for(let k=0;k<clusters;k++){
        // 前景精细花枝：一枝三簇细花，保留枝杈间隙；普通树仍沿用原随机序列。
        const size=(fine?.24+rnd()*.19:p.crown?1.2+rnd()*.45:.62+rnd()*.65)*s;
        const bloom=tip.clone();
        if(fine){
          const phase=angle+k*2.1;
          bloom.add(new THREE.Vector3(Math.cos(phase)*.42*s,(k-1)*.28*s,Math.sin(phase)*.42*s));
          branch(tip,bloom,.025*s);
        }
        leaves.push(kit.toMatrix({x:bloom.x,y:bloom.y,z:bloom.z,sx:size*(1+rnd()*.28),sy:size*(.75+rnd()*.35),sz:size*(.8+rnd()*.42),ry:angle,rz:(rnd()-.5)*.3}));
        colors.push((p.mint?mint:a).clone().lerp(c,.2+rnd()*.65));
      }
    }
  }
  const name=opts.name??'flora:blossoms';
  const canopy=instances(kit,clusterGeometry(hi,true),foliageMaterial(name),leaves,colors,name);
  const wood=new THREE.MeshStandardMaterial({name:name+':bark',color:0xd1dadd,roughness:.94});
  canopy.add(instances(kit,new THREE.CylinderGeometry(.62,1,1,hi?6:4,1,true),wood,branches,[],name+':branches'));
  canopy.userData.points=points.map(p=>point(p,opts.scale??1));
  canopy.userData.treeCount=points.length;canopy.userData.crownCounts=counts;
  return canopy;
}
export function shrubs(ctx, points, opts={}) {
  const {kit}=ctx,hi=ctx.quality!=='low',rnd=kit.rng(opts.seed??5031),parts=[],colors=[];
  const a=new THREE.Color(0x3f8f7a),b=new THREE.Color(0x5fb39a);
  for(const entry of points){
    const p=point(entry,opts.scale??1),n=3;
    for(let j=0;j<n;j++){
      const angle=j*2.4+rnd(),spread=j?(.35+rnd()*.4)*p.scale:0,size=(.6+rnd()*.45)*p.scale;
      parts.push(kit.toMatrix({x:p.x+Math.cos(angle)*spread,y:p.y+size*.45+(j%2)*size*.2,z:p.z+Math.sin(angle)*spread,sx:size,sy:size*(.7+rnd()*.35),sz:size*(.8+rnd()*.3),ry:angle,rz:(rnd()-.5)*.25}));
      colors.push(p.flower ? new THREE.Color(0x9869e5).lerp(new THREE.Color(0xd7bfff),rnd()) : a.clone().lerp(b,rnd()));
    }
  }
  const mesh=instances(kit,clusterGeometry(hi),foliageMaterial(opts.name??'flora:shrubs'),parts,colors,opts.name??'flora:shrubs');
  mesh.userData.patchCount=points.length;
  return mesh;
}
