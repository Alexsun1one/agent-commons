// 示范模块（供新模块照抄接口与做法；不是城市里的正式建筑）。
// 看点：①三层尺度的细节（体量 → 肋/层板 → 螺栓灯点）②倒角与分缝 ③发光只勾结构线
// ④重复件走 radial/instanced ⑤quality=low 时砍掉小件 ⑥热点盒 + 边界 + update + dispose。
// 运行：?solo=_example-beacon
export const meta = { id: '_example-beacon', name: '示范信标塔', en: 'EXAMPLE BEACON' };

export function build(ctx) {
  const { THREE, kit, mats, quality, reducedMotion } = ctx;
  const hi = quality !== 'low';
  const b = new kit.Builder(mats);
  const root = new THREE.Group(); root.name = meta.id;

  // ── 1. 体量：三级退台基座（倒角盒），每级顶面压一圈收边，避免「盒子摞盒子」。
  const tiers = [[34, 3.2], [27, 2.6], [20, 2.2]];
  let y = 0;
  tiers.forEach(([w, h], i) => {
    b.rbox(w, h, w, 0.6, { y: y + h / 2 }, i === 0 ? 'shellCool' : 'shell');
    b.rbox(w + 0.6, 0.35, w + 0.6, 0.15, { y: y + h - 0.1 }, 'metal');           // 收边压条
    b.box(w - 2, 0.08, 0.12, { y: y + h * 0.45, z: w / 2 + 0.02 }, 'glowSoft');  // 正面一条暗光线，只勾正门方向
    y += h;
  });
  // 正门：台阶 + 门洞框 + 门楣光带。正门永远朝 +Z。
  b.array(6, [0, 0.25, 19.5], [0, 2.75, 15.5], (bb, i) => bb.box(8, 0.5, 1.6, {}, i % 2 ? 'shell' : 'shellCool'));
  b.rbox(9.6, 7.2, 1.2, 0.3, { y: y + 3.6, z: 10.2 }, 'graphite');
  b.box(7.4, 6.2, 0.4, { y: y + 3.1, z: 10.7 }, 'glass');
  b.box(7.6, 0.18, 0.2, { y: y + 6.5, z: 10.9 }, 'glow');

  // ── 2. 塔身：旋转体轮廓（收腰、肩部外扩），比圆柱有性格。
  const baseY = y;
  b.lathe([[7.5, 0], [7.2, 6], [5.6, 18], [5.2, 26], [6.4, 30], [6.6, 31], [4.0, 34], [3.6, 34.01]], { y: baseY }, 'shell', hi ? 64 : 32);
  // 竖肋：12 条，沿塔身轮廓走（用 tube 跟随 lathe 曲线 + 0.35 m 外偏），不能悬空。
  const profile = [[7.2, 6], [6.4, 12], [5.6, 18], [5.2, 26], [6.4, 30]];
  b.radial(12, 0, (bb, i) => {
    bb.tube(profile.map(([r, h]) => [0, baseY + h, r + 0.35]), 0.32, {}, 'metal', 24, 6);
    if (i % 3 === 0) bb.tube(profile.map(([r, h]) => [0, baseY + h, r + 0.7]), 0.07, {}, 'glow', 24, 4);   // 每三条肋一条光线，别全亮
  });
  // 层板环：塔身被横向分段，读出尺度。
  [[9, 6.95], [15, 6.15], [21, 5.5]].forEach(([h, r]) => b.torus(r, 0.22, { y: baseY + h }, 'metal', 6, hi ? 96 : 48));

  // ── 3. 冠部：悬浮光环 + 天线 + 夹持臂（只有夹持臂接触光环，光环不能悬空无依）。
  const crownY = baseY + 34;
  b.cyl(0.5, 0.9, 16, { y: crownY + 8 }, 'metal', 16);
  b.cyl(0.08, 0.08, 6, { y: crownY + 19 }, 'glowWhite', 6);
  b.radial(3, 0, (bb) => {
    bb.push({ y: crownY + 4 });
    bb.box(0.5, 0.5, 9.2, { z: 4.6 }, 'graphite');
    bb.box(0.9, 1.6, 0.9, { z: 9.2 }, 'metal');
    bb.pop();
  }, { phase: Math.PI / 6 });
  const halo = new kit.Builder(mats);
  halo.torus(9.6, 0.35, {}, 'shellCool', 10, hi ? 128 : 64);
  halo.torus(9.6, 0.09, { y: 0.38 }, 'glow', 6, hi ? 128 : 64);
  halo.torus(9.6, 0.09, { y: -0.38 }, 'glowBlue', 6, hi ? 128 : 64);
  const haloMesh = halo.build('halo');
  haloMesh.position.y = crownY + 4;
  root.add(haloMesh);

  // ── 4. 小尺度：基座四周的灯柱用实例化（低档省掉）。
  if (hi) {
    const posts = [];
    for (let i = 0; i < 28; i++) {
      const a = i / 28 * Math.PI * 2;
      if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.35) continue; // 正门方向留空
      posts.push(kit.toMatrix({ x: Math.sin(a) * 16.4, y: 3.2 + 0.6, z: Math.cos(a) * 16.4 }));
    }
    root.add(kit.instanced(new THREE.CylinderGeometry(0.09, 0.12, 1.2, 8), mats.metal, posts, 'posts'));
    root.add(kit.instanced(new THREE.SphereGeometry(0.16, 10, 8), mats.glowWhite, posts.map(m => m.clone().multiply(kit.toMatrix({ y: 0.7 }))), 'post-lights'));
  }

  // 正面标识：只在正门上方一处。
  const sign = kit.textPanel('BEACON', { height: 1.4 });
  sign.position.set(0, baseY + 8.2, 10.95);
  root.add(b.build('body'), sign);

  // ── 5. 交互热点与边界。热点 id 用契约地点 id；示范件用自己的 id。
  const hot = kit.hotspot(meta.id, 36, 60, 36, { y: 30 });
  root.add(hot);
  const bounds = new THREE.Box3().setFromObject(root);

  return {
    group: root,
    hotspots: [hot],
    bounds,
    // 动画只做缓慢、低幅度的环境运动；reducedMotion 时静止。
    update(t) { if (!reducedMotion) haloMesh.rotation.y = t * 0.12; },
    dispose() { kit.disposeTree(root); },
  };
}
