import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PLACES, PORTAL, facingRotation } from '../kit/world.js';
import { hotspotAnchor, selectHit } from './shell/picking.js';
import { neighbors } from './data/network.js';

export const STATE_BY_PLACE = { base: 'BaseEntrance', network: 'AgentNetwork', hub: 'AgentHub', cocreation: 'CoCreation', value: 'ValueCity' };
export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const ease = t => t * t * (3 - 2 * t);
const vector = value => value?.isVector3 ? value.clone() : new THREE.Vector3().fromArray(value);
const preset = (position, lookAt, fov = 45, transitionDuration = 1.65) => ({ position, lookAt, fov, transitionDuration, easing: 'smoothstep' });

function placeBounds(id, anchor, bounds) {
  if (bounds?.isBox3 && !bounds.isEmpty() && [...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)) return bounds;
  const e = PLACES[id].envelope, radius = e.radius || e.halfWidth;
  return new THREE.Box3(anchor.clone().add(new THREE.Vector3(-radius, 0, -radius)), anchor.clone().add(new THREE.Vector3(radius, e.height, radius)));
}
function corners(box) {
  const points = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) points.push(new THREE.Vector3(x,y,z));
  return points;
}
function inBuilding(point, places = {}) {
  return Object.entries(PLACES).some(([id, meta]) => {
    const p = point.clone().sub(vector(places[id]?.anchor || meta.position)).applyAxisAngle(new THREE.Vector3(0,1,0), -facingRotation(id));
    const e = meta.envelope;
    return p.y >= -2 && p.y <= e.height + 6 && (e.radius ? Math.hypot(p.x,p.z) < e.radius + 8 : Math.abs(p.x) < e.halfWidth + 8 && Math.abs(p.z) < e.halfDepth + 8);
  });
}
export function buildingPreset(id, anchor = PLACES[id].position, mobile = false, bounds, aspect = mobile ? 390/844 : 1.6, places = {}) {
  const origin = vector(anchor), box = placeBounds(id, origin, bounds), height = box.max.y-box.min.y;
  const middle = box.getCenter(new THREE.Vector3()), center = middle.clone(); center.y = box.min.y + height * .4;
  const points = corners(box), fov = mobile ? 56 : 52, camera = new THREE.PerspectiveCamera(fov, aspect, .5, 9000);
  const halfFov = Math.tan(THREE.MathUtils.degToRad(fov/2));
  // 水平平移相机和目标，让建筑中心位于桌面约 30% 处；手机居中。
  const compose = (distance, angle) => {
    const front = new THREE.Vector3(Math.sin(angle),0,Math.cos(angle));
    const right = new THREE.Vector3(Math.cos(angle),0,-Math.sin(angle));
    const target = center.clone().addScaledVector(right, mobile ? 0 : distance * halfFov * aspect * .4);
    const position = target.clone().addScaledVector(front,distance); position.y += height * .1;
    camera.position.copy(position); camera.lookAt(target); camera.updateMatrixWorld(true);
    const projected = points.map(p => p.clone().project(camera));
    const ys = projected.map(p => p.y), xs = projected.map(p => p.x);
    const fits = projected.every(p => p.z >= -1 && p.z <= 1) && (Math.max(...ys)-Math.min(...ys))/2 <= .625
      && Math.min(...xs) >= -.94 && Math.max(...xs) <= (mobile ? .94 : .20);
    return { position, target, fits };
  };
  const shot = turn => {
    const angle = facingRotation(id) + THREE.MathUtils.degToRad(turn);
    let low = 150, high = Math.max(150, height * 6, box.getSize(new THREE.Vector3()).length() * 3);
    for (let i=0;i<32;i++) { const mid=(low+high)/2; if (compose(mid,angle).fits) high=mid; else low=mid; }
    return compose(high,angle);
  };
  // 机位到包围盒八角与中心的视线，有几条穿过别的建筑（含总部）的包络；包络不留余量（余量是给飞行路径的）。
  const others = Object.keys(PLACES).filter(other => other !== id), sight = [...points, middle, center];
  const blocked = eye => sight.filter(point => others.some(other => sightBlocked(eye, point, other, vector(places[other]?.anchor || PLACES[other].position), 0))).length;
  let turn = 0, result;
  // 总部在四个正门前方；较远的正面机位若落进别的建筑，改用±35°前侧面。
  for (turn of [0, 35, -35, 40, -40]) { result = shot(turn); if (!inBuilding(result.position, places)) break; }
  // 该方位的视线被挡时，从它向两侧每 5° 转开，取最近的畅通方位；都不畅通就取被挡最少的。没被挡的楼机位不变。
  let least = blocked(result.position);
  for (let step = 5; step <= 180 && least; step += 5) for (const sign of [1, -1]) {
    const next = shot(turn + sign * step);
    if (!next.fits || inBuilding(next.position, places)) continue;
    const count = blocked(next.position);
    if (count < least) { result = next; least = count; }
    if (!least) break;
  }
  return preset(result.position.toArray(),result.target.toArray(),fov);
}
function railPresets(mobile) {
  return {
    BaseEntrance: preset([0, mobile ? 25 : 20, mobile ? 270 : 205], [0,34,40], mobile ? 50 : 45),
    BaseInterior: preset([0,9,mobile ? 30 : 24], [0,14,-50], mobile ? 60 : 55, 1.25),
    CityOverview: preset([0,560,820], [0,0,-120], mobile ? 70 : 50, 2.3),
  };
}
export function createPresets(places = {}, mobile = false, aspect = mobile ? 390/844 : 1.6) {
  const result = railPresets(mobile);
  for (const id of ['network','hub','cocreation','value']) result[STATE_BY_PLACE[id]] = buildingPreset(id, places[id]?.anchor || PLACES[id].position, mobile, places[id]?.bounds, aspect, places);
  return result;
}
export const PRESETS = createPresets();
// 工作台右停靠时世界里剩下的可见区（NDC）：桌面是左导航与面板之间；手机是品牌行与底部抽屉之间。
// 数值对应 style.css：导航 20+84px，面板 min(760px,50vw) 右距 24px（与建筑留 40px）；抽屉 62dvh 坐在 64px 导航上方。
export function splitRegion(mobile = false, width, height) {
  width ||= mobile ? 390 : 1440; height ||= mobile ? 844 : 900;
  if (mobile) return { x: [-.9, .9], y: [1 - 2 * (height - 64 - height * .62 - 12) / height, 1 - 2 * 56 / height] };
  const panel = Math.min(760, width * .5);
  return { x: [(20 + 84 + 24) / width * 2 - 1, (width - 24 - panel - 40) / width * 2 - 1], y: [-.84, .8] };
}
// 总部（轨道/大厅）只平移画面，不换机位；中心移到可见区中心。
export function frameShift(mobile = false, width, height) {
  const r = splitRegion(mobile, width, height);
  return mobile ? [0, (r.y[0] + r.y[1]) / 4] : [-(r.x[0] + r.x[1]) / 4, 0];
}
export const SPLIT_SECONDS = .9;
// 视线 a→b 是否穿过建筑 id 的安全包络（含高度）：水平相交区间内，视线高度与包络高度有交集。margin 是包络水平外扩的米数。
function sightBlocked(a, b, id, anchor, margin = 8) {
  const span = crossing(a, b, id, anchor, margin);
  if (!span) return false;
  const e = PLACES[id].envelope, bottom = anchor.y - 2, top = anchor.y + e.height + 6;
  const y0 = a.y + (b.y - a.y) * span[0], y1 = a.y + (b.y - a.y) * span[1];
  return Math.max(y0, y1) >= bottom && Math.min(y0, y1) <= top;
}
// 手机的可见带又扁又短：先把焦距放宽到这个上限（建筑在光轴附近，几乎不变形），不够再沿视线退后。
export const MOBILE_SPLIT_FOV = 100, MAX_SPLIT_FOV = 125;
const SPLIT_TURNS = [0, 15, -15, 30, -30, 45, -45, 60, -60, 75, -75, 90, -90, 105, -105, 120, -120, 135, -135, 150, -150, 165, -165, 180];
// 建筑的分屏机位：绕建筑转到视线不被别的建筑挡住的最近方位（保持距离与俯仰），
// 再用「放宽焦距 + 退镜头」让包围盒进入可见区，最后用镜头平移（setViewOffset）摆到区中央。
// 桌面先退镜头，手机先放宽焦距；退镜头只走视线畅通的那一段。
function splitPreset(id, base, box, mobile, aspect, region, places) {
  const points = corners(box), target = vector(base.lookAt), up = new THREE.Vector3(0,1,0);
  const camera = new THREE.PerspectiveCamera(base.fov, aspect, .5, 9000);
  const width = region.x[1] - region.x[0], height = region.y[1] - region.y[0];
  const sight = [...points, target], others = Object.keys(PLACES).filter(other => other !== id);
  const eyeAt = (back, scale) => target.clone().addScaledVector(back, scale);
  const clear = (back, scale) => {
    const eye = eyeAt(back, scale);
    return !inBuilding(eye, places) && others.every(other => {
      const anchor = vector(places[other]?.anchor || PLACES[other].position);
      return sight.every(point => !sightBlocked(eye, point, other, anchor));
    });
  };
  const home = vector(base.position).sub(target);
  const back = SPLIT_TURNS.map(turn => home.clone().applyAxisAngle(up, THREE.MathUtils.degToRad(turn))).find(candidate => clear(candidate, 1)) || home;
  const project = (scale, fov = base.fov) => {
    camera.fov = fov; camera.updateProjectionMatrix();
    camera.position.copy(eyeAt(back, scale)); camera.lookAt(target); camera.updateMatrixWorld(true);
    const ps = points.map(p => p.clone().project(camera)), xs = ps.map(p => p.x), ys = ps.map(p => p.y);
    return { x: [Math.min(...xs), Math.max(...xs)], y: [Math.min(...ys), Math.max(...ys)], front: ps.every(p => p.z >= -1 && p.z <= 1) };
  };
  const fits = (scale, fov) => { const v = project(scale, fov); return v.front && v.x[1] - v.x[0] <= width && v.y[1] - v.y[0] <= height; };
  let ceiling = 1; while (ceiling < 4 && clear(back, ceiling + .05)) ceiling = +(ceiling + .05).toFixed(2);
  const search = (low, high, test) => { for (let i = 0; i < 32; i++) { const mid = (low + high) / 2; if (test(mid)) high = mid; else low = mid; } return high; };
  const cap = mobile ? MOBILE_SPLIT_FOV : base.fov;
  let scale = 1, fov = base.fov;
  if (!fits(1, fov)) {
    if (fits(1, cap)) fov = search(base.fov, cap, f => fits(1, f));
    else if (fits(ceiling, cap)) { fov = cap; scale = search(1, ceiling, s => fits(s, cap)); }
    else { scale = ceiling; fov = search(cap, MAX_SPLIT_FOV, f => fits(ceiling, f)); }
  }
  const view = project(scale, fov), cx = (view.x[0] + view.x[1]) / 2, cy = (view.y[0] + view.y[1]) / 2;
  const frameOffset = [(cx - (region.x[0] + region.x[1]) / 2) / 2, ((region.y[0] + region.y[1]) / 2 - cy) / 2];
  return { position: eyeAt(back, scale).toArray(), lookAt: [...base.lookAt], fov, transitionDuration: SPLIT_SECONDS, easing: 'smoothstep', frameOffset };
}
export function createSplitPresets(places = {}, mobile = false, aspect = mobile ? 390/844 : 1.6, size = [], base = createPresets(places, mobile, aspect)) {
  const region = splitRegion(mobile, ...size), result = {};
  for (const id of ['network','hub','cocreation','value']) {
    const anchor = vector(places[id]?.anchor || PLACES[id].position);
    result[STATE_BY_PLACE[id]] = splitPreset(id, base[STATE_BY_PLACE[id]], placeBounds(id, anchor, places[id]?.bounds), mobile, aspect, region, places);
  }
  return result;
}
export const TRACK = Object.freeze({ min: 0, middle: 0.45, max: 1 });
export function sampleTrack(parameter, mobile = false) {
  const t = clamp(parameter, TRACK.min, TRACK.max), p = railPresets(mobile);
  const middle = preset([0, mobile ? 170 : 120, mobile ? 570 : 420], [0,80,0], mobile ? 52 : 45);
  const a = t <= TRACK.middle ? p.BaseEntrance : middle;
  const b = t <= TRACK.middle ? middle : p.CityOverview;
  const u = t <= TRACK.middle ? t / TRACK.middle : (t - TRACK.middle) / (1 - TRACK.middle);
  return { ...b, position: vector(a.position).lerp(vector(b.position), u).toArray(), lookAt: vector(a.lookAt).lerp(vector(b.lookAt), u).toArray(), fov: THREE.MathUtils.lerp(a.fov, b.fov, u) };
}
// 求水平线段穿过建筑安全包络的区间，确保同步抬升在进入包络前完成。
function crossing(a, b, id, anchor, margin = 8) {
  const rotation = -facingRotation(id), axis = new THREE.Vector3(0,1,0);
  const p = a.clone().sub(anchor).applyAxisAngle(axis,rotation);
  const d = b.clone().sub(a).applyAxisAngle(axis,rotation), e = PLACES[id].envelope;
  let enter = 0, exit = 1;
  if (e.radius) {
    const r = e.radius+margin, aa = d.x*d.x+d.z*d.z, bb = p.x*d.x+p.z*d.z, cc = p.x*p.x+p.z*p.z-r*r;
    if (aa < 1e-12) return cc <= 0 ? [0,1] : null;
    const discriminant = bb*bb-aa*cc;
    if (discriminant < 0) return null;
    enter = Math.max(0,(-bb-Math.sqrt(discriminant))/aa);
    exit = Math.min(1,(-bb+Math.sqrt(discriminant))/aa);
  } else {
    for (const [key,limit] of [['x',e.halfWidth+margin],['z',e.halfDepth+margin]]) {
      if (Math.abs(d[key]) < 1e-12) { if (Math.abs(p[key]) > limit) return null; continue; }
      const u = (-limit-p[key])/d[key], v = (limit-p[key])/d[key];
      enter = Math.max(enter,Math.min(u,v)); exit = Math.min(exit,Math.max(u,v));
    }
  }
  return enter <= exit ? [enter,exit] : null;
}
export const flightDuration = (from, to) => clamp(vector(from).distanceTo(vector(to))/240,2,4.5);
// 水平运动贯穿全程；抬升和下降与它同时进行，不再分成三个停走阶段。
export function flightPoint(from, to, t, roof = 360, direct = false, forceLift = false, places = {}) {
  const a = vector(from), b = vector(to), out = a.clone().lerp(b, t);
  if (t <= 0) return a; if (t >= 1) return b;
  if (!direct && (forceLift || a.distanceTo(b) > 160)) {
    const top = Math.max(roof, a.y + 60, b.y + 60);
    let rise = .25, fall = .25;
    for (const [id,meta] of Object.entries(PLACES)) {
      const interval = crossing(a,b,id,vector(places[id]?.anchor || meta.position));
      if (!interval) continue;
      if (interval[0] > 0) rise = Math.min(rise,interval[0]*.8);
      if (interval[1] < 1) fall = Math.min(fall,(1-interval[1])*.8);
    }
    const lift = Math.min(ease(clamp(t/rise,0,1)),ease(clamp((1-t)/fall,0,1)));
    out.y = THREE.MathUtils.lerp(out.y,top,lift) + Math.sin(Math.PI*t)*24*lift;
  }
  return out;
}

