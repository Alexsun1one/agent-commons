// 岛缘植物与瀑布：种植避开桥口/总部中轴，所有高度取岛规格。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ENV, facingRotation } from '../kit/world.js';
import { TAU, angDiff } from './util.js';
import { rootPoint } from './islands.js';
import { blossomTrees, shrubs } from '../kit/flora.js';

export function createLandscape(ctx, islands, noise, puffTex, hi, views = [], foregroundTrees = []) {
  const { kit, mats } = ctx;
  const group = new THREE.Group(); group.name = 'env:landscape';
  const rnd = kit.rng(73119), bushPoints = [], treePoints = [];
  const plants = new kit.Builder(mats);
  const falls = [], mist = [], treeCounts = {}, treeClusters = {}, treeScales = [], waterfallWidths = [], sources = [];
  const grass = new THREE.MeshStandardMaterial({name:'env:grass',color:0x299a80,roughness:.96,side:THREE.DoubleSide,emissive:0x126c75,emissiveIntensity:.15});
  const blocked = (isl, a) => isl.gaps.some(g => Math.abs(angDiff(a, g.th)) < g.half + 0.08) || (isl.hq && Math.abs(angDiff(a, Math.PI / 2)) < 0.22);
  const rockPlantCounts = {};
  for (const isl of islands) {
    const count = isl.hq ? (hi ? 82 : 48) : (hi ? 44 : 26);
    for (let i=0;i<count;i++) {
      const a=(i+.7*rnd())/count*TAU;
      if(blocked(isl,a)||i%7===0)continue;
      const r=isl.outline(a)-3-rnd()*5;
      bushPoints.push({x:isl.cx+Math.cos(a)*r,y:isl.yT+.2,z:isl.cz+Math.sin(a)*r,scale:1.2+rnd()*1.05,flower:i%5<2});
      if(i%9===0)for(let j=0;j<(hi?6:4);j++){
        const down=1.5+j*2.1,rr=isl.outline(a)+.6-down*.12;
        bushPoints.push({x:isl.cx+Math.cos(a)*rr,y:isl.yT-down,z:isl.cz+Math.sin(a)*rr,scale:Math.max(.6,2.2-j*.22),flower:true});
      }
    }
    const rockRnd=kit.rng(5197+Math.round(isl.seed*100));let patches=0;
    for(let i=0;i<(isl.hq?8:4);i++){
      const a=(i+.45)/(isl.hq?8:4)*TAU;if(blocked(isl,a))continue;patches++;
      const start=5+rockRnd()*8,length=14+rockRnd()*16,n=hi?5:3;
      for(let j=0;j<n;j++){
        const t=j/(n-1),[x,y,z]=rootPoint(isl,a+Math.sin(t*5+i)*.009,(start+t*length)/isl.depth,isl.R*.025+.4);
        bushPoints.push({x,y,z,scale:(1-t*.55)*(1.3+rockRnd()*.5)});
      }
    }
    rockPlantCounts[isl.id]=patches;
    for(const sat of isl.satellites||[])bushPoints.push({x:sat.x,y:sat.y+.2,z:sat.z,scale:1.7});
    let planted = 0;
    const clusters = [];
    const nClusters = isl.hq ? (hi ? 42 : 26) : (hi ? 24 : 14);
    const treeRnd = kit.rng(73119 + Math.round(isl.seed * 100));
    for (let c = 0; c < nClusters; c++) {
      let a = (c + .28) / nClusters * TAU + (treeRnd() - .5) * .35;
      while (blocked(isl, a)) a += .16;
      const n = 1, r = isl.outline(a) - (c % 5 === 0 ? 1 : 5);
      const centerX = isl.cx + Math.cos(a) * r, centerZ = isl.cz + Math.sin(a) * r;
      clusters.push(n);
      for (let i = 0; i < n; i++) {
        const th = i * 2.4 + treeRnd(), reach = Math.sqrt(i) * 2.3;
        const scale = 1.6 + treeRnd()*.45, x = centerX + Math.cos(th) * reach, z = centerZ + Math.sin(th) * reach, y = isl.yT;
        treeRnd(); // 保留种植随机序列。
        let point = {x,y,z,scale,height:4.2, crown: true, mint:c%9===0};
        treePoints.push(point); treeScales.push(scale); planted++;
      }
    }
    treeClusters[isl.id] = clusters; treeCounts[isl.id] = planted;
    // 草坪与花圃散布在嵌线外侧，桥口留白；低灌木与花树共用实例材质。
    for (let i=0;i<(isl.hq?9:6);i++) {
      const a=(i+.45)/(isl.hq?9:6)*TAU;
      if(blocked(isl,a))continue;
      const r=Math.min(isl.R*.87,isl.platformOutline(a)-7),arc=.14+treeRnd()*.13;
      plants.add(new THREE.RingGeometry(r-5-treeRnd()*3,r,hi?20:10,1,a,arc),{x:isl.cx,y:isl.yT+.035,z:isl.cz,rx:Math.PI/2},grass);
      for(let j=0;j<3;j++){
        const th=a+arc*j/2;
        bushPoints.push({x:isl.cx+Math.cos(th)*(r-2),y:isl.yT+.1,z:isl.cz+Math.sin(th)*(r-2),scale:.7+treeRnd()*.6});
      }
    }
    const front = Math.PI/2-facingRotation(isl.id);
    // 各馆岩肩不对称，按正门局部角挑选外露瀑口，避开桥台及突出的岩脊。
    const shoulders = {network:[1.67,-1.21],hub:[-1.93,.69],cocreation:[1.615,-.872],value:[-1.615,.872]};
    const legacyAngles = (isl.hq ? [-.65,.65,2.7] : [...shoulders[isl.id],2.7]).map(a=>front+a);
    const view=views.find(v=>v.id===({base:'S01',network:'S02',hub:'S03',cocreation:'S04',value:'S05'})[isl.id]);
    const cameraAngle=view?Math.atan2(view.start.z-isl.cz,view.start.x-isl.cx):null;
    const angles=cameraAngle===null?legacyAngles:[cameraAngle-.58,cameraAngle+.65];
    for (let a of angles) {
      while (blocked(isl, a)) a += 0.15;
      const r = isl.outline(a) + 0.3, width = isl.hq ? 15 + rnd() * 4 : 10 + rnd() * 3;
      waterfallWidths.push(width);
      const top = isl.yT + 0.45, bottom = Math.min(ENV.cloudTop - 45, top - 120), height = top - bottom;
      // Narrow source channel covers the rim and turns over into a continuous falling sheet.
      sources.push({island:isl.id,angle:a,width,x:isl.cx+Math.cos(a)*r,y:top,z:isl.cz+Math.sin(a)*r});
      const geo = new THREE.PlaneGeometry(width, height, hi ? 10 : 5, hi ? 32 : 20);
      const pos = geo.attributes.position;
      for (let v = 0; v < pos.count; v++) {
        const u = geo.attributes.uv.getY(v), across = pos.getX(v);
        const t=1-u,drop=Math.max(0,(t-.12)/.88);
        const radial=t<.12?r-9+9*t/.12:r+8*Math.sin(Math.min(1,drop*6)*Math.PI/2)+drop*3;
        pos.setXYZ(v, isl.cx + Math.cos(a) * radial - Math.sin(a) * across, top - drop * height, isl.cz + Math.sin(a) * radial + Math.cos(a) * across);
      }
      geo.computeVertexNormals(); falls.push(geo);
      for (let j = 0; j < 7; j++) mist.push(kit.toMatrix({ x: isl.cx + Math.cos(a) * (r + 5) + (rnd() - 0.5) * 12, y: ENV.cloudTop + 22 - j * 4, z: isl.cz + Math.sin(a) * (r + 5), sx: width * (1.2 + j * 0.3), sy: 12 + j * 2, sz: width }));
    }
  }
  const add = (geo, mat, list, name) => { const mesh = kit.instanced(geo, mat, list, name); group.add(mesh); return mesh; };
  group.add(shrubs(ctx,bushPoints,{seed:5031,name:'env:shrubs'}));
  treePoints.push(...foregroundTrees);
  group.add(blossomTrees(ctx,treePoints,{seed:73119,name:'env:purple-canopies'}));
  group.add(plants.build('env:planters'));
  const water = new THREE.ShaderMaterial({
    name: 'env:water', transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { tNoise: { value: noise }, uTime: { value: 0 } }]),
    vertexShader: `varying vec2 vUv;
      #include <fog_pars_vertex>
      void main(){vUv=uv; vec4 mvPosition=modelViewMatrix*vec4(position,1.); gl_Position=projectionMatrix*mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: `varying vec2 vUv; uniform sampler2D tNoise; uniform float uTime;
      #include <fog_pars_fragment>
      void main(){
        float streak=texture2D(tNoise,vec2(vUv.x*1.7,vUv.y*.7+uTime*.09)).b;
        float fine=.5+.5*sin(vUv.x*95.+streak*4.);
        float edge=smoothstep(0.,.16,vUv.x)*(1.-smoothstep(.84,1.,vUv.x));
        float fade=smoothstep(0.,.36,vUv.y);
        gl_FragColor=vec4(mix(vec3(.24,.68,.92),vec3(1.8,1.95,2.0),streak*.6+fine*.4),edge*fade*(.45+fine*.25+streak*.3));
        #include <fog_fragment>
      }`,
  });
  const waterGeo = mergeGeometries(falls, false); falls.forEach(g => g.dispose());
  const sheets = new THREE.Mesh(waterGeo, water); sheets.name = 'env:waterfalls'; sheets.renderOrder = 0; group.add(sheets);
  const sprayMat = new THREE.ShaderMaterial({
    name: 'env:water-mist', transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { tPuff: { value: puffTex } }]),
    vertexShader: `varying vec2 vUv;
      #include <fog_pars_vertex>
      void main(){ vUv=uv; vec3 center=(instanceMatrix*vec4(0.,0.,0.,1.)).xyz;
        vec4 mvPosition=modelViewMatrix*vec4(center,1.);
        mvPosition.xy+=position.xy*vec2(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz));
        gl_Position=projectionMatrix*mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `varying vec2 vUv; uniform sampler2D tPuff;
      #include <fog_pars_fragment>
      void main(){gl_FragColor=vec4(.9,1.,1.08,texture2D(tPuff,vUv).a*.43);
        #include <fog_fragment>
      }`,
  });
  const spray = add(new THREE.PlaneGeometry(1, 1), sprayMat, mist, 'env:water-mist'); spray.castShadow = false; spray.frustumCulled = false; spray.renderOrder = 19;
  group.userData.rockPlantCounts = rockPlantCounts;
  group.userData.treeCounts = treeCounts; group.userData.treeClusters = treeClusters; group.userData.treeScales = treeScales;
  group.userData.waterfallSources = sources;
  group.userData.waterfalls = falls.length; group.userData.waterfallWidths = waterfallWidths;
  return { group, update(t) { if (!ctx.reducedMotion) water.uniforms.uTime.value = t; } };
}
