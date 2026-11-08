// 节点体检：node tools/check-module.mjs <id> [low]
// 在 Node 里 import 模块并 build，检查：有 group/hotspots/bounds、数值有限、包围盒在契约范围内、三角形与 draw call 不超预算。
// 只证明「能建、数值健康、预算内」，不证明好看；画面需在真实浏览器里验收。
import * as THREE from 'three';
import { createMaterials } from '../src/kit/materials.js';
import { kit, stats } from '../src/kit/kit.js';
import { PLACES, BUDGET, BASE_INTERIOR } from '../src/kit/world.js';

const [id, q = 'high'] = process.argv.slice(2);
const path = id === 'env' ? '../src/env/index.js' : `../src/buildings/${id}.js`;
const mod = await import(path);
const ctx = { THREE, kit, mats: createMaterials(), quality: q, reducedMotion: false, renderer: null, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), pmrem: null };
const t0 = performance.now();
const built = mod.build(ctx);
const ms = performance.now() - t0;
const fail = [];
if (!built?.group?.isObject3D) fail.push('build() 未返回 group');
if (id !== 'env' && !(built.hotspots?.length)) fail.push('没有 hotspots');
let bad = 0;
built.group.traverse(o => { const p = o.geometry?.attributes?.position; if (p) for (let i = 0; i < p.array.length; i++) if (!Number.isFinite(p.array[i])) { bad++; break; } });
if (bad) fail.push(`${bad} 个几何含非有限数`);
const box = new THREE.Box3().setFromObject(built.group);
const size = box.getSize(new THREE.Vector3());
const s = stats(built.group);
const budget = BUDGET[id] || BUDGET.network;
const k = q === 'low' ? 0.5 : 1;
if (s.tris > budget.tris * k) fail.push(`三角形 ${s.tris} 超预算 ${budget.tris * k}`);
if (s.calls > budget.calls * k) fail.push(`draw call ${s.calls} 超预算 ${budget.calls * k}`);
const env = PLACES[id]?.envelope;
if (env?.radius) {
  const r = Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z));
  if (r > env.radius * 1.05) fail.push(`水平半径 ${r.toFixed(1)} 超出包络 ${env.radius}`);
  if (box.max.y > env.height * 1.05) fail.push(`高度 ${box.max.y.toFixed(1)} 超出包络 ${env.height}`);
}
if (env?.halfWidth) {
  if (Math.max(-box.min.x, box.max.x) > env.halfWidth * 1.05) fail.push(`总部半宽超出 ${env.halfWidth}`);
  if (box.max.y > env.height * 1.05) fail.push(`总部高度超出 ${env.height}`);
}
built.update?.(1.0, 0.016);
built.dispose?.();
console.log(JSON.stringify({ id, quality: q, ms: Math.round(ms), ...s, bounds: { min: box.min.toArray().map(v => +v.toFixed(1)), max: box.max.toArray().map(v => +v.toFixed(1)) }, size: size.toArray().map(v => +v.toFixed(1)), hotspots: (built.hotspots || []).map(h => h.userData.hotspot), fail }, null, 1));
process.exit(fail.length ? 1 : 0);
