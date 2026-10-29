/* LG-4 R2: demo-only content; excluded from live builds. */
window.COMMONS_IMAGE_SAMPLE = {
create: function (env) {
  var cssValue = env.cssValue;
  var esc = env.esc;
  var html = env.html;
  var release = env.release;
  var reset = env.reset;
  var set = env.set;
  var lab = { gen: 0 };
  var LAB_COLORS = ['--blue-500', '--teal-400', '--violet-400', '--sky-400', '--blue-700', '--teal-600', '--violet-300', '--sky-200', '--blue-300', '--blue-600'];

  function palette() {
    var cs = getComputedStyle(document.documentElement);
    return LAB_COLORS.map(function (n) { return cs.getPropertyValue(n).trim() || 'Canvas'; });
  }

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function drawShapes(ctx, w, h, seed, pal) {
    var r = rng(seed * 7919 + 13);
    var kind = seed % 6;
    var c1 = pal[seed % pal.length];
    var c2 = pal[(seed * 3 + 2) % pal.length];
    var g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, c1);
    g.addColorStop(1, c2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    var light = pal[7];
    var dark = pal[4];
    var i;
    if (kind === 0) {
      for (i = 0; i < 14; i++) {
        ctx.globalAlpha = 0.14 + r() * 0.3;
        ctx.fillStyle = i % 2 ? light : dark;
        ctx.beginPath();
        ctx.arc(r() * w, r() * h, (0.05 + r() * 0.22) * Math.min(w, h), 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (kind === 1) {
      ctx.lineWidth = Math.max(2, w * 0.03);
      for (i = -h; i < w; i += w * 0.09) {
        ctx.globalAlpha = 0.18 + (i % 3) * 0.08;
        ctx.strokeStyle = i % 2 ? light : dark;
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + h, h);
        ctx.stroke();
      }
    } else if (kind === 2) {
      var n = 6;
      for (var gx = 0; gx < n; gx++) {
        for (var gy = 0; gy < n; gy++) {
          var x0 = gx * w / n;
          var y0 = gy * h / n;
          ctx.globalAlpha = 0.1 + r() * 0.34;
          ctx.fillStyle = r() > 0.5 ? light : dark;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x0 + w / n, y0 + (r() > 0.5 ? 0 : h / n));
          ctx.lineTo(x0, y0 + h / n);
          ctx.closePath();
          ctx.fill();
        }
      }
    } else if (kind === 3) {
      ctx.lineWidth = Math.max(2, w * 0.018);
      var cx = w * (0.3 + r() * 0.4);
      var cy = h * (0.3 + r() * 0.4);
      for (i = 1; i < 10; i++) {
        ctx.globalAlpha = 0.5 - i * 0.04;
        ctx.strokeStyle = i % 2 ? light : dark;
        ctx.beginPath();
        ctx.arc(cx, cy, i * Math.min(w, h) * 0.09, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (kind === 4) {
      ctx.lineWidth = Math.max(2, h * 0.02);
      for (i = 0; i < 9; i++) {
        ctx.globalAlpha = 0.18 + i * 0.03;
        ctx.strokeStyle = i % 2 ? light : dark;
        ctx.beginPath();
        for (var x = 0; x <= w; x += w / 40) {
          var y = h * (0.12 + i * 0.1) + Math.sin(x / w * Math.PI * 3 + i + seed) * h * 0.06;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    } else {
      var cell = Math.min(w, h) / 8;
      for (var ix = 0; ix * cell < w; ix++) {
        for (var iy = 0; iy * cell < h; iy++) {
          ctx.globalAlpha = r() > 0.6 ? 0.34 : 0.1;
          ctx.fillStyle = (ix + iy) % 2 ? light : dark;
          ctx.fillRect(ix * cell + cell * 0.12, iy * cell + cell * 0.12, cell * 0.76, cell * 0.76);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  function synth(seed, w, h, label) {
    var pal = palette();
    var cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    var ctx = cv.getContext('2d');
    drawShapes(ctx, w, h, seed, pal);
    if (label) {
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = pal[7];
      ctx.font = '600 ' + Math.round(Math.min(w, h) * 0.12) + 'px ' + (getComputedStyle(document.body).fontFamily || 'sans-serif');
      ctx.textBaseline = 'bottom';
      ctx.fillText('№ ' + label, w * 0.05, h - h * 0.05 > 0 ? h * 0.95 : h);
      ctx.globalAlpha = 1;
    }
    var tiny = document.createElement('canvas');
    tiny.width = 16;
    tiny.height = Math.max(1, Math.round(16 * h / w));
    tiny.getContext('2d').drawImage(cv, 0, 0, tiny.width, tiny.height);
    return {
      src: cv.toDataURL('image/jpeg', 0.82),
      blur: tiny.toDataURL('image/jpeg', 0.5),
      color: pal[seed % pal.length],
      w: w,
      h: h
    };
  }

  /* 长图样例：画一张像长截图的竖版页面（页眉、段落、配图、卡片），只取 tokens 颜色。 */
  function synthLong(w, h) {
    var cs = getComputedStyle(document.documentElement);
    function tk(n, fb) { return cs.getPropertyValue(n).trim() || fb; }
    var bg = tk('--surface', 'Canvas');
    var soft = tk('--blue-50', bg);
    var line = tk('--slate-200', 'GrayText');
    var text = tk('--slate-300', 'GrayText');
    var head = tk('--blue-600', 'Highlight');
    var b1 = tk('--blue-100', soft);
    var b3 = tk('--blue-300', head);
    var v3 = tk('--violet-300', b3);
    var cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    var ctx = cv.getContext('2d');
    var r = rng(41);
    function box(x, y, bw, bh, rad, c) {
      ctx.fillStyle = c;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, bw, bh, rad); else ctx.rect(x, y, bw, bh);
      ctx.fill();
    }
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    var pad = Math.round(w * 0.08);
    var inner = w - pad * 2;
    ctx.fillStyle = head;
    ctx.fillRect(0, 0, w, Math.round(w * 0.18));
    box(pad, Math.round(w * 0.06), inner * 0.5, Math.round(w * 0.05), w * 0.025, b1);
    var y = Math.round(w * 0.18) + pad;
    var k = 0;
    while (y < h - pad) {
      var kind = k % 3;
      if (kind === 0) {
        var n = 3 + Math.floor(r() * 3);
        for (var i = 0; i < n && y < h - pad; i++) {
          box(pad, y, inner * (i === n - 1 ? 0.45 + r() * 0.2 : 0.82 + r() * 0.18), Math.round(w * 0.03), w * 0.015, text);
          y += Math.round(w * 0.06);
        }
      } else if (kind === 1) {
        var ih = Math.round(inner * 0.56);
        var g = ctx.createLinearGradient(pad, y, pad + inner, y + ih);
        g.addColorStop(0, b1);
        g.addColorStop(1, b3);
        box(pad, y, inner, ih, w * 0.03, g);
        ctx.fillStyle = v3;
        ctx.beginPath();
        ctx.arc(pad + inner * (0.3 + r() * 0.4), y + ih * 0.5, ih * 0.22, 0, Math.PI * 2);
        ctx.fill();
        y += ih + Math.round(w * 0.06);
      } else {
        var ch = Math.round(w * 0.2);
        box(pad, y, inner, ch, w * 0.03, soft);
        box(pad + w * 0.04, y + w * 0.04, ch - w * 0.08, ch - w * 0.08, w * 0.02, b1);
        box(pad + ch, y + w * 0.05, inner * 0.5, Math.round(w * 0.03), w * 0.015, text);
        box(pad + ch, y + w * 0.11, inner * 0.32, Math.round(w * 0.03), w * 0.015, line);
        y += ch + Math.round(w * 0.06);
      }
      k++;
    }
    var tiny = document.createElement('canvas');
    tiny.width = 16;
    tiny.height = Math.max(1, Math.round(16 * h / w));
    tiny.getContext('2d').drawImage(cv, 0, 0, tiny.width, tiny.height);
    return { src: cv.toDataURL('image/jpeg', 0.86), blur: tiny.toDataURL('image/jpeg', 0.5), color: soft, w: w, h: h };
  }

  var BAD_SRC = 'data:image/png;base64,AAAA';

  /* 图片件演示用的样图（assets/samples/，IMG-2 出图）；第四项是 12px 宽的模糊占位，离线用 PIL 从原图缩出。 */
  var LAB_ASSETS = [
    ['talk-prompt-structure', 1280, 720, 'data:image/webp;base64,UklGRlYAAABXRUJQVlA4IEoAAAAQAgCdASoMAAcAA4BaJbACdAD8Lu5uTIzgAP7yaose/Boey2oMsUl3Dz9JOHNrNGak3X8A2WKMm/iXanyO31O5G0WP27sRYS4AAA=='],
    ['work-knowledge-map', 960, 720, 'data:image/webp;base64,UklGRmQAAABXRUJQVlA4IFgAAADQAQCdASoMAAkAA4BaJZgCdAEUUbVnAAD+4NhudkBJzOA7MQb4vkcc0GqyRZ/kaO3khGxT7r9t4N5kZwLXHOsVV7e4651qCsc+iq4A/z30cdLJV5QGYoAA'],
    ['room-roundtable', 1280, 720, 'data:image/webp;base64,UklGRlAAAABXRUJQVlA4IEQAAADwAQCdASoMAAcAA4BaJQBOgCKl5+hCuIAA/snNWEJUE+yl/hZlstd8qhmovMAiANBpi0rkSAuwcKMGqtJo8naQ40AAAA=='],
    ['work-review-bench', 960, 720, 'data:image/webp;base64,UklGRmIAAABXRUJQVlA4IFYAAAAQAgCdASoMAAkAA4BaJagCdAYtznYZY1wQAP7WEedfXZFXNwc+OFG9j0wKeyVhYsh/Mh4ycP2rCj/qTDIwqLaKOOK00lLpU8kFyknKslnjHEYZ1gAAAA=='],
    ['talk-accept-checklist', 1280, 720, 'data:image/webp;base64,UklGRkYAAABXRUJQVlA4IDoAAACwAQCdASoMAAcAA4BaJQBOgB03KRsAAP73PhHd/d+wq16ZEPIvbNZWG2KJu3SUseHONvdG3RJS3ZAA'],
    ['talk-agent-tool-recovery', 1280, 720, 'data:image/webp;base64,UklGRloAAABXRUJQVlA4IE4AAADwAQCdASoMAAcAA4BaJZgCdADcPcvOxwAA/sii1jvqzyA8dAsBK1dUeKt24cT0KDpdgDUpo2O4kYg2VG4njgBghpD4HEWfm4MWjk4AAAA='],
    ['talk-local-model-deploy', 1280, 720, 'data:image/webp;base64,UklGRlIAAABXRUJQVlA4IEYAAADwAQCdASoMAAcAA4BaJagCdADdbgKXy3AA/uCjJPQt4LOaA/FUpM/Kg7QEFx7Oznv35mnetqbnYOGpGY90n60xx7BTfjwA'],
    ['talk-meeting-minutes', 1280, 720, 'data:image/webp;base64,UklGRlIAAABXRUJQVlA4IEYAAAAQAgCdASoMAAcAA4BaJZACdAEQE7xQq3YAAP7og7DGfJVkkEDuC3nRprNxoDMQu+l6X9Jk0XNheBmfZRoVwH/pTFSMM6wA'],
    ['talk-understanding-diff', 1280, 720, 'data:image/webp;base64,UklGRlYAAABXRUJQVlA4IEoAAAAQAgCdASoMAAcAA4BaJagCdAEVjfoXIheAAP7yEpQKANN7BokFRVp/krOSH1p8EWBzi6BpzyQ5TzHNzqBFMCzttFVGGXN3uYgAAA=='],
    ['work-automation-board', 960, 720, 'data:image/webp;base64,UklGRlwAAABXRUJQVlA4IFAAAAAwAgCdASoMAAkAA4BaJbACdAD7FvKFZeNoAAD+taGOHyinOqFjtOY/uPjyD5svTSk/qRAr14r4XAxA7EYJ9utspYFTdv1bTEDH/4j+TvfgAA=='],
    ['work-prompt-safety', 960, 720, 'data:image/webp;base64,UklGRloAAABXRUJQVlA4IE4AAADwAQCdASoMAAkAA4BaJaACdAELVtSugYAA/pTr4KOC2aTBuo2jn/IHKOAjsTKnC3PTVgRGJuYjlCPH6KITu4cVN0+2WJSa//8NH/7vAAA='],
    ['work-rag-trace', 960, 720, 'data:image/webp;base64,UklGRmgAAABXRUJQVlA4IFwAAADwAQCdASoMAAkAA4BaJbACdAYrTGWStcAA/ie+Jx1q6NjEgvxOuEtuWQLr4SI8zTEp+hglgMLrWT8hxZWN6NGS1Lae7eEqqaLr3H+Xt6CTtzDF8vMPusMImtAAAA=='],
    ['work-weekly-evidence', 960, 720, 'data:image/webp;base64,UklGRmYAAABXRUJQVlA4IFoAAAAQAgCdASoMAAkAA4BaJbACdADhmJEkr/aAAOJ5/61Ki4fc0vBR41CGqpfFyU/qMebi1x5aEviv/cRbEx/8lTL2T6ZfGD51zpCcwRrpI9/eIlP83ojbYqYAAAA='],
    ['room-pair-coding', 1280, 720, 'data:image/webp;base64,UklGRkwAAABXRUJQVlA4IEAAAADwAQCdASoMAAcAA4BaJQBOgCKKaJQbgAAA/ut1cMbqCiMCcK8YQwMJ8/6Fumza/TzbTR8M1kPr2Q9+SGThgAAA'],
    ['room-teaching-board', 1280, 720, 'data:image/webp;base64,UklGRkwAAABXRUJQVlA4IEAAAAAQAgCdASoMAAcAA4BaJZACdAEVlVgFFIIAAP7wbJL200r4yLylo2VgpueM9u0a2iL62Q7wAm3qVunWCpOq4AAA'],
    ['biz-creator-earnings', 1280, 720, 'data:image/webp;base64,UklGRlIAAABXRUJQVlA4IEYAAADQAQCdASoMAAcAA4BaJbACdADbINJIAAD+6AAyyrxJ5+yNMXjJpf4aEToabQlNMPn5NgZFiZ8zyK3tNgTP2UYN83exUAAA'],
    ['biz-enterprise-team', 1280, 720, 'data:image/webp;base64,UklGRloAAABXRUJQVlA4IE4AAADwAQCdASoMAAcAA4BaJaACdADciDdXT0AA/pQ/3lMYowJ5HLMpNyOwPDNxubTKzAUVYCo+/xsQ8qVH0inUP+iJX42PC/uzWF5u71oucAA='],
    ['lib-component-1', 512, 512, 'data:image/webp;base64,UklGRm4AAABXRUJQVlA4IGIAAAAwAgCdASoMAAwAA4BaJbACdAELY1dof9higAD8hyuTzYzKi6EqiMqvh44eAhCeNWelRRCTlARVwbHtvG3A+/apwqmc89eD2Cu3mTCg673SpNOW3u3CezNa8/zbSpdxuk/kAA=='],
    ['lib-component-2', 512, 512, 'data:image/webp;base64,UklGRm4AAABXRUJQVlA4IGIAAABwAgCdASoMAAwAA4BaJaACdAYrn2/X2UMTMUXgAP6YxkgrUKT7e2qCSzaCfFd/1cckyg/QxAdrkgFuWz6/bijNfSLjlfQ0xlUh9aWR4GDSqIVv86P4Fy/+veWg1nmrSIIAAA=='],
    ['lib-component-3', 512, 512, 'data:image/webp;base64,UklGRlIAAABXRUJQVlA4IEYAAADQAQCdASoMAAwAA4BaJaACdADOBv2UIAD+tSQfgGuEcyVMmL5FId1FNX+vMMemY4sf7+HR7vVy+iBa4vseR//tOnwjC3wA'],
    ['lib-component-4', 512, 512, 'data:image/webp;base64,UklGRl4AAABXRUJQVlA4IFIAAAAQAgCdASoMAAwAA4BaJZACdAEOQbQg9bkAAP73IRLh6BX7mHPaL1jOwmloskFl7dZW83LYGHHB4LiqtEnvIHMwL+B+8Q3GSGM1hywmBXDXlgAA'],
    ['lib-pattern-1', 512, 512, 'data:image/webp;base64,UklGRnAAAABXRUJQVlA4IGQAAADwAQCdASoMAAwAA4BaJagCdAECpqbwPmAA/rO9an7EzMrXS44jSyhsWKZ98gXHNVGQmnn/7xUIrcVgZKpJM3WAPBHUcasOVtbp7eIj68FDeMCJCLrj3bs+tgGFyzzdgpP5AAAA'],
    ['lib-pattern-2', 512, 512, 'data:image/webp;base64,UklGRmgAAABXRUJQVlA4IFwAAAAQAgCdASoMAAwAA4BaJbACdADdRG2uwaAAAP7Ce5+v3Wvk1eeWGC/JvSSorNHKY2t5n+QJumq6cS7RgiXaiDh6YPUdRC5kqm2ZdFHh3r9twIS/3oGFJYKeQ3gAAA=='],
    ['lib-pattern-3', 512, 512, 'data:image/webp;base64,UklGRmIAAABXRUJQVlA4IFYAAAAwAgCdASoMAAwAA4BaJZgCdAYqrnBlaDzYAAD+yd4ghZvaC3GEoKgUF7niNE7Yz+JqihN8hg5rqWkWnHhXenJ98/RKj/zjRf8ZlKPg6Cf0nxCMM6wAAA=='],
    ['lib-pattern-4', 512, 512, 'data:image/webp;base64,UklGRmAAAABXRUJQVlA4IFQAAAAQAgCdASoMAAwAA4BaJbACdAELWxZHW2gAAP7hpk0Wp6zjwMgGGAdS9MxHI71r0Gu9LzA43Sff9DFu4qJW743jxobXxVAeduzxiklbs2HLLrIAAAA='],
    ['lib-prompt-1', 512, 512, 'data:image/webp;base64,UklGRmoAAABXRUJQVlA4IF4AAACwAQCdASoMAAwAA4BaJbACdAC0Lw+AAP7npz2JsZWJaC/HvPNv3rZDofzF8vr9o1XkUIlev9huUD77/ZbyYvueJ3FbZZiMi8cYImQhMZ2fBOOPF0Xe6X+TdGVLUwAA'],
    ['lib-prompt-2', 512, 512, 'data:image/webp;base64,UklGRmAAAABXRUJQVlA4IFQAAADwAQCdASoMAAwAA4BaJaACdAYtLYWGlgAA/vOCtI068ufHLEU+nG8GpNE2cOnU492RvP4P/Nfl9uHBxBGGH+hL0j44gcunfGtfSK4FC+U64Q2BrAA='],
    ['lib-prompt-3', 512, 512, 'data:image/webp;base64,UklGRm4AAABXRUJQVlA4IGIAAADQAQCdASoMAAwAA4BaJZgCdADaOugBwAD+1G13CBDjyMafQZCCR2XlDRwh6z7gZwNAfsn5s2YfTle/hpoX7B4Py5opxJtPOEGcVzAeBNwahgXldSOvjaq4Chn6nyMTHayAAA=='],
    ['lib-prompt-4', 512, 512, 'data:image/webp;base64,UklGRmYAAABXRUJQVlA4IFoAAAAwAgCdASoMAAwAA4BaJaACdAEe2DJVmgchAAD+4ox6l9K3IhcorFeOKOHba6o5lXSUNXD8Ih0avNeBfYCij3dWF4FWu8Uk9V0gmqoYNfdJ+wILogYaOA18QAA='],
    ['lib-skill-1', 512, 512, 'data:image/webp;base64,UklGRlgAAABXRUJQVlA4IEwAAADwAQCdASoMAAwAA4BaJaACdADygLLkwaAA/tOfCuBi0WsR4dbvat6cgB7pp555tnGP5WaiByIWmFab/UtmAI+3pawAGg5ietEAAAAA'],
    ['lib-skill-2', 512, 512, 'data:image/webp;base64,UklGRmwAAABXRUJQVlA4IGAAAADQAQCdASoMAAwAA4BaJbACdADbggJ4kAD9AgGEjp1hQcB5mgZ+Xql+LFtxl13ZaT10qpuDfZNA7WAbhfwI/Tkuva8FZk7tK04nPM8XHKTICTN3kG82c1NJaKtetHw/AAA='],
    ['lib-skill-3', 512, 512, 'data:image/webp;base64,UklGRmgAAABXRUJQVlA4IFwAAAAQAgCdASoMAAwAA4BaJbACdAYrTbF6Z9MAAP7KO8cyb2Tgli8LasrVKP6koY+qlqNMzXuIBulUd9N+isjY4ZJcwFHOBm/1dmX/aKfLv0CkriEtg7H0K6BPx4AAAA=='],
    ['lib-skill-4', 512, 512, 'data:image/webp;base64,UklGRkoAAABXRUJQVlA4ID4AAADQAQCdASoMAAwAA4BaJZgCdACqGZvdAAD+7eoU5v9n4Yhlf5xfNtGt9AAtAyOu86ZksPO1a/EH1SnbKUgAAA==']
  ];

  function labAsset(i) {
    var a = LAB_ASSETS[i % LAB_ASSETS.length];
    return { src: 'assets/samples/' + a[0] + '.webp', w: a[1], h: a[2], blur: a[3], color: 'var(--blue-100)' };
  }

  /* 墙面 30 张：先放 16 张方图，再轮到横图 */
  function wallAsset(n) {
    return labAsset(n < 16 ? 17 + n : 3 + (n - 16));
  }

  /* safe-fn: html is the escaping CommonsImage builder; replacement adds an escaped lab key. */
  function labFig(key, o) {
    o = o || {};
    o.hold = o.hold !== false;
    return html(o).replace('<figure class="img-fig', '<figure data-lab="' + esc(key) + '" class="img-fig');
  }

  function labPage() {
    var slow = [1, 2, 3].map(function (i) {
      return labFig('slow' + i, { width: 480, height: 320, alt: '示例图 ' + i + '（慢速）', group: 'slow' });
    }).join('');
    var errs =
      labFig('err-fix', { width: 480, height: 320, alt: '会在重试后成功的示例图', src: BAD_SRC, caption: '重试后成功', zoom: false }) +
      labFig('err-bad', { width: 480, height: 320, alt: '一直失败的示例图', src: BAD_SRC, caption: '一直失败', zoom: false });
    function gridFig(i) {
      var a = labAsset(4 + i);
      return labFig('g' + i, { width: a.w, height: a.h, alt: '示例图 ' + (i + 1), group: 'grid' });
    }
    var specs2 = [0, 1].map(gridFig).join('');
    var g3 = [2, 3, 4].map(gridFig).join('');
    var g4 = [5, 6, 7, 8].map(gridFig).join('');
    var g4b = [9, 10, 11, 12].map(gridFig).join('');
    var tall = labFig('tall', { width: 480, height: 1600, alt: '一张很长的示例图', group: 'grid', caption: '列表里裁一截，灯箱里看全图' });
    var wall = '';
    for (var i = 0; i < 30; i++) wall += labFig('wall' + i, { width: 320, height: 240, alt: '墙面示例图 ' + (i + 1), group: 'wall', zoom: true, hold: true });
    return '<div class="imglab" data-imglab-root>' +
      '<header class="imglab-head"><div class="imglab-title"><h1>图片件</h1><span class="pill outline">示例</span></div>' +
      '<p class="imglab-lead">色块和模糊小图先到，大图解码后淡入。</p></header>' +
      '<section class="imglab-card"><div class="imglab-card-head"><div><h2>占位和淡入</h2>' +
        '<p class="imglab-note">地址先拦住，点「放行」后淡入。</p></div>' +
        '<div class="imglab-row"><button type="button" class="button primary" data-img-act="lab-release">放行</button><button type="button" class="button" data-img-act="lab-reset">重来</button></div></div>' +
        '<div class="imglab-trio" data-lab-slow>' + /* safe: composed only from labFig with escaped values */ slow + '</div></section>' +
      '<section class="imglab-card"><div class="imglab-card-head"><div><h2>出错和重试</h2>' +
        '<p class="imglab-note">不留破图标，给一个「重试」。</p></div>' +
        '<div class="imglab-row"><button type="button" class="button" data-img-act="lab-err-reset">重新演示</button></div></div>' +
        '<div class="imglab-duo" data-lab-err>' + /* safe: composed only from labFig with escaped values */ errs + '</div></section>' +
      '<section class="imglab-card"><div class="imglab-card-head"><div><h2>多图排版和灯箱</h2>' +
        '<p class="imglab-note">点开可缩放、拖动、左右切换，Esc 关闭。</p></div></div>' +
        '<p class="imglab-sub">2 张并排</p><div class="imglab-g imglab-g-2">' + /* safe: composed only from labFig with escaped values */ specs2 + '</div>' +
        '<p class="imglab-sub">3 张：一大两小</p><div class="imglab-g imglab-g-3">' + /* safe: composed only from labFig with escaped values */ g3 + '</div>' +
        '<p class="imglab-sub">4 张：田字格</p><div class="imglab-g imglab-g-4">' + /* safe: composed only from labFig with escaped values */ g4 + '</div>' +
        '<p class="imglab-sub">4 张：一宽三窄</p><div class="imglab-g imglab-g-4b">' + /* safe: composed only from labFig with escaped values */ g4b + '</div>' +
        '<p class="imglab-sub">长图</p><div class="imglab-long">' + /* safe: composed only from labFig with escaped values */ tall + '</div></section>' +
      '<section class="imglab-card"><div class="imglab-card-head"><div><h2>懒加载</h2>' +
        '<p class="imglab-note">滚到哪里加载到哪里。</p></div><span class="imglab-count" data-lab-count>已加载 0 / 30</span></div>' +
        '<div class="imglab-wall" data-lab-wall>' + /* safe: composed only from labFig with escaped values */ wall + '</div></section>' +
    '</div>';
  }

  function labFigs(key) {
    return Array.prototype.slice.call(document.querySelectorAll('[data-lab="' + key + '"]'));
  }

  function labCount() {
    var wall = document.querySelector('[data-lab-wall]');
    var out = document.querySelector('[data-lab-count]');
    if (!wall || !out) return;
    var done = wall.querySelectorAll('[data-img-state="ready"]').length;
    out.textContent = '已加载 ' + done + ' / 30';
  }

  function labMount() {
    var root = document.querySelector('[data-imglab-root]');
    if (!root || root.hasAttribute('data-lab-started')) return;
    root.setAttribute('data-lab-started', '');
    var gen = ++lab.gen;
    var jobs = [];
    var seed = 1;
    ['slow1', 'slow2', 'slow3'].forEach(function (k) {
      var s = seed++;
      jobs.push(function () {
        var d = labAsset(s - 1);
        var fig = labFigs(k)[0];
        if (fig) set(fig, { blur: d.blur, src: d.src, release: false });
        if (fig) fig.querySelector('.img-frame').style.setProperty('--img-color', cssValue(d.color));
      });
    });
    jobs.push(function () {
      var d = labAsset(3);
      var f = labFigs('err-fix')[0];
      if (f) { set(f, { blur: d.blur, fallback: d.src, release: false }); f.querySelector('.img-frame').style.setProperty('--img-color', cssValue(d.color)); }
      var b = labFigs('err-bad')[0];
      if (b) { set(b, { blur: d.blur, release: false }); b.querySelector('.img-frame').style.setProperty('--img-color', cssValue(d.color)); }
      labErrStart();
    });
    for (var i = 0; i <= 12; i++) {
      (function (n) {
        jobs.push(function () {
          var d = labAsset(4 + n);
          var fig = labFigs('g' + n)[0];
          if (!fig) return;
          fig.querySelector('.img-frame').style.setProperty('--img-color', cssValue(d.color));
          set(fig, { blur: d.blur, src: d.src, full: d.src });
        });
      })(i);
    }
    jobs.push(function () {
      var d = synthLong(480, 1600);
      var fig = labFigs('tall')[0];
      if (fig) {
        fig.querySelector('.img-frame').style.setProperty('--img-color', cssValue(d.color));
        set(fig, { blur: d.blur, src: d.src, full: d.src });
      }
    });
    for (var j = 0; j < 30; j++) {
      (function (n) {
        jobs.push(function () {
          var d = wallAsset(n);
          var fig = labFigs('wall' + n)[0];
          if (!fig) return;
          fig.querySelector('.img-frame').style.setProperty('--img-color', cssValue(d.color));
          set(fig, { blur: d.blur, src: d.src });
        });
      })(j);
    }
    var step = function () {
      if (gen !== lab.gen) return;
      var t0 = performance.now();
      while (jobs.length && performance.now() - t0 < 12) jobs.shift()();
      if (jobs.length) setTimeout(step, 0);
      else labCount();
    };
    step();
  }

  function labErrStart() {
    labFigs('err-fix').concat(labFigs('err-bad')).forEach(function (f) {
      f.setAttribute('data-img-src', BAD_SRC);
      release(f);
    });
  }

  function labStop() {
    lab.gen += 1;
  }

  function labAct(act) {
    if (act === 'lab-release') {
      ['slow1', 'slow2', 'slow3'].forEach(function (k) { labFigs(k).forEach(release); });
    } else if (act === 'lab-reset') {
      ['slow1', 'slow2', 'slow3'].forEach(function (k) { labFigs(k).forEach(reset); });
    } else if (act === 'lab-err-reset') {
      labFigs('err-fix').concat(labFigs('err-bad')).forEach(function (f) {
        reset(f);
        labErrStart();
      });
    }
  }


  return { page: labPage, mount: labMount, stop: labStop, act: labAct, count: labCount };
}
};
