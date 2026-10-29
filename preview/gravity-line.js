/* R13 VIZ-1 · 重力线引擎 window.CommonsGravity
 * 静止 = 悬链线（按松弛度自然下垂）；端点移动、数据变化或拖动时 = Verlet 绳子（距离约束 + 阻尼），晃两下停住，
 * 停住后对齐到解析悬链线，不再要动画帧。prefers-reduced-motion 下不模拟，直接给悬链线终态。
 * 两种画法：SVG（path() / catenary() 返回 d）和 Canvas（trace() / batch() 批量描线）。
 * 不依赖 DOM 以外的任何东西；坐标一律是调用方的像素坐标，y 向下。
 */
(function () {
  'use strict';

  const STEP = 1000 / 60;
  const SUB = 4;
  const MAX_SUBSTEPS = 8;
  const SLEEP_MOVE = 0.1;
  const SLEEP_FRAMES = 10;
  const BLEND = 0.22;
  const DONE_ERR = 0.04;

  const DEFAULTS = {
    slack: 1.08,
    stiffness: 1,
    damping: 0.08,
    segments: 14,
    gravity: 3000,
    iterations: 6
  };

  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const pt = p => (Array.isArray(p) ? { x: +p[0] || 0, y: +p[1] || 0 } : { x: num(p && p.x, 0), y: num(p && p.y, 0) });

  function reduced() {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* ---------- 悬链线 ---------- */

  // 解 sinh(ξ)/ξ = r（r ≥ 1）：牛顿法，失败时退回二分
  function solveXi(r) {
    if (r <= 1 + 1e-9) return 1e-4;
    let xi = r < 3 ? Math.sqrt(6 * (r - 1)) : Math.log(2 * r) + Math.log(Math.log(2 * r) + 1);
    for (let i = 0; i < 24; i++) {
      const f = Math.sinh(xi) - r * xi;
      const d = Math.cosh(xi) - r;
      if (!(Math.abs(d) > 1e-12)) break;
      const next = xi - f / d;
      if (!(next > 0) || !Number.isFinite(next)) break;
      if (Math.abs(next - xi) < 1e-10) return next;
      xi = next;
    }
    if (Math.abs(Math.sinh(xi) / xi - r) < 1e-6 * r) return xi;
    let lo = 1e-6;
    let hi = 60;
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      if (Math.sinh(mid) / mid > r) hi = mid; else lo = mid;
    }
    return (lo + hi) / 2;
  }

  // 返回 n+1 个点（按弧长等分，和绳子节点一一对应）；out 可复用 Float64Array(2n+2)
  function catenaryInto(out, a, b, slack, n) {
    let x1 = a.x;
    let y1 = a.y;
    let x2 = b.x;
    let y2 = b.y;
    let flip = false;
    if (x2 < x1) {
      flip = true;
      [x1, x2] = [x2, x1];
      [y1, y2] = [y2, y1];
    }
    const h = x2 - x1;
    const vScreen = y2 - y1;
    const chord = Math.hypot(h, vScreen);
    const L = chord * Math.max(1, slack);
    const write = (i, x, y) => {
      const k = flip ? n - i : i;
      out[2 * k] = x;
      out[2 * k + 1] = y;
    };
    if (chord < 1e-6 || L - chord < 1e-6 || h < 0.5) {
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        write(i, x1 + (x2 - x1) * t, y1 + vScreen * t);
      }
      return out;
    }
    // 数学坐标 y 向上：Y = -y
    const v = -vScreen;
    const r = Math.sqrt(L * L - v * v) / h;
    const xi = solveXi(r);
    const A = h / (2 * xi);
    const x0 = (x1 + x2) / 2 - A * Math.atanh(clamp(v / L, -0.999999999, 0.999999999));
    const C = -y1 - A * Math.cosh((x1 - x0) / A);
    const s1 = A * Math.sinh((x1 - x0) / A);
    for (let i = 0; i <= n; i++) {
      let x;
      if (i === 0) x = x1;
      else if (i === n) x = x2;
      else x = x0 + A * Math.asinh((s1 + L * i / n) / A);
      const Y = i === 0 ? -y1 : i === n ? -y2 : A * Math.cosh((x - x0) / A) + C;
      write(i, x, -Y);
    }
    return out;
  }

  function catenaryPoints(from, to, slack, n) {
    const seg = clamp(Math.round(num(n, 24)), 2, 96);
    const buf = catenaryInto(new Float64Array(2 * seg + 2), pt(from), pt(to), num(slack, DEFAULTS.slack), seg);
    const list = [];
    for (let i = 0; i <= seg; i++) list.push([buf[2 * i], buf[2 * i + 1]]);
    return list;
  }

  /* ---------- 画法 ---------- */

  const f2 = v => (Math.round(v * 100) / 100).toString();

  // Catmull-Rom 转三次贝塞尔：SVG 用，过每个节点、没有折角
  function svgPath(buf, count) {
    const n = count - 1;
    if (n < 1) return '';
    let d = 'M' + f2(buf[0]) + ' ' + f2(buf[1]);
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - 1);
      const i3 = Math.min(n, i + 2);
      const x0 = buf[2 * i0];
      const y0 = buf[2 * i0 + 1];
      const x1 = buf[2 * i];
      const y1 = buf[2 * i + 1];
      const x2 = buf[2 * i + 2];
      const y2 = buf[2 * i + 3];
      const x3 = buf[2 * i3];
      const y3 = buf[2 * i3 + 1];
      d += 'C' + f2(x1 + (x2 - x0) / 6) + ' ' + f2(y1 + (y2 - y0) / 6) + ' ' +
        f2(x2 - (x3 - x1) / 6) + ' ' + f2(y2 - (y3 - y1) / 6) + ' ' + f2(x2) + ' ' + f2(y2);
    }
    return d;
  }

  // 中点二次曲线：Canvas 用，几百条一起描时最省
  function traceInto(ctx, buf, count) {
    const n = count - 1;
    if (n < 1) return;
    ctx.moveTo(buf[0], buf[1]);
    if (n === 1) {
      ctx.lineTo(buf[2], buf[3]);
      return;
    }
    for (let i = 1; i < n; i++) {
      const x = buf[2 * i];
      const y = buf[2 * i + 1];
      ctx.quadraticCurveTo(x, y, (x + buf[2 * i + 2]) / 2, (y + buf[2 * i + 3]) / 2);
    }
    ctx.lineTo(buf[2 * n], buf[2 * n + 1]);
  }

  function catenary(from, to, slack, n) {
    const seg = clamp(Math.round(num(n, 16)), 2, 96);
    const buf = catenaryInto(new Float64Array(2 * seg + 2), pt(from), pt(to), num(slack, DEFAULTS.slack), seg);
    return svgPath(buf, seg + 1);
  }

  /* ---------- 绳子 ---------- */

  function create(options) {
    const o = options || {};
    const n = clamp(Math.round(num(o.segments, DEFAULTS.segments)), 2, 64);
    const cfg = {
      slack: Math.max(1, num(o.slack, DEFAULTS.slack)),
      stiffness: clamp(num(o.stiffness, DEFAULTS.stiffness), 0.05, 1),
      damping: clamp(num(o.damping, DEFAULTS.damping), 0, 0.5),
      gravity: num(o.gravity, DEFAULTS.gravity),
      iterations: clamp(Math.round(num(o.iterations, DEFAULTS.iterations)), 1, 60)
    };
    const still = o.reduced === undefined ? reduced() : !!o.reduced;
    const count = n + 1;
    const pos = new Float64Array(2 * count);
    const old = new Float64Array(2 * count);
    const rest = new Float64Array(2 * count);
    let a = pt(o.from);
    let b = pt(o.to);
    let restLen = 0;
    let settled = true;
    let quiet = 0;
    let easing = false;
    let acc = 0;
    let dead = false;

    function relax() {
      catenaryInto(rest, a, b, cfg.slack, n);
      restLen = Math.hypot(b.x - a.x, b.y - a.y) * cfg.slack / n;
    }

    function snap() {
      pos.set(rest);
      old.set(rest);
      settled = true;
      easing = false;
      quiet = 0;
      acc = 0;
    }

    function wake() {
      if (still || dead) return;
      settled = false;
      easing = false;
      quiet = 0;
    }

    // 一个 60Hz 帧拆成 SUB 个小步：同样的迭代次数下绳子几乎不被重力拉长，停住时和悬链线差不到 1–2px
    function constrain(i, k) {
      const ix = 2 * i;
      const jx = ix + 2;
      const dx = pos[jx] - pos[ix];
      const dy = pos[jx + 1] - pos[ix + 1];
      const d = Math.sqrt(dx * dx + dy * dy) || 1e-6;
      const diff = (d - restLen) / d * k;
      if (i === 0) {
        pos[jx] -= dx * diff;
        pos[jx + 1] -= dy * diff;
      } else if (i === n - 1) {
        pos[ix] += dx * diff;
        pos[ix + 1] += dy * diff;
      } else {
        const hx = dx * diff * 0.5;
        const hy = dy * diff * 0.5;
        pos[ix] += hx;
        pos[ix + 1] += hy;
        pos[jx] -= hx;
        pos[jx + 1] -= hy;
      }
    }

    function integrate(h, keep, measure) {
      const g = cfg.gravity * h * h;
      for (let ix = 2, end = 2 * n; ix < end; ix += 2) {
        const x = pos[ix];
        const y = pos[ix + 1];
        pos[ix] = x + (x - old[ix]) * keep;
        pos[ix + 1] = y + (y - old[ix + 1]) * keep + g;
        old[ix] = x;
        old[ix + 1] = y;
      }
      pos[0] = a.x;
      pos[1] = a.y;
      pos[2 * n] = b.x;
      pos[2 * n + 1] = b.y;
      const k = cfg.stiffness;
      // 正反交替扫，避免绳子朝一个方向被拉长
      for (let it = 0; it < cfg.iterations; it++) {
        if (it & 1) for (let i = n - 1; i >= 0; i--) constrain(i, k);
        else for (let i = 0; i < n; i++) constrain(i, k);
      }
      if (!measure) return 0;
      let move = 0;
      for (let ix = 2, end = 2 * n; ix < end; ix += 2) {
        const m = Math.abs(pos[ix] - old[ix]) + Math.abs(pos[ix + 1] - old[ix + 1]);
        if (m > move) move = m;
      }
      return move;
    }

    // 快停时不再积分，直接收拢到悬链线；误差够小就算停住
    function ease() {
      let err = 0;
      for (let i = 2; i < 2 * n; i++) {
        const d = rest[i] - pos[i];
        pos[i] += d * BLEND;
        old[i] = pos[i];
        if (Math.abs(d) > err) err = Math.abs(d);
      }
      pos[0] = a.x;
      pos[1] = a.y;
      pos[2 * n] = b.x;
      pos[2 * n + 1] = b.y;
      if (err < DONE_ERR) snap();
    }

    function step(dt) {
      if (settled || dead) return false;
      acc += clamp(num(dt, STEP), 0, STEP * MAX_SUBSTEPS);
      // 四舍五入取步数：60Hz 下每帧恰好一步，不会因为浮点误差出现 0 步 / 2 步交替的抖动
      let steps = Math.round(acc / STEP);
      if (steps < 1) return true;
      acc -= steps * STEP;
      while (steps-- > 0 && !settled) {
        if (easing) {
          ease();
          continue;
        }
        const keep = Math.pow(1 - cfg.damping, 1 / SUB);
        let move = 0;
        for (let s = 0; s < SUB; s++) move = integrate(STEP / 1000 / SUB, keep, s === SUB - 1);
        quiet = move * SUB < SLEEP_MOVE ? quiet + 1 : 0;
        if (quiet >= SLEEP_FRAMES) easing = true;
      }
      return !settled;
    }

    // 端点挪了：停着的绳子挪得很少就直接对齐新悬链线；挪得多就醒来晃；正在晃的绳子只更新目标，不打断它
    function setEnds(from, to, opts) {
      const na = pt(from);
      const nb = pt(to);
      const instant = !!(opts && opts.instant);
      const moved = Math.max(Math.abs(na.x - a.x), Math.abs(na.y - a.y), Math.abs(nb.x - b.x), Math.abs(nb.y - b.y));
      if (moved < 1e-6 && !instant) return api;
      a = na;
      b = nb;
      relax();
      if (still || instant || (settled && moved < 0.5)) snap();
      else if (moved >= 0.5) wake();
      return api;
    }

    // 横向拨一下：strength 是绳子中点的初速度（像素 / 帧），按正弦分布到各节点
    function pluck(strength, at) {
      if (still || dead) return api;
      const s = num(strength, 6);
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const nx = -(b.y - a.y) / len;
      const ny = (b.x - a.x) / len;
      const c = clamp(num(at, 0.5), 0.1, 0.9);
      for (let i = 1; i < n; i++) {
        const t = i / n;
        const w = t <= c ? Math.sin(Math.PI / 2 * t / c) : Math.sin(Math.PI / 2 * (1 - t) / (1 - c));
        old[2 * i] = pos[2 * i] - nx * s * w;
        old[2 * i + 1] = pos[2 * i + 1] - ny * s * w;
      }
      wake();
      return api;
    }

    // 从端点之间拉直的状态放手，让它自己垂下来（入场用）
    function drop() {
      if (still || dead) return api;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        pos[2 * i] = old[2 * i] = a.x + (b.x - a.x) * t;
        pos[2 * i + 1] = old[2 * i + 1] = a.y + (b.y - a.y) * t;
      }
      wake();
      return api;
    }

    function points() {
      const list = [];
      for (let i = 0; i <= n; i++) list.push([pos[2 * i], pos[2 * i + 1]]);
      return list;
    }

    const api = {
      path: () => svgPath(pos, count),
      points,
      trace: ctx => traceInto(ctx, pos, count),
      step,
      setEnds,
      pluck,
      drop,
      settle: () => { if (!dead) snap(); return api; },
      destroy() {
        dead = true;
        settled = true;
      },
      get settled() { return settled; },
      get from() { return { x: a.x, y: a.y }; },
      get to() { return { x: b.x, y: b.y }; },
      get slack() { return cfg.slack; },
      set slack(v) {
        cfg.slack = Math.max(1, num(v, cfg.slack));
        relax();
        if (still) snap(); else wake();
      },
      color: o.color || '',
      data: o.data
    };

    relax();
    snap();
    return api;
  }

  /* ---------- 批量画（Canvas） ---------- */

  // lines 可以是 create() 的绳子，也可以是 { from, to, slack, color }；同色的合成一次 stroke
  function batch(ctx, lines, style) {
    if (!ctx || !lines || !lines.length) return;
    const s = style || {};
    const groups = new Map();
    for (const line of lines) {
      if (!line) continue;
      const key = line.color || s.color || '';
      let g = groups.get(key);
      if (!g) groups.set(key, g = []);
      g.push(line);
    }
    ctx.save();
    ctx.lineWidth = num(s.width, 1);
    ctx.lineCap = s.cap || 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = num(s.alpha, 1);
    if (s.dash) ctx.setLineDash(s.dash);
    let tmp = null;
    groups.forEach((group, color) => {
      ctx.beginPath();
      for (const line of group) {
        if (typeof line.trace === 'function') {
          line.trace(ctx);
        } else {
          const seg = clamp(Math.round(num(line.segments, 12)), 2, 64);
          if (!tmp || tmp.length !== 2 * seg + 2) tmp = new Float64Array(2 * seg + 2);
          catenaryInto(tmp, pt(line.from), pt(line.to), num(line.slack, DEFAULTS.slack), seg);
          traceInto(ctx, tmp, seg + 1);
        }
      }
      if (color) ctx.strokeStyle = color;
      ctx.stroke();
    });
    ctx.restore();
  }

  /* ---------- 帧驱动：有绳子在动才要 rAF，全部停住就不再要 ---------- */

  function loop(options) {
    const o = options || {};
    const ropes = new Set(o.ropes || []);
    let raf = 0;
    let last = 0;
    let frames = 0;
    let cost = 0;
    const raq = typeof requestAnimationFrame === 'function' ? cb => requestAnimationFrame(cb) : cb => setTimeout(() => cb(Date.now()), STEP);
    const caf = typeof cancelAnimationFrame === 'function' ? id => cancelAnimationFrame(id) : id => clearTimeout(id);
    const now = () => (typeof performance === 'object' ? performance.now() : Date.now());

    function tick(time) {
      raf = 0;
      const t0 = now();
      const dt = last ? time - last : STEP;
      last = time;
      frames += 1;
      let busy = false;
      ropes.forEach(r => { if (r.step(dt)) busy = true; });
      if (typeof o.frame === 'function' && o.frame(dt) === true) busy = true;
      cost = now() - t0;
      if (busy) raf = raq(tick);
      else {
        last = 0;
        if (typeof o.rest === 'function') o.rest();
      }
    }

    return {
      add(r) { if (r) ropes.add(r); return this; },
      remove(r) { ropes.delete(r); return this; },
      clear() { ropes.clear(); return this; },
      wake() {
        if (!raf) {
          last = 0;
          raf = raq(tick);
        }
        return this;
      },
      stop() {
        if (raf) caf(raf);
        raf = 0;
        last = 0;
        return this;
      },
      get running() { return raf !== 0; },
      get frames() { return frames; },
      get cost() { return cost; },
      get ropes() { return Array.from(ropes); }
    };
  }

  window.CommonsGravity = {
    version: 1,
    defaults: Object.freeze(Object.assign({}, DEFAULTS)),
    reduced,
    create,
    catenary,
    catenaryPoints,
    batch,
    loop
  };
})();
