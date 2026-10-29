/* R13 EDT-1 · 编辑器 window.CommonsEditor（Tiptap）+ 演示页 #/write、#/read/<id>
   - CommonsEditor.mount(container, { id, doc, title, kind, visibility, aigc, onChange, onSave }) → 实例
   - CommonsEditor.schema()：允许的节点和标记表，给 BE-1 做服务端白名单（与编辑器 schema 一一对应）
   - Tiptap 由 vendor/tiptap.min.js 提供（全局 Tiptap）；没加载时按需插入，失败显示出错态加「重试」
   - 演示页模块自行登记到 window.CommonsPages；点击只用 data-edt-act
   依赖：reader.js（CommonsReader：转义、可见范围文案、表情表、语言表）、share.js（CommonsShare）。 */
(function () {
  'use strict';
  var G = window;
  var SCRIPT = document.currentScript && document.currentScript.src ? document.currentScript.src : '';
  var BASE = SCRIPT ? SCRIPT.replace(/[^/]*$/, '') : '';
  var TIPTAP_SRC = BASE + 'vendor/tiptap.min.js';
  var HTML_MAX = 2 * 1024 * 1024;
  var IMAGE_MAX = 10 * 1024 * 1024;
  var KINDS = {
    knowledge: '知识条目', discussion: '讨论', work: '作品说明', reply: '回复',
    skill: 'Skill', prompt: '提示词', component_lib: '组件库', pattern: '产品形态', agent_card: '接入名片'
  };
  var WRITE_TYPES = [
    ['discussion', '讨论'],
    ['knowledge', '知识条目'],
    ['work', '作品说明'],
    ['skill', 'Skill'],
    ['prompt', '提示词'],
    ['component_lib', '组件库'],
    ['pattern', '产品形态'],
    ['agent_card', '接入名片']
  ];
  var PLACEHOLDER = {
    knowledge: '写下问题、做法和边界。输入 / 插入块',
    discussion: '说说你的想法。输入 / 插入块',
    work: '介绍这件作品：做什么、怎么做、怎么复现。输入 / 插入块',
    reply: '写回复… 输入 @ 提及成员'
  };

  function R() { return G.CommonsReader || null; }
  function esc(v) { return R() ? R().esc(v) : String(v == null ? '' : v).replace(/[&<>"'`]/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  /* safe-fn: CommonsLinks.person / CommonsReader.personLink 自行转义；退路对名字 esc */
  function personLink(handle, name, level) {
    if (R() && typeof R().personLink === 'function') return R().personLink(handle, name, level);
    if (G.CommonsLinks && typeof G.CommonsLinks.person === 'function') return G.CommonsLinks.person(handle, name, { level: level });
    return handle ? '<a class="lk-person" href="#/u/' + encodeURIComponent(handle) + '">' + esc(name) + '</a>' : esc(name);
  }
  function memberOf(id) {
    for (var i = 0; i < MEMBERS.length; i++) if (MEMBERS[i].id === id) return MEMBERS[i];
    return null;
  }
  function toast(m) { if (G.Commons && typeof G.Commons.toast === 'function') G.Commons.toast(m); }
  function reduced() { return !!(G.matchMedia && G.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function uid(p) { return p + Math.random().toString(36).slice(2, 9); }

  var mem = {};
  var store = {
    read: function (k, f) { if (G.Commons && typeof G.Commons.read === 'function') return G.Commons.read(k, f); return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : f; },
    write: function (k, v) { if (G.Commons && typeof G.Commons.write === 'function') return G.Commons.write(k, v); mem[k] = v; return true; }
  };

  /* ---------- 图标 ---------- */
  var P = {
    text: 'M5 6h14M5 12h14M5 18h9',
    h2: 'M4 6v12M12 6v12M4 12h8M15.5 10.5a2.5 2.5 0 0 1 5 0c0 2.4-5 3.6-5 7.5h5',
    h3: 'M4 6v12M12 6v12M4 12h8M15.5 8.5a2.5 2.5 0 1 1 2.5 3 2.5 2.5 0 1 1-2.5 3',
    ul: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
    ol: 'M10 6h10M10 12h10M10 18h10M4 5h1.5v4M4 9h3M4 15.5a1.5 1.5 0 1 1 2.6 1L4 19h3',
    quote: 'M6 17c2 0 3-1.5 3-3.5V8H4v5h3M15 17c2 0 3-1.5 3-3.5V8h-5v5h3',
    code: 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16',
    hr: 'M3 12h18',
    image: 'M4 5h16v14H4zM4 15l4.5-4.5 4 4 2.5-2.5L20 17M15.5 9.5h.01',
    card: 'M4 6h16v12H4zM8 10h8M8 14h5',
    html: 'M4 4h16v16H4zM4 9h16M9 13l-2 2 2 2M15 13l2 2-2 2',
    emoji: 'M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18',
    at: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1',
    bold: 'M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z',
    italic: 'M10 5h8M6 19h8M14 5l-4 14',
    icode: 'M9 8l-4 4 4 4M15 8l4 4-4 4',
    link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
    unlink: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1M4 4l16 16',
    mark: 'M9 15l-4 4h6l1-1M9 15l8-8 3 3-8 8M9 15l3 3',
    upload: 'M12 16V4M7 9l5-5 5 5M4 16v4h16v-4',
    check: 'M4 12l5 5L20 6',
    close: 'M6 6l12 12M18 6 6 18',
    eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    lock: 'M6 11h12v10H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
    spark: 'm12 3 1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6-5.6-1.9 5.6-1.9z',
    read: 'M12 6c-3-2-7-2-9-1v14c2-1 6-1 9 1 3-2 7-2 9-1V5c-2-1-6-1-9 1zM12 6v14',
    search: 'M20 20l-4-4M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0',
    warn: 'M12 8v5M12 16.5h.01M12 3 2.5 20h19z',
    pen: 'm15 4 5 5M4 20l5-1L21 7l-5-5L4 14Z'
  };
  function ico(name, size) {
    var s = size || 16;
    return '<svg viewBox="0 0 24 24" width="' + Number(s) + '" height="' + Number(s) + '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + (P[name] || P.spark) + '"/></svg>';
  }

  // Only explicit demo mode may read sample globals or local published examples.
  function isLive() { return !(location.protocol === 'file:' || (window.COMMONS_BUILD && window.COMMONS_BUILD.mode === 'demo')); }
  function snapLiveScope(v) {
    if (isLive() && v && (v.scope === 'private' || v.scope === 'people' || v.scope === 'space')) v.scope = 'members';
    return v;
  }
  function canDo(action) {
    var S = G.CommonsSession;
    if (!S || typeof S.can !== 'function') return true;
    return !!S.can(action);
  }
  // /api/me.capability_reasons 给的原因；没有就返回空串，调用方退回原来的说法。
  function whyNot(action) {
    var S = G.CommonsSession;
    return S && typeof S.reason === 'function' ? S.reason(action) : '';
  }
  function defaultWriteKind() {
    var i, id;
    for (i = 0; i < WRITE_TYPES.length; i++) {
      id = WRITE_TYPES[i][0];
      if (canDo('object.create.' + id)) return id;
    }
    return WRITE_TYPES[0][0];
  }
  function writeTypeBar() {
    var current = page.writeKind || defaultWriteKind();
    page.writeKind = current;
    var blocked = false;
    var reasons = [];
    var chips = WRITE_TYPES.map(function (row) {
      var id = row[0], label = row[1];
      var allowed = canDo('object.create.' + id);
      var why = allowed ? '' : whyNot('object.create.' + id);
      if (!allowed) blocked = true;
      if (why) reasons.push(label + '：' + why);
      return '<button type="button" class="chip" data-edt-act="write-kind" data-kind="' + esc(id) + '"' +
        (current === id ? ' aria-pressed="true"' : '') +
        (allowed ? '' : ' disabled') + (why ? ' title="' + esc(why) + '"' : '') + '>' + esc(label) + '</button>';
    }).join('');
    var note = blocked
      ? '<p class="edt-gate" role="note" data-edt-locked>' + (reasons.length
        ? esc(reasons.join('；')) + (reasons.some(function (r) { return /需要 L/.test(r); }) ? '，<a href="#/growth">看看怎么升级</a>' : '')
        : '你现在的等级还不能发这种内容，<a href="#/growth">看看怎么升级</a>') + '</p>'
      : '';
    return '<div class="edt-kinds" role="group" aria-label="投稿类型">' + chips + '</div>' + note;
  }
  function sample() { return isLive() ? {} : (G.COMMONS_EDITOR_SAMPLE || {}); }
  var MEMBERS = sample().members || [];
  var SPACES = sample().spaces || [];
  var LEVEL_COUNT = sample().levelCount || {};
  var works = Object.assign({}, sample().works || {});
  var DEMO_ID = sample().id || '';
  var DEMO_TITLE = sample().title || '';
  var DEMO_LEAD = sample().summary || '';
  var DEMO_AUTHOR = sample().author || {};
  function demoDoc() { return sample().doc ? sample().doc() : { type: 'doc', content: [{ type: 'paragraph' }] }; }
  function demoImage() { return sample().image ? sample().image() : ''; }
  function units() {
    if (isLive()) return [];
    var K = G.COMMONS_KNOWLEDGE;
    return K && Array.isArray(K.units) && K.units.length ? K.units : (sample().units || []);
  }
  function findUnit(id) { return units().find(function (u) { return u.id === id; }) || null; }
  function cardForAuthor(id) { return (sample().spaceCards || {})[id] || findUnit(id); }
  function cardForReader(id) { return findUnit(id); }
  function getWork(id) {
    if (isLive()) return null;
    if (works[id]) return works[id];
    var w = store.read('editor.htmlwork.' + id, null);
    if (w && typeof w.html === 'string') { works[id] = w; return w; }
    return null;
  }
  function putWork(id, w) { works[id] = w; return store.write('editor.htmlwork.' + id, w); }
  function bytesOf(s) { return typeof TextEncoder === 'function' ? new TextEncoder().encode(s).length : s.length * 3; }


  /* ---------- Tiptap 加载 ---------- */
  var loading = null;
  function needTiptap() {
    if (G.Tiptap && G.Tiptap.Editor) return Promise.resolve(G.Tiptap);
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = TIPTAP_SRC;
      s.async = true;
      s.onload = function () { if (G.Tiptap && G.Tiptap.Editor) resolve(G.Tiptap); else { s.remove(); loading = null; reject(new Error('global')); } };
      s.onerror = function () { s.remove(); loading = null; reject(new Error('load')); };
      document.head.appendChild(s);
    });
    return loading;
  }

  var KIT_KEYS = ['blockquote', 'bold', 'bulletList', 'code', 'codeBlock', 'document', 'dropcursor', 'gapcursor', 'hardBreak', 'heading', 'undoRedo', 'horizontalRule', 'italic', 'listItem', 'listKeymap', 'link', 'orderedList', 'paragraph', 'strike', 'text', 'underline', 'trailingNode'];
  /* StarterKit 没单独导出 CodeBlock：从它的 addExtensions 里取出同一个扩展，再 extend 加语言栏 */
  function kitPart(T, key) {
    try {
      var o = {};
      KIT_KEYS.forEach(function (k) { o[k] = false; });
      o[key] = {};
      var list = T.StarterKit.config.addExtensions.call({ name: 'starterKit', options: o, storage: {}, parent: undefined });
      for (var i = 0; i < list.length; i++) if (list[i] && list[i].name === key) return list[i];
    } catch (e) { /* 退回 StarterKit 自带的代码块 */ }
    return null;
  }

  function langOf(v) { var ok = (R() ? R().langs : []).some(function (l) { return l.id === v; }); return ok ? v : 'text'; }

  function buildExtensions(T, inst) {
    var exts = [];
    var CodeBlock = kitPart(T, 'codeBlock');
    exts.push(T.StarterKit.configure({
      heading: { levels: [2, 3] },
      strike: false,
      underline: false,
      codeBlock: CodeBlock ? false : { defaultLanguage: 'text' },
      dropcursor: { color: false, width: 2, class: 'edt-dropcursor' },
      link: false
    }));
    var LinkMark = kitPart(T, 'link');
    if (LinkMark) {
      exts.push(LinkMark.extend({
        renderHTML: function (p) {
          var href = (p.HTMLAttributes && p.HTMLAttributes.href) || '';
          var site = R() && R().safeHash ? R().safeHash(href) : '';
          if (site) {
            var title = R().siteTitle ? R().siteTitle(R().parseHash(site), href) : href;
            return ['a', T.mergeAttributes({ class: 'edt-site-card', href: site }, p.HTMLAttributes), title];
          }
          return ['a', T.mergeAttributes({ rel: 'noopener nofollow ugc', target: '_blank' }, p.HTMLAttributes), 0];
        }
      }).configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: 'https',
        HTMLAttributes: { rel: 'noopener nofollow ugc', target: '_blank', class: null },
        isAllowedUri: function (url) { return !!(R() && (R().safeHref ? R().safeHref(url) : R().safeLink(url))); }
      }));
    }
    if (CodeBlock) {
      exts.push(CodeBlock.configure({ defaultLanguage: 'text', enableTabIndentation: true }).extend({
        addNodeView: function () { return codeView; }
      }));
    }
    exts.push(T.Placeholder.configure({
      placeholder: function (p) { return p.node.type.name === 'heading' ? '小标题' : (PLACEHOLDER[inst.kind] || PLACEHOLDER.knowledge); }
    }));
    exts.push(T.Mark.create({
      name: 'highlight',
      parseHTML: function () { return [{ tag: 'mark' }]; },
      renderHTML: function (p) { return ['mark', p.HTMLAttributes, 0]; },
      addKeyboardShortcuts: function () { var self = this; return { 'Mod-Shift-h': function () { return self.editor.commands.toggleMark(self.name); } }; }
    }));
    exts.push(T.Image.configure({ inline: false, allowBase64: true }).extend({
      addAttributes: function () {
        var base = this.parent ? this.parent() : {};
        return Object.assign({}, base, {
          caption: { default: '', parseHTML: function (el) { return el.getAttribute('data-caption') || ''; }, renderHTML: function (a) { return a.caption ? { 'data-caption': a.caption } : {}; } }
        });
      },
      addNodeView: function () { return function (props) { return imageView(props, inst); }; }
    }));
    exts.push(T.Node.create({
      name: 'knowledgeCard', group: 'block', atom: true, selectable: true, draggable: true,
      addAttributes: function () { return { refId: { default: '', parseHTML: function (el) { return el.getAttribute('data-ref') || ''; }, renderHTML: function (a) { return { 'data-ref': a.refId }; } } }; },
      parseHTML: function () { return [{ tag: 'div[data-knowledge-card]' }]; },
      renderHTML: function (p) { return ['div', T.mergeAttributes({ 'data-knowledge-card': '' }, p.HTMLAttributes)]; },
      addNodeView: function () { return cardView; }
    }));
    exts.push(T.Node.create({
      name: 'htmlWork', group: 'block', atom: true, selectable: true, draggable: true,
      addAttributes: function () {
        return {
          workId: { default: '', parseHTML: function (el) { return el.getAttribute('data-work') || ''; }, renderHTML: function (a) { return { 'data-work': a.workId }; } },
          title: { default: '', parseHTML: function (el) { return el.getAttribute('data-title') || ''; }, renderHTML: function (a) { return { 'data-title': a.title }; } },
          bytes: { default: 0, parseHTML: function (el) { return Number(el.getAttribute('data-bytes')) || 0; }, renderHTML: function (a) { return { 'data-bytes': String(a.bytes) }; } }
        };
      },
      parseHTML: function () { return [{ tag: 'div[data-html-work]' }]; },
      renderHTML: function (p) { return ['div', T.mergeAttributes({ 'data-html-work': '' }, p.HTMLAttributes)]; },
      addNodeView: function () { return workView; }
    }));
    exts.push(T.Node.create({
      name: 'emoji', group: 'inline', inline: true, atom: true, selectable: true,
      addAttributes: function () { return { name: { default: 'up', parseHTML: function (el) { return el.getAttribute('data-emoji') || 'up'; }, renderHTML: function (a) { return { 'data-emoji': a.name }; } } }; },
      parseHTML: function () { return [{ tag: 'span[data-emoji]' }]; },
      renderHTML: function (p) { return ['span', T.mergeAttributes({ class: 'edt-emoji' }, p.HTMLAttributes)]; },
      renderText: function (p) { var e = emojiInfo(p.node.attrs.name); return e ? '［' + e.label + '］' : ''; },
      addNodeView: function () { return emojiView; }
    }));
    exts.push(T.Node.create({
      name: 'mention', group: 'inline', inline: true, atom: true, selectable: true,
      addAttributes: function () {
        return {
          id: { default: '', parseHTML: function (el) { return el.getAttribute('data-mention') || ''; }, renderHTML: function (a) { return { 'data-mention': a.id }; } },
          handle: { default: '', parseHTML: function (el) { return el.getAttribute('data-handle') || ''; }, renderHTML: function (a) { return a.handle ? { 'data-handle': a.handle } : {}; } },
          label: { default: '', parseHTML: function (el) { return (el.textContent || '').replace(/^@/, ''); }, renderHTML: function () { return {}; } }
        };
      },
      parseHTML: function () { return [{ tag: 'span[data-mention]' }, { tag: 'a[data-mention]' }]; },
      renderHTML: function (p) {
        var handle = p.node.attrs.handle || (memberOf(p.node.attrs.id) || {}).handle || '';
        var href = handle ? '#/u/' + encodeURIComponent(handle) : '';
        return href
          ? ['a', T.mergeAttributes({ class: 'edt-mention lk-person', href: href }, p.HTMLAttributes), '@' + p.node.attrs.label]
          : ['span', T.mergeAttributes({ class: 'edt-mention' }, p.HTMLAttributes), '@' + p.node.attrs.label];
      },
      renderText: function (p) { return '@' + p.node.attrs.label; }
    }));
    return exts;
  }

  function emojiInfo(name) { var list = R() ? R().emoji.list : []; for (var i = 0; i < list.length; i++) if (list[i].name === name) return list[i]; return null; }

  /* ---------- 节点视图 ---------- */
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function setAttrs(props, node, patch) {
    var pos = typeof props.getPos === 'function' ? props.getPos() : null;
    if (typeof pos !== 'number') return;
    var view = props.editor.view;
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, Object.assign({}, node.attrs, patch)));
  }
  function inside(dom, e) { return !!(e && e.target && dom.contains(e.target) && e.target.closest && e.target.closest('input,textarea,select,button,label')); }

  function codeView(props) {
    var node = props.node;
    var dom = el('div', 'edt-code');
    var head = el('div', 'edt-code-head');
    head.contentEditable = 'false';
    var sel = el('select', 'edt-code-lang');
    sel.setAttribute('aria-label', '代码语言');
    (R() ? R().langs : [{ id: 'text', label: '纯文本' }]).forEach(function (l) { sel.add(new Option(l.label, l.id)); });
    sel.value = langOf(node.attrs.language);
    sel.addEventListener('change', function () { setAttrs(props, node, { language: sel.value }); });
    head.append(sel, el('span', 'edt-code-tag', '等宽 · Tab 缩进'));
    var pre = el('pre');
    var code = el('code');
    pre.append(code);
    dom.append(head, pre);
    return {
      dom: dom,
      contentDOM: code,
      update: function (n) { if (n.type !== node.type) return false; node = n; sel.value = langOf(n.attrs.language); return true; },
      stopEvent: function (e) { return head.contains(e.target); },
      ignoreMutation: function (m) { return head.contains(m.target); }
    };
  }

  function imageView(props, inst) {
    var node = props.node;
    var dom = el('figure', 'edt-figure');
    dom.contentEditable = 'false';
    var busy = false;
    var error = '';
    var caption = null;
    function paint() {
      var src = R() ? R().safeImage(node.attrs.src) : '';
      dom.classList.toggle('is-empty', !src);
      if (busy) {
        dom.innerHTML = '<div class="edt-upload is-busy" role="status"><span class="edt-skeleton" aria-hidden="true"></span><b>正在处理图片…</b><small>' + (isLive() ? '服务器会压缩并去掉拍摄信息' : '压缩到 1600 像素宽，去掉拍摄信息') + '</small></div>';
        return;
      }
      if (!src) {
        dom.innerHTML = '<div class="edt-upload">' + ico('image', 22) +
          '<b>放一张图片</b><small>PNG、JPEG、WebP、GIF，不超过 10MB；不收 SVG。</small>' +
          (error ? '<p class="edt-upload-err" role="alert">' + esc(error) + '</p>' : '') +
          '<span class="edt-upload-actions"><label class="button small"><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>' + ico('upload', 16) + '选择图片</label>' +
          (isLive() ? '' : '<button type="button" class="button ghost small" data-img-demo>用示例图</button>') +
          '<button type="button" class="button ghost small" data-img-remove>删掉</button></span></div>';
        dom.querySelector('input[type=file]').addEventListener('change', function (e) { var f = e.target.files && e.target.files[0]; if (f) upload(f); });
        var demoBtn = dom.querySelector('[data-img-demo]');
        if (demoBtn) demoBtn.addEventListener('click', function () { var s = demoImage(); if (s) setAttrs(props, node, { src: s, width: 1200, height: 600, alt: '检查点示意图' }); });
        dom.querySelector('[data-img-remove]').addEventListener('click', function () { var pos = props.getPos(); if (typeof pos === 'number') props.editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run(); });
        return;
      }
      dom.innerHTML = '<div class="edt-figure-img"><img alt="" draggable="false"></div><input class="edt-caption" type="text" maxlength="200" placeholder="写一句说明文字（可选）" aria-label="图片说明">';
      var img = dom.querySelector('img');
      img.src = src;
      img.alt = node.attrs.alt || node.attrs.caption || '';
      if (node.attrs.width && node.attrs.height) img.style.aspectRatio = node.attrs.width + ' / ' + node.attrs.height;
      caption = dom.querySelector('.edt-caption');
      caption.value = node.attrs.caption || '';
      caption.addEventListener('input', function () { setAttrs(props, node, { caption: caption.value.slice(0, 200) }); });
      caption.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); var pos = props.getPos(); if (typeof pos === 'number') props.editor.chain().focus().setTextSelection(pos + node.nodeSize).run(); }
      });
    }
    function upload(file) {
      error = '';
      if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) { error = file.type === 'image/svg+xml' ? '不收 SVG：它能带脚本。请换成 PNG 或 JPEG。' : '这个文件不是能用的图片。'; paint(); return; }
      if (file.size > IMAGE_MAX) { error = '超过 10MB 了，没有上传。可以先压缩一下。'; paint(); return; }
      busy = true;
      paint();
      if (isLive()) {
        uploadFile(file, function (ratio) { var b = dom.querySelector('.edt-upload.is-busy b'); if (b) b.textContent = '正在上传 ' + Math.round(ratio * 100) + '%'; }).then(function (r) {
          busy = false;
          setAttrs(props, node, { src: r.url, width: r.width || null, height: r.height || null });
        }, function (err) {
          busy = false;
          error = err && err.message ? err.message : '上传没成功，请重试。';
          paint();
        });
        return;
      }
      shrink(file).then(function (r) {
        busy = false;
        if (!r) { error = '读不出这张图片，换一张试试。'; paint(); return; }
        setAttrs(props, node, { src: r.src, width: r.width, height: r.height });
      });
    }
    paint();
    return {
      dom: dom,
      update: function (n) {
        if (n.type !== node.type) return false;
        var changed = n.attrs.src !== node.attrs.src;
        node = n;
        if (changed) paint();
        else if (caption && document.activeElement !== caption) caption.value = n.attrs.caption || '';
        return true;
      },
      stopEvent: function (e) { return inside(dom, e); },
      ignoreMutation: function () { return true; },
      selectNode: function () { dom.classList.add('is-selected'); },
      deselectNode: function () { dom.classList.remove('is-selected'); }
    };
  }

  /* ---------- 线上上传：工具栏按钮 / 粘贴 / 拖放 / 空图片块 都走 CommonsMedia.upload ---------- */
  function uploadFile(file, onRatio, signal) {
    var M = G.CommonsMedia;
    if (!M || typeof M.upload !== 'function') return Promise.reject(new Error('上传组件没加载上，刷新页面再试。'));
    return M.upload(file, { purpose: 'image', signal: signal, onProgress: function (p) { if (onRatio) onRatio(p.ratio); } });
  }

  function imageFilesOf(list) {
    return Array.prototype.slice.call(list || []).filter(function (f) { return f && (/^image\//.test(f.type) || /\.svgz?$/i.test(f.name || '')); });
  }

  function paintUploads(inst) {
    var box = inst.root && inst.root.querySelector('[data-edt-uploads]');
    if (!box) return;
    box.innerHTML = inst.uploads.map(function (u) {
      if (u.state === 'busy') return '<p class="edt-hint" data-up="' + esc(u.id) + '">' + ico('upload', 14) + '<span>正在上传 ' + esc(u.name) + ' · ' + Math.round(u.ratio * 100) + '%</span></p>';
      return '<p class="edt-upload-err" data-up="' + esc(u.id) + '" role="alert">' + esc(u.name) + '：' + esc(u.error) + ' ' +
        (u.retry ? '<button type="button" class="button ghost small" data-edt-act="upload-retry" data-id="' + esc(u.id) + '">重试</button> ' : '') +
        '<button type="button" class="button ghost small" data-edt-act="upload-drop" data-id="' + esc(u.id) + '">放弃</button></p>';
    }).join('');
    paintChecks(inst);
  }

  function placeImage(inst, u, res) {
    var ed = inst.editor;
    if (!ed || inst.destroyed) return;
    var doc = ed.state.doc;
    var $p = doc.resolve(Math.max(0, Math.min(u.pos == null ? doc.content.size : u.pos, doc.content.size)));
    var at = $p.depth ? $p.after($p.depth) : $p.pos;
    ed.chain().insertContentAt(at, { type: 'image', attrs: { src: res.url, width: res.width || null, height: res.height || null, caption: '' } }).run();
  }

  function runUpload(inst, u, again) {
    u.state = 'busy'; u.error = ''; u.ratio = u.ratio || 0; u.retry = null;
    if (!again) u.abort = typeof AbortController === 'function' ? new AbortController() : null;
    paintUploads(inst);
    var go = again ? again() : uploadFile(u.file, function (r) { u.ratio = r; paintUploads(inst); }, u.abort ? u.abort.signal : undefined);
    return go.then(function (res) {
      inst.uploads = inst.uploads.filter(function (x) { return x !== u; });
      placeImage(inst, u, res);
      paintUploads(inst);
    }, function (err) {
      if (err && err.name === 'AbortError') return;
      u.state = 'failed';
      u.error = err && err.message ? err.message : '上传没成功，请重试。';
      u.retry = err && typeof err.retry === 'function' ? function () { return err.retry(); } : null;
      if (!inst.destroyed) paintUploads(inst);
    });
  }

  /* pos 为 null 时插在光标所在块之后。多张图按顺序一张一张传，避免一次砸满额度。 */
  function uploadImages(inst, files, pos) {
    if (!isLive() || !inst.editor || !files.length) return;
    if (G.CommonsSession && typeof G.CommonsSession.can === 'function' && !G.CommonsSession.can('upload.create')) {
      var uploadWhy = whyNot('upload.create');
      addFailure(inst, files[0], uploadWhy ? '现在还不能上传图片：' + uploadWhy + '。' : '你现在还不能上传图片。');
      paintUploads(inst);
      return;
    }
    var at = pos != null ? pos : inst.editor.state.selection.to;
    var chain = Promise.resolve();
    files.forEach(function (file) {
      if (/^image\/svg/.test(file.type) || /\.svgz?$/i.test(file.name || '')) { addFailure(inst, file, '不收 SVG：它能带脚本。请换成 PNG 或 JPEG。'); return; }
      if (!/^image\/(png|jpeg|webp|gif|avif)$/.test(file.type)) { addFailure(inst, file, '这个文件不是能用的图片。'); return; }
      if (file.size > IMAGE_MAX) { addFailure(inst, file, '超过 10MB 了，没有上传。可以先压缩一下。'); return; }
      var u = { id: ++inst.uploadSeq, name: String(file.name || '图片').slice(0, 40), file: file, pos: at, state: 'busy', ratio: 0, error: '', retry: null, abort: null };
      inst.uploads.push(u);
      chain = chain.then(function () { return inst.destroyed ? null : runUpload(inst, u); });
    });
    paintUploads(inst);
  }

  function addFailure(inst, file, message) {
    inst.uploads.push({ id: ++inst.uploadSeq, name: String(file.name || '图片').slice(0, 40), file: file, pos: null, state: 'failed', ratio: 0, error: message, retry: null, abort: null });
  }

  function retryUpload(inst, id) {
    var u = inst.uploads.filter(function (x) { return x.id === id; })[0];
    if (!u || u.state !== 'failed' || !u.retry) return;
    var again = u.retry;
    runUpload(inst, u, again);
  }

  function dropUpload(inst, id) {
    inst.uploads = inst.uploads.filter(function (x) { return x.id !== id; });
    paintUploads(inst);
  }

  function pickImages(inst) {
    if (isLive() && !canDo('upload.create')) return;
    var input = inst.root && inst.root.querySelector('[data-edt-img-input]');
    if (input) input.click();
  }

  function onPasteImages(inst, e) {
    if (!isLive()) return false;
    var cd = e.clipboardData;
    var files = imageFilesOf(cd && cd.files);
    if (!files.length || (cd.getData && cd.getData('text/plain').trim())) return false;
    e.preventDefault();
    uploadImages(inst, files, null);
    return true;
  }

  function onDropImages(inst, view, e, moved) {
    if (!isLive() || moved) return false;
    var files = imageFilesOf(e.dataTransfer && e.dataTransfer.files);
    if (!files.length) return false;
    e.preventDefault();
    var at = view.posAtCoords({ left: e.clientX, top: e.clientY });
    uploadImages(inst, files, at ? at.pos : null);
    return true;
  }

  function shrink(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var scale = Math.min(1, 1600 / (img.naturalWidth || 1));
          var w = Math.max(1, Math.round(img.naturalWidth * scale));
          var h = Math.max(1, Math.round(img.naturalHeight * scale));
          var cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          cv.getContext('2d').drawImage(img, 0, 0, w, h);
          var out = cv.toDataURL('image/webp', 0.86);
          if (out.indexOf('data:image/webp') !== 0) out = cv.toDataURL('image/jpeg', 0.86);
          URL.revokeObjectURL(url);
          resolve({ src: out, width: w, height: h });
        } catch (e) { URL.revokeObjectURL(url); resolve(null); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }

  var CARD_KIND = { question: '问题', solution: '解法', pitfall: '踩坑', 'tool-review': '工具体感', debate: '争议', 'work-lead': '作品线索', resource: '资源' };
  var CARD_STATUS = { candidate: '候选', curated: '已整理', verified: '已验证', stale: '可能过时', disputed: '有争议' };
  function cardInner(card) {
    if (!card) return '<span class="edt-card-lock">' + ico('lock', 18) + '</span><span class="edt-card-copy"><b>这张卡你现在看不到</b><small>可能已撤回，或可见范围变了。</small></span>';
    var body = card.solution || card.question || card.context || '';
    return '<span class="edt-card-kind">' + esc(CARD_KIND[card.kind] || '知识卡') + '</span>' +
      '<span class="edt-card-copy"><b>' + esc(card.title) + '</b>' + (body ? '<small>' + esc(body.length > 80 ? body.slice(0, 79) + '…' : body) + '</small>' : '') +
      '<span class="edt-card-meta">' + (CARD_STATUS[card.status] ? '<i>' + esc(CARD_STATUS[card.status]) + '</i>' : '') +
      (card.corroboration ? '<i>佐证 ' + Number(card.corroboration) + ' 人</i>' : '') +
      (card.space ? '<i class="is-scope">' + ico('lock', 12) + '仅「' + esc(card.space) + '」可见 · 部分读者看不到</i>' : '') + '</span></span>';
  }
  function cardView(props) {
    var node = props.node;
    var dom = el('div', 'edt-card');
    dom.contentEditable = 'false';
    function paint() { var c = cardForAuthor(node.attrs.refId); dom.classList.toggle('is-locked', !c); dom.innerHTML = cardInner(c); }
    paint();
    return {
      dom: dom,
      update: function (n) { if (n.type !== node.type) return false; var ch = n.attrs.refId !== node.attrs.refId; node = n; if (ch) paint(); return true; },
      ignoreMutation: function () { return true; },
      selectNode: function () { dom.classList.add('is-selected'); },
      deselectNode: function () { dom.classList.remove('is-selected'); }
    };
  }

  function workView(props) {
    var node = props.node;
    var dom = el('div', 'edt-work');
    dom.contentEditable = 'false';
    var handle = null;
    function paint() {
      if (handle && handle.destroy) handle.destroy();
      handle = null;
      // Content enrichment resolves htmlWork.attrs.workId as a media asset ID.
      var w = isLive() ? { assetId: node.attrs.workId, title: node.attrs.title } : getWork(node.attrs.workId);
      var kb = Math.max(1, Math.round((Number(node.attrs.bytes) || 0) / 1024));
      dom.innerHTML = '<div class="edt-work-head"><span class="edt-work-tag">' + ico('html', 14) + 'HTML 作品</span><b>' + esc(node.attrs.title || '未命名作品') + '</b><small>' + kb + ' KB · 沙箱预览，不能联网</small></div><div class="edt-work-frame"></div>';
      var frame = dom.querySelector('.edt-work-frame');
      if (!w) { frame.innerHTML = '<p class="edt-work-wait">作品内容没找到（可能是在别的设备上插入的）。</p>'; return; }
      if (!G.CommonsHTML || typeof G.CommonsHTML.render !== 'function') { frame.innerHTML = '<p class="edt-work-wait">HTML 沙箱组件没有加载，作品已经存好，接线后这里会显示预览。</p>'; return; }
      var options = { title: w.title || node.attrs.title || '' };
      if (isLive()) options.assetId = w.assetId;
      else options.html = w.html;
      handle = G.CommonsHTML.render(frame, options);
    }
    paint();
    return {
      dom: dom,
      update: function (n) { if (n.type !== node.type) return false; var ch = n.attrs.workId !== node.attrs.workId; node = n; if (ch) paint(); return true; },
      stopEvent: function (e) { return inside(dom, e); },
      ignoreMutation: function () { return true; },
      selectNode: function () { dom.classList.add('is-selected'); },
      deselectNode: function () { dom.classList.remove('is-selected'); },
      destroy: function () { if (handle && handle.destroy) handle.destroy(); handle = null; }
    };
  }

  function emojiView(props) {
    var node = props.node;
    var dom = el('span', 'edt-emoji');
    dom.contentEditable = 'false';
    function paint() {
      var e = emojiInfo(node.attrs.name);
      dom.setAttribute('role', 'img');
      dom.setAttribute('aria-label', e ? e.label : '表情');
      dom.title = e ? e.label : '';
      dom.style.setProperty('--edt-emoji', e ? e.color : 'var(--muted)');
      dom.innerHTML = e && R() ? R().emoji.svg(node.attrs.name, 18) : '';
    }
    paint();
    return { dom: dom, update: function (n) { if (n.type !== node.type) return false; node = n; paint(); return true; }, ignoreMutation: function () { return true; } };
  }

  /* ---------- 斜杠菜单与弹层 ---------- */
  var SLASH = [
    { id: 'p', label: '正文', hint: '普通段落', keys: 'p text zhengwen 正文 段落', icon: 'text', group: '基础' },
    { id: 'h2', label: '标题', hint: '进目录的大标题', keys: 'h2 heading biaoti 标题', icon: 'h2', group: '基础' },
    { id: 'h3', label: '小标题', hint: '三级标题', keys: 'h3 subheading xiaobiaoti 小标题 标题', icon: 'h3', group: '基础' },
    { id: 'ul', label: '无序列表', hint: '用 - 开头也行', keys: 'ul bullet list liebiao 列表 无序', icon: 'ul', group: '基础' },
    { id: 'ol', label: '有序列表', hint: '用 1. 开头也行', keys: 'ol ordered number list liebiao 列表 有序 编号', icon: 'ol', group: '基础' },
    { id: 'quote', label: '引用', hint: '别人的原话', keys: 'quote blockquote yinyong 引用', icon: 'quote', group: '基础' },
    { id: 'code', label: '代码块', hint: '等宽，可选语言', keys: 'code codeblock daima 代码', icon: 'code', group: '基础' },
    { id: 'hr', label: '分隔线', hint: '换一个话题', keys: 'hr divider line fengexian 分隔 分割', icon: 'hr', group: '基础' },
    { id: 'image', label: '图片', hint: '上传，加说明文字', keys: 'image img picture tupian 图片 照片 配图', icon: 'image', group: '插入' },
    { id: 'card', label: '知识卡', hint: '引用知识地图里的一条', keys: 'card knowledge zhishi ka 知识 卡片', icon: 'card', group: '插入' },
    { id: 'html', label: 'HTML 作品', hint: '沙箱预览，不超过 2MB', keys: 'html work zuopin 作品 网页', icon: 'html', group: '插入' },
    { id: 'emoji', label: '表情', hint: '也可以直接输入 :', keys: 'emoji biaoqing 表情 反应', icon: 'emoji', group: '插入' },
    { id: 'mention', label: '提及成员', hint: '也可以直接输入 @', keys: 'mention at tiji 提及 成员 人', icon: 'at', group: '插入' }
  ];

  var LIVE_SLASH_HIDE = { card: 1, html: 1, mention: 1 };
  function matchSlash(q) {
    q = q.toLowerCase();
    return SLASH.filter(function (s) {
      if (isLive() && LIVE_SLASH_HIDE[s.id]) return false;
      if (isLive() && s.id === 'image' && !canDo('upload.create')) return false;
      return !q || s.label.toLowerCase().indexOf(q) >= 0 || s.keys.indexOf(q) >= 0;
    });
  }
  function matchMembers(q) {
    q = q.toLowerCase();
    return MEMBERS.filter(function (m) { return !q || m.name.indexOf(q) >= 0 || m.id.indexOf(q) >= 0 || m.note.toLowerCase().indexOf(q) >= 0; }).slice(0, 6);
  }
  function matchEmoji(q) {
    var list = R() ? R().emoji.list : [];
    q = q.toLowerCase();
    return list.filter(function (e) { return !q || e.label.indexOf(q) >= 0 || e.name.indexOf(q) >= 0; });
  }
  function matchCards(q) {
    q = q.trim().toLowerCase();
    var list = units();
    var out = [];
    for (var i = 0; i < list.length && out.length < 6; i++) {
      var u = list[i];
      if (!q || String(u.title).toLowerCase().indexOf(q) >= 0 || (u.tools || []).join(' ').toLowerCase().indexOf(q) >= 0) out.push(u);
    }
    return out;
  }

  /* ---------- 实例 ---------- */
  var instances = [];

  function mount(container, opts) {
    if (!container || !container.appendChild) return null;
    opts = Object.assign({}, opts || {});
    if (isLive()) { opts.draft = false; opts.sample = false; }
    var inst = {
      id: /^[A-Za-z0-9_-]{1,64}$/.test(String(opts.id || '')) ? String(opts.id) : uid('d-'),
      kind: KINDS[opts.kind] ? opts.kind : 'knowledge',
      opts: opts,
      container: container,
      editor: null,
      version: Number(opts.version) || 0,
      clientId: uid('c-'),
      dirty: false,
      savedAt: 0,
      saveTimer: 0,
      tick: 0,
      pop: null,
      dismissed: -1,
      bubbleMode: 'tools',
      visibility: opts.visibilityLocked ? Object.assign({ scope: 'members', level: 3, space: '', people: [] }, opts.visibility || {}) : snapLiveScope(Object.assign({ scope: 'members', level: 3, space: '', people: [] }, sample().visibility || {}, opts.visibility || {})),
      visLocked: !!opts.visibilityLocked,
      aigc: opts.aigc || 'none',
      title: String(opts.title || ''),
      restored: null,
      confirmReset: 0,
      off: [],
      uploads: [],
      uploadSeq: 0,
      destroyed: false
    };
    instances.push(inst);
    var draft = opts.draft === false ? null : store.read('editor.draft.' + inst.id, null);
    var doc = opts.doc || { type: 'doc', content: [{ type: 'paragraph' }] };
    if (draft && draft.doc && typeof draft.doc === 'object') {
      doc = draft.doc;
      inst.title = typeof draft.title === 'string' ? draft.title : inst.title;
      if (draft.visibility) inst.visibility = Object.assign(inst.visibility, draft.visibility);
      if (draft.aigc) inst.aigc = draft.aigc;
      inst.version = Number(draft.version) || inst.version;
      inst.savedAt = Date.parse(draft.updatedAt) || Date.now();
      inst.restored = draft.updatedAt || '';
    }
    inst.initialDoc = doc;
    renderShell(inst);
    bindShell(inst);
    startEditor(inst);
    return {
      opts: inst.opts,
      get editor() { return inst.editor; },
      get version() { return inst.version; },
      getDoc: function (forPublish) { return inst.editor ? clean(inst.editor.getJSON(), forPublish) : clean(inst.initialDoc, forPublish); },
      getEnvelope: function () { return envelope(inst, 'draft'); },
      save: function () { return flush(inst); },
      publish: function () { return publish(inst); },
      destroy: function () { destroyInst(inst); }
    };
  }

  function imageControl() {
    if (!isLive()) return '';
    if (!canDo('upload.create')) {
      var why = whyNot('upload.create') || '你现在还不能上传图片';
      return '<button type="button" class="button ghost small" data-edt-act="insert-image" disabled aria-disabled="true" title="' + esc(why) + '" aria-label="插入图片">' + ico('image', 16) + '图片</button>';
    }
    return '<button type="button" class="button ghost small" data-edt-act="insert-image" aria-label="插入图片">' + ico('image', 16) + '图片</button><input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" multiple hidden data-edt-img-input>';
  }

  function renderShell(inst) {
    var reply = inst.kind === 'reply';
    var sample = inst.opts.sample !== false ? '<span class="pill outline">示例</span>' : '';
    var pid = inst.id;
    inst.container.innerHTML =
      '<div class="edt' + (reply ? ' is-reply' : '') + '" data-edt data-kind="' + esc(inst.kind) + '">' +
        '<div class="edt-main" data-edt-main>' +
          '<header class="edt-bar">' +
            '<span class="edt-kind">' + ico(reply ? 'text' : 'pen', 14) + esc(KINDS[inst.kind]) + '</span>' + sample +
            '<span class="edt-save" data-edt-save role="status" aria-live="polite"></span>' +
            '<span class="edt-bar-actions">' +
              imageControl() +
              '<button type="button" class="button ghost small" data-edt-act="reset" hidden>恢复示例稿</button>' +
              (reply ? '<button type="button" class="button primary small" data-edt-act="publish">发送回复</button>'
                : '<a class="button ghost small" href="#/read/' + esc(pid) + '">' + ico('read', 16) + '阅读页</a><button type="button" class="button tonal small edt-jump" data-edt-act="jump-publish">发布…</button>') +
            '</span>' +
          '</header>' +
          '<div class="edt-paper">' +
            (reply ? '' : '<textarea class="edt-title" data-edt-title rows="1" maxlength="120" placeholder="标题" aria-label="标题">' + esc(inst.title) + '</textarea><p class="edt-title-err" data-edt-title-err role="alert" hidden></p>') +
            '<p class="edt-hint">' + ico('spark', 14) + '<span>输入 <kbd>/</kbd> 插入块 · 选中文字出现工具条' + (isLive() ? '' : ' · <kbd>@</kbd> 提及成员') + (isLive() ? ' · 可直接粘贴或拖入图片' : '') + ' · <kbd>:</kbd> 插入表情</span></p>' +
            (isLive() ? '<div class="edt-uploads" data-edt-uploads role="status" aria-live="polite"></div>' : '') +
            '<div class="edt-surface" data-edt-surface><div class="edt-loading" role="status"><span class="edt-skeleton"></span><span class="edt-skeleton is-short"></span><span>编辑器加载中…</span></div></div>' +
          '</div>' +
          '<div class="edt-layer" data-edt-layer></div>' +
        '</div>' +
        (reply ? '' : publishPanel(inst)) +
      '</div>';
    inst.root = inst.container.querySelector('[data-edt]');
    inst.main = inst.root.querySelector('[data-edt-main]');
    inst.layer = inst.root.querySelector('[data-edt-layer]');
    inst.surface = inst.root.querySelector('[data-edt-surface]');
    inst.titleEl = inst.root.querySelector('[data-edt-title]');
    autoGrow(inst.titleEl);
    setStatus(inst, inst.restored ? 'restored' : 'fresh');
  }

  function autoGrow(t) { if (!t) return; t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }

  /* 发布面板 */
  function publishPanel(inst) {
    var v = inst.visibility;
    var name = 'edt-scope-' + inst.id;
    var opt = function (value, label, note, extra) {
      return '<label class="edt-scope-opt' + (value === 'public' ? ' is-disabled' : '') + '"><input type="radio" name="' + esc(name) + '" value="' + esc(value) + '"' + (v.scope === value ? ' checked' : '') + (value === 'public' ? ' disabled' : '') + '>' +
        '<span class="edt-scope-copy"><b>' + esc(label) + '</b><small>' + esc(note) + '</small></span></label>' + (extra /* safe: 本函数里拼好的等级/空间下拉，选项文字已转义 */ || '');
    };
    var people = '<div class="edt-scope-more" data-scope-more="people"' + (v.scope === 'people' ? '' : ' hidden') + '><span class="edt-more-label">点名谁能看</span><div class="edt-people">' +
      MEMBERS.map(function (m) { return '<button type="button" class="chip" data-edt-act="person" data-id="' + esc(m.id) + '" aria-pressed="' + (v.people.indexOf(m.id) >= 0) + '">' + esc(m.name) + '</button>'; }).join('') + '</div></div>';
    var level = '<div class="edt-scope-more field" data-scope-more="level"' + (v.scope === 'level' ? '' : ' hidden') + '><label for="edt-level-' + esc(inst.id) + '">最低等级</label><select id="edt-level-' + esc(inst.id) + '" data-edt-level>' +
      [2, 3, 4, 5].map(function (n) { return '<option value="' + n + '"' + (Number(v.level) === n ? ' selected' : '') + '>L' + n + ' ' + esc(R() ? R().levels[n] : '') + ' 及以上</option>'; }).join('') + '</select></div>';
    var space = '<div class="edt-scope-more field" data-scope-more="space"' + (v.scope === 'space' ? '' : ' hidden') + '><label for="edt-space-' + esc(inst.id) + '">哪个空间</label><select id="edt-space-' + esc(inst.id) + '" data-edt-space>' +
      SPACES.map(function (s) { return '<option value="' + esc(s.id) + '"' + (v.space === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '</select></div>';
    var aname = 'edt-aigc-' + inst.id;
    var ai = function (value, label, note) {
      return '<label class="edt-scope-opt"><input type="radio" name="' + esc(aname) + '" value="' + esc(value) + '"' + (inst.aigc === value ? ' checked' : '') + '><span class="edt-scope-copy"><b>' + esc(label) + '</b><small>' + esc(note) + '</small></span></label>';
    };
    var scopes = isLive() && inst.visLocked
      ? '<p class="edt-scope-locked" data-edt-scope-locked>当前：' + esc(lockedScopeLabel(v.scope)) + '。这篇的可见范围在这里改不了，保存时不会动它。</p>'
      : isLive()
      ? opt('members', '社区成员', '所有登录的成员') +
        opt('level', '等级 ≥ N', '到了指定等级的成员', level) +
        opt('public', '公开', '内测不开放')
      : opt('private', '仅自己', '先存着，只有你能看到') +
        opt('people', '受邀成员', '你点名的人', people) +
        opt('members', '社区成员', '所有登录的成员') +
        opt('level', '等级 ≥ N', '到了指定等级的成员', level) +
        opt('space', '空间', '课程、项目或会馆的成员', space) +
        opt('public', '公开', '内测不开放');
    return '<aside class="edt-publish" data-edt-publish aria-labelledby="edt-pub-' + esc(inst.id) + '">' +
      '<h2 id="edt-pub-' + esc(inst.id) + '" tabindex="-1">发布前确认</h2>' +
      '<fieldset class="edt-fieldset"><legend>谁能看到</legend>' +
        scopes +
      '</fieldset>' +
      '<p class="edt-who" data-edt-who aria-live="polite"></p>' +
      '<fieldset class="edt-fieldset"><legend>用了 AI 吗（AIGC 标注）</legend>' +
        ai('none', '没有用', '全部自己写的') +
        ai('assist', 'AI 辅助', '用 AI 整理、润色或翻译，结论自己核对过') +
        ai('generated', '主要由 AI 生成', '正文大部分是 AI 写的，自己做了核对') +
      '</fieldset>' +
      '<ul class="edt-checks" data-edt-checks></ul>' +
      '<div class="edt-pub-actions"><button type="button" class="button primary" data-edt-act="publish">发布</button><a class="button ghost" href="#/read/' + esc(inst.id) + '">看阅读页</a></div>' +
      '<p class="edt-pub-note" data-edt-pub-note>' + esc(isLive() ? livePubNote(v.scope, inst.visLocked) : '发布只存在本机，不通知任何人。') + '</p>' +
    '</aside>';
  }

  function lockedScopeLabel(scope) {
    return { people: '点名的成员可见', named: '点名的成员可见', space: '空间成员可见', public: '公开', private: '仅自己可见' }[scope] || '原来的可见范围';
  }

  function livePubNote(scope, locked) {
    if (locked) return '发布后这篇的可见范围保持不变。';
    if (scope === 'level') return '发布后达到所选等级的成员能看到。';
    return '发布后登录成员都能看到。';
  }

  function whoText(inst) {
    var v = inst.visibility;
    var peopleNames = MEMBERS.filter(function (m) { return v.people.indexOf(m.id) >= 0; }).map(function (m) { return m.name; });
    var sp = SPACES.filter(function (s) { return s.id === v.space; })[0];
    var info = R() ? R().visibility({ scope: v.scope, level: v.level, peopleNames: peopleNames, spaceName: sp ? sp.name : '' }) : { who: '', label: '' };
    var extra = '';
    if (!isLive()) {
      if (v.scope === 'level') extra = '（约 ' + (LEVEL_COUNT[Number(v.level)] || 0) + ' 人）';
      if (v.scope === 'space' && sp) extra = '（' + sp.count + ' 人）';
      if (v.scope === 'members') extra = '（约 860 人）';
    }
    return { label: info.label, who: info.who + extra, peopleNames: peopleNames, spaceName: sp ? sp.name : '' };
  }

  function paintWho(inst) {
    var who = inst.root.querySelector('[data-edt-who]');
    if (!who) return;
    var w = whoText(inst);
    who.innerHTML = ico('eye', 16) + '<span><b>' + esc(w.label) + '</b>' + esc(w.who) + '</span>';
    Array.prototype.forEach.call(inst.root.querySelectorAll('[data-scope-more]'), function (n) { n.hidden = n.dataset.scopeMore !== inst.visibility.scope; });
    var note = inst.root.querySelector('[data-edt-pub-note]');
    if (note) note.textContent = isLive() ? livePubNote(inst.visibility.scope, inst.visLocked) : '发布只存在本机，不通知任何人。';
  }

  function paintChecks(inst) {
    var box = inst.root.querySelector('[data-edt-checks]');
    if (!box) return;
    var doc = inst.editor ? inst.editor.getJSON() : inst.initialDoc;
    var text = R() ? R().plain(doc).trim() : '';
    var pending = 0;
    walk(doc, function (n) { if (n.type === 'image' && !(R() && R().safeImage(n.attrs && n.attrs.src))) pending += 1; });
    var running = inst.uploads ? inst.uploads.filter(function (u) { return u.state === 'busy'; }).length : 0;
    pending += running;
    var rows = [
      [!!inst.title.trim(), inst.title.trim() ? '标题写好了' : '还没写标题'],
      [text.length > 0, text.length ? '正文约 ' + text.length + ' 字' : '正文还是空的'],
      [pending === 0, running ? '还有 ' + running + ' 张图片在上传，传完才能发布' : pending ? '还有 ' + pending + ' 张图片没上传，发布时会略过' : '图片都上传了']
    ];
    box.innerHTML = rows.map(function (r) { return '<li class="' + (r[0] ? 'is-ok' : 'is-todo') + '">' + ico(r[0] ? 'check' : 'warn', 14) + '<span>' + esc(r[1]) + '</span></li>'; }).join('');
  }

  function walk(node, fn) { if (!node || typeof node !== 'object') return; fn(node); if (Array.isArray(node.content)) node.content.forEach(function (c) { walk(c, fn); }); }

  function clean(doc, forPublish) {
    var copy = JSON.parse(JSON.stringify(doc || { type: 'doc', content: [] }));
    if (!forPublish) return copy;
    (function prune(n) {
      if (!n || !Array.isArray(n.content)) return;
      n.content = n.content.filter(function (c) { return !(c && c.type === 'image' && !(R() && R().safeImage(c.attrs && c.attrs.src))); });
      n.content.forEach(prune);
    })(copy);
    return copy;
  }

  function envelope(inst, status) {
    var v = inst.visibility;
    var w = whoText(inst);
    return {
      id: inst.id,
      kind: inst.kind,
      title: inst.title,
      doc: clean(inst.editor ? inst.editor.getJSON() : inst.initialDoc, status === 'published'),
      version: inst.version,
      visibility: { scope: v.scope, level: v.scope === 'level' ? Number(v.level) : null, space: v.scope === 'space' ? v.space : null, people: v.scope === 'people' ? v.people.slice() : [], peopleNames: v.scope === 'people' ? w.peopleNames : [], spaceName: v.scope === 'space' ? w.spaceName : '' },
      aigc: inst.aigc,
      status: status,
      updatedAt: new Date().toISOString()
    };
  }

  /* ---------- 保存 ---------- */
  function rel(ts) {
    var s = Math.round((Date.now() - ts) / 1000);
    if (s < 45) return '刚刚';
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + ' 分钟前';
    var d = new Date(ts);
    return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
  }
  function setStatus(inst, state) {
    inst.status = state;
    var n = inst.root && inst.root.querySelector('[data-edt-save]');
    if (!n) return;
    var map = {
      fresh: ['is-idle', '本机草稿 · 停顿 1 秒自动保存'],
      editing: ['is-busy', '有改动 · 马上保存'],
      saved: ['is-ok', '已保存 · ' + rel(inst.savedAt || Date.now())],
      restored: ['is-ok', '已恢复本机草稿 · ' + rel(inst.savedAt || Date.now())],
      failed: ['is-err', '没保存上 · 内容还在页面上，先别关'],
      published: ['is-ok', '已发布 · ' + rel(inst.savedAt || Date.now())]
    };
    if (isLive()) {
      map.fresh = ['is-idle', '发布后保存到账号'];
      map.editing = ['is-busy', '有改动 · 尚未发布'];
      map.saving = ['is-busy', '正在发布…'];
      map.failed = ['is-err', '未发布 · 内容还在页面上，请重试发布'];
    }
    var m = map[state] || map.fresh;
    n.className = 'edt-save ' + m[0];
    n.innerHTML = '<i aria-hidden="true"></i>' + esc(m[1]);
    var reset = inst.root.querySelector('[data-edt-act="reset"]');
    if (reset) reset.hidden = !(inst.opts.resetDoc && (inst.restored || inst.dirty || inst.savedAt));
  }
  function scheduleSave(inst) {
    inst.dirty = true;
    if (inst.status !== 'editing') setStatus(inst, 'editing');
    clearTimeout(inst.saveTimer);
    inst.saveTimer = setTimeout(function () { flush(inst); }, 1000);
  }
  function flush(inst) {
    clearTimeout(inst.saveTimer);
    inst.saveTimer = 0;
    if (!inst.dirty) return true;
    if (isLive()) {
      // A live draft is not persisted by the demo's localStorage adapter.
      if (!inst.destroyed) setStatus(inst, 'editing');
      return false;
    }
    var env = envelope(inst, 'draft');
    var ok = inst.opts.draft === false ? true : store.write('editor.draft.' + inst.id, env);
    if (ok) {
      inst.dirty = false;
      inst.savedAt = Date.now();
      if (!inst.destroyed) setStatus(inst, 'saved');
      if (typeof inst.opts.onSave === 'function') inst.opts.onSave(env, { reason: 'autosave' });
    } else if (!inst.destroyed) setStatus(inst, 'failed');
    return ok;
  }

  function publish(inst) {
    if (inst.publishing) return false;
    var titleErr = inst.root.querySelector('[data-edt-title-err]');
    if (inst.kind !== 'reply' && !inst.title.trim()) {
      if (titleErr) { titleErr.hidden = false; titleErr.textContent = '先写个标题，阅读页和分享卡都要用它。'; }
      if (inst.titleEl) inst.titleEl.focus();
      return false;
    }
    if (titleErr) titleErr.hidden = true;
    var text = inst.editor ? inst.editor.getText().trim() : '';
    if (!text) { toast('正文还是空的，写一句再发布。'); if (inst.editor) inst.editor.commands.focus(); return false; }
    if (isLive() && inst.uploads.some(function (u) { return u.state === 'busy'; })) { toast('还有图片在上传，等它传完再发布。'); return false; }
    flush(inst);
    var env = envelope(inst, 'published');
    env.publishedAt = env.updatedAt;
    if (isLive()) {
      if (typeof inst.opts.onPublish !== 'function') {
        toast('发布接口尚未接入，内容未发布。');
        return false;
      }
      inst.publishing = true;
      setStatus(inst, 'saving');
      return Promise.resolve().then(function () { return inst.opts.onPublish(env); }).then(function (result) {
        inst.publishing = false;
        inst.dirty = false;
        if (!inst.destroyed) { inst.savedAt = Date.now(); setStatus(inst, 'published'); }
        return result;
      }).catch(function (error) {
        inst.publishing = false;
        if (!inst.destroyed) setStatus(inst, 'failed');
        toast((error && error.message) || '没有发布成功，请重试。');
        return false;
      });
    }
    var ok = inst.opts.draft === false ? true : store.write('editor.published.' + inst.id, env);
    if (!ok) { setStatus(inst, 'failed'); return false; }
    inst.savedAt = Date.now();
    setStatus(inst, 'published');
    if (typeof inst.opts.onSave === 'function') inst.opts.onSave(env, { reason: 'publish' });
    if (inst.kind !== 'reply') toast('已发布 · ' + whoText(inst).label + '可见（只存在本机）');
    return env;
  }

  /* ---------- 编辑器启动 ---------- */
  function startEditor(inst) {
    needTiptap().then(function (T) {
      if (inst.destroyed) return;
      inst.surface.innerHTML = '';
      var exts = buildExtensions(T, inst);
      var make = function (content) {
        return new T.Editor({
          element: inst.surface,
          extensions: exts,
          content: content,
          injectCSS: false,
          editorProps: {
            attributes: { class: 'edt-prose', 'aria-label': '正文', role: 'textbox', 'aria-multiline': 'true', spellcheck: 'false' },
            handleKeyDown: function (view, e) { return onKey(inst, e); },
            handlePaste: function (view, e) { return onPasteImages(inst, e); },
            handleDrop: function (view, e, slice, moved) { return onDropImages(inst, view, e, moved); }
          }
        });
      };
      try { inst.editor = make(inst.initialDoc); }
      catch (e) {
        inst.surface.innerHTML = '';
        inst.editor = make({ type: 'doc', content: [{ type: 'paragraph' }] });
        toast('草稿里有认不出的内容，已用空白稿打开。原草稿还在本机。');
      }
      var ed = inst.editor;
      ed.on('update', function (ev) {
        var steps = [];
        [ev.transaction].concat(ev.appendedTransactions || []).forEach(function (tr) { if (tr && tr.steps) tr.steps.forEach(function (s) { steps.push(s.toJSON()); }); });
        inst.version += 1;
        if (typeof inst.opts.onChange === 'function') inst.opts.onChange({ id: inst.id, version: inst.version, clientId: inst.clientId, steps: steps, doc: clean(ed.getJSON(), false) });
        scheduleSave(inst);
        paintChecks(inst);
      });
      ed.on('transaction', function (ev) {
        if (inst.destroyed) return;
        var tr = ev && ev.transaction;
        if (tr && tr.docChanged) inst.uploads.forEach(function (u) { if (u.pos != null) u.pos = tr.mapping.map(u.pos); });
        checkTrigger(inst); paintBubble(inst);
      });
      ed.on('focus', function () { if (inst.pop && !inst.pop.trigger) closePop(inst); paintBubble(inst); });
      ed.on('blur', function (ev) {
        var to = ev && ev.event && ev.event.relatedTarget;
        if (to && inst.layer.contains(to)) return;
        setTimeout(function () { if (!inst.destroyed && !inst.layer.contains(document.activeElement)) { hideBubble(inst); if (inst.pop && inst.pop.trigger) closePop(inst); } }, 0);
      });
      paintChecks(inst);
      paintWho(inst);
    }, function () {
      if (inst.destroyed) return;
      inst.surface.innerHTML = '<div class="edt-fail" role="alert">' + ico('warn', 20) + '<b>编辑器没加载上</b><p>原稿还在本机草稿里，没有丢。检查一下 vendor/tiptap.min.js 能不能打开，再试一次。</p><button type="button" class="button" data-edt-act="retry">重试</button></div>';
    });
  }

  /* ---------- 外壳事件 ---------- */
  function bindShell(inst) {
    var root = inst.root;
    function onClick(e) {
      var b = e.target.closest('[data-edt-act]');
      if (!b || !root.contains(b)) return;
      var act = b.dataset.edtAct;
      if (act === 'retry') { inst.surface.innerHTML = '<div class="edt-loading" role="status"><span class="edt-skeleton"></span><span>编辑器加载中…</span></div>'; startEditor(inst); }
      else if (act === 'publish') publish(inst);
      else if (act === 'jump-publish') {
        var panel = root.querySelector('[data-edt-publish]');
        if (panel) { panel.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' }); var h = panel.querySelector('h2'); if (h) h.focus({ preventScroll: true }); }
      } else if (act === 'person') {
        var id = b.dataset.id;
        var list = inst.visibility.people;
        var on = list.indexOf(id) < 0;
        inst.visibility.people = on ? list.concat(id) : list.filter(function (x) { return x !== id; });
        b.setAttribute('aria-pressed', String(on));
        paintWho(inst); scheduleSave(inst);
      } else if (act === 'reset') {
        if (!inst.confirmReset) {
          inst.confirmReset = setTimeout(function () { inst.confirmReset = 0; b.textContent = '恢复示例稿'; }, 3000);
          b.textContent = '再点一次，丢掉本机草稿';
          return;
        }
        clearTimeout(inst.confirmReset); inst.confirmReset = 0;
        store.write('editor.draft.' + inst.id, null);
        inst.dirty = false; inst.restored = null; inst.savedAt = 0;
        if (inst.editor) inst.editor.commands.setContent(inst.opts.resetDoc(), { emitUpdate: false });
        inst.title = inst.opts.title || '';
        if (inst.titleEl) { inst.titleEl.value = inst.title; autoGrow(inst.titleEl); }
        b.textContent = '恢复示例稿';
        setStatus(inst, 'fresh');
        paintChecks(inst);
        toast('已恢复示例稿，本机草稿清掉了。');
      }
      else if (act === 'pick') pick(inst, Number(b.dataset.index));
      else if (act === 'insert-image') pickImages(inst);
      else if (act === 'upload-retry') retryUpload(inst, Number(b.dataset.id));
      else if (act === 'upload-drop') dropUpload(inst, Number(b.dataset.id));
      else if (act === 'bubble') bubbleAction(inst, b.dataset.cmd);
      else if (act === 'pop-close') { closePop(inst); if (inst.editor) inst.editor.commands.focus(); }
    }
    function onChange(e) {
      var t = e.target;
      if (t.matches && t.matches('[data-edt-img-input]')) { var picked = Array.prototype.slice.call(t.files || []); t.value = ''; uploadImages(inst, picked, null); return; }
      if (t.name === 'edt-scope-' + inst.id) { inst.visibility.scope = t.value; paintWho(inst); scheduleSave(inst); }
      else if (t.name === 'edt-aigc-' + inst.id) { inst.aigc = t.value; scheduleSave(inst); }
      else if (t.matches('[data-edt-level]')) { inst.visibility.level = Number(t.value); paintWho(inst); scheduleSave(inst); }
      else if (t.matches('[data-edt-space]')) { inst.visibility.space = t.value; paintWho(inst); scheduleSave(inst); }
    }
    function onInput(e) {
      if (e.target === inst.titleEl) {
        if (/\n/.test(inst.titleEl.value)) inst.titleEl.value = inst.titleEl.value.replace(/\n+/g, ' ');
        inst.title = inst.titleEl.value;
        autoGrow(inst.titleEl);
        var err = root.querySelector('[data-edt-title-err]');
        if (err && inst.title.trim()) err.hidden = true;
        if (typeof inst.opts.onChange === 'function') inst.opts.onChange({ id: inst.id, version: inst.version, clientId: inst.clientId, steps: [], title: inst.title });
        scheduleSave(inst);
        paintChecks(inst);
      }
    }
    function onKeydown(e) {
      if (e.target === inst.titleEl && e.key === 'Enter' && !e.isComposing) { e.preventDefault(); if (inst.editor) inst.editor.commands.focus('start'); }
    }
    function onMousedown(e) {
      if (e.target.closest('.edt-bubble button, .edt-pop-item')) e.preventDefault();
    }
    function onUnload(e) { if (inst.dirty && !flush(inst)) { e.preventDefault(); e.returnValue = ''; } }
    function onScroll() { if (inst.pop || inst.bubbleShown) { reposition(inst); } }
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('input', onInput);
    root.addEventListener('keydown', onKeydown);
    root.addEventListener('mousedown', onMousedown);
    G.addEventListener('beforeunload', onUnload);
    G.addEventListener('resize', onScroll);
    G.addEventListener('scroll', onScroll, { passive: true });
    inst.tick = setInterval(function () { if (inst.status === 'saved' || inst.status === 'restored' || inst.status === 'published') setStatus(inst, inst.status); }, 30000);
    inst.off.push(function () {
      root.removeEventListener('click', onClick);
      root.removeEventListener('change', onChange);
      root.removeEventListener('input', onInput);
      root.removeEventListener('keydown', onKeydown);
      root.removeEventListener('mousedown', onMousedown);
      G.removeEventListener('beforeunload', onUnload);
      G.removeEventListener('resize', onScroll);
      G.removeEventListener('scroll', onScroll);
      clearInterval(inst.tick);
      clearTimeout(inst.confirmReset);
    });
    paintWho(inst);
  }

  /* ---------- 触发词：/ @ : ---------- */
  function checkTrigger(inst) {
    var ed = inst.editor;
    if (!ed) return;
    if (inst.pop && !inst.pop.trigger) return;
    var sel = ed.state.selection;
    if (!sel.empty || ed.view.composing || !ed.isFocused) { if (inst.pop) closePop(inst); return; }
    var $from = sel.$from;
    if ($from.parent.type.name === 'codeBlock') { if (inst.pop) closePop(inst); return; }
    var before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 24), $from.parentOffset, '\n', '\ufffc');
    var whole = $from.parentOffset <= 24 ? before : null;
    var m, type = null, q = '', len = 0;
    if ((m = /(?:^|[\s\ufffc])\/([^\s/]{0,16})$/.exec(before))) { type = 'slash'; q = m[1]; len = q.length + 1; }
    else if (whole !== null && (m = /^、([^\s、]{0,16})$/.exec(whole))) { type = 'slash'; q = m[1]; len = q.length + 1; }
    else if (!isLive() && (m = /(?:^|[\s\ufffc])@([^\s@]{0,16})$/.exec(before))) { type = 'mention'; q = m[1]; len = q.length + 1; }
    else if ((m = /(?:^|[\s\ufffc])[:：]([^\s:：]{0,12})$/.exec(before))) { type = 'emoji'; q = m[1]; len = q.length + 1; }
    if (!type) { if (inst.pop) closePop(inst); inst.dismissed = -1; return; }
    var from = $from.pos - len;
    if (from === inst.dismissed) return;
    var items = type === 'slash' ? matchSlash(q) : type === 'mention' ? matchMembers(q) : matchEmoji(q);
    var keep = inst.pop && inst.pop.type === type && inst.pop.from === from ? inst.pop.index : 0;
    inst.pop = { trigger: true, type: type, from: from, to: $from.pos, query: q, items: items, index: Math.min(keep, Math.max(0, items.length - 1)), cols: type === 'emoji' ? 4 : 1 };
    hideBubble(inst);
    paintPop(inst);
  }

  function popItemsHTML(inst) {
    var p = inst.pop;
    if (!p.items.length) {
      var empty = p.type === 'slash' ? '没有叫「' + p.query + '」的块' : p.type === 'mention' ? '没有找到「' + p.query + '」' : '没有这个表情';
      return '<p class="edt-pop-empty">' + esc(empty) + '</p>';
    }
    var last = '';
    return p.items.map(function (it, i) {
      var on = i === p.index;
      var id = 'edt-opt-' + inst.id + '-' + i;
      var attrs = ' id="' + esc(id) + '" role="option" aria-selected="' + on + '" class="edt-pop-item' + (on ? ' is-active' : '') + '" data-edt-act="pick" data-index="' + i + '"';
      if (p.type === 'slash') {
        var head = !p.query && it.group !== last ? '<p class="edt-pop-group" role="presentation">' + esc(it.group) + '</p>' : '';
        last = it.group;
        return head + '<button type="button"' + attrs + '><span class="edt-pop-ico">' + ico(it.icon, 18) + '</span><span class="edt-pop-copy"><b>' + esc(it.label) + '</b><small>' + esc(it.hint) + '</small></span></button>';
      }
      if (p.type === 'mention') {
        var A = G.CommonsAvatar;
        var face = A && typeof A.html === 'function' ? A.html({ id: it.id, name: it.name, size: 24, level: it.level }) : '<span class="edt-face" aria-hidden="true">' + esc(it.name.slice(0, 1)) + '</span>';
        return '<button type="button"' + attrs + '>' + face /* safe: CommonsAvatar.html 自己转义，回退分支已 esc */ + '<span class="edt-pop-copy"><b>' + esc(it.name) + '</b><small>L' + Number(it.level) + ' · ' + esc(it.note) + '</small></span></button>';
      }
      if (p.type === 'emoji') {
        return '<button type="button"' + attrs + ' title="' + esc(it.label) + '" style="--edt-emoji:' + esc(it.color) + '"><span class="edt-emoji-ico">' + R().emoji.svg(it.name, 22) + '</span><small>' + esc(it.label) + '</small></button>';
      }
      if (p.type === 'card') {
        return '<button type="button"' + attrs + '><span class="edt-pop-kind">' + esc(CARD_KIND[it.kind] || '知识卡') + '</span><span class="edt-pop-copy"><b>' + esc(it.title) + '</b><small>' + esc(CARD_STATUS[it.status] || '') + (it.corroboration ? ' · 佐证 ' + Number(it.corroboration) + ' 人' : '') + '</small></span></button>';
      }
      return '';
    }).join('');
  }

  function paintPop(inst) {
    var p = inst.pop;
    if (!p) return;
    var box = inst.layer.querySelector('.edt-pop');
    var fresh = !box;
    if (fresh) { box = el('div', 'edt-pop'); inst.layer.appendChild(box); }
    box.dataset.type = p.type;
    var labels = { slash: '插入块', mention: '提及成员', emoji: '插入表情', card: '引用知识卡', html: '插入 HTML 作品' };
    if (p.type === 'html') {
      if (fresh || !box.querySelector('[data-html-form]')) {
        box.innerHTML = '<div class="edt-pop-head"><b>插入 HTML 作品</b><button type="button" class="button ghost icon-only small" data-edt-act="pop-close" aria-label="关闭">' + ico('close', 16) + '</button></div>' +
          '<div class="edt-html-form" data-html-form>' +
          '<div class="field"><label for="edt-html-title-' + esc(inst.id) + '">作品名</label><input id="edt-html-title-' + esc(inst.id) + '" data-html-title maxlength="60" placeholder="比如：检查点看板"></div>' +
          '<div class="field"><label for="edt-html-src-' + esc(inst.id) + '">粘贴 HTML</label><textarea id="edt-html-src-' + esc(inst.id) + '" data-html-src rows="5" placeholder="<!doctype html>…"></textarea><small>不超过 2MB。在沙箱里跑，不能联网，不会发给外部模型。</small></div>' +
          '<p class="edt-upload-err" data-html-err role="alert" hidden></p>' +
          '<div class="edt-pop-actions"><label class="button small"><input type="file" accept=".html,.htm,text/html" hidden data-html-file>' + ico('upload', 16) + '选文件</label><button type="button" class="button primary small" data-html-insert>插入</button></div></div>';
        bindHtmlForm(inst, box);
      }
    } else if (p.type === 'card') {
      if (fresh || !box.querySelector('[data-card-q]')) {
        box.innerHTML = '<div class="edt-pop-head"><b>引用知识卡</b></div>' +
          '<label class="edt-pop-search">' + ico('search', 16) + '<input data-card-q placeholder="搜知识地图里的标题" aria-label="搜知识卡" aria-controls="edt-pop-list-' + esc(inst.id) + '"></label>' +
          '<div class="edt-pop-list" id="edt-pop-list-' + esc(inst.id) + '" role="listbox" aria-label="知识卡"></div><p class="edt-pop-foot">↑↓ 选择 · ↵ 引用 · Esc 关闭</p>';
        var q = box.querySelector('[data-card-q]');
        q.addEventListener('input', function () { p.query = q.value; p.items = matchCards(q.value); p.index = 0; box.querySelector('.edt-pop-list').innerHTML = popItemsHTML(inst); });
        q.addEventListener('keydown', function (e) { if (popKey(inst, e)) e.preventDefault(); });
      }
      box.querySelector('.edt-pop-list').innerHTML = popItemsHTML(inst);
    } else {
      var foot = p.type === 'emoji' ? '←→↑↓ 选择 · ↵ 插入 · Esc 关闭' : '↑↓ 选择 · ↵ 插入 · Esc 关闭';
      box.innerHTML = '<div class="edt-pop-list" role="listbox" id="edt-pop-list-' + esc(inst.id) + '" aria-label="' + labels[p.type] + '"' + (p.type === 'emoji' ? ' data-grid' : '') + '>' + popItemsHTML(inst) + '</div><p class="edt-pop-foot">' + foot + '</p>';
    }
    var view = inst.editor && inst.editor.view;
    if (view) {
      view.dom.setAttribute('aria-expanded', 'true');
      view.dom.setAttribute('aria-controls', 'edt-pop-list-' + inst.id);
      if (p.trigger && p.items.length) view.dom.setAttribute('aria-activedescendant', 'edt-opt-' + inst.id + '-' + p.index);
    }
    reposition(inst);
    if (fresh && !reduced()) box.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 160, easing: 'cubic-bezier(.23, 1, .32, 1)' });
    var active = box.querySelector('.is-active');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
  }

  function reposition(inst) {
    var ed = inst.editor;
    if (!ed) return;
    var host = inst.main.getBoundingClientRect();
    var box = inst.layer.querySelector('.edt-pop');
    if (box && inst.pop) {
      var at = Math.min(inst.pop.from, ed.state.doc.content.size);
      var c;
      try { c = ed.view.coordsAtPos(at); } catch (e) { return; }
      var w = box.offsetWidth, h = box.offsetHeight;
      var x = Math.max(8, Math.min(c.left - host.left - 8, host.width - w - 8));
      var below = c.bottom + 8 + h <= G.innerHeight - 8 || c.top - h - 8 < 8;
      box.style.left = Math.round(x) + 'px';
      box.style.top = Math.round(below ? c.bottom - host.top + 8 : c.top - host.top - h - 8) + 'px';
    }
    if (inst.bubbleShown) placeBubble(inst);
  }

  function closePop(inst) {
    var box = inst.layer.querySelector('.edt-pop');
    if (box) box.remove();
    inst.pop = null;
    var view = inst.editor && inst.editor.view;
    if (view) { view.dom.removeAttribute('aria-expanded'); view.dom.removeAttribute('aria-activedescendant'); view.dom.removeAttribute('aria-controls'); }
  }

  function popKey(inst, e) {
    var p = inst.pop;
    if (!p) return false;
    var n = p.items.length;
    if (e.key === 'Escape') { if (p.trigger) inst.dismissed = p.from; closePop(inst); if (inst.editor) inst.editor.commands.focus(); return true; }
    if (!n) return false;
    var step = 0;
    if (e.key === 'ArrowDown') step = p.cols;
    else if (e.key === 'ArrowUp') step = -p.cols;
    else if (e.key === 'ArrowRight' && p.cols > 1) step = 1;
    else if (e.key === 'ArrowLeft' && p.cols > 1) step = -1;
    if (step) { p.index = (p.index + step + n) % n; paintPop(inst); return true; }
    if (e.key === 'Enter' || (e.key === 'Tab' && p.trigger)) { pick(inst, p.index); return true; }
    return false;
  }

  function onKey(inst, e) {
    if (inst.pop && inst.pop.trigger && !e.isComposing) return popKey(inst, e);
    if (e.key === 'Escape' && inst.bubbleShown) { hideBubble(inst); return true; }
    return false;
  }

  function pick(inst, index) {
    var p = inst.pop;
    var ed = inst.editor;
    if (!p || !ed) return;
    var it = p.items[index];
    if (!it) return;
    var range = { from: p.from, to: p.to };
    if (p.type === 'slash') {
      if (isLive() && it && LIVE_SLASH_HIDE[it.id]) return;
      closePop(inst);
      var ch = ed.chain().focus().deleteRange(range);
      if (it.id === 'p') ch.setParagraph().run();
      else if (it.id === 'h2') ch.setHeading({ level: 2 }).run();
      else if (it.id === 'h3') ch.setHeading({ level: 3 }).run();
      else if (it.id === 'ul') ch.toggleBulletList().run();
      else if (it.id === 'ol') ch.toggleOrderedList().run();
      else if (it.id === 'quote') ch.toggleBlockquote().run();
      else if (it.id === 'code') ch.setCodeBlock({ language: 'text' }).run();
      else if (it.id === 'hr') ch.setHorizontalRule().run();
      else if (it.id === 'image' && isLive()) { ch.run(); pickImages(inst); }
      else if (it.id === 'image') { ch.insertContent({ type: 'image', attrs: { src: '', caption: '' } }).run(); focusUpload(inst); }
      else if (it.id === 'emoji') ch.insertContent(':').run();
      else if (it.id === 'mention') ch.insertContent('@').run();
      else if (it.id === 'card' || it.id === 'html') {
        ch.run();
        var at = ed.state.selection.from;
        inst.pop = { trigger: false, type: it.id, from: at, to: at, query: '', items: it.id === 'card' ? matchCards('') : [], index: 0, cols: 1 };
        paintPop(inst);
        var focus = inst.layer.querySelector(it.id === 'card' ? '[data-card-q]' : '[data-html-title]');
        if (focus) focus.focus();
      }
      return;
    }
    if (p.type === 'mention') { closePop(inst); ed.chain().focus().deleteRange(range).insertContent([{ type: 'mention', attrs: { id: it.id, label: it.name, handle: it.handle || '' } }, { type: 'text', text: ' ' }]).run(); return; }
    if (p.type === 'emoji') { closePop(inst); ed.chain().focus().deleteRange(range).insertContent({ type: 'emoji', attrs: { name: it.name } }).run(); return; }
    if (p.type === 'card') { closePop(inst); ed.chain().focus().setTextSelection(p.from).insertContent({ type: 'knowledgeCard', attrs: { refId: it.id } }).run(); toast('已引用知识卡。读者看不到这张卡时，只会看到「这张卡你现在看不到」。'); }
  }

  function focusUpload(inst) {
    setTimeout(function () {
      var figs = inst.surface.querySelectorAll('.edt-figure.is-empty');
      var f = figs[figs.length - 1];
      var b = f && f.querySelector('label.button');
      if (b) { b.setAttribute('tabindex', '0'); b.focus(); }
    }, 0);
  }

  function bindHtmlForm(inst, box) {
    var title = box.querySelector('[data-html-title]');
    var src = box.querySelector('[data-html-src]');
    var err = box.querySelector('[data-html-err]');
    var file = box.querySelector('[data-html-file]');
    var fail = function (m) { err.hidden = false; err.textContent = m; };
    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      if (!f) return;
      if (f.size > HTML_MAX) { fail('超过 2MB，没有读进来。可以压缩图片或拆成几页。'); return; }
      f.text().then(function (s) { src.value = s; if (!title.value) title.value = f.name.replace(/\.html?$/i, '').slice(0, 60); err.hidden = true; }, function () { fail('读不出这个文件。'); });
    });
    box.querySelector('[data-html-insert]').addEventListener('click', function () {
      var html = src.value;
      if (!html.trim()) { fail('先粘贴 HTML 或选一个文件。'); src.focus(); return; }
      var bytes = bytesOf(html);
      if (bytes > HTML_MAX) { fail('超过 2MB（现在 ' + (bytes / 1048576).toFixed(1) + 'MB），没有插入。'); return; }
      var name = title.value.trim() || '未命名作品';
      var id = uid('hw-');
      var kept = putWork(id, { title: name, html: html });
      var at = inst.pop ? inst.pop.from : null;
      closePop(inst);
      var ch = inst.editor.chain().focus();
      if (typeof at === 'number') ch = ch.setTextSelection(at);
      ch.insertContent({ type: 'htmlWork', attrs: { workId: id, title: name, bytes: bytes } }).run();
      if (!kept) toast('作品太大，本机存不下，这次打开期间还能看。正式上线后会传到作品存储区。');
    });
    box.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); closePop(inst); inst.editor.commands.focus(); } });
  }

  /* ---------- 浮动工具条 ---------- */
  var BUBBLE = [
    { cmd: 'bold', label: '加粗', key: '⌘B', icon: 'bold' },
    { cmd: 'italic', label: '斜体', key: '⌘I', icon: 'italic' },
    { cmd: 'code', label: '行内代码', key: '⌘E', icon: 'icode' },
    { cmd: 'link', label: '链接', key: '', icon: 'link' },
    { cmd: 'highlight', label: '高亮', key: '⌘⇧H', icon: 'mark' }
  ];

  function wantBubble(inst) {
    var ed = inst.editor;
    if (!ed || inst.pop) return false;
    var sel = ed.state.selection;
    if (sel.empty || !sel.$from || typeof sel.node !== 'undefined' && sel.node) return false;
    if (sel.$from.parent.type.name === 'codeBlock') return false;
    if (!ed.isFocused && !inst.layer.contains(document.activeElement)) return false;
    return ed.state.doc.textBetween(sel.from, sel.to, ' ', ' ').trim().length > 0;
  }

  function paintBubble(inst) {
    if (inst.bubbleMode === 'link' && inst.bubbleShown) return;
    if (!wantBubble(inst)) { hideBubble(inst); return; }
    var ed = inst.editor;
    var box = inst.layer.querySelector('.edt-bubble');
    var fresh = !box;
    if (fresh) { box = el('div', 'edt-bubble'); box.setAttribute('role', 'toolbar'); box.setAttribute('aria-label', '文字格式'); inst.layer.appendChild(box); }
    inst.bubbleMode = 'tools';
    box.innerHTML = BUBBLE.map(function (b) {
      var on = ed.isActive(b.cmd === 'code' ? 'code' : b.cmd);
      return '<button type="button" class="edt-bubble-btn" data-edt-act="bubble" data-cmd="' + b.cmd + '" aria-pressed="' + (on ? 'true' : 'false') + '" aria-label="' + b.label + '" title="' + b.label + (b.key ? ' ' + b.key : '') + '">' + ico(b.icon, 16) + '</button>';
    }).join('');
    inst.bubbleShown = true;
    placeBubble(inst);
    if (fresh && !reduced()) box.animate([{ opacity: 0, transform: 'translateY(4px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 160, easing: 'cubic-bezier(.23, 1, .32, 1)' });
  }

  function placeBubble(inst) {
    var box = inst.layer.querySelector('.edt-bubble');
    var ed = inst.editor;
    if (!box || !ed) return;
    var sel = ed.state.selection;
    var a, b;
    try { a = ed.view.coordsAtPos(sel.from); b = ed.view.coordsAtPos(sel.to, -1); } catch (e) { return; }
    var host = inst.main.getBoundingClientRect();
    var w = box.offsetWidth, h = box.offsetHeight;
    var mid = a.top === b.top ? (a.left + b.right) / 2 : a.left + 40;
    var x = Math.max(8, Math.min(mid - host.left - w / 2, host.width - w - 8));
    var above = a.top - h - 10 >= 8;
    box.style.left = Math.round(x) + 'px';
    box.style.top = Math.round(above ? a.top - host.top - h - 10 : b.bottom - host.top + 10) + 'px';
  }

  function hideBubble(inst) {
    var box = inst.layer.querySelector('.edt-bubble');
    if (box) box.remove();
    inst.bubbleShown = false;
    inst.bubbleMode = 'tools';
  }

  function bubbleAction(inst, cmd) {
    var ed = inst.editor;
    if (!ed) return;
    if (cmd === 'bold') ed.chain().focus().toggleBold().run();
    else if (cmd === 'italic') ed.chain().focus().toggleItalic().run();
    else if (cmd === 'code') ed.chain().focus().toggleCode().run();
    else if (cmd === 'highlight') ed.chain().focus().toggleMark('highlight').run();
    else if (cmd === 'link') { linkForm(inst); return; }
    paintBubble(inst);
  }

  function linkForm(inst) {
    var ed = inst.editor;
    var box = inst.layer.querySelector('.edt-bubble');
    if (!box) return;
    inst.bubbleMode = 'link';
    var current = ed.getAttributes('link').href || '';
    box.innerHTML = '<div class="edt-link" data-link-form><label class="edt-link-field">' + ico('link', 16) + '<input type="text" inputmode="url" data-link-input placeholder="https:// 或 #/threads/…" aria-label="链接地址" value="' + esc(current) + '"></label>' +
      '<button type="button" class="button primary small" data-link-ok>确定</button>' +
      (current ? '<button type="button" class="button ghost icon-only small" data-link-remove aria-label="去掉链接" title="去掉链接">' + ico('unlink', 16) + '</button>' : '') +
      '<p class="edt-link-err" data-link-err role="alert" hidden>只支持站内 #/ 或 http(s) 链接。</p></div>';
    placeBubble(inst);
    var input = box.querySelector('[data-link-input]');
    var err = box.querySelector('[data-link-err]');
    var apply = function () {
      var raw = input.value.trim();
      if (!raw) { ed.chain().focus().extendMarkRange('link').unsetLink().run(); inst.bubbleMode = 'tools'; paintBubble(inst); return; }
      var href = '';
      if (raw.charAt(0) === '#') href = R() && R().safeHash ? R().safeHash(raw) : '';
      else {
        if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = 'https://' + raw;
        href = R() ? R().safeLink(raw) : '';
      }
      if (!href) { err.hidden = false; input.focus(); placeBubble(inst); return; }
      var attrs = href.charAt(0) === '#' ? { href: href, target: null, rel: null } : { href: href, target: '_blank', rel: 'noopener nofollow ugc' };
      ed.chain().focus().extendMarkRange('link').setLink(attrs).run();
      inst.bubbleMode = 'tools';
      paintBubble(inst);
    };
    box.querySelector('[data-link-ok]').addEventListener('click', apply);
    var rm = box.querySelector('[data-link-remove]');
    if (rm) rm.addEventListener('click', function () { ed.chain().focus().extendMarkRange('link').unsetLink().run(); inst.bubbleMode = 'tools'; paintBubble(inst); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); apply(); }
      else if (e.key === 'Escape') { e.preventDefault(); inst.bubbleMode = 'tools'; ed.commands.focus(); paintBubble(inst); }
    });
    input.addEventListener('input', function () { err.hidden = true; });
    input.focus();
    input.select();
  }

  function destroyInst(inst) {
    if (inst.destroyed) return;
    flush(inst);
    inst.destroyed = true;
    inst.uploads.forEach(function (u) { if (u.abort) u.abort.abort(); });
    inst.off.forEach(function (fn) { fn(); });
    closePop(inst);
    hideBubble(inst);
    if (inst.editor) { inst.editor.destroy(); inst.editor = null; }
    instances = instances.filter(function (x) { return x !== inst; });
  }

  /* ---------- schema 白名单（给 BE-1） ---------- */
  function schema() {
    var str = function (max, extra) { return Object.assign({ type: 'string', max: max }, extra || {}); };
    var id = { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' };
    return {
      version: 1,
      format: 'tiptap-json',
      editor: 'Tiptap 3.31.4（StarterKit 去掉 strike、underline；heading 只留 2/3 级）',
      nodes: {
        doc: { content: 'block+' },
        paragraph: { group: 'block', content: 'inline*' },
        heading: { group: 'block', content: 'inline*', attrs: { level: { type: 'int', enum: [2, 3], default: 2 } } },
        bulletList: { group: 'block', content: 'listItem+' },
        orderedList: { group: 'block', content: 'listItem+', attrs: { start: { type: 'int', min: 1, max: 9999, default: 1 }, type: { type: 'null', note: 'Tiptap 自带，存 null；服务端置 null' } } },
        listItem: { content: 'paragraph block*' },
        blockquote: { group: 'block', content: 'block+' },
        codeBlock: { group: 'block', content: 'text*', marks: 'none', attrs: { language: { type: 'enum', enum: (R() ? R().langs : []).map(function (l) { return l.id; }), default: 'text', note: '不在表里的一律改成 text' } } },
        horizontalRule: { group: 'block' },
        image: { group: 'block', atom: true, attrs: {
          src: { type: 'url', allow: ['https://…', 'http://…', '/站内路径（不含 ..）'], draftOnly: ['data:image/(png|jpeg|gif|webp);base64,…'], note: '发布时服务端把 data: 换成上传后的地址；SVG 一律拒绝；空 src 的占位图发布时去掉' },
          alt: str(120, { nullable: true }), title: str(120, { nullable: true }),
          width: { type: 'int', min: 1, max: 20000, nullable: true }, height: { type: 'int', min: 1, max: 20000, nullable: true },
          caption: str(200, { default: '' })
        } },
        knowledgeCard: { group: 'block', atom: true, attrs: { refId: id }, note: '只存引用，不存标题；渲染时按读者权限解析，无权显示「这张卡你现在看不到」' },
        htmlWork: { group: 'block', atom: true, attrs: { workId: id, title: str(60), bytes: { type: 'int', min: 0, max: HTML_MAX } }, note: 'HTML 正文不进文档 JSON，存用户内容区（BE-1 §2），≤ 2MB' },
        text: { group: 'inline' },
        hardBreak: { group: 'inline' },
        emoji: { group: 'inline', atom: true, attrs: { name: { type: 'enum', enum: (R() ? R().emoji.list : []).map(function (e) { return e.name; }) } }, note: '与 CommonsReact 的 12 个反应同名' },
        mention: { group: 'inline', atom: true, attrs: { id: id, handle: str(32), label: str(32) }, note: '服务端按 id 回填当前显示名' }
      },
      marks: {
        bold: {},
        italic: {},
        code: { note: '与其他标记互斥' },
        highlight: { tag: 'mark' },
        link: { attrs: { href: { type: 'url-or-hash', protocols: ['http', 'https', 'hash'], required: true }, target: { optional: true }, rel: { optional: true }, class: { type: 'null' } } }
      },
      limits: { maxDepth: 40, maxNodes: 20000, htmlWorkBytes: HTML_MAX, imageUploadBytes: IMAGE_MAX },
      envelope: {
        id: id, kind: { type: 'enum', enum: Object.keys(KINDS) }, title: str(120), doc: 'tiptap-json', version: { type: 'int', note: '每次文档变更 +1，onChange 同时给出 ProseMirror steps，留给 Yjs' },
        visibility: { scope: { type: 'enum', enum: ['private', 'people', 'members', 'level', 'space', 'public'], note: 'public 内测期不开放，服务端应拒收（具体错误码由 BE-1 定）' }, level: { type: 'int', enum: [2, 3, 4, 5], nullable: true }, space: { type: 'string', nullable: true }, people: { type: 'array', of: 'memberId' } },
        aigc: { type: 'enum', enum: ['none', 'assist', 'generated'] },
        status: { type: 'enum', enum: ['draft', 'published'] }, updatedAt: 'ISO-8601 UTC', publishedAt: 'ISO-8601 UTC'
      }
    };
  }

  G.CommonsEditor = {
    mount: mount,
    schema: schema,
    load: needTiptap,
    demo: { id: DEMO_ID, doc: demoDoc, title: DEMO_TITLE, members: MEMBERS, spaces: SPACES },
    destroyAll: function () { instances.slice().forEach(destroyInst); }
  };

  /* ---------- 演示页模块：#/write、#/read/<id> ---------- */
  var page = { inst: null, reader: false, writeKind: '', writeAct: null };

  function routeId() {
    var parts = String(location.hash || '').replace(/^#\/?/, '').split('/');
    try { return decodeURIComponent(parts[1] || ''); } catch (e) { return ''; }
  }

  function writeRoute() {
    if (isLive()) {
      var editId = routeId();
      if (editId && liveWrite.id === editId && liveWrite.loading) {
        return '<section class="edt-page" data-edt-page="write"><p role="status">正在读取原文…</p></section>';
      }
      if (editId && liveWrite.id === editId && liveWrite.error) {
        return '<section class="edt-page" data-edt-page="write"><p role="alert">' + esc(liveWrite.error) + '</p><button type="button" class="button" data-edt-retry-write>重试</button></section>';
      }
      return '<section class="edt-page" data-edt-page="write"><header class="edt-page-head"><div class="edt-write-head"><h1>' + (editId ? '编辑' : '写点什么') + '</h1>' +
        (editId ? '' : writeTypeBar()) +
        '</div></header><div data-edt-host></div><p role="alert" data-edt-live-error></p></section>';
    }
    return '<section class="edt-page" data-edt-page="write">' +
      '<header class="edt-page-head"><div class="edt-title-row"><h1>写点什么</h1>' + (isLive() ? '' : '<span class="pill outline">示例</span>') + '</div></header>' +
      '<div data-edt-host></div></section>';
  }

  var liveRead = { id: '', data: null, loading: false, error: '', seq: 0 };
  function refreshPage() { if (G.Commons && typeof G.Commons.refresh === 'function') G.Commons.refresh(); }
  function loadLiveRead(id) {
    var seq = ++liveRead.seq;
    liveRead.id = id; liveRead.data = null; liveRead.error = ''; liveRead.loading = true;
    refreshPage();
    Promise.resolve().then(function () {
      if (!G.CommonsAPI || typeof G.CommonsAPI.get !== 'function') throw new Error('没有接上接口。');
      return G.CommonsAPI.get('/content/objects/' + encodeURIComponent(id));
    }).then(function (response) {
      if (seq !== liveRead.seq) return;
      var row = response && response.data;
      if (row) {
        var content = row.content || {};
        var author = row.author || {};
        liveRead.data = {
          doc: content.doc || { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: content.body || '' }] }] },
          title: row.title, kind: row.type, summary: content.summary || '', aigc: content.aigc || 'none',
          author: { id: author.id, name: author.display_name || author.name || '', handle: author.handle || '', level: author.level || 1 },
          visibility: { scope: row.visibility, level: row.min_level, space: row.space_id },
          publishedAt: row.published_at, cards: row.cards, assets: row.assets, stats: row.stats, mine: row.mine,
          tags: row.tags || content.tags || [], etag: row.etag || '', local: false
        };
      }
      liveRead.loading = false; refreshPage();
    }).catch(function (error) {
      if (seq !== liveRead.seq) return;
      liveRead.loading = false; liveRead.data = null;
      liveRead.error = (error && error.message) || '内容没有载入。'; refreshPage();
    });
  }
  function writeOpts(extra) {
    var opts = { idempotencyKey: G.CommonsAPI && G.CommonsAPI.newIdempotencyKey() };
    if (extra) Object.keys(extra).forEach(function (k) { opts[k] = extra[k]; });
    return opts;
  }
  function visBody(env) {
    var vis = env.visibility || {};
    return {
      visibility: vis.scope === 'people' ? 'named' : (vis.scope === 'private' || !vis.scope ? 'members' : vis.scope),
      min_level: Number(vis.level) || 1,
      space_id: vis.scope === 'space' ? vis.space : null,
      acl: vis.scope === 'people' ? (vis.people || []) : []
    };
  }
  function isOwnArticle(d) {
    var me = G.CommonsSession && G.CommonsSession.me;
    return !!(isLive() && me && d && d.author && d.author.id && me.id === d.author.id);
  }
  var liveWrite = { id: '', data: null, loading: false, error: '', seq: 0, etag: '', visLocked: false };
  var LIVE_SCOPES = ['members', 'level'];
  function loadLiveWrite(id) {
    var seq = ++liveWrite.seq;
    liveWrite.id = id; liveWrite.data = null; liveWrite.error = ''; liveWrite.loading = true; liveWrite.etag = ''; liveWrite.visLocked = false;
    refreshPage();
    Promise.resolve().then(function () {
      if (!G.CommonsAPI || typeof G.CommonsAPI.get !== 'function') throw new Error('没有接上接口。');
      return G.CommonsAPI.get('/objects/' + encodeURIComponent(id));
    }).then(function (response) {
      if (seq !== liveWrite.seq) return;
      var row = response && response.data;
      if (row) {
        var content = row.content || {};
        liveWrite.etag = row.etag || '';
        liveWrite.visLocked = LIVE_SCOPES.indexOf(row.visibility || 'members') < 0;
        liveWrite.data = {
          doc: content.doc || { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: content.body || '' }] }] },
          title: row.title, kind: row.type, aigc: content.aigc || 'none',
          visibility: { scope: row.visibility === 'named' ? 'people' : (row.visibility || 'members'), level: row.min_level, space: row.space_id, people: row.acl || [] }
        };
      }
      liveWrite.loading = false; refreshPage();
    }).catch(function (error) {
      if (seq !== liveWrite.seq) return;
      liveWrite.loading = false; liveWrite.data = null;
      liveWrite.error = (error && error.message) || '原文没有载入。'; refreshPage();
    });
  }
  function patchLive(id, etag, env) {
    var errorNode = document.querySelector('[data-edt-live-error]');
    if (errorNode) errorNode.textContent = '';
    return Promise.resolve().then(function () {
      if (!G.CommonsAPI || typeof G.CommonsAPI.patch !== 'function') throw new Error('没有接上接口，请重试。');
      var body = { title: env.title, content: { doc: env.doc, aigc: env.aigc || 'none' } };
      if (!liveWrite.visLocked) Object.assign(body, visBody(env));
      return G.CommonsAPI.patch('/objects/' + encodeURIComponent(id), body, writeOpts({ ifMatch: etag || undefined }));
    }).then(function (response) {
      location.hash = '#/read/' + encodeURIComponent(id);
      return response && response.data;
    }).catch(function (error) {
      if (errorNode) errorNode.textContent = (error && error.message) || '没有保存成功，请重试。';
      throw error;
    });
  }
  function withdrawLive(id, box) {
    if (!G.CommonsAPI || !id) return;
    var buttons = box ? box.querySelectorAll('[data-edt-act="withdraw-yes"], [data-edt-act="withdraw-no"]') : [];
    Array.prototype.forEach.call(buttons, function (btn) { btn.disabled = true; });
    return G.CommonsAPI.post('/objects/' + encodeURIComponent(id) + '/withdraw', { reason_code: 'author_request' }, writeOpts())
      .then(function () {
        toast('已撤回。');
        location.hash = '#/write';
      }).catch(function (error) {
        Array.prototype.forEach.call(buttons, function (btn) { btn.disabled = false; });
        toast((error && (error.status === 501 || error.code === 'capability_unavailable')) ? '这个功能还没开放' : ((error && error.message) || '没有撤回。'));
      });
  }
  /* 同一份内容在成功前复用同一个幂等键：断网重试不会重复发帖；内容一改就换新键。 */
  var publishKey = { sig: '', key: '' };
  function publishKeyFor(body) {
    var sig = JSON.stringify(body);
    if (publishKey.sig !== sig || !publishKey.key) publishKey = { sig: sig, key: G.CommonsAPI.newIdempotencyKey() };
    return publishKey.key;
  }
  function publishLive(env) {
    var errorNode = document.querySelector('[data-edt-live-error]');
    if (errorNode) errorNode.textContent = '';
    return Promise.resolve().then(function () {
      if (!G.CommonsAPI || typeof G.CommonsAPI.post !== 'function') throw new Error('没有接上接口，请重试发布。');
      var body = Object.assign({
        type: env.kind, title: env.title, content: { doc: env.doc, aigc: env.aigc || 'none' }
      }, visBody(env));
      return G.CommonsAPI.post('/objects', body, { idempotencyKey: publishKeyFor(body) });
    }).then(function (response) {
      if (!response || !response.data || !response.data.id) throw new Error('发布响应不完整，请重试。');
      publishKey = { sig: '', key: '' };
      location.hash = '#/read/' + encodeURIComponent(response.data.id);
      return response.data;
    }).catch(function (error) {
      if (errorNode) errorNode.textContent = (error && error.message) || '没有发布成功，请重试发布。';
      throw error;
    });
  }

  function readerData(id) {
    if (isLive()) return liveRead.id === id ? liveRead.data : null;
    var pub = store.read('editor.published.' + id, null);
    if (pub && pub.doc && typeof pub.doc === 'object') {
      return { doc: pub.doc, title: pub.title, kind: pub.kind, visibility: pub.visibility, aigc: pub.aigc, publishedAt: pub.publishedAt, local: true };
    }
    if (id === DEMO_ID) return { doc: clean(demoDoc(), true), title: DEMO_TITLE, kind: 'knowledge', visibility: { scope: 'members' }, aigc: 'assist', publishedAt: sample().publishedAt, local: false };
    return null;
  }

  function readRoute() {
    var id = routeId();
    if (isLive() && (liveRead.id !== id || liveRead.loading || liveRead.error)) {
      return '<section class="edt-read" data-edt-page="read"><p role="status">' + esc(liveRead.id === id && liveRead.error || '正在读取内容…') + '</p>' +
        (liveRead.id === id && liveRead.error ? '<button type="button" class="button" data-edt-retry>重试</button>' : '') + '</section>';
    }
    var d = /^[A-Za-z0-9_-]{1,64}$/.test(id) ? readerData(id) : null;
    if (!d || !R()) {
      return '<section class="edt-read" data-edt-page="read"><div class="edt-missing" role="status">' + ico('lock', 24) + '<h1>没有找到这篇</h1><p>可能还没发布、已经撤回，或者你现在看不到它。</p><a class="button" href="#/write">去写点什么</a></div></section>';
    }
    var saved = store.read('reader.saved', []);
    var meta = readerMeta(id, d, Array.isArray(saved) && saved.indexOf(id) >= 0);
    return '<section class="edt-read" data-edt-page="read" data-id="' + esc(id) + '">' +
      '<nav class="edt-read-nav"><a class="back" href="#/write">' + ico('pen', 16) + '回到编辑</a>' +
      (isOwnArticle(d) ? '<span class="edt-own"><button type="button" class="button" data-edt-act="edit-live">编辑</button><button type="button" class="button ghost" data-edt-act="withdraw-live">撤回</button>' +
        '<span class="edt-withdraw-ask" data-edt-withdraw-ask hidden><p>撤回后别人就看不到这篇文章了。确定撤回？</p>' +
        '<button type="button" class="button" data-edt-act="withdraw-yes">确定撤回</button>' +
        '<button type="button" class="button ghost" data-edt-act="withdraw-no">取消</button></span></span>' : '') +
      (d.local && !isLive() ? '<span class="pill">本机发布的版本</span>' : '') + '</nav>' +
      R().html(d.doc, meta) /* safe: CommonsReader.html 对文档里每个字符串都转义，链接/图片过白名单 */ + '</section>';
  }

  function readerMeta(id, d, saved) {
    if (isLive()) return {
      id: id, title: d.title, summary: d.summary || '', kind: d.kind, author: d.author,
      publishedAt: d.publishedAt, visibility: d.visibility, aigc: d.aigc,
      corroboration: 0, reproduced: 0, saved: !!(d.mine && d.mine.saved), sample: false,
      useful: !!(d.mine && d.mine.useful), tags: d.tags || [],
      reactions: { counts: d.stats && d.stats.reactions || {}, mine: d.mine && d.mine.reactions || {} },
      related: [], resolveCard: function (key) { return (d.cards || {})[key] || null; },
      resolveWork: function (key) { return (d.assets || {})[key] || null; }
    };
    var summary = DEMO_LEAD;
    if (d.local) summary = R().summary(d.doc, 110);
    return {
      id: id,
      title: d.title || '未命名',
      summary: summary,
      kind: d.kind || 'knowledge',
      author: DEMO_AUTHOR,
      publishedAt: d.publishedAt,
      visibility: d.visibility || { scope: 'members' },
      aigc: d.aigc || 'none',
      corroboration: sample().corroboration || 0,
      reproduced: sample().reproduced || 0,
      saved: saved,
      sample: true,
      reactions: sample().reactions || { counts: {}, mine: [] },
      related: sample().related || [],
      resolveCard: cardForReader,
      resolveWork: getWork
    };
  }

  function shareOpts(id, d) {
    var vis = R().visibility(d.visibility);
    if (isLive()) return { id: id, title: d.title, summary: d.summary || '', kind: d.kind, author: d.author, visibility: d.visibility, scopeLabel: vis.label, compare: false, sample: false };
    return { id: id, title: d.title, summary: d.local ? R().summary(d.doc, 90) : DEMO_LEAD, kind: d.kind || 'knowledge', author: DEMO_AUTHOR, visibility: d.visibility, scopeLabel: vis.label, compare: true, sample: true };
  }

  function pageMount() {
    if (isLive()) {
      var retry = document.querySelector('[data-edt-retry]');
      if (retry) retry.onclick = function () { loadLiveRead(routeId()); };
      var retryW = document.querySelector('[data-edt-retry-write]');
      if (retryW) retryW.onclick = function () { loadLiveWrite(routeId()); };
      if (location.hash.indexOf('#/read/') === 0 && liveRead.id !== routeId()) loadLiveRead(routeId());
      if (location.hash.indexOf('#/write/') === 0 && routeId() && liveWrite.id !== routeId()) loadLiveWrite(routeId());
    }
    var w = document.querySelector('[data-edt-page="write"] [data-edt-host]');
    if (w && !page.inst) {
      if (isLive()) {
        var editId = routeId();
        if (editId && liveWrite.id === editId && liveWrite.data) {
          var wd = liveWrite.data;
          page.inst = mount(w, {
            id: editId, kind: wd.kind || 'knowledge', doc: wd.doc, title: wd.title,
            visibility: wd.visibility, visibilityLocked: liveWrite.visLocked, aigc: wd.aigc, sample: false, draft: false,
            onPublish: function (env) { return patchLive(editId, liveWrite.etag, env); }
          });
        } else if (!editId) {
          if (!page.writeKind) page.writeKind = defaultWriteKind();
          page.inst = mount(w, { kind: page.writeKind, sample: false, draft: false, onPublish: publishLive });
        }
      } else {
        page.inst = mount(w, { id: DEMO_ID, kind: 'knowledge', doc: demoDoc(), title: DEMO_TITLE, visibility: { scope: 'members' }, aigc: 'assist', resetDoc: demoDoc, sample: false });
      }
    }
    var writePage = document.querySelector('[data-edt-page="write"]');
    if (writePage) {
      writePage.addEventListener('click', onWriteAct);
      page.writeAct = onWriteAct;
    }
    var r = document.querySelector('[data-edt-page="read"][data-id]');
    if (r && R()) {
      var id = r.dataset.id;
      var d = readerData(id);
      if (d) {
        R().mount(r, { resolveWork: isLive() ? function (key) { return (d.assets || {})[key] || null; } : getWork, share: shareOpts(id, d) });
        page.reader = true;
      }
      r.addEventListener('click', onReadAct);
      page.readAct = onReadAct;
    }
  }
  function onWriteAct(e) {
    var b = e.target && e.target.closest && e.target.closest('[data-edt-act="write-kind"]');
    if (!b || b.disabled) return;
    var kind = b.getAttribute('data-kind') || (b.dataset && b.dataset.kind) || '';
    if (!kind || kind === page.writeKind || !canDo('object.create.' + kind)) return;
    page.writeKind = kind;
    if (page.inst) { page.inst.destroy(); page.inst = null; }
    refreshPage();
  }

  function onReadAct(e) {
    var b = e.target && e.target.closest && e.target.closest('[data-edt-act]');
    if (!b) return;
    var box = b.closest('[data-edt-page="read"]');
    var oid = box && box.dataset ? box.dataset.id : '';
    if (b.dataset.edtAct === 'edit-live' && oid) location.hash = '#/write/' + encodeURIComponent(oid);
    if (b.dataset.edtAct === 'withdraw-live' && oid) {
      var ask = box.querySelector('[data-edt-withdraw-ask]');
      if (ask) ask.hidden = false;
      b.hidden = true;
      return;
    }
    if (b.dataset.edtAct === 'withdraw-no') {
      var askNo = box.querySelector('[data-edt-withdraw-ask]');
      if (askNo) askNo.hidden = true;
      var start = box.querySelector('[data-edt-act="withdraw-live"]');
      if (start) start.hidden = false;
      return;
    }
    if (b.dataset.edtAct === 'withdraw-yes' && oid) withdrawLive(oid, box);
  }

  function pageDestroy() {
    if (page.writeAct) {
      var writeOld = document.querySelector('[data-edt-page="write"]');
      if (writeOld) writeOld.removeEventListener('click', page.writeAct);
      page.writeAct = null;
    }
    if (page.readAct) {
      var old = document.querySelector('[data-edt-page="read"]');
      if (old) old.removeEventListener('click', page.readAct);
      page.readAct = null;
    }
    if (page.inst) { page.inst.destroy(); page.inst = null; }
    if (page.reader && R()) { R().destroy(); page.reader = false; }
    if (G.CommonsShare) G.CommonsShare.close();
  }

  var module = {
    routes: { write: writeRoute, read: readRoute },
    nav: [['write', '写点什么', 'pen', 'practice']],
    icons: { pen: P.pen },
    mount: pageMount,
    destroy: pageDestroy,
    get instance() { return page.inst; }
  };
  G.CommonsEditorPage = module;
  (G.CommonsPages = G.CommonsPages || []).push(module);

  if (G.CommonsLinks && typeof G.CommonsLinks.provide === 'function') {
    G.CommonsLinks.provide('knowledge', function (handle) {
      var key = String(handle || '').replace(/^@+/, '').toLowerCase();
      if (!key) return null;
      var mine = MEMBERS.some(function (m) { return String(m.handle || '').toLowerCase() === key; });
      if (DEMO_AUTHOR.handle && String(DEMO_AUTHOR.handle).toLowerCase() === key) mine = true;
      if (!mine) return null;
      return { label: '知识条目', href: '#/write', count: 1, icon: 'book' };
    });
  }
})();
