// 分馆观景步道：建筑局部 +Z，与总部桥并排；hub 侧支路托住当前 S03 机位。
import * as THREE from 'three';
import { facingRotation } from '../kit/world.js';
import { sweep } from './util.js';
import { addRailing } from './railings.js';
import { addWalker, addServiceRobot } from './walkers.js';
import { shardGeometry } from './islands.js';

export function buildForecourts(ctx,b,islands,railing,hi){
  const samples=[],trees=[],shrubs=[],specs=[],up=new THREE.Vector3(0,1,0);
  for(const isl of islands.filter(i=>!i.hq)){
    const yaw=facingRotation(isl.id),side=['network','cocreation'].includes(isl.id)?-1:1,x=side*30;
    const ground=(lx,lz)=>new THREE.Vector3(lx,0,lz).applyAxisAngle(up,yaw).add(new THREE.Vector3(isl.cx,isl.yT+.08,isl.cz));
    let low=0,high=isl.R*1.5;
    for(let i=0;i<28;i++){
      const z=(low+high)/2,p=ground(x,z),dx=p.x-isl.cx,dz=p.z-isl.cz;
      if(Math.hypot(dx,dz)<isl.outline(Math.atan2(dz,dx)))low=z;else high=z;
    }
    const start=low-18,end=low+84,length=end-start,rise=isl.id==='hub'?14:4;
    const world=(lx,lz)=>{const p=ground(lx,lz);p.y+=rise*THREE.MathUtils.clamp((lz-start)/length,0,1);return p;};
    const entrance=ground(x,low),entranceAngle=Math.atan2(entrance.z-isl.cz,entrance.x-isl.cx);
    isl.gaps.push({th:entranceAngle,half:10/isl.R});
    const segments=[[[x,start],[x,end]]];
    if(isl.id==='hub')segments.push([[x,end-10],[70,170]]);
    for(const [segmentIndex,[a,c]] of segments.entries()){
      const A=world(...a),C=world(...c),T=C.clone().sub(A).normalize(),S=new THREE.Vector3().crossVectors(T,up).normalize(),N=Math.ceil(A.distanceTo(C)/3),frames=[];
      for(let j=0;j<=N;j++){const P=A.clone().lerp(C,j/N);frames.push({P,T,S,U:up});samples.push(P.clone());}
      b.add(sweep(frames,[[-5,0],[5,0]]),{},'ceramic');
      b.add(sweep(frames,[[5,0],[5,-1.1],[-5,-1.1],[-5,0]]),{},'shellCool');
      for(const sign of [-1,1]){
        let run=[];
        const flush=()=>{if(run.length>1)addRailing(b,run,sign*4.85,railing,1);run=[];};
        for(const f of frames){
          const atPlatform=f.P.distanceTo(C)<14;
          const atBranchStart=segmentIndex>0&&f.P.distanceTo(A)<7;
          const atJunction=isl.id==='hub'&&segmentIndex===0&&sign===-1&&f.P.distanceTo(world(x,end-10))<7;
          if(atPlatform||atBranchStart||atJunction)flush();else run.push(f);
        }
        flush();
        b.add(sweep(frames,[[sign*3.1-.055,.025],[sign*3.1+.055,.025]]),{},'glowTeal');
      }
      for(let d=0;d<=A.distanceTo(C);d+=20){
        const p=A.clone().addScaledVector(T,d).addScaledVector(S,4.5);
        b.cyl(.075,.11,6.2,{x:p.x,y:p.y+3.1,z:p.z},'ceramic',8);
        b.cyl(.2,.2,.24,{x:p.x,y:p.y+6.25,z:p.z},'glowWhite',8);
      }
    }
    const centers=[[x,end]];if(isl.id==='hub')centers.push([70,170]);
    for(const [cx,cz] of centers){
      const p=world(cx,cz),radius=14;
      b.cyl(radius,radius,1.1,{x:p.x,y:p.y-.55,z:p.z},'ceramic',hi?64:40);
      b.add(shardGeometry(9,24,isl.seed,hi?9:6),{x:p.x,y:p.y-1.1,z:p.z},'rock');
      // 背向来路留开口，弧形玻璃栏杆在近景压角。
      const entryAngle=isl.id==='hub'&&cx===70?Math.atan2(end-10-cz,x-cx):-Math.PI/2;
      const arc=[],n=hi?54:36;
      for(let j=0;j<=n;j++){
        const angle=entryAngle+.42+(Math.PI*2-.84)*j/n;
        const P=world(cx+Math.cos(angle)*(radius-.2),cz+Math.sin(angle)*(radius-.2)); P.y=p.y;
        arc.push({P,T:new THREE.Vector3(-Math.sin(angle),0,Math.cos(angle)).applyAxisAngle(up,yaw),S:new THREE.Vector3(Math.cos(angle),0,Math.sin(angle)).applyAxisAngle(up,yaw),U:up});
      }
      addRailing(b,arc,0,railing,hi?28:20);
      for(const sign of [-1,1]){
        const t=world(cx+sign*9,cz-(isl.id==='hub'?4:28));
        if(isl.id==='hub')t.y=p.y;
        else b.box(7,1.1,8,{x:t.x,y:t.y-.55,z:t.z,ry:yaw},'ceramic');
        b.cyl(2.8,3, .65,{x:t.x,y:t.y+.325,z:t.z},'ceramic',16);
        trees.push({x:t.x,y:t.y+.65,z:t.z,scale:isl.id==='hub'?.85:1.15});
        shrubs.push({x:t.x+1,y:t.y+.65,z:t.z,scale:1.05});
      }
    }
    specs.push({id:isl.id,localX:x,startZ:start,endZ:end,length,outsideLength:84,y:isl.yT+.08,rise,platforms:centers.map(c=>world(...c).toArray())});
  }
  const cameraDecks = buildCameraDecks(b,islands,railing,hi);
  samples.push(...cameraDecks.samples); trees.push(...cameraDecks.trees);
  return {samples,trees,shrubs,specs,cameraTrees:cameraDecks.trees,cameraDecks:cameraDecks.specs};
}

