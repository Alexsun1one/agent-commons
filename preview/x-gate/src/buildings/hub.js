// 智能体管理中心 AGENT HUB：白色实体长壳机库 + 指挥塔（概念图 A-hub，R3）。
// 12 道外露钢肋之间是白壳，肋间只留窄条茶青玻璃天窗。开口绕塔转到 S03 机位。
// 塔顶飞碟是茶青玻璃，顶上天线组，一道光柱向上。机坪 3 架悬停无人机（含熊猫）下射青光，钴蓝竖旗 2 面。
// 机坪外沿花树/灌木来自 src/kit/flora.js。运行：?solo=hub
import { blossomTrees, shrubs } from '../kit/flora.js';

export const meta = { id: 'hub', name: '智能体管理中心', en: 'AGENT HUB' };

const TZ = -16;
const TY = 1.4;
const SPAN = 46;
const WALL = 9;
const CROWN = 18.8;
const Z0 = -40;
const Z1 = 26;
const RIBS = 12;
const APRON = 56;

function archPoint(t, z, lift = 0) {
  const x = -SPAN + t * SPAN * 2;
  const y = WALL + CROWN * Math.sin(t * Math.PI) + lift;
  return { x, y, z };
}

function archFrame(t, z, lift = 0) {
  const p = archPoint(t, z, lift);
  const dt = 0.012;
  const a = archPoint(Math.max(0, t - dt), z, lift);
  const c = archPoint(Math.min(1, t + dt), z, lift);
  let nx = -(c.y - a.y), ny = c.x - a.x;
  const len = Math.hypot(nx, ny) || 1;
  nx /= len; ny /= len;
  if (ny < 0) { nx = -nx; ny = -ny; }
  return { x: p.x, y: p.y, z: p.z, nx, ny };
}

function ribZ(i) {
  return Z1 + (Z0 - Z1) * (i / (RIBS - 1));
}

