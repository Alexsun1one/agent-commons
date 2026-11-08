// 同一套轻型栏杆用于步道、观景台与岛间桥；按材质合批。
import * as THREE from 'three';
import { beam, sweep } from './util.js';

export function railingMaterials(mats) {
  const cobalt = mats.ceramic.clone();
  cobalt.name = 'env:rail-cobalt'; cobalt.color.set(0x214cdb); cobalt.userData.shared = false;
  const glass = new THREE.MeshStandardMaterial({ name: 'env:rail-glass-cyan', color: 0x91e1e7, transparent: true, opacity: .27, roughness: .18, metalness: .12, side: THREE.DoubleSide, depthWrite: false });
  return { cobalt, glass };
}

export function addRailing(b, frames, offset, materials, tubeSegments = frames.length - 1) {
  const at = (f, height) => f.P.clone().addScaledVector(f.S, offset).addScaledVector(f.U, height);
  const line = (height, radius, mat) => b.tube(frames.map(f => at(f, height)), radius, {}, mat, tubeSegments, 5);
  line(1.45, .095, 'ceramic');
  line(1.27, .045, materials.cobalt);
  line(.18, .035, 'glowTeal');
  b.add(sweep(frames, [[offset, .23], [offset, 1.21]]), {}, materials.glass);
  // 沿实际弧长每 3 m 插值，低档不减少立柱数量。
  let distance = 0, next = 0;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1], c = frames[i], length = a.P.distanceTo(c.P);
    while (next <= distance + length + 1e-6) {
      const t = THREE.MathUtils.clamp((next - distance) / length, 0, 1);
      const p = at(a, 0).lerp(at(c, 0), t), up = a.U.clone().lerp(c.U, t).normalize();
      b.add(new THREE.BoxGeometry(1, 1, 1), beam(p, p.clone().addScaledVector(up, 1.45), .12), 'ceramic');
      next += 3;
    }
    distance += length;
  }
}
