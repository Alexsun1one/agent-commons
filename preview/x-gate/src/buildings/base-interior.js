// 中央总部 · 品牌迎宾大厅。局部坐标与总部相同；建在契约 BASE_INTERIOR 盒内。
// 本文件同时导出外观也要用的几何小工具（ribbon / beam / 偏移多边形 / 展开 UV），避免第二个文件。
export const HALL = { x0: -44, x1: 44, z0: -70, z1: 44, floorY: 4.06, ceilY: 46 };

// ───────── 共用几何小工具 ─────────

// 沿样条的“丝带”轮廓：返回可挤出的 Shape，以及左右边缘点（给发光线、内沿用）。width 可为数或 t→宽度。
export function ribbon(THREE, pts, width, { n = 48, tip = 0 } = {}) {
  const curve = new THREE.SplineCurve(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const P = curve.getPoints(n), L = [], R = [], C = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[Math.max(0, i - 1)], c = P[Math.min(P.length - 1, i + 1)];
    let tx = c.x - a.x, ty = c.y - a.y; const m = Math.hypot(tx, ty) || 1; tx /= m; ty /= m;
    const w = (typeof width === 'function' ? width(i / (P.length - 1)) : width) / 2;
    L.push(new THREE.Vector2(P[i].x - ty * w, P[i].y + tx * w));
    R.push(new THREE.Vector2(P[i].x + ty * w, P[i].y - tx * w));
    C.push(P[i]);
  }
  const shape = new THREE.Shape();
  shape.moveTo(L[0].x, L[0].y);
  for (let i = 1; i < L.length; i++) shape.lineTo(L[i].x, L[i].y);
  if (tip) {
    const e = P[P.length - 1], a = P[P.length - 2];
    let tx = e.x - a.x, ty = e.y - a.y; const m = Math.hypot(tx, ty) || 1;
    shape.lineTo(e.x + tx / m * tip, e.y + ty / m * tip);
  }
  for (let i = R.length - 1; i >= 0; i--) shape.lineTo(R[i].x, R[i].y);
  shape.closePath();
  return { shape, L, R, C };
}

// 两点之间的梁：返回矩阵，配合单位盒 BoxGeometry(1,1,1) 使用，sx/sy 为截面。
export function beamMatrix(THREE, a, c, sx, sy) {
  const A = new THREE.Vector3(...a), C = new THREE.Vector3(...c);
  const z = C.clone().sub(A), len = z.length(); z.normalize();
  const x = new THREE.Vector3(0, 1, 0).cross(z);                 // 水平截面轴：梁倾斜时不翻滚
  if (x.lengthSq() < 1e-8) x.set(1, 0, 0);
  x.normalize();
  const y = z.clone().cross(x).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, z).scale(new THREE.Vector3(sx, sy, len));
  return m.setPosition(A.add(C).multiplyScalar(0.5));
}

// 凸多边形外扩 d（米）；skip(i) 为真的顶点（贴着主体的根部）不动 z 方向外扩，仅钉在 x=rootX。
export function offsetPoly(pts, d, rootX = null) {
  const n = pts.length, out = [];
  let cx = 0, cz = 0; for (const [x, z] of pts) { cx += x / n; cz += z / n; }
  const normal = (a, b) => {
    const dx = b[0] - a[0], dz = b[1] - a[1], m = Math.hypot(dx, dz) || 1;
    let nx = dz / m, nz = -dx / m;
    const mx = (a[0] + b[0]) / 2 - cx, mz = (a[1] + b[1]) / 2 - cz;
    if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; }
    return [nx, nz];
  };
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[(i + n - 1) % n], c = pts[(i + 1) % n];
    const n1 = normal(a, p), n2 = normal(p, c);
    const k = 1 + n1[0] * n2[0] + n1[1] * n2[1];
    const s = d / Math.max(0.35, k);
    let q = [p[0] + (n1[0] + n2[0]) * s, p[1] + (n1[1] + n2[1]) * s];
    if (rootX !== null && Math.abs(Math.abs(p[0]) - Math.abs(rootX)) < 1e-6) q = [Math.sign(rootX) * (Math.abs(rootX) - 2), q[1]];
    out.push(q);
  }
  return out;
}

// 盒子 UV 改为“沿墙米数”：窗格在斜墙上也不被拉扁。tile=一张贴图覆盖多少米。用 Builder.add(..., { uv:false })。
export function wallUV(THREE, geo, tile = 16) {
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), ax = Math.abs(nor.getX(i)), ay = Math.abs(nor.getY(i)), az = Math.abs(nor.getZ(i));
    let u, v;
    if (ay > ax && ay > az) { u = x; v = z; } else if (ax > az) { u = z; v = y; } else { u = x; v = y; }
    uv[i * 2] = u / tile; uv[i * 2 + 1] = v / tile;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

// 旋转体的 UV：绕一圈连续，不在 45° 接缝处被三面投影撕开。tile=一张贴图覆盖的米数。
export function lathePro(THREE, pts, seg, tile = 4) {
  const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  const pos = g.attributes.position, uv = g.attributes.uv;
  let rmax = 0; for (const [r] of pts) rmax = Math.max(rmax, r);
  const circ = Math.PI * 2 * Math.max(rmax, 0.5);
  for (let i = 0; i < pos.count; i++) uv.setXY(i, uv.getX(i) * circ / tile, pos.getY(i) / tile);
  return g;
}

