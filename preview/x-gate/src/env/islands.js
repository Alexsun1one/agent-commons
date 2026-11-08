// 浮岛：平整平台、岛缘台地、分层收腰岩核与不齐的倒悬节理岩柱。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PLACES } from '../kit/world.js';
import { addRockCoordinates, createRockMaterial } from './rock-surface.js';
import { TAU, clamp, lerp, smooth, makeOutline, angDiff, loft, beam } from './util.js';

const PLATE = 2.0;        // 平台厚度（顶面到岩根起点）
const ROCK_INSET = 3.2;   // 岩根起点相对岛缘内缩

export function islandSpecs() {
  const out = [];
  let k = 0;
  for (const [id, p] of Object.entries(PLACES)) {
    const [cx, y, cz] = p.position;
    const hq = id === 'base';
    const seed = 3 + k * 7.3; k++;
    // 总部岛正门一侧外凸成门前广场（约 +10%），让 (0,16,175) 的镜头落在广场上方。
    const platformOutline = makeOutline(p.island, seed, hq ? th => 0.1 * Math.exp(-Math.pow(angDiff(th, Math.PI / 2) / 0.5, 2)) : null);
    const ledges = hq ? [0.2, 1.42, 3.3, 4.8] : [0.4 + k * 0.25, 2.5 + k * 0.15, 4.6 + k * 0.1];
    const outline = th => platformOutline(th) + p.island * (ledges.reduce((sum, a, i) => sum + (0.11 + (i % 2) * 0.06) * Math.exp(-Math.pow(angDiff(th, a) / 0.21, 2)), 0) + 0.018 * Math.sin(th * 31 + seed) + 0.009 * Math.sin(th * 57));
    out.push({ id, cx, cz, yT: y - 0.05, R: p.island, outline, platformOutline, ledges, seed, hq, depth: hq ? 270 : 195, gaps: [] });
  }
  return out;
}

// 岩核表面点：θ 绕圈，u∈[0,1] 自上而下。
export function rootRadius(isl, th, u) {
  const levels = [[0, 1], [0.025, 0.83], [0.08, 0.75], [0.22, 0.56], [0.43, 0.36], [0.68, 0.17], [1, 0.006]];
  let k = 0;
  while (k < levels.length - 2 && u > levels[k + 1][0]) k++;
  const [a, ra] = levels[k], [b, rb] = levels[k + 1];
  const taper = lerp(ra, rb, clamp((u - a) / (b - a)));
  const joints = 1 + (0.026 * Math.sin(th * 37 + isl.seed) + 0.018 * Math.sin(th * 71)) * smooth(0, 0.02, u);
  return Math.max(0.1, (isl.outline(th) - ROCK_INSET) * taper * joints);
}
export function rootPoint(isl, th, u, off = 0) {
  const r = rootRadius(isl, th, u) + off;
  return [isl.cx + Math.cos(th) * r, isl.yT - PLATE - u * isl.depth, isl.cz + Math.sin(th) * r];
}
export function islandRadiusAt(isl, y) {
  if (y > isl.yT - PLATE) return isl.R * 1.3;
  const u = clamp((isl.yT - PLATE - y) / isl.depth);
  return rootRadius(isl, 0, u) * 1.28;
}

