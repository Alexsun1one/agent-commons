// 共享材质库。模块只按名字取材质：ctx.mats.shell 等；不要在模块里复制一套同名材质。
// 浏览器里用 canvas 生成面板缝、窗格、地砖纹理；Node（体检脚本）下没有 document，退化为素材质。
import * as THREE from 'three';

export const PALETTE = {
  // 色相禁区 15°–65°（无黄、橙、棕），与先锋队视觉系统 v2 一致。
  titanium: 0xd9e1ec, ceramic: 0xe8edf4, steel: 0x9aa9ba, graphite: 0x27303c, ink: 0x0d1626,
  cobalt: 0x2d5bff, cyan: 0x5fe8ff, teal: 0x2fd6c6, violet: 0x8f82ff, ice: 0xcfe9ff,
  glass: 0x1d4a75, rock: 0x5d6a7c, rockDark: 0x343e4d,
};

const hasDOM = typeof document !== 'undefined';

function canvasTex(size, draw, { repeat = 1, color = false } = {}) {
  if (!hasDOM) return null;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function rand(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// 面板缝：大小不一的矩形分格，缝线深、板面带极轻噪声。一张图 = 4 m（见 kit.projectUVs）。
function panelBump(ctx, s) {
  const r = rand(7);
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 2600; i++) { const v = 118 + r() * 20 | 0; ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.fillRect(r() * s, r() * s, 2, 2); }
  ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 3;
  const split = (x, y, w, h, d) => {
    if (d > 3 || (d > 1 && r() < 0.3)) { ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3); return; }
    if (w > h) { const k = w * (0.3 + r() * 0.4); split(x, y, k, h, d + 1); split(x + k, y, w - k, h, d + 1); }
    else { const k = h * (0.3 + r() * 0.4); split(x, y, w, k, d + 1); split(x, y + k, w, h - k, d + 1); }
  };
  split(0, 0, s, s, 0);
  ctx.fillStyle = '#5a5a5a';
  for (let i = 0; i < 40; i++) { const x = r() * s, y = r() * s; ctx.beginPath(); ctx.arc(x, y, 2.2, 0, 7); ctx.fill(); }
}

// 幕墙窗格：横向楼层带 + 竖梃；亮窗按楼层连成一段段（像有人在用的房间），整体低对比，避免棋盘马赛克。
function windowEmissive(ctx, s) {
  const r = rand(11);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, s, s);
  const rows = 16, cols = 16, cw = s / cols, rh = s / rows;
  for (let y = 0; y < rows; y++) {
    const base = 22 + r() * 18 | 0;
    ctx.fillStyle = `rgb(${base * 0.75 | 0},${base * 0.92 | 0},${base})`;
    ctx.fillRect(0, y * rh + 3, s, rh - 7);
    for (let x = 0; x < cols;) {
      const run = 2 + (r() * 6 | 0);
      if (r() < 0.38) {
        const v = r() < 0.08 ? 190 : 70 + r() * 50 | 0;
        ctx.fillStyle = `rgb(${v * 0.75 | 0},${v * 0.92 | 0},${v})`;
        ctx.fillRect(x * cw + 1, y * rh + 3, Math.min(run, cols - x) * cw - 2, rh - 7);
      }
      x += run;
    }
  }
}

function windowColor(ctx, s) {
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = '#9fb3c8';
  const rows = 16, cols = 16, cw = s / cols, rh = s / rows;
  for (let y = 0; y < rows; y++) ctx.fillRect(0, y * rh, s, 3);
  for (let x = 0; x < cols; x++) ctx.fillRect(x * cw, 0, 2, s);
}

// 地砖：1 m 方砖，每 4 块一道深缝。
function pavingBump(ctx, s) {
  const r = rand(23);
  ctx.fillStyle = '#7a7a7a'; ctx.fillRect(0, 0, s, s);
  const n = 8, k = s / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const v = 116 + r() * 26 | 0; ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.fillRect(x * k + 1, y * k + 1, k - 2, k - 2); }
  ctx.fillStyle = '#303030';
  for (let i = 0; i <= 2; i++) { ctx.fillRect(i * s / 2 - 2, 0, 4, s); ctx.fillRect(0, i * s / 2 - 2, s, 4); }
}

