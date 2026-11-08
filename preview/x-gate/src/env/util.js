// ENV 共用工具：噪声、轮廓放样、贴图与只读镜头保护区。
import * as THREE from 'three';
import { PLACES, facingRotation } from '../kit/world.js';

export const TAU = Math.PI * 2;
export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

function h3(ix, iy, iz, s) {
  let h = (Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(iz, 0x9e3779b1) ^ Math.imul(s | 0, 0x85ebca6b)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
export function noise3(x, y, z, s = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const a = h3(ix, iy, iz, s), b = h3(ix + 1, iy, iz, s), c = h3(ix, iy + 1, iz, s), d = h3(ix + 1, iy + 1, iz, s);
  const e = h3(ix, iy, iz + 1, s), f = h3(ix + 1, iy, iz + 1, s), g = h3(ix, iy + 1, iz + 1, s), h = h3(ix + 1, iy + 1, iz + 1, s);
  const x1 = a + (b - a) * u, x2 = c + (d - c) * u, x3 = e + (f - e) * u, x4 = g + (h - g) * u;
  const y1 = x1 + (x2 - x1) * v, y2 = x3 + (x4 - x3) * v;
  return y1 + (y2 - y1) * w;
}
export function fbm3(x, y, z, s = 0, oct = 4) {
  let a = 0.5, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) { sum += a * noise3(x * f, y * f, z * f, s + i * 17); norm += a; a *= 0.5; f *= 2.03; }
  return sum / norm;
}
export const ridged3 = (x, y, z, s = 0) => 1 - Math.abs(2 * noise3(x, y, z, s) - 1);

// 岛轮廓：半径函数 R(θ)，θ = atan2(z, x)。
export function makeOutline(R, seed, extra = null) {
  return (th) => R * (1 + 0.022 * Math.sin(2 * th + seed) + 0.014 * Math.sin(3 * th + seed * 2.1) + 0.009 * Math.sin(7 * th + seed * 0.7) + (extra ? extra(th) : 0));
}

// 绕圆周放样。rings[k](θ, i) → [x,y,z]；expect 决定外法线朝向：'up' | 'down' | 'out' | 'in'（自动翻转绕序）。
// skip(θ)：为真的扇区不生成面（栏杆为桥头留口）。
export function loft(n, rings, expect, { cx = 0, cz = 0, skip = null } = {}) {
  const K = rings.length, pos = new Float32Array(K * n * 3);
  for (let k = 0; k < K; k++) for (let i = 0; i < n; i++) {
    const p = rings[k](i / n * TAU, i); const o = (k * n + i) * 3;
    pos[o] = p[0]; pos[o + 1] = p[1]; pos[o + 2] = p[2];
  }
  const idx = [];
  for (let k = 0; k < K - 1; k++) for (let i = 0; i < n; i++) {
    if (skip && skip((i + 0.5) / n * TAU)) continue;
    const i2 = (i + 1) % n, a = k * n + i, b = k * n + i2, c = (k + 1) * n + i2, d = (k + 1) * n + i;
    idx.push(a, b, c, a, c, d);
  }
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3(), E = new THREE.Vector3();
  let vote = 0;
  const D = new THREE.Vector3();
  for (let t = 0; t < idx.length; t += 3 * 5) {
    A.fromArray(pos, idx[t] * 3); B.fromArray(pos, idx[t + 1] * 3); C.fromArray(pos, idx[t + 2] * 3);
    N.subVectors(B, A).cross(D.subVectors(C, A));
    if (expect === 'up') E.set(0, 1, 0); else if (expect === 'down') E.set(0, -1, 0);
    else { E.set((A.x + B.x + C.x) / 3 - cx, 0, (A.z + B.z + C.z) / 3 - cz).normalize(); if (expect === 'in') E.negate(); }
    vote += Math.sign(N.dot(E)) * Math.min(1, N.length());
  }
  if (vote < 0) for (let t = 0; t < idx.length; t += 3) { const q = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = q; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// 沿曲线扫掠截面（桥）。frames[i] = { P, S, U }；pts 为 (横向, 竖向) 折线，**顺时针**走向（沿行进方向左侧为外）。
// 每段独立顶点（保留硬边），绕序自动对准外法线。pts 可为函数 (frame, i) → 折线。
export function sweep(frames, pts) {
  const pos = [], idx = [];
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3(), E = new THREE.Vector3(), D = new THREE.Vector3();
  const F = frames.length;
  const polys = frames.map((f, i) => typeof pts === 'function' ? pts(f, i) : pts);
  const segs = polys[0].length - 1;
  for (let s = 0; s < segs; s++) {
    const base = pos.length / 3;
    for (let i = 0; i < F; i++) {
      const f = frames[i], p0 = polys[i][s], p1 = polys[i][s + 1];
      pos.push(f.P.x + f.S.x * p0[0] + f.U.x * p0[1], f.P.y + f.S.y * p0[0] + f.U.y * p0[1], f.P.z + f.S.z * p0[0] + f.U.z * p0[1],
        f.P.x + f.S.x * p1[0] + f.U.x * p1[1], f.P.y + f.S.y * p1[0] + f.U.y * p1[1], f.P.z + f.S.z * p1[0] + f.U.z * p1[1]);
    }
    const mid = Math.floor(F / 2), f = frames[mid], p0 = polys[mid][s], p1 = polys[mid][s + 1];
    const dl = p1[0] - p0[0], dd = p1[1] - p0[1];
    E.set(0, 0, 0).addScaledVector(f.S, -dd).addScaledVector(f.U, dl);
    const tri = [];
    for (let i = 0; i < F - 1; i++) { const a = base + i * 2, b = base + i * 2 + 1, c = base + (i + 1) * 2 + 1, d = base + (i + 1) * 2; tri.push([a, b, c], [a, c, d]); }
    A.fromArray(pos, tri[Math.floor(tri.length / 2)][0] * 3); B.fromArray(pos, tri[Math.floor(tri.length / 2)][1] * 3); C.fromArray(pos, tri[Math.floor(tri.length / 2)][2] * 3);
    N.subVectors(B, A).cross(D.subVectors(C, A));
    const flip = N.dot(E) < 0;
    for (const [a, b, c] of tri) idx.push(a, flip ? c : b, flip ? b : c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// 梁：沿 a→b 的方形截面，Builder.add 的矩阵。
const _y = new THREE.Vector3(0, 1, 0), _q = new THREE.Quaternion(), _d = new THREE.Vector3(), _m = new THREE.Vector3(), _s = new THREE.Vector3();
export function beam(a, b, t = 0.3, td = t) {
  _d.subVectors(b, a); const len = _d.length(); _d.divideScalar(len || 1);
  _q.setFromUnitVectors(_y, _d); _m.addVectors(a, b).multiplyScalar(0.5); _s.set(t, len, td);
  return new THREE.Matrix4().compose(_m, _q, _s);
}

// 可平铺噪声贴图：r 平滑云团，g 另一种子，b 高频细节，a 鼓包（柔云）。
export function makeNoiseTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  const lattices = new Map();
  const lat = (period, seed) => {
    const key = period * 4096 + seed;
    let a = lattices.get(key);
    if (!a) { a = new Float32Array(period * period); for (let i = 0; i < a.length; i++) a[i] = h3(i % period, (i / period) | 0, 7, seed); lattices.set(key, a); }
    return a;
  };
  const tile = (period, seed, u, v) => {
    const L = lat(period, seed), m = period - 1, x = u * period, y = v * period, ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const x0 = ix & m, x1 = (ix + 1) & m, y0 = (iy & m) * period, y1 = ((iy + 1) & m) * period;
    const a = L[y0 + x0], b = L[y0 + x1], c = L[y1 + x0], d = L[y1 + x1];
    const top = a + (b - a) * sx;
    return top + (c + (d - c) * sx - top) * sy;
  };
  const fb = (u, v, p0, oct, seed) => { let s = 0, n = 0, a = 0.5, p = p0; for (let i = 0; i < oct; i++) { s += a * tile(p, seed + i, u, v); n += a; a *= 0.5; p *= 2; } return s / n; };
  const raw = new Float32Array(size * size * 4);
  const lo = [1e9, 1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9, -1e9];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, o = (y * size + x) * 4;
    raw[o] = fb(u, v, 4, 5, 3); raw[o + 1] = fb(u, v, 4, 5, 41); raw[o + 2] = fb(u, v, 16, 4, 77);
    raw[o + 3] = 1 - Math.abs(2 * fb(u, v, 8, 4, 131) - 1);
    for (let c = 0; c < 4; c++) { lo[c] = Math.min(lo[c], raw[o + c]); hi[c] = Math.max(hi[c], raw[o + c]); }
  }
  for (let i = 0; i < raw.length; i++) { const c = i & 3; data[i] = Math.round(clamp((raw[i] - lo[c]) / (hi[c] - lo[c] || 1)) * 255); }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true; tex.anisotropy = 4; tex.needsUpdate = true;
  tex.name = 'env:noise';
  return tex;
}

// 云团精灵：柔边鼓包。alpha = 轮廓密度。
export function makePuffTexture(size = 128) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = (x + 0.5) / size * 2 - 1, py = (y + 0.5) / size * 2 - 1;
    const r = Math.hypot(px, py);
    const n = fbm3(px * 2.3 + 5, py * 2.3 + 9, 1.7, 5, 4);
    const k = 1 - smooth(0.28, 1.0, r + (n - 0.5) * 0.7);
    const o = (y * size + x) * 4;
    data[o] = data[o + 1] = data[o + 2] = 255; data[o + 3] = Math.round(clamp(k) * 255);
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true; tex.needsUpdate = true; tex.name = 'env:puff';
  return tex;
}

// 使用 main 已公开的 SHOTS，不在环境模块复制机位；Node 验证可通过 ctx.shots 注入同一份表。
export function environmentViews(shots = {}) {
  const up = new THREE.Vector3(0, 1, 0);
  return Object.entries(shots).map(([id, shot]) => {
    const world = coords => {
      const p = new THREE.Vector3(...coords);
      if (shot.place) p.applyAxisAngle(up, facingRotation(shot.place)).add(new THREE.Vector3(...PLACES[shot.place].position));
      return p;
    };
    const start = world(shot.pos), end = world(shot.look);
    const camera = new THREE.PerspectiveCamera(shot.fov, 16 / 9, .1, 10000);
    camera.position.copy(start); camera.lookAt(end); camera.updateMatrixWorld(true);
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    // 价值晶塔通体透明：额外保护其特写轮廓，远处云也不透叠进晶体。
    const subjects = shot.place === 'value' ? [PLACES.value] : [];
    const silhouettes = subjects.map(place => {
      const [x,y,z]=place.position,e=place.envelope,r=e.radius??e.halfWidth,d=e.radius??e.halfDepth;
      const box=new THREE.Box3(new THREE.Vector3(x-r,y,z-d),new THREE.Vector3(x+r,y+e.height,z+d));
      if(!frustum.intersectsBox(box))return null;
      const rect={left:Infinity,right:-Infinity,bottom:Infinity,top:-Infinity};
      for(const px of [box.min.x,box.max.x])for(const py of [box.min.y,box.max.y])for(const pz of [box.min.z,box.max.z]){
        const p=new THREE.Vector3(px,py,pz).project(camera);
        rect.left=Math.min(rect.left,p.x);rect.right=Math.max(rect.right,p.x);rect.bottom=Math.min(rect.bottom,p.y);rect.top=Math.max(rect.top,p.y);
      }
      return rect;
    }).filter(Boolean);
    return { id, start, end, camera, frustum, silhouettes };
  });
}

// 成树整体避开画面下沿 20%，不裁枝、不随帧突然隐藏。保留岛沿远侧与两侧树簇。
export function treeInLowerFrame(p, views) {
  const r = 5 * p.scale, h = (p.height * 1.1 + 2) * p.scale;
  const box = new THREE.Box3(new THREE.Vector3(p.x-r,p.y,p.z-r),new THREE.Vector3(p.x+r,p.y+h,p.z+r));
  return views.some(view => {
    if (!['S02','S03','S04','S05'].includes(view.id) || !view.frustum.intersectsBox(box)) return false;
    let bottom = Infinity;
    for (const x of [box.min.x,box.max.x]) for (const y of [box.min.y,box.max.y]) for (const z of [box.min.z,box.max.z]) {
      const q = new THREE.Vector3(x,y,z).project(view.camera); bottom = Math.min(bottom,q.y);
    }
    return bottom < -.58;
  });
}
