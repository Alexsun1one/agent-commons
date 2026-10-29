// Offline caller contract; the content-origin iframe remains a browser acceptance item.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const rootDir = path.resolve(__dirname, '../../../..');
const source = fs.readFileSync(path.join(rootDir, 'preview/govern.js'), 'utf8');
const before = fs.readFileSync(path.join(rootDir, 'docs/evidence/LG-4/r3/before/preview__govern.js'), 'utf8');
const sampleSource = fs.readFileSync(path.join(rootDir, 'preview/govern-sample.js'), 'utf8');
class FixedDate extends Date { static now() { return 1793100000000; } }
const sampleContext = {window: {}, Date: FixedDate};
vm.runInNewContext(sampleSource, sampleContext);
const sample = sampleContext.window.COMMONS_GOVERN_SAMPLE;
const htmlCase = Object.values(sample.cases).find(c => c.preview && c.preview.html);
assert(htmlCase);
const clone = value => JSON.parse(JSON.stringify(value));

async function render(preview, live, code = source, config = {}) {
  const data = clone(sample), detail = clone(htmlCase), calls = [], requests = [], listeners = new Map();
  detail.preview = preview;
  data.cases[detail.id] = detail;
  data.queue = [data.queue.find(c => c.id === detail.id)];
  const root = {innerHTML: ''}, host = {textContent: ''};
  let destroys = 0;
  const document = {activeElement: null, querySelectorAll: () => [],
    querySelector: selector => selector === '[data-gov-root]' ? root
      : selector === '[data-gov-html]' && root.innerHTML.includes('data-gov-html') ? host : null,
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name)};
  const window = {COMMONS_GOVERN_SAMPLE: data, CommonsHTML: {
    render: (node, options) => { assert.equal(node, host); calls.push(clone(options)); return {destroy() { destroys++; }}; }
  }};
  if (live) window.CommonsAPI = {mode: 'live', get: (url, params) => {
    requests.push({url, params});
    if (url === '/governance/me') return Promise.resolve({data: {...data.me, governor: true}});
    if (url === '/governance/stats') return Promise.resolve({data: data.stats});
    if (url === '/governance/queue') return Promise.resolve({data: data.queue, meta: {next_cursor: null}});
    if (url === '/governance/cases/' + detail.id) return Promise.resolve({data: detail});
    if (url.startsWith('/media/assets/')) return config.metadata ? config.metadata()
      : Promise.resolve({data: {content_url: 'https://commons-content.test/c/html_work/' + 'b'.repeat(64)}});
    if (url === '/governance/cases/' + detail.id + '/preview') {
      assert.equal(params.asset_id, preview.asset_id);
      return config.casePreview ? config.casePreview()
        : Promise.resolve({data: {content_url: 'https://commons-content.test/c/html_work/' + 'c'.repeat(64)}});
    }
    throw new Error('Unexpected API request: ' + url);
  }};
  vm.runInNewContext(code, {window, document, Date: FixedDate});
  root.innerHTML = window.CommonsGovern.routes.govern();
  window.CommonsGovern.mount();
  await new Promise(resolve => setImmediate(resolve));
  assert.doesNotMatch(root.innerHTML, /治理台没有加载出来/);
  function close() {
    window.CommonsGovern.destroy();
    assert.equal(destroys, calls.length, 'preview handles must be destroyed');
  }
  function retry() {
    const button = {closest: () => root, getAttribute: key => key === 'data-gov-act' ? 'preview-retry' : null};
    listeners.get('click')({target: {closest: () => button}, preventDefault() {}});
  }
  if (!config.hold) close();
  return {html: root.innerHTML, calls, requests, host, close, retry};
}

(async () => {
  const original = await render(clone(htmlCase.preview), false, before);
  const demo = await render(clone(htmlCase.preview), false);
  assert.equal(demo.html, original.html);
  assert.deepEqual(demo.calls, original.calls);
  assert.equal(demo.calls[0].html, htmlCase.preview.html);
  const base = {state: 'active', object_type: 'work', version: 2, title: '作品', has_html: true};
  for (const fields of [
    {asset_id: 'asset-current-v2'},
    {content_url: 'https://commons-content.test/c/html_work/' + 'a'.repeat(64)},
    {},
    {html: '<script>LEGACY_BODY_MUST_NOT_BE_FORWARDED</script>'}
  ]) {
    const actual = await render({...base, ...fields}, true);
    if (fields.asset_id || fields.content_url) {
      assert.equal(actual.calls.length, 1);
      assert.equal(actual.calls[0].contentUrl, fields.content_url || 'https://commons-content.test/c/html_work/' + 'b'.repeat(64));
      assert(!Object.hasOwn(actual.calls[0], 'html'));
      assert(!actual.requests.some(r => r.url.endsWith('/preview')), 'visible asset needs no governance fallback');
    } else {
      assert.equal(actual.calls.length, 0);
      assert.match(actual.host.textContent, /没有内容地址/);
    }
    assert.match(actual.html, /未做联系方式遮盖/);
    assert.doesNotMatch(actual.html, /联系方式已遮盖|LEGACY_BODY_MUST_NOT_BE_FORWARDED/);
  }
  for (const preview of [
    {...base, has_html: false},
    {...base, state: 'withdrawn', asset_id: 'do-not-render'},
    {...base, state: 'missing', asset_id: 'do-not-render'}
  ]) assert.equal((await render(preview, true)).calls.length, 0);
  const hidden = {...base, state: 'hidden', asset_id: 'hidden-asset'};
  for (const metadata of [() => Promise.reject({code: 'resource_not_found'}), () => Promise.resolve({data: {}})]) {
    const actual = await render(hidden, true, source, {metadata});
    assert.equal(actual.calls.length, 1);
    assert.equal(actual.calls[0].contentUrl, 'https://commons-content.test/c/html_work/' + 'c'.repeat(64));
    assert(!Object.hasOwn(actual.calls[0], 'html'));
    assert.equal(actual.requests.filter(r => r.url.endsWith('/preview')).length, 1);
  }
  let fail = true;
  const failed = await render(hidden, true, source, {hold: true,
    metadata: () => Promise.reject({code: 'resource_not_found'}),
    casePreview: () => fail ? Promise.reject(new Error('PRIVATE_DIAGNOSTIC'))
      : Promise.resolve({data: {content_url: 'https://commons-content.test/c/html_work/' + 'd'.repeat(64)}})});
  assert.equal(failed.calls.length, 0);
  assert.match(failed.host.innerHTML, /重试/);
  assert.doesNotMatch(failed.host.innerHTML, /PRIVATE_DIAGNOSTIC/);
  fail = false;
  failed.retry();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(failed.calls.length, 1);
  failed.close();
  for (const phase of ['metadata', 'casePreview']) {
    let resolvePending;
    const deferred = () => new Promise(resolve => { resolvePending = resolve; });
    const config = {hold: true, metadata: () => Promise.reject({code: 'resource_not_found'}), [phase]: deferred};
    const stale = await render(hidden, true, source, config);
    stale.close();
    resolvePending({data: {content_url: 'https://commons-content.test/c/html_work/' + 'e'.repeat(64)}});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(stale.calls.length, 0, 'late ' + phase + ' must not mount a viewer');
  }
  console.log('PASS: demo parity; media-first then case-scoped fallback; no HTML forwarding; missing-source/withdrawn handling; retry; late media/case responses ignored; handles cleaned up');
})().catch(error => { console.error(error); process.exitCode = 1; });
