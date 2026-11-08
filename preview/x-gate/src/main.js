// 主循环与装配。
// URL 参数：?q=low 低画质；?solo=<模块id> 单独看一个模块（network / env / _example-beacon ...）；?debug=1 显示统计。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { createMaterials } from './kit/materials.js';
import { kit, stats } from './kit/kit.js';
import { PLACES, facingRotation } from './kit/world.js';

const params = new URLSearchParams(location.search);
const mobile = matchMedia('(max-width: 760px)').matches;
const quality = params.get('q') || (mobile ? 'low' : 'high');
const solo = params.get('solo');
const debug = params.has('debug') || !!solo;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const canvas = document.getElementById('world');

let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', reversedDepthBuffer: true }); }
catch (err) { document.body.dataset.state = 'webgl-error'; throw err; }
renderer.setPixelRatio(Math.min(devicePixelRatio, quality === 'low' ? 1.25 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = quality !== 'low';
renderer.shadowMap.type = THREE.PCFShadowMap;
// 阴影以静物为主：每 SHADOW_EVERY 帧重算一次（运动小件约 15Hz 更新；focusShadow 移位后最多滞后这么多帧）。
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
const SHADOW_EVERY = 4;
renderer.info.autoReset = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.5, 9000);
camera.position.set(0, 16, 175);
camera.lookAt(0, 34, 0);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.6;

const mats = createMaterials();
const ctx = { THREE, kit, mats, quality, reducedMotion, renderer, scene, camera, pmrem };

// MSAA 渲染目标：EffectComposer 默认目标没有多重采样，WebGLRenderer 的 antialias 对它无效。
const rt = new THREE.WebGLRenderTarget(innerWidth * renderer.getPixelRatio(), innerHeight * renderer.getPixelRatio(), { type: THREE.HalfFloatType, samples: quality === 'low' ? 2 : 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.6, 0.5, 2.2);
composer.addPass(bloom);
composer.addPass(new OutputPass());
// 调色（显示空间）：饱和+对比、暗部偏钴蓝、高光压一点让白云有层次。?grade=0 关闭对照。
if (params.get('grade') !== '0') composer.addPass(new ShaderPass({
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, 1.22);
      c = (c - 0.5) * 1.1 + 0.5;
      c += vec3(-0.012, 0.0, 0.035) * (1.0 - smoothstep(0.0, 0.55, l));
      c = mix(c, c * vec3(0.93, 0.96, 1.0), smoothstep(0.78, 1.0, l));
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
}));

const frameCbs = [];
const world = {
  THREE, kit, mats, quality, reducedMotion, mobile, renderer, scene, camera, canvas, composer, bloom,
  places: {},      // id → { group, hotspots, bounds(world), anchor(Vector3 世界坐标), meta, module }
  env: null,
  hotspots: [],    // 全部热点网格（只读，由 setHotspots 维护）；mesh.userData.hotspot = 热点 id
  hotspotGroups: new Map(),
  // 按组登记热点；同组再次登记会替换旧的（network 的 setGraph 重建节点后用 'network:nodes' 组重登）。
  setHotspots(group, list) { world.hotspotGroups.set(group, list || []); world.hotspots = [...world.hotspotGroups.values()].flat(); },
  onFrame(cb) { frameCbs.push(cb); return () => frameCbs.splice(frameCbs.indexOf(cb), 1); },
  // 工作台打开时外壳调用 setIdle(true)：降到约 20fps，省电。
  idle: false,
  setIdle(v) { world.idle = !!v; },
  ready: false,
};
window.__xgate = world;

async function load(path) {
  try { return await import(path); }
  catch (err) { console.warn(`[x-gate] 模块未就绪：${path}`, err.message); return null; }
}

function placeholder(id) {
  const b = new kit.Builder(mats);
  const env = PLACES[id].envelope;
  b.cyl(env.radius ?? 40, env.radius ?? 40, 2, { y: 1 }, 'shellCool', 48);
  b.torus((env.radius ?? 40) - 1, 0.3, { y: 2.2 }, 'glowSoft');
  const g = b.build(`placeholder:${id}`);
  g.add(kit.hotspot(id, 60, 40, 60, { y: 20 }));
  return { group: g, hotspots: [g.children.at(-1)], bounds: new THREE.Box3().setFromObject(g) };
}

async function addPlace(id) {
  const mod = await load(`./buildings/${id}.js`);
  let built;
  try { built = mod ? mod.build(ctx) : placeholder(id); }
  catch (err) { console.error(`[x-gate] ${id}.build 失败`, err); built = placeholder(id); }
  const g = new THREE.Group(); g.name = `place:${id}`;
  g.position.fromArray(PLACES[id].position);
  g.rotation.y = facingRotation(id);
  g.add(built.group);
  scene.add(g);
  g.updateMatrixWorld(true);
  const bounds = kit.visibleBounds(built.group);   // 取景用：仅可见几何，不含热点命中盒
  world.places[id] = { ...built, id, meta: PLACES[id], root: g, bounds, anchor: g.position.clone(), module: !!mod };
  world.setHotspots(id, built.hotspots);
  if (built.nodeHotspots) world.setHotspots(`${id}:nodes`, built.nodeHotspots);
  if (built.update) frameCbs.push(built.update);
}

async function assembleCity() {
  const envMod = await load('./env/index.js');
  if (envMod) {
    try {
      world.env = envMod.build(ctx);
      scene.add(world.env.group);
      if (world.env.update) frameCbs.push(world.env.update);
    } catch (err) { console.error('[x-gate] env.build 失败', err); }
  }
  if (!world.env) fallbackLights();
  for (const id of Object.keys(PLACES)) await addPlace(id);
  if (shot) return setShot(shot);
  const app = await load('./app/index.js');
  if (app) app.mount(world);
}

// 固定镜头：?shot=S01 只装城市不挂外壳，相机钉在预设上，供逐轮截图对比。建筑镜头用建筑局部坐标（正门 +Z）。
const shot = params.get('shot');
const SHOTS = {
  S01: { pos: [62, 15, 352], look: [-6, 66, 0], fov: 55 },
  S02: { place: 'network', pos: [-62, 16, 148], look: [0, 52, 0], fov: 58 },
  S03: { place: 'hub', pos: [60, 26, 110], look: [0, 26, -5], fov: 58 },
  S04: { place: 'cocreation', pos: [-75, 14, 175], look: [0, 50, 0], fov: 58 },
  S05: { place: 'value', pos: [70, 14, 185], look: [0, 56, 0], fov: 58 },
  S06: { pos: [0, 240, 720], look: [0, 20, -140], fov: 50 },
};
function setShot(id) {
  const s = SHOTS[id]; if (!s) return;
  document.getElementById('x-loading')?.remove();
  const toWorld = (v) => { const p = new THREE.Vector3(...v); if (s.place) p.applyAxisAngle(new THREE.Vector3(0, 1, 0), facingRotation(s.place)).add(new THREE.Vector3(...PLACES[s.place].position)); return p; };
  camera.fov = s.fov; camera.updateProjectionMatrix();
  camera.position.copy(toWorld(s.pos)); camera.lookAt(toWorld(s.look));
}
world.shot = setShot;
world.SHOTS = SHOTS;

function fallbackLights() {
  scene.background = new THREE.Color(0x9fc4e8);
  scene.fog = new THREE.Fog(0x9fc4e8, 300, 2600);
  scene.add(new THREE.HemisphereLight(0xeaf4ff, 0x40506a, 0.55));
  const sun = new THREE.DirectionalLight(0xf2f8ff, 2.4);
  sun.position.set(-300, 420, 260); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -320, right: 320, top: 320, bottom: -320, near: 10, far: 1400 });
  scene.add(sun);
}