function mobileNetworkFov(world, nodeId, position, target, split) {
  const related = new Set([nodeId,...neighbors(nodeId)]);
  for (const id of [...related]) for (const next of neighbors(id)) related.add(next);
  const camera = new THREE.PerspectiveCamera(65,world.camera?.aspect || 390/844,.5,9000);
  camera.position.copy(position); camera.lookAt(target); camera.updateMatrixWorld(true);
  // 抽屉占55%，底部导航另占64px；给标题、节点外缘及抽屉圆角留余量。
  const bottom = .45-64/(world.canvas?.clientHeight || 844);
  const above = split ? (.225-.06)*2 : .9, below = split ? Math.max(.1,(bottom-.025-.225)*2) : .9;
  let tangent = Math.tan(THREE.MathUtils.degToRad(65/2));
  for (const hotspot of world.hotspots) {
    if (!related.has(hotspot.userData.nodeId)) continue;
    const point = hotspotAnchor(hotspot,world.places).applyMatrix4(camera.matrixWorldInverse), depth = -point.z-6;
    if (depth <= 0) return 180;
    tangent = Math.max(tangent,(Math.abs(point.x)+6)/(depth*camera.aspect*.9),(Math.abs(point.y)+6)/(depth*(point.y>=0 ? above : below)));
  }
  return THREE.MathUtils.radToDeg(2*Math.atan(tangent));
}