// 从 main.js SHOTS (S02–S05) 的局部机位推算，固定世界几何，不随切镜头显隐。
export const CAMERA_APPROACHES = {
  network: {pos:[-62,16,148],side:1}, hub:{pos:[76,14,126],side:-1},
  cocreation:{pos:[-75,14,175],side:-1}, value:{pos:[70,14,185],side:-1},
};
function buildCameraDecks(b,islands,railing,hi) {
  const up=new THREE.Vector3(0,1,0),samples=[],trees=[],specs=[];
  for(const isl of islands.filter(i=>!i.hq)) {
    const {pos,side}=CAMERA_APPROACHES[isl.id],yaw=facingRotation(isl.id);
    const eye=new THREE.Vector3(...pos),forward=new THREE.Vector3(-pos[0],0,-pos[2]).normalize();
    const right=new THREE.Vector3().crossVectors(forward,up);
    const at=(depth,offset,y)=>eye.clone().addScaledVector(forward,depth).addScaledVector(right,offset*side).setY(y);
    const localEnd=at(Math.hypot(pos[0],pos[2])-isl.R+12,isl.id==='network'?22:9,0);
    const world=p=>p.applyAxisAngle(up,yaw).add(new THREE.Vector3(isl.cx,isl.yT+.1,isl.cz));
    const lift=isl.id==='network'?2.5:0, offset=isl.id==='network'?7:0;
    const curve=new THREE.CatmullRomCurve3([at(3,11,4),at(28,9+offset,8+lift),at(52,5+offset,7+lift),localEnd].map(world));
    const frames=[],n=hi?44:28,half=6;
    for(let i=0;i<=n;i++) {
      const P=curve.getPoint(i/n),T=curve.getTangent(i/n).normalize(),S=new THREE.Vector3().crossVectors(T,up).normalize();
      frames.push({P,T,S,U:up});samples.push(P.clone());
    }
    b.add(sweep(frames,[[-half,0],[half,0]]),{},'ceramic');
    b.add(sweep(frames,[[half,0],[half,-.8],[-half,-.8],[-half,0]]),{},'shellCool');
    for(const sign of [-1,1]) {
      addRailing(b,frames,sign*(half-.15),railing);
      b.add(sweep(frames,[[sign*4.7-.07,.035],[sign*4.7+.07,.035]]),{},'glowTeal');
    }
    for(let i=2;i<n;i+=4) {
      const f=frames[i];
      b.box(11.5,.025,.06,{x:f.P.x,y:f.P.y+.025,z:f.P.z,ry:Math.atan2(-f.S.z,f.S.x)},'shellCool');
      for(const sign of [-1,1]) {
        const p=f.P.clone().addScaledVector(f.S,sign*5.8);
        b.box(.17,1.36,.17,{x:p.x,y:p.y+.68,z:p.z},railing.cobalt);
      }
    }
    for(const t of [.24,.50,.77]) {
      const f=frames[Math.round(t*n)],p=f.P.clone().addScaledVector(f.S,side*5.3);
      b.cyl(.07,.12,4.6,{x:p.x,y:p.y+2.3,z:p.z},'ceramic',6);
      b.box(.22,.65,.22,{x:p.x,y:p.y+4.3,z:p.z},'glowTeal');
    }
    for(let i=0;i<8;i++) {
      const f=frames[Math.round((.14+i*.09)*n)],p=f.P.clone().addScaledVector(f.S,(i%3-1)*1.8);
      addWalker(b,p,Math.atan2(f.T.x,f.T.z)+(i%3===0?Math.PI:0),i);
    }
    const r=frames[Math.round(n*.28)];addServiceRobot(b,r.P.clone().addScaledVector(r.S,-2),Math.atan2(r.T.x,r.T.z));
    const f=frames[Math.round(n*.50)],tree=f.P.clone().addScaledVector(f.S,side*6.8);
    b.cyl(2.3,2.5,.65,{x:tree.x,y:tree.y+.325,z:tree.z},'ceramic',16);
    trees.push({x:tree.x,y:tree.y+.65,z:tree.z,scale:.60,height:4.2,crown:true});
    const end=frames[n].P,a=Math.atan2(end.z-isl.cz,end.x-isl.cx);isl.gaps.push({th:a,half:10/isl.R});
    specs.push({id:isl.id,people:8,robot:1,lamps:3,width:12,points:frames.map(f=>f.P.toArray())});
  }
  return {samples,trees,specs};
}