async function assembleSolo(id) {
  let target;
  if (id === 'env') {
    const envMod = await load('./env/index.js');
    world.env = envMod.build(ctx); scene.add(world.env.group); if (world.env.update) frameCbs.push(world.env.update);
    target = new THREE.Box3(new THREE.Vector3(-400, -100, -400), new THREE.Vector3(400, 200, 300));
    return soloControls(target);
  }
  scene.background = new THREE.Color(0x8fb2d6);
  scene.environmentIntensity = 0.7;
  scene.add(new THREE.HemisphereLight(0xeaf4ff, 0x3a4860, 0.55));
  const sun = new THREE.DirectionalLight(0xf2f8ff, 2.4);
  sun.position.set(-180, 260, 220); sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -150, right: 150, top: 150, bottom: -150, near: 10, far: 900 });
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(400, 96), new THREE.MeshStandardMaterial({ color: 0x6f86a2, roughness: 0.9 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const mod = await load(`./buildings/${id}.js`);
  const built = mod.build(ctx);
  scene.add(built.group);
  if (built.update) frameCbs.push(built.update);
  world.places[id] = { ...built, id };
  world.setHotspots(id, built.hotspots);
  if (built.nodeHotspots) world.setHotspots(`${id}:nodes`, built.nodeHotspots);
  soloControls(new THREE.Box3().setFromObject(built.group));
}

function soloControls(target) {
  const c = target.getCenter(new THREE.Vector3()), size = target.getSize(new THREE.Vector3()).length();
  camera.position.copy(c).add(new THREE.Vector3(0.35, 0.3, 1).normalize().multiplyScalar(size * 1.25));
  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(c); controls.enableDamping = true; controls.update();
  world.controls = controls;
  frameCbs.push(() => controls.update());
}

const hud = debug ? Object.assign(document.createElement('pre'), { id: 'xgate-debug' }) : null;
if (hud) { hud.style.cssText = 'position:fixed;right:8px;bottom:8px;margin:0;padding:6px 8px;font:11px/1.4 ui-monospace,monospace;color:#cfe;background:#0a1220cc;border-radius:6px;z-index:99;pointer-events:none'; document.body.append(hud); }

world.stats = () => {
  const out = { total: { ...stats(scene), drawCalls: renderer.info.render.calls, frameTris: renderer.info.render.triangles } };
  for (const [id, p] of Object.entries(world.places)) out[id] = stats(p.group);
  if (world.env) out.env = stats(world.env.group);
  return out;
};

const clock = new THREE.Clock();
let fpsT = 0, fpsN = 0, fps = 0, rawT = 0, gapMax = 0;
let skip = 0, shadowTick = 0;
function frame() {
  requestAnimationFrame(frame);
  if (world.idle && (skip = (skip + 1) % 3)) return;
  const gap = clock.getDelta(), dt = Math.min(gap, 0.1), t = clock.elapsedTime;
  for (const cb of frameCbs) cb(t, dt);
  if (++shadowTick % SHADOW_EVERY === 0) renderer.shadowMap.needsUpdate = true;
  renderer.info.reset();
  composer.render();
  fpsN++; fpsT += dt; rawT += gap; gapMax = Math.max(gapMax, gap);
  if (fpsT > 1) { const real = fpsN / rawT, worst = gapMax * 1000; fps = fpsN / fpsT; fpsN = 0; fpsT = 0; rawT = 0; gapMax = 0; if (hud) { const s = world.stats(); hud.textContent = `${quality} · ${real.toFixed(1)} fps · max gap ${worst.toFixed(0)} ms · calls ${s.total.drawCalls} · tris ${(s.total.frameTris / 1e3).toFixed(0)}k\n` + Object.entries(s).filter(([k]) => k !== 'total').map(([k, v]) => `${k}: ${(v.tris / 1e3).toFixed(0)}k / ${v.calls}`).join('\n'); } }
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
});

(async () => {
  try {
    if (solo) await assembleSolo(solo); else await assembleCity();
  } catch (err) {
    console.error('[x-gate] 装配失败', err);
    document.body.dataset.state = 'error';
  }
  world.ready = true;
  document.body.dataset.state = document.body.dataset.state || 'ready';
  frame();
})();
