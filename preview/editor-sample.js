/* LG-3A R2 · 演示编辑器数据；线上包不得加载。 */
(function () {
  'use strict';
  var DEMO_ID = 'k-demo-1';
  var MEMBERS = [
    { id: 'm-gucheng', handle: 'chen-mo', name: '陈墨', level: 3, note: '知识整理' },
    { id: 'm-yezhi', handle: 'lin-qi', name: '林栖', level: 1, note: 'Agent 工程' },
    { id: 'm-wenxi', handle: 'yu-lan', name: '余岚', level: 4, note: '前端与可视化' },
    { id: 'm-chengye', handle: 'song-yuan', name: '松原', level: 5, note: '自动化测试' },
    { id: 'm-luyao', handle: 'chen-mo', name: '陈墨', level: 3, note: '长任务编排' },
    { id: 'm-xuhe', handle: 'lin-qi', name: '林栖', level: 1, note: '新加入' },
    { id: 'm-shenyan', handle: 'song-yuan', name: '松原', level: 5, note: '治理委员' },
    { id: 'm-linlan', handle: 'yu-lan', name: '余岚', level: 2, note: '产品研究' }
  ];
  var SPACES = [
    { id: 'sp-camp', name: 'Agent 实战营 · 第 3 期', count: 42 },
    { id: 'sp-kb', name: '知识库共建项目', count: 18 },
    { id: 'sp-club', name: '会员会馆', count: 260 }
  ];
  var LEVEL_COUNT = { 2: 410, 3: 128, 4: 36, 5: 9 };
  var SPACE_CARDS = {
    'ku-space-07': { id: 'ku-space-07', kind: 'resource', status: 'curated', title: '实战营内部：长任务断点续跑的评分表', solution: '按「能否从最近检查点继续」「是否重做已完成步骤」两项给每次续跑打分。', corroboration: 3, space: 'Agent 实战营 · 第 3 期' }
  };
  var FALLBACK_UNITS = [
    { id: 'ku001', kind: 'question', status: 'curated', title: '长任务中途断了怎么接着跑', question: '跑了很久的改造任务中途断了，重开后像失忆一样从头来。', corroboration: 5 },
    { id: 'ku002', kind: 'solution', status: 'stale', title: '把长任务拆成带检查点的小步', solution: '把长任务拆成带检查点的小步，每步写进进度文件。', corroboration: 5 }
  ];
  var DEMO_WORK_ID = 'hw-demo-board';
  var DEMO_WORK_HTML = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>检查点看板</title><style>' +
    'body{margin:0;font:15px/1.5 -apple-system,"PingFang SC",sans-serif;background:aliceblue;color:midnightblue;padding:28px}' +
    'h1{font-size:20px;margin:0 0 14px}ol{list-style:none;padding:0;margin:0;display:grid;gap:10px}' +
    'li{display:flex;gap:12px;align-items:center;background:white;border:1px solid lightsteelblue;border-radius:12px;padding:12px 14px;cursor:pointer}' +
    'li i{width:18px;height:18px;border-radius:50%;border:2px solid lightsteelblue;flex:none}li.done{border-color:royalblue}' +
    'li.done i{background:royalblue;border-color:royalblue}li.here{border-color:mediumpurple;border-style:dashed}li.here b{color:rebeccapurple}' +
    'p{color:slategray;font-size:13px;margin:14px 0 0}</style></head><body><h1>长任务检查点 · 示例</h1><ol id="list"></ol><p>点一下切换完成状态。数据只在这个沙箱里。</p><script>' +
    'var steps=["列出要改的 37 个文件","改 src/api","改 src/ui","跑一遍测试","合并并写复盘"],done=[true,true,false,false,false];' +
    'function paint(){var f=done.indexOf(false);document.getElementById("list").innerHTML=steps.map(function(s,i){return "<li class=\\""+(done[i]?"done":"")+(i===f?" here":"")+"\\" data-i=\\""+i+"\\"><i></i><span>"+(i+1)+". "+s+(i===f?" <b>← 断在这</b>":"")+"</span></li>"}).join("")}' +
    'document.addEventListener("click",function(e){var li=e.target.closest("li");if(!li)return;var i=+li.dataset.i;done[i]=!done[i];paint()});paint();' +
    '<\/script></body></html>';

  var works = {};
  works[DEMO_WORK_ID] = { title: '长任务检查点看板', html: DEMO_WORK_HTML };
  /* 示例配图：用 token 色在 canvas 上画「检查点」示意，导出 PNG dataURL */
  var demoImg = '';
  function demoImage() {
    if (demoImg) return demoImg;
    try {
      var cs = getComputedStyle(document.documentElement);
      var v = function (n) { return cs.getPropertyValue(n).trim(); };
      var c = { bg: v('--tint-blue'), ink: v('--ink'), muted: v('--muted'), line: v('--blue-200'), accent: v('--accent'), soft: v('--accent-soft'), notice: v('--notice'), noticeSoft: v('--notice-soft'), surface: v('--surface'), teal: v('--teal-500'), sans: v('--sans') };
      if (!c.bg || !c.accent || !c.sans) return '';
      var cv = document.createElement('canvas');
      cv.width = 1200; cv.height = 600;
      var x = cv.getContext('2d');
      x.fillStyle = c.bg; x.fillRect(0, 0, 1200, 600);
      x.font = '600 30px ' + c.sans; x.fillStyle = c.ink; x.fillText('进度文件里的检查点', 72, 92);
      x.font = '400 22px ' + c.sans; x.fillStyle = c.muted; x.fillText('断了以后，新会话从最近的检查点接着跑', 72, 132);
      var xs = [150, 375, 600, 825, 1050], y = 330, labels = ['列清单', '改 api', '改 ui', '跑测试', '合并'];
      x.lineWidth = 6; x.lineCap = 'round';
      x.strokeStyle = c.accent; x.beginPath(); x.moveTo(xs[0], y); x.lineTo(xs[2], y); x.stroke();
      x.strokeStyle = c.line; x.setLineDash([4, 16]); x.beginPath(); x.moveTo(xs[2], y); x.lineTo(xs[4], y); x.stroke(); x.setLineDash([]);
      xs.forEach(function (px, i) {
        x.beginPath(); x.arc(px, y, 34, 0, Math.PI * 2);
        x.fillStyle = i < 2 ? c.accent : (i === 2 ? c.noticeSoft : c.surface); x.fill();
        x.lineWidth = 4; x.strokeStyle = i < 2 ? c.accent : (i === 2 ? c.notice : c.line); x.stroke();
        x.fillStyle = i < 2 ? c.surface : (i === 2 ? c.notice : c.muted);
        x.font = '600 24px ' + c.sans; x.textAlign = 'center'; x.textBaseline = 'middle';
        x.fillText(i < 2 ? '✓' : String(i + 1), px, y + 1);
        x.fillStyle = c.ink; x.font = '500 22px ' + c.sans; x.fillText(labels[i], px, y + 74);
      });
      x.fillStyle = c.notice; x.font = '600 22px ' + c.sans; x.fillText('断在这里', xs[2], y - 72);
      x.strokeStyle = c.teal; x.lineWidth = 4; x.beginPath(); x.moveTo(xs[2] - 120, 500); x.quadraticCurveTo(xs[2] - 40, 470, xs[2] - 10, 420); x.stroke();
      x.fillStyle = c.teal; x.textAlign = 'left'; x.font = '500 22px ' + c.sans; x.fillText('新会话先读进度文件，再从这里继续', xs[2] - 380, 540);
      x.textAlign = 'right'; x.fillStyle = c.muted; x.font = '400 18px ' + c.sans; x.fillText('示意图', 1128, 560);
      demoImg = cv.toDataURL('image/png');
      return demoImg;
    } catch (e) { return ''; }
  }

  function demoDoc() {
    var t = function (text, marks) { return marks ? { type: 'text', text: text, marks: marks } : { type: 'text', text: text }; };
    var p = function () { return { type: 'paragraph', content: Array.prototype.slice.call(arguments) }; };
    var h = function (level, text) { return { type: 'heading', attrs: { level: level }, content: [t(text)] }; };
    var li = function (text) { return { type: 'listItem', content: [p(t(text))] }; };
    var mention = function (id) { var m = memberOf(id) || { name: '成员' }; return { type: 'mention', attrs: { id: id, label: m.name, handle: m.handle || '' } }; };
    return {
      type: 'doc',
      content: [
        h(2, '为什么会「失忆」'),
        p(t('让编程 Agent 跑一个几十步的改造，中途断了或上下文满了，新会话会'), t('从头再来', [{ type: 'bold' }]), t('。问题不在模型，而在'), t('进度只存在对话里', [{ type: 'italic' }]), t('。'), mention('m-gucheng'), t(' 在群里问过同一个问题 '), { type: 'emoji', attrs: { name: 'question' } }),
        { type: 'knowledgeCard', attrs: { refId: 'ku001' } },
        h(2, '做法：把进度写进文件'),
        p(t('核心是一份 '), t('PROGRESS.md', [{ type: 'code' }]), t('：每完成一步就更新它，并提交一次。'), t('断了之后，新会话先读它再开工。', [{ type: 'highlight' }])),
        { type: 'orderedList', attrs: { start: 1, type: null }, content: [li('先让 Agent 列出任务清单，写进进度文件'), li('每完成一步，更新进度文件并提交一次'), li('断了以后，新会话先读进度文件再继续')] },
        { type: 'codeBlock', attrs: { language: 'bash' }, content: [t('# 新会话的第一句话\nclaude "先读 PROGRESS.md，从第一个没勾的步骤继续，不要重做已完成的步骤"')] },
        h(3, '进度文件长什么样'),
        { type: 'codeBlock', attrs: { language: 'markdown' }, content: [t('- [x] 01 列出要改的 37 个文件\n- [x] 02 改完 src/api（已提交）\n- [ ] 03 改 src/ui   ← 断在这\n- [ ] 04 跑一遍测试\n- [ ] 05 合并并写复盘')] },
        { type: 'image', attrs: { src: demoImage(), alt: '五个检查点排成一行，前两个已完成，第三个标着断在这里', title: null, width: 1200, height: 600, caption: '每一步都落一个检查点：断了从最近的检查点接着跑（示意图）' } },
        { type: 'blockquote', content: [p(t('断了不可怕，可怕的是不知道断在哪。')), p(t('—— '), mention('m-yezhi'), t('，在第 3 期实战营的复盘里'))] },
        { type: 'knowledgeCard', attrs: { refId: 'ku002' } },
        h(2, '一个能点的小看板'),
        p(t('下面这个 HTML 作品是 '), mention('m-wenxi'), t(' 做的进度看板，点一下就能切换完成状态 '), { type: 'emoji', attrs: { name: 'useful' } }),
        { type: 'htmlWork', attrs: { workId: DEMO_WORK_ID, title: '长任务检查点看板', bytes: bytesOf(DEMO_WORK_HTML) } },
        { type: 'horizontalRule' },
        h(2, '还没想清楚的'),
        { type: 'bulletList', content: [li('进度文件和 Git 提交，哪个才是「真相」？'), li('多个 Agent 并行时，进度文件会不会互相覆盖？')] },
        { type: 'knowledgeCard', attrs: { refId: 'ku-space-07' } },
        p(t('下一步想补：多个 Agent 共用一份进度文件时怎么加锁。参考 '), t('长任务讨论串', [{ type: 'link', attrs: { href: '#/threads/post-demo', target: null, rel: null, class: null } }]), t(' 和 '), t('长任务编排笔记', [{ type: 'link', attrs: { href: 'https://example.com/long-running-agents', target: '_blank', rel: 'noopener nofollow ugc', class: null } }]), t('，还在读 '), { type: 'emoji', attrs: { name: 'spark' } }),
        { type: 'image', attrs: { src: '', alt: '', title: null, width: null, height: null, caption: '' } },
        { type: 'paragraph' }
      ]
    };
  }
  var DEMO_TITLE = '长任务断了也能接着跑：给编程 Agent 加检查点';
  var DEMO_LEAD = '把进度写进文件、每步提交一次，新会话先读进度再开工。写给第一次让 Agent 跑长任务的人。';
  var DEMO_AUTHOR = { id: 'm-luyao', handle: 'chen-mo', name: '陈墨', level: 3 };

  function memberOf(id) { return MEMBERS.find(function (m) { return m.id === id; }); }
  function bytesOf(s) { return typeof TextEncoder === 'function' ? new TextEncoder().encode(s).length : s.length * 3; }
  window.COMMONS_EDITOR_SAMPLE = {
    id: DEMO_ID, members: MEMBERS, spaces: SPACES, levelCount: LEVEL_COUNT,
    spaceCards: SPACE_CARDS, units: FALLBACK_UNITS, works: works,
    doc: demoDoc, image: demoImage, title: DEMO_TITLE, summary: DEMO_LEAD, author: DEMO_AUTHOR,
    visibility: { scope: 'members', level: 3, space: SPACES[0].id, people: ['m-gucheng', 'm-yezhi'] },
    publishedAt: '2026-10-25T06:20:00Z',
    corroboration: 12, reproduced: 4,
    reactions: { counts: { useful: 9, learned: 6, reproduced: 4, up: 3, spark: 2 }, mine: ['learned'] },
    related: ['ku001', 'ku002', 'ku010', 'ku-space-07']
  };
})();
