// 建模工具。核心是 Builder：成百上千个构件按材质合并成少数几个网格，
// 细节多但 draw call 少。模块拿到的是 ctx.kit。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// 按法线方向做三面投影 UV，让纹理按世界米数铺：tile = 一张贴图覆盖多少米。
// Builder 默认在合并前对每个构件调用；所以 4 m 的面板缝在 2 m 和 200 m 的墙上密度一致。
export function projectUVs(geo, tile = 4, matrix = null) {
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  if (!pos || !nor) return geo;
  const uv = new Float32Array(pos.count * 2);
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  const nm = matrix ? new THREE.Matrix3().getNormalMatrix(matrix) : null;
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i); n.fromBufferAttribute(nor, i);
    if (matrix) { p.applyMatrix4(matrix); n.applyMatrix3(nm).normalize(); }
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    let u, v;
    if (ay >= ax && ay >= az) { u = p.x; v = p.z; } else if (ax >= az) { u = p.z; v = p.y; } else { u = p.x; v = p.y; }
    uv[i * 2] = u / tile; uv[i * 2 + 1] = v / tile;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();

// t = { x, y, z, rx, ry, rz, sx, sy, sz }（位置米、角度弧度），缺省为 0/1。
export function toMatrix(t = {}) {
  _p.set(t.x || 0, t.y || 0, t.z || 0);
  _q.setFromEuler(_e.set(t.rx || 0, t.ry || 0, t.rz || 0, t.order || 'YXZ'));
  _s.set(t.sx ?? 1, t.sy ?? 1, t.sz ?? 1);
  return new THREE.Matrix4().compose(_p, _q, _s);
}

function strip(g) {
  // 合并要求属性一致：只留 position/normal/uv，统一为非索引几何。
  const out = g.index ? g.toNonIndexed() : g.clone();
  for (const k of Object.keys(out.attributes)) if (!['position', 'normal', 'uv'].includes(k)) out.deleteAttribute(k);
  if (!out.attributes.normal) out.computeVertexNormals();
  out.morphAttributes = {};
  return out;
}

export class Builder {
  // mats：材质表；tile：默认 UV 米数。parent 变换用 push/pop 叠加（局部坐标系）。
  constructor(mats, { tile = 4 } = {}) { this.mats = mats; this.tile = tile; this.parts = new Map(); this.stack = [new THREE.Matrix4()]; }
  get top() { return this.stack[this.stack.length - 1]; }
  push(t) { this.stack.push(this.top.clone().multiply(t instanceof THREE.Matrix4 ? t : toMatrix(t))); return this; }
  pop() { if (this.stack.length > 1) this.stack.pop(); return this; }

  add(geo, t = {}, mat = 'shell', { tile, uv = true } = {}) {
    const m = this.top.clone().multiply(t instanceof THREE.Matrix4 ? t : toMatrix(t));
    let g = strip(geo);
    if (uv) projectUVs(g, tile ?? this.tile, m);
    g.applyMatrix4(m);
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat).push(g);
    geo.dispose?.();
    return this;
  }

  // 常用件。尺寸全是米；位置是构件中心。
  box(w, h, d, t, mat) { return this.add(new THREE.BoxGeometry(w, h, d), t, mat); }
  // 倒角盒：r = 倒角半径。大体块优先用它，硬边盒在近景显得假。
  rbox(w, h, d, r, t, mat, seg = 2) { return this.add(new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2) - 1e-3), t, mat); }
  cyl(rt, rb, h, t, mat, seg = 32, open = false) { return this.add(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), t, mat); }
  sphere(r, t, mat, ws = 32, hs = 16, phiStart, phiLen, thetaStart, thetaLen) { return this.add(new THREE.SphereGeometry(r, ws, hs, phiStart, phiLen, thetaStart, thetaLen), t, mat); }
  // 圆环：默认躺平（XZ 平面）。
  torus(R, r, t = {}, mat = 'glow', rs = 8, ts = 96, arc = Math.PI * 2) { return this.add(new THREE.TorusGeometry(R, r, rs, ts, arc), { rx: Math.PI / 2, ...t }, mat); }
  // 旋转体：pts = [[半径, 高度], ...]，自下而上。做塔身、基座、穹顶最省事。
  lathe(pts, t, mat, seg = 64, phiStart = 0, phiLen = Math.PI * 2) { return this.add(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg, phiStart, phiLen), t, mat); }
  // 挤出：shape 为 THREE.Shape（XY 平面），沿 +Z 挤出 depth。bevel 给近景圆润边。
  extrude(shape, depth, t, mat, bevel = 0, curveSegments = 24) {
    return this.add(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments }), t, mat);
  }
  tube(points, r, t, mat, segs = 64, rs = 8, closed = false) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => Array.isArray(p) ? new THREE.Vector3(...p) : p), closed);
    return this.add(new THREE.TubeGeometry(curve, segs, r, rs, closed), t, mat);
  }
  // 沿圆周重复：fn(b, i, angle) 内用 b.box(...) 等在「已旋转到第 i 个位置」的局部坐标里建模。
  radial(n, R, fn, { phase = 0, arc = Math.PI * 2, y = 0 } = {}) {
    for (let i = 0; i < n; i++) {
      const a = phase + (arc >= Math.PI * 2 - 1e-6 ? arc * i / n : arc * i / Math.max(1, n - 1));
      this.push({ x: Math.sin(a) * R, y, z: Math.cos(a) * R, ry: a }); fn(this, i, a); this.pop();
    }
    return this;
  }
  // 线性阵列：从 from 到 to 均分 n 个，fn(b, i, k01)。
  array(n, from, to, fn) {
    for (let i = 0; i < n; i++) {
      const k = n === 1 ? 0.5 : i / (n - 1);
      this.push({ x: from[0] + (to[0] - from[0]) * k, y: from[1] + (to[1] - from[1]) * k, z: from[2] + (to[2] - from[2]) * k }); fn(this, i, k); this.pop();
    }
    return this;
  }

  // 输出：每种材质一个 Mesh。castShadow 默认开（发光与全息除外）。
  build(name = 'built') {
    const group = new THREE.Group(); group.name = name;
    for (const [key, geos] of this.parts) {
      const mat = typeof key === 'string' ? this.mats[key] : key;
      if (!mat) throw new Error(`未知材质：${key}`);
      const geo = mergeGeometries(geos, false);
      geos.forEach(g => g.dispose());
      geo.computeBoundingBox(); geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `${name}:${typeof key === 'string' ? key : mat.name || 'custom'}`;
      const lit = !(mat.blending === THREE.AdditiveBlending || /^glow|holo/.test(mat.name || ''));
      mesh.castShadow = lit; mesh.receiveShadow = lit;
      group.add(mesh);
    }
    this.parts.clear();
    return group;
  }
}

