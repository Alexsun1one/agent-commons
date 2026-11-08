// X-GATE 环境：云海之上的未来城市，清晨高空。
// 天空/雾/灯光/阴影/环境图 + 云海 + 浮岛基座 + 光桥 + 远景。build(ctx) → { group, update, focusShadow, dispose }。
import * as THREE from 'three';
import { makeNoiseTexture, makePuffTexture, environmentViews } from './util.js';
import { createSky } from './sky.js';
import { buildIslands } from './islands.js';
import { bridgeSpecs, buildBridges } from './bridges.js';
import { createClouds } from './clouds.js';
import { createFar } from './far.js';
import { createLandscape } from './landscape.js';
import { buildPromenade } from './promenade.js';
import { railingMaterials } from './railings.js';
import { createFlows } from './flows.js';
import { buildForecourts } from './forecourts.js';

export const meta = { id: 'env', name: '环境', en: 'ENVIRONMENT' };

export function build(ctx) {
  const { kit, mats, quality, scene, camera } = ctx;
  const hi = quality !== 'low';
  const views = environmentViews(ctx.shots ?? globalThis.window?.__xgate?.SHOTS ?? {});
  const group = new THREE.Group(); group.name = 'env';
  const noise = makeNoiseTexture(256), puffTex = makePuffTexture(128);

  // 天空、雾、灯光、环境图
  const sky = createSky(ctx);
  group.add(sky.dome, sky.lights);

  // 浮岛 + 光桥（共用一个 Builder，按材质合并）
  // 冷白石铺装：低金属度与轻微天空补光保留背光面的砖纹。只克隆环境材质。
  const deck = mats.paving.clone(); deck.name = 'env:deck'; deck.color.set(0xe4eef9); deck.emissive.set(0x7296ea); deck.emissiveIntensity = .025; deck.roughness = .78; deck.metalness = .02; deck.userData.shared = true;
  const b = new kit.Builder({ ...mats, 'env:deck': deck });
  const inst = { posts: [], rails: [], panels: [], lights: [], poles: [], heads: [], bollards: [] };
  const isl = buildIslands(ctx, b, inst, hi);
  const bSpecs = bridgeSpecs(isl.specs);
  const railing = railingMaterials(mats);
  const bridges = buildBridges(ctx, b, inst, bSpecs, hi, railing);
  const promenade = buildPromenade(ctx, b, inst, isl.specs, hi, railing);
  const flows = createFlows(ctx, bSpecs, hi);
  group.add(flows.mesh);
  const forecourts = buildForecourts(ctx,b,isl.specs,railing,hi);
  const rockMesh = isl.build();
  const body = b.build('env:islands');
  const landscape = createLandscape(ctx, isl.specs, noise, puffTex, hi, views, [...promenade.trees, ...forecourts.cameraTrees]);
  group.add(landscape.group);
  group.add(body, rockMesh, bridges.podMesh, bridges.bandMesh);

  // 实例化小件：栏杆立柱/扶手/玻璃、路灯、地灯
  const addInst = (geo, mat, list, name, shadow = true) => {
    if (!list.length) return;
    const m = kit.instanced(geo, mat, list, name); m.castShadow = shadow; m.frustumCulled = false; group.add(m);
  };
  addInst(new THREE.CylinderGeometry(0.07, 0.09, 1.1, 4), mats.metal, inst.posts, 'env:rail-posts');
  addInst(new THREE.BoxGeometry(1, 1, 1), mats.metal, inst.rails, 'env:rails');
  addInst(new THREE.BoxGeometry(1, 1, 1), mats.glass, inst.panels, 'env:rail-glass', false);
  addInst(new THREE.IcosahedronGeometry(0.13, 0), mats.glowWhite, inst.lights, 'env:rail-lights', false);
  addInst(new THREE.CylinderGeometry(0.1, 0.16, 6.2, 8), mats.metal, inst.poles, 'env:lamp-poles');
  const lampMat = new THREE.MeshStandardMaterial({ name: 'env:lamp', color: 0x000000, emissive: 0xe8f6ff, emissiveIntensity: 1.9, roughness: 1 });
  addInst(new THREE.IcosahedronGeometry(0.3, 0), lampMat, inst.heads, 'env:lamp-heads', false);
  addInst(new THREE.CylinderGeometry(0.32, 0.36, 0.9, 10), mats.ceramic, inst.bollards, 'env:bollards');

  // 云海与远景
  const clouds = createClouds(ctx, { noise, puffTex, islands: isl.specs, bridgePts: [...bridges.samples, ...promenade.samples, ...forecourts.samples], hi, views });
  const far = createFar(ctx, hi);
  group.add(clouds.group, far.group);

  function update(t) {
    sky.update(t, camera);
    landscape.update(t);
    clouds.update(t, camera, sky.sunDirection);
    if (!ctx.reducedMotion) { bridges.update(t); }
    far.update(t);
    flows.update(t);
  }

  function dispose() {
    sky.dispose(); clouds.dispose(); far.dispose();
    kit.disposeTree(group); deck.dispose();
    noise.dispose(); puffTex.dispose();
    scene.remove(group);
  }

  return { group, update, dispose, focusShadow: sky.focusShadow, bridges: bSpecs, islands: isl.specs, promenade, flows, forecourts };
}