// 合并若干 Plane / Cylinder 几何为一个（保留 position/normal/uv），让一组面片只占 1 个 draw call。
export function mergeSimple(THREE, geos) {
  const P = [], N = [], U = [], I = []; let off = 0;
  for (const g of geos) {
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
    for (let i = 0; i < p.count; i++) { P.push(p.getX(i), p.getY(i), p.getZ(i)); N.push(n.getX(i), n.getY(i), n.getZ(i)); U.push(u.getX(i), u.getY(i)); }
    if (g.index) for (let i = 0; i < g.index.count; i++) I.push(g.index.getX(i) + off); else for (let i = 0; i < p.count; i++) I.push(i + off);
    off += p.count; g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  out.setIndex(I);
  return out;
}

// 熊猫全息：Y 轴公告板（光幕 + 外晕合一）+ 可选的环形光圈柱；整组最多 2 个 draw call。
// 贴图只在浏览器里加载（Node 体检 typeof document === 'undefined'）。items: [{ x, y, z, size }]（y=脚下标高，size=光幕边长）
let _pandaTex = null;
export function pandaHolo(ctx, items, { rings = true } = {}) {
  const { THREE, reducedMotion } = ctx;
  const K = 19 / 14;
  const group = new THREE.Group(); group.name = 'base:panda-holo';
  const uTime = { value: 0 }, uCam = { value: new THREE.Vector3(0, 12, 400) };
  if (typeof document !== 'undefined' && !_pandaTex) {
    _pandaTex = new THREE.TextureLoader().load(new URL('../../assets/panda-main-front-1024.webp', import.meta.url).href);
    _pandaTex.colorSpace = THREE.SRGBColorSpace; _pandaTex.anisotropy = 8;
  }
  const pos = [], cor = [], uv = [], idx = [];
  items.forEach((it, i) => {
    const S = it.size * K;
    [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, 1, 0, 1]].forEach(([sx, sy, u, v]) => { pos.push(it.x, it.y, it.z); cor.push(sx * S / 2, it.size / 2 + sy * S / 2); uv.push(u, v); });
    idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aCorner', new THREE.Float32BufferAttribute(cor, 2));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: _pandaTex }, uTime, uCam },
    transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    vertexShader: `attribute vec2 aCorner; uniform vec3 uCam; varying vec2 vUv;
      void main(){
        vUv = uv;
        vec2 d = uCam.xz - position.xz; float l = max(length(d), 1e-4); vec2 f = d / l;
        vec3 p = position + vec3(f.y, 0.0, -f.x) * aCorner.x + vec3(0.0, aCorner.y, 0.0);
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `uniform sampler2D map; uniform float uTime; varying vec2 vUv;
      void main(){
        vec2 pu = (vUv - 0.5) * ${K.toFixed(5)} + 0.5;
        float inside = step(0.0, pu.x) * step(pu.x, 1.0) * step(0.0, pu.y) * step(pu.y, 1.0);
        vec4 c = texture2D(map, clamp(pu, 0.0, 1.0)) * inside;
        float scan = 0.84 + 0.16 * sin(pu.y * 380.0 - uTime * 2.4);
        float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
        vec3 col = mix(c.rgb, vec3(0.30, 0.86, 1.0) * (0.5 + lum * 1.2), 0.22) * scan * 1.18;
        float pa = c.a * 0.94 * smoothstep(0.0, 0.1, pu.y);
        float r = length(vUv - 0.5) * 2.0;
        float ha = pow(max(0.0, 1.0 - r), 2.2) * 0.42;
        gl_FragColor = vec4(col * pa + vec3(0.22, 0.78, 1.0) * ha, pa);
      }`,
  });
  mat.name = 'base:panda';
  const quad = new THREE.Mesh(g, mat); quad.name = 'base:panda-holo'; quad.renderOrder = 4; quad.frustumCulled = false;
  quad.castShadow = quad.receiveShadow = false;
  group.add(quad);
  if (rings) {
    const cyl = items.map(it => { const c = new THREE.CylinderGeometry(it.size * 0.38, it.size * 0.52, it.size * 1.08, 48, 1, true); c.translate(it.x, it.y + it.size * 0.54, it.z); return c; });
    const rm = new THREE.ShaderMaterial({
      uniforms: { uTime }, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float uTime; varying vec2 vUv;
        void main(){
          float y = vUv.y, a = 0.0;
          for (int k = 0; k < 3; k++) {
            float fk = float(k);
            float line = 1.0 - smoothstep(0.0, fwidth(y) * 1.5 + 0.004, abs(y - (0.10 + fk * 0.40)));
            float f = fract(vUv.x * 3.0 + uTime * (0.10 + fk * 0.04) * (mod(fk, 2.0) < 0.5 ? 1.0 : -1.0) + fk * 0.37);
            a += line * smoothstep(0.0, 0.06, f) * (1.0 - smoothstep(0.50, 0.58, f));
          }
          gl_FragColor = vec4(vec3(0.18, 0.95, 1.0) * 2.6, clamp(a + 0.035 * (1.0 - y), 0.0, 1.0));
        }`,
    });
    rm.name = 'base:panda-rings';
    const rmesh = new THREE.Mesh(mergeSimple(THREE, cyl), rm); rmesh.name = 'base:panda-rings'; rmesh.renderOrder = 3; rmesh.frustumCulled = false;
    rmesh.castShadow = rmesh.receiveShadow = false;
    group.add(rmesh);
  }
  const tmp = new THREE.Vector3();
  return {
    group,
    update(t) {
      uTime.value = reducedMotion ? 0 : t;
      if (reducedMotion || !ctx.camera) return;
      ctx.camera.getWorldPosition(tmp); group.worldToLocal(tmp); uCam.value.copy(tmp);
    },
  };
}

// ───────── 迎宾大厅 ─────────
export const meta = { id: 'base-interior', name: '品牌迎宾大厅', en: 'WELCOME HALL' };