// 同一截面保留竖直棱线；相邻短层突退形成断层台阶，尖端偏心。
export function shardPoint(th, u, radius, height, seed) {
  const steps = [[0, 1], [0.16, 0.96], [0.18, 0.79], [0.43, 0.74], [0.46, 0.59], [0.73, 0.42], [1, 0.005]];
  let k = 0;
  while (k < steps.length - 2 && u > steps[k + 1][0]) k++;
  const [a, ra] = steps[k], [b, rb] = steps[k + 1];
  const r = radius * lerp(ra, rb, clamp((u - a) / (b - a))) * (1 + 0.13 * Math.sin(th * 3 + seed));
  return [Math.cos(th) * r + u * radius * 0.35, -height * u, Math.sin(th) * r + u * radius * Math.sin(seed) * 0.4];
}
export function shardGeometry(radius, height, seed, sides = 7) {
  return loft(sides, [0, 0.16, 0.18, 0.43, 0.46, 0.73, 1].map(u => th => shardPoint(th, u, radius, height, seed)), 'out');
}
// Float32 尖端读回可能比 height 大一丝，不能直接对 (1-u) 做小数幂。
export function rockTaper(u, exponent) {
  if (!Number.isFinite(u) || !Number.isFinite(exponent) || exponent <= 0) throw new RangeError('Invalid rock taper input');
  return Math.pow(clamp(1 - u), exponent);
}
function buildRock(isl, hi) {
  const us = [0, 0.025, 0.05, 0.08, 0.15, 0.22, 0.32, 0.43, 0.55, 0.68, 0.85, 1];
  const parts = [loft(hi ? 192 : 96, us.map(u => th => rootPoint(isl, th, u)), 'out', { cx: isl.cx, cz: isl.cz })];
  // 顶下 0–4 m 岩唇：错落外挑、折返及下垂，不再是一条平整裙边。
  const lipN = hi ? 256 : 128;
  const lip = (inset, depth, variation) => th => {
    const tooth = .5 + .5 * Math.sin(th * 47 + isl.seed) * Math.cos(th * 19);
    const radius = isl.outline(th) - inset + Math.sin(th * 83 + isl.seed) * .65;
    return [isl.cx + Math.cos(th) * radius, isl.yT - depth - tooth * variation, isl.cz + Math.sin(th) * radius];
  };
  parts.push(loft(lipN, [lip(.3, .15, .25), lip(-.8, .8, .65), lip(.3, 1.9, .7), lip(3.2, 3.1, .9)], 'out', { cx: isl.cx, cz: isl.cz }));
  isl.rockLipDepth = 4;
  const rnd = n => { const h = Math.sin(n * 127.1 + isl.seed * 311.7) * 43758.5453; return h - Math.floor(h); };
  const count = isl.hq ? 66 : 42;
  // 错落岩锥沿倒锥外形向内倾；少量长根从中下部起，最长到岛深的 130%。
  for (let i = 0; i < count; i++) {
    const th = i / count * TAU + rnd(i) * 0.04;
    const inner = i % 4 === 0;
    const startDepth = inner ? isl.depth * (0.24 + rnd(i + 3) * 0.15) : 2 + rnd(i + 3) * 5;
    const endDepth = i === 0 ? isl.depth * 1.3 : isl.depth * (inner ? 0.82 + rnd(i + 17) * 0.44 : 0.25 + rnd(i + 17) * 0.47);
    const height = endDepth - startDepth;
    const radius = isl.R * (inner ? 0.10 : 0.038) * (0.7 + rnd(i + 9) * 0.8);
    const r0 = inner ? rootRadius(isl, th, startDepth / isl.depth) * 0.75 : isl.outline(th) - radius;
    const g = shardGeometry(radius, height, i + isl.seed, hi ? 8 : 6);
    const position = g.attributes.position;
    for (let j = 0; j < position.count; j++) {
      const u = -position.getY(j) / height;
      const radial = r0 * rockTaper(u, inner ? 0.7 : 1.55);
      position.setXYZ(j, position.getX(j) + isl.cx + Math.cos(th) * radial, position.getY(j) + isl.yT - startDepth, position.getZ(j) + isl.cz + Math.sin(th) * radial);
    }
    g.computeVertexNormals(); parts.push(g);
  }
  // 外凸台地之外的卫星岩块：有真实岩顶，错开高度和形状。
  isl.satellites = isl.ledges.filter((_, i) => i !== 1).slice(0, 2).map((th, i) => {
    const radius = isl.R * (i ? 0.065 : 0.095), r = isl.outline(th) + radius * 2.1;
    const x = isl.cx + Math.cos(th) * r, z = isl.cz + Math.sin(th) * r, y = isl.yT - 5 - i * 12;
    const g = shardGeometry(radius, radius * (3 + i), isl.seed + i, hi ? 9 : 6); g.translate(x, y, z); parts.push(g);
    const cap = loft(hi ? 18 : 10, [() => [x, y, z], a => [x + Math.cos(a) * radius, y, z + Math.sin(a) * radius]], 'up'); parts.push(cap);
    return { x, y, z, radius };
  });
  isl.maxRockDepth = isl.depth * 1.3;
  const geo = mergeGeometries(parts, false); parts.forEach(g => g.dispose());
  addRockCoordinates(geo, isl);
  return { geo };
}