export function build(ctx) {
  const { THREE, kit, mats, quality, reducedMotion } = ctx;
  const hi = quality !== 'low';
  const N = (h, l) => (hi ? h : l);
  const b = new kit.Builder(mats);
  const root = new THREE.Group();
  root.name = meta.id;

  // 茶青玻璃：色相约 172°，避开 15°–65°。天窗和飞碟舱共用，不另占 draw call。
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x8fe8dc, metalness: 0.12, roughness: 0.05, transparent: true,
    opacity: 0.7, envMapIntensity: 1.55, side: THREE.DoubleSide, depthWrite: true,
    emissive: 0x1a9eaa, emissiveIntensity: 0.95,
  });
  glassMat.name = 'hub:glass';
  // 熊猫白走哑光，不借用高光陶瓷，避免机位正面把肚皮打成一团过曝。
  const pandaWhite = mats.ceramic.clone();
  pandaWhite.name = 'hub:panda:white';
  pandaWhite.userData = {};
  pandaWhite.color.set(0xe6eef6);
  pandaWhite.metalness = 0;
  pandaWhite.roughness = 0.74;
  pandaWhite.clearcoat = 0;
  pandaWhite.envMapIntensity = 0.18;
  pandaWhite.emissive.set(0x000000);
  pandaWhite.emissiveIntensity = 0;
  // S03 在 [60, 26, 110]，看向 [0, 26, -5]。开口仍绕塔朝机位。
  const YAW = 0.26;
  const mouthFrame = new THREE.Matrix4()
    .makeTranslation(0, 0, TZ)
    .multiply(new THREE.Matrix4().makeRotationY(YAW))
    .multiply(new THREE.Matrix4().makeTranslation(0, 0, -TZ));
  const yawAround = (x, z) => {
    const v = new THREE.Vector3(x, 0, z).applyMatrix4(mouthFrame);
    return [v.x, v.z];
  };
  const MAST_Y = 56.4;
  const bandMat = new THREE.MeshBasicMaterial({ color: 0x19f3ff, toneMapped: false, fog: false });
  bandMat.name = 'glow:band';
  const scarfMat = new THREE.MeshStandardMaterial({
    color: 0x2d5bff, roughness: 0.42, metalness: 0.08,
    emissive: 0x2d5bff, emissiveIntensity: 0.85,
  });
  scarfMat.name = 'hub:scarf';

  const seg = N(40, 20);
  const inTower = (x, y, z) => y > WALL + 1.2 && Math.hypot(x, z - TZ) < 11.6;

  // ── 1. 拱顶：白壳为主，肋间窄条天窗。正面开口绕塔朝向 S03。
  b.push(mouthFrame);
  const ribN = N(28, 12);
  const flushRib = (run) => {
    if (run.length < 2) return;
    const white = run.map((p) => [p.x, p.y, p.z]);
    const blue = run.map((p) => [p.x + p.nx * 0.78, p.y + p.ny * 0.78, p.z]);
    const seg = Math.max(4, run.length * 2);
    b.tube(white, 0.55, {}, 'shell', seg, 5);
    b.tube(blue, 0.1, {}, scarfMat, seg, 4);
  };
  for (let r = 0; r < RIBS; r++) {
    const z = ribZ(r);
    let run = [];
    for (let i = 0; i <= ribN; i++) {
      const f = archFrame(i / ribN, z);
      if (inTower(f.x, f.y, z)) { flushRib(run); run = []; continue; }
      run.push(f);
    }
    flushRib(run);
  }

  const su = N(32, 12);
  const shellV = [], shellI = [], glassV = [], glassI = [];
  const pushQuad = (verts, idx, A, B, C, D, flip) => {
    const i = verts.length / 3;
    verts.push(A.x, A.y, A.z, B.x, B.y, B.z, C.x, C.y, C.z, D.x, D.y, D.z);
    if (!flip) idx.push(i, i + 2, i + 1, i + 1, i + 2, i + 3);
    else idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
  };
  const sink = (f, k) => ({ x: f.x - f.nx * k, y: f.y - f.ny * k, z: f.z });
  const addSkin = (z0, z1, t0, t1, glass) => {
    const A = archFrame(t0, z0), B = archFrame(t1, z0);
    const C = archFrame(t0, z1), D = archFrame(t1, z1);
    const midX = (A.x + B.x + C.x + D.x) / 4;
    const midY = (A.y + B.y + C.y + D.y) / 4;
    const midZ = (z0 + z1) / 2;
    if (inTower(midX, midY, midZ)) return;
    if (glass) {
      pushQuad(glassV, glassI, sink(A, 0.42), sink(B, 0.42), sink(C, 0.42), sink(D, 0.42), false);
      return;
    }
    pushQuad(shellV, shellI, sink(A, 0.12), sink(B, 0.12), sink(C, 0.12), sink(D, 0.12), false);
    pushQuad(shellV, shellI, sink(A, 1.05), sink(B, 1.05), sink(C, 1.05), sink(D, 1.05), true);
  };
  for (let r = 0; r < RIBS - 1; r++) {
    const z0 = ribZ(r), z1 = ribZ(r + 1);
    for (let i = 0; i < su; i++) {
      const t0 = i / su, t1 = (i + 1) / su;
      const onRoof = t0 > 0.18 && t1 < 0.82;
      if (!onRoof) { addSkin(z0, z1, t0, t1, false); continue; }
      // 肋间中缝一条窄天窗，两侧白壳。
      const g0 = 0.42, g1 = 0.58;
      addSkin(z0, z0 + (z1 - z0) * g0, t0, t1, false);
      addSkin(z0 + (z1 - z0) * g0, z0 + (z1 - z0) * g1, t0, t1, true);
      addSkin(z0 + (z1 - z0) * g1, z1, t0, t1, false);
    }
  }
  const shellGeo = new THREE.BufferGeometry();
  shellGeo.setAttribute('position', new THREE.Float32BufferAttribute(shellV, 3));
  shellGeo.setIndex(shellI);
  shellGeo.computeVertexNormals();
  b.add(shellGeo, {}, 'shell');
  const glassGeo = new THREE.BufferGeometry();
  glassGeo.setAttribute('position', new THREE.Float32BufferAttribute(glassV, 3));
  glassGeo.setIndex(glassI);
  glassGeo.computeVertexNormals();
  b.add(glassGeo, {}, glassMat);

  // 背面山墙，把拱封上，厅内才有底。
  const gableN = N(16, 8);
  const gv = [], gi = [];
  for (let i = 0; i <= gableN; i++) {
    const p = archPoint(i / gableN, Z0 - 0.15);
    gv.push(p.x, 0.05, p.z, p.x, p.y, p.z);
  }
  for (let i = 0; i < gableN; i++) {
    const a = i * 2, bp = a + 1, c = a + 2, d = a + 3;
    gi.push(a, bp, c, bp, d, c);
  }
  const gable = new THREE.BufferGeometry();
  gable.setAttribute('position', new THREE.Float32BufferAttribute(gv, 3));
  gable.setIndex(gi);
  gable.computeVertexNormals();
  b.add(gable, {}, 'shell');

  const wallChunk = (x, z0, z1, outward) => {
    if (z1 - z0 < 0.4) return;
    const z = (z0 + z1) / 2, depth = z1 - z0;
    b.box(0.72, WALL, depth, { x, y: WALL / 2, z }, 'shell');
    b.box(0.1, 0.1, depth, { x: x + outward * 0.42, y: WALL - 0.08, z }, 'glowSoft');
  };
  const bayDoor = (x, z, outward, ajar) => {
    const w = 9.6, h = 7.2;
    b.box(2.6, h, w, { x: x - outward * 0.55, y: h / 2, z }, 'ink');
    const fx = x + outward * 0.5;
    b.box(0.2, 0.16, w + 0.8, { x: fx, y: h + 0.05, z }, 'glowSoft');
    b.box(0.2, h + 0.12, 0.16, { x: fx, y: h / 2, z: z - (w + 0.55) / 2 }, 'glowSoft');
    b.box(0.2, h + 0.12, 0.16, { x: fx, y: h / 2, z: z + (w + 0.55) / 2 }, 'glowSoft');
    b.box(0.12, h, 0.12, { x: fx + outward * 0.12, y: h / 2, z: z - w / 2 }, scarfMat);
    b.box(0.12, h, 0.12, { x: fx + outward * 0.12, y: h / 2, z: z + w / 2 }, scarfMat);
    const leafW = ajar ? w * 0.46 : w - 0.55;
    const leafZ = ajar ? z + w * 0.26 : z;
    b.box(0.22, h - 0.3, leafW, { x: x + outward * 0.72, y: (h - 0.15) / 2, z: leafZ }, 'shellCool');
    b.box(0.16, 0.1, leafW, { x: x + outward * 0.86, y: h * 0.62, z: leafZ }, 'shell');
  };
  const sideWall = (x, outward, doors) => {
    const cuts = doors.map((d) => [d.z - 5.15, d.z + 5.15]).sort((p, q) => p[0] - q[0]);
    let z = Z0;
    for (const [a, c] of cuts) {
      wallChunk(x, z, a, outward);
      z = Math.max(z, c);
    }
    wallChunk(x, z, Z1 - 11, outward);
    for (const d of doors) bayDoor(x, d.z, outward, d.ajar);
  };
  sideWall(SPAN, 1, [{ z: -2, ajar: true }, { z: -22, ajar: false }]);
  sideWall(-SPAN, -1, [{ z: -12, ajar: false }]);

  for (const s of [-1, 1]) {
    b.box(1.35, WALL, 1.2, { x: s * (SPAN - 0.2), y: WALL / 2, z: Z1 - 11 }, 'shell');
  }

  const nLip = N(22, 12);
  const lip = [], mouthGlow = [];
  for (let i = 0; i <= nLip; i++) {
    const t = 0.04 + 0.92 * (i / nLip);
    const f = archFrame(t, Z1 + 0.15);
    lip.push([f.x + f.nx * 0.15, f.y + f.ny * 0.15, f.z]);
    const u = 0.18 + 0.64 * (i / nLip);
    const g = archFrame(u, Z1 + 0.22);
    mouthGlow.push([g.x + g.nx * 1.05, g.y + g.ny * 1.05, g.z]);
  }
  b.tube(lip, 0.72, {}, 'shell', nLip, 6);
  b.tube(mouthGlow, 0.22, {}, bandMat, nLip, 5);

  // 塔肩两道鳍，根部落在拱面上。
  const fin = new THREE.Shape();
  fin.moveTo(0.8, 0);
  fin.bezierCurveTo(8.0, 1.0, 12.8, 7.8, 19.2, 18.2);
  fin.bezierCurveTo(17.0, 21.4, 12.8, 20.8, 11.5, 18.4);
  fin.bezierCurveTo(8.0, 10.2, 4.0, 3.5, -0.8, 1.1);
  fin.closePath();
  for (const s of [-1, 1]) {
    const fx = s * 16;
    const t = (fx + SPAN) / (SPAN * 2);
    const fy = WALL + CROWN * Math.sin(Math.max(0, Math.min(1, t)) * Math.PI);
    b.extrude(fin, 1.35, {
      x: fx, y: fy - 0.6, z: -12,
      ry: s > 0 ? 0.55 : Math.PI - 0.55,
    }, 'shell', 0.12, N(10, 5));
  }

  // ── 2. 厅内：青白顶灯 + 地面引导线。开口里只留 2 臂、2 架、1 车，方便从 S03 点清。
  b.box((SPAN - 1.2) * 2, 0.12, Z1 - Z0 - 1.6, { y: 0.06, z: (Z0 + Z1) / 2 - 0.3 }, 'floor');
  b.box(0.42, 0.05, 40, { y: 0.2, z: 4 }, 'glow');
  b.box(0.28, 0.045, 32, { x: -12, y: 0.2, z: 6 }, 'glow');
  b.box(0.28, 0.045, 32, { x: 12, y: 0.2, z: 6 }, 'glow');
  for (const x of [-18, -6, 6, 18]) b.box(5.2, 0.04, 0.28, { x, y: 0.2, z: Z1 - 6 }, 'glow');
  // 顶灯只留不晕光的青线。白发光条会在开口里铺开过曝，照度改由口内点光源承担。
  for (const z of [-16, -2]) {
    b.box(24, 0.22, 0.35, { y: 21.0, z }, 'glowSoft');
    b.box(24, 0.08, 0.16, { y: 20.7, z }, 'glow');
  }
  for (const z of [Z1 - 14, Z1 - 7]) {
    b.box(26, 0.28, 0.55, { y: 18.6, z }, 'glowSoft');
  }

  const arm = (x, z, yaw, a1, a2, s) => {
    b.push({ x, y: 0, z, ry: yaw });
    b.cyl(1.15 * s, 1.45 * s, 0.55 * s, { y: 0.28 * s }, 'shellCool', 12);
    b.cyl(0.5 * s, 0.62 * s, 0.5 * s, { y: 0.72 * s }, 'ceramic', 10);
    const sy = 1.05 * s, L1 = 4.4 * s, L2 = 3.5 * s;
    b.sphere(0.52 * s, { y: sy }, 'graphite', 10, 8);
    const ey = sy + Math.sin(a1) * L1, ez = Math.cos(a1) * L1;
    b.rbox(0.78 * s, 0.78 * s, L1, 0.18, {
      y: sy + Math.sin(a1) * L1 / 2, z: Math.cos(a1) * L1 / 2, rx: -a1,
    }, 'shell', 1);
    b.sphere(0.42 * s, { y: ey, z: ez }, 'graphite', 10, 8);
    const fy = ey + Math.sin(a2) * L2, fz = ez + Math.cos(a2) * L2;
    b.rbox(0.5 * s, 0.5 * s, L2, 0.12, {
      y: ey + Math.sin(a2) * L2 / 2, z: ez + Math.cos(a2) * L2 / 2, rx: -a2,
    }, 'ceramic', 1);
    b.sphere(0.26 * s, { y: fy, z: fz }, 'metal', 8, 6);
    b.box(1.15 * s, 0.16 * s, 0.5 * s, {
      y: fy + Math.sin(a2) * 0.32 * s, z: fz + Math.cos(a2) * 0.32 * s, rx: -a2,
    }, 'shell');
    b.sphere(0.1 * s, {
      y: fy + Math.sin(a2) * 0.62 * s, z: fz + Math.cos(a2) * 0.62 * s,
    }, 'glow', 8, 6);
    b.pop();
  };
  arm(-15, Z1 - 6.5, 1.05, 0.95, -0.55, 2.7);
  arm(14, Z1 - 8, -1.05, 0.9, -0.5, 2.6);

  const craft = (x, z, yaw, s) => {
    b.push({ x, y: 0.62 * s, z, ry: yaw });
    b.box(2.35 * s, 0.42 * s, 3.4 * s, { z: -0.55 * s }, 'ceramic');
    b.box(1.45 * s, 0.34 * s, 2.5 * s, { y: 0.05 * s, z: 1.55 * s }, 'ceramic');
    b.box(0.62 * s, 0.26 * s, 1.55 * s, { y: 0.06 * s, z: 3.15 * s }, 'shellCool');
    b.box(0.72 * s, 0.28 * s, 1.25 * s, { y: 0.36 * s, z: 1.15 * s }, 'graphite');
    b.box(0.08 * s, 1.35 * s, 0.85 * s, { y: 0.85 * s, z: -1.7 * s }, 'ceramic');
    for (const side of [-1, 1]) {
      const dx = side * 1.55 * s;
      b.add(new THREE.CylinderGeometry(0.58 * s, 0.58 * s, 1.15 * s, N(10, 6), 1, true), {
        x: dx, y: 0.08 * s, z: -0.35 * s, rx: Math.PI / 2,
      }, 'shell');
      b.add(new THREE.TorusGeometry(0.58 * s, 0.07 * s, 4, N(12, 8)), {
        x: dx, y: 0.08 * s, z: 0.22 * s,
      }, scarfMat);
    }
    for (const [wx, wz] of [[-0.75, -1.3], [0.75, -1.3], [0, 1.6]]) {
      b.box(0.12 * s, 0.38 * s, 0.12 * s, { x: wx * s, y: -0.32 * s, z: wz * s }, 'graphite');
    }
    b.pop();
  };
  craft(-11, Z1 - 3.6, 0.18, 3.45);
  craft(12, Z1 - 7.2, -0.16, 3.25);

  b.push({ x: -30, z: -6 });
  b.box(0.45, 8, 10, { y: 4.4 }, 'graphite');
  [2.4, 4.6, 6.8].forEach((y) => b.box(1.5, 0.16, 9.2, { x: 0.85, y }, 'metal'));
  for (let i = 0; i < N(6, 3); i++) {
    b.rbox(0.95, 0.7, 1.15, 0.08, {
      x: 1.25, y: 2.85 + (i % 3) * 2.15, z: -3.2 + (i % 3) * 3.1,
    }, i % 2 ? 'ceramic' : 'shellCool', 1);
  }
  b.pop();

  for (const x of [-16, 16]) {
    b.box(6.2, 3.4, 0.16, { x, y: 6.2, z: Z0 + 1.6 }, 'graphite');
    b.box(5.4, 2.7, 0.08, { x, y: 6.2, z: Z0 + 1.75 }, 'glowSoft');
  }
  [-17.4, -16, -14.6, 14.6, 16, 17.4].forEach((x, i) => {
    b.box(1.05, 0.08, 0.05, { x, y: 5.4 + (i % 3) * 0.48, z: Z0 + 1.82 }, 'glow');
  });
  b.add(new THREE.TorusGeometry(3.6, 0.12, 6, N(40, 20)), { y: 6.4, z: 2.5 }, 'glow');
  b.add(new THREE.TorusGeometry(3.6, 0.08, 5, N(28, 16)), { y: 6.4, z: 2.5, rx: 1.15 }, 'glow');
  b.add(new THREE.TorusGeometry(2.6, 0.07, 5, N(24, 14)), { y: 6.4, z: 2.5, rx: Math.PI / 2, ry: 0.6 }, 'glowSoft');

  b.pop();

  // ── 3. 指挥塔。露出拱顶的塔身 3 道青环；顶部扁宽茶青玻璃飞碟，上下两圈青灯带。
  b.push({ z: TZ, sy: TY });
  b.lathe([
    [11.2, 0], [9.4, 1.5], [8.2, 4.2], [7.7, 14], [7.8, 26], [8.8, 33.5],
  ], {}, 'shell', seg);
  b.lathe([
    [8.0, 0], [12.2, 1.5], [16.4, 3.2], [18.2, 4.3],
  ], { y: 17.6 }, 'shell', seg);
  b.torus(9.6, 0.55, { y: 20.4 }, 'shellCool', 8, N(40, 20));
  b.box(0.55, 16, 0.28, { x: 2.8, y: 20, z: 7.7 }, bandMat);
  b.box(0.55, 16, 0.28, { x: -2.8, y: 20, z: 7.7 }, bandMat);
  b.torus(8.05, 0.62, { y: 23.0 }, 'ink', 6, N(40, 20));
  b.torus(8.78, 0.4, { y: 23.0 }, bandMat, 8, N(48, 24));
  b.torus(8.15, 0.62, { y: 27.2 }, 'ink', 6, N(40, 20));
  b.torus(8.92, 0.4, { y: 27.2 }, bandMat, 8, N(48, 24));
  b.torus(8.55, 0.66, { y: 31.0 }, 'ink', 6, N(40, 20));
  b.torus(9.38, 0.42, { y: 31.0 }, bandMat, 8, N(48, 24));

  b.lathe([
    [8.8, 0], [11.2, 0.55], [17.4, 1.2], [24.2, 1.85], [27.6, 2.4],
  ], { y: 33.2 }, 'shell', N(56, 28));
  b.torus(26.6, 0.5, { y: 35.5 }, 'ink', 6, N(48, 24));
  b.torus(28.45, 0.62, { y: 35.95 }, bandMat, 8, N(64, 32));
  b.torus(27.15, 0.36, { y: 36.15 }, 'shell', 6, N(48, 24));
  b.add(new THREE.CylinderGeometry(23.2, 27.0, 5.2, N(64, 32), 1, true), { y: 38.85 }, glassMat);
  b.radial(N(18, 10), 0, (bb) => {
    bb.box(0.22, 5.15, 0.36, { z: 25.4, y: 38.85, rx: -0.48 }, 'shell');
  });
  b.torus(23.5, 0.36, { y: 41.3 }, 'ink', 6, N(48, 24));
  b.torus(25.55, 0.5, { y: 41.75 }, bandMat, 8, N(64, 32));
  b.lathe([
    [16.5, 0], [22.6, 0.4], [23.4, 0.85], [16.8, 1.5], [8.4, 2.2], [2.8, 2.85], [1.45, 3.35],
  ], { y: 41.25 }, 'shell', N(56, 28));

  b.cyl(1.15, 1.45, 0.55, { y: 44.7 }, 'graphite', 12);
  b.cyl(0.18, 0.28, 10.4, { y: 50.2 }, 'metal', 8);
  b.sphere(0.42, { y: MAST_Y }, 'glow', 10, 8);
  b.radial(5, 1.35, (bb, i) => {
    const h = 3.4 + (i % 3) * 2.1;
    bb.cyl(0.07, 0.12, h, { y: h / 2 }, 'metal', 6);
    bb.sphere(0.14, { y: h + 0.04 }, 'glow', 8, 6);
  }, { y: 45.1, phase: 0.2 });
  b.radial(N(8, 5), 4.6, (bb, i) => {
    const h = 2.2 + (i % 4) * 1.55;
    bb.cyl(0.08, 0.13, h, { y: h / 2 }, 'metal', 6);
    bb.sphere(0.15, { y: h + 0.05 }, 'glow', 8, 6);
  }, { y: 44.9, phase: 0.55 });
  b.push({ x: 5.4, y: 46.1, rx: -0.62, ry: 0.5 });
  b.cyl(0.14, 0.28, 0.65, {}, 'metal', 8);
  b.lathe([[0.12, 0], [0.85, 0.18], [1.65, 0.55], [1.8, 0.7]], { y: 0.4 }, 'metal', N(14, 8));
  b.pop();
  b.push({ x: -4.6, y: 45.6, rx: -0.4, ry: -0.8 });
  b.cyl(0.1, 0.18, 0.5, {}, 'metal', 6);
  b.lathe([[0.1, 0], [0.55, 0.12], [0.95, 0.32]], { y: 0.28 }, 'metal', N(10, 6));
  b.pop();
  b.pop();

  // ── 4. 停机坪：从转到机位的机库口铺到包络内沿。顶点停在 54，给肋管留边。
  {
    const xL = -SPAN + 2.4, xR = SPAN - 2.4, steps = 18;
    const pos = [], idx = [];
    const rim = (a) => {
      const dx = Math.sin(a), dz = Math.cos(a);
      const t = 54 / Math.max(Math.abs(dx), Math.abs(dz), 1e-4);
      return [dx * t, dz * t];
    };
    for (let i = 0; i < steps; i++) {
      const u0 = i / steps, u1 = (i + 1) / steps;
      const a0 = YAW - 1.2 + 2.4 * u0, a1 = YAW - 1.2 + 2.4 * u1;
      const i0 = yawAround(xL + (xR - xL) * u0, Z1 - 0.2);
      const i1 = yawAround(xL + (xR - xL) * u1, Z1 - 0.2);
      const o0 = rim(a0), o1 = rim(a1);
      const y = 0.16;
      const v = pos.length / 3;
      pos.push(i0[0], y, i0[1], i1[0], y, i1[1], o0[0], y, o0[1], o1[0], y, o1[1]);
      idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
    }
    const apronGeo = new THREE.BufferGeometry();
    apronGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    apronGeo.setIndex(idx);
    apronGeo.computeVertexNormals();
    b.add(apronGeo, {}, 'paving');
  }
  b.box(0.9, 0.05, 26, { y: 0.24, z: 40 }, 'glow');
  for (const x of [-36.3, -31.7]) b.box(0.55, 0.04, 24, { x, y: 0.24, z: 42 }, 'glow');
  for (const x of [23.7, 28.3]) b.box(0.55, 0.04, 24, { x, y: 0.24, z: 42 }, 'glow');

  const ringX = 6, ringZ = 42, ringR = 12.6;
  b.cyl(ringR * 0.96, ringR * 0.96, 0.06, { x: ringX, y: 0.2, z: ringZ }, 'shellCool', N(48, 24));
  b.add(new THREE.CylinderGeometry(ringR, ringR, 1.55, N(56, 28), 1, true), {
    x: ringX, y: 0.95, z: ringZ,
  }, bandMat);
  b.torus(ringR, 0.26, { x: ringX, y: 1.72, z: ringZ }, bandMat, 6, N(48, 24));
  b.torus(ringR * 0.62, 0.14, { x: ringX, y: 0.28, z: ringZ }, bandMat, 4, N(40, 20));
  craft(ringX - 4.6, ringZ - 0.6, 0.55, 2.4);
  craft(ringX + 4.8, ringZ + 1.8, -0.7, 2.15);

  const pads = [
    { x: -30, z: 36, r: 4.4 },
    { x: 34, z: 34, r: 4.6 },
    { x: -26, z: 50, r: 4.0 },
    { x: 30, z: 52, r: 4.2 },
  ];
  for (const p of pads) {
    b.cyl(p.r, p.r, 0.08, { x: p.x, y: 0.12, z: p.z }, 'shellCool', N(28, 14));
    b.torus(p.r * 0.92, 0.11, { x: p.x, y: 0.2, z: p.z }, 'glow', 5, N(40, 20));
    b.torus(p.r * 0.48, 0.06, { x: p.x, y: 0.22, z: p.z }, 'glowSoft', 4, N(28, 16));
  }

  const car = (x, z, ry, s = 1) => {
    b.push({ x, y: 1.34 * s, z, ry, sx: 1.5 * s, sy: 1.5 * s, sz: 1.5 * s });
    b.rbox(2.05, 1.15, 4.4, 0.28, { y: 0.08 }, 'ceramic', 1);
    b.rbox(1.85, 0.85, 2.15, 0.2, { y: 0.78, z: -0.15 }, 'ceramic', 1);
    b.box(1.55, 0.4, 0.05, { y: 0.9, z: 0.52 }, 'graphite');
    b.box(1.2, 0.1, 1.85, { y: 1.26, z: -0.1 }, bandMat);
    for (const sx of [-1, 1]) for (const sz of [-1.35, 1.25]) {
      b.cyl(0.32, 0.32, 0.22, { x: sx * 0.95, y: -0.48, z: sz, rz: Math.PI / 2 }, 'graphite', 8);
    }
    b.pop();
  };
  b.push(mouthFrame);
  car(0.6, Z1 - 2.4, 0.22, 2.25);
  b.pop();
  car(-6, 52.2, 0.35);
  car(12, 52.4, -0.2);
  car(32, 51.2, 0.15);

  const flag = (x, z, ry) => {
    b.push({ x, y: 0, z, ry });
    b.cyl(0.16, 0.22, 16.2, { y: 8.1 }, 'metal', 8);
    b.sphere(0.3, { y: 16.4 }, 'glow', 8, 6);
    b.box(2.5, 11.6, 0.08, { x: 1.4, y: 9.5 }, scarfMat);
    b.box(0.2, 9.4, 0.1, { x: 1.15, y: 9.6 }, 'shell');
    b.pop();
  };
  flag(-32, 44, YAW + 0.4);
  flag(26, 52, YAW - 0.15);

  // ── 5. 机库口右侧熊猫。结构同 network.js 广场熊猫：哑光近黑，眼斑外沿上扬，大黑瞳 + 小白高光，不发光。
  // 局部 +Z 是脸；ry 朝 S03 机位 [60, 26, 110]。本体高 12m，脚直接落在机坪上，不垫圆台。
  const px = 46.9, pz = 35.7;
  const pandaYaw = Math.atan2(60 - px, 110 - pz);
  const pandaBlack = new THREE.MeshBasicMaterial({ color: 0x080c14, toneMapped: false, fog: false });
  pandaBlack.name = 'hub:panda:black';
  const pandaScaleY = 12 / (10.75 - 0.76);
  b.push({ x: px, y: 0.5 - 0.76 * pandaScaleY, z: pz, ry: pandaYaw, sx: 1.5, sy: pandaScaleY, sz: 1.3 });
  b.sphere(2.9, { y: 3.8, sx: 0.95, sy: 1.05, sz: 0.8 }, pandaBlack, N(24, 16), N(14, 10));
  b.sphere(1.85, { y: 3.7, z: 1.15, sx: 1.15, sy: 0.95, sz: 0.38 }, pandaWhite, N(24, 16), N(14, 10));
  b.sphere(3.1, { y: 7.5, sx: 1.12, sy: 0.92, sz: 0.85 }, pandaWhite, N(32, 20), N(18, 12));
  for (const s of [-1, 1]) {
    b.sphere(1.05, { x: s * 2.5, y: 9.7, z: -0.25 }, pandaBlack, 20, 12);
    b.sphere(1.1, { x: s * 2.85, y: 3.45, z: 0.7, sx: 0.75, sy: 1.55, rz: s * 0.38 }, pandaBlack, 20, 12);
    b.sphere(1.25, { x: s * 1.45, y: 1.25, z: 1.95, sy: 1.05, sz: 1.15 }, pandaBlack, 20, 12);
    b.sphere(1, { x: s * 1.35, y: 7.45, z: 2.23, sx: 0.8, sy: 1.1, sz: 0.23, rz: -s * 0.62 }, pandaBlack, 24, 14);
    b.sphere(0.4, { x: s * 1.22, y: 7.56, z: 2.55 }, pandaBlack, 16, 10);
    b.sphere(0.07, { x: s * 1.05, y: 7.74, z: 2.88 }, 'shell', 8, 6);
  }
  b.sphere(0.35, { y: 6.85, z: 2.63, sx: 1.25, sy: 0.65, sz: 0.6 }, pandaBlack, 16, 10);
  b.torus(2.15, 0.43, { y: 5.65, sx: 1.1, sz: 0.9 }, scarfMat, 8, N(48, 24));
  b.rbox(0.9, 2.6, 0.32, 0.14, { x: 1.3, y: 4.7, z: 2.4, rz: 0.24 }, scarfMat);
  b.pop();

  const crown = archPoint(0.5, Z1);
  const [hx, hz] = yawAround(0, Z1 + 0.6);
  b.push({ x: hx, y: 0, z: hz, ry: YAW });
  b.box(12.5, 1.35, 0.2, { y: crown.y - 1.7 }, 'graphite');
  b.box(12.5, 0.08, 0.08, { y: crown.y - 1.05, z: 0.16 }, scarfMat);
  b.pop();
  const sign = kit.textPanel('AGENT HUB', { height: 1.05 });
  sign.position.set(hx + Math.sin(YAW) * 0.22, crown.y - 1.7, hz + Math.cos(YAW) * 0.22);
  sign.rotation.y = YAW;
  root.add(sign);

  // ── 6. 机坪外沿花树与灌木（flora.js，枝干并进 shellCool，树冠灌木合批）。
  const treePoints = [
    { x: -50, y: 0, z: 32, scale: 0.72, height: 5.4 },
    { x: -48, y: 0, z: 44, scale: 0.68, height: 5.2 },
    { x: -34, y: 0, z: 50, scale: 0.6, height: 4.8 },
    { x: 34, y: 0, z: 50, scale: 0.6, height: 4.8 },
    { x: 22, y: 0, z: 54, scale: 0.62, height: 4.6 },
    { x: 54, y: 0, z: 22, scale: 0.58, height: 4.4 },
    { x: -52, y: 0, z: 30, scale: 0.58, height: 4.8 },
    { x: 36, y: 0, z: 28, scale: 0.58, height: 4.8 },
  ];
  const shrubPoints = [];
  for (let i = 0; i < 16; i++) {
    const a = -1.05 + 2.1 * i / 15;
    const x = Math.sin(a) * 50;
    const z = 22 + Math.cos(a) * 30;
    if (z < 28 || z > 52 || Math.abs(x) > 52) continue;
    if (x > 42 && z < 42) continue;
    if (Math.hypot(x - 46.9, z - 35.7) < 9) continue;
    shrubPoints.push({ x, y: 0, z, scale: 0.66 });
  }
  const flowers = blossomTrees(ctx, treePoints, { seed: 41, name: 'hub:flora' });
  const greens = shrubs(ctx, shrubPoints, { seed: 73, name: 'hub:shrubs' });
  const leafGeos = [], leafColors = [];
  const floraMatrix = new THREE.Matrix4(), floraColor = new THREE.Color();
  for (const source of [flowers, greens]) source.traverse((mesh) => {
    if (!mesh.isInstancedMesh) return;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, floraMatrix);
      const geo = mesh.geometry.clone().applyMatrix4(floraMatrix);
      if (!mesh.instanceColor) { b.add(geo, {}, 'shellCool'); continue; }
      const flat = geo.index ? geo.toNonIndexed() : geo;
      if (flat !== geo) geo.dispose();
      mesh.getColorAt(i, floraColor);
      const colors = new Float32Array(flat.attributes.position.count * 3);
      for (let j = 0; j < colors.length; j += 3) floraColor.toArray(colors, j);
      leafGeos.push(flat);
      leafColors.push(colors);
    }
  });
  const floraParts = leafGeos.map((g) => (g.index ? g.toNonIndexed() : g));
  let floraN = 0;
  floraParts.forEach((g) => { floraN += g.attributes.position.count; });
  const floraPos = new Float32Array(floraN * 3), floraNor = new Float32Array(floraN * 3);
  let floraCursor = 0;
  for (const g of floraParts) {
    floraPos.set(g.attributes.position.array, floraCursor);
    if (g.attributes.normal) floraNor.set(g.attributes.normal.array, floraCursor);
    floraCursor += g.attributes.position.count * 3;
  }
  const floraGeo = new THREE.BufferGeometry();
  floraGeo.setAttribute('position', new THREE.BufferAttribute(floraPos, 3));
  floraGeo.setAttribute('normal', new THREE.BufferAttribute(floraNor, 3));
  const floraColors = new Float32Array(floraGeo.attributes.position.count * 3);
  let floraOffset = 0;
  for (const colors of leafColors) {
    floraColors.set(colors, floraOffset);
    floraOffset += colors.length;
  }
  floraGeo.setAttribute('color', new THREE.BufferAttribute(floraColors, 3));
  floraParts.forEach((g) => g.dispose());
  leafGeos.forEach((g) => { if (!floraParts.includes(g)) g.dispose(); });
  const floraMat = flowers.material;
  floraMat.vertexColors = true;
  const floraMesh = new THREE.Mesh(floraGeo, floraMat);
  floraMesh.name = 'hub:flora';
  floraMesh.castShadow = floraMesh.receiveShadow = true;
  for (const source of [flowers, greens]) source.traverse((mesh) => {
    mesh.geometry?.dispose();
    if (mesh.material && mesh.material !== floraMat) mesh.material.dispose();
  });
  root.userData.flora = { source: 'src/kit/flora.js', trees: treePoints.length, shrubs: shrubPoints.length };

  const body = b.build('hub');
  body.traverse((o) => {
    if (!o.isMesh) return;
    if (o.material === glassMat || o.material === scarfMat) {
      o.castShadow = false;
      o.renderOrder = 2;
    }
  });
  root.add(body);
  root.add(floraMesh);
  // 口内两盏冷白点光，只抬一档机体明暗，距离收在厅内，不打到机坪熊猫。
  for (const spec of [
    { x: 0, y: 8.2, z: Z1 - 5.5, intensity: 280, distance: 32 },
    { x: -8, y: 9.4, z: 2, intensity: 220, distance: 36 },
    { x: 6, y: 11.5, z: -18, intensity: 170, distance: 30 },
  ]) {
    const p = new THREE.Vector3(spec.x, spec.y, spec.z).applyMatrix4(mouthFrame);
    const lamp = new THREE.PointLight(0xd7f4ff, spec.intensity, spec.distance, 2);
    lamp.position.copy(p);
    lamp.castShadow = false;
    lamp.name = 'hub:bay-light';
    root.add(lamp);
  }

  // ── 7. 人、无人机。人是同一套胶囊人形，InstancedMesh 合批。
  const bodyGeo = new THREE.CapsuleGeometry(0.28, 1.15, 2, 6);
  bodyGeo.translate(0, 0.86, 0);
  const headGeo = new THREE.SphereGeometry(0.2, 6, 5);
  headGeo.translate(0, 1.62, 0);
  const personBits = [bodyGeo, headGeo].map((g) => (g.index ? g.toNonIndexed() : g));
  let pn = 0;
  personBits.forEach((g) => { pn += g.attributes.position.count; });
  const pPos = new Float32Array(pn * 3), pNor = new Float32Array(pn * 3);
  let pCursor = 0;
  for (const g of personBits) {
    if (!g.attributes.normal) g.computeVertexNormals();
    pPos.set(g.attributes.position.array, pCursor);
    pNor.set(g.attributes.normal.array, pCursor);
    pCursor += g.attributes.position.count * 3;
    g.dispose();
  }
  const person = new THREE.BufferGeometry();
  person.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  person.setAttribute('normal', new THREE.BufferAttribute(pNor, 3));

  // 站在 S03 看得到的机坪上：开口前方，避开旗杆正后方和熊猫落点。30 人。
  const folks = [
    [-0.5, 52.6], [3.8, 52.6], [16.7, 52.6], [20.9, 52.6], [25.2, 52.6], [38.1, 52.6],
    [27.4, 51.3], [40.3, 51.3], [-1.2, 49.9], [3.1, 49.9], [7.4, 49.9], [16, 49.9],
    [20.3, 49.9], [37.4, 49.9], [40.3, 48.6], [-0.5, 47.2], [3.8, 47.2], [8.1, 47.2],
    [12.4, 47.2], [16.7, 47.2], [20.9, 47.2], [36, 47.2], [31, 45.9], [39.6, 45.9],
    [5.9, 44.5], [14.5, 44.5], [18.8, 44.5], [33.8, 44.5], [36, 43.2], [40.3, 43.2],
  ];
  const folkM = folks.map(([x, z], i) => kit.toMatrix({
    x, y: 0.2, z, ry: (i * 0.9) % 6.2,
    sx: 1.7 + (i % 5) * 0.05, sy: 1.95 + (i % 4) * 0.07, sz: 1.7 + (i % 3) * 0.04,
  }));
  root.add(kit.instanced(person, mats.graphite, folkM, 'hub-people'));

  const soloGeo = (fn) => {
    const bb = new kit.Builder(mats);
    fn(bb);
    const g = bb.build('solo');
    if (g.children.length !== 1) throw new Error(`soloGeo 材质数 ${g.children.length}`);
    const geo = g.children[0].geometry;
    g.children[0].geometry = null;
    return geo;
  };
  const droneGeo = soloGeo((bb) => {
    bb.sphere(0.55, { sy: 0.35 }, 'ceramic', 10, 8);
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + Math.PI / 4;
      const x = Math.cos(a) * 1.55, z = Math.sin(a) * 1.55;
      bb.box(1.7, 0.07, 0.1, { x: Math.cos(a) * 0.85, z: Math.sin(a) * 0.85, ry: -a }, 'ceramic');
      bb.add(new THREE.TorusGeometry(0.42, 0.045, 4, 10), { x, y: 0.14, z, rx: Math.PI / 2 }, 'ceramic');
    }
  });
  const whiteDrones = [
    { x: -36, z: 46, base: 32, phase: 0.4 },
    { x: 46, z: 44, base: 30, phase: 1.5 },
  ];
  const droneMesh = kit.instanced(droneGeo, mats.ceramic, whiteDrones.map((d) => kit.toMatrix({
    x: d.x, y: d.base, z: d.z, sx: 2.45, sy: 2.45, sz: 2.45,
  })), 'hub-drones');
  droneMesh.frustumCulled = false;
  root.add(droneMesh);

  const pandaDrone = new kit.Builder(mats);
  pandaDrone.sphere(0.85, { sy: 0.92 }, 'ceramic', N(14, 10), N(10, 8));
  pandaDrone.sphere(0.36, { x: -0.55, y: 0.72 }, 'ink', 8, 6);
  pandaDrone.sphere(0.36, { x: 0.55, y: 0.72 }, 'ink', 8, 6);
  pandaDrone.sphere(0.24, { x: -0.28, y: 0.08, z: 0.62, sz: 0.4 }, 'ink', 8, 6);
  pandaDrone.sphere(0.24, { x: 0.28, y: 0.08, z: 0.62, sz: 0.4 }, 'ink', 8, 6);
  pandaDrone.sphere(0.12, { x: -0.28, y: 0.1, z: 0.78 }, scarfMat, 6, 5);
  pandaDrone.sphere(0.12, { x: 0.28, y: 0.1, z: 0.78 }, scarfMat, 6, 5);
  pandaDrone.torus(0.62, 0.14, { y: -0.55 }, scarfMat, 5, 14);
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2 + Math.PI / 4;
    const x = Math.cos(a) * 1.85, z = Math.sin(a) * 1.85;
    pandaDrone.box(2.05, 0.08, 0.12, { x: Math.cos(a) * 1.05, z: Math.sin(a) * 1.05, ry: -a }, 'ceramic');
    pandaDrone.add(new THREE.TorusGeometry(0.5, 0.045, 4, 10), { x, y: 0.18, z, rx: Math.PI / 2 }, 'ceramic');
  }
  const pandaHome = { x: -8, z: 50, y: 33 };
  const pandaShip = pandaDrone.build('hub-panda-drone');
  pandaShip.scale.set(1.75, 1.75, 1.75);
  pandaShip.position.set(pandaHome.x, pandaHome.y, pandaHome.z);
  pandaShip.rotation.y = YAW;
  pandaShip.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
  root.add(pandaShip);

  const beamMat = new THREE.MeshStandardMaterial({
    color: 0x021820, emissive: 0x5fe8ff, emissiveIntensity: 1.85,
    transparent: true, opacity: 0.58, depthWrite: false, roughness: 1, metalness: 0, side: THREE.DoubleSide,
  });
  beamMat.name = 'hub:beam';
  const beamGeo = new THREE.CylinderGeometry(0.12, 0.42, 1, N(8, 6), 1, true);
  const beamCount = whiteDrones.length + 2;
  const beamMesh = kit.instanced(beamGeo, beamMat, Array.from({ length: beamCount }, () => kit.toMatrix({ y: 4, sy: 8 })), 'hub-beams');
  beamMesh.castShadow = beamMesh.receiveShadow = false;
  beamMesh.frustumCulled = false;
  root.add(beamMesh);

  const tmp = new THREE.Object3D();
  const pose = (mesh, i, x, y, z, ry, sx = 1, sy = 1, sz = 1) => {
    tmp.position.set(x, y, z);
    tmp.rotation.set(0, ry, 0);
    tmp.scale.set(sx, sy, sz);
    tmp.updateMatrix();
    mesh.setMatrixAt(i, tmp.matrix);
  };
  const layout = (t) => {
    whiteDrones.forEach((d, i) => {
      let y = d.base, x = d.x, z = d.z;
      if (!reducedMotion) {
        y = d.base + Math.sin(t * 0.75 + d.phase) * 0.7;
        x += Math.sin(t * 0.22 + d.phase) * 1.2;
        z += Math.cos(t * 0.18 + d.phase) * 0.9;
      }
      pose(droneMesh, i, x, y, z, t * 0.12 + i, 2.45, 2.45, 2.45);
      const h = Math.max(0.4, y - 0.8);
      pose(beamMesh, i, x, h / 2 + 0.15, z, 0, 1.05, h, 1.05);
    });
    const py = pandaHome.y + (reducedMotion ? 0 : Math.sin(t * 0.55 + 1.4) * 0.7);
    const drift = reducedMotion ? 0 : Math.sin(t * 0.2) * 1.3;
    pandaShip.position.set(pandaHome.x + drift, py, pandaHome.z);
    if (!reducedMotion) pandaShip.rotation.y = YAW + Math.sin(t * 0.15) * 0.3;
    const ph = Math.max(0.4, py - 0.9);
    pose(beamMesh, whiteDrones.length, pandaShip.position.x, ph / 2 + 0.15, pandaShip.position.z, 0, 1.1, ph, 1.1);
    const upH = 16;
    const mastWorldY = MAST_Y * TY;
    pose(beamMesh, whiteDrones.length + 1, 0, mastWorldY + upH / 2, TZ, 0, 0.55, upH, 0.55);
    droneMesh.instanceMatrix.needsUpdate = true;
    beamMesh.instanceMatrix.needsUpdate = true;
  };
  layout(0.6);

  // ── 8. 热点：id 与数量保持契约。
  const hot = [];
  const addHot = (id, w, h, d, t, label, anchor) => {
    const m = kit.hotspot(id, w, h, d, t);
    m.userData.label = label;
    if (anchor) m.userData.anchor = new THREE.Vector3(...anchor);
    hot.push(m);
    root.add(m);
  };
  const spun = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(mouthFrame);
  const createAt = spun(0, 7, 8), flowAt = spun(0, 8, 2.5), toolAt = spun(-30, 5, -6);
  addHot('hub', 100, 76, 100, { y: 34, z: 2 }, '智能体管理中心');
  addHot('hub:agents', 44, 20, 28, { y: 8, z: 36 }, '我的 Agent', [4, 6, 36]);
  addHot('hub:create', 36, 16, 20, { x: createAt.x, y: createAt.y, z: createAt.z }, '创建与配置', [createAt.x, 6, createAt.z]);
  addHot('hub:workflows', 16, 12, 14, { x: flowAt.x, y: flowAt.y, z: flowAt.z }, '工作流与自动化', [flowAt.x, 7.2, flowAt.z]);
  addHot('hub:tools', 12, 12, 14, { x: toolAt.x, y: toolAt.y, z: toolAt.z }, '工具与技能', [toolAt.x, 5, toolAt.z]);
  addHot('hub:runs', 56, 16, 56, { y: 38.85 * TY, z: TZ }, '运行与记录', [0, 38.85 * TY, TZ]);

  return {
    group: root,
    hotspots: hot,
    bounds: new THREE.Box3().setFromObject(root),
    update(t) { if (!reducedMotion) layout(t); },
    dispose() { kit.disposeTree(root); },
  };
}
