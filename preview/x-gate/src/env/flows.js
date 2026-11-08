// 桥面光流与总部 → 价值晶塔光带。单一加色材质合批，端点不随波动偏移。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PLACES, facingRotation } from '../kit/world.js';

export function createFlows(ctx, specs, hi) {
  const parts = [], paths = [];
  function tube(curve, radius, wave, phase) {
    const g = new THREE.TubeGeometry(curve, hi ? 160 : 80, radius, 5, false);
    const count = g.attributes.position.count;
    g.setAttribute('flowWave', new THREE.Float32BufferAttribute(new Float32Array(count).fill(wave), 1));
    g.setAttribute('flowPhase', new THREE.Float32BufferAttribute(new Float32Array(count).fill(phase), 1));
    parts.push(g);
  }
  for (const sp of specs) {
    const points = sp.frames.map(f => f.P.clone().addScaledVector(f.U, .085));
    tube(new THREE.CatmullRomCurve3(points), .065, 0, 0);
  }
  const world = (id, local) => new THREE.Vector3(...local).applyAxisAngle(new THREE.Vector3(0, 1, 0), facingRotation(id)).add(new THREE.Vector3(...PLACES[id].position));
  // base.js XY=102.5/RZ=65.8/r=17；value.js R3 主晶 r=15/h=164/中心 z=-7，leanZ=-1.5。
  const tip = world('value', [3, 166, -11.2]);
  for (let i = 0; i < 3; i++) {
    const a = .15 + i * .26;
    const start = world('base', [17 * Math.cos(a), 102.5 + 17 * Math.sin(a), 66.8]);
    const c1 = start.clone().add(new THREE.Vector3(48 + i * 12, 55 + i * 22, 12));
    const c2 = tip.clone().add(new THREE.Vector3(-45, 20 + i * 12, 80 + i * 28));
    const curve = new THREE.CubicBezierCurve3(start, c1, c2, tip);
    tube(curve, .20 + i * .025, 2.2, i * 1.7);
    paths.push({ start: start.toArray(), end: tip.toArray(), radius: .20 + i * .025 });
  }
  const geometry = mergeGeometries(parts, false); parts.forEach(g => g.dispose());
  const material = new THREE.ShaderMaterial({
    name: 'env:flow-cyan', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `attribute float flowWave; attribute float flowPhase;
      uniform float uTime; varying vec2 vUv; varying float vPhase;
      void main(){vUv=uv;vPhase=flowPhase;vec3 p=position;
        float envelope=sin(uv.x*3.14159265);
        p.y+=flowWave*envelope*sin(uv.x*9.0-uTime*.38+flowPhase);
        p.x+=flowWave*.35*envelope*sin(uv.x*7.0-uTime*.27+flowPhase);
        gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);}`,
    fragmentShader: `uniform float uTime; varying vec2 vUv; varying float vPhase;
      void main(){float pulse=pow(.5+.5*cos(vUv.x*36.0-uTime*.8+vPhase),8.0);
        gl_FragColor=vec4(vec3(.015,.83,.72)*(1.15+pulse*1.3),.76);}`,
  });
  const mesh = new THREE.Mesh(geometry, material); mesh.name = 'env:value-and-bridge-flows'; mesh.frustumCulled = false;
  return { mesh, paths, update(t) { if (!ctx.reducedMotion) material.uniforms.uTime.value = t; } };
}
