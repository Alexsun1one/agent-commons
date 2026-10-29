/* R13 BOARD-1 · 白板预制组件（纯数据）
 * 加模板只改这个文件：往 list 里追加一项，board.js 不用动。
 *
 * 模板字段
 *   id     唯一编号；name 面板里的名字；desc 一句话说明
 *   items  图形列表。坐标相对模板左上角，单位是世界坐标（100% 缩放时 1 = 1px）
 *
 * 图形字段（和白板文档对象同一套，见 board.js 顶部注释）
 *   key        模板内引用名；连线用 a: { key }、b: { key } 指向它，拖进画布后变成真实对象 id
 *   kind       rect | ellipse | diamond | sticky | text | card | frame | line
 *   x y w h    位置和尺寸
 *   text       文字；fs 字号档（meta ui body item section feature display）；bold 粗体；
 *              align left | center；tc 图形内文字颜色
 *   fill color 颜色 token 名（不带 --）。写成 'cat-2/12' 表示该色按 12% 叠在 --surface 上
 *   size       线宽档 1–3；radius 圆角（世界单位）
 *   route      连线形状：sag 重力微垂（没有重力线引擎时退回平滑曲线）| curve | elbow 直角折线 | straight
 *   arrow      end | both | none；dash 虚线
 *   vote       true：便签右下角出现可点的 +1
 *   variant    card 的类型：knowledge 知识卡引用 | code 代码块 | note 带色条的卡片
 *   bind       数据绑定，目前支持 { source: 'knowledge', prefer: [ku 编号…], fallback: {…} }：
 *              从 window.COMMONS_KNOWLEDGE.units 里按 prefer 顺序挑一条（没有就挑佐证最多的已验证条目），
 *              文字里的 {title} {question} {corroboration} {statusLabel} {id} 换成该条目的字段
 */
