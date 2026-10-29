/* R13 THREAD-1 · Discord 式评论 / 讨论串。
   接口：CommonsThread.mount(container, { targetId, messages, me, mode })
   页面：#/threads，自行登记 CommonsPages。 */
(function () {
  'use strict';

  var MERGE_MS = 5 * 60 * 1000;
  var ROW = 76;
  var WINDOW = 48;
  var LEVEL_NAMES = { 1: '新队员', 2: '队员', 3: '骨干', 4: '领航员', 5: '先锋' };
  var EMOJIS = [
    { id: 'up', label: '赞' },
    { id: 'useful', label: '有用' },
    { id: 'learned', label: '学到了' },
    { id: 'spark', label: '灵光' },
    { id: 'question', label: '疑问' },
    { id: 'reproduced', label: '复现了' },
    { id: 'favorite', label: '收藏' },
    { id: 'cheer', label: '加油' },
    { id: 'smile', label: '笑' },
    { id: 'heart', label: '心' },
    { id: 'seen', label: '看过' },
    { id: 'rocket', label: '火箭' }
  ];

  var bound = false;
  var hosts = [];
  var timers = [];
  var press = { id: '', t: 0 };

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function safeUrl(u) {
    var s = String(u || '');
    if (/^https?:\/\//i.test(s) || s.indexOf('#/') === 0) return esc(s);
    return '#';
  }

  function reduced() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function read(key, fallback) {
    if (window.Commons && typeof window.Commons.read === 'function') return window.Commons.read(key, fallback);
    return fallback;
  }

  function write(key, value) {
    if (window.Commons && typeof window.Commons.write === 'function') return window.Commons.write(key, value);
    return false;
  }

  function toast(msg) {
    if (window.Commons && typeof window.Commons.toast === 'function') window.Commons.toast(msg);
  }

  function modal(title, html) {
    if (window.Commons && typeof window.Commons.modal === 'function') window.Commons.modal(title, html);
  }

  function closeModal() {
    if (window.Commons && typeof window.Commons.closeModal === 'function') window.Commons.closeModal();
  }

  function avatar(o) {
    if (window.CommonsAvatar && typeof window.CommonsAvatar.html === 'function') {
      return window.CommonsAvatar.html(o && o.src ? Object.assign({ letter: false }, o) : o);
    }
    return '<span class="th-ava-fallback" aria-hidden="true">' + esc(String((o && o.name) || '?').charAt(0)) + '</span>';
  }

  function reactBar(o) {
    if (window.CommonsReact && typeof window.CommonsReact.bar === 'function') {
      return window.CommonsReact.bar(o);
    }
    return '';
  }

  function reactList() {
    if (window.CommonsReact && window.CommonsReact.list && window.CommonsReact.list.length) return window.CommonsReact.list;
    return EMOJIS;
  }

  function icon(name) {
    if (window.CommonsIcons && typeof window.CommonsIcons.svg === 'function') {
      var node = window.CommonsIcons.svg(name, { size: 16 });
      if (node) return node;
    }
    if (window.Commons && typeof window.Commons.icon === 'function') return window.Commons.icon(name);
    return '';
  }

  function isLive() {
    return !(location.protocol === 'file:' || (window.COMMONS_BUILD && window.COMMONS_BUILD.mode === 'demo'));
  }
  function sample() {
    if (isLive()) return { post: {}, me: { id: 'me', name: '我', level: 1 }, people: [], messages: [] };
    return window.COMMONS_THREAD_SAMPLE || { post: {}, me: { id: 'me', name: '我', level: 2 }, people: [], messages: [] };
  }

  function peopleOf(st) {
    var list = (st && st.people) || sample().people || [];
    if (Array.isArray(list)) return list;
    return Object.keys(list).map(function (k) {
      var p = list[k] || {};
      return Object.assign({ id: k }, p, { src: p.src || p.avatar });
    });
  }

  function person(st, id) {
    var list = peopleOf(st);
    var i;
    for (i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return { id: id, name: id, level: 1, levelName: LEVEL_NAMES[1] };
  }

  function levelName(lv) {
    return LEVEL_NAMES[Number(lv)] || ('L' + lv);
  }

  function lv() {
    return window.CommonsLevel || null;
  }

  /* safe-fn: CommonsLinks.person 约定自行转义；退路逐值转义并编码 handle */
  function personLink(handle, name, level) {
    if (window.CommonsLinks && typeof window.CommonsLinks.person === 'function') {
      return window.CommonsLinks.person(handle, name, { level: level });
    }
    if (!handle) return esc(name);
    var label = lv() && typeof lv().nameplate === 'function'
      ? lv().nameplate({ name: name, level: level, handle: handle })
      : esc(name);
    return '<a class="lk-person" href="#/u/' + encodeURIComponent(handle) + '">' + ( /* safe: label 来自 CommonsLevel.nameplate 或 esc */ label ) + '</a>';
  }

  /* safe-fn: Agent 只链到 Agent 广场详情，不冒充成员主页 */
  function agentLink(id, name) {
    return id
      ? '<a class="lk-person th-agent-link" href="#/agents/' + encodeURIComponent(id) + '">' + esc(name) + '</a>'
      : esc(name);
  }

  function identityLink(p, label) {
    if (!p) return esc(label || '');
    if (p.self) return '<a class="lk-person" href="#/me">' + esc(label || p.name) + '</a>';
    return p.kind === 'agent' ? agentLink(p.id, label || p.name) : personLink(p.handle, label || p.name, p.level);
  }

  function inlineMention(p) {
    var label = '@' + p.name;
    if (p.self) return '<a class="lk-person" href="#/me">' + esc(label) + '</a>';
    if (p.kind === 'agent') return agentLink(p.id, label);
    return p.handle
      ? '<a class="lk-person" href="#/u/' + encodeURIComponent(p.handle) + '">' + esc(label) + '</a>'
      : esc(label);
  }

  function isMember(p) {
    return !!p && p.kind !== 'agent';
  }

  // 等级只改外观，不参与排序或折叠；采纳和「最有用」的强调高于等级
  function levelMarks(st) {
    var top = '';
    var best = 2;
    var seen = {};
    var first = {};
    sortByTime(st.messages).forEach(function (m) {
      if (m.status === 'deleted' || m.status === 'hidden' || m.status === 'failed' || m.status === 'sending') return;
      var u = (m.reactions && m.reactions.useful) || 0;
      if (u > best) { best = u; top = m.id; }
      if (!seen[m.authorId]) {
        var p = person(st, m.authorId);
        if (isMember(p) && Number(p.level) === 1) first[m.id] = true;
        seen[m.authorId] = true;
      }
    });
    return { useful: top, first: first };
  }

  function roleText(p) {
    if (p.kind === 'agent') return p.levelName || 'Agent';
    return 'L' + p.level + ' ' + (p.levelName || levelName(p.level));
  }

  function relTime(iso) {
    var t = Date.parse(iso);
    if (!t) return '';
    var now = Date.now();
    var d = Math.max(0, now - t);
    if (d < 60 * 1000) return '刚刚';
    if (d < 60 * 60 * 1000) return Math.floor(d / 60000) + ' 分钟前';
    if (d < 24 * 60 * 60 * 1000) return Math.floor(d / 3600000) + ' 小时前';
    var dt = new Date(t);
    return (dt.getMonth() + 1) + '.' + dt.getDate() + ' ' + String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0');
  }

  function absTime(iso) {
    var t = Date.parse(iso);
    if (!t) return '';
    var dt = new Date(t);
    var p = function (n) { return String(n).padStart(2, '0'); };
    return dt.getFullYear() + '-' + p(dt.getMonth() + 1) + '-' + p(dt.getDate()) + ' ' + p(dt.getHours()) + ':' + p(dt.getMinutes());
  }

  // 分段处理：先按「代码段 / 链接段 / 普通文本」切开，只在普通文本里换行和替换 @提及；每段只转义一次。
  function formatBody(text, st) {
    var tick = String.fromCharCode(96);
    var raw = String(text == null ? '' : text);
    var names = peopleOf(st).filter(function (p) { return p && esc(p.name); });
    names.sort(function (x, y) { return String(y.name).length - String(x.name).length; });
    var mentionRe = names.length
      ? new RegExp('@(' + names.map(function (p) { return esc(p.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|') + ')', 'g')
      : null;
    // Map 而不是普通对象：成员叫 constructor / toString / __proto__ 时不会撞上原型上的属性。
    var byName = new Map();
    names.forEach(function (p) { var key = esc(p.name); if (!byName.has(key)) byName.set(key, p); });
    function plain(seg) {
      var out = esc(seg).replace(/\n/g, '<br>');
      if (!mentionRe) return out;
      return out.replace(mentionRe, function (m, name) {
        return '<span class="th-mention">' + inlineMention(byName.get(name)) + '</span>';
      });
    }
    var tokens = raw.split(new RegExp('(' + tick + '[^' + tick + ']+' + tick + '|https?:\\/\\/[^\\s<' + tick + ']+)'));
    return tokens.map(function (seg, i) {
      if (i % 2 === 0) return plain(seg);
      if (seg.charAt(0) === tick) return '<code>' + esc(seg.slice(1, -1)).replace(/\n/g, '<br>') + '</code>';
      return '<a href="' + safeUrl(seg) + '" rel="noopener noreferrer">' + esc(seg) + '</a>';
    }).join('');
  }

  function avaStack(people) {
    if (window.CommonsAvatar && typeof window.CommonsAvatar.stack === 'function') {
      return window.CommonsAvatar.stack(people, { max: 3 });
    }
    return (people || []).slice(0, 3).map(function (p) { return avatar(p); }).join('');
  }

  function participantsOf(st, id) {
    var seen = {};
    var list = [];
    function walk(pid) {
      (st.tree.kids[pid] || []).forEach(function (m) {
        if (!seen[m.authorId]) {
          seen[m.authorId] = true;
          var p = person(st, m.authorId);
          list.push({ id: p.id, name: p.name, size: 20, level: p.level, src: p.src });
        }
        walk(m.id);
      });
    }
    walk(id);
    return list;
  }

  function treeGuides(depth, lastAt) {
    if (!depth) return '';
    var n = Math.min(depth, 4);
    var html = '<span class="th-tree" aria-hidden="true">';
    var i;
    lastAt = lastAt || [];
    for (i = 0; i < n; i += 1) {
      var cls = 'th-rail';
      if (i === n - 1) cls += ' is-hook';
      if (lastAt[i]) cls += ' is-last';
      html += '<i class="' + cls + '" data-r="' + esc(String(i)) + '"></i>';
    }
    return html + '</span>';
  }

  function reactHTML(st, msg) {
    if (msg.status === 'deleted' || (msg.status === 'hidden' && msg.authorId !== st.me.id)) return '';
    var raw = reactBar({ targetId: 'th:' + msg.id, counts: msg.reactions, mine: msg.mine });
    if (st.pickReact === msg.id || /ava-react-btn/.test(raw)) return raw;
    return '';
  }

  function alignScroll(sc) {
    if (!sc) return;
    var box = sc.getBoundingClientRect();
    var divider = sc.querySelector('.th-divider');
    if (divider) {
      var dr = divider.getBoundingClientRect();
      if (dr.bottom > box.top && dr.top < box.bottom) {
        sc.scrollTop += (dr.top - box.top);
        return;
      }
    }
    var nodes = sc.querySelectorAll('.th-msg, .th-expand');
    var i;
    var el;
    var r;
    for (i = 0; i < nodes.length; i += 1) {
      el = nodes[i];
      r = el.getBoundingClientRect();
      if (r.bottom <= box.top + 1) continue;
      if (r.top >= box.bottom - 1) break;
      sc.scrollTop += (r.top - box.top);
      return;
    }
  }

  function savedList() {
    var raw = read('thread.saved', []);
    return Array.isArray(raw) ? raw : [];
  }

  function isSaved(targetId, id) {
    return savedList().some(function (row) { return row.targetId === targetId && row.id === id; });
  }

  function usefulMap() {
    var raw = read('thread.useful', {});
    return raw && typeof raw === 'object' ? raw : {};
  }

  function draftKey(targetId) {
    return 'thread.draft.' + targetId;
  }

  function byIdMap(messages) {
    var map = {};
    (messages || []).forEach(function (m) { map[m.id] = m; });
    return map;
  }

  function sortByTime(messages) {
    return (messages || []).slice().sort(function (a, b) {
      return Date.parse(a.createdAt) - Date.parse(b.createdAt);
    });
  }

  function grouped(list) {
    return list.map(function (m, i) {
      var prev = list[i - 1];
      var pack = false;
      if (prev && prev.authorId === m.authorId && prev.status !== 'deleted' && m.status !== 'deleted' && !m.reply_to && !prev.reply_to) {
        pack = (Date.parse(m.createdAt) - Date.parse(prev.createdAt)) < MERGE_MS;
      }
      return { msg: m, pack: pack };
    });
  }

  function treeOf(messages) {
    var map = byIdMap(messages);
    var kids = {};
    var roots = [];
    sortByTime(messages).forEach(function (m) {
      if (m.reply_to && map[m.reply_to]) {
        if (!kids[m.reply_to]) kids[m.reply_to] = [];
        kids[m.reply_to].push(m);
      } else {
        roots.push(m);
      }
    });
    return { kids: kids, roots: roots, map: map };
  }

  function countDesc(kids, id) {
    var list = kids[id] || [];
    var n = list.length;
    list.forEach(function (m) { n += countDesc(kids, m.id); });
    return n;
  }

  function walkTree(st, node, depth, out, lastAt) {
    lastAt = lastAt || [];
    out.push({ msg: node, depth: depth, pack: false, lastAt: lastAt });
    var kids = st.tree.kids[node.id] || [];
    var n = countDesc(st.tree.kids, node.id);
    var nextDepth = Math.min(depth + 1, 4);
    if (n > 4 && !st.expanded[node.id]) {
      out.push({ more: n, parent: node.id, depth: nextDepth, lastAt: lastAt.concat([true]), people: participantsOf(st, node.id) });
      return;
    }
    kids.forEach(function (ch, i) {
      walkTree(st, ch, nextDepth, out, lastAt.concat([i === kids.length - 1]));
    });
    if (n > 4 && st.expanded[node.id]) {
      out.push({ more: n, parent: node.id, depth: nextDepth, collapse: true, lastAt: lastAt.concat([true]) });
    }
  }

  function visibleRows(st) {
    if (st.mode === 'tree') {
      var out = [];
      var src = st.subRoot && st.tree.map[st.subRoot] ? [st.tree.map[st.subRoot]] : st.tree.roots;
      src.forEach(function (r) { walkTree(st, r, 0, out); });
      return out;
    }
    return grouped(sortByTime(st.messages));
  }

  function windowSlice(rows, scroller) {
    if (scroller && scroller.closest('[data-thread-lab]')) return { start: 0, end: rows.length, top: 0, bot: 0 };
    if (rows.length <= WINDOW || !scroller) return { start: 0, end: rows.length, top: 0, bot: 0 };
    var h = scroller.clientHeight || 480;
    var t = scroller.scrollTop || 0;
    var start = Math.max(0, Math.floor(t / ROW) - 6);
    var end = Math.min(rows.length, start + Math.ceil(h / ROW) + 14);
    return { start: start, end: end, top: start * ROW, bot: (rows.length - end) * ROW };
  }

  function quoteHTML(st, msg) {
    var parent = st.map[msg.reply_to];
    var gone = !parent || parent.status === 'deleted';
    var q = msg.quote || {};
    var who = gone ? '' : (q.authorName || person(st, q.authorId || (parent && parent.authorId)).name);
    var excerpt = gone ? '原消息已删除' : String(q.excerpt || (parent && parent.body) || '').slice(0, 40);
    return '<button type="button" class="th-quote th-quote-jump" data-th-act="jump" data-id="' + esc(msg.reply_to || '') + '"' +
      (gone ? ' disabled' : '') + '><span class="th-quote-copy">' +
      (gone ? '↳ 原消息已删除' : '↳ 回复 ' + esc(who) + '：' + esc(excerpt)) + '</span></button>';
  }

  function actionsHTML(st, msg) {
    var mine = msg.authorId === st.me.id;
    var more = st.moreId === msg.id;
    return '<div class="th-actions" data-th-actions="' + esc(msg.id) + '">' +
      '<button type="button" class="th-act" data-th-act="react" data-id="' + esc(msg.id) + '" aria-label="回应" title="表情反应">回应</button>' +
      '<button type="button" class="th-act" data-th-act="reply" data-id="' + esc(msg.id) + '" aria-label="回复" title="回复">回复</button>' +
      '<button type="button" class="th-act" data-th-act="sub" data-id="' + esc(msg.id) + '" aria-label="开子串" title="开子串">子串</button>' +
      (mine ? '' : '<button type="button" class="th-act" data-th-act="useful" data-id="' + esc(msg.id) + '" aria-label="有用" title="有用">有用</button>') +
      '<button type="button" class="th-act" data-th-act="save" data-id="' + esc(msg.id) + '" aria-label="收藏" title="收藏" aria-pressed="' + isSaved(st.targetId, msg.id) + '">收藏</button>' +
      '<button type="button" class="th-act" data-th-act="copy" data-id="' + esc(msg.id) + '" aria-label="复制链接" title="复制链接">链接</button>' +
      '<button type="button" class="th-act" data-th-act="more" data-id="' + esc(msg.id) + '" aria-label="更多操作" aria-expanded="' + more + '">更多</button>' +
      (more ? '<div class="th-more" role="menu">' +
        '<button type="button" class="th-more-mobile" data-th-act="sub" data-id="' + esc(msg.id) + '">开子串</button>' +
        (mine ? '' : '<button type="button" class="th-more-mobile" data-th-act="useful" data-id="' + esc(msg.id) + '">有用</button>') +
        '<button type="button" class="th-more-mobile" data-th-act="save" data-id="' + esc(msg.id) + '">' + (isSaved(st.targetId, msg.id) ? '取消收藏' : '收藏') + '</button>' +
        '<button type="button" class="th-more-mobile" data-th-act="copy" data-id="' + esc(msg.id) + '">复制链接</button>' +
        (mine ? '<button type="button" data-th-act="edit" data-id="' + esc(msg.id) + '">编辑</button>' +
          '<button type="button" data-th-act="delete" data-id="' + esc(msg.id) + '">删除</button>' : '') +
        '<button type="button" data-th-act="report" data-id="' + esc(msg.id) + '">举报</button>' +
        '</div>' : '') +
      '</div>';
  }

  function bodyOf(st, msg) {
    if (msg.status === 'deleted') return '<p class="th-gone">这条消息已删除</p>';
    if (msg.status === 'hidden' && msg.authorId !== st.me.id) return '<p class="th-gone">这条消息正在审核</p>';
    var html = '<div class="th-text">' + formatBody(msg.body, st) /* safe: 正文已 esc 再套标签 */ + '</div>';
    if (msg.status === 'hidden') html += '<p class="th-flag">这条消息正在审核 · 只有你看得到原文</p>';
    if (msg.status === 'failed') {
      html += '<p class="th-fail" role="alert">发送失败 <button type="button" class="button small" data-th-act="retry" data-id="' + esc(msg.id) + '">重试</button></p>';
    }
    return html;
  }

  function msgHTML(st, row) {
    if (row.more) {
      var ed = Math.min(row.depth || 1, 4);
      var faces = row.collapse ? '' : ( /* safe: CommonsAvatar.stack */ avaStack(row.people || []) );
      var label = row.collapse ? '收起' : ('展开 ' + String(row.more) + ' 条回复');
      var act = row.collapse ? 'collapse' : 'expand';
      return '<li class="th-expand' + (row.collapse ? ' is-open' : '') + '" data-depth="' + esc(String(ed)) + '">' +
        ( /* safe: 树轨只有 data-r 数字 */ treeGuides(ed, row.lastAt) ) +
        '<span class="th-gutter" aria-hidden="true"></span>' +
        '<button type="button" class="th-expand-btn" data-th-act="' + esc(act) + '" data-id="' + esc(row.parent) + '">' +
        ( /* safe: CommonsAvatar.stack */ faces ) +
        '<span>' + esc(label) + '</span></button></li>';
    }
    var msg = row.msg;
    var who = person(st, msg.authorId);
    var depth = Math.min(row.depth || 0, 4);
    var last = st.lastRead && Date.parse(msg.createdAt) > Date.parse(st.lastRead);
    var divider = last && !st.sawNew ? (st.sawNew = true, '<li class="th-divider" role="separator">以下是新消息</li>') : '';
    var guides = (st.mode === 'tree' && depth > 0) ? ( /* safe: 树轨只有 data-r 数字 */ treeGuides(depth, row.lastAt) ) : '';
    var head = row.pack
      ? '<div class="th-gutter" aria-hidden="true"></div>'
      : '<div class="th-gutter">' + avatar({ id: who.id, name: who.name, size: 40, level: who.level, src: who.src }) + '</div>';
    var L = isMember(who) ? lv() : null;
    var marks = st.marks || { useful: '', first: {} };
    var hl = msg.adopted ? 'adopted' : (marks.useful === msg.id ? 'useful' : '');
    var firstReply = !!(L && marks.first[msg.id]);
    var anchor = hl ? '<a class="th-anchor" href="#/threads/' + encodeURIComponent(st.targetId) + '?m=' + encodeURIComponent(msg.id) + '" aria-label="复制并打开这条' + (hl === 'adopted' ? '已采纳' : '最有用') + '回答的链接">#</a>' : '';
    var tags = (hl ? '<span class="th-hl-tag">' + (hl === 'adopted' ? '已采纳' : '最有用') + '</span>' + anchor : '') +
      (firstReply ? '<span class="level-first-answer">第一次回复</span>' : '');
    var nameHTML = identityLink(who);
    if (!L || who.kind === 'agent') nameHTML += '<small>' + esc(roleText(who)) + '</small>';
    var meta = row.pack
      ? ''
      : '<div class="th-meta">' + ( /* safe: CommonsLevel 已逐值转义 */ nameHTML ) + ( /* safe: 标签文案固定或已 esc */ tags ) +
        '<time datetime="' + esc(msg.createdAt) + '" title="' + esc(absTime(msg.createdAt)) + '">' + esc(relTime(msg.createdAt)) + '</time>' +
        (msg.editedAt ? '<span class="th-edited">已编辑</span>' : '') +
        '</div>';
    var quote = msg.reply_to && st.mode !== 'tree' ? quoteHTML(st, msg) : '';
    var react = reactHTML(st, msg);
    var cls = 'th-msg' +
      (row.pack ? ' is-pack' : '') +
      (msg.status === 'sending' ? ' is-sending' : '') +
      (msg.status === 'failed' ? ' is-failed' : '') +
      (msg.status === 'deleted' ? ' is-deleted' : '') +
      (st.focusId === msg.id ? ' is-focus' : '') +
      (st.flashId === msg.id ? ' is-flash' : '') +
      (isSaved(st.targetId, msg.id) ? ' is-saved' : '');
    return divider +
      '<li class="' + cls + (L ? ' level-reply' : '') + '" ' + (L ? ( /* safe: CommonsLevel 已逐值转义 */ L.attrs(who.level) ) : '') +
      (hl ? ' data-reply-highlight="' + esc(hl) + '"' : '') + (firstReply ? ' data-level-first-reply="true"' : '') +
      ' id="m-' + esc(msg.id) + '" data-th-id="' + esc(msg.id) + '" data-depth="' + esc(String(depth)) + '" tabindex="-1">' +
      ( /* safe: 树轨只有 data-r 数字 */ guides ) +
      head +
      '<div class="th-main">' +
      quote + meta + bodyOf(st, msg) /* safe: 状态文案与已转义正文 */ + ( /* safe: CommonsReact.bar */ react ) +
      (msg.status === 'deleted' || (msg.status === 'hidden' && msg.authorId !== st.me.id) ? '' : actionsHTML(st, msg)) +
      (isSaved(st.targetId, msg.id) ? '<span class="th-saved-mark" title="已收藏">' + icon('favorite') + '</span>' : '') +
      '</div></li>';
  }

  function composeHTML(st) {
    if (isLive()) return '<p class="th-compose-note">当前讨论为只读；回复接口接入后可参与。</p>';
    var reply = st.replyTo && st.map[st.replyTo];
    var who = reply ? person(st, reply.authorId) : null;
    var pick = '';
    if (st.picker === 'at') {
      var q = (st.mention || '').toLowerCase();
      pick = '<div class="th-pick" role="listbox" aria-label="提及成员">' +
        peopleOf(st).filter(function (p) { return !q || p.name.indexOf(st.mention) !== -1; }).map(function (p) {
          return '<button type="button" data-th-act="mention" data-id="' + esc(p.id) + '">' +
            avatar({ id: p.id, name: p.name, size: 24, level: p.level, src: p.src }) + esc(p.name) + '</button>';
        }).join('') + '</div>';
    } else if (st.picker === 'emo') {
      pick = '<div class="th-pick th-pick-emo" role="listbox" aria-label="表情">' +
        reactList().map(function (r) {
          return '<button type="button" data-th-act="emo" data-id="' + esc(r.id) + '">' + esc(r.label) + '</button>';
        }).join('') + '</div>';
    }
    return '<div class="th-compose" data-th-compose>' +
      (reply ? '<div class="th-replying">回复 ' + esc(who.name) +
        '<small>' + esc(String(reply.body || '').slice(0, 40)) + '</small>' +
        '<button type="button" class="th-x" data-th-act="cancel" aria-label="取消回复">×</button></div>' : '') +
      (st.editing ? '<div class="th-replying">编辑自己的消息<button type="button" class="th-x" data-th-act="cancel" aria-label="取消编辑">×</button></div>' : '') +
      pick +
      '<label class="th-input"><span class="visually-hidden">写评论</span>' +
      '<textarea name="body" rows="2" data-th-form="draft" placeholder="写一条评论，回车发送，Shift+回车换行">' + esc(st.draft) + '</textarea>' +
      '</label>' +
      '<div class="th-compose-row">' +
      '<span class="th-hint">@ 提及 · : 表情</span>' +
      '<button type="button" class="button primary" data-th-act="send">发送</button>' +
      '</div></div>';
  }

  function listHTML(st, scroller) {
    var rows = visibleRows(st);
    st.sawNew = false;
    st.marks = levelMarks(st);
    var slice = windowSlice(rows, scroller);
    var inner = '';
    var i;
    for (i = slice.start; i < slice.end; i++) inner += msgHTML(st, rows[i]);
    if (st.typing) {
      var typingWho = person(st, sample().typingAuthorId || '');
      inner += '<li class="th-typing">' + avatar({ id: typingWho.id, name: typingWho.name, size: 24, level: typingWho.level, src: typingWho.src }) + '<span>' + esc(typingWho.name) + '正在输入…</span></li>';
    }
    return '<div class="th-list-pad" style="height:' + slice.top + 'px"></div>' +
      '<ol class="th-list" data-th-list>' + ( /* safe: 消息行已逐条转义 */ inner ) + '</ol>' +
      '<div class="th-list-pad" style="height:' + slice.bot + 'px"></div>';
  }

  function hostHTML(st, scroller) {
    var jump = st.unread > 0 && !st.atBottom
      ? '<button type="button" class="th-jump" data-th-act="jump-new">有 ' + esc(String(st.unread)) + ' 条新消息 ↓</button>'
      : '';
    return '<div class="th-board" data-th-board data-mode="' + esc(st.mode) + '">' +
      '<div class="th-scroll" data-th-scroll>' + ( /* safe: 列表内部已转义 */ listHTML(st, scroller) ) + '</div>' +
      ( /* safe: 未读按钮数字已 esc */ jump ) +
      ( /* safe: 输入框文案已 esc */ composeHTML(st) ) +
      '</div>';
  }

  function bindState(el, opts) {
    opts = opts || {};
    var src = opts.messages || (sample().messages || []).slice();
    var me = opts.me || sample().me;
    var st = {
      el: el,
      targetId: String(opts.targetId || 'thread'),
      messages: src.map(function (m) { return Object.assign({}, m, { reactions: Object.assign({}, m.reactions), mine: Object.assign({}, m.mine) }); }),
      me: me,
      people: opts.people || sample().people,
      mode: opts.mode === 'tree' ? 'tree' : 'chat',
      replyTo: '',
      editing: '',
      focusId: '',
      flashId: '',
      moreId: '',
      expanded: {},
      pickReact: '',
      subRoot: '',
      draft: String(read(draftKey(String(opts.targetId || 'thread')), '') || ''),
      picker: '',
      mention: '',
      unread: 0,
      lastRead: opts.lastRead || new Date().toISOString(),
      atBottom: true,
      typing: false,
      map: {},
      tree: { kids: {}, roots: [], map: {} }
    };
    refreshIndex(st);
    if (st.tree.roots[0]) st.expanded[st.tree.roots[0].id] = true;
    return st;
  }

  function refreshIndex(st) {
    st.map = byIdMap(st.messages);
    st.tree = treeOf(st.messages);
  }

  function findHost(node) {
    var board = node && node.closest && node.closest('[data-th-board]');
    var i;
    for (i = 0; i < hosts.length; i++) {
      if (hosts[i].el.contains(board) || hosts[i].el.contains(node) || hosts[i].el === node) return hosts[i];
    }
    return null;
  }

  function paint(st, keepScroll) {
    var scroller = st.el.querySelector('[data-th-scroll]');
    var top = scroller ? scroller.scrollTop : 0;
    var act = document.activeElement;
    var keep = act && act.getAttribute && act.getAttribute('data-th-act');
    var keepId = act && act.dataset ? act.dataset.id : '';
    var wasText = act && act.getAttribute && act.getAttribute('data-th-form') === 'draft';
    var caret = wasText ? act.selectionStart : -1;
    st.el.innerHTML = hostHTML(st, scroller);
    var next = st.el.querySelector('[data-th-scroll]');
    if (next && !st.el.closest('[data-thread-lab]')) {
      if (keepScroll) next.scrollTop = top;
      else if (st.atBottom) next.scrollTop = next.scrollHeight;
      if (!keepScroll) alignScroll(next);
    }
    var ta = st.el.querySelector('[data-th-form="draft"]');
    if (ta && wasText) {
      ta.focus({ preventScroll: true });
      if (caret >= 0 && ta.setSelectionRange) ta.setSelectionRange(caret, caret);
    } else if (keep) {
      var btn = st.el.querySelector('[data-th-act="' + keep + '"]' + (keepId ? '[data-id="' + keepId + '"]' : ''));
      if (btn && btn.focus) btn.focus({ preventScroll: true });
    }
  }

  function scrollToMsg(st, id) {
    var node = st.el.querySelector('[data-th-id="' + id + '"]');
    if (!node) {
      st.focusId = id;
      st.flashId = id;
      paint(st, true);
      node = st.el.querySelector('[data-th-id="' + id + '"]');
    }
    if (!node) return;
    node.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' });
    st.flashId = id;
    st.focusId = id;
    node.classList.add('is-flash', 'is-focus');
    timers.push(window.setTimeout(function () {
      st.flashId = '';
      var n = st.el.querySelector('[data-th-id="' + id + '"]');
      if (n) n.classList.remove('is-flash');
    }, 1200));
  }

  function send(st) {
    if (isLive()) { toast('回复接口尚未接入，消息未发送。'); return; }
    var text = String(st.draft || '').trim();
    if (!text) return;
    if (st.editing && st.map[st.editing]) {
      st.map[st.editing].body = text;
      st.map[st.editing].editedAt = new Date().toISOString();
      st.editing = '';
      st.draft = '';
      write(draftKey(st.targetId), '');
      paint(st, true);
      return;
    }
    var parent = st.replyTo ? st.map[st.replyTo] : null;
    var row = {
      id: 'local-' + Date.now(),
      authorId: st.me.id,
      body: text,
      createdAt: new Date().toISOString(),
      editedAt: null,
      reply_to: parent ? parent.id : null,
      thread_root: parent ? (parent.thread_root || parent.id) : null,
      quote: parent ? {
        id: parent.id,
        authorId: parent.authorId,
        authorName: person(st, parent.authorId).name,
        excerpt: String(parent.body || '').slice(0, 40)
      } : null,
      status: 'ok',
      reactions: {},
      mine: {}
    };
    if (!row.thread_root) row.thread_root = row.id;
    st.messages.push(row);
    st.replyTo = '';
    st.draft = '';
    st.picker = '';
    write(draftKey(st.targetId), '');
    refreshIndex(st);
    st.atBottom = true;
    paint(st, false);
  }

  function simulate(st) {
    if (isLive() || !sample().simulatedReply) return;
    st.typing = true;
    paint(st, true);
    timers.push(window.setTimeout(function () {
      st.typing = false;
      var parent = st.focusId && st.map[st.focusId] ? st.map[st.focusId] : sortByTime(st.messages).slice(-1)[0];
      var row = sample().simulatedReply(st, parent, person);
      if (!row.thread_root) row.thread_root = row.id;
      st.messages.push(row);
      refreshIndex(st);
      if (st.atBottom) {
        paint(st, false);
      } else {
        st.unread += 1;
        paint(st, true);
      }
    }, 1100));
  }

  function onAct(st, act, id, btn) {
    if (isLive() && ['reply', 'edit', 'delete', 'withdraw', 'react', 'send', 'sim'].indexOf(act) >= 0) {
      toast('此操作尚未接入接口。');
      return;
    }
    var msg = st.map[id];
    if (act === 'reply' && msg) {
      st.replyTo = id;
      st.editing = '';
      st.moreId = '';
      paint(st, true);
      var ta = st.el.querySelector('[data-th-form="draft"]');
      if (ta) ta.focus();
      return;
    }
    if (act === 'sub' && msg) {
      st.moreId = '';
      st.mode = 'tree';
      st.subRoot = msg.thread_root || msg.id;
      st.expanded[st.subRoot] = true;
      paint(st, false);
      return;
    }
    if (act === 'useful' && msg) {
      if (msg.authorId === st.me.id) return;
      var um = usefulMap();
      var key = st.targetId + ':' + id;
      if (um[key]) {
        toast('这一条你已经标过「有用」。');
        return;
      }
      if (isLive()) {
        if (!window.CommonsAPI) return;
        window.CommonsAPI.post('/content/objects/' + encodeURIComponent(id) + '/useful', {}, {
          idempotencyKey: window.CommonsAPI.newIdempotencyKey()
        }).then(function () {
          st.moreId = '';
          um[key] = true;
          msg.reactions = msg.reactions || {};
          msg.reactions.useful = (msg.reactions.useful || 0) + 1;
          toast('对方的贡献值 +5，规则见等级制度');
          paint(st, true);
        }).catch(function (error) {
          toast((error && (error.status === 501 || error.code === 'capability_unavailable'))
            ? '这个功能还没开放。管理员还没打开。'
            : ((error && error.message) || '没有标上。原记录没有变化。'));
        });
        return;
      }
      st.moreId = '';
      um[key] = true;
      write('thread.useful', um);
      msg.reactions = msg.reactions || {};
      msg.reactions.useful = (msg.reactions.useful || 0) + 1;
      toast('对方的贡献值 +5，规则见等级制度');
      paint(st, true);
      return;
    }
    if (act === 'save' && msg) {
      if (isLive()) {
        if (!window.CommonsAPI) return;
        var adding = !isSaved(st.targetId, id);
        var savePath = '/content/objects/' + encodeURIComponent(id) + '/save';
        var saveOpts = { idempotencyKey: window.CommonsAPI.newIdempotencyKey() };
        var saveCall = adding
          ? window.CommonsAPI.put(savePath, {}, saveOpts)
          : window.CommonsAPI.del(savePath, {}, saveOpts);
        saveCall.then(function () {
          st.moreId = '';
          var next = savedList().filter(function (r) { return !(r.targetId === st.targetId && r.id === id); });
          if (adding) next.push({ targetId: st.targetId, id: id, at: new Date().toISOString() });
          write('thread.saved', next);
          paint(st, true);
        }).catch(function (error) {
          toast((error && (error.status === 501 || error.code === 'capability_unavailable'))
            ? '这个功能还没开放。管理员还没打开。'
            : ((error && error.message) || '收藏没有改成。原状态没有变化。'));
        });
        return;
      }
      st.moreId = '';
      var rows = savedList().filter(function (r) { return !(r.targetId === st.targetId && r.id === id); });
      if (!isSaved(st.targetId, id)) rows.push({ targetId: st.targetId, id: id, at: new Date().toISOString() });
      write('thread.saved', rows);
      paint(st, true);
      return;
    }
    if (act === 'copy' && msg) {
      if (st.moreId) {
        st.moreId = '';
        paint(st, true);
      }
      var link = '#/threads/' + encodeURIComponent(st.targetId) + '?m=' + encodeURIComponent(id);
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).catch(function () {});
      toast('链接已复制（示例）');
      return;
    }
    if (act === 'more') {
      st.moreId = st.moreId === id ? '' : id;
      paint(st, true);
      return;
    }
    if (act === 'edit' && msg && msg.authorId === st.me.id) {
      st.editing = id;
      st.replyTo = '';
      st.draft = msg.body;
      st.moreId = '';
      paint(st, true);
      var ed = st.el.querySelector('[data-th-form="draft"]');
      if (ed) ed.focus();
      return;
    }
    if (act === 'delete' && msg && msg.authorId === st.me.id) {
      msg.status = 'deleted';
      msg.body = '';
      st.moreId = '';
      paint(st, true);
      return;
    }
    if (act === 'report') {
      st.moreId = '';
      if (isLive()) {
        if (!window.CommonsAPI || !msg) {
          paint(st, true);
          return;
        }
        window.CommonsAPI.post('/governance/reports', {
          target_id: msg.id,
          reason_code: 'other',
          note: ''
        }, { idempotencyKey: window.CommonsAPI.newIdempotencyKey() }).then(function () {
          toast('已提交举报。');
          paint(st, true);
        }).catch(function (error) {
          toast((error && (error.status === 501 || error.code === 'capability_unavailable'))
            ? '这个功能还没开放。管理员还没打开。'
            : ((error && error.message) || '举报没有提交。'));
          paint(st, true);
        });
        return;
      }
      toast('已提交举报。');
      paint(st, true);
      return;
    }
    if (act === 'retry' && msg) {
      msg.status = 'ok';
      paint(st, true);
      return;
    }
    if (act === 'expand') {
      st.expanded[id] = true;
      paint(st, true);
      return;
    }
    if (act === 'collapse') {
      st.expanded[id] = false;
      paint(st, true);
      return;
    }
    if (act === 'jump') {
      if (id && st.map[id]) scrollToMsg(st, id);
      return;
    }
    if (act === 'jump-new') {
      st.unread = 0;
      st.atBottom = true;
      st.lastRead = new Date().toISOString();
      paint(st, false);
      if (st.el.closest('[data-thread-lab]')) {
        var rows = st.el.querySelectorAll('.th-list .th-msg');
        if (rows.length) rows[rows.length - 1].scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' });
      }
      return;
    }
    if (act === 'cancel') {
      st.replyTo = '';
      st.editing = '';
      st.picker = '';
      paint(st, true);
      return;
    }
    if (act === 'send') {
      send(st);
      return;
    }
    if (act === 'mention') {
      var p = person(st, id);
      st.draft = String(st.draft || '').replace(/@([^\s@]*)$/, '@' + p.name + ' ');
      st.picker = '';
      st.mention = '';
      write(draftKey(st.targetId), st.draft);
      paint(st, true);
      return;
    }
    if (act === 'emo') {
      var emo = reactList().filter(function (r) { return r.id === id; })[0];
      st.draft = String(st.draft || '').replace(/:([^\s:]*)$/, '') + ':' + ((emo && emo.label) || id) + ': ';
      st.picker = '';
      write(draftKey(st.targetId), st.draft);
      paint(st, true);
      return;
    }
    if (act === 'react' && msg) {
      st.focusId = id;
      st.pickReact = id;
      paint(st, true);
      var plus = st.el.querySelector('[data-th-id="' + id + '"] [data-ava-act="react-open"]');
      if (plus) plus.click();
      st.pickReact = '';
      return;
    }
    if (act === 'sim') {
      simulate(st);
      return;
    }
    if (act === 'mode') {
      st.mode = id === 'tree' ? 'tree' : 'chat';
      if (st.mode === 'chat') st.subRoot = '';
      paint(st, false);
      return;
    }
    void btn;
  }

  function onClick(event) {
    var btn = event.target.closest('[data-th-act]');
    if (!btn) {
      var st0 = findHost(event.target);
      if (st0 && st0.moreId && !event.target.closest('[data-th-actions]')) {
        st0.moreId = '';
        paint(st0, true);
      }
      return;
    }
    var st = findHost(btn);
    if (!st) return;
    onAct(st, btn.getAttribute('data-th-act'), btn.dataset.id || '', btn);
  }

  function onInput(event) {
    var liveTa = event.target.closest && event.target.closest('[data-th-live-form="draft"]');
    if (liveTa) { liveFromNode(liveTa).draft = liveTa.value; return; }
    var ta = event.target.closest('[data-th-form="draft"]');
    if (!ta) return;
    var st = findHost(ta);
    if (!st) return;
    st.draft = ta.value;
    write(draftKey(st.targetId), st.draft);
    var trail = st.draft.slice(-24);
    var at = trail.match(/@([^\s@]*)$/);
    var emo = trail.match(/:([^\s:]*)$/);
    var next = at ? 'at' : (emo ? 'emo' : '');
    st.mention = at ? at[1] : '';
    if (next !== st.picker) {
      st.picker = next;
      paint(st, true);
    }
  }

  function onKey(event) {
    var liveTa = event.target.closest && event.target.closest('[data-th-live-form="draft"]');
    if (liveTa) {
      var liveSt = liveFromNode(liveTa);
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        liveSt.draft = liveTa.value;
        sendLive(liveSt);
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        liveSt.replyTo = '';
        liveSt.editing = '';
        paintSession(liveSt);
      }
      return;
    }
    var st = findHost(event.target) || (document.activeElement && findHost(document.activeElement));
    if (!st) {
      var lab = document.querySelector('[data-thread-lab]');
      if (lab) st = findHost(lab);
    }
    if (!st) return;
    var inDraft = event.target.closest && event.target.closest('[data-th-form="draft"]');
    if (inDraft) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        st.draft = event.target.value;
        send(st);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        st.replyTo = '';
        st.editing = '';
        st.picker = '';
        paint(st, true);
      }
      return;
    }
    if (event.key === 'Escape') {
      st.replyTo = '';
      st.moreId = '';
      st.picker = '';
      paint(st, true);
      return;
    }
    var rows = st.el.querySelectorAll('[data-th-id]');
    if (!rows.length) return;
    var i = -1;
    var n;
    for (n = 0; n < rows.length; n++) if (rows[n].getAttribute('data-th-id') === st.focusId) i = n;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      var next = event.key === 'ArrowDown' ? Math.min(rows.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
      st.focusId = rows[next].getAttribute('data-th-id');
      rows[next].focus({ preventScroll: true });
      rows[next].scrollIntoView({ block: 'nearest' });
      return;
    }
    if (!st.focusId) return;
    if (event.key === 'r' || event.key === 'R') {
      event.preventDefault();
      onAct(st, 'reply', st.focusId);
    } else if (event.key === 'e' || event.key === 'E') {
      event.preventDefault();
      onAct(st, 'edit', st.focusId);
    }
  }

  function onScroll(event) {
    var sc = event.target.closest && event.target.closest('[data-th-scroll]');
    if (!sc && (event.target === document || event.target === document.documentElement)) {
      var lab = document.querySelector('[data-thread-lab] [data-th-scroll]');
      if (lab) {
        var state = findHost(lab);
        if (state) {
          var bottom = lab.getBoundingClientRect().bottom;
          var atPageBottom = bottom <= window.innerHeight + 48;
          state.atBottom = atPageBottom;
          if (atPageBottom && state.unread) {
            state.unread = 0;
            state.lastRead = new Date().toISOString();
            paint(state, true);
          }
        }
      }
      return;
    }
    if (!sc) return;
    var st = findHost(sc);
    if (!st) return;
    var gap = sc.scrollHeight - sc.scrollTop - sc.clientHeight;
    var at = gap < 48;
    if (at && (!st.atBottom || st.unread)) {
      st.atBottom = true;
      st.unread = 0;
      st.lastRead = new Date().toISOString();
      paint(st, true);
      return;
    }
    st.atBottom = at;
    if (st.messages.length > WINDOW) paint(st, true);
  }

  function onPointerDown(event) {
    var msg = event.target.closest('[data-th-id]');
    if (!msg) return;
    if (event.pointerType !== 'touch') return;
    press.id = msg.getAttribute('data-th-id');
    press.t = window.setTimeout(function () {
      var st = findHost(msg);
      if (!st) return;
      st.focusId = press.id;
      st.moreId = '';
      paint(st, true);
      var bar = st.el.querySelector('[data-th-actions="' + press.id + '"]');
      if (bar) bar.classList.add('is-pin');
    }, 420);
    timers.push(press.t);
  }

  function onPointerUp() {
    if (press.t) window.clearTimeout(press.t);
    press.t = 0;
  }

  function mountHost(container, opts) {
    var st = bindState(container, opts || {});
    var linked = '';
    try {
      var match = String(location.hash || '').match(/[?&]m=([^&]+)/);
      linked = match ? decodeURIComponent(match[1]) : '';
    } catch (err) { linked = ''; }
    if (linked && st.map[linked]) st.focusId = linked;
    container.setAttribute('data-th-root', '');
    hosts.push(st);
    paint(st, false);
    if (linked && st.map[linked]) {
      window.setTimeout(function () {
        var row = container.querySelector('[data-th-id="' + (window.CSS && window.CSS.escape ? window.CSS.escape(linked) : linked.replace(/"/g, '\\"')) + '"]');
        if (row) {
          row.scrollIntoView({ block: 'center' });
          row.focus({ preventScroll: true });
        }
      }, 0);
    }
    return st;
  }

  function labState() {
    var i;
    for (i = 0; i < hosts.length; i++) if (hosts[i].el.closest('[data-thread-lab]')) return hosts[i];
    return hosts[0] || null;
  }

  function postHTML() {
    var s = sample();
    var post = s.post || {};
    var who = person({ people: s.people }, post.authorId);
    var saved = isSaved(post.id, post.id);
    return '<article class="th-post" data-th-post="' + esc(post.id) + '">' +
      '<header>' + avatar({ id: who.id, name: who.name, size: 40, level: who.level, src: who.src }) +
      '<div>' + ( /* safe: personLink / agentLink 已逐值转义 */ identityLink(who) ) + '<small> · ' + (who.kind === 'agent' ? esc(roleText(who)) + ' · ' : '') + esc(relTime(post.createdAt)) + '</small></div></header>' +
      '<h2>' + esc(post.title) + '</h2>' +
      '<p>' + esc(post.body) + '</p>' +
      '<div class="th-post-acts">' +
      ( /* safe: CommonsReact.bar */ reactBar({ targetId: 'th-post:' + post.id, counts: post.reactions || {}, mine: {} }) ) +
      '<button type="button" class="button ghost" data-th-act="useful-post" data-id="' + esc(post.id) + '">有用</button>' +
      '<button type="button" class="button ghost" data-th-act="save-post" data-id="' + esc(post.id) + '" aria-pressed="' + saved + '">' + (saved ? '已收藏' : '收藏') + '</button>' +
      '</div></article>';
  }

  var liveLab = {
    key: null, rows: null, post: null, error: '', loading: false, seq: 0,
    nextCursor: '', moreLoading: false, draft: '', replyTo: '', editing: '',
    busy: false, sendError: '', focusDraft: false, el: null
  };
  var liveEmbeds = [];
  function sessionOf(st) { return st || liveLab; }
  function liveFromNode(node) {
    var root = node && node.closest && node.closest('[data-thread-live]');
    if (root) {
      var i;
      for (i = 0; i < liveEmbeds.length; i++) if (liveEmbeds[i].el === root) return liveEmbeds[i];
    }
    return liveLab;
  }
  function liveKey() {
    try { return decodeURIComponent((location.hash.split('/')[2] || '').split('?')[0]); }
    catch (err) { return ''; }
  }
  function refreshLive() { if (window.Commons && typeof window.Commons.refresh === 'function') window.Commons.refresh(); }
  function liveDraftNode(st) {
    st = sessionOf(st);
    if (st.el && st.el.querySelector) return st.el.querySelector('[data-th-live-form="draft"]');
    return document.querySelector('[data-th-live-form="draft"]');
  }
  function paintSession(st) {
    st = sessionOf(st);
    if (st.el) {
      st.el.innerHTML = liveEmbedHTML(st);
      if (!st.focusDraft) return;
      window.setTimeout(function () {
        var ta = liveDraftNode(st);
        if (ta && ta.focus) {
          ta.focus({ preventScroll: true });
          var val = ta.value || '';
          if (ta.setSelectionRange) ta.setSelectionRange(val.length, val.length);
        }
        st.focusDraft = false;
      }, 0);
      return;
    }
    refreshLive();
    if (!st.focusDraft) return;
    window.setTimeout(function () {
      var ta = liveDraftNode(st);
      if (ta && ta.focus) {
        ta.focus({ preventScroll: true });
        var val = ta.value || '';
        if (ta.setSelectionRange) ta.setSelectionRange(val.length, val.length);
      }
      st.focusDraft = false;
    }, 0);
  }
  function paintLive() { paintSession(liveLab); }
  function liveMe() {
    var me = window.CommonsSession && window.CommonsSession.me;
    return me && me.id ? me : null;
  }
  function liveWriteOpts(extra) {
    var opts = { idempotencyKey: window.CommonsAPI && window.CommonsAPI.newIdempotencyKey() };
    if (extra) Object.keys(extra).forEach(function (k) { opts[k] = extra[k]; });
    return opts;
  }
  function liveErr(error, fallback) {
    if (error && (error.status === 501 || error.code === 'capability_unavailable')) return '这个功能还没开放';
    if (error && error.status === 412) return '内容已被改过，请刷新';
    return (error && error.message) || fallback || '没有成功，可以再试一次。';
  }
  function liveWho(author) {
    if (!author) return { id: '', handle: '', name: '成员', level: 1, src: '' };
    return {
      id: author.id || '',
      handle: author.handle || '',
      name: author.display_name || author.name || '成员',
      level: author.level || 1,
      src: author.avatar || author.src || ''
    };
  }
  function livePostBody(post) {
    var content = (post && post.content) || {};
    if (typeof post.body === 'string' && post.body) return post.body;
    if (typeof content.body === 'string') return content.body;
    return post.excerpt || '';
  }
  function liveFind(id, st) {
    st = sessionOf(st);
    if (st.post && st.post.id === id) return st.post;
    var i, rows = st.rows || [];
    for (i = 0; i < rows.length; i++) if (rows[i].id === id) return rows[i];
    return null;
  }
  function liveIsMine(row) {
    var me = liveMe();
    if (!me || !row) return false;
    return row.authorId === me.id || (row.author && row.author.id === me.id);
  }
  function liveIsSaved(row) {
    return !!(row && (row.saved || (row.mine && row.mine.saved)));
  }
  function liveIsUseful(row) {
    return !!(row && row.mine && (row.mine.useful || (row.mine.reactions && row.mine.reactions.useful)));
  }
  function liveSetSaved(row, on) {
    if (!row) return;
    row.saved = on;
    row.mine = row.mine || {};
    row.mine.saved = on;
  }
  function liveSetUseful(row) {
    if (!row) return;
    row.mine = row.mine || {};
    row.mine.useful = true;
    row.mine.reactions = row.mine.reactions || {};
    row.mine.reactions.useful = true;
  }
  function resetLiveUi() {
    liveLab.draft = '';
    liveLab.replyTo = '';
    liveLab.editing = '';
    liveLab.busy = false;
    liveLab.sendError = '';
    liveLab.focusDraft = false;
    liveLab.nextCursor = '';
  }
  function loadLiveLab() {
    var key = liveKey();
    var seq = ++liveLab.seq;
    if (liveLab.key !== key) resetLiveUi();
    liveLab.key = key;
    liveLab.rows = null;
    liveLab.post = null;
    liveLab.error = '';
    liveLab.loading = true;
    liveLab.moreLoading = false;
    liveLab.nextCursor = '';
    refreshLive();
    Promise.resolve().then(function () {
      if (!window.CommonsAPI || typeof window.CommonsAPI.get !== 'function') throw new Error('没有接上接口。');
      if (!key) {
        return window.CommonsAPI.get('/content/feed', { sort: 'new', type: 'discussion', limit: 50 })
          .then(function (r) { return [r, null]; });
      }
      return Promise.all([
        window.CommonsAPI.get('/content/objects/' + encodeURIComponent(key) + '/replies', { order: 'time', limit: 50 }),
        window.CommonsAPI.get('/content/objects/' + encodeURIComponent(key))
      ]);
    }).then(function (pair) {
      if (seq !== liveLab.seq) return;
      liveLab.rows = Array.isArray(pair[0] && pair[0].data) ? pair[0].data : [];
      liveLab.post = pair[1] && pair[1].data;
      liveLab.nextCursor = pair[0] && pair[0].meta && pair[0].meta.next_cursor || '';
      liveLab.loading = false;
      refreshLive();
    }).catch(function (error) {
      if (seq !== liveLab.seq) return;
      liveLab.rows = null;
      liveLab.post = null;
      liveLab.loading = false;
      liveLab.error = (error && (error.status === 501 || error.code === 'capability_unavailable'))
        ? 'closed'
        : ((error && error.message) || '讨论没有载入。');
      refreshLive();
    });
  }
  function loadMoreLive(st) {
    st = sessionOf(st);
    if (!st.nextCursor || st.moreLoading || !window.CommonsAPI) return;
    var key = st.key || liveKey();
    var seq = st.seq;
    st.moreLoading = true;
    paintSession(st);
    var path = key
      ? '/content/objects/' + encodeURIComponent(key) + '/replies'
      : '/content/feed';
    var query = key
      ? { order: 'time', limit: 50, cursor: st.nextCursor }
      : { sort: 'new', type: 'discussion', limit: 50, cursor: st.nextCursor };
    window.CommonsAPI.get(path, query).then(function (response) {
      if (seq !== st.seq) return;
      var extra = Array.isArray(response && response.data) ? response.data : [];
      st.rows = (st.rows || []).concat(extra);
      st.nextCursor = response && response.meta && response.meta.next_cursor || '';
      st.moreLoading = false;
      paintSession(st);
    }).catch(function (error) {
      if (seq !== st.seq) return;
      st.moreLoading = false;
      toast(liveErr(error, '没有加载更多。'));
      paintSession(st);
    });
  }
  function loadLiveSession(st) {
    var seq = ++st.seq;
    st.loading = true;
    st.error = '';
    if (!st.key) {
      st.loading = false;
      st.error = '没有讨论对象。';
      paintSession(st);
      return;
    }
    paintSession(st);
    Promise.resolve().then(function () {
      if (!window.CommonsAPI || typeof window.CommonsAPI.get !== 'function') throw new Error('没有接上接口。');
      return window.CommonsAPI.get('/content/objects/' + encodeURIComponent(st.key) + '/replies', { order: 'time', limit: 50 });
    }).then(function (response) {
      if (seq !== st.seq) return;
      st.rows = Array.isArray(response && response.data) ? response.data : [];
      st.nextCursor = response && response.meta && response.meta.next_cursor || '';
      st.post = st.post || { id: st.key };
      st.loading = false;
      paintSession(st);
    }).catch(function (error) {
      if (seq !== st.seq) return;
      st.rows = null;
      st.loading = false;
      st.error = (error && (error.status === 501 || error.code === 'capability_unavailable'))
        ? 'closed'
        : ((error && error.message) || '讨论没有载入。');
      paintSession(st);
    });
  }
  function mountLiveEmbed(container, opts) {
    liveEmbeds = liveEmbeds.filter(function (s) { return s.el && s.el !== container && s.el.isConnected !== false; });
    var st = {
      key: String(opts.targetId || ''), rows: null, post: { id: String(opts.targetId || '') },
      error: '', loading: false, seq: 0, nextCursor: '', moreLoading: false,
      draft: '', replyTo: '', editing: '', busy: false, sendError: '', focusDraft: false,
      el: container
    };
    container.setAttribute('data-thread-live', '');
    container.setAttribute('data-th-live-target', st.key);
    liveEmbeds.push(st);
    loadLiveSession(st);
    return st;
  }
  function liveQuoteHTML(row) {
    var q = row.quote;
    if (!row.reply_to && !q) return '';
    if (!q || q.status === 'deleted') {
      return '<button type="button" class="th-quote" disabled><span class="th-quote-copy">↳ 原消息已删除</span></button>';
    }
    if (q.status === 'hidden') {
      return '<button type="button" class="th-quote" disabled><span class="th-quote-copy">↳ 原消息正在审核</span></button>';
    }
    return '<button type="button" class="th-quote th-quote-jump" data-th-act="jump" data-id="' + esc(row.reply_to || '') + '"><span class="th-quote-copy">↳ 回复 ' + esc(q.authorName || '') + '：' + esc(String(q.excerpt || '').slice(0, 40)) + '</span></button>';
  }
  function liveActsHTML(row, kind) {
    var id = row.id;
    var mine = liveIsMine(row);
    var saved = liveIsSaved(row);
    var useful = liveIsUseful(row);
    var canEdit = kind === 'reply' && mine && row.status === 'ok';
    return '<div class="th-post-acts">' +
      (mine ? '' : '<button type="button" class="th-act" data-th-act="useful" data-id="' + esc(id) + '" aria-pressed="' + useful + '">有用</button>') +
      '<button type="button" class="th-act" data-th-act="save" data-id="' + esc(id) + '" aria-pressed="' + saved + '">' + (saved ? '已收藏' : '收藏') + '</button>' +
      '<button type="button" class="th-act" data-th-act="report" data-id="' + esc(id) + '">举报</button>' +
      '<button type="button" class="th-act" data-th-act="reply" data-id="' + esc(id) + '">回复</button>' +
      (canEdit ? '<button type="button" class="th-act" data-th-act="edit" data-id="' + esc(id) + '">编辑</button>' : '') +
      '</div>';
  }
  /* safe-fn: 名字与 handle 逐值转义 */
  function liveNameLink(who) {
    return who.handle
      ? '<a class="lk-person" href="#/u/' + encodeURIComponent(who.handle) + '">' + esc(who.name) + '</a>'
      : esc(who.name);
  }
  function liveAuthorLine(who, when) {
    return '<header>' + avatar({ id: who.id, name: who.name, size: 40, level: who.level, src: who.src }) +
      '<div><b>' + ( /* safe: liveNameLink 已转义 */ liveNameLink(who) ) + '</b><small> · L' + esc(String(who.level || 1)) + (when ? ' · ' + esc(relTime(when)) : '') + '</small></div></header>';
  }
  function liveReplyHTML(row) {
    var who = liveWho(row.author);
    var st = { people: row.author ? [Object.assign({ name: who.name }, who)] : [], me: liveMe() || { id: '' } };
    var body = row.status === 'deleted'
      ? '<p class="th-gone">这条消息已删除</p>'
      : (row.status === 'hidden' && !liveIsMine(row)
        ? '<p class="th-gone">这条消息正在审核</p>'
        : '<div class="th-text">' + formatBody(row.body || '', st) /* safe: formatBody 已逐值转义 */ + '</div>');
    return '<li class="th-msg" id="m-' + esc(row.id) + '" data-th-id="' + esc(row.id) + '" data-depth="' + esc(String(row.depth || 0)) + '">' +
      '<div class="th-main">' + liveAuthorLine(who, row.createdAt || row.created_at) +
      ( /* safe: 引用字段均 esc */ liveQuoteHTML(row) ) +
      body +
      (row.status === 'deleted' || (row.status === 'hidden' && !liveIsMine(row)) ? '' : liveActsHTML(row, 'reply')) +
      '</div></li>';
  }
  function liveComposeHTML(st) {
    st = sessionOf(st);
    var reply = st.replyTo ? liveFind(st.replyTo, st) : null;
    var who = reply ? liveWho(reply.author || { id: reply.authorId }) : null;
    var editing = !!st.editing;
    return '<div class="th-compose" data-th-live-compose>' +
      (reply && !editing ? '<div class="th-replying">回复 ' + esc(who.name) +
        '<small>' + esc(String(reply.body || '').slice(0, 40)) + '</small>' +
        '<button type="button" class="th-x" data-th-act="cancel" aria-label="取消回复">×</button></div>' : '') +
      (editing ? '<div class="th-replying">编辑自己的消息<button type="button" class="th-x" data-th-act="cancel" aria-label="取消编辑">×</button></div>' : '') +
      '<label class="th-input"><span class="visually-hidden">写回复</span>' +
      '<textarea name="body" rows="2" data-th-live-form="draft" placeholder="写一条回复，回车发送，Shift+回车换行"' +
      (st.busy ? ' disabled' : '') + '>' + esc(st.draft) + '</textarea></label>' +
      (st.sendError ? '<p class="th-fail" role="alert">' + esc(st.sendError) + '</p>' : '') +
      '<div class="th-compose-row">' +
      '<span class="th-hint">回车发送</span>' +
      '<button type="button" class="button primary" data-th-act="send"' + (st.busy ? ' disabled' : '') + '>发布</button>' +
      '</div></div>';
  }
  function liveEmbedHTML(st) {
    st = sessionOf(st);
    if (st.loading) return '<p role="status">正在读取讨论…</p>';
    if (st.error === 'closed') return '<div class="th-live-closed" role="status"><h2>这个功能还没开放</h2><p>管理员还没打开。</p></div>';
    if (st.error) return '<p role="alert">' + esc(st.error) + '</p><button type="button" class="button" data-th-act="retry">重试</button>';
    var rows = st.rows || [];
    var list = rows.length
      ? '<ol class="th-list">' + rows.map(liveReplyHTML).join('') + '</ol>'
      : '<p role="status">还没有回复，来说第一句。</p>';
    var more = st.nextCursor
      ? '<button type="button" class="button ghost" data-th-act="more-load"' + (st.moreLoading ? ' disabled' : '') + '>加载更多</button>'
      : '';
    return '<div class="th-live-embed">' +
      '<section class="th-live-replies" aria-label="回复">' + list /* safe: liveReplyHTML 已逐条转义 */ + more + '</section>' +
      liveComposeHTML(st) +
      '</div>';
  }
  function liveIndexHTML() {
    var rows = liveLab.rows || [];
    var cards = rows.length
      ? rows.map(function (row) {
        var who = liveWho(row.author);
        var when = row.published_at || row.created_at || row.createdAt;
        return '<article class="th-post"><h2><a href="#/threads/' + encodeURIComponent(row.id) + '">' + esc(row.title || '未命名讨论') + '</a></h2>' +
          '<p>' + esc(row.excerpt || '') + '</p>' +
          '<small>' + esc(who.name) + (when ? ' · ' + esc(relTime(when)) : '') + '</small></article>';
      }).join('')
      : '<p role="status">还没有讨论。</p>';
    var more = liveLab.nextCursor
      ? '<button type="button" class="button ghost" data-th-act="more-load"' + (liveLab.moreLoading ? ' disabled' : '') + '>加载更多</button>'
      : '';
    return '<div class="th-live-index">' + cards /* safe: 卡片字段均 esc */ + more + '</div>';
  }
  /* safe-fn: 只拼编号（已编码）和写死的文案 */
  function liveCaptureLink(post) {
    var S = window.CommonsSession;
    if (!post || !post.id || post.type !== 'discussion') return '';
    if (S && typeof S.can === 'function' && !S.can('kb.capture')) {
      // 功能没开放就不摆一个永远灰着的按钮；其余情况（等级、状态）灰掉并写原因。
      var why = typeof S.reason === 'function' ? S.reason('kb.capture') : '';
      if (!why || why === '这个功能还没开放') return '';
      return '<div class="th-post-acts"><button class="button tonal small" type="button" disabled aria-disabled="true" title="' + esc(why) + '">沉淀为问题卡</button>' +
        '<small class="th-why" role="status" data-th-why="capture">' + esc(why) + '</small></div>';
    }
    return '<div class="th-post-acts"><a class="button tonal small" href="#/solved?capture=discussion:' + encodeURIComponent(post.id) + '">沉淀为问题卡</a></div>';
  }
  function liveDetailHTML() {
    var post = liveLab.post || {};
    var who = liveWho(post.author);
    var body = livePostBody(post);
    var rows = liveLab.rows || [];
    var list = rows.length
      ? '<ol class="th-list">' + rows.map(liveReplyHTML).join('') + '</ol>'
      : '<p role="status">还没有回复，来说第一句。</p>';
    var more = liveLab.nextCursor
      ? '<button type="button" class="button ghost" data-th-act="more-load"' + (liveLab.moreLoading ? ' disabled' : '') + '>加载更多</button>'
      : '';
    var postRow = {
      id: post.id, authorId: post.author && post.author.id, author: post.author,
      saved: liveIsSaved(post), mine: post.mine, status: 'ok'
    };
    return '<article class="th-post" data-th-live-post="' + esc(post.id || '') + '">' +
      liveAuthorLine(who, post.created_at || post.createdAt || post.published_at) +
      '<h2>' + esc(post.title || '讨论串') + '</h2>' +
      '<div class="th-text">' + formatBody(body, { people: post.author ? [Object.assign({ name: who.name }, who)] : [] }) /* safe: formatBody 已转义 */ + '</div>' +
      (post.id ? liveActsHTML(postRow, 'post') : '') +
      ( /* safe: liveCaptureLink 只拼已编码的编号 */ liveCaptureLink(post) ) +
      '</article>' +
      '<section class="th-live-replies" aria-label="回复">' + list /* safe: liveReplyHTML 已逐条转义 */ + more + '</section>' +
      liveComposeHTML();
  }
  function liveLabHTML() {
    var body;
    if (liveLab.key !== liveKey() || liveLab.loading) body = '<p role="status">正在读取讨论…</p>';
    else if (liveLab.error === 'closed') body = '<div class="th-live-closed" role="status"><h2>这个功能还没开放</h2><p>管理员还没打开。</p></div>';
    else if (liveLab.error) body = '<p role="alert">' + esc(liveLab.error) + '</p><button type="button" class="button" data-th-act="retry">重试</button>';
    else if (!liveKey()) body = liveIndexHTML();
    else body = liveDetailHTML();
    return '<div class="th-lab" data-thread-live>' +
      (liveKey() ? '' : '<header class="th-lab-head"><p>成员发起的讨论。</p></header>') +
      body /* safe: 上方状态与 liveIndex/liveDetail 均已转义 */ + '</div>';
  }
  function sendLive(st) {
    st = sessionOf(st);
    if (st.busy || !window.CommonsAPI) return;
    var ta = liveDraftNode(st);
    if (ta && typeof ta.value === 'string') st.draft = ta.value;
    var text = String(st.draft || '').trim();
    if (!text) return;
    var key = st.key || liveKey();
    if (!key) return;
    st.busy = true;
    st.sendError = '';
    paintSession(st);
    if (st.editing) {
      var current = liveFind(st.editing, st);
      var editId = st.editing;
      window.CommonsAPI.patch('/content/replies/' + encodeURIComponent(editId), { body: text }, liveWriteOpts({ ifMatch: current && current.etag }))
        .then(function (response) {
          var next = response && response.data;
          st.rows = (st.rows || []).map(function (row) { return row.id === editId ? next || row : row; });
          st.busy = false;
          st.draft = '';
          st.replyTo = '';
          st.editing = '';
          st.sendError = '';
          paintSession(st);
        }).catch(function (error) {
          st.busy = false;
          st.sendError = liveErr(error, '没有改成。');
          st.focusDraft = true;
          paintSession(st);
        });
      return;
    }
    var payload = { body: text };
    if (st.replyTo && st.replyTo !== key) payload.reply_to = st.replyTo;
    window.CommonsAPI.post('/content/objects/' + encodeURIComponent(key) + '/replies', payload, liveWriteOpts())
      .then(function (response) {
        var row = response && response.data;
        if (row && row.id) st.rows = (st.rows || []).concat([row]);
        st.busy = false;
        st.draft = '';
        st.replyTo = '';
        st.editing = '';
        st.sendError = '';
        paintSession(st);
      }).catch(function (error) {
        st.busy = false;
        st.sendError = liveErr(error, '没有发出。');
        st.focusDraft = true;
        paintSession(st);
      });
  }
  function labPage() {
    if (isLive()) return liveLabHTML();
    var st = { mode: 'chat' };
    return '<div class="th-lab" data-thread-lab data-mode="chat">' +
      '<header class="th-lab-head"><p>按时间聊，或按回复层级看。</p>' + (isLive() ? '' : '<span class="pill outline">示例</span>') + '</header>' +
      ( /* safe: 帖子字段均 esc */ postHTML() ) +
      '<div class="th-lab-bar">' +
      '<div class="segmented" role="tablist" aria-label="视图">' +
      '<button type="button" role="tab" data-th-act="mode" data-id="chat" aria-selected="true">聊天</button>' +
      '<button type="button" role="tab" data-th-act="mode" data-id="tree" aria-selected="false">层级</button>' +
      '</div>' +
      '<button type="button" class="button small ghost" data-th-act="sim">模拟新消息</button>' +
      '</div>' +
      '<div class="th-host" data-thread-host></div>' +
      '</div>';
  }

  function paintLabChrome(mode) {
    var root = document.querySelector('[data-thread-lab]');
    if (!root) return;
    root.setAttribute('data-mode', mode);
    root.querySelectorAll('[data-th-act="mode"]').forEach(function (b) {
      b.setAttribute('aria-selected', b.dataset.id === mode ? 'true' : 'false');
    });
  }

  function onClickLab(event) {
    var btn = event.target.closest('[data-th-act]');
    if (!btn) return;
    var act = btn.getAttribute('data-th-act');
    var id = btn.dataset.id || '';
    if (isLive()) {
      if (!event.target.closest('[data-thread-live]')) return;
      var st = liveFromNode(event.target);
      if (act === 'retry') { st.el ? loadLiveSession(st) : loadLiveLab(); return; }
      if (act === 'more-load') { loadMoreLive(st); return; }
      if (act === 'cancel') { st.replyTo = ''; st.editing = ''; paintSession(st); return; }
      if (act === 'reply') {
        st.replyTo = id;
        st.editing = '';
        st.focusDraft = true;
        paintSession(st);
        return;
      }
      if (act === 'edit') {
        var editRow = liveFind(id, st);
        if (!editRow || !liveIsMine(editRow)) return;
        st.editing = id;
        st.replyTo = '';
        st.draft = editRow.body || '';
        st.focusDraft = true;
        paintSession(st);
        return;
      }
      if (act === 'send') { sendLive(st); return; }
      if (act === 'jump') {
        var node = document.getElementById('m-' + id);
        if (node && node.scrollIntoView) node.scrollIntoView({ block: 'center' });
        return;
      }
      if (act === 'useful') {
        var usefulRow = liveFind(id, st);
        if (!usefulRow || liveIsMine(usefulRow)) return;
        if (liveIsUseful(usefulRow)) { toast('这一条你已经标过「有用」。'); return; }
        if (!window.CommonsAPI) return;
        window.CommonsAPI.post('/content/objects/' + encodeURIComponent(id) + '/useful', {}, liveWriteOpts())
          .then(function () {
            liveSetUseful(usefulRow);
            toast('对方的贡献值 +5，规则见等级制度');
            paintSession(st);
          }).catch(function (error) { toast(liveErr(error, '没有标上。')); });
        return;
      }
      if (act === 'save') {
        var saveRow = liveFind(id, st);
        if (!saveRow || !window.CommonsAPI) return;
        var adding = !liveIsSaved(saveRow);
        var savePath = '/content/objects/' + encodeURIComponent(id) + '/save';
        var saveCall = adding
          ? window.CommonsAPI.put(savePath, {}, liveWriteOpts())
          : window.CommonsAPI.del(savePath, {}, liveWriteOpts());
        saveCall.then(function () {
          liveSetSaved(saveRow, adding);
          paintSession(st);
        }).catch(function (error) { toast(liveErr(error, '收藏没有改成。')); });
        return;
      }
      if (act === 'report') {
        if (!window.CommonsAPI || !id) return;
        window.CommonsAPI.post('/governance/reports', { target_id: id, reason_code: 'other', note: '' }, liveWriteOpts())
          .then(function () { toast('已提交举报。'); })
          .catch(function (error) { toast(liveErr(error, '举报没有提交。')); });
        return;
      }
      return;
    }
    var st = labState();
    if (act === 'mode' && st) {
      onAct(st, 'mode', btn.dataset.id || 'chat');
      paintLabChrome(st.mode);
      return;
    }
    if (act === 'sim' && st) {
      onAct(st, 'sim');
      return;
    }
    if (act === 'useful-post') {
      var um = usefulMap();
      if (um['post:' + btn.dataset.id]) {
        toast('这一条你已经标过「有用」。');
        return;
      }
      um['post:' + btn.dataset.id] = true;
      write('thread.useful', um);
      toast('对方的贡献值 +5，规则见等级制度');
      return;
    }
    if (act === 'save-post') {
      var id = btn.dataset.id;
      var rows = savedList().filter(function (r) { return !(r.targetId === id && r.id === id); });
      if (!isSaved(id, id)) rows.push({ targetId: id, id: id, at: new Date().toISOString() });
      write('thread.saved', rows);
      var lab = document.querySelector('[data-thread-lab]');
      var host = lab && lab.querySelector('[data-thread-host]');
      var keep = host && findHost(host);
      if (lab) {
        var post = lab.querySelector('[data-th-post]');
        if (post) post.outerHTML = postHTML();
      }
      void keep;
    }
  }

  function bindDoc() {
    if (bound) return;
    document.addEventListener('click', onClick);
    document.addEventListener('click', onClickLab);
    document.addEventListener('input', onInput);
    document.addEventListener('keydown', onKey);
    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerUp);
    bound = true;
  }

  function mount(container, opts) {
    bindDoc();
    opts = opts || {};
    if (container && container.nodeType === 1) {
      if (isLive() && opts.targetId && (opts.repliesOnly || opts.liveEmbed)) {
        return mountLiveEmbed(container, opts);
      }
      return mountHost(container, opts);
    }
    if (isLive()) {
      if (document.querySelector('[data-thread-live]') && liveLab.key !== liveKey()) loadLiveLab();
      return;
    }
    var lab = document.querySelector('[data-thread-lab]');
    if (!lab) return;
    var host = lab.querySelector('[data-thread-host]');
    if (!host) return;
    var s = sample();
    mountHost(host, { targetId: s.post && s.post.id || 'thread', messages: s.messages, me: s.me, people: s.people, mode: 'chat' });
  }

  function destroy() {
    timers.forEach(function (t) { window.clearTimeout(t); });
    timers = [];
    hosts = [];
    liveEmbeds = [];
    if (!bound) return;
    document.removeEventListener('click', onClick);
    document.removeEventListener('click', onClickLab);
    document.removeEventListener('input', onInput);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('scroll', onScroll, true);
    document.removeEventListener('pointerdown', onPointerDown);
    document.removeEventListener('pointerup', onPointerUp);
    document.removeEventListener('pointercancel', onPointerUp);
    bound = false;
  }

  window.CommonsThread = {
    routes: { threads: labPage },
    hub: ['threads'],
    nav: [['threads', '讨论串', 'chat', 'discover']],
    icons: { chat: 'M4 6h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-4 3v-3H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zm11-1h5a2 2 0 0 1 2 2v5' },
    mount: mount,
    destroy: destroy
  };
  if (window.CommonsLinks && typeof window.CommonsLinks.provide === 'function') {
    window.CommonsLinks.provide('thread', function (handle) {
      var s = sample();
      var ids = {};
      peopleOf({ people: s.people }).forEach(function (p) { if (p.handle === handle) ids[p.id] = true; });
      var count = (s.messages || []).filter(function (m) { return ids[m.authorId]; }).length;
      return count ? { label: '讨论串', href: '#/threads/' + encodeURIComponent((s.post && s.post.id) || 'thread'), count: count, icon: 'chat' } : null;
    });
  }
  (window.CommonsPages = window.CommonsPages || []).push(window.CommonsThread);
})();
