// R17-C 离线契约检查（不是浏览器或视觉验收）：mock 的返回值照真实路由的形状写。
//   GET /kb/taxonomy            -> { data: { tools: [{key,label,group}], industries: [{key,label}] } }
//   GET /kb/search              -> { data: [ ...问题 ] }
//   GET /objects/{id}           -> { data: { title, content: { body } } }
//   GET /content/hot-discussions/{event} -> { data: null | { id, title } }
//   POST /content/hot-discussions/{event} -> { data: { id, title, created } }
//   GET /content/digest-read/{day}       -> { data: { date, read } }
//   GET /bounty/rules           -> { data: { min_levels: {...}, caps: {...}, ... } }
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const preview = name => fs.readFileSync(path.resolve(__dirname, '../../preview/' + name), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function sandbox(api, hash) {
  const listeners = {};
  const host = { html: '', set innerHTML(v) { this.html = v; }, get innerHTML() { return this.html; } };
  const root = {
    get innerHTML() { return host.html; },
    parentNode: host,
    dataset: {},
    querySelector(selector) {
      const attr = selector.replace(/^\[|\]$/g, '').replace(/^\./, 'class="');
      return host.html.includes(attr) ? stub() : null;
    },
    querySelectorAll: () => [],
    contains: () => true
  };
  host.querySelector = () => root;
  const stub = () => ({ innerHTML: '', textContent: '', value: '', hidden: false, focus() {}, scrollIntoView() {}, setAttribute() {}, removeAttribute() {} });
  const document = {
    activeElement: null,
    querySelector: selector => (selector === '[data-kb]' || selector === '[data-hot]') ? root : null,
    querySelectorAll: () => [],
    addEventListener: (name, fn) => { listeners[name] = fn; },
    removeEventListener: () => {}
  };
  const toasts = [];
  const location = { hash };
  const window = {
    CommonsAPI: Object.assign({ mode: 'live', newIdempotencyKey: () => 'key-' + Math.random().toString(36).slice(2, 12) }, api),
    Commons: { toast: m => toasts.push(m), read: (k, f) => f, write: () => true, refresh() {} },
    CommonsPages: [],
    matchMedia: () => ({ matches: false }),
    setTimeout, clearTimeout, requestAnimationFrame: () => 0, cancelAnimationFrame() {}, addEventListener() {}, removeEventListener() {},
    location
  };
  const ctx = { window, document, location, CSS: { escape: v => v }, console, setTimeout, clearTimeout, requestAnimationFrame: () => 0, cancelAnimationFrame() {} };
  return { ctx, window, document, host, root, listeners, toasts, location };
}

function click(env, attrs, extra) {
  const btn = Object.assign({
    dataset: attrs, disabled: false, closest: sel => (sel === '[data-hot-act]' || sel === '[data-kb-act]') ? btn : null,
    setAttribute() {}, querySelector: () => ({ textContent: '' })
  }, extra || {});
  env.listeners.click({ target: { closest: btn.closest }, preventDefault() {} });
  return btn;
}

async function kbTest() {
  const calls = [];
  const env = sandbox({
    get: (url) => {
      calls.push(url);
      if (url === '/kb/taxonomy') {
        return Promise.resolve({ data: {
          tools: [{ key: 'claude', label: 'Claude', group: 'models' }, { key: 'brand-new-tool', label: '新工具', group: 'agents' }],
          industries: [{ key: 'education', label: '教育' }, { key: 'brand-new-industry', label: '新行业' }]
        } });
      }
      if (url === '/kb/search') return Promise.resolve({ data: [] });
      if (url === '/objects/abc-123') return Promise.resolve({ data: { title: '安装卡住了', content: { body: '一直转圈 <b>x</b>' } } });
      return Promise.reject(new Error('unexpected GET ' + url));
    },
    post: () => Promise.reject(new Error('unexpected POST'))
  }, '#/solved?capture=discussion:abc-123');
  vm.runInNewContext(preview('kb.js'), env.ctx);
  const kb = env.window.CommonsKB;
  assert.doesNotMatch(preview('kb.js'), /LIVE_TOOLS|LIVE_INDUSTRIES/);
  env.host.html = kb.routes.solved();
  assert.match(env.host.html, /正在读取问题库/);
  kb.mount();
  await flush(); await flush(); await flush();
  assert.ok(calls.indexOf('/kb/taxonomy') >= 0, '先读字典');
  assert.ok(calls.indexOf('/kb/taxonomy') < calls.indexOf('/kb/search'), '字典先于检索');
  const html = env.host.html;
  assert.match(html, /<option value="brand-new-tool"[^>]*>新工具<\/option>/);
  assert.match(html, /<option value="brand-new-industry"[^>]*>新行业<\/option>/);
  assert.doesNotMatch(html, /value="kimi"/, '前端不再自带工具表');
  // 预填：来源、标题、现象；用户输入的 HTML 被转义
  assert.match(html, /name="source_id"[^>]*value="abc-123"/);
  assert.match(html, /name="title"[^>]*value="安装卡住了"/);
  assert.match(html, /一直转圈 &lt;b&gt;x&lt;\/b&gt;/);
  assert.ok(calls.filter(u => u === '/objects/abc-123').length === 1);
  kb.destroy();
}

async function kbSeedFailure() {
  const env = sandbox({
    get: (url) => {
      if (url === '/kb/taxonomy') return Promise.resolve({ data: { tools: [], industries: [] } });
      if (url === '/kb/search') return Promise.resolve({ data: [] });
      return Promise.reject({ status: 404, message: 'not found' });
    }
  }, '#/solved?capture=discussion:gone');
  vm.runInNewContext(preview('kb.js'), env.ctx);
  env.host.html = env.window.CommonsKB.routes.solved();
  env.window.CommonsKB.mount();
  await flush(); await flush(); await flush();
  assert.match(env.host.html, /name="source_id"[^>]*value="gone"/);
  assert.match(env.host.html, /没读到这个讨论的内容/);
  env.window.CommonsKB.destroy();
}

async function kbTaxonomyError() {
  // 字典读不到：问题列表、提问/沉淀表单照常出，只多一句提示和重试；重试成功后下拉补上
  let fail = true;
  const env = sandbox({
    get: (url) => {
      if (url === '/kb/taxonomy') {
        return fail ? Promise.reject({ status: 500, message: '字典没读到' })
          : Promise.resolve({ data: { tools: [{ key: 'claude', label: 'Claude', group: 'models' }], industries: [] } });
      }
      if (url === '/kb/search') return Promise.resolve({ data: [] });
      return Promise.reject(new Error('unexpected GET ' + url));
    }
  }, '#/solved');
  vm.runInNewContext(preview('kb.js'), env.ctx);
  env.host.html = env.window.CommonsKB.routes.solved();
  env.window.CommonsKB.mount();
  await flush(); await flush(); await flush();
  assert.doesNotMatch(env.host.html, /字典没读到/, '不再整页报错');
  assert.match(env.host.html, /data-kb-form="capture-source"/, '沉淀表单还在');
  assert.match(env.host.html, /data-kb-act="ask-open"/, '提问入口还在');
  assert.match(env.host.html, /data-kb-tax-note/);
  fail = false;
  click(env, { kbAct: 'retry' }, { closest: sel => sel === '[data-kb-act]' ? { dataset: { kbAct: 'retry' } } : null });
  await flush(); await flush(); await flush();
  assert.match(env.host.html, /<option value="claude"[^>]*>Claude<\/option>/);
  assert.doesNotMatch(env.host.html, /data-kb-tax-note/);
  env.window.CommonsKB.destroy();
}

const EVENTS = {
  generated_at: '2026-10-28T08:00:00Z', directions: [{ id: 'model', label: '模型' }], sources: [],
  events: [{ id: 'ev-1', title: 'Some model', title_zh: '某模型发布', summary_zh: '摘要', direction: 'model', heat: 80,
    first_seen: '2026-10-28T06:00:00Z', source_count: 1, hourly: [], sources: [], related: {} }],
  failed_sources: []
};

function hotEnv(api) {
  const env = sandbox(Object.assign({
    get: (url) => {
      if (url === '/feed/events') return Promise.resolve({ data: JSON.parse(JSON.stringify(EVENTS)) });
      if (url === '/feed/digest') return Promise.resolve({ data: { date: '2026-10-28', intro: '今日', sections: [{ direction: 'model', label: '模型', items: [{ event_id: 'ev-1' }] }] } });
      if (url === '/feed/subscriptions') return Promise.resolve({ data: { directions: [] } });
      if (url === '/content/digest-read/2026-10-28') return Promise.resolve({ data: { date: '2026-10-28', read: true } });
      return Promise.reject(new Error('unexpected GET ' + url));
    }
  }, api), '#/hot');
  vm.runInNewContext(preview('hot.js'), env.ctx);
  return env;
}

async function hotMount(env) {
  const hot = env.window.CommonsHot;
  env.host.html = '<div data-hot></div>';
  hot.mount();
  await flush(); await flush(); await flush(); await flush();
  env.host.html = hot.routes.hot();
  return hot;
}

async function hotDigestRead() {
  const writes = [];
  const env = hotEnv({
    put: (url) => { writes.push(['PUT', url]); return Promise.resolve({ data: { date: '2026-10-28', read: true } }); },
    del: (url) => { writes.push(['DELETE', url]); return Promise.resolve({ data: { date: '2026-10-28', read: false } }); }
  });
  const hot = await hotMount(env);
  assert.match(env.host.html, /已读 · 点一下改回未读/, '服务器说读过，页面就显示已读');
  assert.match(env.host.html, /2026-10-28 · 模板生成 · 已读/);
  click(env, { day: '2026-10-28' }, { closest: sel => sel === '[data-hot-act]' ? { dataset: { hotAct: 'digest-read', day: '2026-10-28' }, disabled: false, closest: () => null } : null });
  await flush();
  assert.deepEqual(writes, [['DELETE', '/content/digest-read/2026-10-28']], '已读状态下再点是取消');
  hot.destroy();
}

async function hotDiscussDedup() {
  const posts = [];
  let existing = null;
  const env = hotEnv({
    get: (url) => {
      if (url === '/content/hot-discussions/ev-1') return Promise.resolve({ data: existing });
      if (url === '/feed/events') return Promise.resolve({ data: JSON.parse(JSON.stringify(EVENTS)) });
      if (url === '/feed/digest') return Promise.resolve({ data: { date: '2026-10-28', intro: '', sections: [] } });
      if (url === '/feed/subscriptions') return Promise.resolve({ data: { directions: [] } });
      if (url.startsWith('/content/digest-read/')) return Promise.resolve({ data: { read: false } });
      return Promise.reject(new Error('unexpected GET ' + url));
    },
    post: (url, body, opts) => {
      posts.push({ url, body, key: opts && opts.idempotencyKey });
      return Promise.resolve({ data: { id: 'disc-1', title: body.title, created: false } });
    }
  });
  const hot = await hotMount(env);
  const inserted = [];
  const actions = { querySelector: sel => (sel === '[data-hot-confirm]' ? null : { focus() {} }), insertAdjacentHTML: (_where, html) => inserted.push(html) };
  const discussBtn = { dataset: { hotAct: 'discuss', id: 'ev-1' }, disabled: false, closest: sel => sel === '[data-hot-act]' ? discussBtn : (sel === '.hot-actions' ? actions : null) };

  // 1) 服务器已有讨论：直接跳过去，不弹确认、不再建帖
  existing = { id: 'disc-existing', title: '已有的讨论' };
  env.listeners.click({ target: { closest: discussBtn.closest }, preventDefault() {} });
  await flush(); await flush();
  assert.equal(env.location.hash, '#/threads/disc-existing');
  assert.equal(inserted.length, 0);
  assert.equal(posts.length, 0);

  hot.destroy();
  existing = null;
  await secondHalf();
}

async function secondHalf() {
  const posts = [];
  const env = hotEnv({
    get: (url) => {
      if (url === '/content/hot-discussions/ev-1') return Promise.resolve({ data: null });
      if (url === '/feed/events') return Promise.resolve({ data: JSON.parse(JSON.stringify(EVENTS)) });
      if (url === '/feed/digest') return Promise.resolve({ data: { date: '2026-10-28', intro: '', sections: [] } });
      if (url === '/feed/subscriptions') return Promise.resolve({ data: { directions: [] } });
      if (url.startsWith('/content/digest-read/')) return Promise.resolve({ data: { read: false } });
      return Promise.reject(new Error('unexpected GET ' + url));
    },
    post: (url, body, opts) => {
      posts.push({ url, body, key: opts && opts.idempotencyKey });
      return Promise.resolve({ data: { id: 'disc-1', title: body.title, created: false } });
    }
  });
  const hot = await hotMount(env);
  const inserted = [];
  const actions = { querySelector: sel => (sel === '[data-hot-confirm]' ? null : { focus() {} }), insertAdjacentHTML: (_where, html) => inserted.push(html) };
  const discussBtn = { dataset: { hotAct: 'discuss', id: 'ev-1' }, disabled: false, closest: sel => sel === '[data-hot-act]' ? discussBtn : (sel === '.hot-actions' ? actions : null) };
  env.listeners.click({ target: { closest: discussBtn.closest }, preventDefault() {} });
  await flush(); await flush();
  assert.equal(inserted.length, 1);
  assert.match(inserted[0], /同一条热点只会有一篇/);
  const key = /data-key="([^"]+)"/.exec(inserted[0])[1];
  const panel = { querySelectorAll: () => [], dataset: { key }, remove() {} };
  const confirmBtn = { dataset: { hotAct: 'discuss-confirm', id: 'ev-1' }, disabled: false, closest: sel => sel === '[data-hot-act]' ? confirmBtn : (sel === '[data-hot-confirm]' ? panel : null) };
  env.listeners.click({ target: { closest: confirmBtn.closest }, preventDefault() {} });
  await flush(); await flush();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, '/content/hot-discussions/ev-1');
  assert.equal(posts[0].body.title, '某模型发布');
  assert.equal(posts[0].key, key, '重试复用同一个 Idempotency-Key');
  assert.equal(env.location.hash, '#/threads/disc-1');
  assert.ok(env.toasts.some(m => /已经有人开了讨论/.test(m)));
  hot.destroy();
}

