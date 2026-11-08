import { blossomTrees, shrubs as floraShrubs } from '../kit/flora.js';

export const meta = { id: 'cocreation', name: '社区共创中心', en: 'CO-CREATION' };

export function build(ctx) {
  const { THREE, kit, mats, quality, reducedMotion } = ctx;
  const hi = quality !== 'low';
  const root = new THREE.Group(); root.name = meta.id;
  // Local finishes do not mutate the shared palette or its disposal ownership.
  const finish = (name, color) => {
    const m = mats.ceramic.clone(); m.name = name; m.color.set(color);
    m.userData = {}; m.roughness = 0.85; m.metalness = 0.02; m.clearcoat = 0;
    return m;
  };
  const violet = finish('cocreation:blossom', '#8F82FF');
  const teal = finish('cocreation:shrub', '#2FD6C6');
  const blue = finish('cocreation:scarf', '#2D5BFF');
  const curtain = mats.curtain.clone();
  curtain.name = 'cocreation:cyan-curtain'; curtain.userData = {};
  curtain.color.set('#047C9B'); curtain.emissive.set('#00DFF5'); curtain.emissiveIntensity = 0.65;
  curtain.roughness = 0.22; curtain.metalness = 0.18; curtain.envMapIntensity = 0.45;
  curtain.map = null; curtain.emissiveMap = null;
  curtain.transparent = true; curtain.opacity = 0.82; curtain.depthWrite = false;
  curtain.side = THREE.DoubleSide;
  // Specular reflections also enter bloom: reducing emissive alone does not fix the tips.
  const shell = mats.shell.clone(); shell.name = 'cocreation:matte-sail'; shell.userData = {};
  shell.roughness = 0.78; shell.metalness = 0.08; shell.clearcoat = 0;
  shell.envMapIntensity = 0.35; shell.emissiveIntensity = 0;
  shell.color.set('#E8EDF4'); shell.bumpMap = null;
  const ceramic = mats.ceramic.clone(); ceramic.name = 'cocreation:matte-ceramic'; ceramic.userData = {};
  ceramic.roughness = 0.65; ceramic.metalness = 0.04; ceramic.clearcoat = 0; ceramic.envMapIntensity = 0.4;
  const towerLight = mats.glowSoft.clone(); towerLight.name = 'glow:cocreation-tower'; towerLight.userData = {};
  towerLight.emissive.set('#00E5FF'); towerLight.emissiveIntensity = 3.2;
  const b = new kit.Builder({ ...mats, shell, ceramic, curtain, towerLight, violet, teal, blue });
  const TAU = Math.PI * 2, floor = 0.9;
  const bridgeHeights = [25, 48, 70];
  // Three occupied terraces, with intermediate 0.3 m risers at their edges.
  const terraces = [{ r: 49, z: 0, y: 0.3 }];
  for (let i = 0; i < 4; i++) terraces.push({ r: 38.5 - i * 0.5, z: 7, y: 0.6 + i * 0.3 });
  for (let i = 0; i < 5; i++) terraces.push({ r: 29 - i * 0.5, z: 10, y: 1.8 + i * 0.3 });
  const plazaY = (x, z) => terraces.reduce((y, t) => Math.hypot(x, z - t.z) <= t.r ? t.y : y, 0);

  const seg = hi ? 48 : 24;
  const people = [], bridgePeople = [], crowns = [], shrubPoints = [];
  const person = (x, y, z, yaw = 0) => people.push(kit.toMatrix({ x, y: y + 0.9, z, ry: yaw }));

  // One articulated silhouette geometry, reused by both crowds and merged interior figures.
  // Feet sit at -0.9 relative to the instance origin; dark cobalt reads against pale paving.
  const figure = new kit.Builder({ person: blue });
  figure.sphere(0.22, { y: 0.68 }, 'person', hi ? 8 : 6, hi ? 5 : 4);
  figure.cyl(0.23, 0.19, 0.66, { y: 0.1 }, 'person', 6);
  for (const side of [-1, 1]) {
    figure.cyl(0.075, 0.065, 0.7, { x: side * 0.13, y: -0.55 }, 'person', 4);
    figure.cyl(0.065, 0.055, 0.64, { x: side * 0.29, y: 0.04, rz: side * 0.12 }, 'person', 4);
  }
  const peopleGeometry = figure.build('community-figure').children[0].geometry;

  // All parametrized skins share their edge samples: shell, glass and ribs meet.
  function surface(sample, rows, cols) {
    const p = [], indices = [];
    for (let i = 0; i <= rows; i++) for (let j = 0; j <= cols; j++) p.push(...sample(i / rows, j / cols));
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const a = i * (cols + 1) + j, c = a + cols + 1;
      indices.push(a, a + 1, c, a + 1, c + 1, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setIndex(indices); g.computeVertexNormals();
    return g;
  }
  // Equal angular spacing in the S04 courtyard frame; the middle sail stays tallest.
  const arcYaw = -Math.atan2(55, 140), arcRadius = 47;
  const towers = [-1.08, 0, 1.08].map((angle, i) => {
    const x = Math.sin(angle) * arcRadius, z = 8 - Math.cos(angle) * arcRadius;
    return {
      x: x * Math.cos(arcYaw) + z * Math.sin(arcYaw),
      z: -x * Math.sin(arcYaw) + z * Math.cos(arcYaw),
      h: [102, 128, 90][i], w: [13, 12.5, 13][i], d: 9,
      lean: [12, 5, -12][i], yaw: arcYaw + [0.22, 0, -0.22][i],
      side: i === 2 ? -1 : 1,
    };
  });
  function towerPoint(s, x, y, z) {
    const c = Math.cos(s.yaw), n = Math.sin(s.yaw);
    return [s.x + x * c + z * n, y, s.z - x * n + z * c];
  }
  function skin(s, t, angle, offset = 0) {
    const taper = Math.pow(Math.max(0, 1 - t), 0.72);
    const bulge = 1 + 0.16 * Math.sin(t * Math.PI);
    return towerPoint(s, s.lean * t * t + Math.sin(angle) * (s.w * taper * bulge + offset),
      floor + t * s.h, -3 * t + Math.cos(angle) * (s.d * taper + offset));
  }
  towers.forEach(s => {
    b.cyl(s.w + 1, s.w + 2, 0.8, { x: s.x, y: 0.4, z: s.z }, 'shellCool', seg);
    // Keep the accepted sail silhouette; widen the courtyard glass to half the perimeter.
    // The outer 40% stays white, with a 10% blue return at the rear.
    const shellStart = -1.24 * Math.PI, shellEnd = -0.44 * Math.PI;
    const glassEnd = shellEnd + Math.PI;
    const band = (sample, start, end, rows, cols, material) => {
      const a = Math.min(start * s.side, end * s.side);
      const bAngle = Math.max(start * s.side, end * s.side);
      b.add(surface((t, u) => sample(t, a + u * (bAngle - a)), rows, cols), {}, material);
    };
    band((t, a) => skin(s, t, a), shellStart, shellEnd, hi ? 64 : 32, hi ? 18 : 10, 'shell');
    // A recessed inner leaf and closed jambs give the ceramic shell actual thickness.
    const shellThickness = 0.825; // 1.5 × the previous 0.55 m shell.
    band((t, a) => skin(s, 1 - t, a, -shellThickness * Math.pow(t, 0.72)),
      shellStart, shellEnd, hi ? 64 : 32, hi ? 18 : 10, 'shell');
    for (const angle of [shellStart, shellEnd]) {
      b.add(surface((t, u) => skin(s, t, angle * s.side, -u * shellThickness * Math.pow(1 - t, 0.72)),
        hi ? 64 : 32, 1), {}, 'ceramic');
    }
    // Cobalt panels sit on the outer white leaf, with clear ceramic seams.
    for (const edge of [shellStart + 0.08, shellEnd - 0.2]) {
      for (let row = 0; row < 10; row++) {
        const lo = row / 10 + 0.003, high = (row + 1) / 10 - 0.003;
        band((t, a) => skin(s, lo + (high - lo) * t, a, 0.06),
          edge, edge + 0.12, hi ? 6 : 3, 2, 'blue');
      }
    }
    for (let row = 0; row < 8; row++) {
      const lo = row / 8 + 0.001, high = (row + 1) / 8 - 0.001;
      band((t, a) => skin(s, lo + (high - lo) * t, a), glassEnd, shellStart + TAU,
        hi ? 8 : 4, hi ? 18 : 10, 'blue');
    }
    // Cut real openings in the glazing at all three bridge landings.
    const portalAngle = 0.52;
    let glazedFrom = 0;
    for (const height of [...bridgeHeights, s.h]) {
      const top = height / s.h;
      band((t, a) => skin(s, glazedFrom + t * (top - glazedFrom), a),
        shellEnd, glassEnd, hi ? 18 : 9, hi ? 24 : 12, 'curtain');
      if (height === s.h) break;
      const upper = (height + 5.2) / s.h;
      for (const [start, end] of [[shellEnd, -portalAngle], [portalAngle, glassEnd]]) {
        band((t, a) => skin(s, top + t * (upper - top), a), start, end,
          4, hi ? 12 : 6, 'curtain');
      }
      glazedFrom = upper;
    }
    // Broad folded shell returns stay legible from the courtyard camera.
    for (const [start, end, panel] of [
      [shellEnd, shellEnd + 0.16 * Math.PI, shellEnd + 0.105 * Math.PI],
      [glassEnd - 0.12 * Math.PI, glassEnd, glassEnd - 0.095 * Math.PI],
    ]) {
      band((t, a) => skin(s, t, a, 0.18 * Math.pow(1 - t, 0.72)),
        start, end, hi ? 64 : 32, 6, 'shell');
      for (let row = 0; row < 10; row++) {
        const lo = row / 10 + 0.003, high = (row + 1) / 10 - 0.003;
        band((t, a) => skin(s, lo + (high - lo) * t, a, 0.22 * Math.pow(1 - lo - (high - lo) * t, 0.72)),
          panel, panel + 0.035 * Math.PI, hi ? 6 : 3, 2, 'blue');
      }
    }
    const core = { ...s, w: s.w * 0.24, d: s.d * 0.24 };
    band((t, a) => skin(core, 0.035 + t * 0.91, a), -Math.PI, Math.PI,
      12, 12, 'towerLight');
    // Occupied floors: thin slab faces and a cyan-white edge behind the glazing.
    // The strips share towerLight's existing draw call; no dense vertical mullion grid.
    for (let level = 0, height = 5.5; height < s.h * 0.9; level++, height += 5.5) {
      const t = height / s.h, taper = Math.pow(1 - t, 0.72);
      const bulge = 1 + 0.16 * Math.sin(t * Math.PI);
      const p = towerPoint(s, s.lean * t * t, floor + height, -3 * t);
      b.cyl(1, 1, 0.42, { x: p[0], y: p[1], z: p[2], ry: s.yaw,
        sx: s.w * taper * bulge - 0.35, sz: s.d * taper - 0.35 }, 'ceramic', hi ? 32 : 16);
      band((v, a) => skin(s, t + v * 0.42 / s.h, a, 0.06),
        shellEnd + 0.04, glassEnd - 0.04, 1, hi ? 28 : 16, 'towerLight');
      if (t < 0.84) {
        for (const angle of [level % 2 ? -0.18 : 0.24]) {
          const [x, y, z] = skin(s, t, angle * Math.PI * s.side, -1.2);
          b.add(peopleGeometry.clone(), { x, y: y + 0.98, z, ry: s.yaw }, 'ink');
        }
      }
    }
    // Reuse the core's tessellation budget for three R5 cyan slots; leave bridge doors open.
    for (const angle of [-0.22, 0.07, 0.34]) {
      let from = 0.04;
      for (const height of [...bridgeHeights, s.h * 0.95]) {
        const to = height / s.h;
        band((t, a) => skin(s, from + t * (to - from), a, 0.08),
          angle * Math.PI - 0.023, angle * Math.PI + 0.023,
          hi ? 16 : 8, 1, 'towerLight');
        from = (height + 5.2) / s.h;
      }
    }
    // Four swept white ribs follow the tapered sail, not straight floating poles.
    for (const rib of [-0.37, -0.18, 0.3, 0.5]) {
      const points = Array.from({ length: 57 }, (_, i) => {
        const t = i / 56;
        const angle = (rib + 0.09 * Math.sin(t * Math.PI)) * Math.PI * s.side;
        return skin(s, t, angle, 0.28 * Math.pow(1 - t, 0.72));
      });
      b.tube(points, 0.66, {}, 'ceramic', hi ? 80 : 40, 8);
    }
    // Occupied elliptical landing decks overlap both the tower floor and bridge ends.
    bridgeHeights.forEach(height => {
      const t = height / s.h;
      const [x, y, z] = skin(s, t, 0, -1.6);
      b.cyl(1, 1, 1.15, { x, y: y - 0.575, z, ry: s.yaw, sx: 6.2, sz: 5.2 }, 'ceramic', seg);
      const center = towerPoint(s, s.lean * t * t, y - 0.3, -3 * t);
      b.cyl(1, 1, 0.6, { x: center[0], y: center[1], z: center[2], ry: s.yaw,
        sx: s.w * Math.pow(1 - t, 0.72), sz: s.d * Math.pow(1 - t, 0.72) }, 'ceramic', seg);
      // A curved portal lintel marks the open glazed bay without blocking the deck.
      const portal = Array.from({ length: 25 }, (_, i) => {
        const a = -portalAngle + i / 24 * portalAngle * 2;
        return skin(s, (height + 5.2) / s.h, a, 0.18);
      });
      b.tube(portal, 0.32, {}, 'ceramic', hi ? 32 : 16, 6);
    });
    // Thick ceramic jambs frame the glazing without a dense mullion grid.
    for (const angle of [shellEnd, glassEnd]) {
      const points = Array.from({ length: 41 }, (_, i) => skin(s, i / 40, angle * s.side, 0.1));
      b.tube(points, 0.96, {}, 'ceramic', hi ? 80 : 40, 8);
    }
    // Rotate the vestibules with the side sails so all three face the courtyard.
    b.push({ x: s.x, z: s.z, ry: s.yaw });
    b.rbox(6.6, 7, 2.6, 0.35, { y: floor + 3.5, z: s.d }, 'ceramic');
    b.box(5.4, 6.2, 0.2, { y: floor + 3.1, z: s.d + 1.4 }, 'glass');
    b.box(0.12, 6.2, 0.25, { y: floor + 3.1, z: s.d + 1.55 }, 'ceramic');
    b.pop();
    const entry = towerPoint(s, 2, floor, s.d + 4);
    person(entry[0], plazaY(entry[0], entry[2]), entry[2], s.yaw);
  });

  function bridgeCurve(height, level) {
    const ends = towers.map(s => new THREE.Vector3(...skin(s, height / s.h, 0, -1.6)));
    const points = [ends[0]];
    for (let i = 0; i < 2; i++) {
      const middle = ends[i].clone().lerp(ends[i + 1], 0.5);
      // Each bridge crowns above its abutments as a shallow inhabited arch.
      middle.y += 2.4 + level * 0.6; middle.z += 9 + level * 1.5;
      points.push(middle, ends[i + 1]);
    }
    return new THREE.CatmullRomCurve3(points, false);
  }

  const bridgeCurves = [];
  bridgeHeights.forEach((height, level) => {
    const curve = bridgeCurve(height, level), width = 9.2;
    bridgeCurves.push(curve);
    const at = (t, side, dy = 0) => {
      const p = curve.getPointAt(t), tangent = curve.getTangentAt(t);
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      return p.addScaledVector(normal, side * width / 2).add(new THREE.Vector3(0, dy, 0)).toArray();
    };
    b.add(surface((t, u) => at(t, 2 * u - 1), hi ? 120 : 60, 1), {}, 'ceramic');
    b.add(surface((t, u) => at(t, 1 - 2 * u, -0.95), hi ? 120 : 60, 1), {}, 'shellCool');
    for (const side of [-1, 1]) {
      const rows = hi ? 120 : 60, inner = side * (1 - 0.7 / width);
      // Closed 0.35 m thick, 0.65 m tall parapets, including the deck fascia.
      b.add(surface((t, u) => at(t, side, side > 0 ? 0.65 - u * 1.6 : -0.95 + u * 1.6), rows, 1), {}, 'ceramic');
      b.add(surface((t, u) => at(t, inner, side > 0 ? 0.65 * u : 0.65 * (1 - u)), rows, 1), {}, 'ceramic');
      b.add(surface((t, u) => at(t, side > 0 ? inner + u * (side - inner) : side + u * (inner - side), 0.65), rows, 1), {}, 'ceramic');
      b.add(surface((t, u) => at(t, side, 0.65 + u * 0.78), rows, 1), {}, 'curtain');
      const light = Array.from({ length: 121 }, (_, i) => at(i / 120, side, -0.8));
      b.tube(light, 0.12, {}, 'towerLight', hi ? 144 : 72, 6);
      for (const end of [0, 1]) {
        b.add(surface((u, v) => at(end, inner + (side - inner) * ((end === 0) === (side > 0) ? 1 - u : u), v * 0.65), 1, 1), {}, 'ceramic');
      }
    }
    // Slim balusters and handrails establish human scale on each wide deck.
    for (const side of [-1, 1]) {
      b.tube(Array.from({ length: 81 }, (_, i) => at(i / 80, side, 1.48)), 0.09, {}, 'towerLight', hi ? 100 : 50, 5);
      for (let i = 1; i < 36; i++) {
        const [x, y, z] = at(i / 36, side, 0.7);
        b.cyl(0.07, 0.07, 1.5, { x, y, z }, 'ceramic', 5);
      }
    }
    const count = 22;
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count, p = at(t, i % 2 ? -0.5 : 0.5);
      const tangent = curve.getTangentAt(t);
      bridgePeople.push(kit.toMatrix({ x: p[0], y: p[1] + 0.9, z: p[2], ry: Math.atan2(tangent.x, tangent.z) }));
    }
  });

  // Stepped podiums remain above y=0 and do not replace the environment island.
  terraces.forEach((t, i) => {
    const previous = i ? terraces[i - 1].y : 0;
    b.cyl(t.r, t.r + 0.12, t.y - previous, { y: (t.y + previous) / 2, z: t.z },
      i === 0 || i === 4 || i === 9 ? 'paving' : 'ceramic', hi ? 112 : 56);
  });

  function terraceSector(inner, outer, start, end, base, top, material) {
    const shape = new THREE.Shape(), count = hi ? 24 : 12;
    for (let i = 0; i <= count; i++) {
      const a = start + (end - start) * i / count;
      const x = Math.sin(a) * outer, z = -Math.cos(a) * outer;
      if (i === 0) shape.moveTo(x, z); else shape.lineTo(x, z);
    }
    for (let i = count; i >= 0; i--) {
      const a = start + (end - start) * i / count;
      shape.lineTo(Math.sin(a) * inner, -Math.cos(a) * inner);
    }
    shape.closePath();
    b.extrude(shape, top - base, { y: base, rx: -Math.PI / 2 }, material, 0, 1);
  }
  for (const side of [-1, 1]) {
    for (const angle of [0.57, 1.02]) {
      const a = side * angle, planterTop = plazaY(Math.sin(side * angle) * 40, Math.cos(side * angle) * 40) + 1.2;
      terraceSector(38.2, 41.8, a - 0.16, a + 0.16, 0.3, planterTop, 'ceramic');
      terraceSector(38.65, 41.35, a - 0.145, a + 0.145, planterTop, planterTop + 0.06, 'teal');
      for (let i = 0; i < (hi ? 18 : 10); i++) {
        const theta = a - 0.125 + i / (hi ? 17 : 9) * 0.25;
        const r = 39.2 + (i % 3) * 0.7;
        crowns.push(kit.toMatrix({ x: Math.sin(theta) * r, y: planterTop + 0.4, z: Math.cos(theta) * r, sx: 0.5, sy: 0.35, sz: 0.5 }));
      }
    }
  }

  const tables = [[-20, 23], [17, 29], [-24, -9], [24, -13], [-8, -15], [0, 34]];
  tables.forEach(([x, z], k) => {
    const floor = plazaY(x, z);
    b.cyl(3.6, 3.8, 0.35, { x, y: floor + 1.65, z }, 'ceramic', seg);
    b.cyl(0.8, 1.6, 1.45, { x, y: floor + 0.73, z }, 'shellCool', 16);
    b.cyl(3.1, 3.1, 0.05, { x, y: floor + 1.85, z }, 'holo', seg);
    b.torus(3.15, 0.07, { x, y: floor + 1.89, z }, 'glowSoft', 5, seg);
    for (let j = 0; j < 5; j++) {
      const a = j * TAU / 5, h = 1.3 + (j % 3) * 0.7;
      b.add(new THREE.OctahedronGeometry(0.7), { x: x + Math.cos(a) * 1.6, y: floor + 2.7, z: z + Math.sin(a) * 1.6, sy: h }, 'holo');
      b.cyl(0.08, 0.13, 1, { x: x + Math.cos(a) * 1.6, y: floor + 2.3, z: z + Math.sin(a) * 1.6 }, 'glowSoft', 5);
    }
    // Four table groups of twelve; leave two quieter worktables and the entry routes clear.
    if ([0, 1, 2, 5].includes(k)) for (let j = 0; j < 12; j++) {
      const a = j * TAU / 12 + k * 0.4, radius = 4.6 + (j % 2) * 0.55;
      const px = x + Math.cos(a) * radius, pz = z + Math.sin(a) * radius;
      person(px, plazaY(px, pz), pz, -a - Math.PI / 2);
    }
  });

  // Waveform displays are translucent two-sided planes with an actual plotted trace.
  [[-16, 9, 14, 0.22], [35, 9, 22, -0.4], [-4, 7, -4, 0], [-22, 9, -17, 0.4], [16, 9, -18, -0.3]].forEach(([x, y, z, yaw]) => {
    b.push({ x, y, z, ry: yaw });
    b.add(new THREE.PlaneGeometry(10, 6), {}, 'holo');
    b.tube([[-5, -3, 0], [-5, 3, 0], [5, 3, 0], [5, -3, 0], [-5, -3, 0]], 0.055, {}, 'glowSoft', 8, 4);
    for (let line = 0; line < (hi ? 5 : 3); line++) {
      const pts = Array.from({ length: 49 }, (_, i) => {
        const t = i / 48;
        return [-4.5 + t * 9, Math.sin(t * TAU * 1.3 + line * 0.35) * (1.8 - line * 0.18), 0.06 + line * 0.02];
      });
      b.tube(pts, 0.045, {}, line % 2 ? 'glowSoft' : 'glow', hi ? 64 : 32, 4);
    }
    b.pop();
  });

  const sculptureFloor = plazaY(0, 7);
  b.cyl(6.4, 7, 0.55, { y: sculptureFloor + 0.275, z: 7 }, 'ceramic', seg);
  b.cyl(5.9, 5.9, 0.08, { y: sculptureFloor + 0.58, z: 7 }, 'curtain', seg);
  b.torus(5.9, 0.28, { y: sculptureFloor + 0.65, z: 7 }, 'towerLight', 8, seg);
  for (let jet = 0; jet < 12; jet++) {
    const angle = jet * TAU / 12;
    const points = Array.from({ length: 17 }, (_, i) => {
      const t = i / 16, r = 2.4 + t * 3.4;
      return [Math.sin(angle) * r, sculptureFloor + 0.7 + Math.sin(t * Math.PI) * 3.3, 7 + Math.cos(angle) * r];
    });
    b.tube(points, 0.085, {}, 'towerLight', hi ? 24 : 12, 5);
  }
  b.torus(9.2, 0.22, { y: sculptureFloor + 0.26, z: 7 }, 'towerLight', 6, hi ? 96 : 48);
  b.torus(10.1, 0.08, { y: sculptureFloor + 0.08, z: 7 }, 'glowSoft', 5, hi ? 96 : 48);
  const mistLight = towerLight.clone();
  mistLight.name = 'glow:cocreation-mist-violet'; mistLight.userData = {};
  mistLight.color.set('#AFA0FF'); mistLight.emissive.set('#7842FF'); mistLight.emissiveIntensity = 1.8;
  const sculptureBuilder = new kit.Builder({ ...mats, towerLight, mistLight });
  const helixPoint = (t, phase, radius = 5.8) => {
    const angle = t * TAU * 1.35 + phase;
    return [Math.sin(angle) * radius, 1 + t * 24, Math.cos(angle) * radius];
  };
  for (const phase of [0, Math.PI]) {
    sculptureBuilder.add(surface((t, u) => helixPoint(t, phase + (u - 0.5) * 0.3),
      hi ? 160 : 80, 2), {}, 'holo');
    const points = Array.from({ length: 121 }, (_, i) => helixPoint(i / 120, phase));
    sculptureBuilder.tube(points, 0.3, {}, phase ? 'mistLight' : 'towerLight', hi ? 180 : 90, 8);
    sculptureBuilder.tube(points, 0.7, {}, 'holo', hi ? 180 : 90, 6);
  }
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    sculptureBuilder.tube([helixPoint(t, 0), helixPoint(t, Math.PI)], 0.07, {},
      i % 2 ? 'mistLight' : 'towerLight', 1, 5);
  }
  const sculpture = sculptureBuilder.build('community-double-helix');
  sculpture.position.set(0, sculptureFloor + 0.65, 7); root.add(sculpture);

  // Two shallow fountain basins flank the main hologram and its gathering ring.
  for (const [x, z] of [[-17, 2], [17, 2]]) {
    const y = plazaY(x, z);
    b.cyl(4.8, 5, 0.6, { x, y: y + 0.3, z }, 'ceramic', seg);
    b.cyl(4.45, 4.45, 0.08, { x, y: y + 0.64, z }, 'curtain', seg);
    b.torus(4.5, 0.1, { x, y: y + 0.72, z }, 'towerLight', 5, seg);
    for (let jet = 0; jet < 8; jet++) {
      const a = jet * TAU / 8;
      const points = Array.from({ length: 17 }, (_, i) => {
        const t = i / 16, r = 0.7 + t * 3.3;
        return [x + Math.sin(a) * r, y + 0.75 + Math.sin(t * Math.PI) * 3.8, z + Math.cos(a) * r];
      });
      b.tube(points, 0.065, {}, 'towerLight', hi ? 24 : 12, 5);
    }
  }

  // Recognizable seated panda drone: white head, black ears/eye patches, blue scarf.
  b.push({ x: 22, y: plazaY(22, 14) + 1.4, z: 14 });
  b.cyl(5, 5.6, 0.65, { y: -0.9 }, 'ceramic', seg);
  b.torus(4.5, 0.12, { y: -0.53 }, 'glowSoft', 6, seg);
  const orb = (r, t, mat) => b.sphere(r, t, mat, hi ? 24 : 16, hi ? 16 : 10);
  orb(2.8, { y: 3, sy: 1.05, sz: 0.8 }, 'ink');
  orb(2.35, { y: 3.2, z: 0.7, sy: 1.03, sz: 0.72 }, 'ceramic');
  orb(3.1, { y: 7, sy: 0.88, sz: 0.8 }, 'ceramic');
  for (const side of [-1, 1]) {
    orb(1, { x: side * 2.3, y: 9.15, sz: 0.68 }, 'ink');
    orb(0.95, { x: side * 1.25, y: 7.1, z: 2.18, sy: 1.25, sz: 0.26, rz: side * 0.35 }, 'ink');
    orb(0.4, { x: side * 1.18, y: 7.2, z: 2.43, sz: 0.35 }, 'ceramic');
    orb(0.24, { x: side * 1.13, y: 7.18, z: 2.56, sz: 0.5 }, 'ink');
    orb(0.08, { x: side * 1.12 - 0.07, y: 7.3, z: 2.68 }, 'ceramic');
    orb(1.05, { x: side * 2.2, y: 1.5, z: 1.3, sy: 0.75, sz: 1.25 }, 'ink');
    orb(0.86, { x: side * 2.55, y: 3.5, sy: 1.7, rz: side * 0.25 }, 'ink');
  }
  orb(0.38, { y: 6.55, z: 2.55, sy: 0.65, sz: 0.55 }, 'ink');
  b.tube([[-0.65, 6.2, 2.45], [-0.3, 5.98, 2.5], [0, 6.17, 2.57], [0.3, 5.98, 2.5], [0.65, 6.2, 2.45]], 0.065, {}, 'ink', 20, 5);
  b.torus(2.1, 0.47, { y: 4.85, sz: 0.84 }, 'blue', 8, seg);
  b.rbox(1.05, 2.5, 0.28, 0.12, { x: 1.2, y: 3.8, z: 2.1, rz: 0.23 }, 'blue');
  b.torus(3.5, 0.065, { y: 0.2 }, 'glowSoft', 5, seg);
  b.pop();

  const random = kit.rng(37);
  const treePoints = [[-42, 24, 0.8], [-33, 34, 0.9], [-22, 41, 0.8], [38, 28, 0.85],
    [24, 39, 0.9], [20, -34, 0.8], [-22, -34, 0.8], [-11, 43, 0.7]].map(([x, z, scale]) => {
    const y = plazaY(x, z);
    b.cyl(2.5 * scale, 2.9 * scale, 0.6, { x, y: y + 0.3, z }, 'ceramic', 20);
    return { x, y: y + 0.6, z, scale: scale * 1.15 };
  });
  for (let i = 0; i < (hi ? 72 : 36); i++) {
    const a = 0.25 + i / (hi ? 72 : 36) * (TAU - 0.5), r = 44 + random() * 2;
    const x = Math.sin(a) * r, z = Math.cos(a) * r;
    shrubPoints.push({ x, y: plazaY(x, z), z, scale: 1 });
  }
  root.add(blossomTrees(ctx, treePoints, { seed: 37, name: 'cocreation:edge-blossoms' }));
  root.add(floraShrubs(ctx, shrubPoints, { seed: 73, name: 'cocreation:edge-shrubs' }));
  // Perimeter balustrade leaves the front approach open.
  const rail = Array.from({ length: 97 }, (_, i) => {
    const a = 0.24 + i / 96 * (TAU - 0.48);
    return [Math.sin(a) * 48, 1.7, Math.cos(a) * 48];
  });
  b.tube(rail, 0.16, {}, 'ceramic', hi ? 160 : 80, 6);
  for (let i = 0; i <= (hi ? 80 : 40); i++) {
    const a = 0.24 + i / (hi ? 80 : 40) * (TAU - 0.48);
    b.cyl(0.1, 0.13, 1.4, { x: Math.sin(a) * 48, y: 1, z: Math.cos(a) * 48 }, 'ceramic', 5);
  }
  // Two groups of ten flank the hologram, outside its light ring: six social groups total.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 10; i++) {
      const a = side * (0.58 + i / 9 * 1.18), radius = 11.3 + (i % 2) * 1.1;
      const x = Math.sin(a) * radius, z = 7 + Math.cos(a) * radius;
      person(x, plazaY(x, z), z, a + Math.PI);
    }
  }
  // Five service robots: rounded body, visor, twin optical eyes and paired wheels.
  for (const [x, z] of [[-10, 18], [10, 20], [-17, -5], [20, -5], [5, 35]]) {
    b.push({ x, y: plazaY(x, z), z });
    b.add(new THREE.CapsuleGeometry(0.48, 0.6, 4, 10), { y: 1 }, 'ceramic');
    b.sphere(0.44, { y: 1.7, sz: 0.85 }, 'ceramic', 16, 10);
    b.rbox(0.65, 0.27, 0.1, 0.08, { y: 1.72, z: 0.36 }, 'ink');
    for (const side of [-1, 1]) {
      b.sphere(0.065, { x: side * 0.16, y: 1.73, z: 0.43 }, 'glowSoft', 8, 6);
      b.cyl(0.23, 0.23, 0.12, { x: side * 0.4, y: 0.24, rz: Math.PI / 2 }, 'ink', 12);
    }
    b.box(0.55, 0.12, 0.06, { y: 1.02, z: 0.48 }, 'blue');
    b.pop();
  }
  root.add(b.build('cocreation-architecture'));
  root.add(kit.instanced(new THREE.IcosahedronGeometry(1, 1), violet, crowns, 'purple-blossom-canopies'));
  root.add(kit.instanced(peopleGeometry, blue, people, 'community-people'));
  root.add(kit.instanced(peopleGeometry.clone(), blue, bridgePeople, 'bridge-people'));

  const hotspots = [];
  function addHotspot(id, w, h, d, transform, label, anchor) {
    const hot = kit.hotspot(id, w, h, d, transform);
    hot.userData.label = label; hot.userData.anchor = new THREE.Vector3(...anchor);
    root.add(hot); hotspots.push(hot);
  }
  addHotspot('cocreation', 112, 132, 110, { y: 66 }, '社区共创中心', [0, 54, -10]);
  addHotspot('cocreation:members', 13, 13, 12, { x: 22, y: 7, z: 14 }, '成员与创作者', [22, 8, 14]);
  addHotspot('cocreation:projects', 16, 12, 14, { x: -20, y: 6, z: 23 }, '共创项目', [-20, 5, 23]);
  addHotspot('cocreation:works', 19, 13, 23, { x: 33, y: 6, z: 7 }, '作品与案例', [35, 9, 16]);
  addHotspot('cocreation:events', 16, 21, 17, { y: 10.5, z: 7 }, '社区活动', [0, 10, 7]);
  const recruit = bridgeCurves[1].getPointAt(0.7);
  addHotspot('cocreation:recruit', 18, 8, 12, { x: recruit.x, y: recruit.y + 3, z: recruit.z }, '协作与招募', [recruit.x, recruit.y + 3, recruit.z]);
  const bounds = new THREE.Box3().setFromObject(root);
  return {
    group: root, hotspots, bounds,
    update(t) { if (!reducedMotion) sculpture.rotation.y = Math.sin(t * 0.18) * 0.12; },
    dispose() { kit.disposeTree(root); },
  };
}
