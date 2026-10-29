(() => {
  'use strict';

  /* R13 HTML-1 · 上传的 HTML 安全渲染、缩略图、静态检查。
     导出 window.CommonsHTML。主控接线：路由 html-lab、destroy/mount、两个文件。
     R2：演示模式用 srcdoc 沙箱（示例在 html-render-sample.js）；真实模式不跑 srcdoc 内联脚本，
     iframe 直接加载内容域名的 content_url，就绪/高度靠 postMessage，只认这个 iframe 发来的消息。 */

  const MAX_BYTES = 2 * 1024 * 1024;
  const THUMB_MS = 8000;
  const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";
  const MESSAGE_TYPES = { ready: 1, thumbnail: 1, 'capture-fail': 1, error: 1, height: 1 };
  const DEVICES = {
    desktop: { width: 1280, height: 800, label: '桌面' },
    tablet: { width: 768, height: 1024, label: '平板' },
    phone: { width: 390, height: 844, label: '手机' }
  };
  const LEVEL_ORDER = { block: 0, warn: 1, info: 2 };
  const LEVEL_LABEL = { block: '拦截', warn: '提醒', info: '说明' };
  const LEVEL_ICON = { block: 'blocked', warn: 'reminder', info: 'source' };
  const VENDOR_SRC = 'vendor/html-to-image.src.js';
  const LIVE_MESSAGES = { ready: 1, height: 1, error: 1 };
  const LIVE_LOAD_MS = 15000;
  const LIVE_DEFAULT_HEIGHT = 480;
  const CONTENT_PATH = /^\/c\/html_work\/[0-9a-f]{64}$/;

  const isLive = () => !!(window.CommonsAPI && window.CommonsAPI.mode === 'live');

  /* —— 静态检查规则表（正本）。GOV-1 移植时整表搬走，不要从散落正则里捡。 —— */
  const HTML_INSPECT_RULES = [
    {
      code: 'oversize',
      level: 'block',
      message: '单个 HTML 超过 2MB，渲染会被拒绝。请去掉超大的内联图片或把资源拆出去。',
      match: html => byteLength(html) > MAX_BYTES ? [{ line: 1 }] : []
    },
    {
      code: 'external-script',
      level: 'block',
      message: '引用了外部脚本。沙箱禁止网络请求，这段脚本不会加载。',
      match: html => scan(html, /<script\b[^>]*\bsrc\s*=\s*(['"]?)\s*(?:https?:)?\/\//gi)
    },
    {
      code: 'external-resource',
      level: 'warn',
      message: '引用了外部资源地址（http(s):// 或协议相对 //）。CSP 会拦住这些请求。',
      match: html => scan(html, /(?:\b(?:src|href|action|poster|srcset|data)\s*=\s*(['"])\s*(?:https?:)?\/\/|(?:url|@import)\s*\(\s*(['"]?)\s*(?:https?:)?\/\/|https?:\/\/[^\s"'`<>]+)/gi)
        .filter(hit => !isScriptSrcHit(html, hit.index))
    },
    {
      code: 'password-field',
      level: 'block',
      message: '含有密码输入框，可能在收集凭据。',
      match: html => scan(html, /<input\b[^>]*\btype\s*=\s*(['"]?)password\1/gi)
    },
    {
      code: 'account-form',
      level: 'warn',
      message: '表单在收集账号（用户名、邮箱或登录字段）。',
      match: html => scan(html, /<(?:input|form)\b[^>]*(?:\b(?:name|id|autocomplete|type|placeholder)\s*=\s*(['"]?)(?:user(?:name)?|e-?mail|login|account)\1)/gi)
    },
    {
      code: 'meta-refresh',
      level: 'block',
      message: '使用了 meta refresh，会尝试跳转离开当前页。',
      match: html => scan(html, /<meta\b[^>]*http-equiv\s*=\s*(['"]?)refresh\1/gi)
    },
    {
      code: 'location-redirect',
      level: 'block',
      message: '脚本里写了 location 跳转。',
      match: html => scan(html, /(?:window\s*\.\s*)?(?:document\s*\.\s*)?location\s*(?:\.\s*(?:href|assign|replace)\s*=|\s*=)/gi)
    },
    {
      code: 'nested-iframe',
      level: 'block',
      message: '嵌套了 iframe。沙箱 CSP 的 frame-src 为 none，不会加载。',
      match: html => scan(html, /<iframe\b/gi)
    },
    {
      code: 'eval-like',
      level: 'warn',
      message: '使用了 eval、new Function 或 document.write，运行时行为难以预料。',
      match: html => scan(html, /\beval\s*\(|\bnew\s+Function\s*\(|\bdocument\s*\.\s*write(?:ln)?\s*\(/gi)
    },
    {
      code: 'crypto-miner',
      level: 'block',
      message: '疑似挖矿脚本特征（常见库名、CryptoNight、coinhive 一类字样）。',
      match: html => scan(html, /coinhive|coin-hive|cryptonight|crypto-night|jsecoin|cryptoloot|minero|deepminer|coinimp|webmine(?:r|pool)?|wasmminer|monero-miner/gi)
    },
    {
      code: 'base-tag',
      level: 'block',
      message: '使用了 base 标签，会改写相对地址的解析起点。',
      match: html => scan(html, /<base\b/gi)
    },
    {
      code: 'huge-inline-data',
      level: 'info',
      message: '含有超大内联数据（单段 data: URI 超过 50KB）。',
      match: html => {
        const hits = [];
        const re = /data:[^;,\s]+;base64,([A-Za-z0-9+/=]+)/gi;
        let m;
        while ((m = re.exec(html))) {
          if (m[1].length > 50 * 1024) hits.push({ index: m.index, line: lineAt(html, m.index) });
        }
        return hits;
      }
    }
  ];

  /* ---------- 小工具 ---------- */

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  /* safe-fn: CommonsLinks.person 自行转义；退路对名字 esc、handle encodeURIComponent */
  function personLink(handle, name, level) {
    if (window.CommonsLinks && typeof window.CommonsLinks.person === 'function') {
      return window.CommonsLinks.person(handle, name, { level: level });
    }
    return handle ? '<a class="lk-person" href="#/u/' + encodeURIComponent(handle) + '">' + esc(name) + '</a>' : esc(name);
  }
  const byteLength = s => new TextEncoder().encode(String(s ?? '')).length;
  const reduceMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function lineAt(html, index) {
    let line = 1;
    const end = Math.min(index, html.length);
    for (let i = 0; i < end; i += 1) if (html.charCodeAt(i) === 10) line += 1;
    return line;
  }

  function scan(html, regex) {
    const flags = regex.flags.includes('g') ? regex.flags : regex.flags + 'g';
    const re = new RegExp(regex.source, flags);
    const hits = [];
    let m;
    while ((m = re.exec(html))) {
      hits.push({ index: m.index, text: m[0], line: lineAt(html, m.index) });
      if (!m[0].length) re.lastIndex += 1;
    }
    return hits;
  }

  function isScriptSrcHit(html, index) {
    const from = Math.max(0, index - 80);
    return /<script\b[^>]*$/.test(html.slice(from, index));
  }

  function randomToken() {
    const bytes = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    let out = '';
    for (let i = 0; i < bytes.length; i += 1) out += bytes[i].toString(16).padStart(2, '0');
    return out;
  }

  function stateIcon(name, size) {
    const lib = window.CommonsIcons;
    if (lib && typeof lib.svg === 'function') return lib.svg(name, { size: size || 14 });
    return '';
  }

  function token(name) {
    const styles = getComputedStyle(document.documentElement);
    return (styles.getPropertyValue(name) || '').trim();
  }

  function ico(d) {
    return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${esc(d)}"/></svg>`;
  }

  const GLYPH = {
    reload: 'M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5',
    full: 'M9 4H4v5M15 4h5v5M4 15v5h5M20 15v5h-5',
    exit: 'M9 9 4.5 4.5M4.5 9V4.5H9M15 9l4.5-4.5M19.5 9V4.5H15M9 15l-4.5 4.5M4.5 15v4.5H9M15 15l4.5 4.5M19.5 15v4.5H15',
    file: 'M7 3.5h7l4 4V20.5H7zM14 3.5v4h4',
    paste: 'M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7M8 7h8v13H8z'
  };

  function deadHandle() {
    return { setDevice() {}, reload() {}, destroy() {} };
  }

  /* ---------- inspect ---------- */

  function inspect(html) {
    const source = String(html ?? '');
    const findings = [];
    const seen = Object.create(null);
    for (let i = 0; i < HTML_INSPECT_RULES.length; i += 1) {
      const rule = HTML_INSPECT_RULES[i];
      const hits = rule.match(source) || [];
      for (let j = 0; j < hits.length; j += 1) {
        const line = hits[j].line || 1;
        const key = rule.code + ':' + line;
        if (seen[key]) continue;
        seen[key] = 1;
        findings.push({
          level: rule.level,
          code: rule.code,
          message: rule.message,
          line: line
        });
      }
    }
    findings.sort((a, b) => (LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]) || (a.line - b.line) || a.code.localeCompare(b.code));
    return findings;
  }

  /* ---------- srcdoc 包装 ---------- */

  function wrapSrcdoc(userHtml, extras) {
    const extraHead = extras && extras.head ? extras.head : '';
    const extraTail = extras && extras.tail ? extras.tail : '';
    const fill = extras && extras.fill !== false;
    const head =
      '<meta charset="utf-8">' +
      '<meta http-equiv="Content-Security-Policy" content="' + CSP + '">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<style>html,body{margin:0;' + (fill ? 'min-height:100%;' : '') + '}html{overflow:auto;}body{overflow:auto;}</style>' +
      /* safe: extraHead 是 wrapSrcdoc 明确接收的受控 head HTML 槽 */ extraHead;
    const html = String(userHtml || '');
    if (/<html[\s>]/i.test(html)) {
      let out = html;
      if (/<head[\s>]/i.test(out)) out = out.replace(/<head(\s[^>]*)?>/i, m => m + head);
      else if (/<html(\s[^>]*)?>/i.test(out)) out = out.replace(/<html(\s[^>]*)?>/i, m => /* safe: m 是原始 HTML 中匹配到的 <html> 开标签 */ m + '<head>' + head + '</head>');
      else out = '<head>' + head + '</head>' + /* safe: out 是调用方明确要求在沙箱 srcdoc 中渲染的完整 HTML */ out;
      if (extraTail) {
        if (/<\/body>/i.test(out)) out = out.replace(/<\/body>/i, /* safe: extraTail 是受控脚本 HTML 槽 */ extraTail + '</body>');
        else if (/<\/html>/i.test(out)) out = out.replace(/<\/html>/i, /* safe: extraTail 是受控脚本 HTML 槽 */ extraTail + '</html>');
        else out += extraTail;
      }
      return out;
    }
    return '<!doctype html><html><head>' + head + '</head><body>' + /* safe: html 是调用方明确要求在沙箱 srcdoc 中渲染的完整 HTML */ html + /* safe: extraTail 是受控脚本 HTML 槽 */ extraTail + '</body></html>';
  }

  function readyScript(token) {
    return '<script>(function(){var T=' + /* safe: token 由本模块 randomToken 生成并 JSON.stringify */ JSON.stringify(token) + ';' +
      'function send(type,extra){var m={token:T,type:type};if(extra){for(var k in extra)m[k]=extra[k];}try{parent.postMessage(m,"*");}catch(e){}}' +
      'function measure(){var h=Math.max(document.documentElement?document.documentElement.scrollHeight:0,document.body?document.body.scrollHeight:0,1);send("height",{height:h});}' +
      'function go(){send("ready");measure();if(window.ResizeObserver){try{new ResizeObserver(measure).observe(document.documentElement);}catch(e){}}window.addEventListener("resize",measure);}' +
      'if(document.readyState==="complete")go();else window.addEventListener("load",go);})();<\/script>';
  }

  function captureScripts(token, width, height) {
    const lib = String(window.__COMMONS_HTML_TO_IMAGE_SRC || '').replace(/<\/script/gi, '<\\/script');
    const runner =
      '<script>(function(){var T=' + /* safe: token 由本模块 randomToken 生成并经 JSON.stringify 序列化 */ JSON.stringify(token) + ',W=' + esc(String(width)) + ',H=' + esc(String(height)) + ';' +
      'function send(type,extra){var m={token:T,type:type};if(extra){for(var k in extra)m[k]=extra[k];}try{parent.postMessage(m,"*");}catch(e){}}' +
      'function frames(n,done){function step(){if(--n<=0)done();else requestAnimationFrame(step);}requestAnimationFrame(step);}' +
      'function run(){frames(2,function(){if(typeof htmlToImage==="undefined"||!htmlToImage.toPng){send("capture-fail",{reason:"library-missing"});return;}' +
      'htmlToImage.toPng(document.documentElement,{width:W,height:H,pixelRatio:1}).then(function(u){send("thumbnail",{dataUrl:u});}).catch(function(err){send("capture-fail",{reason:String(err&&err.message||err)});});});}' +
      'if(document.readyState==="complete")run();else window.addEventListener("load",run);})();<\/script>';
    return '<script>' + /* safe: lib 是加载后保存的 html-to-image 库源码，并已中和闭合 script 标签 */ lib + '<\/script>' + runner;
  }

  function makeFrame() {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    iframe.setAttribute('scrolling', 'yes');
    iframe.setAttribute('tabindex', '0');
    return iframe;
  }

  function listenFrame(iframe, token, onMsg) {
    const handler = event => {
      if (event.source !== iframe.contentWindow) return;
      if (event.origin && event.origin !== 'null' && event.origin !== location.origin) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.token !== token) return;
      if (!MESSAGE_TYPES[data.type]) return;
      onMsg(data);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }

  /* 真实模式：只认这个 iframe 的 contentWindow 发来的消息；沙箱里的页面来源恒为 "null"。 */
  function listenLiveFrame(iframe, onMsg) {
    const handler = event => {
      if (!iframe.contentWindow || event.source !== iframe.contentWindow) return;
      if (event.origin !== 'null') return;
      const data = event.data;
      if (!data || typeof data !== 'object' || !LIVE_MESSAGES[data.type]) return;
      onMsg(data);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }

  function liveError(message, retry) {
    const err = new Error(message);
    err.retry = retry;
    return err;
  }

  function resolveContentUrl(opts) {
    if (opts.contentUrl) return Promise.resolve(opts.contentUrl);
    if (opts.assetId && window.CommonsAPI) {
      return window.CommonsAPI.get('/media/assets/' + encodeURIComponent(opts.assetId)).then(res => {
        const url = res && res.data && res.data.content_url;
        if (!url) throw liveError('这个站点还没有配置作品内容域名，暂时不能预览。', false);
        return url;
      }, () => { throw liveError('作品地址没有取到。', true); });
    }
    return Promise.reject(liveError('这个作品没有内容地址，不能预览。', false));
  }

  /* 内容域名必须和主站不同源，路径必须是 /c/html_work/<sha256>；其它一概不装进 iframe。 */
  function checkedContentUrl(raw) {
    let url;
    try { url = new URL(String(raw), location.href); } catch (e) { throw liveError('作品地址不对。', false); }
    const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw liveError('作品地址不对。', false);
    if (url.origin === location.origin) throw liveError('作品地址不能和主站同源。', false);
    if (!CONTENT_PATH.test(url.pathname) || url.search || url.hash) throw liveError('作品地址不对。', false);
    return url;
  }

  function oversizeMessage(bytes) {
    return '这份 HTML 有 ' + bytes.toLocaleString('zh-CN') + ' 字节，超过 2MB 上限（' + MAX_BYTES.toLocaleString('zh-CN') + ' 字节）。沙箱拒绝加载。请去掉超大的内联图片或把资源拆出去。';
  }

  /* ---------- render(container, { html, title, device }) ---------- */

  function render(container, options) {
    if (!container) return deadHandle();
    const opts = options || {};
    let html = String(opts.html || '');
    let title = String(opts.title || '未命名 HTML');
    let device = DEVICES[opts.device] ? opts.device : '';
    let fitContent = !device || opts.fit === 'content';
    let token = '';
    let iframe = null;
    let stopListen = null;
    let ro = null;
    let alive = true;
    const live = isLive();
    let liveSeq = 0;
    let loadTimer = null;

    container.replaceChildren();
    container.classList.add('html-frame');
    const stage = document.createElement('div');
    stage.className = 'html-frame-stage';
    const status = document.createElement('p');
    status.className = 'html-frame-status';
    status.setAttribute('role', 'status');
    container.append(stage, status);

    function clampHeight(px) {
      const min = 160;
      const max = Math.round(window.innerHeight * 0.8) || 640;
      return Math.max(min, Math.min(max, Math.round(px)));
    }
    function applyContentHeight(raw) {
      if (!alive || !iframe) return;
      const h = clampHeight(Number(raw) || 160);
      container.dataset.fit = 'content';
      container.removeAttribute('data-device');
      iframe.style.width = '100%';
      iframe.style.height = h + 'px';
      iframe.style.transform = 'none';
      iframe.style.maxHeight = '80vh';
      iframe.style.overflow = 'auto';
      container.style.height = h + 'px';
      container.style.maxHeight = '80vh';
    }
    function applyScale() {
      if (!alive || !iframe) return;
      if (fitContent || !DEVICES[device]) {
        applyContentHeight(parseFloat(iframe.style.height) || 160);
        return;
      }
      const spec = DEVICES[device];
      container.dataset.device = device;
      container.dataset.fit = 'device';
      container.style.setProperty('--html-fw', spec.width + 'px');
      container.style.setProperty('--html-fh', spec.height + 'px');
      const cw = container.clientWidth || spec.width;
      const scale = cw / spec.width;
      iframe.style.width = spec.width + 'px';
      iframe.style.height = spec.height + 'px';
      iframe.style.transform = 'scale(' + scale + ')';
      container.style.height = Math.round(spec.height * scale) + 'px';
      container.style.removeProperty('max-height');
    }

    function showError(message, retry) {
      clearTimeout(loadTimer);
      if (stopListen) { stopListen(); stopListen = null; }
      stage.replaceChildren();
      iframe = null;
      status.textContent = message;
      container.dataset.state = 'error';
      const old = container.querySelector('.html-frame-retry');
      if (old) old.remove();
      if (retry) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'button html-frame-retry';
        btn.textContent = '重试';
        btn.addEventListener('click', () => load());
        container.append(btn);
      }
    }

    function loadLive() {
      clearTimeout(loadTimer);
      if (stopListen) { stopListen(); stopListen = null; }
      const old = container.querySelector('.html-frame-retry');
      if (old) old.remove();
      stage.replaceChildren();
      iframe = null;
      status.textContent = '正在装入作品…';
      container.dataset.state = 'loading';
      const seq = ++liveSeq;
      resolveContentUrl(opts).then(raw => {
        if (!alive || seq !== liveSeq) return;
        const url = checkedContentUrl(raw);
        iframe = makeFrame();
        iframe.title = title;
        iframe.className = 'html-frame-iframe';
        if (fitContent) iframe.style.height = LIVE_DEFAULT_HEIGHT + 'px';
        stopListen = listenLiveFrame(iframe, data => {
          if (data.type === 'height' && fitContent) {
            const h = Number(data.height);
            if (Number.isFinite(h) && h > 0) applyContentHeight(Math.min(h, 20000));
          } else if (data.type === 'error') {
            container.dataset.state = 'error';
            status.textContent = String(data.reason || '作品里的页面报错了。').slice(0, 120);
          }
        });
        iframe.addEventListener('load', () => {
          if (!alive || seq !== liveSeq) return;
          clearTimeout(loadTimer);
          if (container.dataset.state === 'loading') {
            container.dataset.state = 'ready';
            status.textContent = '';
          }
        });
        iframe.src = url.href;
        stage.replaceChildren(iframe);
        applyScale();
        loadTimer = setTimeout(() => {
          if (alive && seq === liveSeq && container.dataset.state === 'loading') showError('作品加载超时。', true);
        }, LIVE_LOAD_MS);
      }).catch(err => {
        if (!alive || seq !== liveSeq) return;
        showError(err && err.message ? err.message : '作品没有加载出来。', !err || err.retry !== false);
      });
    }

    function load() {
      if (!alive) return;
      if (live) { loadLive(); return; }
      const bytes = byteLength(html);
      if (bytes > MAX_BYTES) {
        showError(oversizeMessage(bytes));
        return;
      }
      if (stopListen) { stopListen(); stopListen = null; }
      token = randomToken();
      iframe = makeFrame();
      iframe.title = title;
      iframe.className = 'html-frame-iframe';
      status.textContent = '正在装入沙箱…';
      container.dataset.state = 'loading';
      stopListen = listenFrame(iframe, token, data => {
        if (data.type === 'ready') {
          container.dataset.state = 'ready';
          status.textContent = '';
          if (fitContent) {
            try {
              const doc = iframe.contentDocument;
              if (doc && doc.documentElement) applyContentHeight(doc.documentElement.scrollHeight);
            } catch (e) { /* 跨源：等 height 消息 */ }
          }
        } else if (data.type === 'height' && fitContent) {
          applyContentHeight(data.height);
        } else if (data.type === 'error') {
          container.dataset.state = 'error';
          status.textContent = data.reason || '沙箱里的页面报错了。';
        }
      });
      iframe.srcdoc = wrapSrcdoc(html, { tail: readyScript(token), fill: !fitContent });
      stage.replaceChildren(iframe);
      applyScale();
    }

    ro = new ResizeObserver(() => applyScale());
    ro.observe(container);
    load();

    return {
      setDevice(name) {
        if (!DEVICES[name] || name === device) return;
        device = name;
        fitContent = false;
        applyScale();
      },
      reload() { load(); },
      destroy() {
        alive = false;
        clearTimeout(loadTimer);
        if (stopListen) stopListen();
        if (ro) ro.disconnect();
        stopListen = null;
        ro = null;
        iframe = null;
        container.replaceChildren();
        container.classList.remove('html-frame');
        container.removeAttribute('data-state');
        container.removeAttribute('data-device');
        container.removeAttribute('data-fit');
        container.style.removeProperty('--html-fw');
        container.style.removeProperty('--html-fh');
        container.style.removeProperty('height');
        container.style.removeProperty('max-height');
      }
    };
  }

  /* ---------- 缩略图 ---------- */

  function placeholderDataURL(title, width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const paper = token('--sunk');
    const ink = token('--ink');
    const muted = token('--muted');
    const cats = [];
    for (let i = 1; i <= 10; i += 1) {
      const c = token('--cat-' + i);
      if (c) cats.push(c);
    }
    let hash = 0;
    const name = String(title || '未命名作品');
    for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) | 0;
    const main = cats[Math.abs(hash) % (cats.length || 1)] || token('--accent');
    if (paper) { ctx.fillStyle = paper; ctx.fillRect(0, 0, width, height); }
    if (main) { ctx.fillStyle = main; ctx.fillRect(0, 0, Math.max(8, Math.round(width * 0.012)), height); }
    const pad = Math.round(width * 0.06);
    if (ink) {
      ctx.fillStyle = ink;
      ctx.font = '600 ' + Math.round(width * 0.042) + 'px ' + (token('--display') || token('--sans') || 'sans-serif');
      ctx.fillText(name.slice(0, 22), pad, height * 0.48);
    }
    if (muted) {
      ctx.fillStyle = muted;
      ctx.font = '500 ' + Math.round(width * 0.024) + 'px ' + (token('--sans') || 'sans-serif');
      ctx.fillText('未能截图 · 示例', pad, height * 0.48 + Math.round(width * 0.048));
    }
    return canvas.toDataURL('image/png');
  }

  function ensureHtmlToImage() {
    if (window.__COMMONS_HTML_TO_IMAGE_SRC) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-html-to-image-src]');
      if (existing) {
        existing.addEventListener('load', () => window.__COMMONS_HTML_TO_IMAGE_SRC ? resolve() : reject(new Error('html-to-image 加载后没有源码字符串。')));
        existing.addEventListener('error', () => reject(new Error('html-to-image 脚本加载失败。')));
        return;
      }
      const script = document.createElement('script');
      script.src = VENDOR_SRC;
      script.setAttribute('data-html-to-image-src', '1');
      script.onload = () => window.__COMMONS_HTML_TO_IMAGE_SRC ? resolve() : reject(new Error('html-to-image 加载后没有源码字符串。'));
      script.onerror = () => reject(new Error('html-to-image 脚本加载失败。请确认 preview/vendor/html-to-image.src.js 已被主控接入。'));
      document.head.appendChild(script);
    });
  }

  const pendingThumbs = new Set();

  function thumbnail(html, options) {
    const opts = options || {};
    const width = Number(opts.width) > 0 ? Math.round(opts.width) : 1200;
    const height = Number(opts.height) > 0 ? Math.round(opts.height) : 750;
    const title = String(opts.title || '未命名作品');
    const source = String(html ?? '');
    if (isLive()) return Promise.reject(new Error('线上作品的缩略图由作者上传，这里不截图。'));
    return new Promise((resolve, reject) => {
      const bytes = byteLength(source);
      if (bytes > MAX_BYTES) {
        reject(new Error(oversizeMessage(bytes)));
        return;
      }
      ensureHtmlToImage().then(() => {
        const token = randomToken();
        const iframe = makeFrame();
        iframe.className = 'html-thumb-iframe';
        iframe.setAttribute('aria-hidden', 'true');
        iframe.tabIndex = -1;
        iframe.style.cssText = 'position:fixed;left:0;top:0;width:' + width + 'px;height:' + height + 'px;opacity:0;pointer-events:none;';
        let settled = false;
        let stop = null;
        const timer = setTimeout(() => finish(null, new Error('缩略图超时（8 秒）。')), THUMB_MS);
        function cleanup() {
          clearTimeout(timer);
          if (stop) stop();
          if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
          pendingThumbs.delete(cleanup);
        }
        function finish(url, err) {
          if (settled) return;
          settled = true;
          cleanup();
          if (err) reject(err);
          else resolve(url);
        }
        pendingThumbs.add(cleanup);
        stop = listenFrame(iframe, token, data => {
          if (data.type === 'thumbnail' && typeof data.dataUrl === 'string' && data.dataUrl.indexOf('data:image/png') === 0) {
            finish(data.dataUrl);
          } else if (data.type === 'capture-fail' || data.type === 'error') {
            finish(placeholderDataURL(title, width, height));
          }
        });
        iframe.srcdoc = wrapSrcdoc(source, { tail: captureScripts(token, width, height) });
        document.body.appendChild(iframe);
      }).catch(reject);
    });
  }

  /* 示例 HTML 与作者目录在 html-render-sample.js（仅演示包）。 */
  const SAMPLES = (window.COMMONS_HTML_RENDER_SAMPLE && window.COMMONS_HTML_RENDER_SAMPLE.samples) || [];

  /* ---------- 演示页 ---------- */

  const lab = {
    root: null,
    view: null,
    sampleId: '',
    html: '',
    title: '',
    author: '',
    handle: '',
    device: 'desktop',
    findings: [],
    thumb: '',
    thumbNote: '',
    thumbBusy: false,
    pasteOpen: false,
    unbind: [],
    full: false
  };

  function sampleById(id) {
    return SAMPLES.find(s => s.id === id) || SAMPLES[0];
  }

  function summaryBadges(findings) {
    const n = { block: 0, warn: 0, info: 0 };
    findings.forEach(f => { n[f.level] += 1; });
    const parts = [];
    if (n.block) parts.push(`<span class="pill danger">${esc(String(n.block))} 项拦截</span>`);
    if (n.warn) parts.push(`<span class="pill notice">${esc(String(n.warn))} 项提醒</span>`);
    if (n.info) parts.push(`<span class="pill info">${esc(String(n.info))} 项说明</span>`);
    if (!parts.length) parts.push('<span class="pill success">未发现需处理的写法</span>');
    return parts.join('');
  }

  function findingsHTML(findings) {
    if (!findings.length) {
      return `<div class="html-find-empty" data-state="empty">${stateIcon('verified', 16)}<p>没有发现需要处理的写法。</p></div>`;
    }
    return `<ol class="html-find-list">${findings.map(f =>
      `<li class="html-find" data-level="${esc(f.level)}">` +
        `<span class="html-find-ico">${stateIcon(LEVEL_ICON[f.level], 16)}</span>` +
        `<div><b>${esc(LEVEL_LABEL[f.level])} · ${esc(f.code)}</b><p>${esc(f.message)}</p></div>` +
        `<span class="html-find-line">L${esc(String(f.line))}</span>` +
      `</li>`
    ).join('')}</ol>`;
  }

  function thumbHTML() {
    if (lab.thumbBusy) {
      return `<div class="html-thumb" data-state="loading"><span class="html-thumb-skel" aria-hidden="true"></span><p>正在生成缩略图…</p></div>`;
    }
    if (lab.thumb) {
      const failed = lab.thumbNote === 'failed';
      return `<div class="html-thumb" data-state="${failed ? 'fallback' : 'ready'}"><img alt="${esc(lab.title)} 的缩略图" src="${window.Commons.safeUrl(lab.thumb)}">${failed ? '<span class="html-thumb-flag">未能截图</span>' : ''}</div>`;
    }
    return `<div class="html-thumb" data-state="empty"><p>还没生成。点下面的按钮，在隐藏沙箱里截一帧。</p></div>`;
  }

  function workCardHTML() {
    const img = lab.thumb
      ? `<img alt="" src="${window.Commons.safeUrl(lab.thumb)}">`
      : `<span class="html-work-ph" aria-hidden="true"></span>`;
    return `<article class="html-work">
      <div class="html-work-art">${img}${lab.thumbNote === 'failed' ? '<span class="html-thumb-flag">未能截图</span>' : ''}</div>
      <div class="html-work-copy">
        <p class="html-work-kicker">${isLive() ? 'HTML 作品' : '示例 · HTML 作品'}</p>
        <h3>${esc(lab.title)}</h3>
        <p class="html-work-by">${/* safe: personLink 自行转义 */ personLink(lab.handle, lab.author)} · 合成身份</p>
        <div class="html-work-badges">${summaryBadges(lab.findings)}</div>
      </div>
    </article>`;
  }

  function pageHTML() {
    const items = SAMPLES.map(s => {
      const on = s.id === lab.sampleId;
      return `<button type="button" class="html-sample" data-html-act="sample" data-id="${esc(s.id)}" aria-pressed="${on}">` +
        `<b>${esc(s.title)}</b><small>${esc(s.kind)} · ${esc(s.author)}</small></button>`;
    }).join('');
    const segs = Object.keys(DEVICES).map(id =>
      `<button type="button" data-html-act="device" data-id="${id}" aria-pressed="${lab.device === id}">${esc(DEVICES[id].label)}</button>`
    ).join('');
    return `<div class="html-lab" data-html-lab>
      <header class="html-lab-head">
        <div>
          <h1>HTML 沙箱</h1>
          <p>群友的作品经常是一个 HTML 文件。先在沙箱里跑，查出危险写法，再决定要不要上作品页。</p>
        </div>
        ${isLive() ? '' : '<span class="pill">示例</span>'}
      </header>
      <div class="html-lab-grid">
        <aside class="html-lab-col" aria-label="来源">
          <h2>从哪里来</h2>
          <div class="html-sample-list" role="list">${items}</div>
          <div class="html-source-actions">
            <button type="button" class="button" data-html-act="paste-toggle">${ico(GLYPH.paste)} 粘贴 HTML</button>
            <button type="button" class="button" data-html-act="pick">${ico(GLYPH.file)} 选择文件</button>
            <input type="file" accept=".html,.htm,text/html" hidden data-html-file>
          </div>
          <form class="html-paste field" data-html-paste ${lab.pasteOpen ? '' : 'hidden'}>
            <label for="html-paste-text">粘贴完整 HTML</label>
            <textarea id="html-paste-text" name="html" rows="8" placeholder="<!doctype html>…"></textarea>
            <small>不超过 2MB。只在本机沙箱里跑，不会发给外部模型。</small>
            <div class="html-paste-actions">
              <button type="submit" class="button primary">渲染这段</button>
              <button type="button" class="button ghost" data-html-act="paste-cancel">取消</button>
            </div>
          </form>
        </aside>
        <section class="html-lab-col html-lab-main" aria-label="渲染">
          <div class="html-stage-bar">
            <div class="segmented" role="group" aria-label="设备">${segs}</div>
            <div class="html-stage-tools">
              <button type="button" class="button ghost icon-only" data-html-act="reload" aria-label="重新加载">${ico(GLYPH.reload)}</button>
              <button type="button" class="button ghost icon-only" data-html-act="fullscreen" aria-label="${lab.full ? '退出全屏' : '全屏'}">${ico(lab.full ? GLYPH.exit : GLYPH.full)}</button>
            </div>
          </div>
          <div class="html-stage-host" data-html-stage></div>
        </section>
        <aside class="html-lab-col" aria-label="检查与缩略图">
          <h2>检查结果</h2>
          <div data-html-findings>${findingsHTML(lab.findings)}</div>
          <h2>缩略图</h2>
          <div data-html-thumb>${thumbHTML()}</div>
          <button type="button" class="button primary" data-html-act="thumb" ${lab.thumbBusy ? 'aria-busy="true"' : ''}>
            <span class="button-spinner" aria-hidden="true"></span>
            ${lab.thumbBusy ? '生成中' : '生成缩略图'}
          </button>
          <p class="html-thumb-error" data-html-thumb-error hidden></p>
        </aside>
      </div>
      <section class="html-lab-card" aria-label="作品卡样例">
        <div class="html-lab-card-head">
          <h2>作品卡</h2>
          <p>以后作品页会用的样子。缩略图、标题、作者、检查结论放在同一张卡上。</p>
        </div>
        <div data-html-card>${workCardHTML()}</div>
      </section>
    </div>`;
  }

  function syncChrome() {
    const root = lab.root;
    if (!root) return;
    root.querySelectorAll('[data-html-act="sample"]').forEach(btn => {
      btn.setAttribute('aria-pressed', String(btn.dataset.id === lab.sampleId));
    });
    root.querySelectorAll('[data-html-act="device"]').forEach(btn => {
      btn.setAttribute('aria-pressed', String(btn.dataset.id === lab.device));
    });
    const paste = root.querySelector('[data-html-paste]');
    if (paste) paste.hidden = !lab.pasteOpen;
    const findings = root.querySelector('[data-html-findings]');
    if (findings) findings.innerHTML = findingsHTML(lab.findings);
    const thumb = root.querySelector('[data-html-thumb]');
    if (thumb) thumb.innerHTML = thumbHTML();
    const card = root.querySelector('[data-html-card]');
    if (card) card.innerHTML = workCardHTML();
    const go = root.querySelector('[data-html-act="thumb"]');
    if (go) {
      go.setAttribute('aria-busy', String(!!lab.thumbBusy));
      go.innerHTML = '<span class="button-spinner" aria-hidden="true"></span>' + (lab.thumbBusy ? '生成中' : '生成缩略图');
    }
    const full = root.querySelector('[data-html-act="fullscreen"]');
    if (full) {
      full.setAttribute('aria-label', lab.full ? '退出全屏' : '全屏');
      full.innerHTML = ico(lab.full ? GLYPH.exit : GLYPH.full);
    }
  }

  function revealStage() {
    if (!lab.root) return;
    if (!(window.matchMedia && window.matchMedia('(max-width: 760px)').matches)) return;
    const host = lab.root.querySelector('.html-lab-main') || lab.root.querySelector('[data-html-stage]');
    if (!host) return;
    host.scrollIntoView({
      block: 'start',
      inline: 'nearest',
      behavior: reduceMotion() ? 'auto' : 'smooth'
    });
  }

  function applySource(html, title, author, sampleId, opts) {
    lab.html = html;
    lab.title = title;
    lab.author = author || '未署名';
    const sample = sampleById(sampleId);
    lab.handle = (sample && sample.id === sampleId && sample.handle) || '';
    lab.sampleId = sampleId || '';
    lab.thumb = '';
    lab.thumbNote = '';
    lab.findings = inspect(html);
    const host = lab.root && lab.root.querySelector('[data-html-stage]');
    if (lab.view) { lab.view.destroy(); lab.view = null; }
    if (host) lab.view = render(host, { html: lab.html, title: lab.title, device: lab.device });
    syncChrome();
    if (opts && opts.reveal) revealStage();
  }

  function showThumbError(message, retry) {
    const box = lab.root && lab.root.querySelector('[data-html-thumb-error]');
    if (!box) return;
    box.hidden = !message;
    box.replaceChildren();
    if (!message) return;
    const p = document.createElement('p');
    p.textContent = message;
    box.appendChild(p);
    if (retry) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'button';
      btn.textContent = '重试';
      btn.addEventListener('click', () => generateThumb());
      box.appendChild(btn);
    }
  }

  function generateThumb() {
    if (lab.thumbBusy) return;
    lab.thumbBusy = true;
    showThumbError('');
    syncChrome();
    thumbnail(lab.html, { width: 1200, height: 750, title: lab.title }).then(url => {
      lab.thumbBusy = false;
      lab.thumb = url;
      lab.thumbNote = url === placeholderDataURL(lab.title, 1200, 750) ? 'failed' : '';
      syncChrome();
    }).catch(err => {
      lab.thumbBusy = false;
      lab.thumb = placeholderDataURL(lab.title, 1200, 750);
      lab.thumbNote = 'failed';
      syncChrome();
      showThumbError(err && err.message ? err.message : '缩略图没有生成。', true);
    });
  }

  function onPasteSubmit(event) {
    event.preventDefault();
    const area = event.currentTarget.querySelector('textarea');
    const html = area ? area.value : '';
    const bytes = byteLength(html);
    if (!html.trim()) return;
    if (bytes > MAX_BYTES) {
      showThumbError(oversizeMessage(bytes), false);
      return;
    }
    lab.pasteOpen = false;
    applySource(html, '粘贴的 HTML', '我', 'paste', { reveal: true });
  }

  function onPickFile(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_BYTES) {
      showThumbError(oversizeMessage(file.size), false);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      if (byteLength(text) > MAX_BYTES) {
        showThumbError(oversizeMessage(byteLength(text)), false);
        return;
      }
      const name = file.name.replace(/\.(html?|HTML?)$/, '');
      applySource(text, name || '本地 HTML', '我', 'file', { reveal: true });
    };
    reader.onerror = () => showThumbError('这个文件读不出来。', false);
    reader.readAsText(file);
  }

  function onClick(event) {
    const btn = event.target.closest('[data-html-act]');
    if (!btn || !lab.root.contains(btn)) return;
    const act = btn.dataset.htmlAct;
    if (act === 'sample') {
      const sample = sampleById(btn.dataset.id);
      applySource(sample.html, sample.title, sample.author, sample.id, { reveal: true });
    } else if (act === 'device') {
      lab.device = DEVICES[btn.dataset.id] ? btn.dataset.id : lab.device;
      if (lab.view) lab.view.setDevice(lab.device);
      syncChrome();
    } else if (act === 'reload') {
      if (lab.view) lab.view.reload();
    } else if (act === 'fullscreen') {
      toggleFullscreen();
    } else if (act === 'thumb') {
      generateThumb();
    } else if (act === 'paste-toggle') {
      lab.pasteOpen = !lab.pasteOpen;
      syncChrome();
      if (lab.pasteOpen) lab.root.querySelector('#html-paste-text')?.focus();
    } else if (act === 'paste-cancel') {
      lab.pasteOpen = false;
      syncChrome();
    } else if (act === 'pick') {
      lab.root.querySelector('[data-html-file]')?.click();
    }
  }

  function toggleFullscreen() {
    const host = lab.root && lab.root.querySelector('[data-html-stage]');
    if (!host) return;
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
      return;
    }
    host.requestFullscreen?.().catch(() => {});
  }

  function onFullscreen() {
    lab.full = document.fullscreenElement === (lab.root && lab.root.querySelector('[data-html-stage]'));
    syncChrome();
  }

  function on() {
    const args = arguments;
    const target = args[0];
    const type = args[1];
    const fn = args[2];
    const opts = args[3];
    target.addEventListener(type, fn, opts);
    lab.unbind.push(() => target.removeEventListener(type, fn, opts));
  }

  function emptyLabHTML() {
    return `<div class="html-lab" data-html-lab-empty>
      <header class="html-lab-head"><div><h1>HTML 作品</h1></div></header>
      <div class="html-find-empty" data-state="empty">${stateIcon('source', 16)}<p>作品在作品页里预览，这里没有可看的内容。</p><a class="button" href="#/people">去作品与同行</a></div>
    </div>`;
  }

  function labView() {
    const first = isLive() ? null : sampleById('board');
    if (!first) return emptyLabHTML();
    lab.sampleId = first.id;
    lab.html = first.html;
    lab.title = first.title;
    lab.author = first.author;
    lab.device = 'desktop';
    lab.findings = inspect(first.html);
    lab.thumb = '';
    lab.thumbNote = '';
    lab.thumbBusy = false;
    lab.pasteOpen = false;
    lab.full = false;
    return pageHTML();
  }

  function mount() {
    const root = document.querySelector('[data-html-lab]');
    if (!root) return;
    destroy();
    lab.root = root;
    applySource(lab.html, lab.title, lab.author, lab.sampleId);
    on(root, 'click', onClick);
    const form = root.querySelector('[data-html-paste]');
    if (form) on(form, 'submit', onPasteSubmit);
    const file = root.querySelector('[data-html-file]');
    if (file) on(file, 'change', onPickFile);
    on(document, 'fullscreenchange', onFullscreen);
  }

  function destroy() {
    pendingThumbs.forEach(fn => fn());
    pendingThumbs.clear();
    lab.unbind.forEach(fn => fn());
    lab.unbind = [];
    if (lab.view) lab.view.destroy();
    lab.view = null;
    if (document.fullscreenElement && lab.root && lab.root.contains(document.fullscreenElement)) {
      document.exitFullscreen?.();
    }
    lab.root = null;
    lab.thumbBusy = false;
  }

  if (window.CommonsLinks && typeof window.CommonsLinks.provide === 'function') {
    window.CommonsLinks.provide('work', function (handle) {
      const key = String(handle || '').replace(/^@+/, '').toLowerCase();
      const n = SAMPLES.filter(s => String(s.handle || '').toLowerCase() === key).length;
      if (!n) return null;
      return { label: 'HTML 作品', href: '#/html-lab', count: n, icon: 'project' };
    });
  }

  window.CommonsHTML = {
    routes: { 'html-lab': labView },
    mount: mount,
    destroy: destroy,
    render: render,
    thumbnail: thumbnail,
    inspect: inspect
  };
})();