export function networkNodePreset(world, nodeId, mobile = false, split = true) {
  const place = world.places.network;
  if (!place?.group) return null;
  const hotspot = world.hotspots.find(h => h.userData.hotspot === 'network:me' && nodeId === 'me'
    || ['agent','human'].some(kind => h.userData.hotspot === `network:${kind}:${nodeId}`));
  if (!hotspot) return null;
  const node = hotspotAnchor(hotspot, world.places), anchor = place.anchor || new THREE.Vector3(...PLACES.network.position);
  const outward = node.clone().sub(anchor).setY(0);
  if (outward.lengthSq() < 1) outward.set(Math.sin(facingRotation('network')),0,Math.cos(facingRotation('network')));
  outward.normalize();
  place.group.updateWorldMatrix(true,true);
  const solids = []; place.group.traverse(object => { if (object.isMesh && !object.userData.hotspot) solids.push(object); });
  const clearSight = position => {
    if (!solids.length) return true;
    const ray = new THREE.Raycaster(position,node.clone().sub(position).normalize());
    return selectHit(ray.intersectObjects(world.hotspots,false),ray.intersectObjects(solids,false),'network')?.object === hotspot;
  };
  let safeFallback = null;
  const mobileCandidates = [];
  const scale = mobile ? 1.6 : 1;
  for (const baseDistance of [75,80,85,90]) for (const baseLift of [22,32]) for (const angle of [0,20,-20,40,-40]) {
    const distance = baseDistance*scale, lift = baseLift*scale;
    const direction = outward.clone().applyAxisAngle(new THREE.Vector3(0,1,0),THREE.MathUtils.degToRad(angle));
    const position = node.clone().addScaledVector(direction,Math.sqrt(distance*distance-lift*lift)); position.y += lift;
    if (place.bounds?.containsPoint(position) || inBuilding(position,world.places)) continue;
    const fov = mobile ? mobileNetworkFov(world,nodeId,position,node,split) : 60;
    const candidate = { ...preset(position.toArray(),node.toArray(),Math.min(fov,135),1.15), frameOffset: split ? (mobile ? [0,.275] : [.22,0]) : [0,0] };
    if (!safeFallback || candidate.fov < safeFallback.fov) safeFallback = candidate;
    if (mobile) { if (fov <= 135) mobileCandidates.push({candidate,position,score:fov+(distance-120)*.5}); continue; }
    if (!clearSight(position)) continue;
    return candidate;
  }
  // 先比较两跳构图，再做射线检查；优先较窄视角，避免人层节点看向高层时过度广角。
  mobileCandidates.sort((a,b)=>a.score-b.score);
  for (const {candidate,position} of mobileCandidates) if (clearSight(position)) return candidate;
  return safeFallback;
}
// 近距离换节点绕建筑外缘走；防止两端安全、直线却穿过中塔。
export function networkFocusPath(world, from, to, roof = 400) {
  const anchor = world.places.network.anchor || new THREE.Vector3(...PLACES.network.position);
  const a = vector(from).sub(anchor), b = vector(to).sub(anchor);
  const start = Math.atan2(a.x,a.z), end = Math.atan2(b.x,b.z);
  const turn = Math.atan2(Math.sin(end-start),Math.cos(end-start));
  const bounds = world.places.network.bounds;
  const radius = Math.max(PLACES.network.envelope.radius+12,...(bounds ? corners(bounds).map(p => Math.hypot(p.x-anchor.x,p.z-anchor.z)+8) : []));
  const path = t => {
    if (t === 0) return vector(from); if (t === 1) return vector(to);
    const ra = Math.hypot(a.x,a.z), rb = Math.hypot(b.x,b.z);
    const r = THREE.MathUtils.lerp(ra,rb,t) + Math.sin(Math.PI*t) * Math.max(0,radius-Math.min(ra,rb));
    return new THREE.Vector3(Math.sin(start+turn*t)*r,THREE.MathUtils.lerp(a.y,b.y,t),Math.cos(start+turn*t)*r).add(anchor);
  };
  for (let i=0;i<=40;i++) if (inBuilding(path(i/40),world.places) || bounds?.containsPoint(path(i/40))) return t => flightPoint(from,to,t,roof,false,true,world.places);
  return path;
}

