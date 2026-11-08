// kit.visibleBounds 的口径：命中盒、visible=false 子树、材质不可见的网格不计入；可见网格（含实例化、带父级旋转平移）计入。不创建 WebGL。
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { kit } from '../src/kit/kit.js';
const cube = (w, h, d, material = new THREE.MeshBasicMaterial()) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
const root = new THREE.Group(); root.position.set(100, 10, -50); root.rotation.y = Math.PI / 2;
const solid = cube(10, 20, 30); solid.position.set(0, 10, 0); root.add(solid);
root.add(kit.hotspot('network', 400, 400, 400, { y: 200 }));                                  // 命中盒
const folder = new THREE.Group(); folder.userData.hotspot = 'network:group'; folder.add(cube(300, 300, 300)); root.add(folder); // 整组标成命中盒
const hidden = new THREE.Group(); hidden.visible = false; hidden.add(cube(500, 500, 500)); root.add(hidden);                  // 隐藏子树
root.add(cube(500, 500, 500, new THREE.MeshBasicMaterial({ visible: false })));                // 材质不可见
const crowd = kit.instanced(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial(), [kit.toMatrix({ y: 50 }), kit.toMatrix({ x: 40, y: 60 })], 'crowd');
root.add(crowd);                                                                                // 实例化：按实例计入
root.updateMatrixWorld(true);

const box = kit.visibleBounds(root), near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);
// 绕 Y 转 90°：局部 (x, z) → 世界 (z, −x)。solid：x 85–115、y 10–30、z −55…−45；实例：x 99–101、y 59–71 与 49–51 内、z −91…−39。
[box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].forEach((v, i) => near(v, [85, 10, -91, 115, 71, -45][i]));
assert.ok(new THREE.Box3().setFromObject(root).max.y > 100, '旧口径把命中盒、隐藏物都算进去了，这里要比新口径大');
assert.ok(kit.visibleBounds(new THREE.Group()).isEmpty());
const only = new THREE.Group(); only.add(kit.hotspot('hub', 10, 10, 10)); only.updateMatrixWorld(true);
assert.ok(kit.visibleBounds(only).isEmpty(), '只有命中盒时返回空盒（camera.js 会退回契约包络）');
console.log(JSON.stringify({ min: box.min.toArray(), max: box.max.toArray(), valid: true }));