async function threadTest() {
  const post = { id: 'p1', type: 'discussion', title: '装不上', created_at: '2026-10-28T01:00:00Z', content: { body: '报错了' },
    author: { id: 'u1', handle: 'ada', display_name: 'Ada <i>', level: 2, avatar: null }, mine: {}, stats: {} };
  const reply = { id: 'r1', status: 'ok', body: '试试重装', created_at: '2026-10-28T02:00:00Z', depth: 0,
    author: { id: 'u2', handle: 'bob', display_name: 'Bob', level: 3, avatar: null }, mine: {}, stats: {} };
  const make = (can) => {
    const env = sandbox({
      get: (url) => {
        if (url === '/content/objects/p1/replies') return Promise.resolve({ data: [reply], meta: {} });
        if (url === '/content/objects/p1') return Promise.resolve({ data: post });
        return Promise.reject(new Error('unexpected GET ' + url));
      }
    }, '#/threads/p1');
    env.window.CommonsSession = { me: { id: 'me' }, can };
    env.ctx.window.document = env.document;
    vm.runInNewContext(preview('thread.js'), env.ctx);
    return env;
  };
  const env = make(a => a === 'kb.capture');
  env.document.querySelector = sel => sel === '[data-thread-live]' ? {} : null;
  const thread = env.window.CommonsThread;
  thread.routes.threads();
  thread.mount();
  await flush(); await flush(); await flush();
  const html = thread.routes.threads();
  assert.match(html, /<a class="lk-person" href="#\/u\/ada">Ada &lt;i&gt;<\/a>/, '作者名可点进主页，名字被转义');
  assert.match(html, /<a class="lk-person" href="#\/u\/bob">Bob<\/a>/, '回复作者也能点');
  assert.match(html, /href="#\/solved\?capture=discussion:p1"[^>]*>沉淀为问题卡/);
  const blocked = make(() => false);
  blocked.document.querySelector = sel => sel === '[data-thread-live]' ? {} : null;
  blocked.window.CommonsThread.routes.threads();
  blocked.window.CommonsThread.mount();
  await flush(); await flush(); await flush();
  assert.doesNotMatch(blocked.window.CommonsThread.routes.threads(), /沉淀为问题卡/, '没有 kb.capture 就不显示');
  thread.destroy(); blocked.window.CommonsThread.destroy();
}

