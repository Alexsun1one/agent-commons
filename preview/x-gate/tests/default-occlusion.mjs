// 默认机位遮挡证据：工作台未打开时五座楼的默认机位，到各楼包围盒八角与中心共 9 点的视线，
// 被别的建筑（含总部）真实网格挡住的不超过 1 个。与 split-framing 同口径：真实已交付模型的世界 AABB，仅可见网格；不创建 WebGL。
import * as THREE from 'three';
import { kit } from '../src/kit/kit.js';
import { createMaterials } from '../src/kit/materials.js';
import { PLACES, facingRotation } from '../src/kit/world.js';
import { createPresets, STATE_BY_PLACE } from '../src/app/camera.js';
const MAX_HIDDEN = 1;
for (const quality of ['high','low']) {
  const places = {}, solids = {};
  for (const id of ['base','network','hub','cocreation','value']) {
    const meta = PLACES[id], anchor = new THREE.Vector3(...meta.position);
    const mod = await import(`../src/buildings/${id}.js`);
    const built = mod.build({ THREE, kit, mats: createMaterials(), quality, reducedMotion: true, renderer: null, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), pmrem: null });
    const root = new THREE.Group(); root.position.copy(anchor); root.rotation.y = facingRotation(id); root.add(built.group); root.updateMatrixWorld(true);
    places[id] = { anchor, bounds: kit.visibleBounds(built.group) };
    solids[id] = []; built.group.traverse(o => { if (o.isMesh && !o.userData.hotspot && o.visible !== false) solids[id].push(o); });
    built.dispose?.();
  }
  for (const [mobile, width, height] of [[false,1440,900],[true,390,844]]) {
    const presets = createPresets(places, mobile, width / height);
    for (const [id, place] of Object.entries(places)) {
      const p = presets[id === 'base' ? 'BaseEntrance' : STATE_BY_PLACE[id]], eye = new THREE.Vector3(...p.position), box = place.bounds;
      const samples = [];
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) samples.push(new THREE.Vector3(x, y, z));
      samples.push(box.getCenter(new THREE.Vector3()));
      const hidden = samples.filter(point => { const ray = new THREE.Raycaster(eye, point.clone().sub(eye).normalize(), .5, eye.distanceTo(point)); return Object.entries(solids).some(([other, list]) => other !== id && ray.intersectObjects(list, false).length); }).length;
      const valid = hidden <= MAX_HIDDEN && !box.containsPoint(eye);
      console.log(JSON.stringify({ id, quality, viewport: `${width}x${height}`, hidden: `${hidden}/9`, position: p.position.map(n => +n.toFixed(1)), valid }));
      if (!valid) process.exitCode = 1;
    }
  }
}
