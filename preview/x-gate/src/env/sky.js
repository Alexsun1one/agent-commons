// 天空穹顶、雾、灯光、环境图。冷色清晨高空：天顶深钴蓝 → 地平线淡青白，太阳冷白低位。
import * as THREE from 'three';
import { PLACES } from '../kit/world.js';

// 相机左肩的 3/4 前侧光：水平偏左 40°、高度 40°，不随俯仰改变高度角。
const UP = new THREE.Vector3(0, 1, 0);
const SUN_ANGLE = THREE.MathUtils.degToRad(40);
export const SUN_DIR = new THREE.Vector3(-Math.sin(SUN_ANGLE) * Math.cos(SUN_ANGLE), Math.sin(SUN_ANGLE), Math.cos(SUN_ANGLE) ** 2);

export function cameraSunDirection(camera, target = new THREE.Vector3()) {
  camera.getWorldDirection(target).negate().setY(0);
  if (target.lengthSq() < 1e-8) return target.copy(SUN_DIR);
  target.normalize().applyAxisAngle(UP, -SUN_ANGLE).multiplyScalar(Math.cos(SUN_ANGLE));
  target.y = Math.sin(SUN_ANGLE);
  return target;
}
export const FOG_COLOR = new THREE.Color(0xb3d7fa);
export const FOG_DENSITY = 0.00078;
// 俯瞰时雾变薄、雾色往饱和天蓝靠：y ≤ 60 不变，y ≥ 400 密度 ×0.65。
const FOG_COLOR_HIGH = new THREE.Color(0x66b7ed);
const LOW_COLOR = new THREE.Color(0xa6d0e8), LOW_COLOR_HIGH = new THREE.Color(0x74b9e8);

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`;

const SKY_FRAG = /* glsl */`
varying vec3 vDir;
uniform vec3 uSun; uniform vec3 uZenith; uniform vec3 uUpper; uniform vec3 uMid; uniform vec3 uHorizon; uniform vec3 uLow;
uniform float uTime; uniform float uBelow;
// 非周期格点噪声：绝对坐标哈希，不依赖 RepeatWrapping 贴图。
float cloudHash(vec2 p) {
  vec3 q=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));
  q+=dot(q,q.yzx+33.33);
  return fract((q.x+q.y)*q.z);
}
float cloudNoise(vec2 p) {
  vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(cloudHash(i),cloudHash(i+vec2(1,0)),f.x),
             mix(cloudHash(i+vec2(0,1)),cloudHash(i+vec2(1,1)),f.x),f.y);
}
float cloudDetail(vec2 p) {
  mat2 turn=mat2(.8,.6,-.6,.8);
  float value=.51*cloudNoise(p);
  p=turn*p*2.13+17.4; value+=.26*cloudNoise(p);
  p=turn*p*2.07-8.1; value+=.15*cloudNoise(p);
  p=turn*p*2.11+31.6; value+=.08*cloudNoise(p);
  return value;
}
void main() {
  vec3 d = normalize( vDir );
  float e = max( d.y, 0.0 );
  vec3 c = mix( uHorizon, uMid, smoothstep( 0.0, 0.16, e ) );
  c = mix( c, uUpper, smoothstep( 0.08, 0.34, e ) );
  c = mix( c, uZenith, smoothstep( 0.30, 0.9, e ) );
  float sd = max( dot( d, uSun ), 0.0 );
  // 太阳一侧地平线更亮更白；整体仍偏冷。
  c += vec3( 0.55, 0.72, 0.85 ) * pow( sd, 7.0 ) * 0.10 * ( 1.0 - smoothstep( 0.0, 0.5, e ) * 0.6 );
  c += vec3( 0.80, 0.92, 1.00 ) * pow( sd, 180.0 ) * 0.025;
  c += vec3( 1.00, 1.00, 1.00 ) * pow( sd, 1800.0 ) * 0.10;
  c += vec3( 1.8, 1.85, 1.9 ) * smoothstep( 0.999992, 0.999997, sd );
  // 大块留蓝与成带云团由低频域控制，小絮在云团内部变化；头顶更疏。
  vec2 cp=d.xz/max(d.y,.055)*3.8+vec2(11.7,-23.4);
  cp+=vec2(uTime*.0006,uTime*.0002);
  vec2 warp=vec2(cloudNoise(cp*.18),cloudNoise(cp*.18+43.7))-.5;
  vec2 uv=cp+warp*2.4;
  float bank=cloudDetail(uv*vec2(.16,.30));
  float gap=.38+.08*smoothstep(.30,.85,e);
  float coverage=smoothstep(gap,gap+.18,bank);
  float small=cloudDetail(uv*2.5);
  float large=cloudDetail(uv*.75+15.3);
  float density=mix(small,large,smoothstep(.40,.72,bank)*.58);
  float cloud=smoothstep(.40,.67,density)*coverage;
  cloud*=smoothstep(.045,.16,e);
  float shade=cloudDetail(uv*2.5+vec2(-.12,.17));
  vec3 cloudColor=mix(vec3(.52,.61,.82),vec3(1.0,1.03,1.08),smoothstep(.36,.65,shade));
  c=mix(c,cloudColor,cloud*.92);
  // 地平线以下：云海的延伸，向下渐深一点蓝。
  float below = smoothstep( 0.0, 0.32, -d.y );
  c = mix( c, uLow, below );
  // 相机在云海之下：上方是云底，下方是深蓝空。
  vec3 under = mix( vec3( 0.16, 0.22, 0.36 ), vec3( 0.30, 0.38, 0.54 ), 1.0 - smoothstep( 0.0, 0.5, d.y ) );
  vec3 deep = mix( vec3( 0.10, 0.18, 0.36 ), vec3( 0.02, 0.05, 0.14 ), smoothstep( 0.0, 0.7, -d.y ) );
  c = mix( c, d.y > 0.0 ? under : deep, uBelow );
  gl_FragColor = vec4( c, 1.0 );
}`;

function skyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: {
      uSun: { value: SUN_DIR.clone() },
      uZenith: { value: new THREE.Color(0x2557ac) }, uUpper: { value: new THREE.Color(0x2977c6) },
      uMid: { value: new THREE.Color(0x278ee6) }, uHorizon: { value: FOG_COLOR.clone() }, uLow: { value: new THREE.Color(0xa6d0e8) },
      uTime: { value: 0 }, uBelow: { value: 0 },
    },
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
  });
}

export function createSky(ctx) {
  const { scene, renderer, pmrem, quality, reducedMotion } = ctx;
  const hi = quality !== 'low';
  const sunDirection = SUN_DIR.clone(), nextSunDirection = SUN_DIR.clone();
  if (ctx.camera) cameraSunDirection(ctx.camera, sunDirection);

  // 穹顶：半径 skyRadius，跟随相机。
  const material = skyMaterial();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 24), material);
  dome.name = 'env:sky'; dome.frustumCulled = false; dome.renderOrder = -10;

  // 雾与背景：远处融进天空地平线色。
  scene.fog = new THREE.FogExp2(FOG_COLOR.getHex(), FOG_DENSITY);
  scene.background = FOG_COLOR.clone();

  // 冷白直射与钴蓝间接光分离，明亮屋顶不依靠抬高全屏曝光。
  const lights = new THREE.Group(); lights.name = 'env:lights';
  const sun = new THREE.DirectionalLight(0xf4faff, 5.4);
  sun.name = 'env:sun';
  sun.castShadow = hi;
  const mapSize = hi ? 4096 : 2048;
  sun.shadow.mapSize.set(mapSize, mapSize);
  sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.35;
  sun.shadow.radius = 1;
  const hemi = new THREE.HemisphereLight(0x648bea, 0x8ca9e4, 0.24);
  hemi.name = 'env:hemi';
  const fill = new THREE.DirectionalLight(0x8aaafa, 0.65);
  fill.name = 'env:fill';
  lights.add(sun, sun.target, hemi, fill, fill.target);

  // 投影五岛完整包络到光空间，比扩大一个正方形盒更清晰；所有镜头共用。
  // 保留 focusShadow 调用接口，但聚焦单楼也不裁掉其他楼岛的阴影。
  function focusShadow() {
    const bounds = new THREE.Box3();
    for (const place of Object.values(PLACES)) {
      const [x,y,z] = place.position, r = place.island + 12;
      bounds.expandByPoint(new THREE.Vector3(x-r,y-20,z-r));
      bounds.expandByPoint(new THREE.Vector3(x+r,y+place.envelope.height,z+r));
    }
    const c = bounds.getCenter(new THREE.Vector3());
    sun.target.position.copy(c);
    sun.position.copy(c).addScaledVector(sunDirection, 1200);
    fill.target.position.copy(c);
    fill.position.set(-sunDirection.x, 0.3, -sunDirection.z).multiplyScalar(500).add(c);
    material.uniforms.uSun.value.copy(sunDirection);
    const cam = sun.shadow.camera;
    cam.position.copy(sun.position); cam.lookAt(c); cam.updateMatrixWorld(true);
    const lightBounds = new THREE.Box3();
    for (const place of Object.values(PLACES)) {
      const [x,y,z] = place.position, r = place.island + 12;
      for (const px of [x-r,x+r]) for (const py of [y-20,y+place.envelope.height]) for (const pz of [z-r,z+r]) {
        lightBounds.expandByPoint(new THREE.Vector3(px,py,pz).applyMatrix4(cam.matrixWorldInverse));
      }
    }
    const pad = 8;
    cam.left = lightBounds.min.x-pad; cam.right = lightBounds.max.x+pad;
    cam.bottom = lightBounds.min.y-pad; cam.top = lightBounds.max.y+pad;
    cam.near = Math.max(1,-lightBounds.max.z-pad); cam.far = -lightBounds.min.z+pad;
    cam.updateProjectionMatrix();
    sun.target.updateMatrixWorld(); sun.updateMatrixWorld();
    fill.target.updateMatrixWorld(); fill.updateMatrixWorld();
    sun.shadow.needsUpdate = true;
    sun.userData.shadowTexelMetres = [(cam.right-cam.left)/mapSize,(cam.top-cam.bottom)/mapSize];
  }
  focusShadow();

  // 环境图：让金属和玻璃反射这片天空。
  let envRT = null;
  if (pmrem && renderer) {
    const envScene = new THREE.Scene();
    const m = skyMaterial();
    m.uniforms.uSun.value.copy(sunDirection);
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 64, 32), m));
    envRT = pmrem.fromScene(envScene, 0.02, 0.1, 100);
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.18;
    m.dispose(); envScene.children[0].geometry.dispose();
  }
  if (renderer) renderer.toneMappingExposure = 0.9;

  function update(t, camera) {
    if (camera) {
      cameraSunDirection(camera, nextSunDirection);
      if (nextSunDirection.distanceToSquared(sunDirection) > 1e-8) {
        sunDirection.copy(nextSunDirection);
        focusShadow();
      }
      dome.position.copy(camera.position);
      const k = THREE.MathUtils.smoothstep(camera.position.y, 60, 400);
      if (scene.fog && scene.fog.isFogExp2) {
        scene.fog.density = FOG_DENSITY * (1 - 0.35 * k);
        scene.fog.color.copy(FOG_COLOR).lerp(FOG_COLOR_HIGH, k);
        material.uniforms.uHorizon.value.copy(scene.fog.color);
        material.uniforms.uLow.value.copy(LOW_COLOR).lerp(LOW_COLOR_HIGH, k);
        if (scene.background && scene.background.isColor) scene.background.copy(scene.fog.color);
      }
      material.uniforms.uBelow.value = THREE.MathUtils.smoothstep(-camera.position.y, 70, 150);
    }
    if (!reducedMotion) material.uniforms.uTime.value = t;
  }

  function dispose() {
    dome.geometry.dispose(); material.dispose();
    if (envRT) { if (scene.environment === envRT.texture) scene.environment = null; envRT.dispose(); }
    if (scene.fog) scene.fog = null;
  }
  return { dome, lights, sun, sunDirection, focusShadow, update, dispose };
}
