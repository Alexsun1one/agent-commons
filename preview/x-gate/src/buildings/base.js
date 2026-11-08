// 中央总部 X-GATE BASE · 外观。全城标杆：其它四栋以它为风格样板。
// 建筑 DNA：大型中央入口 + 中央垂直塔 + 横向展开的阶梯式主体 + 环形轨道 + 浮空小岛。
// 门朝 +Z；地面 y=0（岛顶 -0.05 由 ENV 承托）；台基顶 GY=4 即门槛与大厅地面。
import { build as buildHall, beamMatrix, offsetPoly, lathePro } from './base-interior.js';
import { PORTAL } from '../kit/world.js';

export const meta = { id: 'base', name: '中央总部', en: 'X-GATE BASE' };

const GY = 4;            // 台基顶 = 门槛 = 大厅地面
const TZ = -16;          // 中央塔轴线
const FZ = PORTAL.z;     // 外立面 z=48

export function build(ctx) {
  const { THREE, kit, quality, reducedMotion } = ctx;
  const hi = quality !== 'low';
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  // 本楼大面积白壳用局部变体：共享 shell/shellCool 在 IBL 下镜面峰值 >2.2，会触发泛光、整片门楣发白。
  const matte = (src, name) => { const m = src.clone(); m.name = name; m.roughness = 0.55; m.clearcoat = 0.15; m.clearcoatRoughness = 0.5; m.metalness = 0.12; m.userData.shared = true; return m; };
  const shellLocal = [matte(ctx.mats.shell, 'base:shell'), matte(ctx.mats.shellCool, 'base:shellCool')];
  const mats = { ...ctx.mats, shell: shellLocal[0], shellCool: shellLocal[1] };
  const root = new THREE.Group(); root.name = 'base';
  const b = new kit.Builder(mats);
  const hot = [];
  const ticks = [];                       // 每帧更新函数
  const postM = [];                       // 栏杆柱（实例化）
  const SEG = hi ? 96 : 48;

  // ───────── 本楼自带材质（共 7 个 draw call；dispose 时统一释放）─────────
  const own = [];
  const mine = (m, name) => { m.name = name; m.userData.shared = true; own.push(m); return m; };
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const cobalt = mine(std({ color: 0x2d5bff, roughness: 0.55, metalness: 0.1, emissive: 0x2d5bff, emissiveIntensity: 0.22, side: THREE.DoubleSide }), 'base:cobalt');
  const leaf = mine(std({ color: 0x4fbf8c, roughness: 0.85 }), 'base:leaf');
  const bloom = mine(std({ color: 0xb9a6ff, roughness: 0.85, emissive: 0x6a58e0, emissiveIntensity: 0.2 }), 'base:bloom');
  // 竖向玻璃幕：下亮上暗的青色内光（emissiveMap 竖向渐变，盒面 UV v=0 在底）
  const gradTex = (() => {
    const n = 64, d = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) { const v = Math.round(255 * (0.4 + 0.6 * (1 - i / (n - 1)))); d.set([Math.round(v * 0.28), Math.round(v * 0.88), v, 255], i * 4); }
    const t = new THREE.DataTexture(d, 1, n); t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true; return t;
  })();
  const glassLit = mine(std({ color: 0x0f4a80, metalness: 0.35, roughness: 0.22, emissive: 0xffffff, emissiveMap: gradTex, emissiveIntensity: 0.95, envMapIntensity: 0.6 }), 'base:glassLit');
  const people = mine(std({ color: 0xffffff, roughness: 0.6, emissive: 0x9fdfff, emissiveIntensity: 0.22 }), 'base:people');
  const winMat = mine(new THREE.MeshBasicMaterial({ color: 0x6fdcff }), 'base:windows');
  // 更亮的青色轨道环（自带发光，过泛光阈值 2.2 才晕光）与 X 交点外晕
  const orbitCyan = mine(std({ color: 0x0a2a3c, roughness: 0.4, emissive: 0x39ecff, emissiveIntensity: 4.6 }), 'base:orbitCyan');
  const xHalo = hi ? mine(new THREE.MeshBasicMaterial({ color: 0x4feaff, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), 'base:xHalo') : null;
  // 全息熊猫皮肤：菲涅尔边光 + 慢扫描线，深/浅两层
  const uT = { value: 0 };
  const holoSkin = (name, base, rim, a0, a1) => mine(new THREE.ShaderMaterial({
    uniforms: { uT, a0: { value: a0 }, a1: { value: a1 }, cBase: { value: new THREE.Color(base) }, cRim: { value: new THREE.Color(rim) } },
    toneMapped: false,
    vertexShader: `varying vec3 vN; varying vec3 vV; varying float vY;
      void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = cameraPosition - wp.xyz; vY = wp.y; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform float uT, a0, a1; uniform vec3 cBase, cRim; varying vec3 vN; varying vec3 vV; varying float vY;
      void main(){
        vec3 N = normalize(vN), V = normalize(vV);
        float f = pow(1.0 - abs(dot(N, V)), 2.2);
        float sh = 0.7 + 0.3 * dot(N, normalize(vec3(0.35, 0.8, 0.5)));
        float scan = 0.94 + 0.06 * sin(vY * 3.2 - uT * 2.0);
        gl_FragColor = vec4(cBase * sh * scan + cRim * f * a1, 1.0);
      }`,
  }), name);
  const pandaLight = holoSkin('base:pandaHoloLight', 0xf4fbff, 0x5fe8ff, 0, 0.7);
  const pandaDark = holoSkin('base:pandaHoloDark', 0x0a1432, 0x3fb8ff, 0, 0.5);

  // 沿 XY 样条放样的圆角倒角截面实体（X 门拱臂与饰带用）：C 为 Vector2 中线，wf/df 给截面面内宽/进深，zc 为中心 z，r 为倒角半径。
  // 法线按截面解析给出：平面保持平，倒角处平滑过渡。
  const loft = (C, wf, df, zc, { r = 2, K = 5 } = {}) => {
    const n = C.length, P = [], N = [], I = [], tan = [], prof = [];
    const rr = (u) => Math.min(r, wf(u) / 2 - 0.01, df(u) / 2 - 0.01);
    for (let c = 0; c < 4; c++) for (let k = 0; k <= K; k++) { const th = (c + k / K) * Math.PI / 2; prof.push([Math.cos(th), Math.sin(th), c]); }
    const M = prof.length;
    for (let i = 0; i < n; i++) {
      const a = C[Math.max(0, i - 1)], d = C[Math.min(n - 1, i + 1)];
      let tx = d.x - a.x, ty = d.y - a.y; const m = Math.hypot(tx, ty) || 1; tx /= m; ty /= m; tan.push([tx, ty]);
      const u = i / (n - 1), hw = wf(u) / 2, hd = df(u) / 2, q = rr(u);
      for (const [co, si, c] of prof) {
        const sx = (c === 0 || c === 3) ? 1 : -1, sz = (c <= 1) ? 1 : -1;
        const px = sx * (hw - q) + q * co, pz = sz * (hd - q) + q * si;
        P.push(C[i].x - ty * px, C[i].y + tx * px, zc + pz);
        N.push(-ty * co, tx * co, si);
      }
    }
    const tri = (a, b2, c, ox, oy, oz) => {
      const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
      const ux = P[b2 * 3] - ax, uy = P[b2 * 3 + 1] - ay, uz = P[b2 * 3 + 2] - az, vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az;
      const dd = (uy * vz - uz * vy) * ox + (uz * vx - ux * vz) * oy + (ux * vy - uy * vx) * oz;
      if (dd >= 0) I.push(a, b2, c); else I.push(a, c, b2);
    };
    for (let i = 0; i < n - 1; i++) for (let k = 0; k < M; k++) {
      const a = i * M + k, b2 = i * M + (k + 1) % M, c = (i + 1) * M + (k + 1) % M, d = (i + 1) * M + k;
      const ox = N[a * 3], oy = N[a * 3 + 1], oz = N[a * 3 + 2];
      tri(a, b2, c, ox, oy, oz); tri(a, c, d, ox, oy, oz);
    }
    // 端盖：复制一圈顶点，盖面法线沿中线切向
    for (const [ri, sg] of [[0, -1], [n - 1, 1]]) {
      const base = P.length / 3, nx = tan[ri][0] * sg, ny = tan[ri][1] * sg;
      for (let k = 0; k < M; k++) { P.push(P[(ri * M + k) * 3], P[(ri * M + k) * 3 + 1], P[(ri * M + k) * 3 + 2]); N.push(nx, ny, 0); }
      P.push(C[ri].x, C[ri].y, zc); N.push(nx, ny, 0);
      const ctr = base + M;
      for (let k = 0; k < M; k++) tri(ctr, base + k, base + (k + 1) % M, nx, ny, 0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    g.setIndex(I);
    return g;
  };

  // ───────── 基础积木 ─────────
  const slab = (x0, x1, y0, y1, z0, z1, mat = 'shell') => b.box(x1 - x0, y1 - y0, z1 - z0, { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2 }, mat);
  // 平面多边形 [x,z] 竖向拉伸 y0→y1
  const prism = (pts, y0, y1, mat, bevel = 0) => {
    const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
    b.extrude(shape, y1 - y0 - 2 * bevel, { rx: -Math.PI / 2, y: y0 + bevel }, mat, bevel, 8);
  };
  const edgesOf = (pts) => {
    const n = pts.length; let cx = 0, cz = 0; for (const [x, z] of pts) { cx += x / n; cz += z / n; }
    return pts.map((p, i) => {
      const q = pts[(i + 1) % n], dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz);
      let nx = dz / len, nz = -dx / len; const mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2;
      if (nx * (mx - cx) + nz * (mz - cz) < 0) { nx = -nx; nz = -nz; }
      return { p, q, len, mx, mz, nx, nz, ry: Math.atan2(nx, nz) };
    });
  };
  const unit = () => new THREE.BoxGeometry(1, 1, 1);
  const beam = (a, c, sx, sy, mat) => b.add(unit(), beamMatrix(THREE, a, c, sx, sy), mat);
  const lamp = (x, y, z, h = 5.4) => {
    b.cyl(0.34, 0.42, 0.6, { x, y: y + 0.3, z }, 'graphite', 12);
    b.cyl(0.1, 0.14, h, { x, y: y + h / 2, z }, 'metal', 8);
    b.cyl(0.42, 0.3, 0.3, { x, y: y + h + 0.05, z }, 'graphite', 12);
    b.sphere(0.3, { x, y: y + h + 0.5, z }, 'glowWhite', 12, 8);
  };
  // 栏杆：扶手 + 腰线 + 玻璃 + 实例化立柱。a/c 为 [x,y,z] 起止（y 为脚下标高）
  const railLine = (a, c, { h = 1.1, step = 2.6, glass = true } = {}) => {
    const len = Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    const n = Math.max(1, Math.round(len / step));
    for (let i = 0; i <= n; i++) { const k = i / n; postM.push(kit.toMatrix({ x: a[0] + (c[0] - a[0]) * k, y: a[1] + (c[1] - a[1]) * k + 0.55, z: a[2] + (c[2] - a[2]) * k })); }
    beam([a[0], a[1] + h, a[2]], [c[0], c[1] + h, c[2]], 0.17, 0.12, 'ceramic');
    beam([a[0], a[1] + h * 0.52, a[2]], [c[0], c[1] + h * 0.52, c[2]], 0.05, 0.05, 'glowSoft');
    if (glass) beam([a[0], a[1] + h * 0.42, a[2]], [c[0], c[1] + h * 0.42, c[2]], 0.04, h * 0.66, 'glass');
  };
  // 沿多边形边铺细线 / 栏杆
  const lineLoop = (pts, y, w, h, mat, out = 0) => {
    const P = out ? offsetPoly(pts, out) : pts;
    for (const e of edgesOf(P)) { b.push({ x: e.mx, y, z: e.mz, ry: e.ry }); b.box(e.len + 0.04, h, w, {}, mat); b.pop(); }
  };

  // 墙面装饰：一条边上铺竖向玻璃幕（青色内光）+ 密排竖棂，不用横向窗带。e 来自 edgesOf。
  const dress = (e, y0, y1, o = {}) => {
    const w = e.len - (o.margin ?? 2.4);
    if (w < 4) return;
    const pitch = o.rib ?? 3, n = Math.max(1, Math.round(w / pitch)), fw = o.ribW ?? 0.5, fd = o.ribD ?? 0.9;
    b.push({ x: e.mx, z: e.mz, ry: e.ry });
    b.add(new THREE.BoxGeometry(w, y1 - y0 - 0.9, 0.5), { y: (y0 + 0.9 + y1) / 2, z: 0.16 }, glassLit, { uv: false });
    b.box(w + 0.6, 0.9, 0.7, { y: y0 + 0.45, z: 0.25 }, 'graphite');
    for (let i = 0; i <= n; i++) b.box(fw, y1 - y0, fd, { x: -w / 2 + i * w / n, y: (y0 + y1) / 2, z: fd / 2 - 0.1 }, o.ribMat || 'shell');
    b.pop();
  };
  // 紫花树 / 灌木（本楼自带 leaf、bloom 两个材质）
  const tree = (x, y, z, k = 1) => {
    b.cyl(0.26 * k, 0.38 * k, 3.4 * k, { x, y: y + 1.7 * k, z }, 'metal', 6);
    const q = hi ? [10, 7] : [7, 5];
    for (const [dx, dy, dz, r] of [[0, 4.4, 0, 2.5], [1.5, 3.4, 0.8, 1.9], [-1.4, 3.7, -0.9, 2.0], [0.2, 5.5, -0.4, 1.6]]) b.sphere(r * k, { x: x + dx * k, y: y + dy * k, z: z + dz * k, sy: 0.88 }, bloom, q[0], q[1]);
  };
  const bush = (x, y, z, r) => b.sphere(r, { x, y: y + r * 0.45, z, sy: 0.72 }, leaf, hi ? 8 : 6, hi ? 6 : 4);
  // 出挑檐板：外扩多边形 + 下沿青色细线 + 暗缝
  const eave = (pts, y1, { out = 2.2, thick = 0.9, rootX = null, line = 'glowSoft', mat = 'graphite' } = {}) => {
    prism(offsetPoly(pts, out, rootX), y1 - thick, y1, mat, 0.2);
    lineLoop(offsetPoly(pts, out - 0.12, rootX), y1 - thick - 0.04, 0.1, 0.1, line);
    lineLoop(offsetPoly(pts, 0.04, rootX), y1 - thick - 0.4, 0.06, 0.8, 'ink');
  };

  // ───────── 1. 台基 + 门前大台阶 ─────────
  const PLINTH = [[-118, 62], [118, 62], [118, -62], [98, -104], [-98, -104], [-118, -62]];
  prism(PLINTH, 0, GY, 'shellCool', 0.3);
  lineLoop(PLINTH, GY - 0.55, 0.1, 0.12, 'glowSoft', 0.34);
  // 台基前脸壁柱 + 暗缝
  for (const s of [-1, 1]) {
    for (let i = 0; i < 15; i++) {
      const x = s * (30 + i * 5.9);
      b.box(0.9, 3.3, 0.6, { x, y: 1.9, z: 62.2 }, 'ceramic');
    }
    b.box(95, 0.32, 0.1, { x: s * 70.5, y: 3.2, z: 62.12 }, 'ink');
  }
  // 台地前缘栏杆（楼梯口留空）
  for (const s of [-1, 1]) railLine([s * 28, GY, 61.3], [s * 116.5, GY, 61.3], { step: 3.2 });
  for (const s of [-1, 1]) { railLine([s * 116.5, GY, 61.3], [s * 116.5, GY, 52], { step: 3.2 }); }

  // 台阶：3 段 + 2 个平台，0.25 m/级
  const flights = [[5, 46], [6, 54], [5, 62]], landW = [54, 62];
  const TREAD = 0.62, RISE = 0.25, LAND = 9;
  const ladder = [];                         // 记录每段 { z0, z1, y0, y1, W }
  {
    let z = 62, y = GY;
    flights.forEach(([n, W], fi) => {
      const zEnd = z + (n - 1) * TREAD, yEnd = y - n * RISE;
      for (let j = 1; j < n; j++) {
        const yj = y - j * RISE, zj = z + (j - 1) * TREAD;
        b.box(W, yj, TREAD, { y: yj / 2, z: zj + TREAD / 2 }, 'graphite');
        b.box(W + 0.14, 0.07, TREAD + 0.06, { y: yj - 0.035, z: zj + TREAD / 2 + 0.03 }, 'paving');
        for (const s of [-1, 1]) b.box(0.16, 0.025, TREAD - 0.08, { x: s * 3.4, y: yj + 0.012, z: zj + TREAD / 2 }, 'glowSoft');
      }
      // 垂带（楔形侧墙）+ 栏杆
      for (const s of [-1, 1]) {
        const xa = s * W / 2, xb = s * (W / 2 + 1.3);
        const shape = new THREE.Shape([new THREE.Vector2(z, 0), new THREE.Vector2(z, y + 0.35), new THREE.Vector2(zEnd + 0.4, yEnd + 0.35), new THREE.Vector2(zEnd + 0.4, 0)]);
        b.extrude(shape, 1.3, { ry: -Math.PI / 2, x: Math.max(xa, xb) }, 'shell', 0);
        railLine([s * (W / 2 + 0.65), y + 0.35, z], [s * (W / 2 + 0.65), yEnd + 0.35, zEnd + 0.4], { step: 2.4 });
        lamp(s * (W / 2 + 0.65), y + 0.35, z, 5.2);
      }
      // 平台
      if (fi < 2) {
        const Wl = landW[fi], zl = zEnd, tp = yEnd;
        b.box(Wl, tp, LAND, { y: tp / 2, z: zl + LAND / 2 }, 'shellCool');
        b.box(Wl + 0.14, 0.07, LAND + 0.1, { y: tp - 0.035, z: zl + LAND / 2 }, 'paving');
        b.box(0.16, 0.025, LAND - 0.2, { x: -3.4, y: tp + 0.012, z: zl + LAND / 2 }, 'glowSoft');
        b.box(0.16, 0.025, LAND - 0.2, { x: 3.4, y: tp + 0.012, z: zl + LAND / 2 }, 'glowSoft');
        // 平台栏杆：两侧 + 前缘两端（给下一段让开）+ 后缘两端
        const Wn = flights[fi + 1][1], zf = zl + LAND;
        for (const s of [-1, 1]) {
          railLine([s * (Wl / 2 - 0.25), tp, zl + 0.3], [s * (Wl / 2 - 0.25), tp, zf - 0.3], { step: 3 });
          railLine([s * (Wl / 2 - 0.25), tp, zf - 0.3], [s * (Wn / 2 + 1.5), tp, zf - 0.3], { step: 3 });
          railLine([s * (Wl / 2 - 0.25), tp, zl + 0.3], [s * (W / 2 + 1.6), tp, zl + 0.3], { step: 3 });
          lamp(s * (Wl / 2 - 0.25), tp, zf - 0.3, 5.6);
        }
        z = zl + LAND; y = tp;
        ladder.push({ z, y });
      } else {
        b.box(W + 4, 0.14, 1.5, { y: 0.07, z: zEnd + 0.8 }, 'paving');
        for (const s of [-1, 1]) lamp(s * (W / 2 + 0.65), 0.35, zEnd + 0.4, 5.2);
        ladder.push({ z: zEnd, y: 0 });
      }
    });
  }
  const STAIR_END = ladder[2].z;            // ≈ 88

  // ───────── 2. 门前近广场：投影台、熊猫全息、两列导向光柱 ─────────
  const PZ = 100.2;                         // 广场中心 z（地面纹章外沿 ≤ 110，不越建模范围）
  b.box(96, 0.14, 21, { y: 0.07, z: 99.5 }, 'paving');
  lineLoop([[-47, 89], [47, 89], [47, 110], [-47, 110]], 0.16, 0.14, 0.04, 'glowSoft', -0.5);
  // 轴线地面徽记：全部贴地（≤0.2 m），门洞正前方视线零遮挡
  b.torus(9.5, 0.1, { y: 0.17, z: PZ }, 'glowSoft', 4, 128);
  b.torus(7.6, 0.14, { y: 0.16, z: PZ }, 'graphite', 4, 128);
  b.torus(5.6, 0.07, { y: 0.17, z: PZ }, 'glowSoft', 4, 96);
  for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; b.box(0.16, 0.04, i % 2 ? 1.2 : 2.2, { x: Math.sin(a) * 8.6, y: 0.17, z: PZ + Math.cos(a) * 8.6, ry: a }, 'glowSoft'); }
  for (const s of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const z = 108 - i * 4, h = 6 + i * 1.6, x = s * 14;
      b.cyl(0.55, 0.7, 0.5, { x, y: 0.25, z }, 'graphite', 12);
      b.cyl(0.3, 0.38, h, { x, y: 0.5 + h / 2, z }, 'ceramic', 14);
      b.cyl(0.11, 0.11, h - 1.2, { x, y: 0.9 + (h - 1.2) / 2, z }, 'glow', 8);
      b.cyl(0.44, 0.36, 0.3, { x, y: 0.5 + h + 0.05, z }, 'graphite', 12);
      b.sphere(0.26, { x, y: 0.5 + h + 0.48, z }, 'glowWhite', 12, 8);
    }
  }
  // 巨型全息熊猫坐像：门两侧台基上各一只（高约 28 m），深/浅两层全息皮肤 + 钴蓝实体围巾 + 发光圆底座
  const PXX = 35, PZZ = 55.8;
  const panda = (x, ry) => {
    const ps = hi ? 22 : 12, E = (t, m) => b.sphere(1, t, m, ps, Math.round(ps * 0.7));
    b.push({ x, y: GY, z: PZZ, ry, sx: 1.04, sy: 1.04, sz: 1.04 });
    b.lathe([[7.6, 0], [7.6, 0.7], [6.9, 1.2], [0, 1.2]], {}, 'shellCool', 48);
    b.torus(7.5, 0.2, { y: 0.55 }, 'glowSoft', 6, 96);
    b.torus(5.9, 0.1, { y: 1.24 }, 'glow', 6, 96);
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; b.box(0.18, 0.06, 1.3, { x: Math.sin(a) * 6.7, y: 1.24, z: Math.cos(a) * 6.7, ry: a }, 'glowSoft'); }
    b.cyl(6.7, 6.7, 0.08, { y: 1.23 }, 'glowSoft', 48);                               // 发光圆台面
    b.push({ y: 1.2, z: -2.2 });
    E({ x: 0, y: 7.0, z: 0, sx: 6.4, sy: 7.2, sz: 5.8 }, pandaLight);                 // 身
    E({ x: 0, y: 7.2, z: 3.4, sx: 4.6, sy: 5.2, sz: 3.4 }, pandaLight);               // 圆肚
    E({ x: 0, y: 18.6, z: 1.0, sx: 7.9, sy: 7.0, sz: 7.0 }, pandaLight);              // 大头
    E({ x: 0, y: 16.9, z: 7.4, sx: 2.9, sy: 2.1, sz: 1.7 }, pandaLight);              // 口鼻
    for (const s of [-1, 1]) {
      E({ x: s * 5.6, y: 24.2, z: 0.2, sx: 2.7, sy: 2.7, sz: 1.7 }, pandaDark);       // 圆耳
      E({ x: s * 3.5, y: 19.0, z: 7.1, sx: 1.9, sy: 3.0, sz: 0.9, rz: s * 0.5 }, pandaDark);   // 倾斜黑眼圈（下宽上窄，外下内上）
      E({ x: s * 4.3, y: 17.7, z: 7.0, sx: 1.2, sy: 1.5, sz: 0.8, rz: s * 0.5 }, pandaDark);   // 泪滴尖外下角
      b.sphere(0.62, { x: s * 3.35, y: 19.4, z: 7.95 }, cobalt, 12, 8);                // 小而亮的眼
      b.sphere(0.26, { x: s * 3.1, y: 19.8, z: 8.45 }, pandaLight, 8, 6);             // 白点高光
      E({ x: s * 6.8, y: 9.8, z: 2.2, sx: 2.0, sy: 4.6, sz: 2.4, rz: s * 0.18 }, pandaDark);    // 臂
      E({ x: s * 4.6, y: 2.7, z: 5.2, sx: 3.2, sy: 2.7, sz: 5.2 }, pandaDark);        // 后腿前伸
      E({ x: s * 4.6, y: 2.5, z: 9.6, sx: 2.3, sy: 1.9, sz: 1.5 }, pandaLight);       // 脚掌
    }
    E({ x: 0, y: 17.4, z: 8.7, sx: 1.0, sy: 0.7, sz: 0.7 }, pandaDark);               // 鼻
    b.torus(4.5, 1.6, { y: 12.6, z: 1.1, rx: Math.PI / 2 + 0.12 }, cobalt, 10, 40);   // 围巾
    b.rbox(2.6, 5.6, 0.9, 0.3, { x: 3.4, y: 9.6, z: 5.2, rz: 0.18, rx: -0.2 }, cobalt);
    b.pop(); b.pop();
  };
  panda(-PXX, 0.3); panda(PXX, -0.3);

  // 门前人群：白色细胶囊 0.6×1.8 m，三五成群静态散布（广场、两个平台、门前平台）
  {
    const R = (() => { let a = 7; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
    const walkers = [], groups = (n, x0, x1, z0, z1, y, skipAxis) => {
      for (let g = 0; g < n; g++) {
        let cx = x0 + R() * (x1 - x0); const cz = z0 + R() * (z1 - z0);
        if (skipAxis && Math.abs(Math.abs(cx) - 14) < 2) cx += 3;
        for (let j = 0, c = 3 + Math.floor(R() * 3); j < c; j++) walkers.push({ x: cx + (R() - 0.5) * 2.8, z: cz + (R() - 0.5) * 2.8, y, k: 0.92 + R() * 0.16 });
      }
    };
    groups(hi ? 36 : 18, -45, 45, 90, 109, 0.14, true);
    groups(hi ? 8 : 4, -26, 26, ladder[0].z - LAND + 1.5, ladder[0].z - 1.5, ladder[0].y + 0.04);
    groups(hi ? 8 : 4, -28, 28, ladder[1].z - LAND + 1.5, ladder[1].z - 1.5, ladder[1].y + 0.04);
    groups(hi ? 6 : 3, -22, 22, 51, 60, GY + 0.04);
    // 大台阶：三段踏步上散步的人（两两一伙，靠两侧垂带多些）
    {
      let zc = 62, yc = GY;
      flights.forEach(([n, W], fi) => {
        const cnt = (hi ? 3 : 2) * (n - 1);
        for (let i = 0; i < cnt; i++) {
          const j = 1 + Math.floor(R() * (n - 1)), side = R() < 0.6 ? (R() < 0.5 ? -1 : 1) : 0;
          const x = side ? side * (W / 2 - 2 - R() * 7) : (R() - 0.5) * (W - 10);
          walkers.push({ x, z: zc + (j - 1) * TREAD + R() * TREAD, y: yc - j * RISE + 0.07, k: 0.92 + R() * 0.16 });
        }
        if (fi < 2) { zc += (n - 1) * TREAD + LAND; yc -= n * RISE; }
      });
    }
    const pb = new kit.Builder(mats);
    pb.add(new THREE.CapsuleGeometry(0.27, 1.0, hi ? 3 : 2, hi ? 8 : 6), { y: 0.77 }, 'shell', { uv: false });
    pb.sphere(0.18, { y: 1.68 }, 'shell', hi ? 8 : 6, hi ? 6 : 4);
    const geo = pb.build('person').children[0].geometry;
    const crowd = kit.instanced(geo, people, walkers.map((w) => kit.toMatrix({ x: w.x, y: w.y, z: w.z, sy: w.k })), 'crowd');
    const tints = [0xffffff, 0xffffff, 0xffffff, 0xcfeaff, 0x8fb4ff, 0x2d5bff, 0xb9a6ff], tc = new THREE.Color();
    walkers.forEach((w, i) => crowd.setColorAt(i, tc.setHex(tints[Math.floor(R() * tints.length)])));
    crowd.instanceColor.needsUpdate = true;
    crowd.frustumCulled = false; crowd.castShadow = false;
    root.add(crowd);
  }
  // 花坛：台阶两侧各一座，紫花树 + 灌木；外侧一排钴蓝旗杆
  for (const s of [-1, 1]) {
    b.rbox(9, 1.3, 22, 0.3, { x: s * 40, y: 0.65, z: 76 }, 'shell');
    b.box(8.2, 0.15, 21.2, { x: s * 40, y: 1.33, z: 76 }, leaf);
    for (let i = 0; i < 6; i++) bush(s * 40 + (i % 2 ? 1.8 : -1.8), 1.3, 67.5 + i * 3.4, 1.3);
    tree(s * 40, 1.3, 71, 1.15); tree(s * 40, 1.3, 81, 1.05);
    for (const z of [66, 73, 80, 87]) {
      const x = s * 33.8;
      b.cyl(0.14, 0.14, 12, { x, y: 6, z }, 'ceramic', 6);
      b.box(2.8, 0.18, 0.18, { x, y: 11.8, z }, 'ceramic');
      b.box(2, 8, 0.14, { x, y: 7.7, z }, cobalt);
      b.box(0.5, 1.4, 0.16, { x, y: 9.8, z: z + 0.1 }, 'ceramic');
    }
    for (const z of [66, 74, 82, 92, 100, 108]) {
      const x = s * 47.5;
      b.cyl(0.14, 0.14, 12, { x, y: 6, z }, 'ceramic', 6);
      b.box(2.8, 0.18, 0.18, { x, y: 11.8, z }, 'ceramic');
      b.box(2, 8, 0.14, { x, y: 7.7, z }, cobalt);
      b.box(0.5, 1.4, 0.16, { x, y: 9.8, z: z + 0.1 }, 'ceramic');
    }
  }

  // 大台阶两侧 6 面钴蓝竖幅旗：台基顶口一对、两个平台各一对（立在平台外缘栏杆线上）
  for (const [x, y, z] of [[26.5, GY, 60.4], [26.75, ladder[0].y, ladder[0].z - LAND / 2], [30.75, ladder[1].y, ladder[1].z - LAND / 2]]) for (const s of [-1, 1]) {
    const px = s * x;
    b.cyl(0.2, 0.26, 18.6, { x: px, y: y + 9.3, z }, 'ceramic', 8);
    b.box(3.9, 0.24, 0.24, { x: px, y: y + 17.7, z }, 'ceramic');
    b.box(3.1, 12.4, 0.16, { x: px, y: y + 11.3, z: z + 0.1 }, cobalt);
    for (const e of [-1, 1]) b.box(0.12, 11.8, 0.2, { x: px + e * 1.35, y: y + 11.3, z: z + 0.12 }, 'glowSoft');
    b.sphere(0.42, { x: px, y: y + 19.1, z }, 'glowWhite', 8, 6);
  }

  // ───────── 3. 中央体量（包住大厅）+ 立面 ─────────
  // 大厅盒 x∈[-44,44] z∈[-70,44] y∈[GY,46]：墙体全部在盒外，内壁由大厅自己衬里。
  slab(-52, -23.5, 2, 60, 44, FZ); slab(23.5, 52, 2, 60, 44, FZ); slab(-23.5, 23.5, 51.5, 60, 44, FZ);
  slab(-52, -44, 2, 60, -80, 44); slab(44, 52, 2, 60, -80, 44);
  slab(-44, 44, 2, 60, -80, -70); slab(-44, 44, 46, 60, -70, 44);
  // 门洞：层层退进的 5 层门框（外大内小），每层一道青色细线；净开口 32 宽
  const OR = [[23.5, 51.5], [22, 50], [20.5, 48.5], [19, 47], [17.5, 45.5], [16, 44]];
  for (let k = 0; k < 5; k++) {
    const [hw, top] = OR[k], [hn, tn] = OR[k + 1], zf = FZ - 0.8 * (k + 1);
    for (const s of [-1, 1]) slab(s > 0 ? hn : -hw, s > 0 ? hw : -hn, 2, top, 44, zf, k % 2 ? 'graphite' : 'shell');
    slab(-hn, hn, tn, top, 44, zf, k % 2 ? 'graphite' : 'shell');
    const lz = zf + 0.02, lw = 0.13, off = 0.32;
    for (const s of [-1, 1]) b.box(lw, top - GY - 0.2, 0.06, { x: s * (hn + off), y: (top + GY) / 2 - 0.05, z: lz }, 'glowSoft');
    b.box(2 * (hn + off) + lw, lw, 0.06, { y: tn + off, z: lz }, 'glowSoft');
  }
  // 门槛石：贴台基顶的深色压条
  b.box(32, 0.08, 3.6, { y: GY + 0.02, z: 46.2 }, 'graphite');
  // 立面：下部竖向玻璃幕；其上两层前挑退台（罩在熊猫头顶，挑出 9.5 / 4.5 m）；顶部再两级后退的中厅玻璃体
  const hang = (x, yt, z) => {
    b.box(2, 8, 0.14, { x, y: yt - 4, z }, cobalt);
    b.box(2.8, 0.2, 0.2, { x, y: yt + 0.1, z }, 'ceramic');
    b.box(0.5, 1.4, 0.16, { x, y: yt - 2.4, z: z + 0.11 }, 'ceramic');
    for (const k of [-1, 1]) b.box(0.15, 0.15, 1.2, { x: x + k * 1.3, y: yt + 0.1, z: z - 0.6 }, 'ceramic');
  };
  const belt = (x, y, z, w, step = 4.2) => {
    b.box(w, 0.9, 2.4, { x, y: y + 0.45, z }, leaf);
    if (hi) for (let i = 0, n = Math.max(1, Math.round(w / step)); i < n; i++) bush(x - w / 2 + (i + 0.5) * w / n, y + 0.8, z, 1.1 + (i % 3) * 0.14);
  };
  for (const s of [-1, 1]) dress({ mx: s * 37.75, mz: FZ, ry: 0, len: 28.5 + 2.4 }, GY + 0.6, 59.4, { rib: 2.7, margin: 2.4 });
  eave([[-52, FZ], [52, FZ], [52, -80], [-52, -80]], 60, { out: 2.6, thick: 1.5, mat: 'graphite' });
  // 通用「层台」：多边形平面 → 白色台体 + 出挑檐板 + 青色竖向玻璃带 + 钴蓝竖旗 + 白栏杆 + 绿植带 + 紫花树团
  const tier = (pts, y0, y1, o = {}) => {
    const { rootX = null, shade = 'shell', back = false, gap = 12, eaveOut = 2.2, treeEvery = 0, treeK = 1, trees = [], spires = false, k = 0 } = o;
    const rt = rootX === null ? null : Math.abs(rootX);
    const isRoot = (e, d = 0) => rt !== null && Math.abs(e.p[0]) === rt - d && Math.abs(e.q[0]) === rt - d;
    prism(pts, y0, y1 - 0.9, shade, 0);
    eave(pts, y1, { out: eaveOut, thick: 0.9, rootX });
    let carry = gap * 0.6;
    for (const e of edgesOf(pts)) {
      if (isRoot(e) || (!back && e.nz < -0.4)) continue;
      dress(e, y0 + 0.7, y1 - 1.0, { rib: 3, margin: 0.8 });
      if (e.nz < -0.25) continue;
      const hangAt = (x) => { b.push({ x: e.mx, z: e.mz, ry: e.ry }); hang(x, y1 - 1.6, 1.25); b.pop(); };
      if (e.len >= gap) { const n = Math.floor(e.len / gap); for (let i = 0; i < n; i++) hangAt(((i + 0.5) / n - 0.5) * (e.len - 4)); }
      else { carry += e.len; if (carry >= gap) { carry = 0; hangAt(0); } }
    }
    for (const e of edgesOf(offsetPoly(pts, -1.5, rootX))) {
      if (isRoot(e, 2) || (!back && e.nz < -0.4)) continue;
      b.push({ x: e.mx, y: y1 + 0.45, z: e.mz, ry: e.ry }); b.box(e.len, 0.9, 2.4, {}, leaf); b.pop();
      if (hi) for (let i = 0, n = Math.round(e.len / 4.6); i < n; i++) { const t = (i + 0.5) / n; bush(e.p[0] + (e.q[0] - e.p[0]) * t, y1 + 0.8, e.p[1] + (e.q[1] - e.p[1]) * t, 1.1 + ((i * 7 + k * 3) % 5) * 0.12); }
    }
    if (hi) for (const e of edgesOf(offsetPoly(pts, eaveOut - 0.35, rootX))) {
      if (isRoot(e, 2) || (!back && e.nz < -0.4)) continue;
      railLine([e.p[0], y1, e.p[1]], [e.q[0], y1, e.q[1]], { step: 3.4, glass: false });
    }
    for (const [x, z] of trees) tree(x, y1, z, treeK);
    if (treeEvery) offsetPoly(pts, -7, rootX).forEach((q, i) => {
      if (rt !== null && Math.abs(q[0]) === rt - 2) return;
      if (i % treeEvery === k % treeEvery) tree(q[0], y1, q[1], treeK);
      if (spires && hi && i % 6 === (k * 2) % 6) b.lathe([[0.9, 0], [0.55, 6], [0.2, 11], [0.05, 14]], { x: q[0] + Math.sign(q[0]) * 2.5, y: y1, z: q[1] }, 'ceramic', 8);
    });
  };
  // 半超椭圆瓣：从 x=root 的前根点绕到后根点（s=+1 一侧）；前缘圆润外凸
  const fan = (A, zf, zb, root, m = 0, n = 2.2, N = hi ? 28 : 16) => {
    const zc = (zf + zb) / 2, B = (zf - zb) / 2, P = [];
    for (let i = 0; i <= N; i++) {
      const ph = Math.PI / 2 - Math.PI * i / N, c = Math.cos(ph), sn = Math.sin(ph);
      const x = i === 0 || i === N ? root : root + A * Math.pow(Math.abs(c), 2 / n);
      P.push([x, zc + B * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / n) + m * (x - root)]);   // m：整瓣向前剪切，让翼向门前广场环抱
    }
    return P;
  };
  // 门前两层前挑弧角平台（罩在熊猫头顶，外前角大圆角）
  const terrPts = (s, x0, x1, zOut, r = 5) => {
    const P = [[x0, FZ - 1], [x0, zOut], [x1 - r, zOut]];
    for (let i = 1; i <= 5; i++) { const a = i / 5 * Math.PI / 2; P.push([x1 - r + Math.sin(a) * r, zOut - r + Math.cos(a) * r]); }
    P.push([x1, FZ - 1]);
    return P.map(([x, z]) => [x * s, z]);
  };
  for (const s of [-1, 1]) {
    tier(terrPts(s, 24, 40, 57.5), 38, 48, { rootX: 24 * s, gap: 7, eaveOut: 0.9, trees: [[s * 36, 52.6]], treeK: 0.95, shade: 'shell' });
    tier(terrPts(s, 24, 34, 52.5, 4), 48, 57, { rootX: 24 * s, gap: 7, eaveOut: 0.9, shade: 'shell' });
  }
  // 主楼屋面前沿：白栏杆 + 绿植带 + 紫花树团
  railLine([-34, 60, 49.2], [34, 60, 49.2], { step: 3.4, glass: false });
  belt(0, 60, 45.2, 66, 4.6);
  for (const x of [-30, -18, -7, 7, 18, 30]) tree(x, 60, 42.5, 1.15);
  // 中厅第一级：前缘外凸成弧（中心 z=37，两端收到 z=22）
  {
    const a = 46, zc = 22, bb = 15, n = 2.4, N = hi ? 28 : 16, P = [];
    for (let i = 0; i <= N; i++) { const t = Math.PI * i / N, c = Math.cos(t), sn = Math.sin(t); P.push([a * Math.sign(c) * Math.pow(Math.abs(c), 2 / n), zc + bb * Math.pow(Math.abs(sn), 2 / n)]); }
    P[0][0] = a; P[N][0] = -a; P.push([-a, 14], [a, 14]);
    tier(P, 60, 72, { shade: 'shellCool', gap: 12, eaveOut: 1.6, treeEvery: 0, trees: [[-30, 31], [-14, 34], [14, 34], [30, 31]], treeK: 1.0 });
  }
  // 高大青色玻璃中庭：圆柱 + 穹顶，顶部收成穹顶接尖塔基座
  {
    const AT = [[31, 66], [31, 98], [29.5, 101], [27, 104.5], [24, 108], [21, 110.8], [19.4, 112]];
    b.add(new THREE.LatheGeometry(AT.map(([r, y]) => new THREE.Vector2(r, y)), SEG), { z: TZ }, glassLit, { uv: false });
    for (let i = 0; i < (hi ? 40 : 24); i++) { const a = i / (hi ? 40 : 24) * Math.PI * 2; b.push({ x: Math.sin(a) * 31.4, y: 82, z: TZ + Math.cos(a) * 31.4, ry: a }); b.box(0.6, 32, 0.9, {}, 'shell'); b.pop(); }
    for (let i = 0; i < 18; i++) {
      const a = i / 18 * Math.PI * 2 + 0.17;
      b.tube(AT.slice(1).map(([r, y]) => [Math.sin(a) * (r + 0.3), y, TZ + Math.cos(a) * (r + 0.3)]), 0.28, {}, 'shell', 12, 5);
    }
    b.torus(31.4, 0.6, { y: 98.6, z: TZ }, 'shell', 8, SEG);
    b.torus(31.5, 0.12, { y: 98.0, z: TZ }, 'glowSoft', 6, SEG);
    b.torus(19.9, 0.55, { y: 112.1, z: TZ }, 'shell', 8, SEG);
  }
  // 门楣标识：白色素面底板 + 钴蓝字（clean，无栅格）
  b.box(47, 7.9, 0.5, { y: 55.45, z: FZ + 0.15 }, 'shell');
  b.rbox(25, 5.4, 0.7, 0.3, { y: 55.6, z: FZ + 0.55 }, 'shell');
  for (const dy of [-2.55, 2.55]) b.box(24, 0.1, 0.1, { y: 55.6 + dy, z: FZ + 0.92 }, 'glowSoft');
  const sign = kit.textPanel('X-GATE', { height: 4.2, color: '#1f45e0', glow: '#ffffff', letter: 0.2 });
  sign.position.set(0, 55.6, FZ + 0.95); root.add(sign);
  sign.traverse(o => { if (o.isMesh) o.renderOrder = 5; });

  // 中央体量其余三面：幕墙带 + 肋
  for (const [mx, mz, ry, len] of [[52.1, -16, Math.PI / 2, 124], [-52.1, -16, -Math.PI / 2, 124]]) dress({ mx, mz, ry, len }, 30, 59.2, { rib: 3.4, margin: 4 });
  dress({ mx: 0, mz: -80.05, ry: Math.PI, len: 104 }, GY + 0.6, 59.2, { rib: 3.4, margin: 4 });
  // 背面圆窗：钛白环 + 青光环
  b.torus(14, 1.1, { y: 36, z: -80.9, rx: 0 }, 'ceramic', 10, SEG);
  b.torus(12.6, 0.14, { y: 36, z: -81.2, rx: 0 }, 'glow', 6, SEG);
  b.torus(8.8, 0.1, { y: 36, z: -81.2, rx: 0 }, 'glowSoft', 6, SEG);
  b.cyl(8, 8, 0.4, { y: 36, z: -80.5, rx: Math.PI / 2 }, 'glass', 48);

  // ───────── 4. X 门：两道厚重白色陶瓷弧拱（全城最大形体）─────────
  // 从门前两侧台基起，在立面上方 ~102 m 交叉，臂端高过主楼屋顶、略向外翻；截面 ≈15→11 × 10 m。
  const ARM = [[-58, 2], [-58, 20], [-54, 42], [-44, 64], [-30, 82], [-12, 95], [2, 104], [18, 118], [34, 136], [48, 152], [60, 163], [68, 169], [74, 172]];
  const AW = u => 22 - 7 * u, AD = 12, NA = hi ? 110 : 60, XY = 102.5;
  [[1, 58], [-1, 54.5]].forEach(([s, zc]) => {
    const curve = new THREE.CatmullRomCurve3(ARM.map(([x, y]) => V(x * s, y, 0)), false, 'centripetal');
    const C = curve.getSpacedPoints(NA).map(p => new THREE.Vector2(p.x, p.y));
    b.add(loft(C, AW, () => AD, zc, { r: 2, K: hi ? 5 : 3 }), {}, 'shell');
    // 青色边光：沿拱内侧（下沿）一条粗线 + 另一侧一条细线，贴在正面
    const zf = zc + AD / 2 + 0.06;
    // 两臂交叉处，被压在后面的那臂的边光抬到前臂面之上，让外缘青线连续穿过
    const ic = C.reduce((m, p, i) => Math.abs(p.x) < Math.abs(C[m].x) ? i : m, 0), lift = zc < 56 ? 4.6 : 0;
    const edge = (off) => C.map((p, i) => {
      const q0 = C[Math.max(0, i - 1)], q1 = C[Math.min(NA, i + 1)];
      let tx = q1.x - q0.x, ty = q1.y - q0.y; const m = Math.hypot(tx, ty) || 1; tx /= m; ty /= m;
      const o = off(i / NA), g = (i - ic) / (NA * 0.06);
      return [p.x - ty * o, p.y + tx * o, zf + lift * Math.exp(-g * g)];
    });
    b.tube(edge(u => s * (AW(u) / 2 - 2.3)), 0.34, {}, 'glowSoft', NA * 2, 5);     // 外缘连续青色边光
    b.tube(edge(u => -s * (AW(u) / 2 - 2.3)), 0.16, {}, 'glowSoft', NA, 4);    // 内缘细线
    // 钴蓝饰带：贴着臂面从脚座顶一路连续走到臂端，细长
    {
      const i0 = Math.round(NA * 0.08), i1 = NA - 1;
      b.add(loft(C.slice(i0, i1 + 1), () => 0.85, () => AD + 0.5, zc, { r: 0.4, K: 2 }), {}, cobalt);
    }
    // 脚座：一直落到地面，吃掉台基前缘的悬挑
    b.rbox(28, 9.4, 15, 0.8, { x: -58 * s, y: 4.6, z: zc - 0.5 }, 'shellCool');
    b.box(26, 0.14, 0.12, { x: -58 * s, y: 6.4, z: zc + 7.06 }, 'glowSoft');
  });
  // 交叉点光环：直径 34 m，钛白壳 + 青色芯，压在两臂之前
  const RZ = 65.8;
  b.torus(17, 1.0, { y: XY, z: RZ, rx: 0 }, 'shell', 10, SEG * 2);
  b.torus(17, 0.95, { y: XY, z: RZ + 0.4, rx: 0 }, orbitCyan, 8, SEG * 2);
  b.torus(17, 0.22, { y: XY, z: RZ + 1.0, rx: 0 }, 'glow', 6, SEG * 2);
  b.torus(15.7, 0.15, { y: XY, z: RZ + 0.1, rx: 0 }, 'glowSoft', 6, SEG * 2);
  if (xHalo) b.torus(17, 2.8, { y: XY, z: RZ + 1.4, rx: 0 }, xHalo, 10, SEG * 2);

  // ───────── 5. 两翼：弧形环抱的层台（半超椭圆瓣，以门为中心向两侧张开；越往下越宽越矮）─────────
  const WING = [
    { y0: 0, y1: 30, A: 74, zf: 46, zb: -78, m: 0.5 },
    { y0: 29.1, y1: 44, A: 57, zf: 38, zb: -66, m: 0.42 },
    { y0: 43.1, y1: 56, A: 41, zf: 28, zb: -52, m: 0.34 },
    { y0: 55.1, y1: 66, A: 27, zf: 18, zb: -38, m: 0.26 },
  ];
  for (const s of [-1, 1]) {
    WING.forEach((L, li) => {
      const pts = fan(L.A, L.zf, L.zb, 48, L.m).map(([x, z]) => [x * s, z]);
      tier(pts, L.y0, L.y1, { rootX: 48 * s, shade: li % 2 ? 'shellCool' : 'shell', back: true, gap: 12, treeEvery: 2, treeK: 0.95 + 0.1 * (li % 3), spires: true, k: li });
    });
  }

  // ───────── 5b. 阶梯式台地宫群（两翼层台，向中心升高的金字塔式城区）+ 廊桥 + 细高尖塔 ─────────
  // 白色阶梯主体 + 钴蓝竖向饰带 + 青色檐口灯带；窗格是一批发光贴片，合成 1 个实例化网格。
  // 尺度按 S01（距离约 350 m）取：层高 4.6 m、窗 2×3.2 m、饰带宽 1.1 m、檐灯 0.5 m，才读得出来。
  const winM = [];
  // 拱廊：整块白色拱板（一扇拱 4.6 m 宽，板与板相接成连续拱廊）+ 拱顶青线。立在下一级台身的屋面边沿，围住上一级台身根部。
  const AP = 4.6, AH = 4.4, AHW = 1.5, ASP = 2.4, ARD = 0.55;
  const archGeo = (() => {
    const sh = new THREE.Shape();
    sh.moveTo(-AP / 2, 0); sh.lineTo(-AHW, 0); sh.lineTo(-AHW, ASP); sh.absarc(0, ASP, AHW, Math.PI, 0, true); sh.lineTo(AHW, 0); sh.lineTo(AP / 2, 0); sh.lineTo(AP / 2, AH); sh.lineTo(-AP / 2, AH); sh.closePath();
    return new THREE.ExtrudeGeometry(sh, { depth: ARD, bevelEnabled: false, curveSegments: hi ? 7 : 5 });
  })();
  const crownGeo = (() => {
    const pts = []; for (let i = 0; i <= 8; i++) { const a = Math.PI * (1 - i / 8); pts.push(V(Math.cos(a) * (AHW + 0.3), ASP + Math.sin(a) * (AHW + 0.3), ARD + 0.02)); }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.17, 3, false);
  })();
  const arcadeRun = (cx, cz, ry, len, y0) => {
    const n = Math.max(1, Math.round(len / AP)), st = len / n;
    b.push({ x: cx, y: y0, z: cz, ry });
    for (let k = 0; k < n; k++) {
      const t = { x: -len / 2 + (k + 0.5) * st, z: -ARD / 2, sx: st / AP };
      b.add(archGeo, t, 'shell'); b.add(crownGeo, t, 'glowSoft', { uv: false });
    }
    b.pop();
  };
  const palace = (cx, y0, cz, w, d, hs, o = {}) => {
    const n = hs.length, info = { x: cx, z: cz, w, d, steps: [] };
    let y = y0;
    for (let i = 0; i < n; i++) {
      const wi = w - 5 * i, front = cz + d / 2 - 3.6 * i, back = cz - d / 2 + 1.2 * i, di = front - back, zc = (front + back) / 2, h = hs[i];
      b.box(wi, h, di, { x: cx, y: y + h / 2, z: zc }, i % 2 ? 'shellCool' : 'shell');
      b.box(wi + 1.4, 0.8, di + 1.4, { x: cx, y: y + h - 0.1, z: zc }, 'shell');
      b.box(wi + 1.5, 0.5, 0.25, { x: cx, y: y + h - 1.0, z: front + 0.75 }, 'glowSoft');
      if (hi) for (const sx of [-1, 1]) b.box(0.25, 0.5, di + 1.5, { x: cx + sx * (wi / 2 + 0.75), y: y + h - 1.0, z: zc }, 'glowSoft');
      const faces = hi ? [[0, front, wi, 0], [1, 0, di, Math.PI / 2], [-1, 0, di, -Math.PI / 2]] : [[0, front, wi, 0]];
      for (const [sx, fz, len, ry] of faces) {
        const px = sx ? cx + sx * wi / 2 : cx, pz = sx ? zc : fz;
        b.push({ x: px, z: pz, ry });
        const nb = Math.max(1, Math.round((len - 2) / 7)), span = len - 2, hh = h - 2.2;
        for (let k = 0; k <= nb; k++) b.box(1.1, hh, 0.45, { x: -span / 2 + k * span / nb, y: y + 0.8 + hh / 2, z: 0.22 }, cobalt);
        const rows = Math.max(1, Math.floor((h - 3) / 4.6)), rh = (h - 3) / rows;
        for (let k = 0; k < nb; k++) for (const dx of [-1.9, 0, 1.9]) for (let r = 0; r < rows; r++)
          winM.push(b.top.clone().multiply(kit.toMatrix({ x: -span / 2 + (k + 0.5) * span / nb + dx, y: y + 1.6 + (r + 0.5) * rh, z: 0.1, sx: 1.7, sy: Math.min(3.2, rh - 1.2) })));
        b.pop();
      }
      if (i > 0) {                                       // 每个退台一圈拱廊：正面 + 两侧
        const ay = y + 0.3, zF = front + 1.6, wF = wi + 2 * 1.3 + 0.5;
        arcadeRun(cx, zF, 0, wF, ay);
        if (hi) { const zA = back + 0.6, zc2 = (zA + zF) / 2; for (const sx of [-1, 1]) arcadeRun(cx + sx * (wi / 2 + 1.3), zc2, sx * Math.PI / 2, zF - zA, ay); }
      }
      info.steps.push({ top: y + h, front, back, wi });
      y += h;
    }
    const s0 = info.steps[0], sL = info.steps[n - 1], zL = (sL.front + sL.back) / 2;
    if (hi) tree(cx + (cx > 0 ? 1 : -1) * (w / 2 - 2.2), s0.top + 0.8, s0.front - 1.2, 0.75);
    if (o.spire) {
      b.lathe([[2.6, 0], [1.5, 7], [0.55, 14], [0.12, o.spire]], { x: cx, y: y + 0.4, z: zL }, 'ceramic', 10);
      b.sphere(0.6, { x: cx, y: y + o.spire + 0.7, z: zL }, 'glowWhite', 8, 6);
    }
    info.top = y;
    return info;
  };
  // 廊桥：白色桥面 + 拱廊柱梁 + 白顶盖 + 青色顶线 + 下垂拱圈
  const arcade = (a, c, o = {}) => {
    const wD = o.w ?? 6, sag = o.sag ?? 4, dx = c[0] - a[0], dz = c[2] - a[2], L = Math.hypot(dx, dz), ry = Math.atan2(dx, dz), H = 5.4;
    beam(a, c, wD, 1.1, 'shell');
    beam([a[0], a[1] + 0.6, a[2]], [c[0], c[1] + 0.6, c[2]], wD + 0.8, 0.16, 'glowSoft');
    const nf = Math.max(3, Math.round(L / 5.5));
    for (let i = 0; i <= nf; i++) {
      const t = i / nf, y = a[1] + (c[1] - a[1]) * t;
      b.push({ x: a[0] + dx * t, y, z: a[2] + dz * t, ry });
      for (const sx of [-1, 1]) b.box(0.6, H, 0.6, { x: sx * wD / 2, y: H / 2 + 0.5 }, 'shell');
      b.box(wD + 1.2, 0.7, 0.9, { y: H + 0.8 }, 'shell');
      b.pop();
    }
    beam([a[0], a[1] + H + 1.2, a[2]], [c[0], c[1] + H + 1.2, c[2]], wD + 1.4, 0.4, 'shell');
    beam([a[0], a[1] + H + 1.45, a[2]], [c[0], c[1] + H + 1.45, c[2]], 0.7, 0.14, 'glowSoft');
    for (const sx of [-1, 1]) {
      const ox = Math.cos(ry) * sx * wD / 2, oz = -Math.sin(ry) * sx * wD / 2;
      beam([a[0] + ox, a[1] + H - 0.3, a[2] + oz], [c[0] + ox, c[1] + H - 0.3, c[2] + oz], 0.16, 0.16, 'glowSoft');
    }
    const arc = [], N = 10;
    for (let i = 0; i <= N; i++) { const t = i / N; arc.push([a[0] + dx * t, a[1] + (c[1] - a[1]) * t - 0.6 - sag * Math.sin(Math.PI * t), a[2] + dz * t]); }
    b.tube(arc, 0.8, {}, 'shell', 20, 5);
  };
  {
    for (const s of [-1, 1]) {
      const m = (x) => x * s, v = s > 0 ? 0 : 1;
      const Q = {
        a1: palace(m(112), 30, 38, 18, 22, [13, 11, 9], { spire: 14 }),
        a2: palace(m(112), 30, -24, 18, 24, [13, 11, 9, 7]),
        b1: palace(m(84), 30, 47.5, 26, 14, [12, 10, 8], { spire: v ? 0 : 16 }),
        c1: palace(m(96), 44, 16, 16, 14, [14, 12, 10, 8], { spire: 14 }),
        c2: palace(m(97), 44, -20, 16, 16, [14, 12, 10]),
        c3: palace(m(80), 44, 33, 24, 16, [14, 12, 10, 8], { spire: v ? 14 : 0 }),
        d1: palace(m(82), 56, 6, 16, 20, [14, 12, 10, 8], { spire: 16 }),
        d2: palace(m(66), 56, 24, 16, 12, [14, 12, 10, 8, 6]),
        d3: palace(m(76), 56, -30, 14, 14, [12, 10, 8]),
        e1: palace(m(62), 66, -6, 22, 34, [16, 14, 12, 10, 8], { spire: 24 }),
        e2: palace(m(56), 66, -30, 12, 12, [12, 10, 8], { spire: 12 }),
        f1: palace(m(40), 72, 22, 14, 16, [12, 10, 8, 6], { spire: 14 }),     // 主楼屋面前沿，X 门拱后
      };
      // 廊桥：端点取在某一级台身的墙面中点，'o' 外 / 'i' 内 / 'n' 后 / 's' 前
      const wall = (k, st, f) => {
        const A = Q[k], S = A.steps[st], zc = (S.front + S.back) / 2, y = S.top - 1.6;
        if (f === 'o') return [A.x + s * (S.wi / 2 - 0.5), y, zc];
        if (f === 'i') return [A.x - s * (S.wi / 2 - 0.5), y, zc];
        if (f === 'n') return [A.x, y, S.back + 0.5];
        return [A.x, y, S.front - 0.5];
      };
      arcade(wall('c1', 1, 'n'), wall('c2', 1, 's'), { sag: 4.4 });
      arcade(wall('d1', 1, 'n'), wall('d3', 1, 's'), { sag: 4 });
      arcade(wall('c3', 0, 'o'), wall('a1', 1, 'i'), { sag: 3.6 });
    }
  }
  // 细高尖塔：方锥身（白）+ 钴蓝竖饰带 + 青色环光 + 青色顶灯；错落立在主楼屋面、后台基和两翼
  const needle = (x, y0, z, H, r0 = 4.6) => {
    const prof = [[r0 * 1.5, 0], [r0 * 1.5, 2.4], [r0, 3.4], [r0 * 0.62, H * 0.35], [r0 * 0.34, H * 0.7], [0.5, H * 0.96], [0.12, H]];
    const rAt = (yy) => { for (let i = 1; i < prof.length; i++) if (prof[i][1] >= yy) { const [r0_, y0_] = prof[i - 1], [r1, y1] = prof[i]; return r0_ + (r1 - r0_) * (yy - y0_) / Math.max(1e-6, y1 - y0_); } return 0.12; };
    b.add(new THREE.LatheGeometry(prof.map(([r, yy]) => new THREE.Vector2(r, yy)), 8), { x, y: y0, z }, 'shell', { uv: false });
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + Math.PI / 8, pts = [];
      for (let i = 0; i <= 8; i++) { const yy = 4 + (H * 0.88 - 4) * i / 8, rr = rAt(yy) * 0.93 + 0.12; pts.push([x + Math.sin(a) * rr, y0 + yy, z + Math.cos(a) * rr]); }
      b.tube(pts, 0.32, {}, cobalt, 16, 4);
    }
    for (const f of [0.3, 0.55, 0.78]) b.torus(rAt(H * f) + 0.5, 0.22, { x, y: y0 + H * f, z }, 'glowSoft', 4, 8);
    b.sphere(0.8, { x, y: y0 + H + 0.6, z }, 'glow', 10, 8);
  };
  for (const s of [-1, 1]) {
    const k = s > 0 ? 1 : 0.9;
    needle(s * 46, 60, -58, 100 * k);         // 主楼屋面后角
    needle(s * 26, 60, -68, 120 * k);         // 紧贴中央塔两侧
    needle(s * 40, 60, -76, 70 * k);
    needle(s * 82, GY, -92, 140 * k);         // 后台基外侧
  }
  if (winM.length) {
    const wins = kit.instanced(new THREE.PlaneGeometry(1, 1), winMat, winM, 'palace-windows');
    wins.castShadow = wins.receiveShadow = false; wins.frustumCulled = false;
    root.add(wins);
  }

  // ───────── 6. 中央塔 ─────────
  const keys = [[19.8, 108], [19.4, 110], [18, 119], [16.6, 128], [14.6, 142], [14.2, 150], [16.2, 156], [17.4, 162], [17, 170], [14.6, 182], [12.2, 194], [10.2, 206], [8.8, 214]];
  const prof = new THREE.SplineCurve(keys.map(([r, y]) => new THREE.Vector2(r, y))).getPoints(80).map(p => [p.x, p.y]);
  const towerR = (y) => { for (let i = 1; i < prof.length; i++) if (prof[i][1] >= y) { const [r0, y0] = prof[i - 1], [r1, y1] = prof[i]; return r0 + (r1 - r0) * (y - y0) / Math.max(1e-6, y1 - y0); } return prof[prof.length - 1][0]; };
  b.cyl(38, 40, 6, { y: 63, z: TZ }, 'shellCool', SEG);
  b.torus(35, 0.5, { y: 66.2, z: TZ }, 'glowSoft', 6, SEG * 2);
  b.torus(39.2, 0.4, { y: 60.9, z: TZ }, 'metal', 6, SEG * 2);
  b.add(lathePro(THREE, prof, SEG, 4), { z: TZ }, 'shell', { uv: false });
  // 观景环带（幕墙）
  const band = []; for (let y = 149; y <= 166.01; y += 1.4) band.push([towerR(y) + 0.25, y]);
  b.add(lathePro(THREE, band, SEG, 16), { z: TZ }, 'curtain', { uv: false });
  for (const y of [148.3, 166.7]) b.torus(towerR(y) + 0.5, 0.5, { y, z: TZ }, 'metal', 8, SEG);
  // 层板环
  for (const y of [118, 134, 176, 190, 202]) b.torus(towerR(y) + 0.45, 0.42, { y, z: TZ }, 'graphite', 8, SEG);
  // 竖肋（金属）+ 4 条青色竖光线
  const tubeAlong = (a, y0, y1, off, r, mat, segs = 20) => {
    const pts = []; for (let i = 0; i <= segs; i++) { const y = y0 + (y1 - y0) * i / segs; const rr = towerR(y) + off; pts.push([Math.sin(a) * rr, y, TZ + Math.cos(a) * rr]); }
    b.tube(pts, r, {}, mat, segs * 2, 5);
  };
  const ribN = hi ? 16 : 8;
  for (let i = 0; i < ribN; i++) { const a = i / ribN * Math.PI * 2 + Math.PI / ribN; tubeAlong(a, 112, 146, 0.35, 0.34, 'metal', 12); tubeAlong(a, 170, 208, 0.35, 0.3, 'metal', 12); }
  for (const a of [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4]) { tubeAlong(a, 112, 212, 0.4, 0.36, 'ink', 40); tubeAlong(a, 112, 212, 0.62, 0.17, 'glowSoft', 40); }

  // ───────── 7. 信标冠（天线、环、夹持臂） ─────────
  b.cyl(10, 10.6, 3.2, { y: 215.8, z: TZ }, 'metal', 48);
  b.lathe([[5.2, 217.4], [3.6, 224], [2.2, 231], [1.2, 238], [0.5, 245], [0.2, 250]], { z: TZ }, 'ceramic', 24);
  b.sphere(1.3, { y: 248.4, z: TZ }, 'glowWhite', 14, 10);
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * Math.PI * 2 + Math.PI / 6;
    b.push({ y: 220, z: TZ, ry: a }); b.box(0.8, 0.8, 8.6, { z: 5.0, y: 1 }, 'graphite'); b.rbox(1.4, 2.4, 1.6, 0.3, { z: 10.2, y: 1.4 }, 'metal'); b.pop();
  }
  const halo = new kit.Builder(mats);
  halo.torus(12, 0.6, {}, 'shellCool', 10, SEG * 2);
  halo.torus(12, 0.12, { y: 0.62 }, 'glow', 6, SEG * 2);
  halo.torus(12, 0.1, { y: -0.62 }, 'glow', 6, SEG * 2);
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; halo.rbox(1.2, 1.4, 2.2, 0.3, { x: Math.sin(a) * 12, z: Math.cos(a) * 12, ry: a, y: 0.2 }, 'shellCool'); }
  const haloM = halo.build('halo'); haloM.position.set(0, 221.5, TZ);
  const halo2 = new kit.Builder(mats);
  halo2.torus(7, 0.34, {}, 'shellCool', 8, SEG);
  halo2.torus(7, 0.1, { y: 0.36 }, 'glow', 6, SEG);
  for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2; halo2.rbox(1.0, 1.0, 1.0, 0.2, { x: Math.sin(a) * 7, z: Math.cos(a) * 7 }, 'glow'); }
  const halo2M = halo2.build('halo-in'); halo2M.position.set(0, 233, TZ);
  halo2M.children.forEach(c => { if (/glow/.test(c.name)) c.castShadow = false; });
  root.add(haloM, halo2M);
  ticks.push((t) => { if (!reducedMotion) { haloM.rotation.y = t * 0.14; halo2M.rotation.y = -t * 0.22; } });
  // 信标光束（极淡，远看识别）
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 2.2, 12, 16, 1, true), mats.holo);
  beacon.position.set(0, 254, TZ); beacon.name = 'base:beacon-beam'; root.add(beacon);   // 顶 260 = 契约包络高度

  // ───────── 8. 环形轨道（3 圈、不同倾角）+ 支撑臂 + 穿梭舱 ─────────
  const RINGS = [
    { R: 42, y: 118, rx: -0.04, rz: 0.07, arms: [40, 140, 220, 320] },
    { R: 55, y: 152, rx: 0.05, rz: -0.09, arms: [70, 150, 210, 290] },
    { R: 38, y: 190, rx: -0.07, rz: 0.05, arms: [30, 110, 250, 330] },
  ];
  const beltProfile = (R) => [[R - 1.5, -0.1], [R - 1.3, -0.5], [R + 1.3, -0.5], [R + 1.5, -0.1], [R + 1.5, 0.3], [R + 1.2, 0.6], [R - 1.2, 0.6], [R - 1.5, 0.3], [R - 1.5, -0.1]];
  const ringMats = [];
  RINGS.forEach((rg, ri) => {
    const gm = new THREE.Matrix4().compose(V(0, rg.y, TZ), new THREE.Quaternion().setFromEuler(new THREE.Euler(rg.rx, 0, rg.rz)), V(1, 1, 1));
    ringMats.push(gm);
    b.push(gm);                               // 轨道环静止，只有穿梭舱在动：直接并入主体
    b.add(lathePro(THREE, beltProfile(rg.R), SEG * 2, 4), {}, 'shell', { uv: false });
    b.torus(rg.R - 1.3, 0.1, { y: 0.62 }, 'glow', 6, SEG * 2);       // 内缘青光
    b.torus(rg.R - 1.4, 0.2, { y: 0.55 }, 'glowSoft', 6, SEG * 2);
    if (hi) for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2; b.box(0.6, 0.4, 3.6, { x: Math.sin(a) * rg.R, z: Math.cos(a) * rg.R, ry: a, y: -0.7 }, 'graphite'); }
    b.pop();
    // 支撑臂：塔身 → 轨道
    rg.arms.forEach((deg) => {
      const al = deg * Math.PI / 180, W = V(Math.sin(al) * rg.R, 0, Math.cos(al) * rg.R).applyMatrix4(gm);
      const yT = W.y - 4, rt = towerR(yT) - 0.8;
      const T = [Math.sin(al) * rt, yT, TZ + Math.cos(al) * rt];
      beam(T, [W.x, W.y - 0.5, W.z], 0.8, 0.6, 'graphite');
      beam([T[0], T[1] + 0.7, T[2]], [W.x, W.y - 0.2, W.z], 0.12, 0.12, 'glowSoft');
      b.push({ x: T[0], y: T[1], z: T[2], ry: al }); b.rbox(3.0, 2.8, 2.8, 0.5, {}, 'metal'); b.pop();
      b.push({ x: W.x, y: W.y - 1.1, z: W.z, ry: al }); b.rbox(2.6, 1.6, 2.6, 0.4, {}, 'metal'); b.pop();
    });
  });
  // 中央尖塔再加 2 道更亮的青色轨道环（自发光，夹在原三圈之间，反向倾角）
  for (const [R, y, rx, rz] of [[47, 134, 0.09, -0.06], [46, 172, -0.08, 0.08]]) {
    b.push(new THREE.Matrix4().compose(V(0, y, TZ), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, rz)), V(1, 1, 1)));
    b.torus(R, 0.95, {}, orbitCyan, 8, SEG * 2);
    b.torus(R, 0.3, { y: 0.1 }, 'glowWhite', 6, SEG * 2);
    b.pop();
  }
  // 穿梭舱（实例化，沿轨道缓行；reducedMotion 静止）
  {
    const per = hi ? 4 : 2, N = per * RINGS.length;
    const podGeo = new THREE.CapsuleGeometry(0.9, 2.6, 4, 10); podGeo.rotateX(Math.PI / 2);
    const lightGeo = new THREE.SphereGeometry(0.34, 10, 8); lightGeo.translate(0, 0.25, 1.9);
    const pods = kit.instanced(podGeo, mats.ceramic, Array.from({ length: N }, () => new THREE.Matrix4()), 'shuttles');
    const lights = kit.instanced(lightGeo, mats.glowWhite, Array.from({ length: N }, () => new THREE.Matrix4()), 'shuttle-lights');
    pods.frustumCulled = false; lights.frustumCulled = false; lights.castShadow = false;
    root.add(pods, lights);
    const m = new THREE.Matrix4(), loc = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    const place = (t) => {
      let k = 0;
      RINGS.forEach((rg, ri) => {
        for (let i = 0; i < per; i++, k++) {
          const ph = (i / per) * Math.PI * 2 + ri * 1.7 + t * (0.05 + ri * 0.012) * (ri % 2 ? -1 : 1);
          pos.set(Math.sin(ph) * rg.R, 0.6, Math.cos(ph) * rg.R);
          const dir = (ri % 2 ? -1 : 1);
          q.setFromEuler(e.set(0, ph + (dir > 0 ? Math.PI / 2 : -Math.PI / 2), 0));
          loc.compose(pos, q, one);
          m.multiplyMatrices(ringMats[ri], loc);
          pods.setMatrixAt(k, m); lights.setMatrixAt(k, m);
        }
      });
      pods.instanceMatrix.needsUpdate = true; lights.instanceMatrix.needsUpdate = true;
    };
    place(0);
    ticks.push((t) => { if (!reducedMotion) place(t); });
  }

  // ───────── 9. 浮空小岛 + 悬索光桥 ─────────
  const hash = (x, y, z) => { const t = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453; return t - Math.floor(t); };
  // 岩根：多层、带地层环的倒锥，顶点按位置哈希扰动（接缝处同位置同扰动）
  const rockTier = (rTop, rBot, yTop, yBot, seg, amp) => {
    const pts = [[rBot, yBot], [(rBot * 2 + rTop) / 3, yBot + (yTop - yBot) * 0.3], [(rBot + rTop * 2) / 3, yBot + (yTop - yBot) * 0.66], [rTop, yTop]];
    const g = new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const k = 1 + (hash(Math.round(x * 2.5), Math.round(y * 2.5), Math.round(z * 2.5)) - 0.5) * amp;
      pos.setXYZ(i, x * k, y + (hash(Math.round(z * 2.5), Math.round(x * 2.5), 3) - 0.5) * amp * 2, z * k);
    }
    g.computeVertexNormals();
    return g;
  };
  // 悬索光桥：两侧主缆 + 吊索 + 细光桥面；起落点由调用方给，坡度保持平缓
  const cable = (a, c, sag) => {
    const N = 14, P = [];
    for (let i = 0; i <= N; i++) { const k = i / N; P.push([a[0] + (c[0] - a[0]) * k, a[1] + (c[1] - a[1]) * k - sag * 4 * k * (1 - k), a[2] + (c[2] - a[2]) * k]); }
    const dx = c[0] - a[0], dz = c[2] - a[2], m = Math.hypot(dx, dz) || 1, px = -dz / m * 0.85, pz = dx / m * 0.85;
    b.tube(P.map(p => [p[0], p[1] + 0.02, p[2]]), 0.16, {}, 'glowSoft', 28, 4);
    for (const sgn of [-1, 1]) b.tube(P.map(p => [p[0] + px * sgn, p[1] + 1.15, p[2] + pz * sgn]), 0.07, {}, 'metal', 28, 4);
    for (let i = 1; i < N; i++) for (const sgn of [-1, 1]) beam([P[i][0] + px * sgn, P[i][1] + 1.15, P[i][2] + pz * sgn], [P[i][0] + px * sgn * 0.9, P[i][1], P[i][2] + pz * sgn * 0.9], 0.035, 0.035, 'metal');
    for (let i = 0; i < N; i++) beam(P[i], P[i + 1], 1.5, 0.1, 'graphite');
  };
  const island = (cx, cy, cz, r, kind, link) => {
    const d = r * 1.5;
    b.push({ x: cx, y: cy, z: cz });
    b.add(rockTier(r * 0.97, r * 0.74, -0.8, -d * 0.26, 11, 0.2), {}, 'rock', { uv: false });
    b.add(rockTier(r * 0.74, r * 0.4, -d * 0.26, -d * 0.62, 10, 0.3), {}, 'rockDark', { uv: false });
    b.add(rockTier(r * 0.4, r * 0.06, -d * 0.62, -d, 8, 0.36), {}, 'rock', { uv: false });
    b.torus(r * 0.76, 0.34, { y: -d * 0.26 }, 'metal', 6, 48);
    b.torus(r * 0.76, 0.1, { y: -d * 0.26 - 0.36 }, 'glowSoft', 6, 48);
    b.cyl(r * 0.5, r * 0.36, 0.4, { y: -d * 0.62 }, 'graphite', 14);
    b.cyl(r * 0.34, r * 0.34, 0.12, { y: -d * 0.62 - 0.24 }, 'glowSoft', 14);
    b.cyl(r * 0.97, r * 0.92, 1.6, { y: -0.8 }, 'shellCool', 28);
    b.cyl(r * 0.93, r * 0.93, 0.12, { y: 0.02 }, 'paving', 28);
    b.torus(r * 0.955, 0.26, { y: 0.1 }, 'metal', 6, 56);
    b.torus(r * 0.965, 0.07, { y: -0.7 }, 'glowSoft', 6, 56);
    if (kind === 'lighthouse') {
      b.lathe([[2.0, 0], [1.6, 3], [1.15, 9], [1.4, 10.4], [2.2, 11]], { y: 0 }, 'ceramic', 20);
      b.cyl(1.3, 1.3, 2, { y: 12 }, 'glowWhite', 16); b.cyl(0.1, 2.4, 1.8, { y: 13.9 }, 'graphite', 16);
      b.torus(1.9, 0.14, { y: 3.4 }, 'glowSoft', 6, 24); b.torus(1.5, 0.14, { y: 6.4 }, 'glowSoft', 6, 24);
      b.rbox(3.4, 2.4, 3.0, 0.3, { x: 5.4, y: 1.2, z: 1.0 }, 'shell'); b.box(3.0, 0.12, 0.1, { x: 5.4, y: 2.3, z: 2.55 }, 'glowSoft');
    } else if (kind === 'helipad') {
      b.cyl(r * 0.7, r * 0.7, 0.1, { y: 0.1 }, 'graphite', 32);
      b.torus(r * 0.62, 0.12, { y: 0.2 }, 'glowSoft', 6, 48);
      b.box(0.34, 0.06, 4.4, { x: -1.1, y: 0.2 }, 'glowSoft'); b.box(0.34, 0.06, 4.4, { x: 1.1, y: 0.2 }, 'glowSoft'); b.box(2.2, 0.06, 0.34, { y: 0.2 }, 'glowSoft');
      for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2 + Math.PI / 4; b.sphere(0.22, { x: Math.sin(a) * r * 0.78, y: 0.4, z: Math.cos(a) * r * 0.78 }, 'glowWhite', 8, 6); }
      b.rbox(2.6, 1.8, 2.2, 0.3, { x: -5.4, y: 0.9, z: -3 }, 'shell');
    } else if (kind === 'pavilion') {
      b.rbox(10, 4.2, 8, 0.5, { y: 2.3 }, 'shell'); b.box(9.4, 2.2, 0.3, { y: 2.4, z: 4.05 }, 'glass');
      b.rbox(12.4, 0.6, 10.4, 0.25, { y: 4.7 }, 'graphite'); b.box(12.2, 0.1, 0.1, { y: 4.3, z: 5.2 }, 'glowSoft');
      b.cyl(0.14, 0.2, 9, { x: 3.4, y: 9.2, z: -2 }, 'metal', 6); b.sphere(0.34, { x: 3.4, y: 13.8, z: -2 }, 'glowWhite', 10, 8);
      for (const sx of [-1, 1]) b.cyl(0.4, 0.4, 3.6, { x: sx * 5.4, y: 2.0, z: 5.6 }, 'ceramic', 10);
    } else if (kind === 'antenna') {
      b.lathe([[0.9, 0], [0.5, 8], [0.3, 20], [0.12, 26]], { y: 0 }, 'metal', 10);
      for (const y of [6, 11, 16, 21]) b.torus(1.8 - y * 0.05, 0.1, { y }, 'glowSoft', 6, 24);
      b.sphere(0.4, { y: 26.4 }, 'glowWhite', 10, 8);
      for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2; b.push({ ry: a }); b.box(0.2, 0.2, 7.5, { z: 2.2, y: 3.0, rx: -0.5 }, 'metal'); b.pop(); }
      b.rbox(4, 2.2, 3.4, 0.3, { x: 4.4, y: 1.1, z: 2 }, 'shell');
    } else if (kind === 'dome') {
      b.sphere(r * 0.46, { y: 0 }, 'ceramic', 28, 14, 0, Math.PI * 2, 0, Math.PI / 2);
      b.cyl(r * 0.46, r * 0.5, 1.2, { y: 0.6 }, 'shellCool', 28);
      b.torus(r * 0.47, 0.12, { y: 2.3 }, 'glowSoft', 6, 48);
      b.box(1.0, r * 0.4, 0.2, { y: r * 0.24, z: r * 0.455 }, 'glass');
    }
    b.pop();
    if (link) cable(link[0], link[1], link[2]);
  };
  island(-100, 44, 80, 11, 'lighthouse', [[-92.5, 44.15, 73.5], [-86, 34.3, 32], 1.8]);
  island(98, 30, 86, 9, 'helipad', [[92, 30.15, 80], [88, 20.3, 40], 1.4]);
  island(-107, 52, -34, 13, 'pavilion', [[-99.5, 52.2, -30], [-91, 46.3, -14], 1.4]);
  island(104, 56, -54, 12, 'antenna', [[97.5, 56.2, -50], [86, 46.3, -24], 1.6]);
  if (hi) island(-64, 64, -98, 9, 'dome', [[-60, 64.2, -92], [-62, 46.3, -52], 2.2]);

  // ───────── 9b. 天际线：主楼后方 6 座高低错落的白色塔楼（青色竖向光带，顶部尖塔 / 环 / 穹），最高 ≤ X 交点 102 m ─────────
  const skyTower = (x, z, h, kind, w0 = 13, y0 = GY) => {
    b.rbox(w0 + 6, 9, w0 + 6, 0.8, { x, y: y0 + 0.5, z }, 'shellCool');
    let yb = y0 + 4, wt = w0;
    [[w0, 0.42], [w0 * 0.78, 0.74], [w0 * 0.56, 1]].forEach(([w, f], i) => {
      const yt = y0 + h * f, hh = yt - yb; wt = w;
      b.rbox(w, hh, w, 0.8, { x, y: yb + hh / 2, z }, i % 2 ? 'shellCool' : 'shell');
      for (const [dx, dz, ry] of [[0, 1, 0], [0, -1, 0], [1, 0, Math.PI / 2], [-1, 0, Math.PI / 2]]) b.box(w * 0.3, hh - 2.4, 0.3, { x: x + dx * w / 2, y: yb + hh / 2, z: z + dz * w / 2, ry }, 'glowSoft');
      b.box(w + 0.9, 0.5, w + 0.9, { x, y: yt, z }, 'metal');
      yb = yt;
    });
    const top = y0 + h;
    if (kind === 'spire') {
      b.lathe([[2.4, 0], [1.3, 8], [0.45, 16], [0.1, 22]], { x, y: top, z }, 'ceramic', 12);
      b.sphere(0.5, { x, y: top + 22.4, z }, 'glowWhite', 8, 6);
    } else if (kind === 'ring') {
      b.cyl(0.5, 0.6, 4, { x, y: top + 2, z }, 'metal', 8);
      b.torus(wt * 0.95, 0.5, { x, y: top + 3.2, z }, 'shell', 8, 48);
      b.torus(wt * 0.95 - 0.5, 0.12, { x, y: top + 3.2, z }, 'glowSoft', 6, 48);
    } else {
      b.sphere(wt * 0.62, { x, y: top, z }, 'ceramic', 20, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      b.cyl(0.18, 0.25, 8, { x, y: top + wt * 0.62 + 3.5, z }, 'metal', 6);
      b.sphere(0.4, { x, y: top + wt * 0.62 + 7.6, z }, 'glowWhite', 8, 6);
    }
  };
  // 后排两座落在台基上；其余四座立在两翼 1、2 级层台的屋面上，从前缘后面升起
  [[-60, -96, 88, 'ring', 22], [66, -96, 74, 'spire', 21], [-113, 6, 46, 'spire', 12, 30], [113, 6, 46, 'spire', 12, 30], [-98, -2, 40, 'dome', 11, 44], [98, -2, 50, 'ring', 12, 44]].forEach(a => skyTower(...a));

  // 小无人机：3 架绕主楼慢飞（实例化，2 个 draw call；reducedMotion 静止）
  {
    const db = new kit.Builder(mats);
    db.sphere(0.9, { sy: 0.6 }, 'ceramic', 12, 8);
    for (const ry of [Math.PI / 4, -Math.PI / 4]) db.box(3.4, 0.12, 0.2, { ry }, 'ceramic');
    for (const [x, z] of [[1.2, 1.2], [-1.2, 1.2], [1.2, -1.2], [-1.2, -1.2]]) db.cyl(0.75, 0.75, 0.05, { x, z, y: 0.2 }, 'ceramic', 12);
    db.sphere(0.2, { z: 0.85, y: -0.05 }, 'glowWhite', 6, 4);
    const dg = db.build('drone'), N = 3;
    const parts = dg.children.map(m => { const im = kit.instanced(m.geometry, m.material, Array.from({ length: N }, () => new THREE.Matrix4()), 'drones'); im.frustumCulled = false; im.castShadow = false; root.add(im); return im; });
    const DR = [{ r: 105, y: 118, sp: 0.05, ph: 0.6 }, { r: 92, y: 132, sp: -0.065, ph: 3.1 }, { r: 118, y: 105, sp: 0.04, ph: 4.9 }];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), P = new THREE.Vector3(), one = new THREE.Vector3(2, 2, 2);
    const fly = (t) => {
      DR.forEach((d, i) => {
        const a = d.ph + t * d.sp;
        P.set(Math.sin(a) * d.r, d.y + Math.sin(t * 0.6 + i * 2) * 1.5, TZ + Math.cos(a) * d.r);
        q.setFromEuler(e.set(0, a + (d.sp > 0 ? Math.PI / 2 : -Math.PI / 2), Math.sin(t * 0.5 + i) * 0.08));
        m4.compose(P, q, one);
        parts.forEach(im => im.setMatrixAt(i, m4));
      });
      parts.forEach(im => { im.instanceMatrix.needsUpdate = true; });
    };
    fly(0);
    ticks.push((t) => { if (!reducedMotion) fly(t); });
  }

  // ───────── 10. 台基侧岛屿灯带与屋顶收尾 ─────────
  for (const [x, z] of [[-46, 42], [46, 42], [-46, -76], [46, -76]]) {
    b.cyl(0.3, 0.45, 18, { x, y: 69, z }, 'metal', 8);
    b.sphere(0.5, { x, y: 78.4, z }, 'glow', 10, 8);
  }
  // 屋面放射光线（俯视识别）：塔座外一圈 + 四向
  if (hi) {
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; b.box(0.14, 0.04, 14, { x: Math.sin(a) * 47, y: 60.55, z: TZ + Math.cos(a) * 47, ry: a }, 'glowSoft'); }
  }

  // ───────── 汇总 ─────────
  const body = b.build('body'); root.add(body);
  
  ticks.push((t) => { uT.value = t; });
  if (postM.length) {
    const posts = kit.instanced(new THREE.BoxGeometry(0.12, 1.1, 0.12), mats.metal, postM, 'rail-posts');
    root.add(posts);
  }
  // 大厅：单独一个 Builder 建，不与外观合并
  const hall = buildHall({ ...ctx, mats });
  root.add(hall.group, hall.core);          // group = 近景部分（按距离切 visible）；core = 常显的衬里与主屏
  ticks.push((t, dt) => hall.update?.(t, dt));
  const bounds = new THREE.Box3().setFromObject(root);   // 可见几何包围盒（外观热点命中盒不计入）

  // ───────── 热点 ─────────
  const H = (id, label, w, h, d, t, anchor) => {
    const m = kit.hotspot(id, w, h, d, t); m.userData.label = label;
    if (anchor) m.userData.anchor = V(...anchor);
    root.add(m); hot.push(m); return m;
  };
  H('base', '中央总部', 236, 252, 196, { y: 126, z: -6 }, [0, 30, 60]);
  H('base:portal', '迎宾大厅', 46, 52, 16, { y: 30, z: 52 }, [0, 26, 52]);
  H('base:beacon', '最新动态', 36, 44, 36, { y: 232, z: TZ }, [0, 236, TZ]);
  RINGS.forEach((rg, ri) => {
    const n = hi ? 14 : 8, seglen = 2 * Math.PI * rg.R / n * 1.04, sag = rg.R * (1 - Math.cos(Math.PI / n));
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2, rc = rg.R - sag / 2;     // 命中盒沿切向摆，径向加深并内移半个弦高，才罩得住弧
      const m = H('base:orbit', '空间导览', seglen, 8, 7 + sag, {}, null);
      const loc = new THREE.Matrix4().compose(V(Math.sin(a) * rc, 0, Math.cos(a) * rc), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, a, 0)), V(1, 1, 1));   // 局部 x = 切向
      m.applyMatrix4(ringMats[ri].clone().multiply(loc));
      const front = V(0, 0, rg.R).applyMatrix4(ringMats[ri]);
      m.userData.anchor = front;
    }
  });
  for (const h of hall.hotspots) { hot.push(h); }

  return {
    group: root,
    interior: hall.group,
    hotspots: hot,
    bounds,
    update(t, dt) { for (const f of ticks) f(t, dt); },
    dispose() { kit.disposeTree(root); shellLocal.forEach(m => m.dispose()); own.forEach(m => m.dispose()); gradTex.dispose(); },
  };
}