// 实例化：大量相同小件（灯、栏杆柱、无人机、窗框）用它。matrices 为 toMatrix 结果数组。
export function instanced(geo, mat, matrices, name = 'instanced') {
  const mesh = new THREE.InstancedMesh(geo, mat, matrices.length);
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.name = name; mesh.castShadow = mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}

// 圆角矩形 / 倒角多边形 Shape，供 extrude 用。
export function roundedRect(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
export function polygon(points) { const s = new THREE.Shape(); points.forEach(([x, y], i) => i ? s.lineTo(x, y) : s.moveTo(x, y)); s.closePath(); return s; }

// 文字面板（浏览器专用；Node 下返回空组）。只用于建筑标识，如门楣上的 X-GATE。
export function textPanel(text, { height = 4, color = '#dff8ff', glow = '#5fe8ff', weight = 700, font = '"Space Grotesk","PingFang SC",system-ui,sans-serif', letter = 0.12 } = {}) {
  const g = new THREE.Group(); g.name = `text:${text}`;
  if (typeof document === 'undefined') return g;
  const c = document.createElement('canvas'), ctx = c.getContext('2d');
  const px = 160; ctx.font = `${weight} ${px}px ${font}`;
  const spaced = [...text].join(' '.repeat(Math.round(letter * 10)));
  const w = Math.ceil(ctx.measureText(spaced).width + px * 0.6);
  c.width = w; c.height = Math.ceil(px * 1.5);
  ctx.font = `${weight} ${px}px ${font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = glow; ctx.shadowBlur = px * 0.18; ctx.fillStyle = color; ctx.fillText(spaced, w / 2, c.height / 2);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(height * c.width / c.height, height), mat);
  g.add(mesh);
  return g;
}

// 交互热点：不可见的命中盒。id 必须是契约里的地点 id（base / base-portal / network / hub / cocreation / value）。
export function hotspot(id, w, h, d, t = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ visible: false }));
  mesh.applyMatrix4(toMatrix(t));
  mesh.name = `hotspot:${id}`; mesh.userData.hotspot = id;
  return mesh;
}

export function disposeTree(root) {
  root.traverse(o => {
    o.geometry?.dispose?.();
    const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of ms) { if (m.userData?.shared) continue; for (const v of Object.values(m)) if (v?.isTexture) v.dispose(); m.dispose(); }
  });
}

export function stats(root) {
  let tris = 0, calls = 0;
  root.traverse(o => {
    if (!o.isMesh || o.material?.visible === false) return;
    const g = o.geometry, n = g.index ? g.index.count : g.attributes.position.count;
    tris += (n / 3) * (o.isInstancedMesh ? o.count : 1); calls++;
  });
  return { tris: Math.round(tris), calls };
}

// 可见几何的世界 AABB，供相机取景用：不计命中盒（userData.hotspot）、visible=false 的物体及其子树、材质 visible=false 的网格；其余口径同 Box3.setFromObject。
// 调用前 matrixWorld 要已更新（main.js 的 addPlace 和各几何测试都先 updateMatrixWorld(true)）。无可见几何时返回空盒，camera.js 会退回契约包络。
export function visibleBounds(root) {
  const box = new THREE.Box3(), one = new THREE.Box3();
  const walk = o => {
    if (!o.visible || o.userData.hotspot) return;
    o.updateWorldMatrix(false, false);
    const m = o.material;
    if (o.geometry && !(Array.isArray(m) ? m.every(x => x.visible === false) : m?.visible === false)) {
      if (o.boundingBox !== undefined) { if (o.boundingBox === null) o.computeBoundingBox(); one.copy(o.boundingBox); }
      else { if (o.geometry.boundingBox === null) o.geometry.computeBoundingBox(); one.copy(o.geometry.boundingBox); }
      box.union(one.applyMatrix4(o.matrixWorld));
    }
    for (const child of o.children) walk(child);
  };
  walk(root);
  return box;
}

export const kit = { THREE, Builder, rng, projectUVs, toMatrix, instanced, roundedRect, polygon, textPanel, hotspot, disposeTree, stats, visibleBounds };
