// 离线取景证据：真实已交付模型的世界 AABB，仅可见网格（kit.visibleBounds，不含热点命中盒；与 main.js 的 addPlace 同口径）；未交付时明确标为契约包络。
import * as THREE from 'three';
import { access } from 'node:fs/promises';
import { kit } from '../src/kit/kit.js';
import { createMaterials } from '../src/kit/materials.js';
import { PLACES, facingRotation } from '../src/kit/world.js';
import { createPresets, STATE_BY_PLACE } from '../src/app/camera.js';
for (const quality of ['high','low']) {
  const places = {};
  for (const id of ['network','hub','cocreation','value']) {
    const meta = PLACES[id], anchor = new THREE.Vector3(...meta.position);
    let mod;
    try { await access(new URL(`../src/buildings/${id}.js`, import.meta.url)); mod = await import(`../src/buildings/${id}.js`); } catch (error) {
      if (!['ENOENT','ERR_MODULE_NOT_FOUND'].includes(error.code)) throw error;
    }
    if (typeof mod?.build !== 'function') {
      places[id] = { anchor, bounds: new THREE.Box3(anchor.clone().add(new THREE.Vector3(-meta.envelope.radius,0,-meta.envelope.radius)), anchor.clone().add(new THREE.Vector3(meta.envelope.radius,meta.envelope.height,meta.envelope.radius))), source: 'contract envelope; model unavailable' };
      continue;
    }
    const built = mod.build({ THREE, kit, mats: createMaterials(), quality, reducedMotion: true, renderer: null, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), pmrem: null });
    const root = new THREE.Group(); root.position.copy(anchor); root.rotation.y = facingRotation(id); root.add(built.group); root.updateMatrixWorld(true);
    places[id] = { anchor, bounds: kit.visibleBounds(built.group), source: 'actual model, visible meshes only' };
    built.dispose?.();
  }
  for (const mobile of [false,true]) {
    const aspect = mobile ? 390/844 : 1440/900, presets = createPresets(places,mobile,aspect);
    for (const [id,place] of Object.entries(places)) {
      const p = presets[STATE_BY_PLACE[id]], camera = new THREE.PerspectiveCamera(p.fov,aspect,.5,9000);
      camera.position.fromArray(p.position); camera.lookAt(...p.lookAt); camera.updateMatrixWorld(true);
      const box = place.bounds, points = [];
      for (const x of [box.min.x,box.max.x]) for (const y of [box.min.y,box.max.y]) for (const z of [box.min.z,box.max.z]) points.push(new THREE.Vector3(x,y,z).project(camera));
      const height = (Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y)))/2;
      const x = [Math.min(...points.map(p=>p.x)),Math.max(...points.map(p=>p.x))];
      const horizontal = Math.hypot(camera.position.x-place.anchor.x,camera.position.z-place.anchor.z);
      const valid = (mobile || height >= .60) && height <= .65 && x[0] >= -.941 && x[1] <= (mobile ? .941 : .201) && horizontal >= 150 && !box.containsPoint(camera.position);
      console.log(JSON.stringify({id,quality,viewport:mobile?'390x844':'1440x900',source:place.source,heightPercent:+(height*100).toFixed(2),horizontalMeters:+horizontal.toFixed(2),screenX:x.map(n=>+n.toFixed(3)),position:p.position.map(n=>+n.toFixed(1)),valid}));
      if (!valid) process.exitCode = 1;
    }
  }
}
