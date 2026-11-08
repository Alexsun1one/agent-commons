// 价值中心：晶柱簇、弧形展翼与汇流庭院。岛面 y=0，正门朝 +Z。
export const meta = { id: 'value', name: '价值中心', en: 'VALUE CITY' };
const TAU = Math.PI * 2;

function arcShape(THREE, inner, outer, start, end, steps) {
  const s = new THREE.Shape();
  const point = (r, a) => [Math.sin(a) * r, Math.cos(a) * r];
  s.moveTo(...point(outer, start));
  for (let i = 1; i <= steps; i++) s.lineTo(...point(outer, start + (end - start) * i / steps));
  s.lineTo(...point(inner, end));
  for (let i = 1; i <= steps; i++) s.lineTo(...point(inner, end + (start - end) * i / steps));
  s.closePath();
  return s;
}

export function build(ctx) {
  const { THREE, kit, mats, quality, reducedMotion } = ctx;
  const hi = quality !== 'low';
  const seg = hi ? 96 : 48;
  const root = new THREE.Group(); root.name = meta.id;
  const b = new kit.Builder(mats);
  const material = (name, options) => {
    const m = new THREE.MeshStandardMaterial(options); m.name = `value:${name}`; return m;
  };
  // 冰青、钴蓝、雾紫与粉紫晶面保留硬切面；加性光芯在透明晶面后绘制，亮度局限于实体光柱。
  const ice = new THREE.MeshPhysicalMaterial({
    color: 0x7fe9ff, emissive: 0x7fe9ff, emissiveIntensity: 0.32,
    transparent: true, opacity: 0.72, depthWrite: false,
    metalness: 0.04, roughness: 0.34, envMapIntensity: 0.15, specularIntensity: 0.12,
    clearcoat: 0.04, clearcoatRoughness: 0.3, flatShading: true,
  });
  ice.name = 'value:ice';
  const iceCyan = ice.clone(); iceCyan.name = 'value:ice-cyan'; iceCyan.color.setHex(0x2d5bff); iceCyan.emissive.setHex(0x2d5bff); iceCyan.emissiveIntensity = 0.4; iceCyan.opacity = 0.9;
  const iceViolet = ice.clone(); iceViolet.name = 'value:ice-violet'; iceViolet.color.setHex(0xa99be8); iceViolet.emissive.setHex(0x9c88e8); iceViolet.emissiveIntensity = 0.28; iceViolet.opacity = 0.88;
  const icePink = iceViolet.clone(); icePink.name = 'value:ice-pink'; icePink.color.setHex(0xd5adef); icePink.emissive.setHex(0xc193e8); icePink.emissiveIntensity = 0.25;
  const blue = material('crystal-blue', { color: 0x2d5bff, emissive: 0x2d5bff, emissiveIntensity: 0.08, metalness: 0, roughness: 0.65, flatShading: true });
  const violet = material('violet', { color: 0x8f82ff, emissive: 0x8f82ff, emissiveIntensity: 0.16, roughness: 0.48, flatShading: true });
  const light = material('inner-light', { color: 0x286383, emissive: 0x7fe9ff, emissiveIntensity: 2.6, roughness: 0.28 });
  const water = material('water', { color: 0x286b8e, emissive: 0x5fe8ff, emissiveIntensity: 0.7, metalness: 0.65, roughness: 0.12 });
  const leaves = material('shrubs', { color: 0x236675, roughness: 0.9 });
  const black = material('panda-black', { color: 0x08090d, metalness: 0, roughness: 0.95 });
  const pandaWhite = material('panda-white', { color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.20, metalness: 0, roughness: 0.9 });
  // TubeGeometry 的原生 U 是边缘到中心的路径进度；连续亮带沿 U 正向慢流。
  const flowTime = { value: 0 };
  const flow = material('flow', { color: 0x15394d, emissive: 0x5fe8ff, emissiveIntensity: 4.6, roughness: 0.4 });
  flow.onBeforeCompile = shader => {
    shader.uniforms.valueFlowTime = flowTime;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying float vValueFlowU;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvValueFlowU = uv.x;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float valueFlowTime;\nvarying float vValueFlowU;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\nfloat stream = smoothstep(0.35, 0.95, sin((vValueFlowU - valueFlowTime * 0.035) * 25.132741));\ntotalEmissiveRadiance *= 0.55 + stream * 0.85;');
  };
  flow.customProgramCacheKey = () => 'value-flow-r1b';
  flow.userData.time = flowTime;
  const flowTube = (points, radius, segments) => {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
    b.add(new THREE.TubeGeometry(curve, segments, radius, 5, false), {}, flow, { uv: false });
  };
  const cores = new kit.Builder(mats);
  const crowns = [], shrubs = [], people = [], rails = [];
  const poolZ = 29;
  const mainCore = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0x08cfff).multiplyScalar(1.9), transparent: true, opacity: 0.48,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  mainCore.name = 'value:cyan-core';
  const baseBeam = mainCore.clone();
  baseBeam.name = 'value:base-beam';
  baseBeam.color.setHex(0xb9f5ff).multiplyScalar(3.3);
  baseBeam.opacity = 0.8;
  // 正中光柱由塔基直贯主峰；外层青色光晕仍并入既有内芯批次。
  cores.cyl(0.16, 1.15, 146, { y: 74.6, z: -7 }, baseBeam, 12, true);
  cores.cyl(0.3, 2.35, 135, { y: 69.1, z: -7 }, mainCore, 12, true);

  const arc = (r0, r1, a0, a1, y, h, mat, z = 0) => {
    b.extrude(arcShape(THREE, r0, r1, a0, a1, Math.max(8, Math.ceil((a1 - a0) * seg / TAU))), h, { rx: Math.PI / 2, y: y + h, z }, mat, 0, 1);
  };
  const arcTube = (r, a0, a1, y, width, mat, z = 0) => {
    const n = Math.max(8, Math.ceil((a1 - a0) * seg / TAU));
    b.tube(Array.from({ length: n + 1 }, (_, i) => {
      const a = a0 + (a1 - a0) * i / n; return [Math.sin(a) * r, y, Math.cos(a) * r + z];
    }), width, {}, mat, n, hi ? 6 : 4);
  };

  // 铺地不含岛体。前庭水面向 +Z 偏移，让双翼之间留下入口。
  b.cyl(56.5, 56.5, 0.35, { y: 0.2 }, 'paving', seg);
  // 完整地面环路置于展廊外缘，略高于铺地避免闪烁。
  b.torus(52.6, 0.32, { y: 0.72 }, light, hi ? 6 : 4, seg);
  arc(23, 47, 0.76, TAU - 0.76, 0.38, 1.0, 'shell');
  for (let i = 0; i < 4; i++) b.box(13, 0.25, 2.6, { y: 0.5 + i * 0.25, z: 25 - i * 2.6 }, 'shell');
  b.cyl(19, 19, 0.45, { y: 0.6, z: poolZ }, 'ceramic', seg);
  b.cyl(18.4, 18.4, 0.08, { y: 0.86, z: poolZ }, water, seg);
  for (const r of [6, 10.5, 14.5, 18.6]) {
    b.torus(r, 0.18, { y: 0.98, z: poolZ }, light, hi ? 6 : 4, seg);
    b.torus(r + 0.4, 0.12, { y: 0.91, z: poolZ }, 'ceramic', 4, seg);
  }
  b.cyl(4.9, 5.5, 0.5, { y: 0.94, z: poolZ }, 'ceramic', 32);
  // 四向汇流道均落在广场内；没有装饰粒子，也不跨道造桥。
  const flowPaths = [
    [[0, 54], [0, 46], [3, 37], [0, poolZ]],
    [[-54, 0], [-47, 9], [-43, 27], [-26, 29], [0, poolZ]],
    [[54, 0], [47, 9], [43, 27], [26, 29], [0, poolZ]],
    [[0, -54], [-40, -33], [-47, 0], [-43, 28], [-26, 29], [0, poolZ]],
  ];
  for (const path of flowPaths) {
    for (const offset of [-1.2, 0, 1.2]) {
      flowTube(path.map(([x, z], i) => [x + offset * (1 - i / (path.length - 1)), 1.03, z]), 0.32, hi ? 64 : 32);
    }
  }
  // 宽幅地面步道从塔基绕开喷泉，蜿蜒接到 +Z 岛沿；平面带而非悬空管线。
  const walkCurve = new THREE.CatmullRomCurve3([
    [0, 1.48, 23], [-8, 1.48, 28], [-10, 1.48, 35],
    [-2, 1.48, 43], [5, 1.48, 50], [4, 1.48, 56],
  ].map(p => new THREE.Vector3(...p)));
  const walkEdges = [[], []], walkPositions = [], walkSegments = hi ? 72 : 36;
  for (let i = 0; i <= walkSegments; i++) {
    const t = i / walkSegments, p = walkCurve.getPoint(t), tangent = walkCurve.getTangent(t);
    const normal = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize();
    for (const [j, side] of [-1, 1].entries()) walkEdges[j].push(p.clone().addScaledVector(normal, side * 2.1).toArray());
    if (i) {
      const a = walkEdges[0][i - 1], c = walkEdges[1][i - 1], d = walkEdges[1][i], e = walkEdges[0][i];
      walkPositions.push(...a, ...e, ...c, ...c, ...e, ...d);
    }
  }
  const walkGeometry = new THREE.BufferGeometry();
  walkGeometry.setAttribute('position', new THREE.Float32BufferAttribute(walkPositions, 3));
  b.add(walkGeometry, {}, water);
  for (const edge of walkEdges) b.tube(edge, 0.14, {}, light, walkSegments, 4);
  root.userData.walkway = { width: 4.2, from: [0, 23], to: [4, 56], surface: 'emissive-cyan' };
  // 喷泉环：十二股向上收拢的光束，连续接到中轴，不用点状粒子。
  for (let i = 0; i < 12; i++) {
    const a = i * TAU / 12;
    const point = (r, y) => [Math.sin(a) * r, y, poolZ + Math.cos(a) * r];
    flowTube([point(5, 1.3), point(4.8, 5), point(3.5, 10), point(0.5, 15)], 0.29, hi ? 24 : 12);
  }

  // 两条独立弧形展廊，从塔后向前环抱水池；没有围绕塔身的一整圈筒壁。
  const wingPoint = (side, t) => {
    const a = Math.PI * 0.85 * t;
    const x = side * (18 + 26 * Math.sin(a)), z = -27 + 62 * t;
    const dx = side * 26 * Math.PI * 0.85 * Math.cos(a), dz = 62;
    const len = Math.hypot(dx, dz);
    return { x, z, nx: -side * dz / len, nz: side * dx / len, dx: dx / len, dz: dz / len, roof: 23 + 9 * Math.sin(Math.PI * t) };
  };
  const ribbon = (side, width, lift, thick, mat, floor = false) => {
    const positions = [], n = hi ? 48 : 24;
    const quad = (a, c, d, e) => positions.push(...a, ...c, ...d, ...a, ...d, ...e);
    const section = t => {
      const p = wingPoint(side, t), y = (floor ? 0 : p.roof) + lift;
      return [[p.x + p.nx * width / 2, y, p.z + p.nz * width / 2],
        [p.x - p.nx * width / 2, y, p.z - p.nz * width / 2],
        [p.x - p.nx * width / 2, y + thick, p.z - p.nz * width / 2],
        [p.x + p.nx * width / 2, y + thick, p.z + p.nz * width / 2]];
    };
    for (let j = 0; j < n; j++) {
      const a = section(j / n), c = section((j + 1) / n);
      for (let k = 0; k < 4; k++) quad(a[k], c[k], c[(k + 1) % 4], a[(k + 1) % 4]);
    }
    const a = section(0), c = section(1);
    quad(a[3], a[2], a[1], a[0]); quad(c[0], c[1], c[2], c[3]);
    // Mirrored wings need opposite triangle winding.
    if (side > 0) for (let i = 0; i < positions.length; i += 9) for (let k = 0; k < 3; k++) {
      const v = positions[i + 3 + k]; positions[i + 3 + k] = positions[i + 6 + k]; positions[i + 6 + k] = v;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    b.add(g, {}, mat);
  };
  const archShape = (width, spring, rise) => {
    const shape = new THREE.Shape();
    shape.moveTo(-width / 2, 0); shape.lineTo(width / 2, 0); shape.lineTo(width / 2, spring);
    shape.absellipse(0, spring, width / 2, rise, 0, Math.PI, false, 0);
    shape.closePath(); return shape;
  };
  for (const side of [-1, 1]) {
    ribbon(side, 19.5, 1.1, 1.3, 'shell', true);
    ribbon(side, 21, 0, 2.8, 'shell');
    ribbon(side, 20, 3.1, 0.8, 'ceramic');
    ribbon(side, 18.5, 4.1, 0.65, 'shell');
    for (let bay = 0; bay < 7; bay++) {
      const t = (bay + 0.5) / 7, p = wingPoint(side, t);
      const left = wingPoint(side, bay / 7), right = wingPoint(side, (bay + 1) / 7);
      const width = Math.hypot(right.x - left.x, right.z - left.z) + 0.25;
      for (const edge of [-1, 1]) {
        const cx = p.x + p.nx * 8.3 * edge, cz = p.z + p.nz * 8.3 * edge;
        b.push({ x: cx, y: 2.4, z: cz, ry: Math.atan2(-p.dz, p.dx) });
        const spring = p.roof - 10.4;
        b.extrude(archShape(width, spring, 8), 0.45, {}, 'curtain', 0, hi ? 16 : 8);
        const arch = Array.from({ length: 25 }, (_, i) => {
          const a = i * Math.PI / 24; return [Math.cos(a) * width / 2, spring + Math.sin(a) * 8, 0.65];
        });
        b.tube([[-width / 2, 0, 0.65], [-width / 2, spring, 0.65]], 0.38, {}, 'ceramic', 1, 6);
        b.tube([[width / 2, 0, 0.65], [width / 2, spring, 0.65]], 0.38, {}, 'ceramic', 1, 6);
        b.tube(arch, 0.65, {}, 'ceramic', hi ? 24 : 12, 6);
        // 拱上连续白色墙肩与实体墩，避免双翼仅剩玻璃线框。
        const spandrel = new THREE.Shape();
        spandrel.moveTo(-width / 2, spring); spandrel.lineTo(-width / 2, p.roof - 2.4);
        spandrel.lineTo(width / 2, p.roof - 2.4); spandrel.lineTo(width / 2, spring);
        spandrel.absellipse(0, spring, width / 2, 8, 0, Math.PI, false, 0);
        spandrel.closePath();
        b.extrude(spandrel, 0.9, {}, 'shell', 0, hi ? 16 : 8);
        for (const end of [-1, 1]) {
          b.box(1.0, spring, 1.1, { x: end * width / 2, y: spring / 2 }, 'ceramic');
          b.box(1.6, 0.65, 1.6, { x: end * width / 2, y: 0.32 }, 'ceramic');
        }
        for (const u of [-0.25, 0, 0.25]) b.box(0.14, spring + 6.6, 0.2, { x: width * u, y: (spring + 6.6) / 2, z: 0.6 }, 'ceramic');
        b.pop();
      }
    }
    // 大屏挂在两翼前端，面向前庭入口。
    const front = wingPoint(side, 1);
    b.push({ x: front.x, y: 2.4, z: front.z + 1.5, ry: side * 0.15 });
    const portal = archShape(21, 10, 11);
    const opening = archShape(17.8, 10, 8.8);
    portal.holes.push(new THREE.Path(opening.getPoints(hi ? 24 : 12)));
    b.extrude(portal, 2.4, {}, 'ceramic', 0.12, hi ? 24 : 12);
    b.box(22, 2.2, 3.4, { y: 21.5, z: 0.8 }, 'shell');
    b.pop();
    b.push({ x: front.x, y: 11, z: front.z + 2.2, ry: side * 0.15 });
    b.rbox(16.8, 12.2, 1, 0.25, {}, 'ceramic', 2);
    b.box(16, 11.4, 0.3, { z: 0.6 }, water);
    for (let w = 0; w < 4; w++) {
      const pts = Array.from({ length: 41 }, (_, i) => [-7 + i * 14 / 40, Math.sin(i / 40 * TAU + w * 0.8) * (2.4 + w * 0.5), 0.82]);
      b.tube(pts, 0.16, {}, light, hi ? 40 : 24, 4);
    }
    b.pop();
    // 屋顶花园沿两翼延伸，所有树团/灌木并入现有实例批次。
    for (const t of [0.20, 0.48, 0.73]) {
      const p = wingPoint(side, t), y = p.roof + 4.5;
      b.cyl(2.2, 2.5, 0.55, { x: p.x, y: y + 0.2, z: p.z }, 'ceramic', 16);
      b.cyl(0.18, 0.35, 3.7, { x: p.x, y: y + 2.1, z: p.z }, 'graphite', 6);
      for (let j = 0; j < (hi ? 5 : 3); j++) {
        const a = j * 2.4;
        crowns.push(kit.toMatrix({ x: p.x + Math.sin(a) * 1.4, y: y + 4.6 + (j % 2) * 0.6, z: p.z + Math.cos(a) * 1.4, sx: 1.5, sy: 1.05, sz: 1.35 }));
      }
    }
    for (let i = 0; i < (hi ? 20 : 10); i++) {
      const p = wingPoint(side, 0.08 + i / (hi ? 20 : 10) * 0.84);
      shrubs.push(kit.toMatrix({ x: p.x - p.nx * 4.7, y: p.roof + 4.9, z: p.z - p.nz * 4.7, sx: 1.45, sy: 0.75, sz: 1.3 }));
    }
  }
  // 两翼之间是真正敞开的高门洞；从前庭可穿过它看到塔后。
  const gate = new THREE.Shape();
  gate.moveTo(-12, 0); gate.lineTo(-12, 13);
  gate.absellipse(0, 13, 12, 15, Math.PI, 0, true, 0);
  gate.lineTo(12, 0); gate.lineTo(9.75, 0); gate.lineTo(9.75, 13);
  gate.absellipse(0, 13, 9.75, 11, 0, Math.PI, false, 0);
  gate.lineTo(-9.75, 0); gate.closePath();
  b.extrude(gate, 3, { y: 1.4, z: -4 }, 'shell', 0.2, hi ? 24 : 12);

  // 三层拱廊：现有底层双翼之上，再叠两道向内退的白色拱形层台。
  const arcadeTiers = [
    { radius: 47, floor: 26, roof: 39, bays: 18 },
    { radius: 38, floor: 40.9, roof: 54, bays: 15 },
  ];
  for (const tier of arcadeTiers) {
    const a0 = 0.54, a1 = TAU - 0.54;
    arc(tier.radius - 7, tier.radius + 1, a0, a1, tier.roof, 1.9, 'shell', -5);
    arc(tier.radius - 6.4, tier.radius + 0.2, a0, a1, tier.roof + 2.4, 0.45, 'ceramic', -5);
    arcTube(tier.radius - 0.4, a0, a1, tier.roof + 4, 0.12, 'ceramic', -5);
    for (let i = 0; i < tier.bays; i++) {
      const a = a0 + (a1 - a0) * (i + 0.5) / tier.bays;
      const width = 2 * tier.radius * Math.sin((a1 - a0) / tier.bays / 2) - 0.35;
      const spring = 4.8, rise = tier.roof - tier.floor - spring;
      b.push({ x: Math.sin(a) * tier.radius, y: tier.floor, z: Math.cos(a) * tier.radius - 5, ry: a });
      const frame = new THREE.Shape();
      frame.moveTo(-width / 2 - 0.4, 0); frame.lineTo(-width / 2 - 0.4, spring);
      frame.absellipse(0, spring, width / 2 + 0.4, rise + 0.4, Math.PI, 0, true, 0);
      frame.lineTo(width / 2 + 0.4, 0); frame.lineTo(width / 2 - 0.4, 0); frame.lineTo(width / 2 - 0.4, spring);
      frame.absellipse(0, spring, width / 2 - 0.4, rise - 0.55, 0, Math.PI, false, 0);
      frame.lineTo(-width / 2 + 0.4, 0); frame.closePath();
      b.extrude(frame, 1.0, {}, 'ceramic', 0, hi ? 16 : 8);
      b.box(0.14, 1.3, 0.14, { y: tier.roof - tier.floor + 3.4 }, 'ceramic');
      b.pop();
    }
  }

  // 十一根六棱晶柱：宽底到主峰逐级收束；整片侧面与斜肩使用同一材质。
  const crystalBuilder = new kit.Builder(mats);
  const buckets = [[], [], [], []];
  const facet = (kind, a, c, d) => buckets[kind].push(...a, ...c, ...d);
  const crystalSpecs = [
    [0, -7, 15, 128, 0.20, 0],
    [-17, -10, 12, 112, 0.32, 1], [18, -12, 12, 106, 0.65, 2],
    [-31, -7, 11, 108, 0.20, 3], [32, -5, 11, 101, 0.55, 4],
    [-39, -4, 11, 77, 0.05, 5], [39, -7, 11, 72, 0.10, 6],
    [0, -29, 12, 108, 0.50, 7],
    [-18, 12, 11, 93, 0.30, 8], [18, 13, 11, 86, 0.70, 9],
    [0, 17, 10, 64, 0.15, 10],
  ];
  for (const [x, z, r, h, phase, seed] of crystalSpecs) {
    const n = 6;
    const bottom = [], shoulder = [];
    const leanX = -x * 0.045, leanZ = -1.5;
    for (let i = 0; i < n; i++) {
      const a = phase + i * TAU / n;
      bottom.push([x + Math.cos(a) * r, 2, z + Math.sin(a) * r]);
      // 等高肩环保证每块侧壁共面，尖端以六块斜面收拢；不扭转、不随机拼色。
      shoulder.push([x + leanX + Math.cos(a) * r * 0.88,
        2 + h * 0.77,
        z + leanZ + Math.sin(a) * r * 0.88]);
    }
    const tip = [x + leanX + r * 0.20, 2 + h, z + leanZ - r * 0.18];
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      // 66 个完整晶面组中 20 个为雾紫 / 淡粉紫（30.3%），侧壁与斜肩同色。
      const tint = ((seed * n + i) * 7) % 66;
      const kind = tint < 10 ? 2 : tint < 20 ? 3 : (i + seed) % 3 === 0 ? 1 : 0;
      facet(kind, bottom[i], shoulder[i], bottom[next]);
      facet(kind, bottom[next], shoulder[i], shoulder[next]);
      facet(kind, shoulder[i], tip, shoulder[next]);
      // 只描真实棱线，保持笔直，不用 CatmullRom 平滑转角。
      b.tube([bottom[i], shoulder[i]], 0.19, {}, light, 1, 4);
      b.tube([shoulder[i], tip], 0.19, {}, light, 1, 4);
      b.tube([shoulder[i], shoulder[next]], 0.11, {}, light, 1, 4);
    }
    const main = seed === 0, coreBottom = 2.1, coreTop = 2 + h;
    cores.cyl(main ? 0.65 : 0.18, main ? 2.1 : 0.85, coreTop - coreBottom,
      { x: (x + tip[0]) / 2, y: (coreBottom + coreTop) / 2, z: (z + tip[2]) / 2,
        rx: Math.atan2(tip[2] - z, h), rz: -Math.atan2(tip[0] - x, h) }, mainCore, 8);
    if (main) {
      // 上射光柱从塔尖连续伸出；在固定 S05 画幅内保留完整尖端。
      cores.cyl(0.03, 0.65, 22, { x: tip[0], y: tip[1] + 10, z: tip[2] }, mainCore, 8);
    }
  }
  for (const [i, mat] of [ice, iceCyan, iceViolet, icePink].entries()) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(buckets[i], 3));
    crystalBuilder.add(g, {}, mat);
  }
  const crystalGroup = crystalBuilder.build('value:crystals');
  crystalGroup.children.forEach(mesh => { mesh.renderOrder = 1; });
  crystalGroup.userData.columns = crystalSpecs.map(([x, z, radius, height]) => ({ x, z, radius, height }));
  root.add(crystalGroup);

  // 六道前环肋按 S05 的视线展开、交错标高；另两道闭合后环。
  // 保持 +Z 为正门；局部 +X 径向板绕 Y 转 a-π/2 后落在 (sin a, cos a)。
  const ribSpecs = [
    [-1.23, 66, 41], [-0.73, 78, 26], [-0.23, 62, 26],
    [0.87, 66, 26], [1.37, 80, 26], [1.87, 70, 41],
    [2.8, 74, 26], [4.0, 72, 26],
  ];
  for (const [a, height, tipRadius] of ribSpecs) {
    const rib = new THREE.Shape();
    rib.moveTo(52, 1.5);
    rib.bezierCurveTo(52, 24, Math.min(50, tipRadius + 12), height - 8, tipRadius, height);
    rib.bezierCurveTo(tipRadius + 9, height - 20, 45, 21, 47.5, 1.5);
    rib.closePath();
    b.push({ ry: a - Math.PI / 2, z: -3 });
    b.extrude(rib, 2.5, {}, 'ceramic', 0.22, hi ? 24 : 12);
    // 双面嵌入钴蓝细线，侧向观看时仍有连续的弧肋辨识线。
    for (const face of [-0.24, 2.74]) {
      const seam = new THREE.CubicBezierCurve3(
        new THREE.Vector3(50.7, 2, face), new THREE.Vector3(50.7, 24, face),
        new THREE.Vector3(Math.min(49.5, tipRadius + 11.5), height - 9, face), new THREE.Vector3(tipRadius + 0.7, height - 1.1, face));
      b.add(new THREE.TubeGeometry(seam, hi ? 40 : 20, 0.16, 5, false), {}, blue);
    }
    b.pop();
  }
  root.userData.arcRibs = ribSpecs.length;

  // 花树、灌木、行人均实例化；每棵树数团树冠，避免一树一球。
  const count = hi ? 12 : 8;
  for (let i = 0; i < count; i++) {
    const a = 0.65 + i * (TAU - 1.3) / (count - 1) + (i === 0 ? 0.30 : 0);
    const x = Math.sin(a) * 49, z = Math.cos(a) * 49;
    b.cyl(0.25, 0.5, 5, { x, y: 2.9, z }, 'graphite', 7);
    b.cyl(3, 3.3, 0.6, { x, y: 0.7, z }, 'ceramic', 16);
    for (let j = 0; j < (hi ? 7 : 4); j++) {
      const t = j * 2.4;
      crowns.push(kit.toMatrix({ x: x + Math.sin(t) * 1.8, y: 5.2 + (j % 3) * 0.65, z: z + Math.cos(t) * 1.8, sx: 1.7, sy: 1.15, sz: 1.5, ry: t }));
    }
    for (let j = 0; j < 4; j++) shrubs.push(kit.toMatrix({ x: x + Math.sin(j * 1.7) * 3, y: 1.1, z: z + Math.cos(j * 1.7) * 3, sx: 1.25, sy: 0.8, sz: 1.1 }));
  }
  // 两档均保留 64 人：喷泉环 24、外广场 16、两层退台各 12。
  const personAt = (x, floor, z, facing) => people.push(kit.toMatrix({ x, y: floor, z, ry: facing }));
  for (let i = 0; i < 24; i++) {
    const a = TAU * (i + 0.35) / 24;
    personAt(Math.sin(a) * 20.8, 0.38, poolZ + Math.cos(a) * 20.8, a + Math.PI);
  }
  for (let i = 0; i < 16; i++) {
    const a = TAU * (i + 0.5) / 16;
    personAt(Math.sin(a) * 54, 0.38, Math.cos(a) * 54, a + Math.PI / 3);
  }
  for (const tier of arcadeTiers) for (const side of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const a = side * (0.66 + i * 0.22), r = tier.radius - 1.8;
      personAt(Math.sin(a) * r, tier.roof + 2.85, Math.cos(a) * r - 5, a);
    }
  }
  root.userData.crowd = { fountain: 24, plaza: 16, terraces: 24, total: people.length };
  // 四个通路口留开口，白栏杆只围合广场边界。
  for (let quadrant = 0; quadrant < 4; quadrant++) {
    const a0 = quadrant * Math.PI / 2 + 0.16, a1 = (quadrant + 1) * Math.PI / 2 - 0.16;
    arcTube(55, a0, a1, 1.75, 0.13, 'ceramic');
    for (let i = 0; i <= 14; i++) {
      const a = a0 + (a1 - a0) * i / 14;
      rails.push(kit.toMatrix({ x: Math.sin(a) * 55, y: 1.02, z: Math.cos(a) * 55 }));
    }
  }
  root.add(kit.instanced(new THREE.IcosahedronGeometry(1, hi ? 1 : 0), violet, crowns, 'value:flower-crowns'));
  root.add(kit.instanced(new THREE.IcosahedronGeometry(1, 0), leaves, shrubs, 'value:shrubs'));
  // 单个人体先合并为一份几何，64 人共用一个实例批次，头/躯干/四肢可辨。
  const person = new kit.Builder(mats);
  person.sphere(0.22, { y: 1.85 }, 'graphite', 8, 6);
  person.add(new THREE.CapsuleGeometry(0.23, 0.6, 3, 8), { y: 1.15 }, 'graphite');
  for (const side of [-1, 1]) {
    person.cyl(0.09, 0.11, 0.72, { x: side * 0.14, y: 0.36 }, 'graphite', 6);
    person.cyl(0.075, 0.085, 0.7, { x: side * 0.32, y: 1.16, rz: side * 0.12 }, 'graphite', 6);
  }
  const personGeometry = person.build('value:person-template').children[0].geometry;
  root.add(kit.instanced(personGeometry, mats.graphite, people, 'value:people'));
  root.add(kit.instanced(new THREE.CylinderGeometry(0.075, 0.09, 1.45, 5), mats.ceramic, rails, 'value:rails'));

  // 11 m 黑白坐姿熊猫：哑光白毛、黑耳眼圈四肢，仅围巾使用钴蓝。
  const panda = new kit.Builder(mats);
  const ellipsoid = (x, y, z, sx, sy, sz, mat) => panda.sphere(1, { x, y, z, sx, sy, sz }, mat, hi ? 24 : 16, hi ? 16 : 10);
  ellipsoid(0, 3.8, 0, 2.65, 3, 1.9, black);
  ellipsoid(0, 4.1, 1.0, 2.25, 2.6, 1.4, pandaWhite);
  ellipsoid(0, 8.0, 0.3, 3.3, 2.8, 2.4, pandaWhite);
  for (const side of [-1, 1]) {
    ellipsoid(side * 2.5, 10.1, 0.2, 1.08, 1.1, 0.8, black);
    ellipsoid(side * 1.27, 8.15, 2.32, 0.94, 1.12, 0.44, black);
    ellipsoid(side * 1.23, 8.25, 2.69, 0.43, 0.54, 0.15, pandaWhite);
    ellipsoid(side * 1.18, 8.2, 2.82, 0.25, 0.35, 0.12, black);
    ellipsoid(side * 2.4, 3.4, 1.1, 0.95, 1.6, 1.0, black);
    ellipsoid(side * 1.8, 1.1, 1.3, 1.3, 0.95, 1.5, black);
  }
  ellipsoid(0, 7.35, 2.66, 0.48, 0.3, 0.29, black);
  panda.tube([[-0.75, 6.92, 2.58], [-0.35, 6.75, 2.69], [0, 6.94, 2.73], [0.35, 6.75, 2.69], [0.75, 6.92, 2.58]], 0.08, {}, black, 16, 4);
  panda.torus(2.08, 0.54, { y: 5.9, sy: 0.72 }, blue, 8, 32);
  panda.rbox(1.15, 2.5, 0.45, 0.18, { x: 1.3, y: 4.8, z: 2.2, rz: 0.2 }, blue, 2);
  const mascot = panda.build('value:panda'); const bodyBounds = new THREE.Box3().setFromObject(mascot);
  const bodyHeight = bodyBounds.max.y - bodyBounds.min.y;
  mascot.scale.set(1.05, 11 / bodyHeight, 1.05);
  mascot.rotation.y = 0.22;
  mascot.position.set(27, 1.65 - bodyBounds.min.y * mascot.scale.y, 42);
  root.add(mascot);
  root.userData.pandaBody = { height: 11, colors: 'black-white-cobalt' };
  b.cyl(6.2, 6.8, 0.8, { x: 27, y: 0.9, z: 42 }, 'ceramic', 40);
  b.cyl(5.9, 5.9, 0.08, { x: 27, y: 1.34, z: 42 }, light, 40);
  b.torus(6.2, 0.23, { x: 27, y: 1.45, z: 42 }, light, 6, 48);
  const coreGroup = cores.build('value:cores');
  coreGroup.children.forEach(mesh => { mesh.renderOrder = 2; });
  root.add(b.build('value:architecture'), coreGroup);
  root.traverse(o => {
    if (o.isMesh && [ice, iceCyan, iceViolet, icePink, light, mainCore, baseBeam, flow].includes(o.material)) { o.castShadow = false; o.receiveShadow = false; }
  });
  const hotspots = [
    tag(kit, THREE, 'value:profile', '成长档案', [0, 13, -1], 20, 25, 6, { y: 13, z: -1 }),
    tag(kit, THREE, 'value:contrib', '作品与贡献', [-28, 15, 31], 21, 15, 6, { x: -28, y: 15, z: 31 }),
    tag(kit, THREE, 'value:impact', '社区影响力', [28, 15, 31], 21, 15, 6, { x: 28, y: 15, z: 31 }),
    tag(kit, THREE, 'value:results', '项目成果', [0, 2, poolZ], 17, 5, 17, { y: 2.5, z: poolZ }),
    tag(kit, THREE, 'value:growth', '协作价值', [0, 150, -7], 22, 26, 22, { y: 151, z: -7 }),
    tag(kit, THREE, 'value', '价值中心', [0, 78, 18], 100, 162, 100, { y: 83 }),
  ];
  root.add(...hotspots);
  const bounds = new THREE.Box3().setFromObject(root);
  return {
    group: root, hotspots, bounds,
    update(t) {
      if (reducedMotion) return;
      flowTime.value = t;
    },
    dispose() { kit.disposeTree(root); },
  };
}

function tag(kit, THREE, id, label, anchor, w, h, d, t) {
  const mesh = kit.hotspot(id, w, h, d, t);
  mesh.userData.label = label;
  mesh.userData.anchor = new THREE.Vector3(...anchor);
  return mesh;
}
