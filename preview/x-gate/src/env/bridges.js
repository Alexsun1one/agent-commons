// 航道：总部岛缘 → 每座功能岛的悬空光桥。桥面 + 栏杆 + 白色拱券 + 青光边线 + 桥头门架 + 穿梭舱。
import * as THREE from 'three';
import { TAU, clamp, smooth, sweep, beam } from './util.js';
import { addRailing } from './railings.js';

const WIDTH = { network: 12, hub: 12, cocreation: 10, value: 10 };
const INSET = 3.2;

// 计算每座桥的曲线，并把桥头留口登记到两端岛的 gaps。
export function bridgeSpecs(islands) {
  const hq = islands.find(i => i.hq);
  const out = [];
  for (const isl of islands) {
    if (isl.hq) continue;
    const W = WIDTH[isl.id] ?? 10;
    const thA = Math.atan2(isl.cz - hq.cz, isl.cx - hq.cx), thB = thA + Math.PI;
    const rA = hq.outline(thA) - INSET, rB = isl.outline(thB) - INSET;
    const A = new THREE.Vector3(hq.cx + Math.cos(thA) * rA, hq.yT + 0.06, hq.cz + Math.sin(thA) * rA);
    const B = new THREE.Vector3(isl.cx + Math.cos(thB) * rB, isl.yT + 0.06, isl.cz + Math.sin(thB) * rB);
    const dirA = new THREE.Vector3(Math.cos(thA), 0, Math.sin(thA));
    const dirB = new THREE.Vector3(-Math.cos(thB), 0, -Math.sin(thB));
    const L = Math.hypot(B.x - A.x, B.z - A.z), rise = Math.abs(B.y - A.y);
    // 平面上一道缓弧（往后方弯，不挡正门视野）；高差越大弧越长，坡度越缓。
    const bow = clamp(7 + rise * 0.95, 7, 38);
    let n = new THREE.Vector3(-(B.z - A.z), 0, B.x - A.x).normalize();
    if (n.z > 0) n.negate();
    const P1 = A.clone().addScaledVector(dirA, L * 0.36).addScaledVector(n, bow * 1.33); P1.y = A.y;
    const P2 = B.clone().addScaledVector(dirB, -L * 0.36).addScaledVector(n, bow * 1.33); P2.y = B.y;
    const curve = new THREE.CubicBezierCurve3(A, P1, P2, B);
    const half = (W / 2 + 4.2);
    hq.gaps.push({ th: thA, half: half / hq.R });
    isl.gaps.push({ th: thB, half: half / isl.R });
    out.push({ id: isl.id, W, A, B, curve, length: curve.getLength() });
  }
  return out;
}

const Y = new THREE.Vector3(0, 1, 0);

