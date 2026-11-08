// 云海：起伏云面、20–60m 实例云冠与柔边云团，近岛云腹遮住岩尖。
import * as THREE from 'three';
import { clamp, lerp } from './util.js';
import { PLACES } from '../kit/world.js';
import { SUN_DIR } from './sky.js';
import { islandRadiusAt, rootRadius } from './islands.js';

const LAYER_VERT = /* glsl */`
varying vec3 vW;
uniform sampler2D tNoise; uniform float uTime; uniform float uScale; uniform float uRelief; uniform vec2 uDrift;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  vec2 field=(wp.xz+uDrift*uTime)*uScale;
  float swell=texture2D(tNoise,field*.6).r*.7+texture2D(tNoise,field*1.7).g*.3;
  wp.y+=(swell-.40)*uRelief; vW = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const LAYER_FRAG = /* glsl */`
varying vec3 vW;
uniform sampler2D tNoise; uniform float uTime; uniform vec2 uSun; uniform float uCamY; uniform float uY;
uniform vec4 uIslands[5];
uniform vec3 uLit; uniform vec3 uShade; uniform float uAlpha; uniform float uScale; uniform float uCover; uniform float uSoft; uniform vec2 uDrift; uniform float uContrast;
#include <fog_pars_fragment>
void main() {
  vec2 q = ( vW.xz + uDrift * uTime ) * uScale;
  float n1 = texture2D( tNoise, q * 0.22 ).r;
  float n2 = texture2D( tNoise, q + n1 * 0.12 ).g;
  float n3 = texture2D( tNoise, q * 3.3 + n1 * 0.2 ).b;
  float n = n1 * 0.5 + n2 * 0.33 + ( n3 - 0.5 ) * 0.085 + 0.085;
  float cov = smoothstep( uCover - uSoft, uCover + uSoft, n );
  // 假体积光：朝太阳方向偏移采样，两次高度差给出明暗。
  vec2 so = uSun * 0.011;
  float n2s = texture2D( tNoise, q + so + n1 * 0.12 ).g;
  float lit = clamp( 0.5 + ( n2 - n2s ) * uContrast + ( n - 0.5 ) * 0.9, 0.0, 1.0 );
  vec3 col = mix( uShade, uLit, pow( lit, .72 ) );
  float fadeNear = smoothstep( 2.0, 14.0, abs( uCamY - uY ) );
  float opening = 1.0;
  for (int i = 0; i < 5; i++) {
    float distanceToRoot = length(vW.xz - uIslands[i].xy);
    float r = uIslands[i].z * .88;
    opening *= smoothstep(r * .35, r + 55.0, distanceToRoot);
  }
  float horizonFade=1.0-smoothstep(1100.0,3100.0,length(vW.xz-cameraPosition.xz));
  float a = uAlpha * cov * fadeNear * opening * horizonFade;
  if ( a < 0.003 ) discard;
  gl_FragColor = vec4( col, a );
  #include <fog_fragment>
}`;

const PUFF_VERT = /* glsl */`
varying vec2 vUv; varying vec3 vP;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  #ifdef USE_INSTANCING_COLOR
    vP = instanceColor;
  #else
    vP = vec3( 0.5, 0.5, 1.0 );
  #endif
  vec3 ctr = ( instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
  vec2 size = vec2(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz));
  vec4 mvPosition = modelViewMatrix * vec4( ctr, 1.0 );
  mvPosition.xy += position.xy * size;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const PUFF_FRAG = /* glsl */`
varying vec2 vUv; varying vec3 vP;
uniform sampler2D tPuff; uniform vec3 uSunV; uniform vec3 uLit; uniform vec3 uShade;
#include <fog_pars_fragment>
void main() {
  float angle=vP.y*6.2831853;
  vec2 uv=mat2(cos(angle),-sin(angle),sin(angle),cos(angle))*(vUv-.5)+.5;
  vec4 t = texture2D( tPuff, uv );
  vec2 p = vUv * 2.0 - 1.0;
  float rr = min( dot( p, p ), 1.0 );
  vec3 n = normalize( vec3( p, sqrt( 1.0 - rr ) + 0.15 ) );
  float diff = clamp( dot( n, uSunV ) * 0.9 + 0.2 + ( vP.x - 0.5 ) * 0.75 + ( vUv.y - 0.5 ) * 0.7, 0.0, 1.0 );
  diff = max(0.0,diff-(1.0-smoothstep(.10,.48,vUv.y))*.30);
  diff = smoothstep(.06,.86,diff);
  diff = max(diff,smoothstep(.48,.9,vUv.y)*.78);
  diff *= mix(.3,1.0,smoothstep(.04,.74,vUv.y));
  vec3 shadow=mix(uShade,vec3(.34,.26,.61),smoothstep(.2,.8,vP.y)*.42);
  vec3 col = mix( shadow, uLit, pow(diff,1.7) );
  float border=smoothstep(0.0,.12,vUv.x)*smoothstep(0.0,.12,vUv.y)*(1.0-smoothstep(.88,1.0,vUv.x))*(1.0-smoothstep(.88,1.0,vUv.y));
  float a = t.a * vP.z * border;
  if ( a < 0.01 ) discard;
  gl_FragColor = vec4( col, a );
  #include <fog_fragment>
}`;