window.CommonsBoardTemplates = {
  version: 1,
  list: [
    {
      id: 'flow',
      name: '流程',
      desc: '4 步横排，箭头相连',
      items: [
        { key: 'k1', kind: 'text', x: 0, y: 0, w: 176, h: 20, text: '第 1 步', fs: 'meta', color: 'faint' },
        { key: 'k2', kind: 'text', x: 240, y: 0, w: 176, h: 20, text: '第 2 步', fs: 'meta', color: 'faint' },
        { key: 'k3', kind: 'text', x: 480, y: 0, w: 176, h: 20, text: '第 3 步', fs: 'meta', color: 'faint' },
        { key: 'k4', kind: 'text', x: 720, y: 0, w: 176, h: 20, text: '第 4 步', fs: 'meta', color: 'faint' },
        { key: 's1', kind: 'rect', x: 0, y: 28, w: 176, h: 80, radius: 12, fill: 'blue-50', color: 'blue-300', text: '明确目标', fs: 'item', bold: true },
        { key: 's2', kind: 'rect', x: 240, y: 28, w: 176, h: 80, radius: 12, fill: 'blue-50', color: 'blue-300', text: '拆成步骤', fs: 'item', bold: true },
        { key: 's3', kind: 'rect', x: 480, y: 28, w: 176, h: 80, radius: 12, fill: 'blue-50', color: 'blue-300', text: '逐步执行', fs: 'item', bold: true },
        { key: 's4', kind: 'rect', x: 720, y: 28, w: 176, h: 80, radius: 12, fill: 'blue-50', color: 'blue-300', text: '核对结果', fs: 'item', bold: true },
        { key: 'c1', kind: 'text', x: 0, y: 120, w: 176, h: 20, text: '一句话说清楚', fs: 'ui', color: 'muted', align: 'center' },
        { key: 'c2', kind: 'text', x: 240, y: 120, w: 176, h: 20, text: '每一步能单独检查', fs: 'ui', color: 'muted', align: 'center' },
        { key: 'c3', kind: 'text', x: 480, y: 120, w: 176, h: 20, text: '做一步，记一步', fs: 'ui', color: 'muted', align: 'center' },
        { key: 'c4', kind: 'text', x: 720, y: 120, w: 176, h: 20, text: '对照目标逐条打勾', fs: 'ui', color: 'muted', align: 'center' },
        { kind: 'line', a: { key: 's1' }, b: { key: 's2' }, route: 'sag', arrow: 'end', color: 'blue-500', size: 2 },
        { kind: 'line', a: { key: 's2' }, b: { key: 's3' }, route: 'sag', arrow: 'end', color: 'blue-500', size: 2 },
        { kind: 'line', a: { key: 's3' }, b: { key: 's4' }, route: 'sag', arrow: 'end', color: 'blue-500', size: 2 }
      ]
    },
    {
      id: 'compare',
      name: '对比',
      desc: '两栏，各三条',
      items: [
        { key: 'la', kind: 'rect', x: 0, y: 0, w: 320, h: 52, radius: 12, fill: 'slate-100', color: 'slate-300', text: '方案 A', fs: 'section', bold: true, tc: 'ink-2' },
        { key: 'l1', kind: 'rect', x: 0, y: 64, w: 320, h: 48, radius: 8, fill: 'surface', color: 'line-strong', text: '第一条', fs: 'body', align: 'left', tc: 'ink-2' },
        { key: 'l2', kind: 'rect', x: 0, y: 124, w: 320, h: 48, radius: 8, fill: 'surface', color: 'line-strong', text: '第二条', fs: 'body', align: 'left', tc: 'ink-2' },
        { key: 'l3', kind: 'rect', x: 0, y: 184, w: 320, h: 48, radius: 8, fill: 'surface', color: 'line-strong', text: '第三条', fs: 'body', align: 'left', tc: 'ink-2' },
        { key: 'vs', kind: 'ellipse', x: 332, y: 8, w: 36, h: 36, fill: 'surface', color: 'line-strong', text: 'vs', fs: 'meta', tc: 'muted', size: 1 },
        { key: 'ra', kind: 'rect', x: 380, y: 0, w: 320, h: 52, radius: 12, fill: 'blue-50', color: 'blue-300', text: '方案 B', fs: 'section', bold: true, tc: 'blue-800' },
        { key: 'r1', kind: 'rect', x: 380, y: 64, w: 320, h: 48, radius: 8, fill: 'surface', color: 'blue-200', text: '第一条', fs: 'body', align: 'left' },
        { key: 'r2', kind: 'rect', x: 380, y: 124, w: 320, h: 48, radius: 8, fill: 'surface', color: 'blue-200', text: '第二条', fs: 'body', align: 'left' },
        { key: 'r3', kind: 'rect', x: 380, y: 184, w: 320, h: 48, radius: 8, fill: 'surface', color: 'blue-200', text: '第三条', fs: 'body', align: 'left' }
      ]
    },
    {
      id: 'timeline',
      name: '时间线',
      desc: '5 个节点，从左往右',
      items: [
        { kind: 'line', a: { x: 0, y: 40 }, b: { x: 900, y: 40 }, route: 'straight', arrow: 'end', color: 'slate-400', size: 2 },
        { key: 'd1', kind: 'ellipse', x: 51, y: 31, w: 18, h: 18, fill: 'blue-500', color: 'surface', size: 2 },
        { key: 'd2', kind: 'ellipse', x: 231, y: 31, w: 18, h: 18, fill: 'blue-500', color: 'surface', size: 2 },
        { key: 'd3', kind: 'ellipse', x: 411, y: 31, w: 18, h: 18, fill: 'violet-500', color: 'surface', size: 2 },
        { key: 'd4', kind: 'ellipse', x: 591, y: 31, w: 18, h: 18, fill: 'blue-500', color: 'surface', size: 2 },
        { key: 'd5', kind: 'ellipse', x: 771, y: 31, w: 18, h: 18, fill: 'teal-500', color: 'surface', size: 2 },
        { key: 't1', kind: 'text', x: -10, y: 0, w: 140, h: 20, text: '10.01', fs: 'meta', color: 'faint', align: 'center' },
        { key: 't2', kind: 'text', x: 170, y: 0, w: 140, h: 20, text: '10.08', fs: 'meta', color: 'faint', align: 'center' },
        { key: 't3', kind: 'text', x: 350, y: 0, w: 140, h: 20, text: '10.15', fs: 'meta', color: 'faint', align: 'center' },
        { key: 't4', kind: 'text', x: 530, y: 0, w: 140, h: 20, text: '10.22', fs: 'meta', color: 'faint', align: 'center' },
        { key: 't5', kind: 'text', x: 710, y: 0, w: 140, h: 20, text: '10.29', fs: 'meta', color: 'faint', align: 'center' },
        { key: 'e1', kind: 'text', x: -10, y: 64, w: 140, h: 44, text: '立项\n写下要解决的问题', fs: 'ui', align: 'center' },
        { key: 'e2', kind: 'text', x: 170, y: 64, w: 140, h: 44, text: '原型\n先跑通一条路', fs: 'ui', align: 'center' },
        { key: 'e3', kind: 'text', x: 350, y: 64, w: 140, h: 44, text: '复盘\n留下踩过的坑', fs: 'ui', align: 'center' },
        { key: 'e4', kind: 'text', x: 530, y: 64, w: 140, h: 44, text: '内测\n请五个人试用', fs: 'ui', align: 'center' },
        { key: 'e5', kind: 'text', x: 710, y: 64, w: 140, h: 44, text: '上线\n写成方法卡', fs: 'ui', align: 'center' }
      ]
    },
    {
      id: 'quadrant',
      name: '四象限',
      desc: '两条轴分出四块',
      items: [
        { key: 'q1', kind: 'rect', x: 0, y: 0, w: 260, h: 196, radius: 12, fill: 'violet-50', text: '重要，不紧急\n排进计划', fs: 'item', tc: 'violet-800' },
        { key: 'q2', kind: 'rect', x: 276, y: 0, w: 260, h: 196, radius: 12, fill: 'blue-50', text: '重要，也紧急\n马上做', fs: 'item', tc: 'blue-800' },
        { key: 'q3', kind: 'rect', x: 0, y: 212, w: 260, h: 196, radius: 12, fill: 'slate-100', text: '不重要，不紧急\n可以不做', fs: 'item', tc: 'ink-2' },
        { key: 'q4', kind: 'rect', x: 276, y: 212, w: 260, h: 196, radius: 12, fill: 'sky-50', text: '紧急，不重要\n交给别人', fs: 'item', tc: 'sky-700' },
        { kind: 'line', a: { x: 268, y: 424 }, b: { x: 268, y: -20 }, route: 'straight', arrow: 'end', color: 'slate-500', size: 1 },
        { kind: 'line', a: { x: -16, y: 204 }, b: { x: 556, y: 204 }, route: 'straight', arrow: 'end', color: 'slate-500', size: 1 },
        { kind: 'text', x: 280, y: -28, w: 120, h: 20, text: '重要程度', fs: 'meta', color: 'muted' },
        { kind: 'text', x: 500, y: 212, w: 80, h: 20, text: '紧急程度', fs: 'meta', color: 'muted' }
      ]
    },
    {
      id: 'layers',
      name: '分层架构',
      desc: '四层，自上而下',
      items: [
        { key: 'l1', kind: 'rect', x: 0, y: 0, w: 600, h: 60, radius: 12, fill: 'sky-50', color: 'sky-200', text: '界面层 · 页面与交互', fs: 'item', bold: true, tc: 'sky-700' },
        { key: 'l2', kind: 'rect', x: 0, y: 84, w: 600, h: 60, radius: 12, fill: 'blue-50', color: 'blue-200', text: '接口层 · 路由与校验', fs: 'item', bold: true, tc: 'blue-800' },
        { key: 'l3', kind: 'rect', x: 0, y: 168, w: 600, h: 60, radius: 12, fill: 'violet-50', color: 'violet-200', text: '服务层 · 业务规则', fs: 'item', bold: true, tc: 'violet-800' },
        { key: 'l4', kind: 'rect', x: 0, y: 252, w: 600, h: 60, radius: 12, fill: 'teal-50', color: 'teal-200', text: '数据层 · 表与索引', fs: 'item', bold: true, tc: 'teal-800' },
        { kind: 'line', a: { key: 'l1' }, b: { key: 'l2' }, route: 'straight', arrow: 'end', color: 'slate-400', size: 1 },
        { kind: 'line', a: { key: 'l2' }, b: { key: 'l3' }, route: 'straight', arrow: 'end', color: 'slate-400', size: 1 },
        { kind: 'line', a: { key: 'l3' }, b: { key: 'l4' }, route: 'straight', arrow: 'end', color: 'slate-400', size: 1 }
      ]
    },
    {
      id: 'pme',
      name: '问题 → 方法 → 证据',
      desc: '三联卡，讲清一件事',
      items: [
        { key: 'p', kind: 'card', variant: 'note', x: 0, y: 0, w: 236, h: 160, color: 'violet-500', title: '问题', text: '要解决什么？谁遇到了，在什么场景下？' },
        { key: 'm', kind: 'card', variant: 'note', x: 296, y: 0, w: 236, h: 160, color: 'blue-500', title: '方法', text: '怎么做？关键的一步是什么？' },
        { key: 'e', kind: 'card', variant: 'note', x: 592, y: 0, w: 236, h: 160, color: 'teal-500', title: '证据', text: '怎么知道有效？数据、截图或使用者原话。' },
        { kind: 'line', a: { key: 'p' }, b: { key: 'm' }, route: 'curve', arrow: 'end', color: 'slate-400', size: 2 },
        { kind: 'line', a: { key: 'm' }, b: { key: 'e' }, route: 'curve', arrow: 'end', color: 'slate-400', size: 2 }
      ]
    },
    {
      id: 'mindmap',
      name: '思维导图起点',
      desc: '中心主题加 4 个分支',
      items: [
        { key: 'c', kind: 'ellipse', x: 220, y: 116, w: 200, h: 92, fill: 'accent', text: '中心主题', fs: 'section', bold: true, tc: 'on-accent' },
        { key: 'b1', kind: 'rect', x: 0, y: 0, w: 168, h: 52, radius: 26, fill: 'surface', color: 'blue-300', text: '为什么', fs: 'item' },
        { key: 'b2', kind: 'rect', x: 472, y: 0, w: 168, h: 52, radius: 26, fill: 'surface', color: 'blue-300', text: '怎么做', fs: 'item' },
        { key: 'b3', kind: 'rect', x: 0, y: 272, w: 168, h: 52, radius: 26, fill: 'surface', color: 'blue-300', text: '谁来做', fs: 'item' },
        { key: 'b4', kind: 'rect', x: 472, y: 272, w: 168, h: 52, radius: 26, fill: 'surface', color: 'blue-300', text: '怎么算成', fs: 'item' },
        { kind: 'line', a: { key: 'c' }, b: { key: 'b1' }, route: 'curve', arrow: 'none', color: 'blue-300', size: 2 },
        { kind: 'line', a: { key: 'c' }, b: { key: 'b2' }, route: 'curve', arrow: 'none', color: 'blue-300', size: 2 },
        { kind: 'line', a: { key: 'c' }, b: { key: 'b3' }, route: 'curve', arrow: 'none', color: 'blue-300', size: 2 },
        { kind: 'line', a: { key: 'c' }, b: { key: 'b4' }, route: 'curve', arrow: 'none', color: 'blue-300', size: 2 }
      ]
    },
    {
      id: 'vote',
      name: '投票便签',
      desc: '一排便签，点 +1 投票',
      items: [
        { kind: 'text', x: 0, y: 0, w: 660, h: 24, text: '投票：下节课先讲哪一块？点便签右下角的 +1', fs: 'item', bold: true },
        { key: 'v1', kind: 'sticky', x: 0, y: 40, w: 150, h: 150, fill: 'sky-100', text: '提示词写法', fs: 'item', vote: true },
        { key: 'v2', kind: 'sticky', x: 170, y: 40, w: 150, h: 150, fill: 'violet-100', text: '验收清单', fs: 'item', vote: true },
        { key: 'v3', kind: 'sticky', x: 340, y: 40, w: 150, h: 150, fill: 'teal-100', text: '给 Agent 接工具', fs: 'item', vote: true },
        { key: 'v4', kind: 'sticky', x: 510, y: 40, w: 150, h: 150, fill: 'blue-100', text: '知识库出处', fs: 'item', vote: true }
      ]
    }
  ]
};
(function () {
  function isDemo() {
    if (window.COMMONS_BUILD_LIVE === true || (window.CommonsAPI && window.CommonsAPI.mode === 'live')) return false;
    if (window.COMMONS_BUILD && window.COMMONS_BUILD.mode) return window.COMMONS_BUILD.mode === 'demo';
    return !!((window.CommonsAPI && window.CommonsAPI.mode === 'demo') || window.location.protocol === 'file:');
  }
  if (isDemo() && window.COMMONS_BOARD_TEMPLATES_SAMPLE) {
    window.CommonsBoardTemplates.list = window.CommonsBoardTemplates.list.concat(window.COMMONS_BOARD_TEMPLATES_SAMPLE.list);
  }
})();
