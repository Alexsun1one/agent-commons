// 分屏取景证据：工作台右停靠时，四座建筑的真实包围盒必须落在面板留出的可见区里，
// 且从分屏机位到包围盒八角与中心的视线不被别的建筑（含总部）的真实网格挡住。
// 与 r2-framing 同口径：真实已交付模型的世界 AABB，仅可见网格；不创建 WebGL。
import * as THREE from 'three';
import { kit } from '../src/kit/kit.js';
import { createMaterials } from '../src/kit/materials.js';
import { PLACES, facingRotation } from '../src/kit/world.js';
import { createPresets, createSplitPresets, splitRegion, STATE_BY_PLACE } from '../src/app/camera.js';
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
  for (const [mobile, width, height] of [[false,1440,900],[false,1100,760],[false,1920,1080],[true,390,844],[true,375,667]]) {
    const aspect = width / height, base = createPresets(places, mobile, aspect), split = createSplitPresets(places, mobile, aspect, [width,height], base), region = splitRegion(mobile, width, height);
    for (const [id, place] of Object.entries(places)) {
      if (id === 'base') continue;
      const p = split[STATE_BY_PLACE[id]], camera = new THREE.PerspectiveCamera(p.fov, aspect, .5, 9000), full = 1000, w = aspect * full;
      camera.position.fromArray(p.position); camera.lookAt(...p.lookAt);
      camera.setViewOffset(w, full, p.frameOffset[0] * w, p.frameOffset[1] * full, w, full); camera.updateMatrixWorld(true);
      const pts = [];
      for (const x of [place.bounds.min.x, place.bounds.max.x]) for (const y of [place.bounds.min.y, place.bounds.max.y]) for (const z of [place.bounds.min.z, place.bounds.max.z]) pts.push(new THREE.Vector3(x, y, z).project(camera));
      const xs = pts.map(q => q.x), ys = pts.map(q => q.y), eps = 1e-3;
      const inFront = pts.every(q => q.z >= -1 && q.z <= 1);
      const inside = Math.min(...xs) >= region.x[0] - eps && Math.max(...xs) <= region.x[1] + eps && Math.min(...ys) >= region.y[0] - eps && Math.max(...ys) <= region.y[1] + eps;
      const distance = new THREE.Vector3(...p.position).distanceTo(new THREE.Vector3(...p.lookAt));
      const eye = new THREE.Vector3(...p.position), samples = [...pts.map((_, i) => [...(i & 4 ? [place.bounds.max.x] : [place.bounds.min.x]), ...(i & 2 ? [place.bounds.max.y] : [place.bounds.min.y]), ...(i & 1 ? [place.bounds.max.z] : [place.bounds.min.z])]).map(a => new THREE.Vector3(...a)), place.bounds.getCenter(new THREE.Vector3())];
      const hidden = samples.filter(point => { const ray = new THREE.Raycaster(eye, point.clone().sub(eye).normalize(), .5, eye.distanceTo(point)); return Object.entries(solids).some(([other, list]) => other !== id && ray.intersectObjects(list, false).length); }).length;
      const valid = inFront && inside && hidden === 0 && p.frameOffset.every(Number.isFinite) && !place.bounds.containsPoint(eye);
      console.log(JSON.stringify({ id, quality, viewport: `${width}x${height}`, x: [+Math.min(...xs).toFixed(3), +Math.max(...xs).toFixed(3)], y: [+Math.min(...ys).toFixed(3), +Math.max(...ys).toFixed(3)], region: { x: region.x.map(n => +n.toFixed(3)), y: region.y.map(n => +n.toFixed(3)) }, frameOffset: p.frameOffset.map(n => +n.toFixed(3)), fov: +p.fov.toFixed(1), distance: +distance.toFixed(1), hidden, valid }));
      if (!valid) process.exitCode = 1;
    }
  }
}