export function createMaterials() {
  const bump = canvasTex(512, panelBump);
  const pave = canvasTex(512, pavingBump);
  const winE = canvasTex(512, windowEmissive);
  const winC = canvasTex(512, windowColor, { color: true });

  const std = (o) => new THREE.MeshStandardMaterial(o);
  const phys = (o) => new THREE.MeshPhysicalMaterial(o);
  const glow = (color, intensity = 3) => std({ color: 0x000000, emissive: color, emissiveIntensity: intensity, roughness: 1, metalness: 0 });

  const m = {
    // 外壳：钛白陶瓷板，带面板缝。大面积主体用它。
    shell: phys({ color: PALETTE.titanium, metalness: 0.25, roughness: 0.5, clearcoat: 0.15, clearcoatRoughness: 0.4, bumpMap: bump, bumpScale: 1.2 }),
    // 次级外壳：略冷略暗，用于退后的体块、底面、内凹面，拉开层次。
    shellCool: phys({ color: 0xc9d5e3, metalness: 0.35, roughness: 0.5, clearcoat: 0.12, clearcoatRoughness: 0.4, bumpMap: bump, bumpScale: 1 }),
    // 无缝光面：小构件、圆柱、栏杆；不需要面板缝的地方。
    ceramic: phys({ color: PALETTE.ceramic, metalness: 0.1, roughness: 0.22, clearcoat: 0.8, clearcoatRoughness: 0.1 }),
    metal: std({ color: PALETTE.steel, metalness: 0.92, roughness: 0.28 }),
    graphite: std({ color: PALETTE.graphite, metalness: 0.75, roughness: 0.38, bumpMap: bump, bumpScale: 0.3 }),
    ink: std({ color: PALETTE.ink, metalness: 0.6, roughness: 0.5 }),
    // 反射玻璃：靠环境图出效果，不用 transmission（贵）。
    glass: std({ color: PALETTE.glass, metalness: 0.95, roughness: 0.06, envMapIntensity: 1.6 }),
    // 幕墙：玻璃 + 楼层带 + 随机亮窗，远看有尺度感。UV 一张 = 16 m（kit.projectUVs(geo, 16)）。
    curtain: std({ color: 0x7c9cbc, map: winC, metalness: 0.85, roughness: 0.12, emissive: 0xbfe6ff, emissiveMap: winE, emissiveIntensity: 1.2, envMapIntensity: 1.4 }),
    paving: std({ color: 0xdfe6ee, metalness: 0.15, roughness: 0.55, bumpMap: pave, bumpScale: 0.4 }),
    floor: std({ color: 0x1a2433, metalness: 0.7, roughness: 0.16 }),
    rock: std({ color: PALETTE.rock, metalness: 0.05, roughness: 0.92, flatShading: true }),
    rockDark: std({ color: PALETTE.rockDark, metalness: 0.05, roughness: 0.95, flatShading: true }),
    // 发光：泛光阈值 2.2（main.js），只有这些 emissive 件会晕光；亮白外壳不会。glowSoft 是不晕光的弱光线。线条、轨道、门框光带用它们。
    glow: glow(PALETTE.cyan, 7),
    glowSoft: glow(PALETTE.cyan, 2.4),
    glowBlue: glow(PALETTE.cobalt, 20),
    glowTeal: glow(PALETTE.teal, 7),
    glowViolet: glow(PALETTE.violet, 10),
    glowWhite: glow(0xe8f6ff, 6),
    // 全息：加色混合、不写深度，用于光幕、投影面、熊猫全息。
    holo: new THREE.MeshBasicMaterial({ color: PALETTE.cyan, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
  };
  for (const [k, v] of Object.entries(m)) { v.name = k; v.userData.shared = true; }
  return m;
}