async function hotLookupFails() {
  const env = hotEnv({
    get: (url) => {
      if (url === '/content/hot-discussions/ev-1') return Promise.reject({ status: 500, message: 'boom' });
      if (url === '/feed/events') return Promise.resolve({ data: JSON.parse(JSON.stringify(EVENTS)) });
      if (url === '/feed/digest') return Promise.resolve({ data: { date: '2026-10-28', intro: '', sections: [] } });
      if (url === '/feed/subscriptions') return Promise.resolve({ data: { directions: [] } });
      return Promise.reject(new Error('unexpected GET ' + url));
    },
    post: () => Promise.reject(new Error('确认前不该建帖'))
  });
  const hot = await hotMount(env);
  const inserted = [];
  const actions = { querySelector: sel => (sel === '[data-hot-confirm]' ? null : { focus() {} }), insertAdjacentHTML: (_w, html) => inserted.push(html) };
  const btn = { dataset: { hotAct: 'discuss', id: 'ev-1' }, disabled: false, closest: sel => sel === '[data-hot-act]' ? btn : (sel === '.hot-actions' ? actions : null) };
  env.listeners.click({ target: { closest: btn.closest }, preventDefault() {} });
  await flush(); await flush();
  assert.equal(inserted.length, 1, '查询失败也要走确认步骤');
  assert.equal(btn.disabled, false);
  hot.destroy();
}