export function build(ctx) {
  const { THREE, kit, mats, quality, reducedMotion } = ctx;
  const hi = quality !== 'low';
  const { x0, x1, z0, z1, floorY: FY, ceilY: CY } = HALL;
  const group = new THREE.Group(); group.name = 'base:interior';      // 近景才显示的部分（按距离切 visible）：肋拱、导览窗、动态墙、起步台
  const core = new THREE.Group(); core.name = 'base:hall-core';       // 常显：内壁衬里 + 主屏 + 徽标 + 地面光带，保证远处从门洞也能透见大厅深处
  const b = new kit.Builder(mats), bc = new kit.Builder(mats);
  const ticks = [], hot = [];
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const env = ctx.scene?.environment || null;
  const std = (name, o) => { const m = new THREE.MeshStandardMaterial({ envMap: env, ...o }); m.name = name; return m; };
  const M = {
    wall: std('base:hallWall', { color: 0x1f2d42, metalness: 0.4, roughness: 0.6, envMapIntensity: 0.45 }),
    floor: std('base:hallFloor', { color: 0x0a1119, metalness: 0.88, roughness: 0.13, envMapIntensity: 0.4 }),
    rib: std('base:hallRib', { color: 0xdde6f0, metalness: 0.1, roughness: 0.5, envMapIntensity: 0.5 }),
    emb: std('base:hallEmblem', { color: 0xeaf1f8, metalness: 0.0, roughness: 0.55, envMapIntensity: 0.55, emissive: 0x27415c, emissiveIntensity: 0.55 }),
    ceil: std('base:hallCeil', { color: 0x1d2b40, metalness: 0.3, roughness: 0.6, envMapIntensity: 0.4, emissive: 0x16263f, emissiveIntensity: 1.0 }),
    sky: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.55, 1.75, 1.9) }),
  };
  M.sky.name = 'base:skylight';
  M.eBlue = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.46, 1.9) }); M.eBlue.name = 'base:eBlue';
  M.eViolet = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 0.8, 2.0) }); M.eViolet.name = 'base:eViolet';
  const owned = Object.values(M);            // 自建材质：dispose 时一并释放（envMap 是场景共享环境，标 shared 防止 disposeTree 连带释放）
  for (const m of owned) m.userData.shared = true;
  const uTime = { value: 0 };
  const sh = (name, uniforms, fragmentShader, o = {}) => {
    const m = new THREE.ShaderMaterial({ uniforms: { uTime, ...uniforms }, fragmentShader, side: THREE.DoubleSide, toneMapped: false, ...o,
      vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }' });
    m.name = name; owned.push(m); return m;
  };
  const FL = FY + 0.012, MID = (z0 + z1) / 2, HH = CY - FY;

  // ── 1. 内壁衬里（全部在盒内；外墙在盒外，所以从外面看不到大厅漏面）──
  bc.box(88, 0.6, 114, { y: FY - 0.3, z: MID }, M.floor);
  for (const s of [-1, 1]) {
    bc.box(0.5, HH, 114, { x: s * 43.75, y: (FY + CY) / 2, z: MID }, M.wall);
    bc.box(28, HH, 0.5, { x: s * 30, y: (FY + CY) / 2, z: z1 - 0.25 }, M.wall);
    bc.box(38, 0.5, 114, { x: s * 25, y: CY - 0.25, z: MID }, M.ceil);
  }
  bc.box(88, HH, 0.5, { y: (FY + CY) / 2, z: z0 + 0.25 }, M.wall);
  bc.box(32, CY - 44, 0.5, { y: (44 + CY) / 2, z: z1 - 0.25 }, M.wall);
  bc.box(12, 0.5, 8, { y: CY - 0.25, z: -66 }, M.ceil);
  bc.box(12, 0.12, 106, { y: CY - 0.06, z: -9 }, M.sky);                         // 天窗光带
  for (let z = 38; z > -62; z -= 7) bc.box(12.4, 0.34, 0.3, { y: CY - 0.2, z }, 'graphite');  // 天窗分格梃
  // 顶棚光槽：天窗两侧各两道细光线 + 与肋拱对位的横向暗缝，避免顶棚一片死黑
  for (const x of [-17, -26, 17, 26]) bc.box(0.22, 0.06, 104, { x, y: CY - 0.08, z: -9 }, 'glowSoft');
  for (const zc of [30, 16, 2, -12, -26, -40, -54]) for (const sg of [-1, 1]) bc.box(21.5, 0.2, 0.5, { x: sg * 22.5, y: CY - 0.12, z: zc }, 'graphite');
  // 洞口内壁（与外立面净开口 32 宽对齐）
  for (const s of [-1, 1]) bc.box(0.4, 40, 0.5, { x: s * 16.2, y: (FY + 44) / 2, z: z1 - 0.25 }, 'graphite');
  bc.box(32.8, 0.4, 0.5, { y: 44.2, z: z1 - 0.25 }, 'graphite');
  bc.box(32, 0.1, 0.12, { y: 43.75, z: z1 - 0.5 }, 'glowSoft');
  for (const s of [-1, 1]) bc.box(0.1, 39.4, 0.12, { x: s * 15.75, y: (FY + 43.7) / 2, z: z1 - 0.5 }, 'glowSoft');

  // ── 2. 肋拱：六榀拱架退进纵深 ──
  const archPts = [[-35.5, FY - 0.2], [-35.5, 20], [-31.6, 33], [-20, 41.4], [0, 44.4], [20, 41.4], [31.6, 33], [35.5, 20], [35.5, FY - 0.2]];
  const arch = ribbon(THREE, archPts, t => 3.4 - 1.6 * Math.sin(Math.PI * t), { n: 72 });
  const frameZ = [30, 16, 2, -12, -26, -40];
  frameZ.forEach((zc) => {
    b.extrude(arch.shape, 1.56, { z: zc - 0.78 }, M.rib, 0.12, 8);
    b.tube(arch.R.map(v => [v.x, v.y - 0.02, zc]), 0.1, {}, 'glowSoft', 72, 4);
    for (const s of [-1, 1]) { b.rbox(4.8, 1.3, 3.4, 0.25, { x: s * 35.5, y: FY + 0.65, z: zc }, 'graphite'); b.box(3.6, 0.07, 0.07, { x: s * 35.5, y: FY + 1.35, z: zc + 1.72 }, 'glowSoft'); }
  });
  // 侧墙：贴墙暗板分格 + 竖向光槽 + 踢脚光线
  for (const s of [-1, 1]) {
    b.box(0.16, 0.1, 112, { x: s * 43.4, y: FY + 0.4, z: MID }, 'glowSoft');
    b.box(0.3, 1.0, 112, { x: s * 43.3, y: FY + 0.55, z: MID }, 'graphite');
    for (const zc of [23, 9, -5, -19, -33, -47]) {
      for (const dz of [-6.6, 6.6]) b.box(0.4, HH - 2, 0.5, { x: s * 43.2, y: (FY + CY) / 2 - 0.2, z: zc + dz }, 'graphite');
    }
  }

  // ── 3. 地面：光带导向 + 圆徽 ──
  for (const s of [-1, 1]) bc.box(0.2, 0.03, 100, { x: s * 3.2, y: FL, z: -8 }, 'glowSoft');
  for (const s of [-1, 1]) bc.box(0.12, 0.03, 106, { x: s * 38.9, y: FL, z: -9 }, 'glowSoft');
  for (let z = 38; z > -58; z -= 9) for (const sg of [-1, 1]) bc.box(2.3, 0.03, 0.2, { x: sg * 0.9, y: FL, z, ry: -sg * 0.62 }, 'glowSoft');
  const MC = V(0, FL, -16);
  bc.torus(14, 0.09, { x: MC.x, y: MC.y, z: MC.z }, 'glowSoft', 4, 128);
  bc.torus(13.2, 0.05, { x: MC.x, y: MC.y, z: MC.z }, 'glow', 4, 128);
  bc.torus(8, 0.06, { x: MC.x, y: MC.y, z: MC.z }, 'glowSoft', 4, 96);
  for (const a of [Math.PI / 4, -Math.PI / 4]) bc.box(0.16, 0.03, 26, { x: MC.x, y: MC.y, z: MC.z, ry: a }, 'glowSoft');
  bc.cyl(2.6, 2.6, 0.04, { x: MC.x, y: MC.y, z: MC.z }, 'graphite', 32);
  if (hi) for (let i = -3; i <= 3; i++) { bc.box(0.05, 0.02, 114, { x: i * 11, y: FL - 0.004, z: MID }, 'ink'); }
  for (let z = 36; z > -64; z -= 11) bc.box(88, 0.02, 0.05, { y: FL - 0.004, z }, 'ink');

  // ── 4. 主墙：巨型弧形全息屏（品牌理念与使命）──
  const RW = 64, AW = Math.asin(40 / RW), SH = 33, SY0 = FY + 3;          // 屏半径、半张角、屏高、屏底
  const sw = 2 * RW * AW;
  const screenMat = sh('base:screen', { uSize: { value: new THREE.Vector2(sw, SH) } }, `
    uniform float uTime; uniform vec2 uSize; varying vec2 vUv; varying vec3 vW;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main(){
      vec2 P = vec2((vUv.x - 0.5) * uSize.x, vUv.y * uSize.y);
      float h = vUv.y;
      vec3 col = mix(vec3(0.020, 0.150, 0.250), vec3(0.008, 0.026, 0.085), smoothstep(0.0, 0.85, h));
      // 中心辉光（徽标位置）
      vec2 c = vec2(P.x, P.y - uSize.y * 0.62);
      float r = length(c);
      col += vec3(0.05, 0.30, 0.55) * exp(-r * r / 520.0) * 0.9;
      // HUD 同心环
      for (int i = 0; i < 3; i++) { float rr = 13.0 + float(i) * 6.5; col += vec3(0.1, 0.5, 0.8) * (1.0 - smoothstep(0.0, 0.16, abs(r - rr))) * 0.30 / (1.0 + float(i)); }
      // 网格
      vec2 g = abs(fract(P / 2.5 - 0.5) - 0.5) / max(fwidth(P / 2.5), vec2(1e-4));
      col += vec3(0.08, 0.40, 0.60) * (1.0 - min(min(g.x, g.y), 1.0)) * 0.12 * (0.35 + 0.65 * (1.0 - h));
      // 数据流：细竖条自上而下缓降，带渐隐拖尾
      float cell = 1.1, id = floor(P.x / cell);
      float bar = 1.0 - smoothstep(0.10, 0.20, abs(fract(P.x / cell) - 0.5));
      float ph = fract(h * 1.2 + uTime * (0.010 + hash(vec2(id, 7.0)) * 0.022) + hash(vec2(id, 1.0)));
      float on = step(0.68, hash(vec2(id, 5.0)));
      float tail = smoothstep(0.0, 0.012, ph) * (1.0 - smoothstep(0.0, 0.2, ph));
      col += vec3(0.25, 0.8, 1.0) * on * bar * (tail * 0.42 + (1.0 - smoothstep(0.0, 0.02, ph)) * 0.5) * smoothstep(0.0, 0.25, 1.0 - h);
      // 扫描带
      float sc = fract(h * 0.8 - uTime * 0.045);
      col += vec3(0.1, 0.4, 0.7) * smoothstep(0.0, 0.01, sc) * (1.0 - smoothstep(0.01, 0.07, sc)) * 0.35;
      // 边框与暗角
      float ex = min(vUv.x, 1.0 - vUv.x) * uSize.x, ey = min(vUv.y, 1.0 - vUv.y) * uSize.y;
      float e = min(ex, ey);
      col += vec3(0.3, 0.9, 1.2) * (1.0 - smoothstep(0.0, 0.12, abs(e - 0.9))) * 1.2;
      col *= 0.55 + 0.45 * smoothstep(0.0, 6.0, e);
      gl_FragColor = vec4(col, 1.0);
    }`);
  const screen = new THREE.Mesh(new THREE.CylinderGeometry(RW - 0.06, RW - 0.06, SH, hi ? 96 : 48, 1, true, Math.PI - AW, 2 * AW), screenMat);
  screen.position.set(0, SY0 + SH / 2, 0); screen.name = 'base:screen'; core.add(screen);
  // 屏体：上下横梁（沿弧的管）、端柱、台座
  const arcPts = (R, y, n = 40) => Array.from({ length: n + 1 }, (_, i) => { const a = Math.PI - AW + (2 * AW) * i / n; return [Math.sin(a) * R, y, Math.cos(a) * R]; });
  for (const y of [SY0 - 0.5, SY0 + SH + 0.5]) { bc.tube(arcPts(RW + 0.1, y), 0.55, {}, 'graphite', 80, 8); bc.tube(arcPts(RW - 0.55, y + (y < SY0 + 1 ? 0.45 : -0.45)), 0.09, {}, 'glowSoft', 80, 4); }
  for (const s of [-1, 1]) { const a = Math.PI + s * AW; bc.push({ x: Math.sin(a) * RW, z: Math.cos(a) * RW, ry: a }); bc.rbox(2.4, SH + 6, 2.2, 0.35, { y: SY0 + SH / 2, z: 0.5 }, 'graphite'); bc.box(0.12, SH + 2, 0.14, { y: SY0 + SH / 2, z: -0.65 }, 'glowSoft'); bc.pop(); }
  {
    const st = new THREE.Shape(); const pt = (R, a) => [R * Math.sin(a), -R * Math.cos(a)];
    const n = 40, R0 = RW + 2.2, R1 = RW - 6;
    for (let i = 0; i <= n; i++) { const a = Math.PI - AW + 2 * AW * i / n, [x, y] = pt(R0, a); i ? st.lineTo(x, y) : st.moveTo(x, y); }
    for (let i = n; i >= 0; i--) { const a = Math.PI - AW + 2 * AW * i / n, [x, y] = pt(R1, a); st.lineTo(x, y); }
    bc.extrude(st, 2.3, { rx: -Math.PI / 2, y: FY }, 'shellCool', 0.2, 6);
    bc.tube(arcPts(R1 + 0.15, FY + 2.55), 0.09, {}, 'glowSoft', 80, 4);
    bc.tube(arcPts(RW - 2.5, SY0 - 1.2), 0.07, {}, 'glowSoft', 80, 4);
  }
  // 徽标：与立面同源的 X 形双翼，悬在屏前
  {
    const ex = 22 / 26, pts = [[7, 0], [7, 4.5], [5.8, 8.5], [3, 11.5], [0, 13], [-3, 14.5], [-5.8, 17.5], [-7, 21.5], [-7, 26]].map(([x, y]) => [x * ex, y * ex]);
    const EY = SY0 + 12.2, EZ = -60.6;
    for (const [s, dz] of [[1, 0], [-1, -0.5]]) {
      const pp = pts.map(([x, y]) => [x * s, y]);
      const rb = ribbon(THREE, pp, t => 3.0 - 1.0 * t, { n: 40, tip: 0.8 });
      bc.extrude(rb.shape, 1.0, { y: EY, z: EZ + dz }, M.emb, 0.14, 6);
      const inn = ribbon(THREE, pp, t => 1.0 - 0.4 * t, { n: 40 });
      for (const arr of [inn.L]) bc.tube(arr.map(v => [v.x, EY + v.y, EZ + dz + 1.2]), 0.07, {}, 'glowSoft', 40, 4);
    }
    bc.torus(14.2, 0.12, { y: EY + 11, z: EZ - 1.2, rx: 0 }, 'glowSoft', 4, 128);
    bc.torus(14.9, 0.04, { y: EY + 11, z: EZ - 1.2, rx: 0 }, 'glowSoft', 4, 128);
    const mission = kit.textPanel('连接人与 AI，汇聚社群力量', { height: 3.8, color: '#ffffff', glow: '#7fe9ff' });
    mission.position.set(0, SY0 + 5.4, -61.4); core.add(mission);
    mission.traverse(o => { if (o.isMesh) o.renderOrder = 6; });
    for (let i = -1; i <= 1; i++) bc.cyl(0.42, 0.42, 0.1, { x: i * 2.6, y: SY0 + 1.8, z: -61.6, rx: Math.PI / 2 }, i === -1 ? 'glow' : 'glowSoft', 16);
    const hb = kit.hotspot('base:brand', 82, SH + 2, 16, { y: SY0 + SH / 2, z: -57 });   // 屏为凹弧：中央 z=-64、两端 z≈-50，命中盒要罩住整条弧（z∈[-65,-49]）
    hb.userData.label = '品牌理念'; hb.userData.anchor = V(0, SY0 + SH / 2, -60); core.add(hb); hot.push(hb);
  }
  // 地面倒影光：屏光在高反射地面上的拉伸（加色，不写深度）
  {
    const gm = sh('base:floorGlow', {}, `
      uniform float uTime; varying vec2 vUv; varying vec3 vW;
      float hash(float p){ return fract(sin(p * 127.1) * 43758.5453); }
      void main(){
        float d = ${RW.toFixed(1)} - length(vW.xz);          // 距屏的距离（屏前为正）
        float fall = exp(-max(d, 0.0) / 11.0) * step(0.0, d);
        float col = floor(vW.x * 0.8);
        float streak = 0.55 + 0.45 * hash(col) * (0.7 + 0.3 * sin(uTime * 0.4 + col));
        float edge = 1.0 - smoothstep(30.0, 42.0, abs(vW.x));
        vec3 c = mix(vec3(0.05, 0.32, 0.55), vec3(0.1, 0.55, 0.85), exp(-max(d, 0.0) / 5.0));
        float a = clamp(fall * streak * edge * 0.85, 0.0, 1.0);
        gl_FragColor = vec4(c * 2.0, a);
      }`, { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const fg = new THREE.Mesh(new THREE.PlaneGeometry(86, 40), gm); fg.rotation.x = -Math.PI / 2; fg.position.set(0, FL + 0.02, -48); fg.renderOrder = 2; fg.name = 'base:floor-glow';
    core.add(fg);
  }

  // ── 5. 空间导览窗：左墙 network / cocreation，右墙 hub / value ──
  const paneMat = sh('base:pane', {}, `
    uniform float uTime; varying vec2 vUv;
    void main(){
      float idx = floor(vUv.y); vec2 uv = vec2(vUv.x, clamp((vUv.y - idx - 0.001) / 0.998, 0.0, 1.0));
      vec3 tint = idx < 0.5 ? vec3(0.20, 0.85, 1.0) : idx < 1.5 ? vec3(0.22, 0.60, 1.0) : idx < 2.5 ? vec3(0.25, 0.45, 1.0) : vec3(0.58, 0.50, 1.0);
      vec3 sky = mix(vec3(0.025, 0.06, 0.16), vec3(0.09, 0.26, 0.44), pow(uv.y, 0.8));
      float hq = (uv.y - 0.30) * 7.0; float hz = exp(-hq * hq);
      vec3 col = sky + tint * hz * 0.30;
      float cl = 0.5 + 0.5 * sin(uv.x * 9.0 + uTime * 0.05) * sin(uv.x * 4.0 - uTime * 0.03);
      col += tint * (1.0 - smoothstep(0.0, 0.30, uv.y)) * 0.10 * cl;
      vec2 g = abs(fract(vec2(uv.x * 6.0, uv.y * 9.0) - 0.5) - 0.5) / fwidth(vec2(uv.x * 6.0, uv.y * 9.0));
      col += tint * (1.0 - min(min(g.x, g.y), 1.0)) * 0.05;
      col = max(col, vec3(0.0)); if (isnan(col.r + col.g + col.b)) col = vec3(0.0);
      gl_FragColor = vec4(col, 1.0);
    }`);
  const paneGeos = [];
  const GUIDE = [
    { id: 'network', label: '智能体连接中心', s: -1, z: -19, idx: 0, mat: 'glowSoft', to: [-300, 30] },
    { id: 'cocreation', label: '社区共创中心', s: -1, z: -33, idx: 2, mat: M.eBlue, to: [-210, -250] },
    { id: 'hub', label: '智能体管理中心', s: 1, z: -19, idx: 1, mat: 'glowSoft', to: [300, 30] },
    { id: 'value', label: '价值中心', s: 1, z: -33, idx: 3, mat: M.eViolet, to: [210, -250] },
  ];
  const WY = FY + 12.5, PW = 12, PH = 18;
  for (const g of GUIDE) {
    const wx = g.s * 43.5, ry = g.s < 0 ? Math.PI / 2 : -Math.PI / 2;
    b.push({ x: wx, y: WY, z: g.z, ry });
    // 框（暗色）+ 窗台 + 发光边
    b.box(PW + 1.6, 0.8, 0.9, { y: PH / 2 + 0.4, z: 0.3 }, 'graphite'); b.box(PW + 1.6, 0.8, 0.9, { y: -PH / 2 - 0.4, z: 0.3 }, 'graphite');
    for (const sx of [-1, 1]) b.box(0.8, PH + 1.6, 0.9, { x: sx * (PW / 2 + 0.4), z: 0.3 }, 'graphite');
    b.rbox(PW + 2.4, 0.9, 2.2, 0.2, { y: -PH / 2 - 1.2, z: 0.8 }, 'shellCool');
    const e = g.mat;
    b.box(PW, 0.14, 0.14, { y: PH / 2, z: 0.6 }, e); b.box(PW, 0.14, 0.14, { y: -PH / 2, z: 0.6 }, e);
    for (const sx of [-1, 1]) b.box(0.14, PH, 0.14, { x: sx * PW / 2, z: 0.6 }, e);
    // 方向标记：罗盘 + 指针（指向该建筑方位）+ 建筑线稿
    const wxw = g.s * 43.5, dx = g.to[0] - wxw, dz = g.to[1] - g.z;
    const ex = [Math.cos(ry), -Math.sin(ry)], ez = [Math.sin(ry), Math.cos(ry)];    // 局部 x / z 的世界 xz 方向
    const phi = Math.atan2(dx * ex[0] + dz * ex[1], -(dx * ez[0] + dz * ez[1]));
    b.torus(2.5, 0.07, { y: -PH / 2 + 3.3, z: 0.7, rx: 0 }, e, 4, 48);
    b.torus(1.6, 0.04, { y: -PH / 2 + 3.3, z: 0.7, rx: 0 }, e, 4, 36);
    b.push({ y: -PH / 2 + 3.3, z: 0.75, rz: -phi });
    b.box(0.14, 2.6, 0.1, { y: 1.3 }, e); b.add(new THREE.ConeGeometry(0.42, 0.9, 3), { y: 2.9 }, e);
    b.pop();
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; b.box(0.08, 0.5, 0.06, { x: Math.sin(a) * 2.8, y: -PH / 2 + 3.3 + Math.cos(a) * 2.8, z: 0.7, rz: -a }, e); }
    b.push({ y: 1.9, z: 0.7 });
    const ln = (x1, y1, x2, y2, w = 0.15) => b.box(Math.hypot(x2 - x1, y2 - y1), w, 0.1, { x: (x1 + x2) / 2, y: (y1 + y2) / 2, rz: Math.atan2(y2 - y1, x2 - x1) }, e);
    const ring = (cx, cy, r, w = 0.07) => b.torus(r, w, { x: cx, y: cy, rx: 0 }, e, 4, 56);
    const node = (cx, cy, r) => b.sphere(r, { x: cx, y: cy }, e, 12, 8);
    const poly = (pts) => pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length]; ln(p[0], p[1], q[0], q[1]); });
    if (g.id === 'network') {                       // 连接：中心节点 + 五个卫星节点
      node(0, 0, 0.85);
      for (let k = 0; k < 5; k++) { const a = Math.PI / 2 + k * Math.PI * 2 / 5, x = Math.cos(a) * 3.5, y = Math.sin(a) * 3.5; ln(0, 0, x, y, 0.1); node(x, y, 0.5); ring(x, y, 0.95, 0.04); }
      ring(0, 0, 3.5, 0.04); ring(0, 0, 1.5, 0.05);
    } else if (g.id === 'hub') {                    // 管理：三层面板 + 状态灯
      for (let k = 0; k < 3; k++) {
        const y = 2.6 - k * 2.6;
        poly([[-3.4, y + 0.9], [3.4, y + 0.9], [3.4, y - 0.9], [-3.4, y - 0.9]]);
        node(-2.4, y, 0.24); ln(-1.3, y, 2.4, y, 0.1);
      }
      ln(0, -3.9, 0, -4.8, 0.12); ln(-1.6, -4.8, 1.6, -4.8, 0.12);
    } else if (g.id === 'cocreation') {             // 共创：三环交汇
      for (let k = 0; k < 3; k++) { const a = Math.PI / 2 + k * Math.PI * 2 / 3; ring(Math.cos(a) * 1.5, Math.sin(a) * 1.5 + 0.2, 2.5, 0.09); }
      node(0, 0.2, 0.5);
    } else {                                        // 价值：宝石
      poly([[-1.9, 3.0], [1.9, 3.0], [3.8, 0.7], [0, -3.8], [-3.8, 0.7]]);
      ln(-3.8, 0.7, 3.8, 0.7, 0.1);
      ln(-1.9, 3.0, -1.3, 0.7, 0.1); ln(1.9, 3.0, 1.3, 0.7, 0.1); ln(-1.3, 0.7, 0, -3.8, 0.1); ln(1.3, 0.7, 0, -3.8, 0.1);
      ln(0, 3.0, 0, 0.7, 0.07);
    }
    b.pop();
    b.pop();
    // 窗内景（共用着色器，v 里编码窗序号）
    const pg = new THREE.PlaneGeometry(PW, PH);
    const uv = pg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * 0.998 + 0.001 + g.idx);
    pg.applyMatrix4(kit.toMatrix({ x: wx - g.s * 0.12, y: WY, z: g.z, ry }));
    paneGeos.push(pg);
    const hs = kit.hotspot(`base:guide:${g.id}`, 2.6, PH + 3, PW + 1.6, { x: wx - g.s * 1.3, y: WY, z: g.z });   // 窗贴在侧墙上：盒子 x 向薄（只罩住窗框与窗台），免得斜视时近窗的盒子挡住远窗
    hs.userData.label = g.label; hs.userData.anchor = V(wx - g.s * 1.2, WY, g.z); group.add(hs); hot.push(hs);
  }
  { const m = new THREE.Mesh(mergeSimple(THREE, paneGeos), paneMat); m.name = 'base:pane'; m.castShadow = false; group.add(m); }

  // ── 6. 动态墙：左墙竖向全息条带（热点 base:news）──
  {
    const NZ = 9, NX = -43.3;
    const stripMat = sh('base:strip', {}, `
      uniform float uTime; varying vec2 vUv; varying vec3 vW;
      void main(){
        float seed = floor(vUv.y); vec2 uv = vec2(vUv.x, clamp((vUv.y - seed - 0.001) / 0.998, 0.0, 1.0));
        float fade = pow(1.0 - uv.y, 1.35);
        float scan = 0.82 + 0.18 * sin(vW.y * 9.0 - uTime * 1.6 + seed);
        float sq = (fract(uTime * 0.07 + seed * 0.13) - uv.y) * 9.0; float sweep = exp(-sq * sq) * 0.8;
        float edge = 1.0 - smoothstep(0.35, 0.5, abs(uv.x - 0.5));
        vec3 base = mix(vec3(0.18, 0.62, 1.0), vec3(0.30, 0.95, 1.0), uv.y);
        float a = (fade * 0.85 + sweep) * scan * (0.35 + 0.65 * edge);
        gl_FragColor = vec4(base * a * 0.9, a);
      }`, { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const hs = [16, 11, 22, 8, 19, 13, 24, 10, 17, 21, 9], stripGeos = [];
    hs.forEach((h, i) => {
      const pg = new THREE.PlaneGeometry(0.95, h); pg.translate(0, h / 2, 0);
      const uv = pg.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setY(k, uv.getY(k) * 0.998 + 0.001 + i);
      pg.applyMatrix4(kit.toMatrix({ x: NX + 0.2 + (i % 3) * 0.08, y: FY + 2.4, z: NZ - 6.2 + i * 1.24, ry: Math.PI / 2 }));
      stripGeos.push(pg);
      b.box(0.5, 0.12, 0.7, { x: NX, y: FY + 2.1, z: NZ - 6.2 + i * 1.24 }, i % 4 === 0 ? 'glow' : 'glowSoft');
    });
    { const m = new THREE.Mesh(mergeSimple(THREE, stripGeos), stripMat); m.renderOrder = 3; m.name = 'base:strip'; m.castShadow = false; group.add(m); }
    b.rbox(0.8, 0.5, 15.4, 0.15, { x: NX + 0.1, y: FY + 1.7, z: NZ }, 'graphite');
    b.box(0.5, 0.4, 15.4, { x: NX + 0.1, y: FY + 28.4, z: NZ }, 'graphite');
    b.box(0.12, 0.08, 15.0, { x: NX + 0.45, y: FY + 28.1, z: NZ }, 'glowSoft');
    const h = kit.hotspot('base:news', 4, 28, 16.5, { x: NX + 1.5, y: FY + 15, z: NZ });
    h.userData.label = '最新动态'; h.userData.anchor = V(NX + 1.2, FY + 15, NZ); group.add(h); hot.push(h);
  }

  // ── 7. 新人起步台：右侧服务台 + 熊猫小全息（热点 base:start）──
  {
    const DX = 22, DZ = -8, R = 6.4, A = 1.25;
    b.push({ x: DX, y: FY, z: DZ, ry: -0.42 });
    b.cyl(10.2, 10.6, 0.5, { y: 0.25 }, 'graphite', 48); b.torus(10.3, 0.07, { y: 0.52 }, 'glowSoft', 4, 96); b.torus(8.4, 0.05, { y: 0.52 }, 'glowSoft', 4, 96);
    // 弧形柜台 + 背景弧墙（凹向访客）
    b.lathe([[R + 1.0, 0.5], [R + 1.0, 1.05], [R + 0.9, 1.12], [R - 0.9, 1.12], [R - 0.9, 0.5]], { z: 3 }, 'shell', 40, Math.PI - A, 2 * A);
    b.lathe([[R + 1.05, 0.5], [R + 1.05, 1.0], [R + 0.95, 1.0], [R + 0.95, 0.5]], { z: 3 }, 'graphite', 40, Math.PI - A, 2 * A);
    b.torus(R - 0.85, 0.035, { y: 1.14, z: 3, ry: Math.PI / 2 + A }, 'glowSoft', 4, 48, 2 * A);
    b.lathe([[R + 1.7, 0.5], [R + 1.7, 4.9], [R + 1.4, 4.9], [R + 1.4, 0.5]], { z: 3 }, 'graphite', 40, Math.PI - A, 2 * A);
    b.torus(R + 1.7, 0.05, { y: 4.95, z: 3, ry: Math.PI / 2 + A }, 'glowSoft', 4, 48, 2 * A);
    b.torus(R + 1.38, 0.04, { y: 3.2, z: 3, ry: Math.PI / 2 + A }, 'glowSoft', 4, 48, 2 * A);
    for (const s of [-1, 1]) { const a = Math.PI + s * A; b.rbox(0.7, 5.2, 1.1, 0.15, { x: Math.sin(a) * (R + 1.55), y: 2.6, z: 3 + Math.cos(a) * (R + 1.55), ry: a }, 'shellCool'); }
    // 三步起步桩
    for (let i = 0; i < 3; i++) { const x = (i - 1) * 4.2, z = 9.2 - Math.abs(i - 1) * 1.1; b.cyl(0.55, 0.65, 0.9, { x, y: 0.95, z }, 'shell', 14); b.torus(0.75, 0.05, { x, y: 1.42, z }, i === 0 ? 'glow' : 'glowSoft', 4, 24); b.cyl(0.14, 0.14, 0.04, { x, y: 1.44, z }, 'glowWhite', 8); }
    b.pop();
    const PD = V(DX - 2.0, FY + 1.0, DZ + 2.4);
    b.cyl(1.9, 2.1, 0.5, { x: PD.x, y: PD.y - 0.25, z: PD.z }, 'shellCool', 28); b.torus(1.9, 0.05, { x: PD.x, y: PD.y + 0.02, z: PD.z }, 'glow', 4, 48); b.torus(1.3, 0.04, { x: PD.x, y: PD.y + 0.02, z: PD.z }, 'glowSoft', 4, 48);
    const ph = pandaHolo(ctx, [{ x: PD.x, y: PD.y, z: PD.z, size: 6.4 }], { rings: false });
    group.add(ph.group); ticks.push(ph.update);
    // 命中盒贴着实体摆（弧墙柜台 / 平台与起步桩 / 熊猫全息）：一个大盒会抢走身后导览窗与主屏的点击
    const deskM = new THREE.Matrix4().compose(V(DX, FY, DZ), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -0.42, 0)), V(1, 1, 1));
    const startBox = (w, h, d, t, local) => {
      const m = kit.hotspot('base:start', w, h, d, t); if (local) m.applyMatrix4(deskM);
      m.userData.label = '新人起步'; m.userData.anchor = V(DX, FY + 5, DZ); group.add(m); hot.push(m);
    };
    startBox(16, 5.4, 6.2, { y: 2.7, z: -2.0 }, true);          // 背景弧墙 + 柜台（桌体局部系）
    startBox(21.2, 1.8, 21.2, { y: 0.9 }, true);                // 平台 + 起步桩
    startBox(4.4, 7.2, 4.4, { x: PD.x, y: FY + 4.6, z: PD.z }, false);   // 熊猫全息（世界系，贴着熊猫轮廓）
  }

  // ── 9. 汇总 ──
  group.add(b.build('hall')); core.add(bc.build('hallcore'));
  for (const g of [group, core]) g.traverse(o => { if (o.isMesh) o.castShadow = false; });
  ticks.push((t) => { uTime.value = reducedMotion ? 0 : t; });
  return {
    group, core, hotspots: hot,
    update(t, dt) { for (const f of ticks) f(t, dt); },
    dispose() { kit.disposeTree(group); kit.disposeTree(core); for (const m of owned) m.dispose?.(); },
  };
}
