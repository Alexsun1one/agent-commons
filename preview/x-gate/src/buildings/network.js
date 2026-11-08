// 智能体连接中心 AGENT NETWORK。
// 白蓝叠盘塔与弧形玻璃展厅，白底飞碟舱由明亮青色光网连接。
// 对接：setGraph(graph) 返回新节点热点数组；highlight(id|null)；markMine(ids[])；nodeHotspots。
import { blossomTrees, shrubs } from '../kit/flora.js';

export const meta = { id: 'network', name: '智能体连接中心', en: 'AGENT NETWORK' };

// 内置占位图（10 人 + 14 Agent + 38 关系），外壳装配后会被 src/app/data/network.js 的 graph 替换。
const PLACEHOLDER = { nodes: [], relations: [] };

export function build(ctx) {
  const { THREE, kit, mats, quality, reducedMotion } = ctx;
  const hi = quality !== 'low';
  const TAU = Math.PI * 2, deg = (d) => d * Math.PI / 180;
  const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const root = new THREE.Group(); root.name = meta.id;
  const b = new kit.Builder(mats);

  // ───────── 通用小工具 ─────────
  const Y_AXIS = V3(0, 1, 0);
  // 两点之间一根杆（开口圆柱，端头由节点球/板盖住）。
  const beam = (bd, p0, p1, r, mat, seg = 6) => {
    const a = V3(...p0), c = V3(...p1), d = c.clone().sub(a), len = d.length();
    if (len < 1e-4) return;
    const q = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, d.normalize());
    bd.add(new THREE.CylinderGeometry(r, r, 1, seg, 1, true), new THREE.Matrix4().compose(a.add(c).multiplyScalar(0.5), q, V3(1, len, 1)), mat);
  };
  // 圆环弧：compass 角（自 +Z 向 +X 增大）a0..a1，半径 R，管径 r，高度 y。
  const arcTorus = (bd, R, r, a0, a1, y, mat, rs = 5) => {
    const arc = a1 - a0; if (arc <= 0) return;
    bd.add(new THREE.TorusGeometry(R, r, rs, Math.max(6, Math.ceil(arc * R / (hi ? 1.6 : 3.2))), arc), { y, rx: Math.PI / 2, ry: a1 - Math.PI / 2 }, mat);
  };
  // 环形扇区轮廓（供 extrude；沿 +Z 挤出后绕 X 转 -90°，Z→Y 向上，shape.y → 世界 -z）。
  const sectorShape = (r0, r1, a0, a1) => {
    const n = Math.max(6, Math.ceil((a1 - a0) / deg(3))), pts = [];
    for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; pts.push([Math.sin(a) * r1, -Math.cos(a) * r1]); }
    for (let i = n; i >= 0; i--) { const a = a0 + (a1 - a0) * i / n; pts.push([Math.sin(a) * r0, -Math.cos(a) * r0]); }
    return kit.polygon(pts);
  };
  const sector = (bd, r0, r1, a0, a1, y, h, mat, opts) => bd.add(new THREE.ExtrudeGeometry(sectorShape(r0, r1, a0, a1), { depth: h, bevelEnabled: false, curveSegments: 1 }), { rx: -Math.PI / 2, y }, mat, opts);
  const mergePN = (list) => {
    const gs = list.map(g => g.index ? g.toNonIndexed() : g);
    let n = 0; gs.forEach(g => { n += g.attributes.position.count; });
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3); let o = 0;
    for (const g of gs) { pos.set(g.attributes.position.array, o); if (g.attributes.normal) nor.set(g.attributes.normal.array, o); o += g.attributes.position.count * 3; }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    list.forEach(g => g.dispose?.()); return out;
  };

  // Design Contract R8: S02 可辨透明玻璃穹、青色反光边与冷光中的人形/熊猫剪影。
  // 白色下壳；腰灯保留 R6 的 70% 强度并恢复厚度；R7 细连线亮度增加 30%。
  // 复用既有几何与实例批次；不改布局、相机、共享灯光与后处理。
  // 节点 ID / 热点引用 / 高亮语义不变；high/low 的 tris、calls 均不增；禁暖色。
  const blue = mats.ceramic.clone(); blue.color.copy(mats.glowBlue.emissive);
  blue.name = 'network:cobalt'; blue.userData = {};
  const canopy = mats.glass.clone(); canopy.color.copy(mats.glowSoft.emissive);
  canopy.transparent = true; canopy.opacity = 0.3; canopy.depthWrite = false;
  canopy.metalness = 0.08; canopy.roughness = 0.18;
  canopy.emissive.copy(mats.glowSoft.emissive); canopy.emissiveIntensity = 0.45;
  canopy.name = 'network:canopy'; canopy.userData = { shared: true };
  const rim = mats.glow.clone(); rim.emissiveIntensity = 1.8;
  rim.emissive.set(0x18c9ff);
  rim.name = 'glow:network:rim'; rim.userData = {};
  // 黑斑不接环境反射/场景照明，也不让远景雾把近景黑色混成灰蓝。
  const pandaBlack = new THREE.MeshBasicMaterial({ color: 0x080c14, toneMapped: false, fog: false });
  pandaBlack.name = 'network:panda:black';
  const pandaWhite = mats.ceramic.clone();
  pandaWhite.name = 'network:panda:white'; pandaWhite.userData = {};
  pandaWhite.color.set(0xcbd4df); pandaWhite.metalness = 0; pandaWhite.roughness = 0.82; pandaWhite.clearcoat = 0; pandaWhite.envMapIntensity = 0.25;
  const G = 0.12, Y0 = 3.12, Y1 = G, DC = 106.5, DR = 5.5;
  const segBig = hi ? 48 : 32;
  const A0 = deg(40), A1 = deg(115);

  // 左前展厅：抬高的白色弧形檐口、通透连续幕墙与竖向窗梃。
  const exhibitStart = deg(285), exhibitEnd = deg(339);
  sector(b, 32, 50.5, exhibitStart, exhibitEnd, G, 0.8, 'shell');
  sector(b, 49.6, 49.8, exhibitStart, exhibitEnd, 0.92, 8.5, canopy);
  sector(b, 31.9, 32.1, exhibitStart, exhibitEnd, 0.92, 8.5, canopy);
  sector(b, 31, 51, exhibitStart, exhibitEnd, 9.42, 0.9, 'ceramic');
  arcTorus(b, 50.7, 0.18, exhibitStart, exhibitEnd, 9.5, rim);
  arcTorus(b, 49.8, 0.12, exhibitStart, exhibitEnd, 1.1, rim);
  for (let i = 0; i <= 12; i++) {
    const a = exhibitStart + (exhibitEnd - exhibitStart) * i / 12;
    b.cyl(0.14, 0.14, 8.5, { x: Math.sin(a)*49.9, y: 5.17, z: Math.cos(a)*49.9 }, 'ceramic', 6);
  }
  for (let i = 0; i < 4; i++) {
    const a = exhibitStart + (exhibitEnd - exhibitStart) * (i+0.5)/4;
    b.push({x:Math.sin(a)*43,y:1,z:Math.cos(a)*43,ry:a});
    b.cyl(2.1,2.4,0.6,{y:0.3},'ceramic',16);
    b.torus(2,0.09,{y:0.65},rim,4,24);
    b.box(3.8,4.6,0.1,{y:3.5},'holo');
    for (const y of [1.25,5.75]) b.box(3.8,0.045,0.12,{y,z:0.08},rim);
    for(let row=0;row<4;row++) b.box(1.2+row*0.45,0.055,0.12,{x:-0.35+row*0.15,y:2.15+row*0.65,z:0.1},rim);
    b.pop();
  }
  root.userData.exhibition = { arcDegrees:54, position:'front-left', displays:4 };

  // ── 台阶与裙楼：前庭直达拱门，两翼为有厚度的弧形白色屋盖。
  b.cyl(53, 53, 0.24, { y: G }, 'shellCool', segBig);
  b.cyl(28, 29, 3, { y: Y0 / 2 }, 'shell', segBig);
  for (let i = 0; i < 12; i++) {
    b.box(17.5, 0.26 * (i + 1), 1.65, { y: G + 0.13 * (i + 1), z: 47 - i * 1.65 }, 'shell');
  }
  for (const x of [-9.2, 9.2]) {
    beam(b, [x, 1.3, 48], [x, 4.3, 28], 0.12, 'shell', 8);
    beam(b, [x, 0.2, 48], [x, 3.2, 28], 0.08, 'glowSoft', 5);
  }
  for (const side of [-1, 1]) {
    const a0 = side < 0 ? deg(180) : deg(60), a1 = side < 0 ? deg(300) : deg(180);
    sector(b, 24, 53.8, a0, a1, G, 1, 'shellCool');
    sector(b, 49.5, 49.8, a0, a1, 1.12, 10.2, canopy);
    sector(b, 23, 53.8, a0, a1, 11.3, 1.4, 'shell');
    sector(b, 25, 48, a0, a1, 12.7, 0.45, 'shellCool');
    arcTorus(b, 53.6, 0.12, a0, a1, 11.45, 'glowSoft');
    arcTorus(b, 49.8, 0.11, a0, a1, 1.2, 'shell');
    b.radial(hi ? 15 : 10, 49.9, bb => {
      bb.box(0.5, 10, 0.6, { y: 6.3 }, 'shell');
    }, { phase: a0, arc: a1 - a0 });
    b.radial(3, 41, (bb, i) => {
      bb.box(9, 5.5, 0.22, { y: 6, z: 0.2 }, 'holo');
      for (let wave = 0; wave < 2; wave++) {
        const pts = Array.from({ length: 25 }, (_, j) => {
          const x = -4.4 + j * 8.8 / 24;
          return [x, 6 + Math.sin(x * 0.8 + wave * Math.PI + i * 0.3) * 1.75, 0.4];
        });
        bb.tube(pts, 0.065, {}, wave ? blue : 'glowSoft', hi ? 32 : 16, 4);
      }
    }, { phase: a0 + deg(12), arc: a1 - a0 - deg(24) });
  }
  // 中央通透门厅与双层拱肋，拱洞不被实心门廊挡住。
  b.cyl(19, 21, 17, { y: Y0 + 8.5 }, canopy, segBig, true);
  b.lathe([[18, 19], [23, 20], [24, 21], [22, 22], [10, 22]], {}, 'shell', segBig);
  const archPoints = [];
  for (let i = 0; i <= 36; i++) {
    const t = Math.PI * i / 36;
    archPoints.push([15.5 * Math.cos(t), Y0 + 2 + 20 * Math.sin(t), 28]);
  }
  b.tube(archPoints, 1.3, {}, 'shell', hi ? 64 : 32, hi ? 10 : 6);
  b.tube(archPoints.map(([x,y,z]) => [x,y,z + 1.1]), 0.14, {}, rim, hi ? 64 : 32, 4);
  for (const x of [-15.5, 15.5]) b.cyl(1.3, 1.3, 2.2, { x, y: Y0 + 1, z: 28 }, 'shell', 12);
  b.add(new THREE.PlaneGeometry(28, 19), { y: Y0 + 9.5, z: 24 }, canopy);
  for (const x of [-9, -4.5, 0, 4.5, 9]) b.box(0.2, 18, 0.24, { x, y: Y0 + 9, z: 24.1 }, 'shell');
  // 门内三块悬浮波形屏，正对入口；位置在玻璃之后。
  for(const [x,y] of [[-8,11],[0,14],[8,11]]) {
    b.box(6.6,4.8,0.12,{x,y,z:23.5},'holo');
    for(const phase of [0,Math.PI]) {
      const pts=Array.from({length:17},(_,i)=>[x-3+i*0.375,y+Math.sin(i*Math.PI/8+phase)*1.5,23.7]);
      b.tube(pts,0.095,{},rim,hi?24:12,4);
    }
  }

  // 拱门两侧各一块 14×8m 悬浮全息屏；底边高于裙楼屋面。
  for(const side of [-1,1]) {
    b.push({x:side*25,y:18,z:35,ry:side*0.12});
    b.box(14,8,0.1,{},'holo');
    for(const y of [-4,4]) b.box(14,0.09,0.12,{y},'glowSoft');
    for(const x of [-7,7]) b.box(0.09,8,0.12,{x},'glowSoft');
    for(const phase of [0,Math.PI]) {
      const pts=Array.from({length:25},(_,i)=>[-6.5+i*13/24,2.8*Math.sin(i*Math.PI/8+phase),0.12]);
      b.tube(pts,0.12,{},rim,hi?32:16,4);
    }
    b.pop();
  }

  // ── 四层叠盘塔：白色渐收塔身、钴蓝竖向嵌条、青色盘沿。
  b.lathe([[11.5,18],[11.5,22],[8.5,40],[6.3,65],[4.8,88],[3.5,108]], {}, 'shell', segBig);
  const profile = [[11.7,22],[8.7,40],[6.5,65],[5,88],[3.7,108]];
  b.radial(10, 0, bb => {
    bb.tube(profile.map(([r,y]) => [0,y,r]), 0.65, {}, blue, hi ? 24 : 12, 6);
  }, { phase: deg(18) });
  const PLAT = [{ y:26, ro:23.5 }, { y:48, ro:19.5 }, { y:68, ro:16.5 }, { y:89, ro:12.5 }];
  for (const { y, ro } of PLAT) {
    b.lathe([[3,-2],[ro-4,-2],[ro-0.6,-0.6],[ro,0],[ro,0.5],[ro-0.7,1],[3,1]], { y }, 'shell', segBig);
    b.torus(ro - 0.1, 0.24, { y:y+0.2 }, rim, 6, segBig);
    b.torus(ro - 1, 0.1, { y:y+2.1 }, 'shell', 5, segBig);
    b.radial(hi ? 40 : 20, ro - 1, bb => bb.cyl(0.075,0.075,1.1,{y:y+1.55},'shell',5));
    b.cyl(ro - 1.15, ro - 1.15, 1.1, { y:y+1.55 }, 'holo', segBig, true);
  }
  // 四处外挑环廊；R2 在 y=58m 补一圈独立中段廊桥。
  for(const [y,r] of [[48,16.2],[58,17.8],[68,13.2],[89,9.6]]) {
    if(y===58) b.lathe([[6,-0.4],[r+0.8,-0.4],[r+1,0.2],[r+1,1],[6,1]],{y},'ceramic',hi?64:32);
    b.cyl(r,r,4.2,{y:y+3.1},canopy,hi?64:32,true);
    b.lathe([[r-3,0],[r+0.9,0],[r+1.2,0.45],[r+0.9,0.8],[r-3,0.8]],{y:y+5.1},'ceramic',hi?64:32);
    b.torus(r+0.9,0.15,{y:y+5.5},rim,5,hi?64:32);
    b.radial(hi?20:12,r,bb=>bb.box(0.16,4.2,0.22,{y:y+3.1},'shell'));
  }
  // 三层独立开放阳台；栏杆、楼板和细灯线并入既有材质批次。
  for (const [y,r] of [[37,14.2],[77,11.2],[101,8]]) {
    b.lathe([[r-3,-0.25],[r,-0.25],[r+0.3,0.1],[r,0.42],[r-3,0.42]],{y},'ceramic',hi?32:20);
    b.torus(r,0.055,{y:y+0.38},rim,3,hi?32:20);
    b.torus(r-0.15,0.065,{y:y+1.55},'ceramic',3,hi?32:20);
    b.radial(hi?16:12,r-0.15,bb=>bb.cyl(0.045,0.045,1.1,{y:y+1},'ceramic',4));
  }
  root.userData.balconies={levels:[37,77,101],open:true};
  // 3.2m 宽螺旋坡道：前场地面 → 大厅外缘 → 越过屋面 → 第一层盘顶。
  const rampN=hi?120:60,rampWidth=3.2,railPaths=[[],[]],rampPositions=[],rampIndices=[];
  const rampPoint=(t,offset=0) => {
    const inward=Math.max(0,(t-0.52)/0.48),r=52.2+(22-52.2)*inward+offset,a=deg(30)+TAU*1.25*t;
    return [Math.sin(a)*r,0.24+26.76*t,Math.cos(a)*r];
  };
  for(let i=0;i<=rampN;i++) {
    const t=i/rampN;
    for(const side of [-1,1]) {
      const p=rampPoint(t,side*rampWidth/2);rampPositions.push(...p,p[0],p[1]-0.38,p[2]);
      railPaths[side<0?0:1].push([p[0],p[1]+1.15,p[2]]);
      if(i%4===0)beam(b,p,[p[0],p[1]+1.15,p[2]],0.07,'shell',5);
    }
    if(i<rampN) {
      const k=i*4;
      for(const [a,c,d] of [[0,2,4],[2,6,4],[1,5,3],[3,5,7],[0,4,1],[1,4,5],[2,3,6],[3,7,6]])rampIndices.push(k+a,k+c,k+d);
    }
  }
  rampIndices.push(0,1,2,1,3,2,rampN*4,rampN*4+2,rampN*4+1,rampN*4+1,rampN*4+2,rampN*4+3);
  const rampGeo=new THREE.BufferGeometry();rampGeo.setAttribute('position',new THREE.Float32BufferAttribute(rampPositions,3));rampGeo.setIndex(rampIndices);rampGeo.computeVertexNormals();b.add(rampGeo,{},'shell');
  for(const pts of railPaths)b.tube(pts,0.075,{},'shell',rampN,5);
  root.userData.ramp={width:rampWidth,start:rampPoint(0),end:rampPoint(1),turnDegrees:450};
  root.userData.hallArcDegrees=240;
  // 顶冠是一组纤细实心天线，无发光球堆。
  b.cyl(5.7, 4, 1.3, { y:108 }, 'shell', hi ? 48 : 24);
  b.torus(5.6,0.12,{y:108.7},'glowSoft',5,hi ? 64 : 32);
  for (let i=0;i<9;i++) {
    const a=i*TAU/9, h=5+(i%3)*3;
    b.cyl(0.065,0.14,h,{x:Math.sin(a)*4.3,y:109+h/2,z:Math.cos(a)*4.3},'shell',8);
    b.cyl(0.035,0.035,1.4,{x:Math.sin(a)*4.3,y:109+h,z:Math.cos(a)*4.3},'glowSoft',6);
  }
  // 天线套环与短横向接收器，保留主桅杆高度。
  for(let i=0;i<6;i++) {
    const a=i*TAU/6,x=Math.sin(a)*4.3,z=Math.cos(a)*4.3,y=111+i%3*3;
    b.cyl(0.22,0.22,0.32,{x,y,z},blue,6);
    beam(b,[x-0.65,y+1,z],[x+0.65,y+1,z],0.045,'ceramic',4);
  }
  b.cyl(0,0.75,29,{y:122.5},'ceramic',hi?16:10);
  b.cyl(0.055,0.055,17,{y:128},rim,6);
  for(const [y,r,tilt] of [[113,10.8,0.16],[121,7.5,-0.22]]) {
    b.torus(r,0.12,{y,rx:Math.PI/2+tilt},'ceramic',6,hi?72:36);
    b.torus(r,0.045,{y:y+0.15,rx:Math.PI/2+tilt},rim,4,hi?72:36);
  }
  root.userData.crown={spireTop:137,orbitRings:2};
  // 保留 update 的旋转对象，改为顶冠内部中继环。
  const gyro = new kit.Builder(mats);
  gyro.torus(3.3,0.09,{},'glowSoft',4,hi ? 48 : 24);
  const gyroMesh = gyro.build('gyro'); gyroMesh.position.y=DC; root.add(gyroMesh);

  // 共用 ENV flora：地面与屋顶的花树、灌木合批，保持低档 draw-call 预算。
  const treePoints=[], shrubPoints=[];
  for(const [i,a] of [38,63,88,113,138,163,198,223,248,273,298,323].map(deg).entries())
    treePoints.push({x:Math.sin(a)*51,y:G,z:Math.cos(a)*51,scale:0.9,height:5.5+i%2});
  for(let i=0;i<36;i++) {
    const a=deg(27)+i*deg(306)/35;
    shrubPoints.push({x:Math.sin(a)*52,y:G,z:Math.cos(a)*52,scale:0.75});
  }
  for(const side of [-1,1]) {
    const a0=side<0?180:60,a1=side<0?300:180;
    for(let i=0;i<16;i++) {
      const a=deg(a0+5+(a1-a0-10)*i/15);
      shrubPoints.push({x:Math.sin(a)*46.5,y:13.3,z:Math.cos(a)*46.5,scale:1.15});
    }
    for(let i=0;i<4;i++) {
      const a=deg(a0+15+(a1-a0-30)*i/3);
      treePoints.push({x:Math.sin(a)*39.5,y:13.3,z:Math.cos(a)*39.5,scale:0.65,height:5.7});
    }
  }
  const flowers=blossomTrees(ctx,treePoints,{seed:73119,name:'network:flora'});
  const greens=shrubs(ctx,shrubPoints,{seed:5031,name:'network:shrubs'});
  if(hi) {
    // 保留花冠位置、轮廓扰动和颜色，只降低单个小花簇表面细分。
    const crown = new THREE.SphereGeometry(1,8,5), pos = crown.attributes.position;
    for(let i=0;i<pos.count;i++) {
      const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i);
      const r=1+.09*Math.sin(x*7+z*3)*Math.cos(y*6)+.045*Math.sin(z*11-y*4);
      pos.setXYZ(i,x*r,y*r,z*r);
    }
    crown.computeVertexNormals(); flowers.geometry.dispose(); flowers.geometry=crown;
  }
  const leafGeos=[],leafColors=[],floraMatrix=new THREE.Matrix4(),floraColor=new THREE.Color();
  for(const source of [flowers,greens])source.traverse(mesh=>{
    if(!mesh.isInstancedMesh)return;
    for(let i=0;i<mesh.count;i++) {
      mesh.getMatrixAt(i,floraMatrix);
      const geo=mesh.geometry.clone().applyMatrix4(floraMatrix);
      if(!mesh.instanceColor){b.add(geo,{},'shellCool');continue;}
      const flat=geo.index?geo.toNonIndexed():geo;
      if(flat!==geo)geo.dispose();
      mesh.getColorAt(i,floraColor);
      const colors=new Float32Array(flat.attributes.position.count*3);
      for(let j=0;j<colors.length;j+=3)floraColor.toArray(colors,j);
      leafGeos.push(flat);leafColors.push(colors);
    }
  });
  const floraGeo=mergePN(leafGeos),floraColors=new Float32Array(floraGeo.attributes.position.count*3);
  let floraOffset=0;for(const colors of leafColors){floraColors.set(colors,floraOffset);floraOffset+=colors.length;}
  floraGeo.setAttribute('color',new THREE.BufferAttribute(floraColors,3));
  const floraMat=flowers.material;floraMat.vertexColors=true;
  const floraMesh=new THREE.Mesh(floraGeo,floraMat);floraMesh.name='network:flora';
  floraMesh.castShadow=true;floraMesh.receiveShadow=true;root.add(floraMesh);
  for(const source of [flowers,greens])source.traverse(mesh=>{
    mesh.geometry?.dispose();if(mesh.material&&mesh.material!==floraMat)mesh.material.dispose();mesh.dispose?.();
  });
  root.userData.flora={source:'src/kit/flora.js',trees:treePoints.length,shrubs:shrubPoints.length};
  for(let i=0;i<52;i++) {
    const a=deg(20)+i*deg(320)/51;
    b.cyl(0.1,0.1,1.5,{x:Math.sin(a)*53,y:0.9,z:Math.cos(a)*53},'shell',6);
  }
  arcTorus(b,53,0.12,deg(20),deg(340),1.65,'shell');
  // 96 位访客用一个实例批次：保留入口 48 人，再加展厅 24 人、广场 24 人。
  const visitorGeo=mergePN([
    new THREE.CapsuleGeometry(0.2,0.65,1,5).translate(0,1.05,0),
    new THREE.SphereGeometry(0.19,6,4).translate(0,1.62,0),
    ...[-1,1].map(side=>new THREE.CylinderGeometry(0.07,0.07,0.6,4).translate(side*0.1,0.3,0)),
    ...[-1,1].map(side=>new THREE.CylinderGeometry(0.055,0.065,0.6,4).rotateZ(side*0.18).translate(side*0.25,1.04,0)),
  ]);
  const visitors=new THREE.InstancedMesh(visitorGeo,mats.ceramic,96);visitors.name='network:visitors';
  visitors.castShadow=visitors.receiveShadow=true;
  const visitorColors=[0xd9e2ed,0x2d5bff,0x4e7697,0x397c94].map(c=>new THREE.Color(c));
  for(let i=0;i<96;i++) {
    const a=deg(-59+(i-24)*4.6),r=43+(i%3)*3.3;
    let x=i<24?-5+(i%3)*6:Math.sin(a)*r,z=i<24?34+Math.floor(i/3)*1.8:Math.cos(a)*r;
    const step=Math.max(0,Math.min(11,Math.floor((47.825-z)/1.65)));
    let floor=Math.abs(x)<8.75&&z<47.825?G+0.26*(step+1):x<0&&a<deg(-21)?0.92:0.24;
    if(i>=48&&i<72) {
      const j=i-48,angle=exhibitStart+deg(4)+j%8*deg(6.2),radius=35.5+Math.floor(j/8)*5.1;
      x=Math.sin(angle)*radius;z=Math.cos(angle)*radius;floor=0.92;
    } else if(i>=72) {
      const j=i-72,angle=deg(16+j%8*3.8),radius=40+Math.floor(j/8)*4.7;
      x=Math.sin(angle)*radius;z=Math.cos(angle)*radius;floor=0.24;
    }
    const scale=0.9+(i%5)*0.05;
    visitors.setMatrixAt(i,kit.toMatrix({x,y:floor,z,ry:i*2.399,sx:scale,sy:scale,sz:scale}));
    visitors.setColorAt(i,visitorColors[i%visitorColors.length]);
  }
  root.add(visitors);
  for(const [x,y,z] of [[-28,12,42],[25,15,44]]) {
    b.cyl(0.65,0.5,0.45,{x,y,z},'ceramic',12);
    for(const dx of [-1.1,1.1])for(const dz of [-1.1,1.1]) {
      beam(b,[x,y,z],[x+dx,y,z+dz],0.075,'shell',5);
      b.torus(0.58,0.055,{x:x+dx,y:y+0.05,z:z+dz},blue,4,hi?20:12);
      b.box(0.85,0.035,0.08,{x:x+dx,y:y+0.08,z:z+dz},pandaBlack);
    }
  }
  // 四面双面钴蓝竖旗，避开入口人流；同批次白杆与蓝旗。
  for(const [x,z,h] of [[-42,30,12],[-35,40,14],[34,40,13],[43,27,11]]) {
    b.cyl(0.075,0.11,h,{x,y:0.24+h/2,z},'ceramic',6);
    b.box(2.4,6.2,0.07,{x:x+1.3,y:h-3.2,z},blue);
    b.box(2.7,0.09,0.09,{x:x+1.25,y:h-0.05,z},'ceramic');
    b.box(0.08,5.5,0.09,{x:x+2.3,y:h-3.2,z:z+0.05},rim);
  }
  root.userData.forecourt={flags:4,people:96,added:48,exhibitionAdded:24,plazaAdded:24,instanced:true,drones:2};

  // ── 熊猫本体高 12m（不含底座）；面向 S02，前移并加宽坐姿轮廓。
  const pandaScaleY=12/(10.75-0.76);
  b.push({x:-16,y:1.6,z:45,ry:Math.atan2(-55-(-16),140-45),sx:1.5,sy:pandaScaleY,sz:1.3});
  b.cyl(5,5.3,0.65,{y:0.325},'ceramic',48);
  b.torus(4.8,0.22,{y:0.72},'glowSoft',5,48);
  const pandaBodyStart=new Map([...b.parts].map(([key,parts])=>[key,parts.length]));
  b.sphere(2.9,{y:3.8,sx:0.95,sy:1.05,sz:0.8},pandaBlack,hi?24:16,hi?14:10);
  b.sphere(2.5,{y:3.9,z:0.75,sy:1.05,sz:0.65},pandaWhite,hi?24:16,hi?14:10);
  b.sphere(3.1,{y:7.5,sx:1.12,sy:0.92,sz:0.85},pandaWhite,hi?32:20,hi?18:12);
  for(const s of [-1,1]) {
    b.sphere(1.05,{x:s*2.5,y:9.7,z:-0.25},pandaBlack,20,12);
    b.sphere(1.05,{x:s*2.6,y:3.7,z:0.3,sx:0.7,sy:1.5,rz:s*0.45},pandaBlack,20,12);
    b.sphere(1.2,{x:s*1.9,y:1.6,z:1.6,sy:0.7,sz:1.2},pandaBlack,20,12);
    b.sphere(1,{x:s*1.35,y:7.45,z:2.23,sx:0.8,sy:1.1,sz:0.23,rz:s*0.3},pandaBlack,24,14);
    b.sphere(0.48,{x:s*1.29,y:7.55,z:2.47,sz:0.3},pandaWhite,16,10);
    b.sphere(0.31,{x:s*1.24,y:7.55,z:2.62,sz:0.3},blue,16,10);
    b.sphere(0.17,{x:s*1.19,y:7.61,z:2.7,sz:0.3},pandaBlack,12,8);
  }
  b.sphere(0.35,{y:6.85,z:2.63,sx:1.25,sy:0.65,sz:0.6},pandaBlack,16,10);
  b.torus(2.15,0.43,{y:5.65,sx:1.1,sz:0.9},blue,8,hi?48:24);
  b.rbox(0.9,2.6,0.32,0.14,{x:1.3,y:4.7,z:2.4,rz:0.24},blue);
  // 从实际生成的本体几何核对尺度，排除发光底座和投影光幕。
  const pandaBodyBounds=new THREE.Box3();
  for(const [key,parts] of b.parts) for(const geo of parts.slice(pandaBodyStart.get(key)||0)) {
    geo.computeBoundingBox();pandaBodyBounds.union(geo.boundingBox);
  }
  root.userData.pandaBody={min:pandaBodyBounds.min.toArray(),max:pandaBodyBounds.max.toArray(),height:pandaBodyBounds.max.y-pandaBodyBounds.min.y};
  // 光只留在底座，移除覆盖身体的加色投影，黑斑不再被青色光幕洗灰。
  b.pop();

  // ───────── 5. 热点 ─────────
  const hot = {
    main: kit.hotspot('network', 96, 126, 96, { y: 63 }),
    discover: kit.hotspot('network:discover', 20, 12, 9, { y: Y0 + 6, z: 21 }),
    skills: kit.hotspot('network:skills', 40, 9, 40, { y: 68 }),
    relations: kit.hotspot('network:relations', 48, 7, 48, { y: 25.5 }),
    graph: kit.hotspot('network:graph', 22, 22, 22, { y: DC }),
  };
  {
    const boxes = [];
    for (const s of [1, -1]) for (let k = 0; k < 3; k++) {
      const a = s * (A0 + (A1 - A0) * (k + 0.5) / 3);
      boxes.push(new THREE.BoxGeometry(2 * 46 * Math.sin((A1 - A0) / 6) + 1.5, 9, 16).applyMatrix4(kit.toMatrix({ x: Math.sin(a) * 44, y: Y1 + 4.5, z: Math.cos(a) * 44, ry: a })));
    }
    hot.cases = new THREE.Mesh(mergePN(boxes), new THREE.MeshBasicMaterial({ visible: false }));
    hot.cases.name = 'hotspot:network:cases'; hot.cases.userData.hotspot = 'network:cases';
  }
  const label = (h, text, anchor) => { h.userData.label = text; h.userData.anchor = anchor; };
  label(hot.main, '智能体连接中心', V3(0, 70, 0));
  label(hot.discover, 'Agent 发现', V3(0, Y0 + 7, 24));
  label(hot.skills, '能力与技能', V3(0, 72.5, 19.5));
  label(hot.relations, '协作关系', V3(0, 29, 23.5));
  label(hot.cases, '应用案例', V3(Math.sin(deg(78)) * 44, Y1 + 5, Math.cos(deg(78)) * 44));
  label(hot.graph, '生态网络图', V3(0, DC + DR + 2, 0));

  root.add(b.build('body'), ...Object.values(hot));

  // ───────── 6. 数据驱动的三层网络 ─────────
  const net = new THREE.Group(); net.name = 'network:graph'; root.add(net);
  const nodeHsGroup = new THREE.Group(); nodeHsGroup.name = 'network:nodeHotspots'; root.add(nodeHsGroup);
  const nodeHotspots = [];
  const basic = new THREE.MeshBasicMaterial({ color: 0xffffff }); basic.name = 'network:basic'; basic.userData.shared = true;
  const podGlass = canopy.clone(); podGlass.name = 'network:pod-glass';
  podGlass.color.set(0xb7efff); podGlass.emissive.set(0x35bbdf);
  podGlass.emissiveIntensity = 0.42; podGlass.opacity = 0.26; podGlass.envMapIntensity = 0.65;
  podGlass.roughness = 0.1; podGlass.metalness = 0.04;
  // 中心保持通透，掠射边强化青色；不新增外壳网格或透明双面绘制。
  podGlass.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `
      #include <emissivemap_fragment>
      float podEdge = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 3.0);
      diffuseColor.a *= mix(0.65, 2.4, podEdge);
      totalEmissiveRadiance += vec3(0.04, 0.7, 1.0) * podEdge * 1.3;
      #ifdef USE_INSTANCING_COLOR
        totalEmissiveRadiance *= vColor;
      #endif
    `);
  };
  podGlass.customProgramCacheKey = () => 'network-pod-glass-r8';
  podGlass.userData.shared = true;
  const podLight = basic.clone(); podLight.name = 'network:pod-light'; podLight.vertexColors = true;
  const podHullMat = pandaWhite.clone(); podHullMat.name = 'network:pod-hull';
  podHullMat.color.set(0xf1f7ff); podHullMat.emissive.set(0xc6e4f5); podHullMat.emissiveIntensity = 0.48;
  podHullMat.userData.shared = true;
  podHullMat.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `
      #include <emissivemap_fragment>
      #ifdef USE_INSTANCING_COLOR
        totalEmissiveRadiance *= vColor;
      #endif
    `);
  };
  podHullMat.customProgramCacheKey = () => 'network-pod-hull-r8';
  const cableMat = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, depthWrite: false }); cableMat.name = 'network:cable'; cableMat.userData.shared = true;
  const sparLight = rim.clone(); sparLight.name = 'glow:network:spar';
  sparLight.emissiveIntensity = rim.emissiveIntensity * 1.3; sparLight.userData.shared = true;
  const C = { cyan: new THREE.Color(0x17c9ff), blue: new THREE.Color(0x2d5bff), white: new THREE.Color(0xe8f6ff) };
  const hdr = (c, k) => c.clone().multiplyScalar(k);
  const CABLE = { aa: hdr(C.cyan, 1.45 * 1.3), hh: hdr(C.cyan, 1.2 * 1.3), ha: hdr(C.cyan, 1.35 * 1.3) };
  const DIM = { r: 0.8, g: 0.9, b: 1.0 }, DIM_A = 0.15;
  const PULSE_HOT = { aa: hdr(C.cyan, 3), hh: hdr(C.blue, 4), ha: hdr(C.white, 2.8) };
  const PULSE = { aa: hdr(C.cyan, 2), hh: hdr(C.cyan, 2), ha: hdr(C.white, 1.8) };
  const dimGlow = 0.1, dimBody = 0.4;

  // 基础几何（烘进朝向，实例矩阵只放位置/朝向/缩放）
  const podHull = (r) => {
    // 封闭碟底：平地板、外展白肩、收尖腹部；玻璃只在腰线以上。
    const parts=[new THREE.LatheGeometry([[0,-r*0.3],[r*0.42,-r*0.3],[r*0.78,-r*0.2],[r,-0.08],[r,0.12],[r*0.91,0.2],[0,0.2]].map(([x,y])=>new THREE.Vector2(x,y)),hi?24:12)];
    for(let i=0;i<7;i++) {
      const a=i*TAU/7;
      parts.push(new THREE.CylinderGeometry(0.035,0.045,r*0.42,3,1,true).translate(Math.sin(a)*r*0.85,0.2+r*0.21,Math.cos(a)*r*0.85));
    }
    return mergePN(parts);
  };
  const gHull=podHull(3.2);
  const dome=r=>new THREE.SphereGeometry(r*0.94,hi?20:16,7,0,TAU,0,Math.PI/2).scale(1,0.68/0.94,1).translate(0,0.2,0);
  const gBand=dome(3.2);
  const podRing=r=>mergePN([
    new THREE.TorusGeometry(r*0.985,0.14,3,hi?24:16).rotateX(Math.PI/2).translate(0,0.13,0),
    new THREE.TorusGeometry(r*0.43,0.055,3,hi?16:12).rotateX(Math.PI/2).translate(0,-r*0.31,0),
    // 原白色内顶环转入发光批次，不增加环几何；背光板位于人形与熊猫之后。
    new THREE.TorusGeometry(r*0.63,0.065,3,hi?24:16).rotateX(Math.PI/2).translate(0,r*0.53+0.18,0),
    new THREE.PlaneGeometry(r*0.9,r*0.5).translate(0,r*0.36,-r*0.22),
    new THREE.PlaneGeometry(r*0.9,r*0.5).rotateY(Math.PI).translate(0,r*0.36,-r*0.22),
  ]);
  const gRing=podRing(3.2);
  // 大面积背光低于细灯环的亮度，避免 bloom 把剪影和玻璃体积一起洗白。
  const lightColors = new Float32Array(gRing.attributes.position.count * 3);
  for(let i=0;i<gRing.attributes.position.count;i++) {
    const backlight = Math.abs(gRing.attributes.position.getZ(i) + 3.2*0.22) < 1e-5;
    const upper = gRing.attributes.position.getY(i) > 1.5;
    lightColors.set(backlight ? [0.3,0.48,0.52] : upper ? [0.25,0.7,0.85] : [0.35,1,1],i*3);
  }
  gRing.setAttribute('color',new THREE.BufferAttribute(lightColors,3));
  gRing.rotateY(-0.38);
  // 人形和圆耳熊猫合成一个深蓝剪影实例批次，置于腰线上方。
  const occupantParts=[new THREE.CapsuleGeometry(0.18,0.5,1,4).translate(-1.05,0.9,0.45),
    new THREE.SphereGeometry(0.22,6,4).translate(-1.05,1.5,0.45),
    new THREE.SphereGeometry(0.4,8,4).scale(1,1.15,0.8).translate(0.85,0.75,0.4),
    new THREE.SphereGeometry(0.43,8,4).scale(1.1,0.9,0.8).translate(0.85,1.3,0.4)];
  for(const side of [-1,1]) {
    occupantParts.push(new THREE.SphereGeometry(0.17,6,4).translate(0.85+side*0.34,1.62,0.4));
    occupantParts.push(new THREE.CapsuleGeometry(0.12,0.22,1,4).rotateZ(side*0.35).translate(0.85+side*0.39,0.7,0.5));
    occupantParts.push(new THREE.CylinderGeometry(0.065,0.075,0.4,4).translate(-1.05+side*0.11,0.42,0.45));
    occupantParts.push(new THREE.CapsuleGeometry(0.07,0.3,1,4).rotateZ(side*0.22).translate(-1.05+side*0.26,0.9,0.45));
  }
  const gOccupants=mergePN(occupantParts);
  const gPulse = new THREE.SphereGeometry(0.15,6,4);
  const gMark = new THREE.TorusGeometry(1, 0.04, 4, 20).rotateX(Math.PI / 2);

  let S = null, hlId = null, mine = new Set(), dyn = [];
  const tmpC = new THREE.Color(), tmpM = new THREE.Matrix4(), pp = V3();

  function disposeDyn() {
    for (const o of dyn) { net.remove(o); o.traverse(m => { m.geometry?.dispose?.(); m.dispose?.(); }); }
    dyn = [];
    for (const h of nodeHotspots) { nodeHsGroup.remove(h); h.geometry.dispose(); h.material.dispose(); }
    nodeHotspots.length = 0;
  }

  function relType(a, c) { return a.kind === 'agent' && c.kind === 'agent' ? 'aa' : a.kind !== 'agent' && c.kind !== 'agent' ? 'hh' : 'ha'; }

  // 大小舱混排：12 个主舱（两档）+其余小舱，每个节点仍有独立拾取体。
  // S02 投影用于舱间软避让与顶部留白；世界空间碰撞与包络仍是硬约束。
  const podProjection = (x,y,z,r) => {
    const depth=(x+62)*0.377+(y-16)*0.219-(z-148)*0.9;
    return {x:(x*0.922+z*0.386)/depth,y:(-x*0.084+(y-52)*0.976+z*0.201)/depth,w:r/depth,h:r*0.58/depth};
  };
  function layout(nodes) {
    const ranked = [...nodes].sort((p,q) => (q.kind==='me')-(p.kind==='me') || q.weight-p.weight || p.id.localeCompare(q.id));
    const large = ranked.slice(0,12), placed = [], unplaced = [];
    for (const [i,n] of ranked.entries()) {
      const big = i < large.length;
      n.rad = big ? (i%3===0 ? 11 : 8.5) : 2.8;
      n.s = n.rad/(n.kind==='agent'?2.65:3.2);
      n.r = (big ? 42 : 49.5)*1.15;
      const tier = big ? Math.floor(i/4) : (i-large.length)%3;
      const targetAngle = big ? [65,155,246,304][i%4]+tier*8 : 30+(i-large.length)*137.508%300;
      const targetY = big ? 36+tier*36 : 30+tier*37;
      let best = null, bestCost = Infinity;
      for(let angle=30;angle<=330;angle+=4) for(let y=30;y<=114;y+=2) {
        const bottom=y-0.3*n.rad,top=y+0.68*n.rad+0.2*n.s;
        const a=deg(angle);
        const r=Math.min(n.r,(57.4-n.rad-0.2)/Math.max(Math.abs(Math.sin(a)),Math.abs(Math.cos(a))));
        if(PLAT.some(p=>bottom<p.y+2.2&&top>p.y-2&&r-n.rad<p.ro+0.8))continue;
        const x=Math.sin(a)*r,z=Math.cos(a)*r;
        if(placed.some(p=>Math.hypot(x-p.pos.x,z-p.pos.z)<n.rad+p.rad+1&&bottom<p.top+1.5&&top>p.bottom-1.5))continue;
        const da=Math.atan2(Math.sin(a-deg(targetAngle)),Math.cos(a-deg(targetAngle)));
        const projected=podProjection(x,y,z,n.rad);
        if(projected.y+projected.h>0.51)continue;
        let crowding=0;
        for(const p of placed) {
          const dx=Math.abs(projected.x-p.projected.x)/(projected.w+p.projected.w+0.012);
          const dy=Math.abs(projected.y-p.projected.y)/(projected.h+p.projected.h+0.018);
          if(dx<1&&dy<1)crowding+=(big&&p.rad>3?10000:3000)*(1-dx)*(1-dy);
        }
        const cost=(da*r)**2+3*(y-targetY)**2+crowding;
        if(cost<bestCost){bestCost=cost;best={a,y,r,bottom,top,projected};}
      }
      if(best)Object.assign(n,best);
      else { n.a=deg(targetAngle);n.y=targetY;n.bottom=n.y-0.3*n.rad;n.top=n.y+0.68*n.rad+0.2*n.s;unplaced.push(n.id); }
      polar(n);n.projected=podProjection(n.pos.x,n.y,n.pos.z,n.rad);placed.push(n);
    }
    root.userData.pods={enlarged:large.map(n=>n.id),largeCount:large.length,radiusTiers:[11,8.5,2.8],domeHeightToDiameter:0.34,unplaced,layout:placed.map(n=>({id:n.id,radius:n.rad,position:n.pos.toArray(),bottom:n.bottom,top:n.top}))};
  }
  function polar(n) { n.pos = V3(Math.sin(n.a)*n.r,n.y,Math.cos(n.a)*n.r); }

  // ── 光纤曲线：按角度直接插值（不穿塔、不过正门扇区），向外鼓出 ──
  const NS = hi ? 24 : 12;
  function relCurve(p, q, type) {
    const pts = new Float32Array((NS + 1) * 3);
    const delta = Math.atan2(Math.sin(q.a-p.a),Math.cos(q.a-p.a));
    const span = Math.abs(delta);
    // 近邻走弦线，远端绕塔的短弧；避免旧版跨 300° 的长圈。
    const chordClear = Math.min(p.r,q.r)*Math.cos(span/2)>25;
    for (let i = 0; i <= NS; i++) {
      const t=i/NS, a=p.a+delta*t, r=p.r+(q.r-p.r)*t;
      pts[i*3]=chordClear ? p.pos.x+(q.pos.x-p.pos.x)*t : Math.sin(a)*r;
      pts[i*3+1]=p.pos.y+(q.pos.y-p.pos.y)*t;
      pts[i*3+2]=chordClear ? p.pos.z+(q.pos.z-p.pos.z)*t : Math.cos(a)*r;
    }
    return pts;
  }

  function buildCables(rels) {
    const RS = 3, nv = (NS + 1) * RS;
    const pos = new Float32Array(rels.length * nv * 3), col = new Float32Array(rels.length * nv * 4), idx = new Uint32Array(rels.length * NS * RS * 6);
    const T = V3(), Nn = V3(), B = V3(), ref = V3(0, 1, 0);
    const fill = () => rels.forEach((rel, ri) => {
      const r = (rel.type === 'ha' ? 0.11 : 0.14) * 0.75 * (rel.thick || 1), pts = rel.pts, base = ri * nv;
      for (let i = 0; i <= NS; i++) {
        const i0 = Math.max(0, i - 1), i1 = Math.min(NS, i + 1);
        T.set(pts[i1 * 3] - pts[i0 * 3], pts[i1 * 3 + 1] - pts[i0 * 3 + 1], pts[i1 * 3 + 2] - pts[i0 * 3 + 2]).normalize();
        Nn.crossVectors(T, Math.abs(T.y) > 0.95 ? V3(1, 0, 0) : ref).normalize(); B.crossVectors(T, Nn);
        for (let k = 0; k < RS; k++) {
          const th = k / RS * TAU, c = Math.cos(th) * r, s = Math.sin(th) * r, v = (base + i * RS + k) * 3;
          pos[v] = pts[i * 3] + Nn.x * c + B.x * s; pos[v + 1] = pts[i * 3 + 1] + Nn.y * c + B.y * s; pos[v + 2] = pts[i * 3 + 2] + Nn.z * c + B.z * s;
        }
      }
    });
    fill();
    rels.forEach((rel, ri) => {
      const base = ri * nv; rel.vs = base; rel.vc = nv;
      let o = (ri * NS * RS) * 6;
      for (let i = 0; i < NS; i++) for (let k = 0; k < RS; k++) {
        const a = base + i * RS + k, bq = base + i * RS + (k + 1) % RS, c = a + RS, d = bq + RS;
        idx[o++] = a; idx[o++] = bq; idx[o++] = c; idx[o++] = bq; idx[o++] = d; idx[o++] = c;
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 4));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    g.userData.refill = () => { fill(); g.attributes.position.needsUpdate = true; };
    return g;
  }

  const sparPlat = (y) => PLAT.reduce((best, P) => (Math.abs(P.y - y) < Math.abs(best.y - y) ? P : best), PLAT[0]);

  function setGraph(graph) {
    disposeDyn();
    // 规范化
    const byId = new Map(), nodes = [];
    for (const n of graph?.nodes || []) {
      if (!n || n.id == null || byId.has(String(n.id))) continue;
      const kind = n.kind === 'agent' ? 'agent' : n.kind === 'me' ? 'me' : 'human';
      const nn = { id: String(n.id), name: n.name ?? String(n.id), kind, weight: Math.min(3, Math.max(1, Math.round(n.weight || 1))), nbr: new Set(), rels: [] };
      byId.set(nn.id, nn); nodes.push(nn);
    }
    const rels = [], seen = new Set();
    for (const r of graph?.relations || []) {
      const p = byId.get(String(r?.from)), q = byId.get(String(r?.to));
      if (!p || !q || p === q) continue;
      const key = p.id < q.id ? p.id + '|' + q.id : q.id + '|' + p.id;
      if (seen.has(key)) continue; seen.add(key);
      p.nbr.add(q.id); q.nbr.add(p.id);
      const rel = { from: p, to: q, type: relType(p, q) }; rels.push(rel); p.rels.push(rel); q.rels.push(rel);
    }
    layout(nodes);
    nodes.forEach(n => polar(n));
    // 光纤
    rels.forEach((rel, i) => {
      rel.pts = relCurve(rel.from, rel.to, rel.type);
      let len = 0; for (let k = 1; k <= NS; k++) len += Math.hypot(rel.pts[k * 3] - rel.pts[k * 3 - 3], rel.pts[k * 3 + 1] - rel.pts[k * 3 - 2], rel.pts[k * 3 + 2] - rel.pts[k * 3 - 1]);
      rel.alpha = Math.max(0.72, 1 - Math.abs(Math.atan2(Math.sin(rel.to.a-rel.from.a),Math.cos(rel.to.a-rel.from.a)))/Math.PI);
      rel.phase = (i * 0.381966) % 1; rel.speed = (rel.type === 'ha' ? 4.2 : 5.5) / Math.max(8, len); rel.vis = true;
    });
    S = { nodes, byId, rels };

    // 光纤网格（三种光纤一个网格，颜色在顶点里）
    if (rels.length) {
      const cm = new THREE.Mesh(buildCables(rels), cableMat); cm.name = 'network:cables'; cm.castShadow = cm.receiveShadow = false;
      net.add(cm); dyn.push(cm); S.cables = cm;
      const pm = new THREE.InstancedMesh(gPulse, basic, rels.length); pm.name = 'network:pulses'; pm.frustumCulled = false; pm.castShadow = false;
      rels.forEach((r, i) => pm.setColorAt(i, PULSE[r.type]));
      net.add(pm); dyn.push(pm); S.pulses = pm;
    }
    // 节点实例
    const mk = (geo, mat, n, name, shadow = true) => { const m = new THREE.InstancedMesh(geo, mat, n); m.name = name; m.castShadow = shadow; m.receiveShadow = shadow; m.frustumCulled = false; net.add(m); dyn.push(m); return m; };
    // 人与 Agent 共享标准舱几何，尺寸仍由节点半径控制；三个批次替代六个批次。
    // 冷白底光随实例高亮一起压暗，不增加批次或场景灯。
    S.hull=mk(gHull,podHullMat,nodes.length,'network:pods:hull');
    S.ring=mk(gRing,podLight,nodes.length,'network:pods:ring',false);
    S.band=mk(gBand,podGlass,nodes.length,'network:pods:band',false);
    nodes.forEach((n,i)=>{
      n.slot=i;const scale=n.rad/3.2;
      const m=kit.toMatrix({x:n.pos.x,y:n.pos.y,z:n.pos.z,sx:scale,sy:scale,sz:scale});
      S.hull.setMatrixAt(i,m);S.band.setMatrixAt(i,m);
      S.ring.setMatrixAt(i,kit.toMatrix({x:n.pos.x,y:n.pos.y,z:n.pos.z,sx:scale,sy:scale,sz:scale}));
    });
    S.occupants=mk(gOccupants,basic,nodes.length,'network:occupants',false);
    nodes.forEach((n,i)=>{n.occupantSlot=i;S.occupants.setMatrixAt(i,kit.toMatrix({x:n.pos.x,y:n.pos.y,z:n.pos.z,ry:-0.38,sx:n.s,sy:n.s,sz:n.s}));});
    S.occupants.instanceMatrix.needsUpdate=true;
    S.marks = mk(gMark, basic, nodes.length + 1, 'network:marks', false); S.marks.count = 0;

    // 每个舱到最近的塔盘一条光纤；既有中点球保留舱侧接点并缩小，不新增球面。
    const sb = new kit.Builder(mats);
    for (const n of nodes) {
      const P = sparPlat(n.y), dir = V3(Math.sin(n.a), 0, Math.cos(n.a));
      const edge = n.rad * 1.02;
      const a = [dir.x * (P.ro - 0.9), P.y - 0.7, dir.z * (P.ro - 0.9)], c = [n.pos.x - dir.x * edge, n.pos.y - (n.kind === 'agent' ? 0.3 : 0.2), n.pos.z - dir.z * edge];
      beam(sb, a, c, 0.09, sparLight, 5);
      sb.sphere(0.23, {x:c[0],y:c[1],z:c[2]},sparLight,8,6);
    }
    const sparGroup = sb.build('network:spars'); net.add(sparGroup); dyn.push(sparGroup);

    // 热点
    for (const n of nodes) {
      const id = n.kind === 'me' ? 'network:me' : `network:${n.kind}:${n.id}`;
      const sz = n.rad*2+0.4;
      const h = kit.hotspot(id, sz, n.rad*0.98+0.2*n.s+0.4, sz, { x: n.pos.x, y: n.pos.y+n.rad*0.19+0.1*n.s, z: n.pos.z });
      h.userData.label = n.name; h.userData.anchor = n.pos.clone(); h.userData.nodeId = n.id; h.userData.kind = n.kind;
      nodeHsGroup.add(h); nodeHotspots.push(h);
    }
    if (hlId && !byId.has(hlId)) hlId = null;
    applyLook();
    return nodeHotspots.slice();
  }

  // 暗/亮：高亮节点 + 其邻居 + 关联光纤；其余压暗。markMine 的节点与「我」带白环。
  function applyLook() {
    if (!S) return;
    const near = new Set();
    if (hlId) { near.add(hlId); S.byId.get(hlId).nbr.forEach(i => near.add(i)); }
    const on = (n) => !hlId || near.has(n.id);
    const ringColor = (n) => hdr(C.cyan, 3.78 * (on(n) ? (hlId === n.id ? 1.5 : 1) : dimGlow));
    for(const n of S.nodes) {
      const o=on(n);
      S.hull.setColorAt(n.slot,tmpC.setScalar(o?(n.kind==='human'?0.88:1):dimBody));
      S.ring.setColorAt(n.slot,ringColor(n));S.band.setColorAt(n.slot,tmpC.setScalar(o?1:dimBody));
    }
    for(const m of [S.hull,S.ring,S.band]) if(m.instanceColor)m.instanceColor.needsUpdate=true;
    for(const n of S.nodes) S.occupants.setColorAt(n.occupantSlot,hdr(C.blue,on(n)?0.16:0.06));
    if(S.occupants.instanceColor)S.occupants.instanceColor.needsUpdate=true;
    if (S.cables) {
      const col = S.cables.geometry.attributes.color, arr = col.array;
      let thickChanged = false;
      for (const rel of S.rels) {
        const inc = !hlId || rel.from.id === hlId || rel.to.id === hlId, hot = !!hlId && inc;
        const k = hot ? 1.8 : 1, c = CABLE[rel.type], dim = !!hlId && !inc;
        const rr = dim ? DIM.r : c.r * k, gg = dim ? DIM.g : c.g * k, bb = dim ? DIM.b : c.b * k, aa = dim ? DIM_A : hot ? 1 : rel.alpha;
        rel.vis = inc; rel.hot = hot;
        const th = hot ? 1.6 : 1; if ((rel.thick || 1) !== th) { rel.thick = th; thickChanged = true; }
        for (let v = rel.vs; v < rel.vs + rel.vc; v++) { arr[v * 4] = rr; arr[v * 4 + 1] = gg; arr[v * 4 + 2] = bb; arr[v * 4 + 3] = aa; }
      }
      if (thickChanged) S.cables.geometry.userData.refill();
      col.needsUpdate = true;
    }
    // 白环：我连接的 Agent / 我关注的人，加上「我」自己
    const ring = S.nodes.filter(n => n.kind === 'me' || mine.has(n.id));
    ring.forEach((n, i) => {
      const R = n.rad * 1.08;
      S.marks.setMatrixAt(i, kit.toMatrix({ x: n.pos.x, y: n.pos.y, z: n.pos.z, sx: R, sy: R, sz: R }));
      S.marks.setColorAt(i, hdr(C.white, on(n) ? 1.3 : 0.2));
    });
    S.haloNode = hlId ? S.byId.get(hlId) : null; S.haloIdx = ring.length;
    S.marks.count = ring.length + (S.haloNode ? 1 : 0); S.marks.instanceMatrix.needsUpdate = true; if (S.marks.instanceColor) S.marks.instanceColor.needsUpdate = true;
    for(const m of [S.hull,S.ring,S.band])m.instanceMatrix.needsUpdate=true;
    updatePulses();
  }

  function updatePulses(dt=0) {
    if(!S?.pulses)return;
    const pm=S.pulses;let slot=0;
    for(let i=0;i<S.rels.length;i++) {
      const rel=S.rels[i];
      if(rel.u==null)rel.u=rel.phase;
      if(!reducedMotion)rel.u=(rel.u+dt*rel.speed*(rel.hot?0.7:1))%1;
      if(!rel.vis||(!rel.hot&&i%4!==0))continue;
      const u=reducedMotion?0.5:rel.u,f=u*NS,k=Math.min(NS-1,Math.floor(f)),w=f-k,p=rel.pts;
      pp.set(p[k*3]+(p[k*3+3]-p[k*3])*w,p[k*3+1]+(p[k*3+4]-p[k*3+1])*w,p[k*3+2]+(p[k*3+5]-p[k*3+2])*w);
      const scale=rel.hot?1.8:1;
      pm.setMatrixAt(slot,tmpM.makeScale(scale,scale,scale).setPosition(pp));
      pm.setColorAt(slot,rel.hot?PULSE_HOT[rel.type]:PULSE[rel.type]);slot++;
    }
    pm.count=slot;pm.instanceMatrix.needsUpdate=true;
    if(pm.instanceColor)pm.instanceColor.needsUpdate=true;
  }

  function highlight(id) { hlId = id != null && S?.byId.has(String(id)) ? String(id) : null; applyLook(); }
  function markMine(ids) { mine = new Set((ids || []).map(String)); applyLook(); }

  setGraph({ nodes: PLACEHOLDER.nodes, relations: PLACEHOLDER.relations });

  const bounds = new THREE.Box3().setFromObject(root);
  const api = {
    group: root,
    hotspots: Object.values(hot),
    nodeHotspots,
    setGraph, highlight, markMine,
    bounds,
    update(t, dt = 0) {
      if (!reducedMotion) { gyroMesh.rotation.y = t * 0.18; gyroMesh.rotation.x = Math.sin(t * 0.11) * 0.25; }
      if (S?.haloNode) {
        const n = S.haloNode, k = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(t * 2.4), R = n.rad * 1.8 * (0.9 + 0.2 * k);
        S.marks.setMatrixAt(S.haloIdx, kit.toMatrix({ x: n.pos.x, y: n.pos.y, z: n.pos.z, rx: 1.15, ry: n.a, sx: R, sy: R, sz: R }));
        S.marks.setColorAt(S.haloIdx, hdr(n.kind === 'agent' ? C.cyan : C.blue, (n.kind === 'agent' ? 2.5 : 3) * (0.85 + 0.3 * k)));
        S.marks.instanceMatrix.needsUpdate = true; if (S.marks.instanceColor) S.marks.instanceColor.needsUpdate = true;
      }
      updatePulses(dt);
    },
    dispose() {
      disposeDyn();
      kit.disposeTree(root);
      [gHull,gRing,gBand,gOccupants,gPulse,gMark].forEach(g => g.dispose());
      basic.dispose(); cableMat.dispose(); sparLight.dispose(); canopy.dispose(); podGlass.dispose(); podLight.dispose(); podHullMat.dispose();
    },
  };
  api.update(0, 0);
  return api;
}