const inGap = (isl, th, pad = 0) => isl.gaps.some(g => Math.abs(angDiff(th, g.th)) < g.half + pad);

export function buildIslands(ctx, b, inst, hi) {
  const { kit, mats } = ctx;
  const specs = islandSpecs();
  const fissureMat = mats.glowTeal.clone(); fissureMat.name = 'glowTeal:env-fissures'; fissureMat.color.set(0x004d46); fissureMat.emissive.set(0x39e8f4); fissureMat.emissiveIntensity = 3.36; fissureMat.userData.shared = false;
  return {
    specs,
    // 在 gaps 填好之后调用。
    build() {
      const rocks = [];
      for (const isl of specs) {
        const N = isl.hq ? (hi ? 256 : 128) : (hi ? 160 : 80);
        const yT = isl.yT, R = isl.outline, cx = isl.cx, cz = isl.cz;
        const ringD = (d, y) => (th) => { const r = R(th) - d; return [cx + Math.cos(th) * r, y, cz + Math.sin(th) * r]; };
        const center = () => [cx, yT, cz];
        const L = (rings, expect, opts) => loft(N, rings, expect, { cx, cz, ...opts });

        // 中间保留平整建筑平台，外围改为参差岩台，取消连续白色圆环。
        const platform = th => { const r = isl.platformOutline(th) - 12; return [cx + Math.cos(th) * r, yT, cz + Math.sin(th) * r]; };
        b.add(L([center, platform], 'up'), {}, 'env:deck');
        b.add(L([platform, ringD(1.5, yT - 0.08)], 'up'), {}, 'env:deck');
        // 同心嵌线贴地，不加厚重台阶；外圈与不规则岩唇之间保留种植带。
        for (const fraction of [.63, .75, .86]) {
          const radius = isl.R * fraction;
          b.add(new THREE.RingGeometry(radius, radius + .24, hi ? 144 : 72), {x:cx,y:yT+.022,z:cz,rx:-Math.PI/2}, 'glowSoft');
        }
        // 岩唇在 buildRock 中与有纹理的岩根合并。

        // ── 栏杆（桥头留口）：立柱 + 扶手 + 玻璃板，实例化
        const rr = th => isl.platformOutline(th) - 13;
        const spacing = 3.1, len = TAU * isl.R, nr = Math.round(len / spacing);
        const pts = [];
        for (let i = 0; i <= nr; i++) { const th = i / nr * TAU, r = rr(th) - 0.45; pts.push([cx + Math.cos(th) * r, cz + Math.sin(th) * r, th]); }
        for (let i = 0; i < nr; i++) {
          const a = pts[i], bb = pts[i + 1], thm = (a[2] + bb[2]) / 2;
          if (!hi && i % 2) continue;
          if (inGap(isl, a[2], 0.012) && inGap(isl, bb[2], 0.012)) continue;
          if (!inGap(isl, a[2], 0.012)) {
            inst.posts.push(kit.toMatrix({ x: a[0], y: yT + 0.55, z: a[1] }));
            if (i % 4 === 0) inst.lights.push(kit.toMatrix({ x: a[0], y: yT + 1.2, z: a[1] }));
          }
          if (inGap(isl, thm, 0.012)) continue;
          const dx = bb[0] - a[0], dz = bb[1] - a[1], l = Math.hypot(dx, dz), ang = Math.atan2(-dz, dx), mx = (a[0] + bb[0]) / 2, mz = (a[1] + bb[1]) / 2;
          inst.rails.push(kit.toMatrix({ x: mx, y: yT + 1.12, z: mz, ry: ang, sx: l, sy: 0.1, sz: 0.14 }));
          if (hi) inst.panels.push(kit.toMatrix({ x: mx, y: yT + 0.64, z: mz, ry: ang, sx: l - 0.12, sy: 0.82, sz: 0.04 }));
        }

        // ── 岛上铺装细节
        if (isl.hq) hqPlaza(b, inst, kit, isl, hi); else outerIsland(b, inst, kit, isl, hi);

        // ── 岩根
        const rock = buildRock(isl, hi);
        rocks.push(rock.geo);
        rockFissures(b, isl, fissureMat);
      }
      const rockGeo = mergeGeometries(rocks, false);
      rocks.forEach(g => g.dispose());
      const rockMat = createRockMaterial(mats.rock);
      const rockMesh = new THREE.Mesh(rockGeo, rockMat);
      rockMesh.name = 'env:rock'; rockMesh.castShadow = true; rockMesh.receiveShadow = true; rockMesh.frustumCulled = false;
      void mats;
      return rockMesh;
    },
  };
}