async function bountyRules() {
  const env = sandbox({ get: () => Promise.reject(new Error('unused')) }, '#/bounty');
  // 门槛文案走 /bounty/rules 的 min_levels；这里只检查源码不再把 L2 写死在 live 分支。
  const src = preview('bounty.js');
  assert.match(src, /min_levels/);
  assert.match(src, /function minLevelText/);
  assert.doesNotMatch(src.replace(/function minLevelText[\s\S]*?\n  }\n/, ''), /<summary>推广规则<\/summary><p>[^`]*L2 及以上每周/);
  void env;
}

// R17-G2：被 can() 挡住的入口灰掉，title 和旁边小字写 CommonsSession.reason() 给的原因。
const L2 = '需要 L2（你现在是 L1）';
const session = (allowed, reasons) => ({ me: { id: 'me' }, can: a => allowed.indexOf(a) >= 0, reason: a => allowed.indexOf(a) >= 0 ? '' : (reasons[a] || '') });

async function hotReason() {
  const build = async (sess, related) => {
    const events = JSON.parse(JSON.stringify(EVENTS));
    events.events[0].related = related || {};
    const env = sandbox({
      get: (url) => {
        if (url === '/feed/events') return Promise.resolve({ data: events });
        if (url === '/feed/digest') return Promise.resolve({ data: { date: '2026-10-28', intro: '', sections: [] } });
        if (url === '/feed/subscriptions') return Promise.resolve({ data: { directions: [] } });
        return Promise.reject(new Error('unexpected GET ' + url));
      }
    }, '#/hot');
    env.window.CommonsSession = sess;
    vm.runInNewContext(preview('hot.js'), env.ctx);
    return { env, hot: await hotMount(env) };
  };
  const blocked = await build(session([], { 'feed.favorite': L2, 'object.create.discussion': L2, 'feed.room': '这个功能还没开放' }));
  const html = blocked.env.host.html;
  assert.match(html, /data-hot-act="fav"[^>]*disabled aria-disabled="true" title="需要 L2（你现在是 L1）"/);
  assert.match(html, /data-hot-act="discuss"[^>]*disabled aria-disabled="true" title="需要 L2（你现在是 L1）"/);
  assert.match(html, /data-hot-act="room"[^>]*disabled aria-disabled="true" title="这个功能还没开放"/);
  assert.match(html, /data-hot-why>讨论：需要 L2（你现在是 L1）/, '旁边小字写原因');
  blocked.hot.destroy();
  // 已有人开过讨论：「讨论」只是跳过去，不需要建帖权限，不灰
  const linked = await build(session([], { 'object.create.discussion': L2 }), { discussion: { id: 'd1', title: '已有' } });
  assert.doesNotMatch(linked.env.host.html, /data-hot-act="discuss"[^>]*disabled/);
  linked.hot.destroy();
  // 全部允许：和原来一样
  const open = await build(session(['feed.favorite', 'object.create.discussion', 'feed.room'], {}));
  assert.doesNotMatch(open.env.host.html, /data-hot-why|data-hot-act="(fav|discuss|room)"[^>]*disabled/);
  open.hot.destroy();
}

async function threadReason() {
  const post = { id: 'p1', type: 'discussion', title: '装不上', created_at: '2026-10-28T01:00:00Z', content: { body: '报错了' },
    author: { id: 'u1', handle: 'ada', display_name: 'Ada', level: 2, avatar: null }, mine: {}, stats: {} };
  const render = async (sess) => {
    const env = sandbox({
      get: (url) => {
        if (url === '/content/objects/p1/replies') return Promise.resolve({ data: [], meta: {} });
        if (url === '/content/objects/p1') return Promise.resolve({ data: post });
        return Promise.reject(new Error('unexpected GET ' + url));
      }
    }, '#/threads/p1');
    env.window.CommonsSession = sess;
    env.ctx.window.document = env.document;
    vm.runInNewContext(preview('thread.js'), env.ctx);
    env.document.querySelector = sel => sel === '[data-thread-live]' ? {} : null;
    const thread = env.window.CommonsThread;
    thread.routes.threads();
    thread.mount();
    await flush(); await flush(); await flush();
    const html = thread.routes.threads();
    thread.destroy();
    return html;
  };
  const html = await render(session([], { 'kb.capture': L2 }));
  assert.match(html, /<button class="button tonal small" type="button" disabled aria-disabled="true" title="需要 L2（你现在是 L1）">沉淀为问题卡<\/button>/, '灰掉并带 title');
  assert.match(html, /data-th-why="capture">需要 L2（你现在是 L1）/, '旁边小字写原因');
  // 功能没开放：不摆一个永远灰着的按钮
  assert.doesNotMatch(await render(session([], { 'kb.capture': '这个功能还没开放' })), /沉淀为问题卡/);
}

(async () => {
  await kbTest();
  await kbSeedFailure();
  await kbTaxonomyError();
  await hotDigestRead();
  await hotDiscussDedup();
  await hotLookupFails();
  await threadTest();
  await hotReason();
  await threadReason();
  await bountyRules();
  console.log('r17c ui ok');
})().catch(error => { console.error(error); process.exit(1); });
