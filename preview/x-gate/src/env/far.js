// 远景：分层浮城与小楼尖塔，场景雾自然淡化远层；保留缓行飞行器。
import * as THREE from 'three';
import { TAU } from './util.js';
import { PLACES, facingRotation } from '../kit/world.js';
import { CAMERA_APPROACHES } from './forecourts.js';
import { shardGeometry } from './islands.js';

export function createFar(ctx, hi) {
  const { kit, mats, reducedMotion } = ctx;
  const rnd = kit.rng(7788);
  const group = new THREE.Group(); group.name = 'env:far';
  const rock = new THREE.MeshLambertMaterial({ color: 0x7189a5, name: 'env:far-rock' });
  const city = new THREE.MeshLambertMaterial({ color: 0xdce8f5, name: 'env:far-city' });
  const cobalt = new THREE.MeshLambertMaterial({ color: 0x245ce0, name: 'env:far-cobalt' });
  // 远城低处再叠一层高度雾。只处理本模块自有材质，不改共享楼体 shader。
  for (const material of [rock, city, cobalt]) {
    material.onBeforeCompile = shader => {
      shader.vertexShader = 'varying float vEnvHeight;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <fog_vertex>',
        '#include <fog_vertex>\nvEnvHeight = (modelMatrix * vec4(transformed, 1.0)).y;');
      shader.fragmentShader = 'varying float vEnvHeight;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', `
        #include <fog_fragment>
        #ifdef USE_FOG
          float lowAir = exp(-max(vEnvHeight + 55.0, 0.0) / 180.0);
          float heightFog = 1.0 - exp(-max(vFogDepth - 280.0, 0.0) * .00055 * lowAir);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, heightFog);
        #endif`);
    };
    material.customProgramCacheKey = () => 'env-height-fog-r10';
  }
  const b = new kit.Builder({}, { tile: 80 });
  let litWindowCount = 0;

  // 五座近中景城与三层远城：尺度跨度大于 4 倍，岩体有宽台/双根/长脊之分。
  const count = hi ? 44 : 26;
  const heroSpots = [];
  const up=new THREE.Vector3(0,1,0);
  for(const [id,{pos}] of Object.entries(CAMERA_APPROACHES)) {
    const yaw=facingRotation(id),center=new THREE.Vector3(...PLACES[id].position);
    const eye=new THREE.Vector3(...pos).applyAxisAngle(up,yaw).add(center);
    const forward=center.clone().sub(eye).setY(0).normalize(),right=new THREE.Vector3().crossVectors(forward,up);
    // 每个镜头左一右二共三城，错开距离和海拔，不叠在主楼的中央轮廓上。
    for(const [j,offset] of [-.58,.39,.65].entries()) {
      const distance=640+(j%2)*210,p=eye.clone().addScaledVector(forward,distance).addScaledVector(right,offset*distance);
      heroSpots.push([p.x,center.y+30+j*16,p.z,28+(j%2)*10]);
    }
  }
  const citySpecs = [];
  for (let i = 0; i < count; i++) {
    const hero = i < heroSpots.length, layer = i % 3;
    const a = i < count - 8 ? Math.PI + (i / (count - 8)) * Math.PI : (i - count + 8) / 8 * Math.PI;
    const distance = 900 + layer * 650 + rnd() * 480;
    const [x, y, z, r] = hero ? heroSpots[i] : [Math.cos(a) * distance, i % 5 === 0 ? -40 + rnd() * 20 : 30 + rnd() * 410, Math.sin(a) * distance, 12 + Math.pow(rnd(), 1.8) * 58];
    const aspect = i % 3 === 0 ? 1.55 : i % 3 === 1 ? .76 : 1.15;
    citySpecs.push({ x, y, z, radius: r, hero, aspect });
    b.push({ x, y, z, ry: i * 1.9, sx: aspect, sz: 1 / Math.sqrt(aspect) });
    const roots = hero ? 7 : (hi ? 5 : 4);
    for (let j = 0; j < roots; j++) {
      const th = j * 2.4, d = j ? r * (.22 + rnd() * .35) : 0;
      const h = r * (i % 3 === 0 ? .35 + rnd() * .7 : .55 + rnd() * 1.25);
      b.add(shardGeometry(r * (j ? .24 : .60), h, i * 11 + j, 6), { x: Math.cos(th) * d, y: -rnd() * 4, z: Math.sin(th) * d, ry: th }, rock);
    }
    b.cyl(r, r * .90, hero ? 4 : 2.4, { y: 1 }, rock, hi ? 22 : 12);
    // 白色城区缩在岩台内部，远岛也保留露出的岩石边缘。
    b.cyl(r * .82, r * .87, 2, { y: 2.4 }, city, hi ? 22 : 12);
    const n = hero ? (hi ? 16 : 10) : 4 + Math.floor(rnd() * 5);
    for (let j = 0; j < n; j++) {
      const th = j * 2.4, d = j ? Math.sqrt(rnd()) * r * .70 : 0;
      const px = Math.cos(th) * d, pz = Math.sin(th) * d;
      const w = r * (hero ? .055 + rnd() * .06 : .09 + rnd() * .08), h = r * (j ? .16 + rnd() * .7 : 1.4);
      b.box(w, h, w * 1.2, { x: px, y: 4 + h / 2, z: pz, ry: th }, city);
      if (hero && j % 4 === 0) b.box(w * 1.5, 3, w * 1.6, { x: px, y: 4 + h * .65, z: pz, ry: th }, city);
      if (hero && j % 4 === 0) {
        b.push({x:px,y:4,z:pz,ry:th});
        // 少量蓝色幕墙和青色窗格，四面可读，白色楼身仍占主体。
        for (let face = 0; face < 4; face++) {
          b.push({ry:face*Math.PI/2});
          const fw = face % 2 ? w*1.2 : w, fd = face % 2 ? w : w*1.2;
          b.box(fw*.54,h*.46,.12,{y:h*.53,z:fd*.5+.07},cobalt);
          for (const row of [.37,.59,.72]) {
            b.box(fw*.42,.65,.16,{y:h*row,z:fd*.5+.16},mats.glowTeal);
            litWindowCount++;
          }
          b.pop();
        }
        b.pop();
      }
      if (j % 3 === 0) b.cyl(.1, w * .4, h * .5, { x: px, y: 4 + h * 1.25, z: pz }, city, 6);
    }
    if (hero) {
      b.torus(r * .34, .7, { y: r * .78 }, city, 5, hi ? 24 : 12);
      b.torus(r * .34, .42, { y: r * .78 + .6 }, mats.glowTeal, 4, hi ? 24 : 12);
      b.torus(r * .17, .55, { y: r * 1.5 }, cobalt, 5, hi ? 24 : 12);
      b.torus(r * .17, .32, { y: r * 1.5 + .45 }, mats.glowTeal, 4, hi ? 24 : 12);
    }
    b.pop();
  }
  group.userData.litWindowCount = litWindowCount;
  group.userData.islandCount = count; group.userData.citySpecs = citySpecs;

  const built = b.build('far');
  built.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } });
  group.add(built);

  // 空中飞行器：绕城慢速盘旋，半径 ≥ 480 避开岛体。
  const nCraft = hi ? 14 : 6;
  const craftGeo = new THREE.ConeGeometry(1.5, 9, 8).rotateX(Math.PI / 2);
  const wingGeo = new THREE.BoxGeometry(9, 0.2, 2.4);
  const lightGeo = new THREE.SphereGeometry(0.5, 8, 6);
  const hull = new THREE.InstancedMesh(craftGeo, mats.ceramic, nCraft); hull.name = 'env:craft'; hull.castShadow = true; hull.frustumCulled = false;
  const wings = new THREE.InstancedMesh(wingGeo, mats.shellCool, nCraft); wings.name = 'env:craft-wings'; wings.frustumCulled = false;
  const lamps = new THREE.InstancedMesh(lightGeo, mats.glowWhite, nCraft); lamps.name = 'env:craft-lights'; lamps.frustumCulled = false;
  const craft = [];
  for (let i = 0; i < nCraft; i++) craft.push({ r: 480 + rnd() * 700, h: 70 + rnd() * 260, a0: rnd() * TAU, w: (rnd() < 0.5 ? -1 : 1) * (0.012 + rnd() * 0.012), bob: rnd() * TAU });
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), tail = new THREE.Vector3(), eu = new THREE.Euler();
  function place(t) {
    craft.forEach((c, i) => {
      const a = c.a0 + c.w * t, y = c.h + Math.sin(c.bob + t * 0.05) * 6;
      p.set(Math.cos(a) * c.r, y, Math.sin(a) * c.r);
      const yaw = Math.atan2(-Math.sin(a) * Math.sign(c.w), Math.cos(a) * Math.sign(c.w));
      q.setFromEuler(eu.set(0, yaw, Math.sin(c.bob + t * 0.1) * 0.08, 'YXZ'));
      m.compose(p, q, one); hull.setMatrixAt(i, m); wings.setMatrixAt(i, m);
      tail.set(0, 0.2, -4.8).applyQuaternion(q).add(p);
      m.compose(tail, q, one); lamps.setMatrixAt(i, m);
    });
    hull.instanceMatrix.needsUpdate = wings.instanceMatrix.needsUpdate = lamps.instanceMatrix.needsUpdate = true;
  }
  place(0);
  group.add(hull, wings, lamps);

  return {
    group,
    update: (t) => { if (!reducedMotion) place(t); },
    dispose() { kit.disposeTree(group); rock.dispose(); city.dispose(); cobalt.dispose(); },
  };
}