export function buildBridges(ctx, b, inst, specs, hi, railing) {
  const { kit } = ctx;
  const { cobalt } = railing;
  const pods = [];
  const samples = [];
  for (const sp of specs) {
    const { W, curve, length } = sp;
    const step = hi ? 1.6 : 3.2;
    const N = Math.max(8, Math.ceil(length / step)), frames = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N, P = curve.getPointAt(u), T = curve.getTangentAt(u);
      const S = new THREE.Vector3().crossVectors(T, Y).normalize();
      const U = new THREE.Vector3().crossVectors(S, T).normalize();
      frames.push({ P, T, S, U, u });
      if (i % 3 === 0) samples.push(P.clone());
    }
    sp.frames = frames;
    const h = W / 2;
    const add = (pts, mat, fr = frames) => b.add(sweep(fr, pts), {}, mat);

    // ── 桥面：铺装 + 中央轨道槽 + 青光边线
    add([[-h, 0], [h, 0]], 'ceramic');

    for (const s of [-1, 1]) {
      add(s < 0 ? [[-0.82, 0.045], [-0.64, 0.045]] : [[0.64, 0.045], [0.82, 0.045]], 'glowSoft');
      add(s < 0 ? [[-h + 0.14, 0.04], [-h + 0.34, 0.04]] : [[h - 0.34, 0.04], [h - 0.14, 0.04]], 'glow');
    }
    // 侧壁、倒角、底面
    add([[h, 0], [h, -1.3]], 'shell');
    add([[-h, -1.3], [-h, 0]], 'shell');
    add([[h, -1.3], [h - 1.5, -2.3], [-h + 1.5, -2.3], [-h, -1.3]], 'graphite');
    add([[h + 0.02, -0.55], [h + 0.02, -0.82]], 'glowSoft');
    add([[-h - 0.02, -0.82], [-h - 0.02, -0.55]], 'glowSoft');

    for (const side of [-1, 1]) addRailing(b, frames, side * (h - .2), railing);

    // 两道白色拱券：拱脚嵌入岛岩，中部拱顶托住桥面，无钢桁架斜撑。
    const archDepth = u => 2.7 + Math.min(18, length * .17) * (1 - Math.sin(Math.PI * u));
    for (const side of [-1, 1]) {
      const offset = side * (h - 1.2);
      add(f => {
        const d = -archDepth(f.u);
        return [[offset - .65, d], [offset + .65, d], [offset + .65, d - 1.6], [offset - .65, d - 1.6], [offset - .65, d]];
      }, 'ceramic');
      for (let i = 0; i <= N; i += Math.max(1, Math.round(10 / step))) {
        const f = frames[i], p = f.P.clone().addScaledVector(f.S, offset);
        b.add(new THREE.BoxGeometry(1, 1, 1), beam(p.clone().addScaledVector(f.U, -1.3), p.clone().addScaledVector(f.U, -archDepth(f.u)), .38, .55), 'ceramic');
      }
    }

    // ── 桥头门架：两侧立柱 + 横梁 + 青光带，两端各一座
    for (const [pf, dir] of [[frames[0], 1], [frames[N], -1]]) {
      const yaw = Math.atan2(pf.T.x, pf.T.z);
      const base = pf.P.clone().addScaledVector(pf.T, dir * 3.0);
      b.push({ x: base.x, y: base.y, z: base.z, ry: yaw });
      for (const s of [-1, 1]) {
        b.rbox(1.5, 17, 1.8, 0.3, { x: s * (h + 1.5), y: 8.5 }, 'shell', 1);
        b.box(0.18, 13.5, 0.2, { x: s * (h + 1.5 - 0.78), y: 8.6, z: 0.95 }, 'glowSoft');
        b.box(2.2, 0.5, 2.5, { x: s * (h + 1.5), y: 0.25 }, 'metal');
        b.sphere(0.4, { x: s * (h + 1.5), y: 17.5 }, 'glowWhite', 12, 8);
      }
      if (sp.id === 'cocreation' && dir === -1) {
        // R1b: only the cocreation island arrival gets the white/cobalt entrance arch.
        const arch = [[-h - 1.5, 17, 0], [-h * 0.65, 18.7, 0], [0, 19.4, 0], [h * 0.65, 18.7, 0], [h + 1.5, 17, 0]];
        b.tube(arch, 0.85, {}, 'ceramic', hi ? 48 : 24, 8);
        for (const face of [-1, 1]) {
          b.tube(arch.map(([x, y, z]) => [x, y, z + face * 0.84]), 0.2, {}, cobalt, hi ? 48 : 24, 5);
        }
      } else {
        b.rbox(2 * (h + 1.5) + 1.5, 1.2, 1.9, 0.25, { y: 17.3 }, 'shell', 1);
        b.box(2 * (h + 1.5) - 1.5, 0.22, 0.2, { y: 16.6, z: 0.96 }, 'glow');
        b.box(2 * (h + 1.5) + 2.4, 0.5, 2.3, { y: 18.15 }, 'graphite');
      }
      b.pop();
    }

    // ── 穿梭舱：两只，一来一回
    sp.pods = [0, 1].map(k => ({ k, off: k * 0.5 }));
    pods.push(sp);
  }

  const podGeo = new THREE.CapsuleGeometry(1.0, 4.2, 6, 14).rotateX(Math.PI / 2).scale(1, 0.78, 1);
  const bandGeo = new THREE.BoxGeometry(2.14, 0.16, 3.6);
  const count = pods.length * 2;
  const podMesh = new THREE.InstancedMesh(podGeo, ctx.mats.ceramic, count); podMesh.name = 'env:pods'; podMesh.castShadow = true;
  const bandMesh = new THREE.InstancedMesh(bandGeo, ctx.mats.glow, count); bandMesh.name = 'env:pod-lights';
  podMesh.frustumCulled = bandMesh.frustumCulled = false;
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const bas = new THREE.Matrix4(), S = new THREE.Vector3(), Uu = new THREE.Vector3(), Tt = new THREE.Vector3();
  function place(t) {
    let n = 0;
    for (const sp of pods) for (const p of sp.pods) {
      const period = 2 * sp.length / 7;                        // 7 m/s 往返
      const ph = ((t + p.off * period) % period) / period;
      const fwd = ph < 0.5, u = fwd ? ph * 2 : 2 - ph * 2;
      const ue = 0.04 + u * 0.92, f = sp.curve.getPointAt(ue);
      Tt.copy(sp.curve.getTangentAt(ue)); if (!fwd) Tt.negate();
      S.crossVectors(Tt, Y).normalize(); Uu.crossVectors(S, Tt).normalize(); S.crossVectors(Uu, Tt);
      bas.makeBasis(S, Uu, Tt);
      q.setFromRotationMatrix(bas);
      pos.copy(f).addScaledVector(Uu, 1.55);
      mtx.compose(pos, q, one);
      podMesh.setMatrixAt(n, mtx);
      pos.copy(f).addScaledVector(Uu, 0.62);
      mtx.compose(pos, q, one);
      bandMesh.setMatrixAt(n, mtx);
      n++;
    }
    podMesh.instanceMatrix.needsUpdate = bandMesh.instanceMatrix.needsUpdate = true;
  }
  place(0);
  return { podMesh, bandMesh, samples, update: (t) => place(t) };
}

export { smooth, TAU };