function hqPlaza(b, inst, kit, isl, hi) {
  const { cx, cz, yT } = isl;
  const y = yT;
  // 中轴大道：从总部前缘（z=110）到岛缘，与门洞同宽。
  b.box(28, 0.06, 80, { x: cx, y: y + 0.03, z: cz + 110 + 40 }, 'shell');
  for (const sx of [-1, 1]) {
    b.box(0.3, 0.05, 78, { x: cx + sx * 14.1, y: y + 0.07, z: cz + 110 + 39 }, 'glowSoft');
    b.box(0.5, 0.05, 78, { x: cx + sx * 14.6, y: y + 0.07, z: cz + 110 + 39 }, 'metal');
  }
  // 广场圆盘：外环金属、青线、内盘、X 标记（先锋队 X-GATE）。
  const pz = cz + 148;
  b.add(new THREE.CircleGeometry(30, 96), { x: cx, y: y + 0.045, z: pz, rx: -Math.PI / 2 }, 'shellCool');
  b.add(new THREE.RingGeometry(26.5, 27.3, 96), { x: cx, y: y + 0.07, z: pz, rx: -Math.PI / 2 }, 'metal');
  b.add(new THREE.RingGeometry(28.2, 28.5, 96), { x: cx, y: y + 0.08, z: pz, rx: -Math.PI / 2 }, 'glowSoft');
  b.add(new THREE.RingGeometry(29.4, 30.2, 96), { x: cx, y: y + 0.07, z: pz, rx: -Math.PI / 2 }, 'metal');
  b.add(new THREE.CircleGeometry(25.8, 96), { x: cx, y: y + 0.06, z: pz, rx: -Math.PI / 2 }, 'ceramic');
  for (const a of [Math.PI / 4, -Math.PI / 4]) {
    b.box(46, 0.05, 1.8, { x: cx, y: y + 0.09, z: pz, ry: a }, 'metal');
    b.box(46, 0.05, 0.3, { x: cx, y: y + 0.12, z: pz, ry: a }, 'glowSoft');
  }
  // 门前台地：大道两侧各一排长凳，座面钛白、底部青线。
  for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) {
    const zz = cz + 122 + i * 14;
    b.rbox(20, 0.5, 1.7, 0.2, { x: cx + sx * 46, y: y + 0.85, z: zz }, 'ceramic', 1);
    for (const px of [-8, 8]) b.box(0.8, 0.6, 1.3, { x: cx + sx * 46 + px, y: y + 0.3, z: zz }, 'metal');
    b.box(18.6, 0.06, 0.12, { x: cx + sx * 46, y: y + 0.52, z: zz + 0.8 }, 'glowSoft');
  }
  // 路灯：大道两侧，每 9 m 一对。
  for (let z = cz + 118; z <= cz + 176; z += 9.7) for (const sx of [-1, 1]) {
    inst.poles.push(kit.toMatrix({ x: cx + sx * 21, y: y + 3.1, z }));
    inst.heads.push(kit.toMatrix({ x: cx + sx * 21, y: y + 6.25, z }));
  }
  // 广场地灯：环形矮柱。
  if (hi) for (let i = 0; i < 28; i++) {
    const a = i / 28 * TAU;
    if (Math.abs(angDiff(a, -Math.PI / 2)) < 0.22) continue;
    inst.bollards.push(kit.toMatrix({ x: cx + Math.cos(a) * 32, y: y + 0.45, z: pz + Math.sin(a) * 32 }));
  }
  // 门前大台阶之前的过渡带：宽台阶条（z=110 外一级 0.25 m 的下沉缓坡不做，保持平整）。
}