function fogUniforms(extra) { return THREE.UniformsUtils.merge([THREE.UniformsLib.fog, extra]); }
const rgb = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace);

// 用云片半对角线包围球保护整团云；根部云也必须经过此门。
export function cloudClearance(p, views = []) {
  const radius = .5 * Math.hypot(p.size, p.size * (p.aspect ?? 1));
  for (const place of Object.values(PLACES)) {
    const [x,y,z] = place.position;
    if (p.y + radius >= y && p.y - radius <= y + 200 && Math.hypot(p.x-x,p.z-z) < 150 + radius) return false;
  }
  const center = new THREE.Vector3(p.x,p.y,p.z), closest = new THREE.Vector3();
  for (const view of views) {
    new THREE.Line3(view.start,view.end).closestPointToPoint(center,true,closest);
    if (closest.distanceTo(center) < radius + (view.id === 'S01' || view.id === 'S06' ? 65 : 28)) return false;
    const local=center.clone().applyMatrix4(view.camera.matrixWorldInverse);
    if(local.z < -radius){
      const ndc=center.clone().project(view.camera),ry=radius/(-local.z-radius)/Math.tan(THREE.MathUtils.degToRad(view.camera.fov/2)),rx=ry/view.camera.aspect;
      if(view.silhouettes.some(rect=>ndc.x+rx>rect.left&&ndc.x-rx<rect.right&&ndc.y+ry>rect.bottom&&ndc.y-ry<rect.top))return false;
    }
  }
  return true;
}

