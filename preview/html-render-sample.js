/* LG-5 R2: demo-only content; excluded from live builds. 示例 HTML 作品、作者和实验目录。 */
(function () {
  'use strict';

  function token(name) {
    return (getComputedStyle(document.documentElement).getPropertyValue(name) || '').trim();
  }

  /* ---------- 示例（与 preview/assets/html-samples/ 同步，file:// 不依赖 fetch） ---------- */

  function themedSample(source) {
    const palette = {
      '__PAPER__': token('--paper'),
      '__SLATE_100__': token('--slate-100'),
      '__SLATE_400__': token('--slate-400'),
      '__INK__': token('--ink'),
      '__INK_2__': token('--ink-2'),
      '__MUTED__': token('--muted'),
      '__SURFACE__': token('--surface'),
      '__LINE__': token('--line'),
      '__CONTROL_LINE__': token('--control-line'),
      '__ACCENT__': token('--accent'),
      '__ACCENT_INK__': token('--accent-ink'),
      '__ACCENT_SOFT__': token('--accent-soft'),
      '__ACCENT_LINE__': token('--accent-line'),
      '__AGENT__': token('--agent'),
      '__DANGER_INK__': token('--danger-ink'),
      '__DANGER_SOFT__': token('--danger-soft')
    };
    return Object.entries(palette).reduce((html, pair) => html.split(pair[0]).join(pair[1]), source);
  }

  const SAMPLE_HTML = {
    board: themedSample(`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>周迭代看板 · 示例</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100%; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; background: __SLATE_100__; color: __INK__; }
  header { display: flex; align-items: baseline; gap: 12px; padding: 20px 24px 8px; }
  header h1 { margin: 0; font-size: 18px; letter-spacing: -.01em; }
  header small { color: __MUTED__; font-size: 12px; }
  main { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; padding: 12px 24px 24px; }
  section { min-width: 0; padding: 12px; background: __SURFACE__; border: 1px solid __LINE__; border-radius: 12px; }
  h2 { margin: 0 0 8px; font-size: 12px; font-weight: 600; color: __MUTED__; letter-spacing: .08em; }
  article { margin: 0 0 8px; padding: 10px 12px; background: __PAPER__; border-radius: 8px; }
  article:last-child { margin-bottom: 0; }
  article b { display: block; font-size: 13px; }
  article span { display: block; margin-top: 4px; color: __MUTED__; font-size: 12px; }
  .tag { display: inline-block; margin-top: 8px; padding: 2px 8px; border-radius: 4px; background: __ACCENT_SOFT__; color: __ACCENT_INK__; font-size: 11px; }
</style>
</head>
<body>
  <header>
    <h1>周迭代看板</h1>
    <small>示例 · 不连接真实任务</small>
  </header>
  <main>
    <section>
      <h2>待做</h2>
      <article><b>把 HTML 沙箱接到作品页</b><span>只跑本机文件，不发外网</span><i class="tag">前端</i></article>
      <article><b>补一条复现说明</b><span>写清输入、失败样本和预期</span></article>
    </section>
    <section>
      <h2>进行中</h2>
      <article><b>缩略图失败时的占位图</b><span>用标题和主色，不留白</span><i class="tag">媒体</i></article>
    </section>
    <section>
      <h2>已核对</h2>
      <article><b>iframe 只开 allow-scripts</b><span>不开 same-origin，通信走 postMessage</span><i class="tag">安全</i></article>
    </section>
  </main>
</body>
</html>`),
    canvas: themedSample(`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>轨道草稿 · 示例</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100%; background: __INK__; color: __SLATE_100__; font: 13px/1.4 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; }
  canvas { display: block; width: 100%; height: 100vh; }
  p { position: absolute; left: 20px; bottom: 16px; margin: 0; color: __SLATE_400__; letter-spacing: .04em; }
</style>
</head>
<body>
  <canvas id="c" width="1200" height="750"></canvas>
  <p>轨道草稿 · 示例 · 不自动外发</p>
  <script>
    (function () {
      var canvas = document.getElementById('c');
      var ctx = canvas.getContext('2d');
      var dots = [];
      var i;
      for (i = 0; i < 18; i += 1) {
        dots.push({ r: 48 + i * 14, a: i * 0.42, s: 0.004 + i * 0.00035, w: 1 + (i % 3) });
      }
      function paint(t) {
        var w = canvas.width, h = canvas.height, cx = w * 0.52, cy = h * 0.48;
        ctx.fillStyle = '__INK__';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '__ACCENT_LINE__';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, 210, 0, Math.PI * 2);
        ctx.stroke();
        for (i = 0; i < dots.length; i += 1) {
          var d = dots[i];
          var x = cx + Math.cos(d.a + t * d.s) * d.r;
          var y = cy + Math.sin(d.a + t * d.s) * d.r * 0.62;
          ctx.beginPath();
          ctx.fillStyle = i % 4 === 0 ? '__ACCENT__' : '__AGENT__';
          ctx.globalAlpha = 0.85;
          ctx.arc(x, y, d.w + 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(paint);
      }
      paint(0);
    })();
  <\/script>
</body>
</html>`),
    phish: themedSample(`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>请先验证身份 · 示例</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: __PAPER__; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; color: __INK__; }
  form { width: min(360px, 92vw); padding: 24px; background: __SURFACE__; border: 1px solid __LINE__; border-radius: 12px; }
  .mark { display: inline-block; margin-bottom: 12px; padding: 2px 8px; border-radius: 4px; background: __DANGER_SOFT__; color: __DANGER_INK__; font-size: 11px; }
  h1 { margin: 0 0 8px; font-size: 18px; }
  p { margin: 0 0 16px; color: __MUTED__; font-size: 13px; }
  label { display: block; margin: 0 0 6px; font-size: 12px; color: __INK_2__; }
  input { width: 100%; height: 40px; margin-bottom: 12px; padding: 0 12px; border: 1px solid __CONTROL_LINE__; border-radius: 8px; font: inherit; }
  button { width: 100%; height: 40px; border: 0; border-radius: 8px; background: __ACCENT__; color: __SURFACE__; font: 600 14px/1 inherit; }
</style>
</head>
<body>
  <form action="/login" method="post" id="login">
    <span class="mark">示例 · 钓鱼检测 · 不要输入真实账号</span>
    <h1>请先验证身份</h1>
    <p>伪造的登录框，用来检查静态规则能不能抓住收集账号的表单。</p>
    <label for="email">邮箱</label>
    <input id="email" name="email" type="email" autocomplete="username" placeholder="you@example.com">
    <label for="password">密码</label>
    <input id="password" name="password" type="password" autocomplete="current-password">
    <button type="submit">继续查看作品</button>
  </form>
</body>
</html>`),
    external: `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<base href="https://cdn.example.com/works/">
<meta http-equiv="refresh" content="12;url=https://example.com/leave">
<title>外链探针 · 示例</title>
<script src="https://cdn.example.com/tracker.js"><\/script>
<script src="//cdn.example.com/coinhive.min.js"><\/script>
<link rel="stylesheet" href="https://cdn.example.com/skin.css">
</head>
<body>
  <h1>外链探针</h1>
  <p>示例。这一页故意写下危险写法，给检查规则当靶子，不会真的发出去。</p>
  <img src="https://cdn.example.com/cover.png" alt="">
  <iframe src="https://example.com/nested"></iframe>
  <script>
    eval('window.__probe = 1');
    var fn = new Function('return 1');
    document.write('<p>document.write</p>');
    window.location.href = 'https://example.com/phish';
    // CryptoNight · CoinHive miner hook
    var miner = { site: 'coinhive', algo: 'CryptoNight' };
  <\/script>
</body>
</html>`
  };

  const SAMPLES = [
    { id: 'board', file: 'board.html', title: '周迭代看板', author: '陈墨', handle: 'chen-mo', kind: '小看板', html: SAMPLE_HTML.board },
    { id: 'canvas', file: 'canvas.html', title: '轨道草稿', author: '林栖', handle: 'lin-qi', kind: 'canvas 动画', html: SAMPLE_HTML.canvas },
    { id: 'phish', file: 'phish.html', title: '请先验证身份', author: '余岚', handle: 'yu-lan', kind: '钓鱼表单', html: SAMPLE_HTML.phish },
    { id: 'external', file: 'external.html', title: '外链探针', author: '松原', handle: 'song-yuan', kind: '外部脚本', html: SAMPLE_HTML.external }
  ];

  window.COMMONS_HTML_RENDER_SAMPLE = { samples: SAMPLES };
})();
