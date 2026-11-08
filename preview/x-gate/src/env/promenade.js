// S01 观景步道，白色轻栏杆与圆形观景台。
import * as THREE from 'three';
import { addWalker, addServiceRobot } from './walkers.js';
import { sweep } from './util.js';
import { addRailing } from './railings.js';
import { shardGeometry } from './islands.js';

export const PROMENADE = { width: 10, points: [[170, 8, 480], [75, 8, 350], [30, 2, 195]], lampSpacing: 20 };

export function buildPromenade(ctx, b, inst, islands, hi, railing) {
  const hq = islands.find(i => i.hq);
  const points = [...PROMENADE.points, [20, hq.yT + .06, 170]].map(([x, y, z]) => new THREE.Vector3(x + hq.cx, y, z + hq.cz));
  const worldUp = new THREE.Vector3(0, 1, 0), samples = [], frames = [];
  let distance = 0;
  for (let s = 0; s < points.length - 1; s++) {
    const a = points[s], c = points[s + 1], length = a.distanceTo(c), n = Math.ceil(length / 3);
    const T = c.clone().sub(a).normalize(), S = new THREE.Vector3().crossVectors(T, worldUp).normalize(), U = new THREE.Vector3().crossVectors(S, T).normalize();
    const segment = [];
    for (let j = 0; j <= n; j++) {
      const P = a.clone().lerp(c, j / n), f = { P, T, S, U, distance: distance + length * j / n };
      segment.push(f); frames.push(f); samples.push(P.clone());
    }
    const add = (profile, mat) => b.add(sweep(segment, profile), {}, mat);
    add([[-5, 0], [5, 0]], 'ceramic');
    add([[5, 0], [5, -1.3], [-5, -1.3], [-5, 0]], 'shellCool');
    for (const side of [-1, 1]) {
      const x = side * 3.1;
      add([[x - .055, .025], [x + .055, .025]], 'glowTeal');
      // 观景台开口处不中断步行通路。
      const runs = []; let run = [];
      for (const f of segment) {
        const p = f.P.clone().addScaledVector(f.S, side * 4.85);
        const inDeck = Math.hypot(p.x - (58 + hq.cx), p.z - (347 + hq.cz)) < 14.8 || p.distanceTo(points[0]) < 14.8;
        if (inDeck) { if (run.length > 1) runs.push(run); run = []; }
        else run.push(f);
      }
      if (run.length > 1) runs.push(run);
      for (const fr of runs) addRailing(b, fr, side * 4.85, railing);
    }
    distance += length;
  }
  const decks = [[58 + hq.cx, 8, 347 + hq.cz, 0, .85], [points[0].x, 8, points[0].z, Math.atan2(-130, -95), .38]];
  for (const [x, y, z, entry, half] of decks) {
    b.cyl(15, 15, 1.3, { x, y: y - .65, z }, 'ceramic', hi ? 96 : 64);
    b.add(shardGeometry(12, 33, x * .3, hi ? 13 : 9), { x, y: y - 1.3, z }, 'rock');
    const arc = [], start = entry + half, span = Math.PI * 2 - half * 2, n = Math.ceil(span * 15 / 1.5);
    for (let i = 0; i <= n; i++) {
      const a = start + span * i / n, P = new THREE.Vector3(x + 14.75 * Math.cos(a), y, z + 14.75 * Math.sin(a));
      arc.push({ P, T: new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)), S: new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), U: worldUp });
    }
    addRailing(b, arc, 0, railing);
  }
  for (let d = 0; d <= distance; d += PROMENADE.lampSpacing) {
    const index = frames.findIndex(f => f.distance >= d), f = frames[Math.max(0, index)], prev = frames[Math.max(0, index - 1)];
    const t = (d - prev.distance) / (f.distance - prev.distance || 1);
    const p = prev.P.clone().lerp(f.P, t).addScaledVector(f.S, 4.6);
    // 白色细杆与小灯头合入现有材质批次。
    b.cyl(.075, .11, 6.2, { x: p.x, y: p.y + 3.1, z: p.z }, 'ceramic', 8);
    b.cyl(.2, .2, .24, { x: p.x, y: p.y + 6.25, z: p.z }, 'glowWhite', 8);
  }
  // S01 左下步道翼：接回既有观景台，前景旗帜与花树留在建筑轮廓外。
  const corner=[],A=new THREE.Vector3(58,8,347),C=new THREE.Vector3(4,8,291);
  const T=C.clone().sub(A).normalize(),S=new THREE.Vector3().crossVectors(T,worldUp).normalize();
  for(let j=0;j<=24;j++)corner.push({P:A.clone().lerp(C,j/24),T,S,U:worldUp});
  b.add(sweep(corner,[[-6,0],[6,0]]),{},'ceramic');
  b.add(sweep(corner,[[6,0],[6,-1],[-6,-1],[-6,0]]),{},'shellCool');
  for(const side of [-1,1])addRailing(b,corner.slice(5),side*5.8,railing);
  samples.push(...corner.map(f=>f.P.clone()));
  // 双侧地灯带与横向铺装接缝提供行进尺度，沿已有玻璃栏杆收边。
  for(const side of [-1,1])b.add(sweep(corner,[[side*4.6-.055,.035],[side*4.6+.055,.035]]),{},'glowSoft');
  for(let j=3;j<corner.length;j+=2){
    const f=corner[j];
    b.box(10.6,.018,.04,{x:f.P.x,y:f.P.y+.02,z:f.P.z,ry:Math.atan2(-S.z,S.x)},'shellCool');
  }
  const flagWidth=1.25,flagHeight=5,flagYaw=.2;
  const flagEdge=new THREE.MeshStandardMaterial({name:'env:flag-cyan-edge',color:0x34d9e5,roughness:.85,metalness:0,side:THREE.DoubleSide});
  for(const t of [.43,.65,.87]){
    const P=A.clone().lerp(C,t).addScaledVector(S,-5.4);
    b.cyl(.055,.085,8.2,{x:P.x,y:P.y+4.1,z:P.z},'ceramic',8);
    b.cyl(.22,.27,.14,{x:P.x,y:P.y+.07,z:P.z},'ceramic',12);
    const cloth=(left,right,mat)=>{
      const flag=new THREE.PlaneGeometry(right-left,flagHeight,4,12),pos=flag.attributes.position;
      for(let i=0;i<pos.count;i++){
        const x=pos.getX(i)+(left+right)*.5,y=pos.getY(i)-flagHeight*.5,u=x/flagWidth;
        pos.setXYZ(i,x,y,.20*Math.sin(u*Math.PI*.8)*Math.cos(y*.45));
      }
      flag.computeVertexNormals();
      b.add(flag,{x:P.x,y:P.y+7.9,z:P.z,ry:flagYaw},mat);
    };
    cloth(0,flagWidth-.065,railing.cobalt);cloth(flagWidth-.065,flagWidth,flagEdge);
    const end=P.clone().add(new THREE.Vector3(flagWidth+.08,0,0).applyAxisAngle(worldUp,flagYaw));
    b.tube([new THREE.Vector3(P.x,P.y+7.95,P.z),new THREE.Vector3(end.x,P.y+7.95,end.z)],.045,{},'ceramic',1,5);
  }
  const trees=[.56,.83].map((t,i)=>{
    const P=A.clone().lerp(C,t).addScaledVector(S,-4.4);
    b.cyl(1.4,1.5,.45,{x:P.x,y:P.y+.225,z:P.z},'ceramic',hi?24:12);
    return {x:P.x,y:P.y+.45,z:P.z,scale:i?.60:.525,height:i?7:6.5,detail:'fine'};
  });
  for(let i=0;i<8;i++) {
    const f=corner[3+i*2],p=f.P.clone().addScaledVector(f.S,(i%3-1)*1.6);
    addWalker(b,p,Math.atan2(f.T.x,f.T.z)+(i%2)*Math.PI,i);
  }
  addServiceRobot(b,corner[9].P.clone().addScaledVector(S,2),Math.atan2(T.x,T.z));
  hq.gaps.push({ th: Math.atan2(195, 30), half: .085 });
  return { samples, trees, points: points.map(p => p.toArray()), width: 10, lampSpacing: 20, decks: decks.map(([x,y,z]) => ({ center: [x,y,z], diameter: 30 })) };
}
