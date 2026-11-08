import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { PLACES, facingRotation } from '../kit/world.js';
import { createSky, SUN_DIR } from './sky.js';

for (const quality of ['high', 'low']) {
  test(`${quality}: 五岛接收面及建筑包络全部进入太阳阴影相机`, () => {
    const scene = new THREE.Scene();
    const sky = createSky({ scene, quality, reducedMotion: true });
    scene.add(sky.lights);
    const elevation = THREE.MathUtils.radToDeg(Math.asin(SUN_DIR.y));
    assert(elevation >= 35 && elevation <= 45);
    assert.equal(sky.sun.castShadow, quality === 'high');
    for (const focus of [null, ...Object.values(PLACES)]) {
      if (focus) sky.focusShadow(new THREE.Vector3(...focus.position), 200);
      scene.updateMatrixWorld(true);
      sky.sun.shadow.updateMatrices(sky.sun);
      const camera = sky.sun.shadow.camera;
      for (const [id, place] of Object.entries(PLACES)) {
        const [x, y, z] = place.position;
        for (const dx of [-place.island, place.island]) {
          for (const dz of [-place.island, place.island]) {
            for (const dy of [0, place.envelope.height]) {
              const projected = new THREE.Vector3(x+dx, y+dy, z+dz).project(camera);
              assert(projected.toArray().every(v => Number.isFinite(v) && Math.abs(v) < 1), `${id}: ${projected.toArray()}`);
            }
          }
        }
      }
      if (quality === 'high') assert(sky.sun.userData.shadowTexelMetres.every(v => v < .25));
    }
    sky.dispose();
  });
}

test('近景清楚，中远景雾分层；高处仍保留大气透视，减少动态冻结天空', () => {
  const scene = new THREE.Scene();
  const sky = createSky({ scene, quality: 'high', reducedMotion: true });
  const camera = new THREE.PerspectiveCamera();
  for (const altitude of [15, 80, 400]) {
    camera.position.y = altitude;
    sky.update(30, camera);
    const density = scene.fog.density;
    const fog = distance => 1 - Math.exp(-((density * distance) ** 2));
    assert(fog(200) < .04);
    assert(fog(700) > .1 && fog(700) < .4);
    assert(fog(1600) > fog(700) + .3);
  }
  assert.equal(sky.dome.material.uniforms.uTime.value, 0);
  sky.dispose();
});

test('真实 S01–S05 机位：前立面受光，太阳在左肩，影子向右后，往返切镜不丢五岛覆盖', () => {
  const source = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  const shots = runInNewContext(`(${source.match(/const SHOTS = (\{[\s\S]*?\n\});/)[1]})`);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const sky = createSky({ scene, camera, quality: 'high', reducedMotion: true });
  scene.add(sky.lights);
  const up = new THREE.Vector3(0, 1, 0);
  let firstDirection;
  for (const id of ['S01', 'S02', 'S03', 'S04', 'S05', 'S01']) {
    const shot = shots[id], yaw = shot.place ? facingRotation(shot.place) : 0;
    const world = p => new THREE.Vector3(...p).applyAxisAngle(up, yaw).add(new THREE.Vector3(...PLACES[shot.place ?? 'base'].position));
    camera.position.copy(world(shot.pos)); camera.lookAt(world(shot.look));
    sky.update(10, camera); scene.updateMatrixWorld(true);
    sky.sun.shadow.updateMatrices(sky.sun);
    const direction = sky.sun.position.clone().sub(sky.sun.target.position).normalize();
    const back = camera.getWorldDirection(new THREE.Vector3()).negate().setY(0).normalize();
    const right = new THREE.Vector3().crossVectors(up, back);
    assert(Math.abs(THREE.MathUtils.radToDeg(Math.asin(direction.y)) - 40) < 1e-6, id);
    assert(direction.dot(back) > .58 && direction.dot(right) < -.49, `${id}: 左前上方`);
    assert(direction.dot(new THREE.Vector3(0, 0, 1).applyAxisAngle(up, yaw)) > .3, `${id}: 正立面`);
    const shadowDirection = direction.clone().negate().setY(0).normalize();
    assert(shadowDirection.dot(right) > .6 && shadowDirection.dot(back) < -.7, `${id}: 右后投影`);
    for (const [placeId, place] of Object.entries(PLACES)) {
      for (const dx of [-place.island, place.island]) for (const dz of [-place.island, place.island]) for (const dy of [0, place.envelope.height]) {
        const p = new THREE.Vector3(...place.position).add(new THREE.Vector3(dx, dy, dz)).project(sky.sun.shadow.camera);
        assert(p.toArray().every(v => Number.isFinite(v) && Math.abs(v) < 1), `${id}: ${placeId} 阴影裁切`);
      }
    }
    assert(sky.sun.userData.shadowTexelMetres.every(v => v < .25));
    assert(sky.dome.material.uniforms.uSun.value.distanceTo(direction) < 1e-8);
    if (id === 'S01') {
      if (firstDirection) assert(firstDirection.distanceTo(direction) < 1e-8);
      firstDirection = direction.clone();
    }
  }
  sky.dispose();
});