export function createCameraDirector(world, { onState = () => {}, onArrival = () => {} } = {}) {
  const { camera, canvas } = world;
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false; controls.enablePan = false; controls.enableZoom = false;
  controls.enabled = false;
  world.controls = controls;
  let mobile = world.mobile, reduced = world.reducedMotion;
  const size = () => [canvas.clientWidth, canvas.clientHeight];
  let presets = createPresets(world.places, mobile, camera.aspect), state = 'BaseEntrance', place = 'base';
  let splits = createSplitPresets(world.places, mobile, camera.aspect, size(), presets);
  let target = vector(presets.BaseEntrance.lookAt), transition = null, blocked = false, disposed = false;
  let focusedNode = null, focusPose = null, splitView = false, frameOffset = [0,0];
  let rail = 0, railGoal = 0, orbit = false, drag = null, wheelPending = 0, orbitGoal = 0;
  const touches = new Map(); let pinch = null;
  const media = matchMedia('(max-width: 760px)'), motion = matchMedia('(prefers-reduced-motion: reduce)');
  const roof = Math.max(...Object.entries(PLACES).map(([id, p]) => (world.places[id]?.anchor?.y ?? p.position[1]) + p.envelope.height)) + 110;
  function frameView(offset = [0,0]) {
    frameOffset = offset;
    if (!offset[0] && !offset[1]) camera.clearViewOffset();
    else { const height=1000,width=camera.aspect*height; camera.setViewOffset(width,height,offset[0]*width,offset[1]*height,width,height); }
  }
  // 分屏时的画面：建筑用预算好的机位；总部（导轨/大厅/全景）原机位只平移画面。
  const baseShift = () => frameShift(mobile, ...size());
  const poseFor = next => !splitView ? presets[next] : splits[next] || { ...presets[next], frameOffset: baseShift() };
  function apply(p) {
    camera.position.copy(vector(p.position)); target.copy(vector(p.lookAt)); camera.fov = p.fov;
    camera.lookAt(target); frameView(p.frameOffset ?? (splitView && place === 'base' ? baseShift() : [0,0])); camera.updateProjectionMatrix(); controls.target.copy(target);
  }
  function configure() {
    controls.target.copy(target);
    controls.enabled = !blocked && !transition && (orbit || place !== 'base');
    if (orbit) {
      controls.minDistance = 320;
      controls.maxDistance = 1100;
      controls.minPolarAngle = 0.28; controls.maxPolarAngle = Math.PI * 0.43;
      controls.minAzimuthAngle = -Infinity; controls.maxAzimuthAngle = Infinity;
    } else if (focusedNode && place === 'network' && focusPose) {
      const original = vector(focusPose.position).sub(vector(focusPose.lookAt)), angle = new THREE.Spherical().setFromVector3(original);
      controls.minDistance = original.length(); controls.maxDistance = mobile ? 144 : 90;
      controls.minAzimuthAngle = angle.theta-Math.PI/9; controls.maxAzimuthAngle = angle.theta+Math.PI/9;
      controls.minPolarAngle = angle.phi-.08; controls.maxPolarAngle = angle.phi+.08;
    } else if (place !== 'base') {
      const offset = camera.position.clone().sub(target), sph = new THREE.Spherical().setFromVector3(offset);
      const active = poseFor(STATE_BY_PLACE[place]), original = vector(active.position).sub(vector(active.lookAt));
      const angle = new THREE.Spherical().setFromVector3(original);
      controls.minAzimuthAngle = angle.theta - THREE.MathUtils.degToRad(40);
      controls.maxAzimuthAngle = angle.theta + THREE.MathUtils.degToRad(40);
      controls.minPolarAngle = angle.phi - 0.08; controls.maxPolarAngle = angle.phi + 0.08;
      controls.minDistance = original.length();
      controls.maxDistance = Math.max(sph.radius, original.length() * 1.35);
    }
  }
  function cancel() { if (transition) { transition.resolve(false); transition = null; } }
  function move(p, direct = false, immediate = false, path = null, seconds) {
    cancel(); controls.enabled = false;
    const from = { position: camera.position.toArray(), lookAt: target.toArray(), fov: camera.fov, frameOffset: [...frameOffset] };
    if (reduced || immediate) { apply(p); configure(); return Promise.resolve(true); }
    const duration = seconds ?? (direct || path || focusedNode ? p.transitionDuration : flightDuration(from.position,p.position));
    return new Promise(resolve => { transition = { from, to: p, elapsed: 0, startedAt: performance.now(), duration, direct, path, resolve }; });
  }
  async function go(next, { immediate = false, split } = {}) {
    if (disposed || !presets[next]) return false;
    if (split !== undefined) splitView = !!split;
    const previous = state; focusedNode = null; focusPose = null;
    // 大厅出入只沿门洞走；从远方进大厅必须先到正门。
    if (previous === 'BaseInterior' && next !== 'BaseEntrance' && next !== 'BaseInterior') {
      const exited = await go('BaseEntrance', { immediate }); if (!exited) return false;
    }
    if (next === 'BaseInterior' && (state !== 'BaseEntrance' || rail > 0.02)) {
      const reached = await go('BaseEntrance', { immediate }); if (!reached) return false;
    }
    const leavingInterior = state === 'BaseInterior';
    state = next; place = Object.keys(STATE_BY_PLACE).find(id => STATE_BY_PLACE[id] === next) || 'base';
    orbit = next === 'CityOverview'; rail = railGoal = orbit ? 1 : 0; wheelPending = 0;
    orbitGoal = vector(presets.CityOverview.position).distanceTo(vector(presets.CityOverview.lookAt));
    onState(state, place);
    const success = await move(poseFor(next), next === 'BaseInterior' || leavingInterior, immediate);
    if (success) { configure(); world.env?.focusShadow?.(world.places[place]?.anchor || new THREE.Vector3(), 200); onArrival(state, place); }
    return success;
  }
  async function focusNode(nodeId) {
    if (disposed || place !== 'network') return false;
    const next = networkNodePreset(world,nodeId,mobile,splitView);
    if (!next) return false;
    const same = focusedNode === nodeId && focusPose && JSON.stringify(focusPose.frameOffset) === JSON.stringify(next.frameOffset);
    if (same) return true;
    focusedNode = nodeId; focusPose = next; wheelPending = 0;
    const path = camera.position.distanceTo(vector(next.position)) < .001 ? null : networkFocusPath(world,camera.position,next.position,roof);
    return move(next,false,false,path);
  }
  function setSplitView(enabled) {
    if (splitView === enabled) return;
    splitView = enabled;
    if (focusedNode && place === 'network') { void focusNode(focusedNode); return; }
    // 建筑：回到预算好的分屏/常规机位；总部：停在当前机位，只平移画面。
    const pose = splits[state] ? poseFor(state) : { position: camera.position.toArray(), lookAt: target.toArray(), fov: camera.fov, transitionDuration: SPLIT_SECONDS, easing: 'smoothstep', frameOffset: enabled ? baseShift() : [0,0] };
    // 机位只是微调就直接滑过去；若换了方位（绕开挡路的建筑），走常规飞行，不穿过别的建筑。
    const far = camera.position.distanceTo(vector(pose.position)) > 160;
    void move(pose, !far, false, null, far ? undefined : SPLIT_SECONDS);
  }
  function zoom(delta) {
    if (blocked || disposed || !Number.isFinite(delta)) return;
    wheelPending = clamp(wheelPending + delta, -3200, 3200);
  }
  function consumeZoom(delta) {
    if (blocked || disposed || !Number.isFinite(delta)) return;
    if (state === 'BaseInterior') { if (delta > 0) void go('BaseEntrance'); return; }
    if (place !== 'base') {
      if (transition) return;
      const offset = camera.position.clone().sub(target);
      camera.position.copy(target).add(offset.setLength(clamp(offset.length() * Math.exp(delta * .001), controls.minDistance, controls.maxDistance)));
      camera.lookAt(target); return;
    }
    if (orbit) {
      if (transition) cancel();
      const offset = camera.position.clone().sub(target), length = offset.length();
      const distance = (orbitGoal || length) * Math.exp(delta * .00065);
      if (delta < 0 && distance <= controls.minDistance * 1.025) {
        orbit = false; state = 'BaseEntrance'; rail = .45; railGoal = .45; onState(state, 'base');
        // 从近距离自由轨道平滑接回总部整体，避免旋转后的突然跳切。
        void move(sampleTrack(.45, mobile)).then(ok => { if (ok) configure(); });
      } else { orbitGoal = clamp(distance, controls.minDistance, controls.maxDistance); }
      return;
    }
    if (transition) {
      // 已在轨道上时允许改变目标，其他飞行先平滑衔接当前轨道。
      railGoal = clamp(railGoal + delta / 1600, 0, 1);
      return;
    }
    railGoal = clamp(railGoal + delta / 1600, 0, 1);
    
  }
  function finishRail() {
    if (rail >= .999 && railGoal === 1) { rail = 1; apply(sampleTrack(1, mobile)); orbit = true; orbitGoal = camera.position.distanceTo(target); state = 'CityOverview'; onState(state, 'base'); configure(); }
  }
  const wheel = event => { event.preventDefault(); zoom(event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1)); };
  const down = event => {
    if (blocked) return;
    if (event.pointerType === 'touch') touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (state === 'BaseInterior') drag = { x: event.clientX, y: event.clientY, target: target.clone() };
  };
  const pointerMove = event => {
    if (blocked) return;
    if (touches.has(event.pointerId)) {
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touches.size === 2) {
        const [a,b] = [...touches.values()], distance = Math.hypot(a.x-b.x,a.y-b.y);
        if (pinch != null) zoom((pinch-distance) * 3); pinch = distance; return;
      }
    }
    if (drag && state === 'BaseInterior' && !transition) {
      const yaw = clamp((event.clientX-drag.x) * -.003, -.28, .28), pitch = clamp((event.clientY-drag.y) * .002, -.13, .13);
      const offset = drag.target.clone().sub(camera.position); offset.applyAxisAngle(new THREE.Vector3(0,1,0), yaw); offset.y += pitch * 75;
      target.copy(camera.position).add(offset); camera.lookAt(target);
    }
  };
  const up = event => { touches.delete(event.pointerId); pinch = null; drag = null; };
  const frame = (_t, dt) => {
    if (wheelPending && !blocked) { const delta = clamp(wheelPending, -120, 120); wheelPending -= delta; consumeZoom(delta); }
    if (transition) {
      const job = transition;
      // 主循环会截断低帧率 dt；飞行使用真实经过时间，避免 2 秒动画被拉成 8 秒。
      job.elapsed = Math.max(job.elapsed+dt,(performance.now()-job.startedAt)/1000);
      const t = job.elapsed >= job.duration-1e-9 ? 1 : clamp(job.elapsed / job.duration, 0, 1), u = ease(t);
      camera.position.copy(job.path ? job.path(u) : flightPoint(job.from.position, job.to.position, u, roof, job.direct,false,world.places));
      target.copy(vector(job.from.lookAt).lerp(vector(job.to.lookAt), u)); camera.fov = THREE.MathUtils.lerp(job.from.fov, job.to.fov, u);
      camera.lookAt(target);
      frameView((job.from.frameOffset || [0,0]).map((v,i) => THREE.MathUtils.lerp(v,(job.to.frameOffset || [0,0])[i],u)));
      camera.updateProjectionMatrix();
      if (t === 1) { transition = null; apply(job.to); configure(); job.resolve(true); }
    } else if (place === 'base' && state !== 'BaseInterior' && !orbit && Math.abs(rail-railGoal) > .00001) {
      const next = reduced ? railGoal : THREE.MathUtils.damp(rail, railGoal, 7, dt);
      const maxStep = Math.min(.025, dt * 1.2);
      rail += clamp(next-rail, -maxStep, maxStep);
      if (Math.abs(rail-railGoal) < .0001) rail = railGoal;
      apply(sampleTrack(rail, mobile)); finishRail();
    } else if (controls.enabled) {
      if (orbit) {
        const offset = camera.position.clone().sub(target);
        const distance = reduced ? orbitGoal : THREE.MathUtils.damp(offset.length(), orbitGoal, 7, dt);
        camera.position.copy(target).add(offset.setLength(clamp(distance, controls.minDistance, controls.maxDistance)));
      }
      const before = camera.position.clone();
      controls.update(); target.copy(controls.target);
      if (focusedNode && (inBuilding(camera.position,world.places) || world.places.network.bounds?.containsPoint(camera.position))) { camera.position.copy(before); camera.lookAt(target); }
      if (orbit && inBuilding(camera.position, world.places)) {
        const offset = camera.position.clone().sub(target);
        for (let distance=offset.length(); distance<=controls.maxDistance && inBuilding(camera.position, world.places); distance+=10) camera.position.copy(target).add(offset.clone().setLength(Math.min(distance+10,controls.maxDistance)));
        orbitGoal = camera.position.distanceTo(target);
      }
    }
    const base = world.places.base;
    if (base?.interior) {
      const portal = base.group.localToWorld(new THREE.Vector3(0, PORTAL.height / 2, PORTAL.z));
      base.interior.visible = state === 'BaseInterior' || camera.position.distanceTo(portal) <= 260;
    }
  };
  function resize() {
    mobile = media.matches; presets = createPresets(world.places, mobile, camera.aspect); splits = createSplitPresets(world.places, mobile, camera.aspect, size(), presets);
    if (focusedNode) { focusPose = null; void focusNode(focusedNode); return; }
    if (orbit) { camera.fov = presets.CityOverview.fov; frameView(splitView ? baseShift() : [0,0]); camera.updateProjectionMatrix(); configure(); return; }
    const shifted = p => splitView ? { ...p, frameOffset: baseShift() } : p;
    void move(state === 'BaseEntrance' ? shifted(sampleTrack(rail, mobile)) : poseFor(state), state === 'BaseInterior');
  }
  function reduce() { reduced = motion.matches; if (reduced && transition) { const job = transition; transition = null; apply(job.to); configure(); job.resolve(true); } }
  canvas.addEventListener('wheel', wheel, { passive: false });
  canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', pointerMove);
  window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  window.addEventListener('resize', resize); motion.addEventListener('change', reduce);
  const off = world.onFrame(frame);
  apply(presets.BaseEntrance);
  return {
    go, zoom, focusNode, setSplitView, get focusedNode() { return focusedNode; }, get state() { return state; }, get place() { return place; }, get moving() { return !!transition || (!orbit && Math.abs(rail-railGoal) > .0001); },
    setBlocked(value) { blocked = value; wheelPending = 0; touches.clear(); pinch = null; drag = null; configure(); },
    dispose() { if (disposed) return; disposed = true; cancel(); off(); controls.dispose(); canvas.removeEventListener('wheel', wheel); canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', pointerMove); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); window.removeEventListener('resize', resize); motion.removeEventListener('change', reduce); },
  };
}
