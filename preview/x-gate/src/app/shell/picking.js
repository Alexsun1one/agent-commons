import * as THREE from 'three';
import { CATALOG, SPACE_IDS } from './catalog.js';

export function routeHotspot(id) {
  if (typeof id !== 'string') return null;
  if (SPACE_IDS.includes(id)) return { type: 'fly', place: id };
  if (id === 'base:portal') return { type: 'interior', place: 'base' };
  if (id === 'base:beacon') return { type: 'open', place: 'base', section: 'news' };
  if (id === 'base:orbit') return { type: 'open', place: 'base', section: 'guide' };
  const parts = id.split(':');
  if (parts[0] === 'base' && parts[1] === 'guide' && parts.length === 3 && SPACE_IDS.includes(parts[2]) && parts[2] !== 'base') return { type: 'fly', place: parts[2] };
  if (id === 'network:me') return { type: 'open', place: 'network', section: 'relations', ref: 'me' };
  if (parts[0] === 'network' && ['agent','human'].includes(parts[1]) && parts.length >= 3 && parts.slice(2).join(':')) return { type: 'open', place: 'network', section: 'relations', ref: parts.slice(2).join(':') };
  if (parts.length === 2 && CATALOG[parts[0]]?.sections.some(s => s.id === parts[1])) return { type: 'open', place: parts[0], section: parts[1] };
  return null;
}
export function hotspotPriority(id) {
  if (/^network:(agent:|human:|me$)/.test(id)) return 3;
  return id.includes(':') ? 2 : 1;
}
export function isVisible(object) {
  for (let node = object; node; node = node.parent) if (!node.visible) return false;
  return true;
}
export function selectHit(hits, solids, currentPlace) {
  const solid = solids.find(hit => isVisible(hit.object) && !hit.object.userData.hotspot && (() => {
    const material = Array.isArray(hit.object.material) ? hit.object.material[hit.face?.materialIndex || 0] : hit.object.material;
    return material && material.visible !== false && !(material.transparent && material.opacity < .35);
  })());
  return hits.filter(hit => {
    const id = hit.object.userData.hotspot;
    return isVisible(hit.object) && routeHotspot(id) && (!id.includes(':') || id.split(':')[0] === currentPlace)
      && (!solid || hit.distance <= solid.distance + .35);
  }).sort((a,b) => hotspotPriority(b.object.userData.hotspot)-hotspotPriority(a.object.userData.hotspot) || a.distance-b.distance)[0] || null;
}
export function hotspotAnchor(mesh, places) {
  const place = places[mesh.userData.hotspot.split(':')[0]];
  if (mesh.userData.anchor && place?.group) return place.group.localToWorld(mesh.userData.anchor.clone());
  return mesh.getWorldPosition(new THREE.Vector3());
}
export function installPicking(world, director, label, dispatch, isBlocked) {
  const ray = new THREE.Raycaster(), cursor = new THREE.Vector2();
  let down = null, pending = null, hovered = null;
  const activePointers = new Set();
  function hit(event) {
    if (isBlocked() || director.moving) return null;
    const rect = world.canvas.getBoundingClientRect();
    cursor.set((event.clientX-rect.left)/rect.width*2-1, 1-(event.clientY-rect.top)/rect.height*2);
    world.scene.updateMatrixWorld(true); world.camera.updateMatrixWorld(true);
    ray.setFromCamera(cursor, world.camera);
    const hotspots = ray.intersectObjects(world.hotspots, false);
    if (!hotspots.length) return null;
    const meshes = [];
    world.scene.traverse(object => { if ((object.isMesh || object.isInstancedMesh) && !object.userData.hotspot && isVisible(object)) meshes.push(object); });
    return selectHit(hotspots, ray.intersectObjects(meshes, false), director.place);
  }
  function clear() { pending = null; hovered = null; label.hidden = true; world.canvas.style.cursor = ''; }
  function onDown(event) {
    activePointers.add(event.pointerId);
    if (activePointers.size > 1) { down = null; return; }
    if (event.button !== 0 || isBlocked()) return;
    down = { id: event.pointerId, x: event.clientX, y: event.clientY, dragged: false };
  }
  function onMove(event) {
    if (down && Math.hypot(event.clientX-down.x,event.clientY-down.y) > 5) down.dragged = true;
    if (down?.dragged || activePointers.size > 1) { clear(); return; }
    pending = event;
  }
  function onUp(event) {
    activePointers.delete(event.pointerId);
    const candidate = down; down = null;
    if (!candidate || candidate.id !== event.pointerId || candidate.dragged || Math.hypot(event.clientX-candidate.x,event.clientY-candidate.y) > 5) return;
    const found = hit(event); if (found) dispatch(routeHotspot(found.object.userData.hotspot));
  }
  function cancel(event) { activePointers.delete(event.pointerId); down = null; clear(); }
  function outsideUp(event) { if (event.target !== world.canvas) cancel(event); }
  const off = world.onFrame(() => {
    if (isBlocked() || director.moving) { clear(); return; }
    if (pending) {
      const found = hit(pending); pending = null; hovered = found?.object || null;
      if (!hovered) { clear(); return; }
      const id = hovered.userData.hotspot, route = routeHotspot(id);
      label.textContent = hovered.userData.label || CATALOG[route.place]?.sections.find(s => s.id === route.section)?.label || CATALOG[route.place]?.title || '进入大厅';
    }
    if (!hovered) return;
    const point = hotspotAnchor(hovered, world.places).project(world.camera);
    const rect = world.canvas.getBoundingClientRect();
    label.hidden = Math.abs(point.x) > 1 || Math.abs(point.y) > 1 || point.z < -1 || point.z > 1;
    label.style.left = `${Math.max(70,Math.min(rect.width-70,(point.x+1)*rect.width/2))}px`;
    label.style.top = `${Math.max(60,(1-point.y)*rect.height/2-22)}px`;
    world.canvas.style.cursor = 'pointer';
  });
  world.canvas.addEventListener('pointerdown', onDown); world.canvas.addEventListener('pointermove', onMove);
  world.canvas.addEventListener('pointerleave', clear); world.canvas.addEventListener('pointerup', onUp);
  world.canvas.addEventListener('pointercancel', cancel);
  window.addEventListener('pointerup', outsideUp); window.addEventListener('pointercancel', cancel);
  return () => { off(); clear(); world.canvas.removeEventListener('pointerdown', onDown); world.canvas.removeEventListener('pointermove', onMove); world.canvas.removeEventListener('pointerleave', clear); world.canvas.removeEventListener('pointerup', onUp); world.canvas.removeEventListener('pointercancel', cancel); window.removeEventListener('pointerup', outsideUp); window.removeEventListener('pointercancel', cancel); };
}
