// R17-G 离线契约检查（不是浏览器或视觉验收）：知识网图谱与知识治理页。mock 的形状照真实路由写：
//   GET /governance/knowledge-graph -> { data: { nodes:[{id,title,status,stale_hint,industry_key,tools,verified,updated_at}],
//        links:[{from,to,kind}], attention:[{id,reason}], summary:{total,shown,truncated,pending,verified,stale,stale_hint,pending_days} } }
//   GET /objects?type=knowledge     -> { data: [ ...对象 ], meta: { next_cursor } }
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const preview = name => fs.readFileSync(path.resolve(__dirname, '../../preview/' + name), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = u => (/^#\//.test(String(u)) ? esc(u) : '#');

function slot() {
  return { innerHTML: '', hidden: true, remove() { this.removed = true; }, querySelector: () => null, addEventListener() {} };
}

function env(hash, routes) {
  const slots = { '.knet-live-status': slot(), '[data-knet-live-empty]': slot(), '[data-knet-live-body]': slot(), '[data-knet-graph]': slot() };
  const gets = [];
  const host = {
    isConnected: true,
    getAttribute: name => (name === 'data-id' ? decodeURIComponent((/^#\/knowledge\/([^/?#]+)/.exec(hash) || [])[1] || '') : null),
    querySelector: sel => slots[sel] || null
  };
  const root = { querySelector: sel => (sel === '[data-knet-live]' ? host : null), setAttribute() {}, removeAttribute() {}, addEventListener() {}, removeEventListener() {} };
  const document = { querySelector: sel => (sel === '[data-knet-root]' ? root : null), querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} };
  const location = { hash, search: '' };
  const window = {
    CommonsAPI: {
      mode: 'live',
      get: (url, query) => {
        gets.push(url + (query && query.type ? '?type=' + query.type : ''));
        const fn = routes[url];
        return fn ? Promise.resolve(fn(query)) : Promise.reject({ status: 404, message: 'not found ' + url });
      }
    },
    Commons: { esc, safeUrl, icon: () => '' },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener() {}, removeEventListener() {}, devicePixelRatio: 1, location
  };
  const ctx = { window, document, location, console, performance: { now: () => 0 }, requestAnimationFrame: () => 0, cancelAnimationFrame() {}, setTimeout, clearTimeout };
  vm.runInNewContext(preview('knowledge-net.js'), ctx);
  return { K: window.CommonsKnowledge, slots, gets, location };
}

const GRAPH = {
  nodes: [
    { id: 'p1', title: '标准问题', status: 'verified', stale_hint: false, industry_key: 'education', tools: ['codex'], verified: 3, updated_at: 't' },
    { id: 'p2', title: '重复问题 <img src=x onerror=alert(1)>', status: 'pending', stale_hint: false, industry_key: null, tools: [], verified: 0, updated_at: 't' },
    { id: 'p3', title: '旧办法', status: 'stale', stale_hint: false, industry_key: null, tools: [], verified: 1, updated_at: 't' },
    { id: 'p4', title: '新办法', status: 'verified', stale_hint: false, industry_key: null, tools: [], verified: 3, updated_at: 't' },
    { id: 'p5', title: '孤立的问题', status: 'pending', stale_hint: true, industry_key: null, tools: [], verified: 0, updated_at: 't' }
  ],
  links: [{ from: 'p2', to: 'p1', kind: 'duplicate' }, { from: 'p3', to: 'p4', kind: 'replacement' }],
  attention: [{ id: 'p3', reason: 'stale' }, { id: 'p5', reason: 'stale_hint' }, { id: 'p2', reason: 'duplicate' }, { id: 'p3', reason: 'replaced' }, { id: 'p1', reason: 'pending_long' }],
  summary: { total: 5, shown: 5, truncated: false, pending: 2, verified: 2, stale: 1, stale_hint: 1, pending_days: 14 }
};

async function graphOnList() {
  const e = env('#/knowledge', {
    '/governance/knowledge-graph': () => ({ data: GRAPH }),
    '/objects': () => ({ data: [], meta: {} })
  });
  const shell = e.K.view('');
  assert.match(shell, /data-knet-graph/, '列表页有图谱挂载点');
  e.K.mount();
  await flush(); await flush();
  const html = e.slots['[data-knet-graph]'].innerHTML;
  assert.match(html, /<svg class="knet-live-svg"/);
  assert.equal((html.match(/class="knet-node"/g) || []).length, 5, '每张问题卡一个点');
  assert.equal((html.match(/class="knet-edge"/g) || []).length, 2, '每条关联一条线');
  assert.match(html, /data-kind="duplicate"/);
  assert.match(html, /data-kind="replacement"[^>]*marker-end/);
  assert.match(html, /href="#\/solved\/p1"/);
  assert.match(html, /data-status="pending" data-hint="1"/, '可能过期的点有标记');
  assert.doesNotMatch(html, /<img src=x/, '标题里的 HTML 被转义');
  assert.match(html, /重复问题 &lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /关联清单（2）/);
  assert.match(html, /5 张问题卡 · 2 条关联/);
  assert.match(html, /href="#\/knowledge\/govern"/, '有去治理页的入口');
  assert.ok(e.gets.includes('/governance/knowledge-graph'));
}

async function graphEmptyAndErrors() {
  const empty = env('#/knowledge', {
    '/governance/knowledge-graph': () => ({ data: { nodes: [], links: [], attention: [], summary: { total: 0 } } }),
    '/objects': () => ({ data: [], meta: {} })
  });
  empty.K.view('');
  empty.K.mount();
  await flush(); await flush();
  assert.equal(empty.slots['[data-knet-graph]'].innerHTML, '', '没有问题卡就不画，也不补示例');
  assert.equal(empty.slots['[data-knet-live-empty]'].hidden, false, '原来的空状态还在');

  const closed = env('#/knowledge', {
    '/governance/knowledge-graph': () => Promise.reject({ status: 501, code: 'capability_unavailable' }),
    '/objects': () => ({ data: [], meta: {} })
  });
  closed.K.view('');
  closed.K.mount();
  await flush(); await flush();
  assert.equal(closed.slots['[data-knet-graph]'].innerHTML, '', '功能没开放：不显示错误条');

  const broken = env('#/knowledge', {
    '/governance/knowledge-graph': () => Promise.reject({ status: 500, message: 'boom' }),
    '/objects': () => ({ data: [], meta: {} })
  });
  broken.K.view('');
  broken.K.mount();
  await flush(); await flush();
  assert.match(broken.slots['[data-knet-graph]'].innerHTML, /data-knet-graph-error/);
  assert.match(broken.slots['[data-knet-graph]'].innerHTML, /重新读取/);
}

async function governPage() {
  const e = env('#/knowledge/govern', { '/governance/knowledge-graph': () => ({ data: GRAPH }) });
  const shell = e.K.view('govern');
  assert.match(shell, /<h1>知识治理<\/h1>/);
  assert.doesNotMatch(shell, /data-knet-graph/, '治理页不挂图谱');
  e.K.mount();
  await flush(); await flush();
  assert.deepEqual(e.gets, ['/governance/knowledge-graph'], '治理页不去读知识条目列表');
  const html = e.slots['[data-knet-live-body]'].innerHTML;
  for (const reason of ['stale', 'stale_hint', 'pending_long', 'duplicate', 'replaced']) {
    assert.match(html, new RegExp('data-reason="' + reason + '"'), reason);
  }
  assert.match(html, /久未验证（超过 14 天）/);
  assert.match(html, /重复于 <a href="#\/solved\/p1">标准问题<\/a>/);
  assert.match(html, /被替代为 <a href="#\/solved\/p4">新办法<\/a>/);
  assert.match(html, /<strong class="knet-num">2<\/strong><span>待验证<\/span>/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.equal(e.slots['.knet-live-status'].removed, true);
}

async function governEmptyStates() {
  const none = env('#/knowledge/govern', {
    '/governance/knowledge-graph': () => ({ data: { nodes: [], links: [], attention: [], summary: { total: 0 } } })
  });
  none.K.view('govern'); none.K.mount();
  await flush(); await flush();
  assert.match(none.slots['[data-knet-live-body]'].innerHTML, /问题库里还没有问题卡/);

  const clean = env('#/knowledge/govern', {
    '/governance/knowledge-graph': () => ({ data: { nodes: [GRAPH.nodes[0]], links: [], attention: [], summary: { total: 1, shown: 1, truncated: false, pending: 0, verified: 1, stale: 0, stale_hint: 0, pending_days: 14 } } })
  });
  clean.K.view('govern'); clean.K.mount();
  await flush(); await flush();
  assert.match(clean.slots['[data-knet-live-body]'].innerHTML, /现在没有需要处理的问题卡/);

  const failed = env('#/knowledge/govern', { '/governance/knowledge-graph': () => Promise.reject({ status: 500, message: '服务忙' }) });
  failed.K.view('govern'); failed.K.mount();
  await flush(); await flush();
  assert.match(failed.slots['[data-knet-live-body]'].innerHTML, /没有读出来/);
  assert.match(failed.slots['[data-knet-live-body]'].innerHTML, /服务忙/);
}

(async () => {
  await graphOnList();
  await graphEmptyAndErrors();
  await governPage();
  await governEmptyStates();
  console.log('_PASS r17g-ui');
})().catch(error => { console.error(error); process.exit(1); });