function outerIsland(b, inst, kit, isl, hi) {
  const { cx, cz, yT } = isl;
  const y = yT, R = isl.R;
  // 面向总部的入口平台：桥头广场 + 通向建筑的步道。
  const toHQ = Math.atan2(-cz, -cx);
  const dx = Math.cos(toHQ), dz = Math.sin(toHQ);
  const place = (d, w, len, h, mat, ox = 0) => b.box(w, h, len, { x: cx + dx * d - dz * ox, y: y + h / 2, z: cz + dz * d + dx * ox, ry: Math.atan2(-dz, dx) + Math.PI / 2 }, mat);
  place(R - 16, 12, 34, 0.06, 'shell');
  for (const s of [-1, 1]) { place(R - 16, 0.3, 34, 0.05, 'glowSoft', s * 6.1); place(R - 16, 0.5, 34, 0.05, 'metal', s * 6.6); }
  // 桥头圆盘
  b.add(new THREE.CircleGeometry(12, 64), { x: cx + dx * (R - 12), y: y + 0.045, z: cz + dz * (R - 12), rx: -Math.PI / 2 }, 'shellCool');
  b.add(new THREE.RingGeometry(11.2, 12, 64), { x: cx + dx * (R - 12), y: y + 0.07, z: cz + dz * (R - 12), rx: -Math.PI / 2 }, 'graphite');
  b.add(new THREE.RingGeometry(10.4, 10.65, 64), { x: cx + dx * (R - 12), y: y + 0.08, z: cz + dz * (R - 12), rx: -Math.PI / 2 }, 'glowSoft');
  // 环岛路灯
  const n = Math.round(R * 0.35);
  for (let i = 0; i < n; i++) {
    const a = i / n * TAU;
    if (Math.abs(angDiff(a, toHQ)) < 0.26) continue;
    const r = isl.outline(a) - 8;
    inst.poles.push(kit.toMatrix({ x: cx + Math.cos(a) * r, y: y + 3.1, z: cz + Math.sin(a) * r }));
    inst.heads.push(kit.toMatrix({ x: cx + Math.cos(a) * r, y: y + 6.25, z: cz + Math.sin(a) * r }));
  }
  if (hi) for (let i = 0; i < 20; i++) {
    const a = i / 20 * TAU + 0.1;
    if (Math.abs(angDiff(a, toHQ)) < 0.5) continue;
    const r = isl.outline(a) - 13.2;
    inst.bollards.push(kit.toMatrix({ x: cx + Math.cos(a) * r, y: y + 0.45, z: cz + Math.sin(a) * r }));
  }
}

// 外露岩核保留 15/13 条分叉裂纹；R8 反馈后密度约降 30%，岩体占主导。
function rockFissures(b, isl, material) {
  const count = isl.hq ? 15 : 13;
  isl.fissureCount = count;
  for (let i = 0; i < count; i++) {
    const angle = (i + 0.3) / count * TAU;
    const point = (u, turn = 0) => new THREE.Vector3(...rootPoint(isl, angle + turn, u, isl.R * 0.038 + 0.65));
    const levels = [0, 0.015, 0.035, 0.07, 0.12, 0.20, 0.29, 0.40, 0.52];
    const points = levels.map((u, j) => point(u, j % 2 ? 0.012 : -0.009));
    // 岩脉从岩侧翻上外沿，略高机位也能读到短而分叉的青色矿脉。
    const rim = isl.outline(angle);
    points.unshift(new THREE.Vector3(isl.cx+Math.cos(angle)*(rim-3),isl.yT+.03,isl.cz+Math.sin(angle)*(rim-3)));
    points.unshift(new THREE.Vector3(isl.cx+Math.cos(angle-.015)*(rim-8),isl.yT+.04,isl.cz+Math.sin(angle-.015)*(rim-8)));
    const segment = (a, c, width) => b.add(new THREE.CylinderGeometry(width * 0.75, width, 1, 4, 1, true), beam(a, c, 1), material);
    for (let j = 1; j < points.length; j++) segment(points[j - 1], points[j], isl.hq ? 0.33 : 0.27);
    for (const [j, side] of [[2, 1], [4, -1]]) {
      const a = points[j + 2], mid = point(levels[j] + 0.035, side * 0.055), end = point(levels[j] + 0.11, side * 0.085);
      segment(a, mid, 0.11); segment(mid, end, 0.075);
    }
  }
}