export function createClouds(ctx, { noise, puffTex, islands, bridgePts, hi, views = [] }) {
  const { kit, reducedMotion } = ctx;
  const group = new THREE.Group(); group.name = 'env:clouds';
  const rnd = kit.rng(20261102);

  // ── 云面分层：顶层亮白，深层为钴蓝与淡紫，最底层几乎不透明。
  const L = [
    { y: -83, a: 0.74, s: 1 / 1100, cover: 0.50, soft: 0.07, lit: [2.1, 2.18, 2.3], shade: [0.055, 0.16, 0.62], drift: [2.0, 0.7], c: 13 },
    { y: -100, a: 0.82, s: 1 / 900, cover: 0.50, soft: 0.08, lit: [1.6, 1.74, 2.0], shade: [0.035, 0.11, 0.44], drift: [1.6, 0.5], c: 11 },
    { y: -72, a: 0.88, s: 1 / 980, cover: 0.49, soft: 0.08, lit: [0.62, 0.74, 0.98], shade: [0.10, 0.17, 0.40], drift: [1.3, 0.8], c: 9 },
    { y: -82, a: 0.88, s: 1 / 1250, cover: 0.47, soft: 0.09, lit: [0.46, 0.58, 0.84], shade: [0.07, 0.13, 0.33], drift: [1.0, 0.4], c: 8 },
    { y: -94, a: 0.90, s: 1 / 1400, cover: 0.44, soft: 0.10, lit: [0.34, 0.45, 0.74], shade: [0.05, 0.10, 0.28], drift: [0.8, 0.6], c: 6 },
    { y: -108, a: 0.94, s: 1 / 1700, cover: 0.38, soft: 0.12, lit: [0.26, 0.36, 0.64], shade: [0.04, 0.08, 0.24], drift: [0.6, 0.3], c: 5 },
    { y: -124, a: 0.98, s: 1 / 2100, cover: 0.25, soft: 0.16, lit: [0.20, 0.29, 0.55], shade: [0.03, 0.06, 0.20], drift: [0.4, 0.2], c: 4 },
    { y: -138, a: 1.0, s: 1 / 2600, cover: -0.4, soft: 0.2, lit: [0.16, 0.24, 0.48], shade: [0.02, 0.05, 0.17], drift: [0.3, 0.1], c: 3 },
  ];
  const layers = hi ? L : [L[0], L[2], L[4], L[7]];

  const planes = layers.map((l, i) => {
    const segments=i===0?(hi?56:32):i===1?(hi?28:14):1;
    const planeGeo=new THREE.PlaneGeometry(13000,13000,segments,segments).rotateX(-Math.PI/2);
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
      uniforms: fogUniforms({
        uIslands: { value: islands.map(isl => new THREE.Vector4(isl.cx, isl.cz, isl.R, isl.yT)) },
        tNoise: { value: noise }, uTime: { value: 0 }, uSun: { value: new THREE.Vector2(SUN_DIR.x, SUN_DIR.z).normalize() }, uCamY: { value: 400 }, uY: { value: l.y },
        uRelief: {value:i===0?110:i===1?55:0}, uLit: { value: rgb(...l.lit) }, uShade: { value: rgb(...l.shade) }, uAlpha: { value: l.a }, uScale: { value: l.s }, uCover: { value: l.cover }, uSoft: { value: l.soft },
        uDrift: { value: new THREE.Vector2(...l.drift) }, uContrast: { value: l.c },
      }),
      vertexShader: LAYER_VERT, fragmentShader: LAYER_FRAG,
    });
    const mesh = new THREE.Mesh(planeGeo, m);
    mesh.name = `env:cloud-layer-${i}`; mesh.position.y = l.y; mesh.frustumCulled = false;
    mesh.renderOrder = -30 + (layers.length - i);
    mesh.castShadow = mesh.receiveShadow = false;
    group.add(mesh);
    return mesh;
  });

  // 近岛实体积云冠：共享球面实例，真实深度遮挡岩尖；细软云片包裹轮廓。
  const crowns=[],crownRnd=kit.rng(82941);
  for(const isl of islands)for(let j=0;j<8;j++){
    const a=j/8*Math.PI*2+.2, radius=isl.R*.75;
    const height=20+crownRnd()*40;
    crowns.push({x:isl.cx+Math.cos(a)*radius,y:-85+height*.5,z:isl.cz+Math.sin(a)*radius,sx:35+crownRnd()*25,sy:height*.5,sz:32+crownRnd()*22});
  }
  for(let j=0;j<56;j++){
    const a=j*2.399,r=450+Math.sqrt(j/56)*1900,height=20+crownRnd()*40;
    crowns.push({x:Math.cos(a)*r,y:-100+height*.5,z:Math.sin(a)*r,sx:85+crownRnd()*90,sy:height*.5,sz:65+crownRnd()*65});
  }
  const crownMat=new THREE.ShaderMaterial({name:'env:cloud-crowns',fog:true,
    uniforms:fogUniforms({tNoise:{value:noise},uSun:{value:SUN_DIR.clone()},uTime:{value:0}}),
    vertexShader:`varying vec3 vN; varying vec3 vW; uniform float uTime;
      #include <fog_pars_vertex>
      void main(){
        vec3 p=position; float lobe=1.+.09*sin(p.x*8.+p.z*5.)*sin(p.y*6.-p.z*4.);
        p*=lobe; p.y+=.035*sin(uTime*.09+instanceMatrix[3].x*.02);
        vec4 wp=modelMatrix*instanceMatrix*vec4(p,1.); vW=wp.xyz;
        vec3 scale2=vec3(dot(instanceMatrix[0].xyz,instanceMatrix[0].xyz),dot(instanceMatrix[1].xyz,instanceMatrix[1].xyz),dot(instanceMatrix[2].xyz,instanceMatrix[2].xyz));
        vN=normalize(mat3(modelMatrix*instanceMatrix)*(normal/scale2));
        vec4 mvPosition=viewMatrix*wp; gl_Position=projectionMatrix*mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader:`varying vec3 vN; varying vec3 vW; uniform sampler2D tNoise; uniform vec3 uSun;
      #include <fog_pars_fragment>
      void main(){
        float grain=texture2D(tNoise,vW.xz*.006+vW.y*.003).g;
        float light=smoothstep(-.3,.85,dot(normalize(vN),uSun)+(grain-.5)*.3);
        vec3 shade=mix(vec3(.09,.16,.50),vec3(.30,.24,.57),grain);
        gl_FragColor=vec4(mix(shade,vec3(1.45,1.58,1.80),light),1.);
        #include <fog_fragment>
      }`
  });
  const crownGeo=new THREE.SphereGeometry(1,8,hi?6:4);
  const crownMesh=kit.instanced(crownGeo,crownMat,crowns.map(p=>kit.toMatrix(p)),'env:cloud-crowns');
  crownMesh.castShadow=crownMesh.receiveShadow=false;crownMesh.frustumCulled=false;group.add(crownMesh);
  group.userData.crownHeightRange=[20,60];group.userData.crowns=crowns.length;

  // ── 云团精灵
  const puffs = [];
  const ok = (x, y, z, size) => {
    // 总部正门方向走廊：不许有高出云海的云团。
    if (Math.abs(x) < 170 && z > -40 && z < 340 && y + size * 0.5 > -50) return false;
    for (const isl of islands) {
      const d = Math.hypot(x - isl.cx, z - isl.cz), r = islandRadiusAt(isl, y);
      if (y > isl.yT - 140 && d < r + size * 0.55 + 6) return false;
    }
    for (const p of bridgePts) {
      const dx = p.x - x, dy = p.y - y, dz = p.z - z;
      if (dx * dx + dy * dy + dz * dz < (size * 0.6 + 24) ** 2) return false;
    }
    return true;
  };
  const push = (x, y, z, size, tint, op, shape=.5, aspect=1) => {
    const p = {x,y,z,size,tint,op,shape,aspect};
    if (cloudClearance(p, views) && ok(x,y,z,size)) puffs.push(p);
  };

  // 海面积云：铺满中近景，顶部略高于云面。
  const nSea = hi ? 780 : 340;
  for (let i = 0; i < nSea; i++) {
    const a = rnd() * Math.PI * 2, r = 120 + Math.pow(rnd(), 0.8) * 2900;
    const size = lerp(65, 155, rnd()) * (1 + r / 6500);
    // 云顶 -75…-15m，云腹下沉；低云不套用建筑上半部的整球保护区。
    const aspect=.55+rnd()*.25, top=-75+rnd()*60;
    const p={x:Math.cos(a)*r,y:top-size*aspect*.5,z:Math.sin(a)*r,size,aspect,tint:.40+rnd()*.3,op:.85,shape:rnd()};
    if(islands.every(isl=>Math.hypot(p.x-isl.cx,p.z-isl.cz)>rootRadius(isl,a,clamp((isl.yT-p.y)/isl.depth))+size*.18))puffs.push(p);
  }
  // 岩根包裹云：允许少量云瓣与岩面交叠，三层错位掩去平面云层交界。
  const rootRnd=kit.rng(6109);
  for(const isl of islands)for(const [level,y] of [-65,-90,-120].entries()){
    const n=hi?12:7;
    for(let i=0;i<n;i++){
      const a=(i+.35*level)/n*Math.PI*2,yy=y+(rootRnd()-.5)*12,size=42+rootRnd()*30;
      const r=rootRadius(isl,a,clamp((isl.yT-2-yy)/isl.depth))+size*.28;
      const p={x:isl.cx+Math.cos(a)*r,y:yy,z:isl.cz+Math.sin(a)*r,size,tint:.65+rootRnd()*.25,op:.88,shape:rootRnd(),aspect:.65+rootRnd()*.25};
      if(p.y+p.size*p.aspect*.5<isl.yT-20)puffs.push(p);
    }
  }
  // 高耸积云：岛间与远处，花椰菜状。
  const towers = [
    [-150, -150, 60, 85], [150, -170, 40, 80], [-420, -120, 80, 100], [440, -110, 50, 95], [-330, -640, 120, 110],
    [-640, 220, 70, 100], [660, 240, 90, 105], [-560, -520, 120, 100], [560, -560, 90, 100], [0, 620, 50, 90],
    [-980, -180, 150, 130], [980, -260, 130, 120], [-620, -860, 150, 120], [620, -940, 120, 120],
  ];
  for (const [tx, tz, top, rad] of towers) {
    const n = hi ? 40 : 14, H = top + 55;
    for (let i = 0; i < n; i++) {
      const hh = Math.pow(rnd(), 1.25) * H, k = hh / H, rr = rad * (1 - 0.55 * k) * Math.sqrt(rnd()), a = rnd() * Math.PI * 2;
      const size = lerp(85, 42, k) * (0.75 + rnd() * 0.6) * (rad / 90);
      push(tx + Math.cos(a) * rr, -58 + hh, tz + Math.sin(a) * rr, size, 0.3 + k * 0.7, 0.63 + rnd() * 0.2);
    }
    // 顶冠
    for (let i = 0; i < (hi ? 8 : 3); i++) {
      const a = rnd() * Math.PI * 2, rr = rad * 0.3 * Math.sqrt(rnd());
      push(tx + Math.cos(a) * rr, -58 + H * (0.85 + rnd() * 0.2), tz + Math.sin(a) * rr, 56 + rnd() * 30, 0.9 + rnd() * 0.1, 0.9);
    }
  }

  // 32 团天空积云：每团独立种子、不同瓣数/纵横比/偏移，近大远小。
  const skyClusters=[];
  for(let i=0;i<32;i++){
    const cloudRnd=kit.rng(80513+i*7919),a=i/32*Math.PI*2+.06*(cloudRnd()-.5),layer=i%3;
    const distance=1100+layer*650+cloudRnd()*350;
    const x=Math.cos(a)*distance,z=Math.sin(a)*distance,y=310+layer*115+cloudRnd()*170;
    const width=150+cloudRnd()*150,height=65+cloudRnd()*100,lobes=hi?10+Math.floor(cloudRnd()*9):6+Math.floor(cloudRnd()*5);
    skyClusters.push({x,y,z,width,height,lobes,seed:80513+i*7919});
    for(let j=0;j<lobes;j++){
      const t=(j/(lobes-1)-.5),lift=Math.pow(Math.max(0,1-t*t*4),.7);
      const px=x+t*width,pz=z+(cloudRnd()-.5)*width*.35,py=y+lift*height*.5+(cloudRnd()-.5)*height*.25;
      const size=(45+cloudRnd()*65)*(1+lift*.45);
      push(px,py,pz,size,.55+lift*.35,.76+cloudRnd()*.15,cloudRnd(),.65+cloudRnd()*.6);
    }
  }
  // 低积云带围绕地平线，轮廓不连成平直白墙。
  const horizonRnd=kit.rng(618);
  for(let i=0;i<68;i++){
    const a=i/68*Math.PI*2,r=2900+horizonRnd()*500;
    for(let j=0;j<(hi?3:2);j++)push(Math.cos(a)*r+j*45,35+horizonRnd()*65,Math.sin(a)*r,150+horizonRnd()*150,.65,.78,horizonRnd(),.45+horizonRnd()*.3);
  }
  group.userData.skyClusters=skyClusters;
  group.userData.rootCloudLayers=3;
  group.userData.seaCrownRange=[-75,-15];
  group.userData.puffs=puffs;
  group.userData.protectedViews=views.map(v=>v.id);
  const count = puffs.length;
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: fogUniforms({ tPuff: { value: puffTex }, uSunV: { value: new THREE.Vector3(0, 0, 1) }, uLit: { value: rgb(2.05, 2.12, 2.22) }, uShade: { value: rgb(0.10, 0.16, 0.57) } }),
    vertexShader: PUFF_VERT, fragmentShader: PUFF_FRAG,
  });
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, Math.max(1, count));
  mesh.name = 'env:puffs'; mesh.frustumCulled = false; mesh.renderOrder = -15; mesh.castShadow = mesh.receiveShadow = false;
  mesh.count = count;
  const col = new THREE.Color();
  for (let i = 0; i < count; i++) mesh.setColorAt(i, col.setRGB(0.5, 0.5, 1, THREE.LinearSRGBColorSpace));
  group.add(mesh);

  const m4 = new THREE.Matrix4(), pos = new THREE.Vector3(), sc = new THREE.Vector3(), qi = new THREE.Quaternion();
  const dist = new Float32Array(count), order = Array.from({ length: count }, (_, i) => i);
  const lastCam = new THREE.Vector3(1e9, 0, 0);
  function resort(cam) {
    for (let i = 0; i < count; i++) { const p = puffs[i]; dist[i] = (p.x - cam.x) ** 2 + (p.y - cam.y) ** 2 + (p.z - cam.z) ** 2; }
    order.sort((a, b) => dist[b] - dist[a]);
    for (let r = 0; r < count; r++) {
      const p = puffs[order[r]];
      m4.compose(pos.set(p.x, p.y, p.z), qi, sc.set(p.size, p.size*(p.aspect??1), p.size));
      mesh.setMatrixAt(r, m4);
      mesh.setColorAt(r, col.setRGB(p.tint, p.shape??0.5, p.op, THREE.LinearSRGBColorSpace));
    }
    mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
    lastCam.copy(cam);
  }
  if (count) resort(new THREE.Vector3(0, 300, 500));

  const sunV = new THREE.Vector3();
  function update(t, camera, sunDirection = SUN_DIR) {
    if (!camera) return;
    const cp = camera.position;
    crownMat.uniforms.uSun.value.copy(sunDirection);
    if(!reducedMotion)crownMat.uniforms.uTime.value=t;
    for (const pl of planes) {
      pl.position.x = cp.x; pl.position.z = cp.z;
      const u = pl.material.uniforms;
      u.uSun.value.set(sunDirection.x, sunDirection.z).normalize();
      u.uCamY.value = cp.y;
      if (!reducedMotion) u.uTime.value = t;
    }
    sunV.copy(sunDirection).transformDirection(camera.matrixWorldInverse);
    mat.uniforms.uSunV.value.copy(sunV);
    // 相机在云海之下时，由上往下画（远的先画）；在上方时由下往上画。
    const below = cp.y < -96;
    planes.forEach((pl, i) => { pl.renderOrder = -30 + (below ? i : planes.length - i); });
    mesh.visible = cp.y > -118;   // 在云海之下时不画云团（它们会隔着云面透出来）
    if (count && lastCam.distanceToSquared(cp) > 400) resort(cp);
  }

  function dispose() {
    planes.forEach(p => { p.geometry.dispose(); p.material.dispose(); });
    mesh.geometry.dispose(); mat.dispose(); mesh.dispose();
    crownGeo.dispose(); crownMat.dispose(); crownMesh.dispose();
  }
  return { group, update, dispose, puffCount: count, clamp };
}
